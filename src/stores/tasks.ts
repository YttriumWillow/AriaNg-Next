/**
 * 任务数据 store。
 *
 * 只管「数据」和「对任务的操作」，不负责连接 —— 连接由 hosts store 负责。
 * 需要客户端时从 registry 里取，避免两个 store 循环依赖。
 */

import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import type { Aria2Client } from '@/core/rpc/aria2'
import { getClient } from '@/core/rpc/registry'
import type { Aria2File, Aria2Peer, Aria2Tracker } from '@/core/rpc/types'
import { normalizeTasks, type Task } from '@/core/model/task'
import { describeError } from '@/core/rpc/errors'

/** 速率历史的一个采样点。 */
export interface SpeedPoint {
  t: number
  down: number
  up: number
}

/** 单个主机的任务数据快照。 */
export interface HostTaskState {
  active: Task[]
  waiting: Task[]
  stopped: Task[]
  globalStat: {
    downloadSpeed: number
    uploadSpeed: number
    numActive: number
    numWaiting: number
    numStopped: number
  }
  speedHistory: SpeedPoint[]
  /** 上一次刷新的错误 */
  error: string
  /** 是否正在首次加载 */
  loading: boolean
}

/** 任务详情抽屉里需要的额外数据。 */
export interface TaskDetail {
  gid: string
  files: Aria2File[]
  peers: Aria2Peer[]
  trackers: Aria2Tracker[]
  loading: boolean
  error: string
}

/** 速率历史保留的采样点数（约 5 分钟 @1s）。 */
const HISTORY_LIMIT = 300

export const useTasksStore = defineStore('tasks', () => {
  const byHost = reactive<Record<string, HostTaskState>>({})
  /** 当前在详情抽屉里查看的任务 */
  const detailGid = ref<string | null>(null)
  const detail = ref<TaskDetail | null>(null)
  /** 正在执行中的操作，用于按钮的 loading 态 */
  const busyGids = ref<Set<string>>(new Set())

  function stateFor(hostId: string): HostTaskState {
    if (!byHost[hostId]) {
      byHost[hostId] = {
        active: [],
        waiting: [],
        stopped: [],
        globalStat: { downloadSpeed: 0, uploadSpeed: 0, numActive: 0, numWaiting: 0, numStopped: 0 },
        speedHistory: [],
        error: '',
        loading: true,
      }
    }
    /*
     * ⚠️ 必须返回重新从 reactive 代理里读出来的值。
     *
     * byHost 是 reactive()：赋值时存的是原始对象，之后读取才拿到响应式代理。
     * 如果把原始对象直接 return，后面的 `state.active = ...` 就绕过了代理，
     * Vue 收不到更新通知 —— 任务列表将永远不会刷新。
     * 详见 hosts.ts 里 runtimeFor() 的注释。
     */
    return byHost[hostId]
  }

  /** 拉取一次全部任务与全局统计。 */
  async function refresh(hostId: string, client: Aria2Client): Promise<void> {
    const state = stateFor(hostId)
    try {
      // 四个查询并行发出，等全部回来再统一更新，避免界面出现半新半旧的数据
      const [active, waiting, stopped, stat] = await Promise.all([
        client.tellActive(),
        client.tellWaiting(0, 200),
        client.tellStopped(0, 200),
        client.getGlobalStat(),
      ])

      state.active = normalizeTasks(active)
      state.waiting = normalizeTasks(waiting)
      state.stopped = normalizeTasks(stopped)
      state.globalStat = {
        downloadSpeed: Number(stat.downloadSpeed) || 0,
        uploadSpeed: Number(stat.uploadSpeed) || 0,
        numActive: Number(stat.numActive) || 0,
        numWaiting: Number(stat.numWaiting) || 0,
        numStopped: Number(stat.numStopped) || 0,
      }
      state.error = ''
      state.loading = false

      // 记录速率历史，供仪表盘画图
      state.speedHistory.push({
        t: Date.now(),
        down: state.globalStat.downloadSpeed,
        up: state.globalStat.uploadSpeed,
      })
      if (state.speedHistory.length > HISTORY_LIMIT) {
        state.speedHistory.splice(0, state.speedHistory.length - HISTORY_LIMIT)
      }
    } catch (error) {
      state.error = describeError(error)
      state.loading = false
    }
  }

  /* ---------------- 任务操作 ---------------- */

  /** 包装一层：统一处理「这个主机没连上」和错误提示。 */
  async function withClient<T>(hostId: string, action: (client: Aria2Client) => Promise<T>): Promise<T | null> {
    const client = getClient(hostId)
    if (!client) {
      const state = stateFor(hostId)
      state.error = '主机未连接'
      return null
    }
    try {
      return await action(client)
    } catch (error) {
      const state = stateFor(hostId)
      state.error = describeError(error)
      throw error
    }
  }

  function markBusy(gid: string, busy: boolean): void {
    const next = new Set(busyGids.value)
    if (busy) next.add(gid)
    else next.delete(gid)
    busyGids.value = next
  }

  async function pause(hostId: string, gid: string): Promise<void> {
    markBusy(gid, true)
    try {
      await withClient(hostId, (client) => client.pause(gid))
    } finally {
      markBusy(gid, false)
    }
  }

  async function unpause(hostId: string, gid: string): Promise<void> {
    markBusy(gid, true)
    try {
      await withClient(hostId, (client) => client.unpause(gid))
    } finally {
      markBusy(gid, false)
    }
  }

  async function remove(hostId: string, gid: string, withFiles = false): Promise<void> {
    markBusy(gid, true)
    try {
      await withClient(hostId, (client) => client.remove(gid, withFiles))
      // 正在看的任务被删了，就关掉抽屉
      if (detailGid.value === gid) closeDetail()
    } finally {
      markBusy(gid, false)
    }
  }

  /** 清除已完成记录。 */
  async function clearFinished(hostId: string, gid: string): Promise<void> {
    markBusy(gid, true)
    try {
      await withClient(hostId, (client) => client.removeDownloadResult(gid))
    } finally {
      markBusy(gid, false)
    }
  }

  /**
   * 重试失败的任务。
   *
   * 媒体任务要特殊处理：aria2-next 文档明确说，
   * 媒体任务必须用 aria2.retryMedia 才能保留恢复数据，
   * 用 removeDownloadResult 会把恢复数据丢掉。
   */
  async function retry(hostId: string, gid: string, isMedia: boolean): Promise<void> {
    markBusy(gid, true)
    try {
      await withClient(hostId, (client) => (isMedia ? client.retryMedia(gid) : client.unpause(gid)))
    } finally {
      markBusy(gid, false)
    }
  }

  /** 暂停全部 / 恢复全部。 */
  async function pauseAll(hostId: string): Promise<void> {
    await withClient(hostId, (client) => client.pauseAll())
  }

  async function unpauseAll(hostId: string): Promise<void> {
    await withClient(hostId, (client) => client.unpauseAll())
  }

  /* ---------------- 任务详情 ---------------- */

  async function openDetail(hostId: string, gid: string): Promise<void> {
    detailGid.value = gid
    detail.value = { gid, files: [], peers: [], trackers: [], loading: true, error: '' }

    await withClient(hostId, async (client) => {
      // 文件、peer、tracker 三者互不依赖，并行拉
      const [files, peers, trackers] = await Promise.all([
        client.getFiles(gid).catch(() => []),
        client.getPeers(gid).catch(() => []),
        client.getTrackers(gid).catch(() => []),
      ])
      if (detailGid.value !== gid) return // 用户已经切走其它任务了
      detail.value = { gid, files, peers, trackers, loading: false, error: '' }
    })
  }

  function closeDetail(): void {
    detailGid.value = null
    detail.value = null
  }

  return {
    byHost,
    stateFor,
    refresh,
    detailGid,
    detail,
    busyGids,
    pause,
    unpause,
    remove,
    clearFinished,
    retry,
    pauseAll,
    unpauseAll,
    openDetail,
    closeDetail,
  }
})
