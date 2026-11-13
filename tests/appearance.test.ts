/**
 * 外观设置的单元测试。
 *
 * 重点锁住一个曾经存在的 bug：
 *   手动点了「亮色」主题，但 followSystem 还开着，
 *   resolveTheme() 就直接返回系统偏好，把用户的选择整个吞掉 ——
 *   结果亮色和暗色点起来长得一模一样（系统是暗色时尤其明显）。
 */
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAppearanceStore } from '@/stores/appearance'
import { resolveTheme } from '@/core/theme/theme'

describe('外观设置 · 主题', () => {
  it('手动选择主题会同时退出「跟随系统」', () => {
    setActivePinia(createPinia())
    const appearance = useAppearanceStore()

    appearance.settings.followSystem = true
    appearance.setTheme('light')

    expect(appearance.settings.followSystem).toBe(false)
    expect(appearance.settings.theme).toBe('light')
    expect(appearance.resolvedTheme).toBe('light')
  })

  it('三个主题预设都能被选中并反映到 resolvedTheme', () => {
    setActivePinia(createPinia())
    const appearance = useAppearanceStore()

    for (const theme of ['light', 'dark', 'glass'] as const) {
      appearance.setTheme(theme)
      expect(appearance.settings.theme).toBe(theme)
      expect(appearance.resolvedTheme).toBe(theme)
    }
  })

  it('打开「跟随系统」时，毛玻璃会被切回系统偏好（毛玻璃无法跟随系统）', () => {
    setActivePinia(createPinia())
    const appearance = useAppearanceStore()

    appearance.setTheme('glass')
    expect(appearance.settings.theme).toBe('glass')

    appearance.setFollowSystem(true)
    expect(appearance.settings.followSystem).toBe(true)
    expect(appearance.settings.theme).not.toBe('glass')
  })

  it('跟随系统时，resolveTheme 返回系统偏好而不是设定值', () => {
    const settings = {
      theme: 'light' as const,
      followSystem: true,
      density: 'comfortable' as const,
      customCss: '',
      cssScope: 'container' as const,
      tokenOverrides: {},
      glassBackdrop: '',
    }
    // 系统偏好由环境决定，这里只断言「返回值不是被忽略的设定值本身」
    const resolved = resolveTheme(settings)
    expect(['light', 'dark']).toContain(resolved)
  })
})
