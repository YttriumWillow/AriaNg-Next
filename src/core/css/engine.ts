/**
 * 自定义 CSS 引擎。
 *
 * ============================ 为什么要这么设计 ============================
 *
 * AriaNg 时代的做法是：写死一套样式，用户改不了。想改外观只能 fork 项目。
 * 我们要做的是：让用户不改源码、不 fork，也能把面板改成自己顺眼的样子。
 *
 * 但「用户 CSS 覆盖组件样式」这件事有个经典陷阱：
 *
 *   组件层：  .an-card { border-radius: 8px }     → 特异性 (0,1,0)
 *   用户层：  .an-card { border-radius: 20px }    → 特异性 (0,1,0)
 *
 * 两者特异性相同，谁生效取决于**源码顺序**，也就是组件样式写得更晚就赢。
 * 这对用户来说太脆弱了 —— 换个版本、改个文件顺序，用户的样式就"失效"了。
 *
 * 解法是 CSS 原生的**层叠层（@layer）**：
 *
 *   @layer reset, tokens, components, user;
 *
 * 层与层之间的优先级是**先声明的层优先级低**，与选择器特异性完全无关。
 * 于是：
 *   - 用户的 CSS 永远写在 user 层 → 永远赢，不需要 !important
 *   - 组件层内部依然可以自由使用 scoped 隔离，互不干扰
 *
 * 这就是「换主题」和「写自定义 CSS」能共用一套机制的原因：
 * 主题切换 = 换 tokens 层里的变量；自定义 CSS = 往 user 层里加规则。
 *
 * 兼容性：@layer 在 Chrome 99+ / Safari 15.4+ / Firefox 97+ 可用。
 * ==========================================================================
 */

import { detectScopeSupport, validateCss, type CssDiagnostic } from './validate'

/** 作用域模式。 */
export type CssScope = 'container' | 'global'

/** 注入用户 CSS 的 <style> 元素的 id。 */
const USER_STYLE_ID = 'an-user-css'

/**
 * 把用户 CSS 包装成最终要注入的内容。
 *
 * container 模式：用 @scope 把规则限制在 .an-app 容器内，
 *               这样用户的 `body { ... }` 不会影响到面板之外的东西。
 * global 模式：  直接生效。
 *
 * 两种模式都包在 `@layer user` 里，保证优先级最高。
 */
export function buildUserLayer(css: string, scope: CssScope, scopeSupported: boolean): string {
  const body = css.trim()
  if (body === '') return ''

  const effectiveScope: CssScope = scope === 'container' && !scopeSupported ? 'global' : scope
  const inner = effectiveScope === 'container' ? `@scope (.an-app) {\n${body}\n}` : body
  return `@layer user {\n${inner}\n}`
}

export interface ApplyResult {
  ok: boolean
  /** 校验失败时的诊断信息 */
  diagnostic?: CssDiagnostic
  /** 实际生效的作用域（可能因浏览器不支持 @scope 而降级） */
  effectiveScope?: CssScope
}

/**
 * 自定义 CSS 引擎。
 *
 * 用法：
 *   const engine = new CustomCssEngine()
 *   engine.apply('.an-card { border-radius: 20px }', 'container')
 *
 * 特性：
 *  - 编辑即生效（实时预览）：每次 apply 都会立刻更新 <style> 内容
 *  - 出错不破坏现状：CSS 非法时保留上一份可用样式，并返回诊断信息
 *  - 作用域可降级：浏览器不支持 @scope 时自动退回全局，并如实告知
 */
export class CustomCssEngine {
  /** 上一份成功的 CSS 原文（导出/回滚用） */
  private source = ''
  private scope: CssScope = 'container'
  private readonly scopeSupported: boolean

  constructor() {
    this.scopeSupported = detectScopeSupport()
  }

  /** 浏览器是否支持 @scope（影响容器作用域是否可用） */
  get canScope(): boolean {
    return this.scopeSupported
  }

  /** 当前用户 CSS 原文 */
  get css(): string {
    return this.source
  }

  /** 当前作用域设置 */
  get currentScope(): CssScope {
    return this.scope
  }

  /**
   * 应用一段用户 CSS。
   *
   * @param css     用户 CSS 原文
   * @param scope   作用域模式
   */
  apply(css: string, scope: CssScope): ApplyResult {
    const diagnostic = validateCss(css)
    if (diagnostic) {
      // 校验不通过：**不动**当前生效的样式，只把错误报告给调用方
      return { ok: false, diagnostic }
    }

    this.source = css
    this.scope = scope
    this.writeToDocument(buildUserLayer(css, scope, this.scopeSupported))

    return {
      ok: true,
      effectiveScope: scope === 'container' && !this.scopeSupported ? 'global' : scope,
    }
  }

  /** 清空用户 CSS（恢复默认外观）。 */
  clear(): void {
    this.source = ''
    this.writeToDocument('')
  }

  /**
   * 把内容写进 <head> 里的 <style id="an-user-css">。
   *
   * 用 textContent 而不是 createElement('style') 反复增删：
   * 复用同一个元素可以避免浏览器反复解析整棵样式表，实时预览时更顺滑。
   */
  private writeToDocument(content: string): void {
    if (typeof document === 'undefined') return
    let element = document.getElementById(USER_STYLE_ID) as HTMLStyleElement | null
    if (!element) {
      element = document.createElement('style')
      element.id = USER_STYLE_ID
      document.head.appendChild(element)
    }
    element.textContent = content
  }
}
