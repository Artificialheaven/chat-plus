import { create } from 'zustand'
import { createId } from '../utils/id.js'

/**
 * 搭档：可选的对话角色。选择后，新建对话会带上它的系统提示词与历史后指令，
 * 空对话中展示它的开场白；不选择时使用默认系统提示词。
 */
export type Partner = {
  id: string
  name: string
  /** 系统提示词：作为请求 system 的主体，压缩摘要会追加在它后面 */
  systemPrompt: string
  /** 历史后指令：每次请求追加在历史之后、当前提问之前 */
  phi: string
  /** 开场白：新建对话时的引导语 */
  greeting: string
}

const PARTNERS_KEY = 'chat-demo:partners'
const ACTIVE_KEY = 'chat-demo:partner-active'

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只影响持久化，功能仍可在内存中使用。
  }
}

const normalize = (value: unknown): Partner | null => {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || !item.id) {
    return null
  }
  const text = (key: string) => (typeof item[key] === 'string' ? (item[key] as string) : '')
  return {
    id: item.id,
    name: text('name'),
    systemPrompt: text('systemPrompt'),
    phi: text('phi'),
    greeting: text('greeting'),
  }
}

const readPartners = (): Partner[] => {
  const raw = read(PARTNERS_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.map(normalize).filter((item): item is Partner => item !== null)
      : []
  } catch {
    return []
  }
}

const initialPartners = readPartners()
const initialActive = read(ACTIVE_KEY)

type PartnersState = {
  partners: Partner[]
  /** 当前选中的搭档；null 表示使用默认提示词 */
  activeId: string | null
}

const persist = (state: PartnersState) => {
  write(PARTNERS_KEY, JSON.stringify(state.partners))
  write(ACTIVE_KEY, state.activeId)
  usePartners.setState({ partners: state.partners, activeId: state.activeId })
}

export const usePartners = create<PartnersState>(() => ({
  partners: initialPartners,
  activeId:
    initialActive && initialPartners.some((partner) => partner.id === initialActive)
      ? initialActive
      : null,
}))

/** 当前选中的搭档；未选择或已被删除时返回 undefined。 */
export const activePartner = (): Partner | undefined => {
  const { partners, activeId } = usePartners.getState()
  return activeId ? partners.find((partner) => partner.id === activeId) : undefined
}

export const addPartner = (): Partner => {
  const partner: Partner = {
    id: createId(),
    name: '',
    systemPrompt: '',
    phi: '',
    greeting: '',
  }
  const state = usePartners.getState()
  persist({ ...state, partners: [...state.partners, partner] })
  return partner
}

export const updatePartner = (id: string, patch: Partial<Omit<Partner, 'id'>>) => {
  const state = usePartners.getState()
  persist({
    ...state,
    partners: state.partners.map((partner) =>
      partner.id === id ? { ...partner, ...patch } : partner
    ),
  })
}

export const removePartner = (id: string) => {
  const state = usePartners.getState()
  persist({
    partners: state.partners.filter((partner) => partner.id !== id),
    activeId: state.activeId === id ? null : state.activeId,
  })
}

/** 选择搭档；传 null 表示改用默认提示词。 */
export const setActivePartner = (id: string | null) => {
  const state = usePartners.getState()
  persist({
    ...state,
    activeId: id !== null && state.partners.some((partner) => partner.id === id) ? id : null,
  })
}
