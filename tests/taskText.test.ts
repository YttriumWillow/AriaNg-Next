/**
 * 任务显示文案与名称解析的单元测试。
 *
 * 这里锁的三个规则，都是真实 Firefox 实测时发现的界面问题：
 *
 *  1. resolveName 的 URI 兜底
 *     —— HTTP 403 的任务，files[0].path 是空字符串，
 *        界面上原本只能显示一串无法辨认的 GID。
 *
 *  2. taskStatusText / taskProgressText 的「错误优先」
 *     —— DASH 直播流因服务端超出保留窗口失败（status=error），
 *        但 media.state 依然是 downloading，界面会误显示「下载中」。
 *
 *  3. mediaStateI18nKey 的匹配顺序
 *     —— downloadingMetadata 同时含 metadata 和 downloading，
 *        顺序错了会翻译成「下载中」而不是「获取元数据」。
 */
import { describe, expect, it } from 'vitest'
import { normalizeTask, resolveName, taskProgressText, taskStatusText } from '@/core/model/task'
import { mediaStateI18nKey } from '@/core/model/format'
import type { Aria2TaskStatus } from '@/core/rpc/types'

/** 构造一个带默认值的任务状态。 */
function makeStatus(overrides: Partial<Aria2TaskStatus> = {}): Aria2TaskStatus {
  return {
    gid: '2089b05ecca3d829',
    status: 'active',
    totalLength: '1000',
    completedLength: '250',
    uploadLength: '0',
    downloadSpeed: '100',
    uploadSpeed: '0',
    dir: '/downloads',
    ...overrides,
  }
}

/** 一个假翻译函数：直接把 key 变成 `t:<key>`，方便断言。 */
const t = (key: string) => `t:${key}`

describe('resolveName', () => {
  it('优先用任务自带的 name', () => {
    const raw = makeStatus({ name: 'Sintel.mp4' })
    expect(resolveName(raw)).toBe('Sintel.mp4')
  })

  it('没有 name 时用文件路径的最后一段', () => {
    const raw = makeStatus({
      files: [{ index: '1', path: 'F:\\Project\\dl\\movie.mp4', length: '1', completedLength: '0', selected: 'true' }],
    })
    expect(resolveName(raw)).toBe('movie.mp4')
  })

  it('文件路径为空时退回 URI 的最后一段', () => {
    // 这正是 HTTP 403 任务的真实形状：path 是空串，但 uris 里还有源地址
    const raw = makeStatus({
      status: 'error',
      files: [{
        index: '1',
        path: '',
        length: '0',
        completedLength: '0',
        selected: 'true',
        uris: [{ uri: 'https://mirrors.aliyun.com/ubuntu/ls-lR.gz', status: 'used' }],
      }],
    })
    expect(resolveName(raw)).toBe('ls-lR.gz')
  })

  it('URI 带查询串时只取路径部分', () => {
    const raw = makeStatus({
      files: [{
        index: '1',
        path: '',
        length: '0',
        completedLength: '0',
        selected: 'true',
        uris: [{ uri: 'https://speed.cloudflare.com/__down?bytes=1048576', status: 'used' }],
      }],
    })
    expect(resolveName(raw)).toBe('__down')
  })

  it('ed2k 链接取 |file| 段里的名字', () => {
    const raw = makeStatus({
      files: [{
        index: '1',
        path: '',
        length: '0',
        completedLength: '0',
        selected: 'true',
        uris: [{ uri: 'ed2k://|file|eMule0.49c.zip|2868871|0F88EEFA9D8AD3F43DABAC9982D2450C|/', status: 'used' }],
      }],
    })
    expect(resolveName(raw)).toBe('eMule0.49c.zip')
  })

  it('magnet 链接取 dn 参数', () => {
    const raw = makeStatus({
      files: [{
        index: '1',
        path: '',
        length: '0',
        completedLength: '0',
        selected: 'true',
        uris: [{ uri: 'magnet:?xt=urn:btih:abc123&dn=Tears%20of%20Steel', status: 'used' }],
      }],
    })
    expect(resolveName(raw)).toBe('Tears of Steel')
  })

  it('实在什么都没有才退回 GID', () => {
    expect(resolveName(makeStatus({ gid: 'deadbeef' }))).toBe('deadbeef')
  })
})

describe('mediaStateI18nKey', () => {
  it('常见状态词能被翻译', () => {
    expect(mediaStateI18nKey('downloading')).toBe('media.downloading')
    expect(mediaStateI18nKey('recording')).toBe('media.recording')
    expect(mediaStateI18nKey('complete')).toBe('media.complete')
  })

  it('downloadingMetadata 要翻译成「获取元数据」而不是「下载中」', () => {
    // 这是匹配顺序的关键用例：metadata 必须排在 download 前面
    expect(mediaStateI18nKey('downloadingMetadata')).toBe('media.metadata')
  })

  it('未知状态回落到 unknown', () => {
    expect(mediaStateI18nKey('somethingNew')).toBe('media.unknown')
    expect(mediaStateI18nKey('')).toBe('media.unknown')
  })
})

describe('任务状态文案', () => {
  it('出错的任务显示错误，而不是媒体阶段', () => {
    // DASH 直播流失败的真实形状：status=error，media.state 仍是 downloading
    const task = normalizeTask(makeStatus({
      status: 'error',
      errorCode: '1',
      errorMessage: 'Live media left the server\'s retention window',
      media: { state: 'downloading', protocol: 'dash', live: true } as never,
    }))

    expect(taskStatusText(task, t)).toBe('t:status.error')
    expect(taskProgressText(task, t)).toBe('t:status.error')
  })

  it('正常的媒体任务显示自己的阶段', () => {
    const task = normalizeTask(makeStatus({
      media: { state: 'recording', protocol: 'dash', live: true } as never,
    }))

    expect(taskStatusText(task, t)).toBe('t:media.recording')
  })

  it('非媒体任务用通用状态键', () => {
    const task = normalizeTask(makeStatus({ status: 'waiting' }))
    expect(taskStatusText(task, t)).toBe('t:status.waiting')
  })

  it('直播媒体任务的进度文案是「下载中」', () => {
    const task = normalizeTask(makeStatus({
      media: { state: 'downloading', protocol: 'hls', live: true } as never,
    }))
    expect(taskProgressText(task, t)).toBe('t:status.active')
  })

  it('普通任务显示百分比', () => {
    const task = normalizeTask(makeStatus({ totalLength: '1000', completedLength: '250' }))
    expect(taskProgressText(task, t)).toBe('25%')
  })
})
