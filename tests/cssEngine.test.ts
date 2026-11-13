/**
 * 自定义 CSS 引擎的单元测试。
 *
 * 重点验证两件事：
 *  1. 用户 CSS 一定被包进 @layer user（这是「用户样式永远赢」的技术保证）
 *  2. 语法错误能被检出，而不是悄悄地把样式搞崩
 */
import { describe, expect, it } from 'vitest'
import { buildUserLayer } from '@/core/css/engine'
import { findUnbalancedBrace, validateCss } from '@/core/css/validate'

describe('buildUserLayer', () => {
  it('总是包在 @layer user 里 —— 这是优先级高于组件层的保证', () => {
    const output = buildUserLayer('.an-card { border-radius: 20px; }', 'global', true)
    expect(output.startsWith('@layer user {')).toBe(true)
    expect(output.trimEnd().endsWith('}')).toBe(true)
    expect(output).toContain('.an-card { border-radius: 20px; }')
  })

  it('容器作用域时用 @scope 限制在 .an-app 内', () => {
    const output = buildUserLayer('.an-card {}', 'container', true)
    expect(output).toContain('@scope (.an-app)')
    expect(output).toContain('@layer user')
  })

  it('浏览器不支持 @scope 时降级为全局，但依然在 user 层', () => {
    const output = buildUserLayer('.an-card {}', 'container', false)
    expect(output).not.toContain('@scope')
    expect(output.startsWith('@layer user {')).toBe(true)
  })

  it('空 CSS 返回空字符串，不产生空的 style 规则', () => {
    expect(buildUserLayer('   ', 'global', true)).toBe('')
  })
})

describe('findUnbalancedBrace', () => {
  it('配平时返回 null', () => {
    expect(findUnbalancedBrace('.a { color: red; }')).toBeNull()
  })

  it('少一个右括号时定位到行号', () => {
    const css = '.a {\n  color: red;\n'
    expect(findUnbalancedBrace(css)).toBe(3)
  })

  it('忽略字符串和注释里的括号', () => {
    expect(findUnbalancedBrace('.a { content: "}"; }')).toBeNull()
    expect(findUnbalancedBrace('.a { /* } */ color: red; }')).toBeNull()
  })
})

describe('validateCss', () => {
  it('合法 CSS 通过', () => {
    expect(validateCss('.an-card { border-radius: 20px; }')).toBeNull()
  })

  it('空内容视为合法', () => {
    expect(validateCss('')).toBeNull()
    expect(validateCss('   \n  ')).toBeNull()
  })

  it('括号不配对会被报出来，并带行号', () => {
    const result = validateCss('.a {\n  color: red;\n')
    expect(result).not.toBeNull()
    expect(result?.line).toBe(3)
  })
})
