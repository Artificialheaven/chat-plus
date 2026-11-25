import './setup.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { isContextOverflowError } from '../src/services/api/errors.js'
import {
  buildCompactionMessages,
  planCompaction,
  retentionRounds,
  type CompactRound,
} from '../src/services/chat/compact.js'
import { buildSystemPrompt } from '../src/services/chat/prompt.js'
import { compactRetainTokens } from '../src/services/settings.js'
import type { AssistantMessage, UserMessage } from '../src/services/chat/types.js'

const user = (id: string, content: string): UserMessage => ({
  id,
  role: 'user',
  content,
  files: [],
  createdAt: 0,
})

const reply = (id: string, text: string): AssistantMessage => ({
  id,
  role: 'assistant',
  createdAt: 0,
  model: 'deepseek-flash',
  prefix: false,
  status: 'done',
  blocks: [{ type: 'text', text }],
})

const round = (id: string, text: string): CompactRound => [user(`${id}u`, text), reply(`${id}a`, text)]

test('保留尾部按 token 预算而不是轮数', () => {
  const short = round('s', 'hi')
  const long = round('l', 'x'.repeat(4000))
  const rounds = [long, short]

  // 预算只够最后一轮
  assert.equal(retentionRounds(rounds, { retainTokens: 10 }), 1)
  // 预算够两轮
  assert.equal(retentionRounds(rounds, { retainTokens: 1_000_000 }), 2)
})

test('至少保留 minRounds 指定的轮数', () => {
  const rounds = [round('a', 'x'.repeat(4000)), round('b', 'x'.repeat(4000))]
  assert.equal(retentionRounds(rounds, { retainTokens: 0 }), 1)
  assert.equal(retentionRounds(rounds, { retainTokens: 0, minRounds: 2 }), 2)
  assert.equal(retentionRounds(rounds, { retainTokens: 0, minRounds: 0 }), 0)
})

test('全部保留时没有可压缩区间', () => {
  const rounds = [round('a', 'hi'), round('b', 'yo')]
  assert.equal(planCompaction(rounds, { retainTokens: 1_000_000 }), null)
})

test('压缩计划记录边界与轮次', () => {
  const rounds = [round('a', 'hi'), round('b', 'yo')]
  const plan = planCompaction(rounds, { retainTokens: 1 })
  assert.equal(plan?.upToId, 'aa')
  assert.equal(plan?.rounds, 1)
  assert.equal(plan?.kept.length, 1)
})

test('已有摘要时只取边界之后的新轮次', () => {
  const rounds = [round('a', 'hi'), round('b', 'yo'), round('c', 'ok')]
  const plan = planCompaction(rounds, { retainTokens: 1 }, 'aa')
  assert.equal(plan?.rounds, 2)
  assert.equal(plan?.fresh.length, 1)
})

test('压缩请求重放正常消息并追加指令', () => {
  const history = [user('u1', '第一个问题'), reply('a1', '第一个回答'), user('u2', '第二个问题'), reply('a2', '第二个回答')]
  const messages = buildCompactionMessages(history, { upToId: 'a2' })
  assert.equal(messages.length, 5)
  assert.equal(messages.at(-1)?.role, 'user')
  assert.match(String(messages.at(-1)?.content), /compress|压缩/i)
  assert.match(String(messages[0]?.content), /第一个问题/)
})

test('system 复用正式请求的提示词并携带旧摘要', () => {
  assert.match(buildSystemPrompt(), /^该助手为DeepSeek/)
  const withSummary = buildSystemPrompt('旧摘要内容')
  assert.match(withSummary, /<context_summary>/)
  assert.match(withSummary, /旧摘要内容/)
})

test('默认保留预算是上下文上限的 16%', () => {
  assert.equal(compactRetainTokens(), 160_000)
})

test('上下文超限错误识别', async () => {
  const { ApiError } = await import('../src/services/api/client.js')
  const overflow = (message: string, status = 400) => new ApiError('http', message, status)

  assert.equal(isContextOverflowError(overflow("This model's maximum context length is 65536 tokens")), true)
  assert.equal(isContextOverflowError(overflow('prompt is too long')), true)
  assert.equal(isContextOverflowError(overflow('too many input tokens', 413)), true)
  assert.equal(isContextOverflowError(overflow('invalid api key', 401)), false)
  assert.equal(isContextOverflowError(overflow('rate limited', 429)), false)
  assert.equal(isContextOverflowError(overflow('maximum context length', 500)), false)
})
