/**
 * 任务数据 store。
 *
 * 只管「数据」和「对任务的操作」，不负责连接 —— 连接由 hosts store 负责。
 * 需要客户端时从 registry 里取，避免两个 store 循环依赖。
 */

import { defineStore } from 'pinia'
import { reactive, ref, toRaw } from 'vue'
import type { Aria2Client } from '@/core/rpc/aria2'
import { getClient } from '@/core/rpc/registry'
import type { Aria2File, Aria2Peer, Aria2Tracker, BitTorrentInfo, Ed2kInfo, MediaInfo } from '@/core/rpc/types'
import { normalizeTasks, type Task } from '@/core/model/task'
import { describeError } from '@/core/rpc/errors'
import { useI18n } from '@/i18n'

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

function isFilesEqual(a: Aria2File[], b: Aria2File[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    const fa = a[i]
    const fb = b[i]
    if (
      fa.index !== fb.index ||
      fa.path !== fb.path ||
      fa.length !== fb.length ||
      fa.completedLength !== fb.completedLength ||
      fa.selected !== fb.selected
    ) {
      return false
    }
    const urisA = fa.uris
    const urisB = fb.uris
    if (urisA !== urisB) {
      if (!urisA || !urisB || urisA.length !== urisB.length) return false
      for (let j = 0; j < urisA.length; j += 1) {
        if (urisA[j].uri !== urisB[j].uri || urisA[j].status !== urisB[j].status) return false
      }
    }
  }
  return true
}

function isMediaEqual(a: MediaInfo | undefined, b: MediaInfo | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (
    a.state !== b.state ||
    a.protocol !== b.protocol ||
    a.live !== b.live ||
    a.duration !== b.duration ||
    a.completedDuration !== b.completedDuration ||
    a.downloadedLength !== b.downloadedLength ||
    a.progress !== b.progress ||
    a.lengthKnown !== b.lengthKnown ||
    a.error !== b.error ||
    a.errorCode !== b.errorCode ||
    a.tracks.length !== b.tracks.length
  ) {
    return false
  }
  for (let i = 0; i < a.tracks.length; i += 1) {
    const ta = a.tracks[i]
    const tb = b.tracks[i]
    if (
      ta.id !== tb.id ||
      ta.type !== tb.type ||
      ta.bandwidth !== tb.bandwidth ||
      ta.language !== tb.language ||
      ta.frameRate !== tb.frameRate ||
      ta.width !== tb.width ||
      ta.height !== tb.height
    ) {
      return false
    }
  }
  return true
}

function isEd2kEqual(a: Ed2kInfo | undefined, b: Ed2kInfo | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.hash === b.hash &&
    a.name === b.name &&
    a.length === b.length &&
    a.completedLength === b.completedLength &&
    a.partHashCount === b.partHashCount &&
    a.aichRoot === b.aichRoot &&
    a.peerCount === b.peerCount &&
    a.queuedPeerCount === b.queuedPeerCount &&
    a.acceptedPeerCount === b.acceptedPeerCount &&
    a.deadPeerCount === b.deadPeerCount &&
    a.lowIdPeerCount === b.lowIdPeerCount &&
    a.callbackWaitingPeerCount === b.callbackWaitingPeerCount &&
    a.sharingTime === b.sharingTime &&
    a.corruptPartCount === b.corruptPartCount
  )
}

function isBitTorrentEqual(a: BitTorrentInfo | undefined, b: BitTorrentInfo | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (
    a.magnetLink !== b.magnetLink ||
    a.infoHashV1 !== b.infoHashV1 ||
    a.infoHashV2 !== b.infoHashV2 ||
    a.state !== b.state ||
    a.fileSelectionState !== b.fileSelectionState ||
    a.privateTorrent !== b.privateTorrent ||
    a.numPeers !== b.numPeers ||
    a.numSeeds !== b.numSeeds ||
    a.numComplete !== b.numComplete ||
    a.numIncomplete !== b.numIncomplete ||
    a.progress !== b.progress ||
    a.availability !== b.availability ||
    a.currentTracker !== b.currentTracker ||
    a.activeTime !== b.activeTime ||
    a.finishedTime !== b.finishedTime ||
    a.seedingTime !== b.seedingTime
  ) {
    return false
  }
  const seedsA = a.webSeeds
  const seedsB = b.webSeeds
  if (seedsA === seedsB) return true
  if (!seedsA || !seedsB || seedsA.length !== seedsB.length) return false
  for (let i = 0; i < seedsA.length; i += 1) {
    if (seedsA[i] !== seedsB[i]) return false
  }
  return true
}

/**
 * 判断两份规整后的任务数据是否实质一致。
 * 先比较高频变化字段（已下载字节、速率、状态），大多数变动会在前几步直接短路返回。
 */
function isTaskEqual(a: Task, b: Task): boolean {
  return (
    a.completedLength === b.completedLength &&
    a.downloadSpeed === b.downloadSpeed &&
    a.uploadSpeed === b.uploadSpeed &&
    a.status === b.status &&
    a.progress === b.progress &&
    a.remainingLength === b.remainingLength &&
    a.etaSeconds === b.etaSeconds &&
    a.connections === b.connections &&
    a.numSeeders === b.numSeeders &&
    a.numLeechers === b.numLeechers &&
    a.uploadLength === b.uploadLength &&
    a.totalLength === b.totalLength &&
    a.gid === b.gid &&
    a.name === b.name &&
    a.protocol === b.protocol &&
    a.dir === b.dir &&
    a.errorCode === b.errorCode &&
    a.errorMessage === b.errorMessage &&
    isMediaEqual(a.media, b.media) &&
    isBitTorrentEqual(a.bittorrent, b.bittorrent) &&
    isEd2kEqual(a.ed2k, b.ed2k) &&
    isFilesEqual(a.files, b.files)
  )
}

/**
 * 协调新旧任务列表：按 gid 与关键字段复用未变化的旧 Task 引用。
 *
 * 为什么必须配合 `toRaw(prevTask)`？
 *  - `prevList` 来自 `reactive()` 的 `byHost`，里面的元素是响应式代理；
 *  - 把原始对象放回新数组再赋值给 `state.active/waiting/stopped`，
 *    Vue 通过同一原始对象会映射回同一个缓存 Proxy，既不破坏响应式追踪，
 *    又避免把代理二次包进原始状态里。
 *  - 若整张列表顺序与内容完全没变，直接返回 `null` 跳过数组赋值，彻底消除静止列表的响应式扩散。
 */
function reconcileTaskList(prevList: Task[], nextList: Task[]): Task[] | null {
  if (prevList.length === 0 && nextList.length === 0) return null

  let merged: Task[] | null = prevList.length !== nextList.length ? new Array<Task>(nextList.length) : null
  let prevByGid: Map<string, Task> | null = null

  const ensureMerged = (upto: number): Task[] => {
    if (merged) return merged
    merged = new Array<Task>(nextList.length)
    for (let k = 0; k < upto; k += 1) {
      merged[k] = toRaw(prevList[k])
    }
    return merged
  }

  for (let i = 0; i < nextList.length; i += 1) {
    const nextTask = nextList[i]
    const sameSlot = i < prevList.length && prevList[i].gid === nextTask.gid
    let prevTask = sameSlot ? prevList[i] : undefined

    if (!prevTask && prevList.length > 0) {
      // 仅在顺序变化或增删时按需建索引，稳态轮询零 Map 分配
      if (!prevByGid) {
        prevByGid = new Map()
        for (let j = 0; j < prevList.length; j += 1) {
          prevByGid.set(prevList[j].gid, prevList[j])
        }
      }
      prevTask = prevByGid.get(nextTask.gid)
    }

    if (prevTask && isTaskEqual(prevTask, nextTask)) {
      const rawPrev = toRaw(prevTask)
      if (!sameSlot) {
        ensureMerged(i)[i] = rawPrev
      } else if (merged) {
        merged[i] = rawPrev
      }
    } else {
      ensureMerged(i)[i] = nextTask
    }
  }

  return merged
}

export const useTasksStore = defineStore('tasks', () => {
  // 错误提示跟着界面语言走：把翻译函数注入 core 的 describeError
  const { t } = useI18n()

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

      const nextActive = reconcileTaskList(state.active, normalizeTasks(active))
      if (nextActive) state.active = nextActive

      const nextWaiting = reconcileTaskList(state.waiting, normalizeTasks(waiting))
      if (nextWaiting) state.waiting = nextWaiting

      const nextStopped = reconcileTaskList(state.stopped, normalizeTasks(stopped))
      if (nextStopped) state.stopped = nextStopped

      const nextDownloadSpeed = Number(stat.downloadSpeed) || 0
      const nextUploadSpeed = Number(stat.uploadSpeed) || 0
      const nextNumActive = Number(stat.numActive) || 0
      const nextNumWaiting = Number(stat.numWaiting) || 0
      const nextNumStopped = Number(stat.numStopped) || 0
      const gs = state.globalStat
      if (
        gs.downloadSpeed !== nextDownloadSpeed ||
        gs.uploadSpeed !== nextUploadSpeed ||
        gs.numActive !== nextNumActive ||
        gs.numWaiting !== nextNumWaiting ||
        gs.numStopped !== nextNumStopped
      ) {
        state.globalStat = {
          downloadSpeed: nextDownloadSpeed,
          uploadSpeed: nextUploadSpeed,
          numActive: nextNumActive,
          numWaiting: nextNumWaiting,
          numStopped: nextNumStopped,
        }
      }

      if (state.error !== '') state.error = ''
      if (state.loading) state.loading = false

      // 记录速率历史，供仪表盘画图
      state.speedHistory.push({
        t: Date.now(),
        down: nextDownloadSpeed,
        up: nextUploadSpeed,
      })
      if (state.speedHistory.length > HISTORY_LIMIT) {
        state.speedHistory.splice(0, state.speedHistory.length - HISTORY_LIMIT)
      }
    } catch (error) {
      state.error = describeError(error, t)
      state.loading = false
      // 必须把异常抛回给 Poller，这样退避间隔与 onError 回调才会生效
      throw error
    }
  }

  /* ---------------- 任务操作 ---------------- */

  /** 包装一层：统一处理「这个主机没连上」和错误提示。 */
  async function withClient<T>(hostId: string, action: (client: Aria2Client) => Promise<T>): Promise<T | null> {
    const client = getClient(hostId)
    if (!client) {
      const state = stateFor(hostId)
      state.error = t('connection.disconnected')
      return null
    }
    try {
      return await action(client)
    } catch (error) {
      const state = stateFor(hostId)
      state.error = describeError(error, t)
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
      if (detailGid.value === gid) closeDetail()
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
