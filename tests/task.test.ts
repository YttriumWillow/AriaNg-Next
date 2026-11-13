/**
 * 任务模型与排序的单元测试。
 *
 * 这些测试的价值在于：它们锁死了 aria2 那套「字符串数字」约定。
 * 以后谁改动 normalizeTask，第一个挂的就是这里的用例。
 */
import { describe, expect, it } from 'vitest'
import {
  computeEta,
  computeProgress,
  inferProtocol,
  normalizeTask,
  resolveName,
  toBool,
  toNumber,
} from '@/core/model/task'
import { sortTasks } from '@/core/model/sort'
import type { Aria2TaskStatus } from '@/core/rpc/types'

/** 构造一个带默认值的任务状态，省得每个用例都写全 20 个字段。 */
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

describe('toNumber', () => {
  it('把 aria2 的字符串数字转成 number', () => {
    expect(toNumber('1048576')).toBe(1048576)
  })

  it('空值与非法值一律当作 0，不让 NaN 漏到界面', () => {
    expect(toNumber('')).toBe(0)
    expect(toNumber(undefined)).toBe(0)
    expect(toNumber(null)).toBe(0)
    expect(toNumber('abc')).toBe(0)
  })
})

describe('toBool', () => {
  it('兼容字符串与原生布尔两种表示', () => {
    expect(toBool('true')).toBe(true)
    expect(toBool('false')).toBe(false)
    expect(toBool(true)).toBe(true)
    expect(toBool('1')).toBe(true)
    expect(toBool('')).toBe(false)
    expect(toBool(undefined)).toBe(false)
  })
})

describe('inferProtocol', () => {
  it('扩展对象优先于链接特征', () => {
    const status = makeStatus({
      media: {
        state: 'downloading',
        protocol: 'hls',
        live: 'false',
        duration: '60000',
        completedDuration: '20000',
        downloadedLength: '4194304',
        progress: '0.333333',
        lengthKnown: 'true',
        tracks: [],
        error: '',
        errorCode: '',
      },
    })
    expect(inferProtocol(status)).toBe('hls')
  })

  it('DASH 媒体识别为 dash', () => {
    const status = makeStatus({
      media: {
        state: 'downloading',
        protocol: 'dash',
        live: 'false',
        duration: '60000',
        completedDuration: '0',
        downloadedLength: '0',
        progress: '0',
        lengthKnown: 'true',
        tracks: [],
        error: '',
        errorCode: '',
      },
    })
    expect(inferProtocol(status)).toBe('dash')
  })

  it('ed2k 扩展对象识别为 ed2k', () => {
    const status = makeStatus({
      ed2k: {
        hash: 'h',
        name: 'n',
        length: '0',
        completedLength: '0',
        partHashCount: '0',
        peerCount: '0',
        queuedPeerCount: '0',
        acceptedPeerCount: '0',
        deadPeerCount: '0',
        lowIdPeerCount: '0',
        callbackWaitingPeerCount: '0',
        sharingTime: '0',
        corruptPartCount: '0',
      },
    })
    expect(inferProtocol(status)).toBe('ed2k')
  })

  it('没有扩展对象时看 magnet 链接', () => {
    const status = makeStatus({
      files: [{ index: '0', path: '/d/x', length: '0', completedLength: '0', selected: 'true', uris: [{ uri: 'magnet:?xt=urn:btih:abc', status: 'used' }] }],
    })
    expect(inferProtocol(status)).toBe('bittorrent')
  })

  it('ed2k:// 链接识别为 ed2k', () => {
    const status = makeStatus({
      files: [{ index: '0', path: '/d/x', length: '0', completedLength: '0', selected: 'true', uris: [{ uri: 'ed2k://|file|x|1|h|/', status: 'used' }] }],
    })
    expect(inferProtocol(status)).toBe('ed2k')
  })
})

describe('computeProgress', () => {
  it('普通任务用 completed / total', () => {
    expect(computeProgress(makeStatus())).toBeCloseTo(0.25)
  })

  it('媒体任务用 media.progress，而不是 totalLength（它恒为 0）', () => {
    const status = makeStatus({
      totalLength: '0',
      completedLength: '0',
      media: {
        state: 'downloading',
        protocol: 'hls',
        live: 'false',
        duration: '60000',
        completedDuration: '20000',
        downloadedLength: '4194304',
        progress: '0.333333',
        lengthKnown: 'false',
        tracks: [],
        error: '',
        errorCode: '',
      },
    })
    expect(computeProgress(status)).toBeCloseTo(0.333333)
  })

  it('总长度为 0 时进度为 0，不做除零', () => {
    expect(computeProgress(makeStatus({ totalLength: '0', completedLength: '0' }))).toBe(0)
  })
})

describe('computeEta', () => {
  it('直播任务永远没有 ETA', () => {
    const status = makeStatus({
      media: {
        state: 'recording',
        protocol: 'hls',
        live: 'true',
        duration: '0',
        completedDuration: '0',
        downloadedLength: '0',
        progress: '0',
        lengthKnown: 'false',
        tracks: [],
        error: '',
        errorCode: '',
      },
    })
    expect(computeEta(status, 0, 100)).toBeNull()
  })

  it('aria2 给了 eta 就用它的毫秒值换算成秒', () => {
    expect(computeEta(makeStatus({ eta: '90000' }), 100, 0)).toBe(90)
  })

  it('没有 eta 时用「剩余 / 速度」估算', () => {
    expect(computeEta(makeStatus(), 1000, 100)).toBe(10)
  })

  it('速度为 0 时返回 null，而不是编造一个数字', () => {
    expect(computeEta(makeStatus(), 1000, 0)).toBeNull()
  })
})

describe('resolveName', () => {
  it('优先用 name 字段', () => {
    expect(resolveName(makeStatus({ name: 'ubuntu.iso' }))).toBe('ubuntu.iso')
  })

  it('没有 name 时用文件路径的最后一段', () => {
    const status = makeStatus({
      files: [{ index: '0', path: '/downloads/iso/ubuntu.iso', length: '0', completedLength: '0', selected: 'true' }],
    })
    expect(resolveName(status)).toBe('ubuntu.iso')
  })
})

describe('normalizeTask', () => {
  it('把原始状态规整成前端可用的结构', () => {
    const task = normalizeTask(makeStatus({ name: 'test.iso' }))
    expect(task.name).toBe('test.iso')
    expect(task.totalLength).toBe(1000)
    expect(task.completedLength).toBe(250)
    expect(task.downloadSpeed).toBe(100)
    expect(task.progress).toBeCloseTo(0.25)
    expect(task.protocol).toBe('http')
  })
})

describe('sortTasks', () => {
  it('按数值字段升序排列', () => {
    const tasks = [
      normalizeTask(makeStatus({ gid: 'a', totalLength: '300', completedLength: '300' })),
      normalizeTask(makeStatus({ gid: 'b', totalLength: '100', completedLength: '100' })),
      normalizeTask(makeStatus({ gid: 'c', totalLength: '200', completedLength: '200' })),
    ]
    expect(sortTasks(tasks, 'size').map((task) => task.gid)).toEqual(['b', 'c', 'a'])
  })

  it('descending 会反转结果', () => {
    const tasks = [
      normalizeTask(makeStatus({ gid: 'a', totalLength: '300', completedLength: '300' })),
      normalizeTask(makeStatus({ gid: 'b', totalLength: '100', completedLength: '100' })),
    ]
    expect(sortTasks(tasks, 'size', true).map((task) => task.gid)).toEqual(['a', 'b'])
  })

  it('ETA 未知的任务排在最后', () => {
    const tasks = [
      normalizeTask(makeStatus({ gid: 'a', eta: '-1', downloadSpeed: '0', remainingLength: '0' })),
      normalizeTask(makeStatus({ gid: 'b', eta: '60000' })),
    ]
    expect(sortTasks(tasks, 'eta').map((task) => task.gid)).toEqual(['b', 'a'])
  })

  it('不会修改原数组', () => {
    const tasks = [normalizeTask(makeStatus({ gid: 'a' }))]
    sortTasks(tasks, 'name', true)
    expect(tasks[0].gid).toBe('a')
  })
})
