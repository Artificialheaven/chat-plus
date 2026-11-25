import * as db from '../db.js'
import type { Session } from '../types.js'
import { BackupError, fail } from './errors.js'
import { readJsonEntry } from './entryJson.js'
import { loadIndex, loadManifest } from './archiveCache.js'
import { MANIFEST_PATH, parseFilesPath, parseSessionPath, sessionPath } from './paths.js'
import { readSessionFile } from './schema.js'
import { toLocalSession } from './toLocal.js'
import {
  ArchiveError,
  isZipFile,
  listArchiveEntries,
  openArchiveEntry,
  readEntry,
  type ArchiveEntry,
} from './zipReader.js'

export type ImportProgressCallback = (processed: number, total: number) => void

export type ImportArchiveOptions = {
  onProgress?: ImportProgressCallback
  /** 只导入这些会话；缺省时导入归档内的全部会话 */
  sessionIds?: ReadonlySet<string>
}

/** 从原件字节补充图片 MIME；无法识别时为空字符串，图片身份仍由归档的 is_image 决定。 */
const imageType = (bytes: Uint8Array): string => {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 12))
  if (startsWith(0xff, 0xd8, 0xff)) {
    return 'image/jpeg'
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png'
  }
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (startsWith(0x42, 0x4d)) {
    return 'image/bmp'
  }
  if (startsWith(0x49, 0x49, 0x2a, 0) || startsWith(0x4d, 0x4d, 0, 0x2a)) {
    return 'image/tiff'
  }
  if (header.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(header.slice(8, 12))) {
    return 'image/avif'
  }
  return ''
}

/** 读取 manifest 并校验格式版本；不是合法归档时抛出对应提示。 */
const readManifest = async (file: File, entries: { path: string; directory: boolean }[]) => {
  // manifest 必须是归档的首个条目
  const first = entries.find((entry) => !entry.directory)
  if (!first || first.path !== MANIFEST_PATH) {
    return fail('backupUnrecognized')
  }
  await loadManifest(file)
}

const wrapArchiveError = (error: unknown): unknown =>
  error instanceof ArchiveError ? new BackupError('backupIncomplete') : error

/**
 * 检查 ZIP 格式、首个 manifest 条目及格式版本。
 * 校验失败时保留正在生成的回答和现有暂存数据。
 */
export const checkArchiveFormat = async (file: File): Promise<void> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  try {
    await readManifest(file, await listArchiveEntries(file))
  } catch (error) {
    throw wrapArchiveError(error)
  }
}

/**
 * 只解析 ZIP 目录，然后按路径读取选中的会话 JSON 及其附件。
 * 未选中会话的条目既不解析也不读取，因此归档体积不影响导入耗时。
 * 写入导入暂存存储；调用方负责先清空暂存，成功后替换正式数据，失败时清理暂存。
 */
export const importArchive = async (
  file: File,
  options: ImportArchiveOptions = {}
): Promise<void> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  const { onProgress, sessionIds: selection } = options
  const imported = new Set<string>()
  const firstImageOffset = new Map<string, number>()
  const fileSessions = new Map<string, Set<string>>()
  // 同一图片可能出现在多个会话目录，待写入的原件也参与去重。
  const stored = new Map<string, string>()
  let totalSessions = 0

  const maxSessionBatchCount = 32
  const maxSessionBatchBytes = 2 * 1024 * 1024
  let sessionBatch: Session[] = []
  let sessionBatchBytes = 0
  const flushSessions = async () => {
    if (!sessionBatch.length) {
      return
    }
    await flushImages()
    await db.addStagingSessions(sessionBatch)
    sessionBatch = []
    sessionBatchBytes = 0
    if (imported.size < totalSessions) {
      onProgress?.(imported.size, totalSessions)
    }
  }

  const maxImageBatchCount = 16
  const maxImageBatchBytes = 4 * 1024 * 1024
  let imageBatch: db.StoredFile[] = []
  let imageBatchBytes = 0
  const flushImages = async () => {
    if (!imageBatch.length) {
      return
    }
    await db.saveStagingFiles(imageBatch)
    imageBatch = []
    imageBatchBytes = 0
  }
  const saveImage = async (entry: ArchiveEntry, id: string) => {
    // 同一图片出现在多个会话目录时只保留物理位置最靠前的一份。
    if (entry.offset >= (firstImageOffset.get(id) ?? Infinity)) {
      return
    }
    if (imageBatchBytes + entry.size > maxImageBatchBytes) {
      await flushImages()
    }
    const blob = await readEntry(entry, imageType)
    imageBatch.push({ id, blob })
    imageBatchBytes += blob.size
    firstImageOffset.set(id, entry.offset)
    stored.set(id, blob.type)
    if (imageBatch.length >= maxImageBatchCount || imageBatchBytes >= maxImageBatchBytes) {
      await flushImages()
    }
  }

  try {
    const entries = await listArchiveEntries(file)
    await readManifest(file, entries)

    const index = await loadIndex(file)
    const listed = new Set(index.map((item) => item.id))
    if (listed.size !== index.length) {
      fail('backupIncomplete')
    }

    // 只记录目录里实际存在的会话 ID；附件路径按选中会话收集，避免为未选中的会话建表。
    const present = new Set<string>()
    const filesBySession = new Map<string, string[]>()
    const wanted = (id: string) => selection === undefined || selection.has(id)
    for (const entry of entries) {
      if (entry.directory) {
        continue
      }
      const sessionId = parseSessionPath(entry.path)
      if (sessionId !== null) {
        present.add(sessionId)
        continue
      }
      const owner = parseFilesPath(entry.path)
      if (owner === null || !wanted(owner)) {
        continue
      }
      const paths = filesBySession.get(owner)
      if (paths) {
        paths.push(entry.path)
      } else {
        filesBySession.set(owner, [entry.path])
      }
    }

    // 索引与会话文件必须一一对应，附件目录必须属于索引内的会话。
    for (const item of index) {
      if (!present.has(item.id)) {
        return fail('backupIncomplete')
      }
    }
    for (const id of present) {
      if (!listed.has(id)) {
        return fail('backupIncomplete')
      }
    }
    if ([...filesBySession.keys()].some((owner) => !listed.has(owner))) {
      fail('backupIncomplete')
    }
    if (selection !== undefined && [...selection].some((id) => !listed.has(id))) {
      fail('backupIncomplete')
    }

    const targets = selection === undefined ? index : index.filter((item) => selection.has(item.id))
    totalSessions = targets.length
    onProgress?.(0, totalSessions)

    for (const item of targets) {
      const entry = await openArchiveEntry(file, sessionPath(item.id))
      if (!entry) {
        return fail('backupIncomplete')
      }
      const local = toLocalSession(readSessionFile(await readJsonEntry(entry)))
      if (local.session.id !== item.id || imported.has(item.id)) {
        fail('backupIncomplete')
      }
      imported.add(item.id)

      for (const imagePath of filesBySession.get(item.id) ?? []) {
        const id = local.images.get(imagePath)
        if (id === undefined) {
          continue
        }
        const imageEntry = await openArchiveEntry(file, imagePath)
        if (!imageEntry) {
          return fail('backupIncomplete')
        }
        await saveImage(imageEntry, id)
      }
      for (const message of local.session.messages) {
        if (message.role !== 'user') {
          continue
        }
        for (const attachment of message.files) {
          let sessions = fileSessions.get(attachment.id)
          if (!sessions) {
            sessions = new Set()
            fileSessions.set(attachment.id, sessions)
          }
          sessions.add(item.id)
        }
      }
      sessionBatch.push(local.session)
      sessionBatchBytes += entry.size
      if (
        sessionBatch.length >= maxSessionBatchCount ||
        sessionBatchBytes >= maxSessionBatchBytes
      ) {
        await flushSessions()
      }
    }
  } catch (error) {
    throw wrapArchiveError(error)
  }
  await flushSessions()

  const targetSessions = new Set<string>()
  for (const [id, type] of stored) {
    if (!type) {
      continue
    }
    for (const sessionId of fileSessions.get(id) ?? []) {
      targetSessions.add(sessionId)
    }
  }
  if (targetSessions.size > 0) {
    await db.updateStagingFileTypes(stored, targetSessions)
  }
  if (totalSessions > 0) {
    onProgress?.(imported.size, totalSessions)
  }
}
