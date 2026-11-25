import 'fake-indexeddb/auto'

/**
 * Node 没有浏览器的 localStorage：settings 与 i18n 在模块加载时就会读取它。
 * 必须在导入被测模块之前执行，因此每个测试文件第一行就导入本文件。
 */
const values = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  },
})

/**
 * 构建期由 rspack 的 DefinePlugin 注入的常量；测试环境里直接给一个固定值。
 * 它在 client.ts 中以裸标识符引用，未声明时会落到全局对象上。
 */
;(globalThis as unknown as Record<string, unknown>).__API_ORIGIN__ = 'https://api.deepseek.com'
