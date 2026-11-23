/**
 * 极简 i18n。
 *
 * 为什么不用 vue-i18n？
 * 这个面板的文案量不大（约 240 条），而引入 vue-i18n 会带来
 * 「按需加载 / 语言包分包 / 编译期消息校验」等一堆额外概念。
 * 现阶段用一个几十行的自实现更直观，也少一个依赖。
 *
 * 需要注意的是：t() 会在渲染时读取 locale 这个 ref，
 * 所以切换语言时组件会自动重新渲染 —— 这是 Vue 响应式的自然结果。
 */

import { computed, ref } from 'vue'
import { loadJson, saveJson, STORAGE_KEYS } from '@/core/storage/persist'
import { en } from './en'
import { zhCN } from './zh-CN'

export type Locale = 'zh-CN' | 'en'

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
]

const messages: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCN,
  en,
}

function normalizeLocale(raw: unknown): Locale {
  return raw === 'en' || raw === 'zh-CN' ? raw : 'zh-CN'
}

/** 当前语言。持久化到 localStorage，并校对是否合法避免坏缓存导致崩溃。 */
const locale = ref<Locale>(normalizeLocale(loadJson<unknown>(STORAGE_KEYS.locale, 'zh-CN')))

if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('lang', locale.value)
}

export function setLocale(next: Locale): void {
  const safe = normalizeLocale(next)
  locale.value = safe
  saveJson(STORAGE_KEYS.locale, safe)
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('lang', safe)
  }
}

/**
 * 翻译一条文案。
 *
 * @param key    形如 'nav.dashboard' 的键
 * @param params 形如 { count: 3 }，文案里用 {count} 占位
 */
export function t(key: string, params?: Record<string, string | number>): string {
  // 找不到就用中文兜底，再找不到就返回 key 本身（便于发现遗漏）
  let text = messages[locale.value]?.[key] ?? zhCN[key] ?? key
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

export function useI18n() {
  return {
    locale: computed(() => locale.value),
    t,
    setLocale,
  }
}
