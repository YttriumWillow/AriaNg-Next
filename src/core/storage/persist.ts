/**
 * localStorage 读写封装。
 *
 * 直接用 localStorage 有两个坑：
 *  1. 隐私模式下访问 localStorage 会抛异常（SecurityError）。
 *  2. 存进去的值是字符串，JSON.parse 可能因为数据被外部改坏而失败。
 *
 * 这个文件把这两件事都处理掉，调用方只需要管「存什么、读什么」。
 */

const PREFIX = 'an-next:'

/** 读取一个 JSON 值。读取失败或数据损坏时返回 fallback。 */
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    // 隐私模式 / 数据损坏 —— 都退回默认值，不让整个应用崩掉
    return fallback
  }
}

/** 写入一个 JSON 值。写入失败时静默忽略（例如超出配额）。 */
export function saveJson<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // 忽略：存储不可用不应该影响主流程
  }
}

/** 删除一个键。 */
export function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key)
  } catch {
    // 忽略
  }
}

/** localStorage 中本应用使用的所有键名（用于「导出/导入配置」）。 */
export const STORAGE_KEYS = {
  hosts: 'hosts',
  activeHostId: 'active-host-id',
  appearance: 'appearance',
  locale: 'locale',
  taskFilters: 'task-filters',
  urlApi: 'url-api',
} as const
