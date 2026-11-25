import './setup.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_SYSTEM_PROMPT, buildSystemPrompt } from '../src/services/chat/prompt.js'
import { toRequestMessages } from '../src/services/chat/reply.js'
import type { AssistantMessage, UserMessage } from '../src/services/chat/types.js'
import {
  activePartner,
  addPartner,
  removePartner,
  setActivePartner,
  updatePartner,
  usePartners,
} from '../src/services/partners.js'

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

test('默认系统提示词', () => {
  assert.equal(DEFAULT_SYSTEM_PROMPT, '你是由深度求索公司创建的Deepseek人工智能助手。')
  assert.equal(buildSystemPrompt(), DEFAULT_SYSTEM_PROMPT)
})

test('搭档的系统提示词优先，留空时回退默认', () => {
  assert.equal(buildSystemPrompt(undefined, { systemPrompt: '  你是代码搭档  ' }), '你是代码搭档')
  assert.equal(buildSystemPrompt(undefined, { systemPrompt: '   ' }), DEFAULT_SYSTEM_PROMPT)
})

test('压缩摘要追加在搭档提示词之后', () => {
  const prompt = buildSystemPrompt('旧摘要', { systemPrompt: '你是代码搭档' })
  assert.match(prompt, /^你是代码搭档/)
  assert.match(prompt, /<context_summary>\n旧摘要\n<\/context_summary>/)
})

test('搭档的新增、编辑、删除与选中', () => {
  const partner = addPartner()
  assert.equal(usePartners.getState().partners.length, 1)

  updatePartner(partner.id, { name: '代码搭档', systemPrompt: '你是代码搭档', phi: '别写注释' })
  const saved = usePartners.getState().partners[0]
  assert.equal(saved?.name, '代码搭档')
  assert.equal(saved?.systemPrompt, '你是代码搭档')

  setActivePartner(partner.id)
  assert.equal(activePartner()?.id, partner.id)

  removePartner(partner.id)
  assert.equal(usePartners.getState().partners.length, 0)
  // 删除当前搭档后自动取消选中
  assert.equal(usePartners.getState().activeId, null)
  assert.equal(activePartner(), undefined)
})

test('未选中搭档时 activePartner 为空', () => {
  setActivePartner(null)
  assert.equal(activePartner(), undefined)
})

test('历史后指令位于历史之后、提问之前', () => {
  const history = [user('u1', '第一个问题'), reply('a1', '第一个回答')]
  const question = user('u2', '第二个问题')
  const messages = toRequestMessages(history, question, undefined, false, undefined, '别写注释')

  assert.deepEqual(
    messages.map((message) => message.role),
    ['user', 'assistant', 'latest_reminder', 'user']
  )
  assert.deepEqual(messages[2], { role: 'latest_reminder', content: '别写注释' })
  assert.equal(messages.at(-1)?.content, '第二个问题')
})

test('没有历史后指令时不插入额外消息', () => {
  const messages = toRequestMessages([], user('u1', '问题'), undefined, false, undefined, '   ')
  assert.deepEqual(
    messages.map((message) => message.role),
    ['user']
  )
})
