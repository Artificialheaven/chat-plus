import { ApiError, streamMessage } from '../api/client.js'
import type { ChatModel, CreateMessageRequest, MessageParam, StopReason } from '../api/types.js'
import { translate } from '../../i18n/index.js'
import { toRequestMessages } from './reply.js'
import type { AssistantMessage, Message, SessionCompaction, UserMessage } from './types.js'

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

/** 压缩指令以一条普通提问的形式追加，正文由当前语言决定。 */
const instructionMessage = (): UserMessage => ({
  id: 'compaction-instruction',
  role: 'user',
  content: translate('compactInstruction'),
  files: [],
  createdAt: Date.now(),
})

/**
 * 把待压缩的历史按正常请求的方式重放，末尾接上压缩指令。
 * 与正式请求使用同一套 system、消息转换和工具声明，provider 的前缀缓存才能命中。
 */
export const buildCompactionMessages = (
  history: Message[],
  { upToId, previousUpToId }: { upToId: string; previousUpToId?: string }
): MessageParam[] => {
  const end = history.findIndex((message) => message.id === upToId)
  if (end < 0) {
    throw new ApiError('protocol', { key: 'compactFailed' })
  }
  const start = previousUpToId
    ? history.findIndex((message) => message.id === previousUpToId) + 1
    : 0
  return toRequestMessages(history.slice(start, end + 1), instructionMessage(), undefined, false)
}

/** 单独一次流式请求生成摘要；沿用正式请求的 system 与工具声明以复用前缀缓存。 */
export const requestCompaction = async ({
  apiKey,
  model,
  system,
  messages,
  tools,
  safetyCheck,
  signal,
}: {
  apiKey: string
  model: ChatModel
  system: string
  messages: MessageParam[]
  tools: CreateMessageRequest['tools']
  safetyCheck: boolean
  signal: AbortSignal
}): Promise<string> => {
  const body: CreateMessageRequest = {
    model,
    system,
    messages,
    thinking: { type: 'disabled' },
    tools,
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
