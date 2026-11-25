import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态、安全审核与上下文压缩 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
  /** 请求是否携带 safety_check.level = high */
  safetyCheck: boolean
  /** 达到阈值时是否在发送前自动压缩上下文 */
  autoCompact: boolean
  /** 上下文上限，单位 token */
  contextLimit: number
  /** 触发压缩的上下文占用阈值，单位 token */
  compactThreshold: number
  /** 压缩后原样保留的最近轮数 */
  compactKeepRounds: number
}

export const DEFAULT_CONTEXT_LIMIT = 1_000_000
export const DEFAULT_COMPACT_THRESHOLD = 900_000
export const DEFAULT_COMPACT_KEEP_ROUNDS = 3
export const MIN_CONTEXT_LIMIT = 8_000
export const MAX_CONTEXT_LIMIT = 4_000_000
export const MAX_COMPACT_KEEP_ROUNDS = 50

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
  safetyCheck: 'chat-demo:safety-check',
  autoCompact: 'chat-demo:auto-compact',
  contextLimit: 'chat-demo:context-limit',
  compactThreshold: 'chat-demo:compact-threshold',
  compactKeepRounds: 'chat-demo:compact-keep-rounds',
} as const

const read = (key: string) => {
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
    // 存储不可用时只在内存中生效
  }
}

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)))

/** 读取整数设置；缺失或非法时回退默认值，并限制在允许范围内。 */
const readNumber = (key: string, fallback: number, min: number, max: number) => {
  const raw = read(key)
  if (raw === null) {
    return fallback
  }
  const value = Number(raw)
  return Number.isFinite(value) ? clampNumber(value, min, max) : fallback
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

const initialContextLimit = readNumber(
  KEYS.contextLimit,
  DEFAULT_CONTEXT_LIMIT,
  MIN_CONTEXT_LIMIT,
  MAX_CONTEXT_LIMIT
)
/** 阈值必须严格小于上限，避免压缩请求本身超出上下文。 */
const initialCompactThreshold = readNumber(
  KEYS.compactThreshold,
  DEFAULT_COMPACT_THRESHOLD,
  1,
  initialContextLimit - 1
)
const initialCompactKeepRounds = readNumber(
  KEYS.compactKeepRounds,
  DEFAULT_COMPACT_KEEP_ROUNDS,
  0,
  MAX_COMPACT_KEEP_ROUNDS
)

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  // 未保存过时保持原有行为：安全审核与自动压缩都默认开启。
  safetyCheck: read(KEYS.safetyCheck) !== 'false',
  autoCompact: read(KEYS.autoCompact) !== 'false',
  contextLimit: initialContextLimit,
  compactThreshold: initialCompactThreshold,
  compactKeepRounds: initialCompactKeepRounds,
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setSafetyCheck = (safetyCheck: boolean) => {
  write(KEYS.safetyCheck, String(safetyCheck))
  useSettings.setState({ safetyCheck })
}

export const setAutoCompact = (autoCompact: boolean) => {
  write(KEYS.autoCompact, String(autoCompact))
  useSettings.setState({ autoCompact })
}

/** 调整上限时同步收敛阈值，保证阈值始终小于上限。 */
export const setContextLimit = (value: number) => {
  const contextLimit = clampNumber(value, MIN_CONTEXT_LIMIT, MAX_CONTEXT_LIMIT)
  const { compactThreshold } = useSettings.getState()
  const nextThreshold = Math.min(compactThreshold, contextLimit - 1)
  write(KEYS.contextLimit, String(contextLimit))
  if (nextThreshold !== compactThreshold) {
    write(KEYS.compactThreshold, String(nextThreshold))
  }
  useSettings.setState({ contextLimit, compactThreshold: nextThreshold })
}

export const setCompactThreshold = (value: number) => {
  const { contextLimit } = useSettings.getState()
  const compactThreshold = clampNumber(value, 1, contextLimit - 1)
  write(KEYS.compactThreshold, String(compactThreshold))
  useSettings.setState({ compactThreshold })
}

export const setCompactKeepRounds = (value: number) => {
  const compactKeepRounds = clampNumber(value, 0, MAX_COMPACT_KEEP_ROUNDS)
  write(KEYS.compactKeepRounds, String(compactKeepRounds))
  useSettings.setState({ compactKeepRounds })
}

/** 恢复安全审核与上下文压缩的默认值。 */
export const resetContextSettings = () => {
  write(KEYS.safetyCheck, null)
  write(KEYS.autoCompact, null)
  write(KEYS.contextLimit, null)
  write(KEYS.compactThreshold, null)
  write(KEYS.compactKeepRounds, null)
  useSettings.setState({
    safetyCheck: true,
    autoCompact: true,
    contextLimit: DEFAULT_CONTEXT_LIMIT,
    compactThreshold: DEFAULT_COMPACT_THRESHOLD,
    compactKeepRounds: DEFAULT_COMPACT_KEEP_ROUNDS,
  })
}
