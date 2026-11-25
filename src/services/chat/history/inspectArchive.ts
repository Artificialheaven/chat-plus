import { BackupError, fail } from './errors.js'
import { loadIndex, loadManifest } from './archiveCache.js'
import { MANIFEST_PATH, parseFilesPath, parseSessionPath } from './paths.js'
import { ArchiveError, isZipFile, listArchiveEntries } from './zipReader.js'

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
 * 只解析 ZIP 目录，再按路径读取 manifest 与 chat_session_index.json，供用户勾选要导入的会话。
 * 会话 JSON 与图片原件不在此处解压，因此大归档也能很快出列表。
 */
export const inspectArchive = async (file: File): Promise<ArchiveInspection> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  try {
    const entries = await listArchiveEntries(file)
    // manifest 必须是归档的首个条目
    const first = entries.find((entry) => !entry.directory)
    if (!first || first.path !== MANIFEST_PATH) {
      fail('backupUnrecognized')
    }
    await loadManifest(file)
    const index = await loadIndex(file)

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
    let bytes = 0
    for (const entry of entries) {
      if (entry.directory) {
        continue
      }
      bytes += entry.size
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
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
}
