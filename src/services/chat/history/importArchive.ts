import * as db from '../db.js'
import type { Session } from '../types.js'
import { BackupError, fail } from './errors.js'
import { readJsonEntry } from './entryJson.js'
import type { SessionIndexEntry } from './format.js'
import {
  INDEX_PATH,
  MANIFEST_PATH,
  USER_PATH,
  parseFilesPath,
  parseSessionPath,
  sessionFilesDir,
} from './paths.js'
import { checkManifest, readSessionFile, readSessionIndex } from './schema.js'
import { toLocalSession } from './toLocal.js'
import {
  ArchiveError,
  isZipFile,
  readArchive,
  readEntry,
  skipEntry,
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

/**
 * 检查 ZIP 格式、首个 manifest 条目及格式版本。
 * 校验失败时保留正在生成的回答和现有暂存数据。
 */
export const checkArchiveFormat = async (file: File): Promise<void> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  try {
    for await (const entry of readArchive(file)) {
      if (entry.path !== MANIFEST_PATH) {
        fail('backupUnrecognized')
      }
      checkManifest(await readJsonEntry(entry))
      return
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  fail('backupUnrecognized')
}

/**
 * 按会话读取 JSON 和对应文件，保留归档物理顺序的格式校验。
 * 也支持会话与图片交错排列、index 位于末尾的条目顺序。
 * 提供 sessionIds 时只解压这些会话及其附件，未选中的会话完全跳过，不做 CRC 校验。
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
  const wanted = (id: string) => selection === undefined || selection.has(id)
  const imported = new Set<string>()
  const firstImageOffset = new Map<string, number>()
  const fileSessions = new Map<string, Set<string>>()
  // 同一图片可能出现在多个会话目录，待写入的原件也参与去重。
  const stored = new Map<string, string>()
  let manifest = false
  let index: SessionIndexEntry[] | undefined
  let currentSessionId: string | undefined
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
    if (entry.offset >= (firstImageOffset.get(id) ?? Infinity)) {
      await skipEntry(entry)
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
    const entries: ArchiveEntry[] = []
    const filesBySession = new Map<string, ArchiveEntry[]>()
    for await (const entry of readArchive(file)) {
      entries.push(entry)
      const id = parseSessionPath(entry.path)
      if (id !== null) {
        if (wanted(id)) {
          filesBySession.set(id, [])
        }
      } else {
        const owner = parseFilesPath(entry.path)
        if (owner !== null) {
          filesBySession.get(owner)?.push(entry)
        }
      }
    }
    totalSessions = filesBySession.size
    onProgress?.(0, totalSessions)
    for (const entry of entries) {
      const { path } = entry
      const sessionId = parseSessionPath(path)
      if (!manifest) {
        if (path !== MANIFEST_PATH) {
          fail('backupUnrecognized')
        }
        checkManifest(await readJsonEntry(entry))
        manifest = true
        continue
      }
      if (path === USER_PATH && !index && imported.size === 0) {
        // 账号信息（已脱敏）不导入；文件可能缺失。
        await skipEntry(entry)
        continue
      }
      if (sessionId !== null && !index) {
        if (!wanted(sessionId)) {
          // 未选中的会话不读正文，跳过其 JSON 与附件。
          continue
        }
        if (sessionBatchBytes + entry.size > maxSessionBatchBytes) {
          await flushSessions()
        }
        const local = toLocalSession(readSessionFile(await readJsonEntry(entry)))
        if (local.session.id !== sessionId || imported.has(sessionId)) {
          fail('backupIncomplete')
        }
        imported.add(sessionId)
        currentSessionId = sessionId
        for (const fileEntry of filesBySession.get(sessionId) ?? []) {
          const id = local.images.get(fileEntry.path)
          await (id === undefined ? skipEntry(fileEntry) : saveImage(fileEntry, id))
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
            sessions.add(sessionId)
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
        continue
      }
      if (path === INDEX_PATH && !index) {
        index = readSessionIndex(await readJsonEntry(entry))
        await flushSessions()
        continue
      }
      const owner = parseFilesPath(path)
      if (owner !== null && !wanted(owner)) {
        continue
      }
      if (
        index
          ? !imported.has(owner ?? '')
          : !currentSessionId || !path.startsWith(sessionFilesDir(currentSessionId))
      ) {
        // 附件正文已随所属会话处理，此处仍校验归档中的位置。
        fail('backupIncomplete')
      }
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  if (!manifest) {
    fail('backupUnrecognized')
  }
  // index 与会话文件一一对应；只要求被导入的会话都在索引中。
  const listed = new Set(index?.map((entry) => entry.id))
  const missingSelection = selection !== undefined && [...selection].some((id) => !listed.has(id))
  if (
    !index ||
    listed.size !== index.length ||
    missingSelection ||
    [...imported].some((id) => !listed.has(id)) ||
    (selection === undefined && listed.size !== imported.size)
  ) {
    fail('backupIncomplete')
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
