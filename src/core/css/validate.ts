/**
 * CSS 校验。
 *
 * 目标是：**在把用户 CSS 注入页面之前就知道它是不是坏的**。
 *
 * 浏览器有一个非常好用的工具 —— `CSSStyleSheet.replaceSync()`：
 * 它用的是浏览器自己的 CSS 解析器，语法不合法时会直接抛异常。
 * 所以我们不需要自己写一个 CSS 解析器，借用浏览器的判断力就够了。
 *
 * 但 replaceSync 抛出的异常通常不带行号，所以这里再补一个「括号配平」检查，
 * 用来给用户一个大致定位到行的提示。
 */

/** 校验结果。null 表示没问题。 */
export interface CssDiagnostic {
  /** 给用户看的错误描述 */
  message: string
  /** 出错的大致行号（1 起）。定位不到时为 undefined。 */
  line?: number
}

/**
 * 找出第一个括号不配对的位置。
 * 返回行号（1 起），配平则返回 null。
 *
 * 这是一个「启发式」检查：它不理解 CSS 语法，只是数括号。
 * 但对「少写一个花括号」这种最常见的错误非常有效。
 */
export function findUnbalancedBrace(css: string): number | null {
  let depth = 0
  let line = 1
  let inString: string | null = null
  let inComment = false

  for (let i = 0; i < css.length; i += 1) {
    const char = css[i]
    const next = css[i + 1]

    if (char === '\n') line += 1

    // 跳过注释
    if (inComment) {
      if (char === '*' && next === '/') {
        inComment = false
        i += 1
      }
      continue
    }
    if (char === '/' && next === '*') {
      inComment = true
      i += 1
      continue
    }

    // 跳过字符串
    if (inString) {
      if (char === '\\') {
        i += 1
      } else if (char === inString) {
        inString = null
      }
      continue
    }
    if (char === '"' || char === "'") {
      inString = char
      continue
    }

    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth < 0) return line
    }
  }

  // 结束时还多着开括号 -> 最后一行附近少了闭合
  if (depth > 0) return line
  return null
}

/**
 * 校验一段 CSS。
 *
 * 校验通过返回 null，否则返回诊断信息。
 */
export function validateCss(css: string): CssDiagnostic | null {
  const trimmed = css.trim()
  if (trimmed === '') return null

  // 第一步：括号配平检查。
  //
  // ⚠️ 这里刻意用**原始文本**而不是 trimmed —— 因为行号是给用户看的，
  //    必须和编辑器里看到的行号对得上。如果先 trim 掉前导空行，
  //    报出来的行号就会偏移。
  //
  // 而且这一步要放在浏览器解析之前：括号没配平的 CSS 浏览器也会报错，
  // 但它的报错信息既难看又没有行号。
  const line = findUnbalancedBrace(css)
  if (line !== null) {
    return { message: `括号没有配对，可能在第 ${line} 行附近少了一个 } 或 {`, line }
  }

  // 第二步：借用浏览器的 CSS 解析器做权威判断。
  // 浏览器认识但我们没预料到的语法错误，只有它能发现。
  if (typeof CSS !== 'undefined' && typeof CSSStyleSheet !== 'undefined') {
    try {
      const probe = new CSSStyleSheet()
      probe.replaceSync(trimmed)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // replaceSync 的报错信息通常很长，截断一下更好读
      const short = message.split('\n')[0].slice(0, 200)
      return { message: `浏览器无法解析这段 CSS：${short}` }
    }
  }

  return null
}

/**
 * 检查当前浏览器是否支持 CSS `@scope`。
 *
 * 做法：构造一个只含 @scope 的样式表，然后用浏览器解析它。
 * 如果浏览器不认识 @scope，它会把这个 at-rule 当成未知规则丢弃，
 * 里面的 `.x { ... }` 会变成全局规则 —— 通过解析结果就能分辨出来。
 */
export function detectScopeSupport(): boolean {
  if (typeof CSSStyleSheet === 'undefined') return false
  if (typeof CSSScopeRule === 'undefined') return false
  try {
    const probe = new CSSStyleSheet()
    probe.replaceSync('@scope (.an-app) { .an-probe { color: red } }')
    const rules = Array.from(probe.cssRules)
    return rules.length === 1 && rules[0] instanceof CSSScopeRule
  } catch {
    return false
  }
}
