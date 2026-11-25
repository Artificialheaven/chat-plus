import { fail } from './errors.js'
import type { ArchiveEntry } from './zipReader.js'

/** 读取条目的 UTF-8 文本并解析为 JSON；内容不是合法 JSON 时按归档损坏处理。 */
export const readJsonEntry = async (entry: ArchiveEntry): Promise<unknown> => {
  const decoder = new TextDecoder('utf-8')
  let text = ''
  for await (const chunk of entry.stream) {
    text += decoder.decode(chunk, { stream: true })
  }
  text += decoder.decode()
  try {
    return JSON.parse(text)
  } catch {
    return fail('backupInvalidJson')
  }
}
