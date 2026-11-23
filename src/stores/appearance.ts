/**
 * 外观 store：主题、密度、令牌覆盖、自定义 CSS。
 *
 * 这个 store 是「一处可改」原则的落点：
 * 主题切换、令牌调整、自定义 CSS 全部汇聚到同一份设置对象，
 * 最终体现为两层 CSS：
 *   - tokens 层：变量值（主题 + 令牌覆盖）
 *   - user 层：用户的自定义 CSS 规则
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { CustomCssEngine, type CssScope } from '@/core/css/engine'
import type { CssDiagnostic } from '@/core/css/validate'
import {
  applyDensity,
  applyTheme,
  applyTokenOverrides,
  DEFAULT_APPEARANCE,
  prefersDark,
  stripThemeCoupledOverrides,
  type AppearanceSettings,
  type Density,
  type ThemeName,
} from '@/core/theme/theme'
import { loadJson, saveJson, STORAGE_KEYS } from '@/core/storage/persist'

/** 清洗来自 localStorage 的外观设置，防止坏 JSON 或字段类型错误导致启动崩溃。 */
function sanitizeAppearance(raw: unknown): AppearanceSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_APPEARANCE, tokenOverrides: {} }
  }
  const record = raw as Record<string, unknown>

  const theme: ThemeName =
    record.theme === 'light' || record.theme === 'dark' || record.theme === 'glass'
      ? record.theme
      : DEFAULT_APPEARANCE.theme

  const density: Density =
    record.density === 'comfortable' || record.density === 'compact'
      ? record.density
      : DEFAULT_APPEARANCE.density

  const cssScope: CssScope =
    record.cssScope === 'container' || record.cssScope === 'global'
      ? record.cssScope
      : DEFAULT_APPEARANCE.cssScope

  const tokenOverrides: Record<string, string> = {}
  if (record.tokenOverrides && typeof record.tokenOverrides === 'object' && !Array.isArray(record.tokenOverrides)) {
    for (const [key, val] of Object.entries(record.tokenOverrides as Record<string, unknown>)) {
      if (typeof val === 'string') tokenOverrides[key] = val
    }
  }

  return {
    theme,
    followSystem: typeof record.followSystem === 'boolean' ? record.followSystem : DEFAULT_APPEARANCE.followSystem,
    density,
    customCss: typeof record.customCss === 'string' ? record.customCss : DEFAULT_APPEARANCE.customCss,
    cssScope,
    tokenOverrides,
    glassBackdrop: typeof record.glassBackdrop === 'string' ? record.glassBackdrop : DEFAULT_APPEARANCE.glassBackdrop,
  }
}

/** 校验毛玻璃背景图地址，拦截引号、花括号、换行或危险协议引起的 CSS 注入。 */
export function sanitizeBackdropUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/["'()\\{};\r\n]/.test(trimmed)) return null
  if (trimmed.includes('/*') || trimmed.includes('*/')) return null

  const lower = trimmed.toLowerCase()
  const safeScheme =
    lower.startsWith('https://') ||
    lower.startsWith('http://') ||
    lower.startsWith('data:image/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('/')

  return safeScheme ? trimmed : null
}

export const useAppearanceStore = defineStore('appearance', () => {
  const settings = ref<AppearanceSettings>(
    sanitizeAppearance(loadJson<unknown>(STORAGE_KEYS.appearance, {})),
  )

  /** 自定义 CSS 的校验结果。null 表示没问题。 */
  const cssDiagnostic = ref<CssDiagnostic | null>(null)

  /** 自定义 CSS 引擎实例。它内部持有 <style> 元素，不适合放进可序列化状态。 */
  const engine = new CustomCssEngine()
  /** 响应式的系统深色偏好，确保 matchMedia 变化时能同步驱动 resolvedTheme 与回显刷新。 */
  const systemPrefersDark = ref(prefersDark())
  let mediaListenerAttached = false

  /** 实际生效的令牌覆盖（含毛玻璃背景图）。 */
  function effectiveOverrides(): Record<string, string> {
    const overrides = { ...settings.value.tokenOverrides }
    if (resolvedTheme.value === 'glass') {
      const safeUrl = sanitizeBackdropUrl(settings.value.glassBackdrop)
      if (safeUrl) {
        overrides['--an-backdrop-image'] = `url("${safeUrl}")`
      }
    }
    return overrides
  }

  /**
   * 初始化：在应用挂载前调用。
   *
   * 必须在挂载前跑，否则会出现「先亮色闪一下再变暗色」的观感问题。
   */
  function initialize(): void {
    systemPrefersDark.value = prefersDark()
    applyTheme(resolvedTheme.value)
    applyDensity(settings.value.density)
    applyTokenOverrides(effectiveOverrides())

    const result = engine.apply(settings.value.customCss, settings.value.cssScope)
    cssDiagnostic.value = result.diagnostic ?? null

    // 监听系统深浅色切换，让 followSystem 实时响应而无需刷新页面
    if (!mediaListenerAttached && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      mediaListenerAttached = true
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      media.addEventListener?.('change', (event?: MediaQueryListEvent) => {
        const prevResolved = resolvedTheme.value
        systemPrefersDark.value = event ? event.matches : prefersDark()
        if (settings.value.followSystem) {
          const nextResolved = resolvedTheme.value
          if (prevResolved !== nextResolved) {
            // 系统切换深浅色时同样清掉上一套主题的颜色/表面覆盖，避免新主题只变一半
            settings.value.tokenOverrides = stripThemeCoupledOverrides(settings.value.tokenOverrides)
            persist()
          }
          applyTheme(nextResolved)
          applyTokenOverrides(effectiveOverrides())
        }
      })
    }
  }

  function persist(): void {
    saveJson(STORAGE_KEYS.appearance, settings.value)
  }

  /* ---------------- 主题 ---------------- */

  /**
   * 切换主题。
   *
   * ⚠️ 这里必须同时做两件事：
   *  1. 把 followSystem 关掉：
   *     否则系统是暗色、用户点了「亮色」时，followSystem 仍然是 true，
   *     resolveTheme() 会直接返回系统偏好（暗色），把用户的选择整个吞掉。
   *  2. 清理与主题耦合的颜色 / 表面 / 毛玻璃覆盖：
   *     `#an-token-css` 注入在 `tokens.css` 之后，且 `:root` 与 `[data-theme='dark']`
   *     权重相同，如果不清理残留的 `--an-bg` / `--an-surface` 等覆盖，
   *     切主题后会出现「侧边栏变了，右侧主面板还卡在旧主题」的问题；
   *     同时保留圆角、字号、侧栏宽度等结构性自定义。
   */
  function setTheme(theme: ThemeName): void {
    settings.value.theme = theme
    settings.value.followSystem = false
    settings.value.tokenOverrides = stripThemeCoupledOverrides(settings.value.tokenOverrides)
    persist()
    applyTheme(resolvedTheme.value)
    applyTokenOverrides(effectiveOverrides())
  }

  function setFollowSystem(follow: boolean): void {
    const prevResolved = resolvedTheme.value
    systemPrefersDark.value = prefersDark()
    settings.value.followSystem = follow
    // 毛玻璃没法跟随系统（它需要背景图），打开跟随系统时切回系统偏好
    if (follow && settings.value.theme === 'glass') {
      settings.value.theme = systemPrefersDark.value ? 'dark' : 'light'
    }
    const nextResolved = resolvedTheme.value
    if (prevResolved !== nextResolved) {
      settings.value.tokenOverrides = stripThemeCoupledOverrides(settings.value.tokenOverrides)
    }
    persist()
    applyTheme(nextResolved)
    applyTokenOverrides(effectiveOverrides())
  }

  function setDensity(density: Density): void {
    settings.value.density = density
    persist()
    applyDensity(density)
  }

  function setGlassBackdrop(url: string): void {
    settings.value.glassBackdrop = url
    persist()
    applyTokenOverrides(effectiveOverrides())
  }

  /* ---------------- 令牌 ---------------- */

  function setToken(name: string, value: string): void {
    settings.value.tokenOverrides = { ...settings.value.tokenOverrides, [name]: value }
    persist()
    applyTokenOverrides(effectiveOverrides())
  }

  function resetToken(name: string): void {
    const next = { ...settings.value.tokenOverrides }
    delete next[name]
    settings.value.tokenOverrides = next
    persist()
    applyTokenOverrides(effectiveOverrides())
  }

  function resetTokens(): void {
    settings.value.tokenOverrides = {}
    persist()
    applyTokenOverrides(effectiveOverrides())
  }

  /* ---------------- 自定义 CSS ---------------- */

  /**
   * 应用自定义 CSS（实时预览）。
   *
   * CSS 非法时 **不会** 影响当前正在生效的样式 —— 引擎会保留上一份可用的版本，
   * 只把错误信息通过 cssDiagnostic 返回给界面显示。
   */
  function setCustomCss(css: string): void {
    settings.value.customCss = css
    persist()
    const result = engine.apply(css, settings.value.cssScope)
    cssDiagnostic.value = result.diagnostic ?? null
  }

  function setCssScope(scope: CssScope): void {
    settings.value.cssScope = scope
    persist()
    const result = engine.apply(settings.value.customCss, scope)
    cssDiagnostic.value = result.diagnostic ?? null
  }

  function resetCustomCss(): void {
    settings.value.customCss = ''
    persist()
    engine.clear()
    cssDiagnostic.value = null
  }

  /** 恢复出厂外观。 */
  function resetAll(): void {
    settings.value = { ...DEFAULT_APPEARANCE, tokenOverrides: {} }
    persist()
    initialize()
  }

  /** 实际生效的主题。跟随系统时它可能与 settings.theme 不同。 */
  const resolvedTheme = computed<ThemeName>(() => {
    if (settings.value.followSystem && settings.value.theme !== 'glass') {
      return systemPrefersDark.value ? 'dark' : 'light'
    }
    return settings.value.theme
  })

  return {
    settings,
    resolvedTheme,
    cssDiagnostic,
    canScope: engine.canScope,
    initialize,
    setTheme,
    setFollowSystem,
    setDensity,
    setGlassBackdrop,
    setToken,
    resetToken,
    resetTokens,
    setCustomCss,
    setCssScope,
    resetCustomCss,
    resetAll,
  }
})
