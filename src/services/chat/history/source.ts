import type { ArchiveEntry, ArchiveEntryInfo } from './zipReader.js'
import { listArchiveEntries, openArchiveEntry } from './zipReader.js'

/**
 * 导入来源：ZIP 文件，或用户手动解压出来的目录。
 * 目录来源不需要 ZIP64：超过 4 GB 的导出可以先解压，再按需读取选中的会话。
 */
export type ImportSource =
  | { kind: 'zip'; name: string; file: File }
  | { kind: 'directory'; name: string; files: ReadonlyMap<string, File> }

export const zipSource = (file: File): ImportSource => ({ kind: 'zip', name: file.name, file })

export const directorySource = (name: string, files: ReadonlyMap<string, File>): ImportSource => ({
  kind: 'directory',
  name,
  files,
})

/** 列出条目元信息；目录来源只走内存里的文件表，不读内容。 */
export const listSourceEntries = async (source: ImportSource): Promise<ArchiveEntryInfo[]> =>
  source.kind === 'zip'
    ? listArchiveEntries(source.file)
    : [...source.files].map(([path, file]) => ({
        path,
        size: file.size,
        offset: 0,
        directory: false,
      }))

/** 按路径打开单个条目；目录来源直接读取对应文件的字节。 */
export const openSourceEntry = async (
  source: ImportSource,
  path: string
): Promise<ArchiveEntry | undefined> => {
  if (source.kind === 'zip') {
    return openArchiveEntry(source.file, path)
  }
  const file = source.files.get(path)
  if (!file) {
    return undefined
  }
  return { path, size: file.size, offset: 0, stream: file.stream() }
}
