/**
 * 主题与设计令牌。
 *
 * 核心思想：**外观只有一处来源 —— CSS 变量。**
 *
 * 主题切换 = 换一组变量值（tokens 层）
 * 自定义 CSS = 在 user 层追加规则（见 src/core/css/engine.ts）
 *
 * 两者共用同一套 --an-* 变量，所以用户改了令牌，主题和自定义 CSS 都会跟着变，
 * 不会出现「主题是一套、自定义是另一套」的割裂感。
 */

import type { CssScope } from '../css/engine'

/** 主题名。glass 是可选的第三主题，需要背景图才好看。 */
export type ThemeName = 'light' | 'dark' | 'glass'

export interface ThemeDefinition {
  name: ThemeName
  label: string
  description: string
  /** 主题预览用的主色 */
  accent: string
  /** 是否需要跟随系统（毛玻璃依赖背景图，不能自动跟随） */
  supportsAuto: boolean
}

export const THEMES: ThemeDefinition[] = [
  {
    name: 'light',
    label: '亮色 Light',
    description: '默认 · 白天 / 文档场景',
    accent: '#2f6f5e',
    supportsAuto: true,
  },
  {
    name: 'dark',
    label: '暗色 Dark',
    description: '默认 · 夜间 / NAS 常驻大屏',
    accent: '#4fb39a',
    supportsAuto: true,
  },
  {
    name: 'glass',
    label: '毛玻璃 Glass',
    description: '可选 · 半透明 / 桌面环境',
    accent: '#7fb6d6',
    supportsAuto: false,
  },
]

/** 界面密度。紧凑模式适合任务数量多的场景。 */
export type Density = 'comfortable' | 'compact'

/** 外观设置。整份对象会被持久化到 localStorage。 */
export interface AppearanceSettings {
  /** 当前主题 */
  theme: ThemeName
  /** 是否跟随系统（只在 light / dark 之间跟随，glass 始终手动） */
  followSystem: boolean
  density: Density
  /** 用户自定义 CSS 原文 */
  customCss: string
  /** 自定义 CSS 的作用域 */
  cssScope: CssScope
  /** 令牌覆盖：变量名 -> 值 */
  tokenOverrides: Record<string, string>
  /** 毛玻璃主题的背景图地址 */
  glassBackdrop: string
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'light',
  followSystem: true,
  density: 'comfortable',
  customCss: '',
  cssScope: 'container',
  tokenOverrides: {},
  glassBackdrop: '',
}

/* ------------------------------------------------------------------ *
 * 可视化编辑的令牌
 * ------------------------------------------------------------------ */

export type TokenType = 'color' | 'length' | 'number'

export interface EditableToken {
  /** CSS 变量名（含 -- 前缀） */
  name: string
  /** 中文标签 */
  label: string
  type: TokenType
  /** 默认值，用于「恢复默认」和输入框占位 */
  defaultValue: string
  group: '颜色' | '形状' | '排版' | '布局'
}

/**
 * 暴露给用户编辑的令牌清单。
 *
 * 刻意只开放一小部分 —— 用户改十几个常用变量就够了，
 * 把全部令牌都暴露出来反而让人无从下手。其余令牌可以在自定义 CSS 里直接写。
 */
export const EDITABLE_TOKENS: EditableToken[] = [
  { name: '--an-accent', label: '主色', type: 'color', defaultValue: '#b8435f', group: '颜色' },
  { name: '--an-accent-fill', label: '品牌填充色', type: 'color', defaultValue: '#f2acba', group: '颜色' },
  { name: '--an-bg', label: '页面背景', type: 'color', defaultValue: '#faf7f8', group: '颜色' },
  { name: '--an-surface', label: '卡片表面', type: 'color', defaultValue: '#ffffff', group: '颜色' },
  { name: '--an-border', label: '描边', type: 'color', defaultValue: '#eae2e5', group: '颜色' },
  { name: '--an-text', label: '正文文字', type: 'color', defaultValue: '#1b1517', group: '颜色' },
  { name: '--an-text-muted', label: '次要文字', type: 'color', defaultValue: '#5c5358', group: '颜色' },
  { name: '--an-radius-md', label: '圆角', type: 'length', defaultValue: '10px', group: '形状' },
  { name: '--an-radius-lg', label: '大圆角', type: 'length', defaultValue: '14px', group: '形状' },
  { name: '--an-text-md', label: '正文字号', type: 'length', defaultValue: '14px', group: '排版' },
  { name: '--an-sidebar-width', label: '侧栏宽度', type: 'length', defaultValue: '232px', group: '布局' },
  { name: '--an-drawer-width', label: '抽屉宽度', type: 'length', defaultValue: '420px', group: '布局' },
]

/* ------------------------------------------------------------------ *
 * 应用主题
 * ------------------------------------------------------------------ */

/**
 * 把主题写到 <html data-theme="..."> 上。
 *
 * CSS 里用 `[data-theme='dark'] { ... }` 覆盖变量，
 * 所以切主题只是换一个属性值 —— **不重建任何 DOM**，页面状态全部保留。
 */
export function applyTheme(theme: ThemeName): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
}

/** 设置界面密度。 */
export function applyDensity(density: Density): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-density', density)
}

/**
 * 决定实际使用哪个主题。
 *
 * 跟随系统时，系统是暗色就用暗色，系统是亮色就用亮色。
 * 毛玻璃主题永远不会被自动选中 —— 它需要背景图，系统给不了。
 */
export function resolveTheme(settings: AppearanceSettings): ThemeName {
  if (settings.followSystem && settings.theme !== 'glass') {
    return prefersDark() ? 'dark' : 'light'
  }
  return settings.theme
}

/** 系统是否偏好暗色。 */
export function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/* ------------------------------------------------------------------ *
 * 令牌覆盖
 * ------------------------------------------------------------------ */

/** 令牌覆盖的 <style> 元素 id。 */
const TOKEN_STYLE_ID = 'an-token-css'

/**
 * 把令牌覆盖打包成 CSS 文本。
 *
 * 放进 `@layer tokens` 是有讲究的：
 *  - 覆盖值和基础令牌在**同一层**，靠源码顺序决定谁赢。
 *    运行时注入的 <style> 排在打包产物的 CSS 之后，所以覆盖生效。
 *  - 令牌层永远排在组件层**之前**，因此组件层里读到的就是被覆盖后的值。
 */
export function buildTokenLayer(overrides: Record<string, string>): string {
  const entries = Object.entries(overrides).filter(([, value]) => value.trim() !== '')
  if (entries.length === 0) return ''

  const body = entries
    .map(([name, value]) => `  ${name}: ${value.trim()};`)
    .join('\n')

  return `@layer tokens {\n  :root {\n${body}\n  }\n}\n`
}

/** 应用令牌覆盖。 */
export function applyTokenOverrides(overrides: Record<string, string>): void {
  if (typeof document === 'undefined') return
  let element = document.getElementById(TOKEN_STYLE_ID) as HTMLStyleElement | null
  if (!element) {
    element = document.createElement('style')
    element.id = TOKEN_STYLE_ID
    document.head.appendChild(element)
  }
  element.textContent = buildTokenLayer(overrides)
}
