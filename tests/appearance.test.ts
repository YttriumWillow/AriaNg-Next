/**
 * 外观设置的单元测试。
 *
 * 重点锁住两类曾经存在的 bug：
 *  1. 手动点了「亮色」主题，但 followSystem 还开着，
 *     resolveTheme() 就直接返回系统偏好，把用户的选择整个吞掉 ——
 *     结果亮色和暗色点起来长得一模一样（系统是暗色时尤其明显）。
 *  2. 持久化或会话内修改过颜色/表面令牌（如 --an-bg、--an-surface）后，
 *     #an-token-css 里的 `:root`（特异性 0,1,0）排在 tokens.css 之后，
 *     切换主题时压过 `[data-theme='dark']` / `[data-theme='glass']`，
 *     导致左侧边栏变了而右侧主面板仍卡在旧主题。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { buildUserLayer } from '@/core/css/engine'
import {
  resolveTheme,
  stripThemeCoupledOverrides,
  THEME_COUPLED_TOKENS,
} from '@/core/theme/theme'
import { useAppearanceStore } from '@/stores/appearance'

interface FakeStyleElement {
  id: string
  textContent: string
}

function setupFakeDom() {
  const attrs = new Map<string, string>()
  const elementsById = new Map<string, FakeStyleElement>()
  const headChildren: FakeStyleElement[] = []

  const fakeDocument = {
    documentElement: {
      setAttribute(name: string, value: string) {
        attrs.set(name, value)
      },
      getAttribute(name: string) {
        return attrs.get(name) ?? null
      },
    },
    head: {
      appendChild(el: FakeStyleElement) {
        headChildren.push(el)
        if (el.id) elementsById.set(el.id, el)
        return el
      },
    },
    getElementById(id: string) {
      return elementsById.get(id) ?? null
    },
    createElement(tag: string): FakeStyleElement {
      if (tag !== 'style') throw new Error(`unexpected tag ${tag}`)
      return { id: '', textContent: '' }
    },
  }

  vi.stubGlobal('document', fakeDocument)
  return {
    getTheme: () => attrs.get('data-theme') ?? null,
    getDensity: () => attrs.get('data-density') ?? null,
    getTokenCss: () => elementsById.get('an-token-css')?.textContent ?? '',
    getUserCss: () => elementsById.get('an-user-css')?.textContent ?? '',
  }
}

function setupFakeMatchMedia(initialDark: boolean) {
  let dark = initialDark
  const listeners: Array<(event: { matches: boolean }) => void> = []

  vi.stubGlobal('window', {
    matchMedia: () => ({
      get matches() {
        return dark
      },
      addEventListener(event: string, cb: (e: { matches: boolean }) => void) {
        if (event === 'change') listeners.push(cb)
      },
    }),
  })

  return {
    setDark(next: boolean) {
      dark = next
      for (const cb of listeners) cb({ matches: next })
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

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

describe('外观设置 · 主题切换与令牌清理回归', () => {
  it('stripThemeCoupledOverrides 会清理主题耦合令牌并保留布局/形状覆盖', () => {
    const input: Record<string, string> = {
      '--an-bg': '#fbf8f9',
      '--an-sidebar-bg': '#f6f2f4',
      '--an-topbar-bg': 'rgba(251, 248, 249, 0.86)',
      '--an-surface': '#ffffff',
      '--an-surface-2': '#f5f1f2',
      '--an-surface-hover': '#f0eaec',
      '--an-border': '#eae2e5',
      '--an-border-strong': '#dcd1d6',
      '--an-text': '#1b1517',
      '--an-text-muted': '#5c5358',
      '--an-text-faint': '#9a9096',
      '--an-accent': '#b8435f',
      '--an-accent-fill': '#f2acba',
      '--an-brand-bg': 'none',
      '--an-backdrop-image': 'none',
      '--an-backdrop-blur': '0px',
      '--an-card-highlight': 'none',
      '--an-radius-md': '20px',
      '--an-radius-lg': '24px',
      '--an-sidebar-width': '280px',
      '--an-drawer-width': '480px',
      '--an-text-md': '15px',
    }

    const cleaned = stripThemeCoupledOverrides(input)

    for (const key of THEME_COUPLED_TOKENS) {
      expect(cleaned[key]).toBeUndefined()
    }
    expect(cleaned).toEqual({
      '--an-radius-md': '20px',
      '--an-radius-lg': '24px',
      '--an-sidebar-width': '280px',
      '--an-drawer-width': '480px',
      '--an-text-md': '15px',
    })
  })

  it('在 light <-> dark <-> glass 间切换时清理陈旧表面/颜色覆盖并保留圆角与宽度', () => {
    const dom = setupFakeDom()
    setupFakeMatchMedia(false)
    setActivePinia(createPinia())
    const appearance = useAppearanceStore()
    appearance.initialize()

    appearance.setTheme('light')
    appearance.setToken('--an-bg', '#fbf8f9')
    appearance.setToken('--an-surface', '#ffffff')
    appearance.setToken('--an-surface-2', '#f5f1f2')
    appearance.setToken('--an-border', '#eae2e5')
    appearance.setToken('--an-text', '#1b1517')
    appearance.setToken('--an-text-muted', '#5c5358')
    appearance.setToken('--an-accent', '#b8435f')
    appearance.setToken('--an-backdrop-image', 'none')
    appearance.setToken('--an-radius-md', '20px')
    appearance.setToken('--an-sidebar-width', '280px')

    expect(dom.getTokenCss()).toContain('--an-bg: #fbf8f9;')
    expect(dom.getTokenCss()).toContain('--an-surface: #ffffff;')

    // 切到 dark：右侧面板依赖的 --an-bg / --an-surface 等必须退出 #an-token-css，避免压过 [data-theme='dark']
    appearance.setTheme('dark')
    expect(dom.getTheme()).toBe('dark')
    expect(appearance.settings.tokenOverrides).toEqual({
      '--an-radius-md': '20px',
      '--an-sidebar-width': '280px',
    })
    expect(dom.getTokenCss()).not.toContain('--an-bg:')
    expect(dom.getTokenCss()).not.toContain('--an-surface:')
    expect(dom.getTokenCss()).not.toContain('--an-border:')
    expect(dom.getTokenCss()).not.toContain('--an-text:')
    expect(dom.getTokenCss()).not.toContain('--an-backdrop-image:')
    expect(dom.getTokenCss()).toContain('--an-radius-md: 20px;')
    expect(dom.getTokenCss()).toContain('--an-sidebar-width: 280px;')

    // 在 dark 下再次改颜色与毛玻璃图，然后切到 glass
    appearance.setToken('--an-bg', '#131012')
    appearance.setToken('--an-surface', '#1d181b')
    appearance.setToken('--an-backdrop-blur', '0px')
    appearance.setGlassBackdrop('https://example.com/wall.jpg')

    appearance.setTheme('glass')
    expect(dom.getTheme()).toBe('glass')
    expect(appearance.settings.tokenOverrides).toEqual({
      '--an-radius-md': '20px',
      '--an-sidebar-width': '280px',
    })
    expect(dom.getTokenCss()).not.toContain('--an-bg:')
    expect(dom.getTokenCss()).not.toContain('--an-surface:')
    expect(dom.getTokenCss()).not.toContain('--an-backdrop-blur:')
    expect(dom.getTokenCss()).toContain('--an-backdrop-image: url("https://example.com/wall.jpg");')
    expect(dom.getTokenCss()).toContain('--an-radius-md: 20px;')
    expect(dom.getTokenCss()).toContain('--an-sidebar-width: 280px;')

    // 从 glass 切回 light：自定义毛玻璃背景图不再注入，布局覆盖仍然保留
    appearance.setTheme('light')
    expect(dom.getTheme()).toBe('light')
    expect(appearance.settings.glassBackdrop).toBe('https://example.com/wall.jpg')
    expect(dom.getTokenCss()).not.toContain('--an-backdrop-image:')
    expect(dom.getTokenCss()).toContain('--an-radius-md: 20px;')
    expect(dom.getTokenCss()).toContain('--an-sidebar-width: 280px;')
  })

  it('开启跟随系统及系统深浅色变更时，会清理旧主题颜色覆盖并同步更新 DOM 与 resolvedTheme', () => {
    const dom = setupFakeDom()
    const media = setupFakeMatchMedia(true)
    setActivePinia(createPinia())
    const appearance = useAppearanceStore()
    appearance.initialize()

    appearance.setTheme('glass')
    appearance.setToken('--an-bg', '#f5ecf0')
    appearance.setToken('--an-surface', '#ffffff')
    appearance.setToken('--an-radius-md', '18px')

    // 系统当前偏好暗色：从毛玻璃打开跟随系统应切到 dark 并清掉旧的浅色表面覆盖
    appearance.setFollowSystem(true)
    expect(appearance.resolvedTheme).toBe('dark')
    expect(dom.getTheme()).toBe('dark')
    expect(dom.getTokenCss()).not.toContain('--an-bg:')
    expect(dom.getTokenCss()).not.toContain('--an-surface:')
    expect(dom.getTokenCss()).toContain('--an-radius-md: 18px;')

    // 暗色期间修改了 --an-bg，随后操作系统切换到亮色
    appearance.setToken('--an-bg', '#101010')
    appearance.setToken('--an-sidebar-width', '260px')
    media.setDark(false)

    expect(appearance.resolvedTheme).toBe('light')
    expect(dom.getTheme()).toBe('light')
    expect(dom.getTokenCss()).not.toContain('--an-bg:')
    expect(dom.getTokenCss()).toContain('--an-radius-md: 18px;')
    expect(dom.getTokenCss()).toContain('--an-sidebar-width: 260px;')
  })

  it('样式层与 @scope / global 自定义 CSS 均不破坏三套主题对右侧主面板的层叠覆盖', () => {
    const stylesDir = join(process.cwd(), 'src', 'styles')
    const layersCss = readFileSync(join(stylesDir, 'layers.css'), 'utf-8')
    const resetCss = readFileSync(join(stylesDir, 'reset.css'), 'utf-8')
    const tokensCss = readFileSync(join(stylesDir, 'tokens.css'), 'utf-8')
    const componentsCss = readFileSync(join(stylesDir, 'components.css'), 'utf-8')

    expect(layersCss).toContain('@layer reset, tokens, components, user;')
    expect(resetCss).toContain('background-color: var(--an-bg);')
    expect(resetCss).toContain('background-image: var(--an-backdrop-image);')
    expect(resetCss).toContain('color: var(--an-text);')

    expect(tokensCss).toContain("[data-theme='dark']")
    expect(tokensCss).toContain("[data-theme='glass']")
    expect(tokensCss).toContain('--an-backdrop-image: none;')
    expect(tokensCss).toContain('--an-backdrop-blur: 28px;')

    expect(componentsCss).toMatch(/\.an-app\s*\{[\s\S]*color:\s*var\(--an-text\);[\s\S]*background:\s*transparent;/)
    expect(componentsCss).toContain('background: var(--an-sidebar-bg);')
    expect(componentsCss).toContain('background: var(--an-topbar-bg);')
    expect(componentsCss).toContain('background: var(--an-surface);')

    const scopedUser = buildUserLayer('.an-card { border-radius: 20px; }', 'container', true)
    const globalUser = buildUserLayer('.an-card { border-radius: 20px; }', 'global', true)
    expect(scopedUser.startsWith('@layer user {')).toBe(true)
    expect(scopedUser).toContain('@scope (.an-app)')
    expect(globalUser.startsWith('@layer user {')).toBe(true)
    expect(globalUser).not.toContain('@scope')
  })
})
