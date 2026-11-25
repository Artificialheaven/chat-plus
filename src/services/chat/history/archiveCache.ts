import { fail } from './errors.js'
import { checkManifest, readSessionIndex } from './schema.js'
import { readJsonEntry } from './entryJson.js'
import { INDEX_PATH, MANIFEST_PATH } from './paths.js'
import { listSourceEntries, openSourceEntry, type ImportSource } from './source.js'
import type { SessionIndexEntry } from './format.js'

/**
 * 同一个 File 不可变，manifest 与索引只解析一次：
 * 选文件时的探查与确认后的导入共享结果，避免数万条索引重复校验。
 */
const manifests = new WeakSet<ImportSource>()
const indexes = new WeakMap<ImportSource, SessionIndexEntry[]>()

/** 校验 manifest 与格式版本；重复调用直接复用结果。 */
export const loadManifest = async (source: ImportSource): Promise<void> => {
  if (manifests.has(source)) {
    return
  }
  // ZIP 要求 manifest 是首个条目；目录来源没有物理顺序，只要求存在。
  if (source.kind === 'zip') {
    const first = (await listSourceEntries(source)).find((entry) => !entry.directory)
    if (!first || first.path !== MANIFEST_PATH) {
      return fail('backupUnrecognized')
    }
  }
  const entry = await openSourceEntry(source, MANIFEST_PATH)
  if (!entry) {
    return fail('backupUnrecognized')
  }
  checkManifest(await readJsonEntry(entry))
  manifests.add(source)
}

/** 读取并校验会话索引；重复调用直接复用结果。 */
export const loadIndex = async (source: ImportSource): Promise<SessionIndexEntry[]> => {
  const cached = indexes.get(source)
  if (cached) {
    return cached
  }
  const entry = await openSourceEntry(source, INDEX_PATH)
  if (!entry) {
    return fail('backupUnrecognized')
  }
  const index = readSessionIndex(await readJsonEntry(entry))
  indexes.set(source, index)
  return index
}
