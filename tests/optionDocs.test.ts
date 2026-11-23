/**
 * 全局选项中文文档与搜索匹配测试。
 *
 * 保护两件事：
 *  1. 常用 aria2 / aria2-next 全局选项词条齐全、非空且不污染 Object 原型键。
 *  2. 搜索过滤不仅匹配英文键名和取值，也能命中中文短标题与中文详细说明。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { GLOBAL_OPTION_DOCS, getGlobalOptionDoc, matchesGlobalOption } from '@/core/model/optionDocs'

describe('GLOBAL_OPTION_DOCS 词典', () => {
  it('覆盖 120 项以上 aria2 与 aria2-next 常用全局选项且文案完整', () => {
    const entries = Object.entries(GLOBAL_OPTION_DOCS)
    expect(entries.length).toBeGreaterThanOrEqual(120)

    for (const [key, doc] of entries) {
      expect(key.trim(), '选项键名不应为空').toBe(key)
      expect(doc.label.trim().length, `${key} 缺少中文短标题`).toBeGreaterThan(0)
      expect(doc.description.trim().length, `${key} 缺少中文说明`).toBeGreaterThan(0)
    }
  })

  it('core/model/optionDocs.ts 保持零框架依赖（不引入 vue / pinia / vue-router）', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'core', 'model', 'optionDocs.ts'), 'utf-8')
    expect(source).not.toMatch(/from\s+['"](?:vue|pinia|vue-router)['"]/)
  })

  it('支持查询所有核心全局选项', () => {
    const coreKeys = [
      'max-concurrent-downloads',
      'split',
      'max-overall-download-limit',
      'dir',
      'enable-dht',
      'seed-ratio',
      'user-agent',
      'all-proxy',
    ]

    for (const key of coreKeys) {
      const doc = getGlobalOptionDoc(key)
      expect(doc, `${key} 应有中文文档`).not.toBeNull()
      expect(doc?.label).toBeTruthy()
      expect(doc?.description).toBeTruthy()
    }
  })

  it('覆盖 BT / Metalink / ED2K / Media / RPC 与会话选项', () => {
    const extendedKeys = [
      'bt-enable-lpd',
      'bt-require-crypto',
      'follow-metalink',
      'ed2k-listen-port',
      'media-format',
      'rpc-listen-port',
      'save-session',
      'state-dir',
    ]

    for (const key of extendedKeys) {
      expect(getGlobalOptionDoc(key), `${key} 应有文档条目`).not.toBeNull()
    }
  })

  it('对大小写、前后空格、未知键和原型链属性保持安全处理', () => {
    expect(getGlobalOptionDoc('  SPLIT  ')?.label).toBe(GLOBAL_OPTION_DOCS.split.label)
    expect(getGlobalOptionDoc('')).toBeNull()
    expect(getGlobalOptionDoc('   ')).toBeNull()
    expect(getGlobalOptionDoc('unknown-future-option')).toBeNull()
    expect(getGlobalOptionDoc('toString')).toBeNull()
    expect(getGlobalOptionDoc('constructor')).toBeNull()
    expect(getGlobalOptionDoc('__proto__')).toBeNull()
  })
})

describe('matchesGlobalOption 搜索匹配', () => {
  it('空关键词或纯空白匹配全部选项', () => {
    expect(matchesGlobalOption('dir', '/downloads', '')).toBe(true)
    expect(matchesGlobalOption('custom-unknown', '123', '   ')).toBe(true)
  })

  it('支持按英文键名与当前值（忽略大小写）匹配', () => {
    expect(matchesGlobalOption('max-concurrent-downloads', '5', 'CONCURRENT')).toBe(true)
    expect(matchesGlobalOption('dir', '/Downloads/ISO', 'iso')).toBe(true)
    expect(matchesGlobalOption('user-agent', 'aria2-next/3.1.0', 'ARIA2-NEXT')).toBe(true)
  })

  it('支持按中文短标题检索', () => {
    expect(matchesGlobalOption('max-concurrent-downloads', '5', '同时下载')).toBe(true)
    expect(matchesGlobalOption('max-overall-download-limit', '0', '全局最大下载限速')).toBe(true)
    expect(matchesGlobalOption('seed-ratio', '1.0', '分享率')).toBe(true)
    expect(matchesGlobalOption('all-proxy', '', '全局代理')).toBe(true)
  })

  it('支持按中文详细说明正文检索（不依赖标题和键名命中）', () => {
    // 「分布式哈希表」仅出现在 enable-dht 的 description 中
    expect(matchesGlobalOption('enable-dht', 'true', '分布式哈希表')).toBe(true)
    // 「运营商」仅出现在 bt-require-crypto 的 description 中
    expect(matchesGlobalOption('bt-require-crypto', 'false', '运营商')).toBe(true)
    // 说明里的英文术语同样忽略大小写命中
    expect(matchesGlobalOption('continue', 'true', 'range')).toBe(true)
  })

  it('不命中时返回 false（含未收录的自定义选项）', () => {
    expect(matchesGlobalOption('split', '16', '做种分享率')).toBe(false)
    expect(matchesGlobalOption('custom-unknown-option', 'value', '限速')).toBe(false)
  })
})
