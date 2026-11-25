import { getContextRounds, getReplyText } from './reply.js'
import type { AssistantMessage, Message, SessionCompaction, UserMessage } from './types.js'

/** 保守估算：CJK 字符按 1 token，其他字符按 4 字符 1 token。 */
const CJK = /[⺀-鿿豈-﫿＀-￯]/
const SYSTEM_OVERHEAD = 300
const MESSAGE_OVERHEAD = 4
const FILE_OVERHEAD = 20

const estimateText = (text: string): number => {
  let cjk = 0
  let other = 0
  for (const char of text) {
    if (CJK.test(char)) {
      cjk += 1
    } else {
      other += 1
    }
  }
  return Math.ceil(cjk + other / 4)
}

const fileTokens = (files: UserMessage['files']): number =>
  files.reduce((sum, file) => sum + estimateText(file.name) + FILE_OVERHEAD, 0)

const userTokens = (message: UserMessage): number =>
  estimateText(message.content) + fileTokens(message.files) + MESSAGE_OVERHEAD

/** 历史请求只回传正文与阅读链接，思考、搜索结果和工具块不计入。 */
const replyTokens = (message: AssistantMessage): number => {
  let tokens = estimateText(getReplyText(message)) + MESSAGE_OVERHEAD
  for (const block of message.blocks) {
    if (block.type === 'text') {
      for (const citation of block.citations ?? []) {
        tokens += estimateText(citation.url) + estimateText(citation.title ?? '') + 4
      }
    } else if (block.type === 'server_tool_use') {
      const input = block.input
      if ('url' in input && typeof input.url === 'string') {
        tokens += estimateText(input.url)
      }
    } else if (
      block.type === 'web_fetch_tool_result' &&
      block.content.type === 'web_fetch_result'
    ) {
      tokens +=
        estimateText(block.content.url) +
        estimateText(block.content.content.title ?? '') +
        estimateText(block.signature ?? '') +
        estimateText(block.content.content.source.data) +
        8
    }
  }
  return tokens
}

/** 单轮（提问 + 回复）在请求里的 token 占用；不含 system 开销。 */
export const estimateRoundTokens = ([user, reply]: [UserMessage, AssistantMessage]): number =>
  userTokens(user) + replyTokens(reply)

const roundsTokens = (rounds: [UserMessage, AssistantMessage][]): number =>
  rounds.reduce((sum, [user, reply]) => sum + userTokens(user) + replyTokens(reply), 0)

const sliceAfter = (history: Message[], upToId: string): Message[] => {
  const index = history.findIndex((message) => message.id === upToId)
  return index < 0 ? history : history.slice(index + 1)
}

export type ContextUsage = {
  tokens: number
  /** 是否来自服务端返回的真实 usage；导入的会话没有 usage，只能估算。 */
  exact: boolean
}

/**
 * 估算一次请求的上下文占用。
 * 有压缩记录时按摘要 + 压缩边界之后的轮次估算，避免继续使用压缩前的真实 usage；
 * 没有压缩记录时优先采用最近一条可用回复的 usage，否则按文本估算。
 */
export const estimateContextUsage = (
  history: Message[],
  question?: UserMessage,
  compaction?: SessionCompaction,
  prefix?: AssistantMessage
): ContextUsage => {
  let tokens: number
  let exact = false
  if (compaction) {
    tokens =
      SYSTEM_OVERHEAD +
      estimateText(compaction.summary) +
      roundsTokens(getContextRounds(sliceAfter(history, compaction.upToId)))
  } else {
    const rounds = getContextRounds(history)
    const last = rounds.at(-1)?.[1]
    if (last?.usage) {
      const usage = last.usage
      tokens =
        usage.input_tokens +
        usage.cache_creation_input_tokens +
        usage.cache_read_input_tokens +
        usage.output_tokens
      exact = true
    } else {
      tokens = SYSTEM_OVERHEAD + roundsTokens(rounds)
    }
  }
  if (question) {
    tokens += userTokens(question)
  }
  if (prefix) {
    tokens += replyTokens(prefix)
  }
  return { tokens, exact }
}

export const estimateRoundsUsage = (rounds: [UserMessage, AssistantMessage][]): number =>
  SYSTEM_OVERHEAD + roundsTokens(rounds)

export const estimateSummaryUsage = (
  summary: string,
  kept: [UserMessage, AssistantMessage][]
): number => estimateText(summary) + estimateRoundsUsage(kept)

/** 紧凑展示 token 数：900k、1M、12.3k。 */
export const formatTokenCount = (tokens: number): string => {
  const format = (value: number) => {
    const fixed = value >= 100 ? value.toFixed(0) : value.toFixed(1)
    return fixed.replace(/\.0$/, '')
  }
  if (tokens >= 999_500) {
    return `${format(tokens / 1_000_000)}M`
  }
  if (tokens >= 1_000) {
    return `${format(tokens / 1_000)}k`
  }
  return String(tokens)
}
