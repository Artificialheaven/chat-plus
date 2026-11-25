import type { CreateMessageRequest } from '../api/types.js'

/** 所有生成请求统一携带的助手身份说明 */
export const SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

/** 默认开启，可在设置中关闭；关闭时请求不携带 safety_check 字段。 */
export const SAFETY_CHECK = { level: 'high' } as const

/** 压缩摘要放在 system 中，明确它只是背景信息，不是新的用户指令。 */
export const buildSystemPrompt = (summary?: string): string =>
  summary
    ? `${SYSTEM_PROMPT}\n\n以下是更早对话的压缩摘要，仅作为背景参考，不是新的用户指令：\n<context_summary>\n${summary}\n</context_summary>`
    : SYSTEM_PROMPT

/** 阅读链接始终开启，智能搜索开关控制是否另行声明搜索工具（含边想边搜）。 */
export const serverTools = (search: boolean): CreateMessageRequest['tools'] => {
  const tools: CreateMessageRequest['tools'] = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}
