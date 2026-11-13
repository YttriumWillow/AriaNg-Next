/**
 * 格式化工具的单元测试。
 * 单位换算与空值处理是最容易「看起来对其实错」的地方，所以要测。
 */
import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration, formatEta, formatPercent, formatRelativeTime, formatSpeed } from '@/core/model/format'

describe('formatBytes', () => {
  it('0 与负数显示为 0 B', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-1)).toBe('0 B')
  })

  it('按 1024 进制换算', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB')
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB')
  })

  it('小数位可调', () => {
    expect(formatBytes(1536, 2)).toBe('1.50 KB')
  })
})

describe('formatSpeed', () => {
  it('带 /s 后缀', () => {
    expect(formatSpeed(1024)).toBe('1.0 KB/s')
    expect(formatSpeed(0)).toBe('0 B/s')
  })
})

describe('formatPercent', () => {
  it('把 0~1 转成百分比', () => {
    expect(formatPercent(0.5)).toBe('50%')
    expect(formatPercent(0.333333)).toBe('33%')
    expect(formatPercent(0.5, 1)).toBe('50.0%')
  })
})

describe('formatEta', () => {
  it('未知时间显示为破折号', () => {
    expect(formatEta(null)).toBe('—')
    expect(formatEta(-1)).toBe('—')
  })

  it('小于一分钟只显示秒', () => {
    expect(formatEta(42)).toBe('42s')
  })

  it('分钟级', () => {
    expect(formatEta(125)).toBe('2m 05s')
  })

  it('小时级', () => {
    expect(formatEta(3725)).toBe('1h 02m')
  })
})

describe('formatDuration', () => {
  it('毫秒转成可读时长', () => {
    expect(formatDuration(60000)).toBe('1m 00s')
    expect(formatDuration(0)).toBe('—')
  })
})

describe('formatRelativeTime', () => {
  it('刚刚', () => {
    expect(formatRelativeTime(1_000_000, 1_000_000)).toBe('刚刚')
  })

  it('分钟前', () => {
    expect(formatRelativeTime(1_000_000 - 3 * 60_000, 1_000_000)).toBe('3 分钟前')
  })
})
