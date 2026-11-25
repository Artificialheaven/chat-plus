import { ApiError, streamMessage } from '../api/client.js'
import type { ChatModel, CreateMessageRequest, StopReason } from '../api/types.js'
import { translate } from '../../i18n/index.js'
import { getReplyText } from './reply.js'
import type { AssistantMessage, SessionCompaction, UserMessage } from './types.js'

export type CompactRound = [UserMessage, AssistantMessage]

export type CompactPlan = {
  /** 本次压缩覆盖的全部轮次（含之前摘要覆盖的部分）。 */
  summarizable: CompactRound[]
  /** 本次需要新送给模型压缩的轮次；之前的摘要单独携带。 */
  fresh: CompactRound[]
  /** 压缩后原样保留的最近轮次。 */
  kept: CompactRound[]
  /** 摘要覆盖到的最后一条消息。 */
  upToId: string
  /** 摘要覆盖的轮次数。 */
  rounds: number
}

/** 压缩记录只在边界仍位于当前分支时生效。 */
export const getActiveCompaction = (
  compaction: SessionCompaction | undefined,
  history: { id: string }[]
): SessionCompaction | undefined =>
  compaction && history.some((message) => message.id === compaction.upToId)
    ? compaction
    : undefined

/**
 * 计算压缩边界：保留最近 keepRounds 轮，其余轮次进入摘要。
 * 已有摘要时只把边界之后的新轮次送去压缩，避免重复发送旧内容。
 */
export const planCompaction = (
  rounds: CompactRound[],
  keepRounds: number,
  previousUpToId?: string
): CompactPlan | null => {
  const keep = Math.max(0, Math.min(keepRounds, rounds.length))
  const summarizable = rounds.slice(0, rounds.length - keep)
  if (summarizable.length === 0) {
    return null
  }
  const last = summarizable[summarizable.length - 1]
  if (!last) {
    return null
  }
  const previousIndex = previousUpToId
    ? summarizable.findIndex(([, reply]) => reply.id === previousUpToId)
    : -1
  const fresh = summarizable.slice(previousIndex + 1)
  if (fresh.length === 0) {
    return null
  }
  return {
    summarizable,
    fresh,
    kept: rounds.slice(rounds.length - keep),
    upToId: last[1].id,
    rounds: summarizable.length,
  }
}

/** 阅读链接与正文引用里的来源；摘要里保留标题和 URL，避免丢失可追溯信息。 */
const sourceLines = (reply: AssistantMessage): string[] => {
  const sources = new Map<string, string>()
  for (const block of reply.blocks) {
    if (block.type === 'text') {
      for (const citation of block.citations ?? []) {
        sources.set(citation.url, citation.title ?? '')
      }
    } else if (
      block.type === 'web_fetch_tool_result' &&
      block.content.type === 'web_fetch_result'
    ) {
      sources.set(block.content.url, block.content.content.title ?? '')
    }
  }
  return [...sources].map(([url, title]) => (title ? `- ${title}: ${url}` : `- ${url}`))
}

/** 把待压缩轮次转成纯文本；不包含思考与搜索结果，只保留正文、附件名和来源。 */
export const buildCompactTranscript = (
  rounds: CompactRound[],
  previousSummary?: string
): string => {
  const parts: string[] = []
  if (previousSummary) {
    parts.push(`## Previous summary\n${previousSummary}`)
  }
  rounds.forEach(([user, reply], index) => {
    const files = user.files.map((file) => file.name).join(', ')
    parts.push(`## ${previousSummary ? 'New round' : 'Round'} ${index + 1}`)
    parts.push(`User:${files ? ` [attachments: ${files}]` : ''}\n${user.content || '(no text)'}`)
    parts.push(`Assistant:\n${getReplyText(reply).trim() || '(no text)'}`)
    const sources = sourceLines(reply)
    if (sources.length > 0) {
      parts.push(`Sources:\n${sources.join('\n')}`)
    }
  })
  return parts.join('\n\n')
}

/** 单独一次流式请求生成摘要；不携带工具，也不开启深度思考。 */
export const requestCompaction = async ({
  apiKey,
  model,
  transcript,
  safetyCheck,
  signal,
}: {
  apiKey: string
  model: ChatModel
  transcript: string
  safetyCheck: boolean
  signal: AbortSignal
}): Promise<string> => {
  const body: CreateMessageRequest = {
    model,
    system: translate('compactSystemPrompt'),
    messages: [
      { role: 'user', content: `${translate('compactInstruction')}\n\n${transcript}` },
    ],
    thinking: { type: 'disabled' },
    tools: [],
    ...(safetyCheck ? { safety_check: { level: 'high' } } : {}),
  }
  let summary = ''
  let stopReason: StopReason | undefined
  for await (const event of streamMessage(apiKey, body, signal)) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      summary += event.delta.text
    } else if (event.type === 'message_delta') {
      stopReason = event.delta.stop_reason
    }
  }
  if (stopReason === 'refusal') {
    throw new ApiError('stream', translate('replyRefused'))
  }
  const text = summary.trim()
  if (!text) {
    throw new ApiError('protocol', translate('compactEmptySummary'))
  }
  return text
}
