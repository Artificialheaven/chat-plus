import { fail } from './errors.js'
import { checkManifest, readSessionIndex } from './schema.js'
import { readJsonEntry } from './entryJson.js'
import { INDEX_PATH, MANIFEST_PATH } from './paths.js'
import { openArchiveEntry } from './zipReader.js'
import type { SessionIndexEntry } from './format.js'

/**
 * 同一个 File 不可变，manifest 与索引只解析一次：
 * 选文件时的探查与确认后的导入共享结果，避免数万条索引重复校验。
 */
const manifests = new WeakSet<File>()
const indexes = new WeakMap<File, SessionIndexEntry[]>()

/** 校验 manifest 与格式版本；重复调用直接复用结果。 */
export const loadManifest = async (file: File): Promise<void> => {
  if (manifests.has(file)) {
    return
  }
  const entry = await openArchiveEntry(file, MANIFEST_PATH)
  if (!entry) {
    return fail('backupUnrecognized')
  }
  checkManifest(await readJsonEntry(entry))
  manifests.add(file)
}

/** 读取并校验会话索引；重复调用直接复用结果。 */
export const loadIndex = async (file: File): Promise<SessionIndexEntry[]> => {
  const cached = indexes.get(file)
  if (cached) {
    return cached
  }
  const entry = await openArchiveEntry(file, INDEX_PATH)
  if (!entry) {
    return fail('backupUnrecognized')
  }
  const index = readSessionIndex(await readJsonEntry(entry))
  indexes.set(file, index)
  return index
}
