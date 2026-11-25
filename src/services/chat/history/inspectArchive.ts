import { BackupError, fail } from './errors.js'
import { readJsonEntry } from './entryJson.js'
import type { SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, parseFilesPath, parseSessionPath } from './paths.js'
import { checkManifest, readSessionIndex } from './schema.js'
import { ArchiveError, isZipFile, readArchive } from './zipReader.js'

/** 导入前展示的单个会话元信息。 */
export type ArchiveSessionPreview = {
  id: string
  title: string | null
  messageCount: number
  updatedAt: string
  /** 会话 JSON 与所属附件的压缩后字节数 */
  bytes: number
  /** 会话 JSON 加附件的条目数 */
  fileCount: number
}

/** 归档探查结果：只解压 manifest 与索引，其余条目仅读目录头。 */
export type ArchiveInspection = {
  sessions: ArchiveSessionPreview[]
  /** 全部条目的压缩后字节数 */
  bytes: number
}

/**
 * 只读取 ZIP 目录、manifest 与 chat_session_index.json，供用户勾选要导入的会话。
 * 会话 JSON 与图片原件不在此处解压，因此大归档也能很快出列表。
 */
export const inspectArchive = async (file: File): Promise<ArchiveInspection> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  const sizes = new Map<string, { bytes: number; fileCount: number }>()
  const add = (id: string, bytes: number) => {
    const current = sizes.get(id)
    if (current) {
      current.bytes += bytes
      current.fileCount += 1
      return
    }
    sizes.set(id, { bytes, fileCount: 1 })
  }
  let manifestSeen = false
  let index: SessionIndexEntry[] | undefined
  let bytes = 0

  try {
    for await (const entry of readArchive(file)) {
      bytes += entry.size
      if (!manifestSeen) {
        if (entry.path !== MANIFEST_PATH) {
          fail('backupUnrecognized')
        }
        checkManifest(await readJsonEntry(entry))
        manifestSeen = true
        continue
      }
      if (entry.path === INDEX_PATH && index === undefined) {
        index = readSessionIndex(await readJsonEntry(entry))
        continue
      }
      const sessionId = parseSessionPath(entry.path)
      if (sessionId !== null) {
        add(sessionId, entry.size)
        continue
      }
      const owner = parseFilesPath(entry.path)
      if (owner !== null) {
        add(owner, entry.size)
      }
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  if (!manifestSeen) {
    return fail('backupUnrecognized')
  }
  if (index === undefined) {
    return fail('backupUnrecognized')
  }
  // 索引里没有对应会话文件的条目无法导入，直接不展示。
  const sessions = index
    .filter((item) => sizes.has(item.id))
    .map((item) => {
      const size = sizes.get(item.id) ?? { bytes: 0, fileCount: 0 }
      return {
        id: item.id,
        title: item.title,
        messageCount: item.message_count,
        updatedAt: item.updated_at,
        bytes: size.bytes,
        fileCount: size.fileCount,
      }
    })
  return { sessions, bytes }
}
