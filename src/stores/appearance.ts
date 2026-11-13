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
  resolveTheme,
  type AppearanceSettings,
  type Density,
  type ThemeName,
} from '@/core/theme/theme'
import { loadJson, saveJson, STORAGE_KEYS } from '@/core/storage/persist'

export const useAppearanceStore = defineStore('appearance', () => {
  const settings = ref<AppearanceSettings>({
    ...DEFAULT_APPEARANCE,
    ...loadJson<Partial<AppearanceSettings>>(STORAGE_KEYS.appearance, {}),
  })

  /** 自定义 CSS 的校验结果。null 表示没问题。 */
  const cssDiagnostic = ref<CssDiagnostic | null>(null)

  /** 自定义 CSS 引擎实例。它内部持有 <style> 元素，不适合放进可序列化状态。 */
  const engine = new CustomCssEngine()

  /** 实际生效的令牌覆盖（含毛玻璃背景图）。 */
  function effectiveOverrides(): Record<string, string> {
    const overrides = { ...settings.value.tokenOverrides }
    if (settings.value.theme === 'glass' && settings.value.glassBackdrop.trim()) {
      overrides['--an-backdrop-image'] = `url("${settings.value.glassBackdrop.trim()}")`
    }
    return overrides
  }

  /**
   * 初始化：在应用挂载前调用。
   *
   * 必须在挂载前跑，否则会出现「先亮色闪一下再变暗色」的观感问题。
   */
  function initialize(): void {
    applyTheme(resolveTheme(settings.value))
    applyDensity(settings.value.density)
    applyTokenOverrides(effectiveOverrides())

    const result = engine.apply(settings.value.customCss, settings.value.cssScope)
    cssDiagnostic.value = result.diagnostic ?? null
  }

  function persist(): void {
    saveJson(STORAGE_KEYS.appearance, settings.value)
  }

  /* ---------------- 主题 ---------------- */

  /**
   * 切换主题。
   *
   * ⚠️ 这里必须同时把 followSystem 关掉。
   *
   * 否则会出现一个很怪的 bug：系统是暗色，用户点了「亮色」，
   * 但 followSystem 仍然是 true，resolveTheme() 会直接返回系统偏好（暗色），
   * 把用户的选择整个吞掉 —— 结果亮色和暗色点起来长得一模一样。
   *
   * 「手动选择」本身就意味着「我不要你替我决定」。
   */
  function setTheme(theme: ThemeName): void {
    settings.value.theme = theme
    settings.value.followSystem = false
    persist()
    applyTheme(resolveTheme(settings.value))
    applyTokenOverrides(effectiveOverrides())
  }

  function setFollowSystem(follow: boolean): void {
    settings.value.followSystem = follow
    // 毛玻璃没法跟随系统（它需要背景图），打开跟随系统时切回系统偏好
    if (follow && settings.value.theme === 'glass') {
      settings.value.theme = prefersDark() ? 'dark' : 'light'
    }
    persist()
    applyTheme(resolveTheme(settings.value))
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
    settings.value = { ...DEFAULT_APPEARANCE }
    persist()
    initialize()
  }

  /** 实际生效的主题。跟随系统时它可能与 settings.theme 不同。 */
  const resolvedTheme = computed(() => resolveTheme(settings.value))

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
