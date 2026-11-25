import { strToU8, zipSync } from 'fflate'
import { directorySource, zipSource, type ImportSource } from '../src/services/chat/history/source.js'

const ISO = '2026-01-02T03:04:05.000Z'

type Role = 'USER' | 'ASSISTANT'

const message = (id: number, parent: number | null, role: Role, text: string) => ({
  id,
  parent_id: parent,
  role,
  status: 'FINISHED',
  thinking_enabled: false,
  search_enabled: false,
  accumulated_token_usage: 0,
  inserted_at: ISO,
  fragments: [{ type: role === 'USER' ? 'REQUEST' : 'RESPONSE', content: text }],
})

const sessionFile = (id: string) => ({
  id,
  title: `标题 ${id}`,
  pinned: false,
  current_message_id: 2,
  inserted_at: ISO,
  updated_at: ISO,
  messages: [message(1, null, 'USER', `问 ${id}`), message(2, 1, 'ASSISTANT', '答')],
})

const indexEntry = (id: string) => ({
  id,
  title: `标题 ${id}`,
  pinned: false,
  message_count: 2,
  inserted_at: ISO,
  updated_at: ISO,
})

export type ArchiveOptions = {
  /** 归档内的会话 ID，默认两个 */
  sessions?: string[]
  /** 索引列出的会话 ID，默认与会话一致 */
  indexIds?: string[]
  /** 索引未列出、但目录里存在的多余会话 */
  extraSession?: string
  /** 故意写成非法 JSON 的会话 */
  corrupt?: string
  /** 把 manifest 放到最后，用于测试「必须是首个条目」 */
  manifestLast?: boolean
}

/** 生成一份符合导出格式的文件表，ZIP 与目录两种来源共用。 */
export const archiveFiles = (options: ArchiveOptions = {}): Record<string, string> => {
  const sessions = options.sessions ?? ['a1', 'a2']
  const entries: [string, string][] = []
  if (!options.manifestLast) {
    entries.push(['manifest.json', JSON.stringify({ export_format_version: 3 })])
  }
  for (const id of sessions) {
    entries.push([
      `chat_sessions/${id}.json`,
      options.corrupt === id ? '{broken' : JSON.stringify(sessionFile(id)),
    ])
  }
  if (options.extraSession) {
    entries.push([`chat_sessions/${options.extraSession}.json`, JSON.stringify(sessionFile(options.extraSession))])
  }
  const indexIds = options.indexIds ?? sessions
  entries.push([
    'chat_session_index.json',
    JSON.stringify(indexIds.map((id) => indexEntry(id))),
  ])
  if (options.manifestLast) {
    entries.push(['manifest.json', JSON.stringify({ export_format_version: 3 })])
  }
  return Object.fromEntries(entries)
}

export const zipOf = (files: Record<string, string>): ImportSource =>
  zipSource(
    new File(
      [zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)]))) as unknown as BlobPart],
      'archive.zip'
    )
  )

export const dirOf = (files: Record<string, string>): ImportSource =>
  directorySource(
    'archive',
    new Map(
      Object.entries(files).map(([path, text]) => [path, new File([text], path.split('/').pop() ?? path)])
    )
  )
