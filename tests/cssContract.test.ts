/**
 * CSS 契约测试。
 *
 * 这里防的是一类很隐蔽的错误：**BEM 修饰类挂错了元素**。
 *
 * 例如开关曾经写成：
 *   <span class="an-switch__track" :class="{ 'an-switch--on': on }" />
 * 而 CSS 写的是：
 *   .an-switch--on .an-switch__track { ... }
 *
 * 这是一条**后代选择器**，永远不会匹配元素自身 ——
 * 于是「开」的样式从来没生效过，而代码看上去完全正常。
 *
 * 这类问题无法用单元测试覆盖（它发生在 CSS 匹配阶段），
 * 所以这里退而求其次：检查模板里修饰类的绑定位置。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')

/** 读取所有 .vue 文件的源码。 */
function readVueSources(): { file: string; source: string }[] {
  const files: { file: string; source: string }[] = []

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.vue')) {
        files.push({ file: full.replace(`${SRC}\\`, ''), source: readFileSync(full, 'utf-8') })
      }
    }
  }

  walk(SRC)
  return files
}

describe('CSS 契约：BEM 修饰类必须挂在「块」上', () => {
  it('an-switch--on 不能挂在 .an-switch__track 元素上', () => {
    const offenders: string[] = []

    for (const { file, source } of readVueSources()) {
      // 找出所有同时带有 an-switch__track 的标签，检查它上面有没有 an-switch--on
      const tagPattern = /<(span|div|label|input|button)\b[^>]*>/g
      for (const match of source.matchAll(tagPattern)) {
        const tag = match[0]
        if (tag.includes('an-switch__track') && tag.includes('an-switch--on')) {
          offenders.push(`${file}: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`)
        }
      }
    }

    expect(
      offenders,
      `修饰类挂在了元素上（后代选择器不会匹配自身）：\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('开关的修饰类绑定在 .an-switch 块上', () => {
    const files = readVueSources()
    const withSwitch = files.filter((f) => f.source.includes('an-switch__track'))

    expect(withSwitch.length, '应该至少有一个使用开关的视图').toBeGreaterThan(0)

    for (const { file, source } of withSwitch) {
      // .an-switch 与 an-switch--on 必须出现在同一个开标签里
      const ok = /<label\b[^>]*class="[^"]*\ban-switch\b[^"]*"[^>]*:class="\{[^}]*an-switch--on/.test(source)
      expect(ok, `${file} 里开关的 an-switch--on 应该绑在 .an-switch 块元素上`).toBe(true)
    }
  })

  it('自定义 CSS 引擎不会把用户样式写进组件层', () => {
    const raw = readFileSync(join(SRC, 'styles', 'components.css'), 'utf-8')

    // 先去掉注释（注释里会提到 !important 这个词）
    let css = raw.replace(/\/\*[\s\S]*?\*\//g, '')

    // prefers-reduced-motion 块是例外：
    // 「尊重系统的减少动效设置」必须用 !important 才能压过其它动效规则，这是无障碍标准做法
    css = css.replace(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\s*\}/g, '')

    expect(css, '组件层不应出现 !important（优先级由 @layer 保证）').not.toMatch(/!\s*important/)
  })
})
