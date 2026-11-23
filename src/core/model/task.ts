/**
 * 任务模型：把 aria2 的原始状态规整成前端好用的结构。
 *
 * 这一层解决的三个问题：
 *  1. **类型转换** —— aria2 的整数全是字符串，统一转成 number。
 *  2. **协议识别** —— 从扩展对象（media / ed2k / bittorrent）推断任务类型。
 *  3. **进度语义** —— 媒体任务不能拿 totalLength 当分母（它恒为 0），
 *     必须用 media.progress；直播任务不能编造 ETA。
 */

import type {
  Aria2File,
  Aria2TaskStatus,
  BitTorrentInfo,
  Ed2kInfo,
  MediaInfo,
  MediaTrack,
  RawBitTorrentInfo,
  RawEd2kInfo,
  RawMediaInfo,
  TaskStatusName,
} from '../rpc/types'
import { formatPercent, mediaStateI18nKey } from './format'

/** 面板支持的任务类型。 */
export type TaskProtocol = 'http' | 'bittorrent' | 'ed2k' | 'hls' | 'dash' | 'metalink' | 'sftp' | 'unknown'

/** 规整后的任务。UI 层只认这个结构。 */
export interface Task {
  gid: string
  /** 显示名称 */
  name: string
  status: TaskStatusName
  protocol: TaskProtocol

  totalLength: number
  completedLength: number
  uploadLength: number
  downloadSpeed: number
  uploadSpeed: number

  /** 完成比例，0~1 */
  progress: number
  /** 剩余字节数；媒体任务可能为 0 */
  remainingLength: number
  /** 预计剩余秒数；null 表示未知（直播、速度为 0 等） */
  etaSeconds: number | null

  dir: string
  files: Aria2File[]
  connections: number

  errorCode: string
  errorMessage: string

  numSeeders: number
  numLeechers: number

  /** 媒体任务专属信息 */
  media?: MediaInfo
  /** ED2K 任务专属信息 */
  ed2k?: Ed2kInfo
  /** BitTorrent 任务专属信息 */
  bittorrent?: BitTorrentInfo
}

/* ------------------------------------------------------------------ *
 * 基础转换
 * ------------------------------------------------------------------ */

/**
 * 把 aria2 的字符串数字转成 number。
 * 空值、非法值一律当作 0，绝不让 NaN 漏到 UI 里。
 */
export function toNumber(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 把 aria2 的布尔表示转成真正的 boolean。
 *
 * aria2-next 的扩展对象里，布尔值有时是真正的 JSON 布尔，有时是字符串 "true"/"false"
 * （例如 media.live = "false"）。两种都要兼容。
 */
export function toBool(value: string | boolean | undefined | null): boolean {
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null) return false
  const text = String(value).trim().toLowerCase()
  return text === 'true' || text === '1' || text === 'yes'
}

/* ------------------------------------------------------------------ *
 * 协议识别
 * ------------------------------------------------------------------ */

/**
 * 判断任务属于哪种协议。
 *
 * 优先级：扩展对象 > 显式标识 > 链接特征。
 * 之所以先看扩展对象，是因为 aria2-next 的扩展对象是最权威的信号 ——
 * 它由引擎直接给出，比我们从链接字符串猜要准得多。
 */
export function inferProtocol(raw: Aria2TaskStatus): TaskProtocol {
  if (raw.media) {
    const protocol = raw.media.protocol?.toLowerCase()
    if (protocol === 'dash') return 'dash'
    if (protocol === 'hls') return 'hls'
    return 'http'
  }
  if (raw.ed2k) return 'ed2k'
  if (raw.bittorrent || raw.infoHash || raw.magnetUri) return 'bittorrent'

  // 没有扩展对象时，退而求其次看链接特征
  const firstUri = raw.files?.[0]?.uris?.[0]?.uri?.toLowerCase() ?? ''
  if (firstUri.startsWith('magnet:') || firstUri.startsWith('thunder:')) return 'bittorrent'
  if (firstUri.startsWith('ed2k://')) return 'ed2k'
  if (firstUri.startsWith('sftp://')) return 'sftp'
  if (firstUri.endsWith('.metalink') || firstUri.endsWith('.meta4')) return 'metalink'
  return 'http'
}

/* ------------------------------------------------------------------ *
 * 扩展对象转换
 * ------------------------------------------------------------------ */

function normalizeMedia(raw: RawMediaInfo): MediaInfo {
  return {
    state: raw.state ?? 'unknown',
    protocol: raw.protocol ?? '',
    live: toBool(raw.live),
    duration: toNumber(raw.duration),
    completedDuration: toNumber(raw.completedDuration),
    downloadedLength: toNumber(raw.downloadedLength),
    // progress 是 0~1 的小数
    progress: Math.min(1, Math.max(0, toNumber(raw.progress))),
    lengthKnown: toBool(raw.lengthKnown),
    tracks: (raw.tracks ?? []).map(
      (track): MediaTrack => ({
        id: track.id,
        type: track.type,
        bandwidth: track.bandwidth !== undefined ? toNumber(track.bandwidth) : undefined,
        language: track.language,
        frameRate: track.frameRate,
        width: track.width !== undefined ? toNumber(track.width) : undefined,
        height: track.height !== undefined ? toNumber(track.height) : undefined,
      }),
    ),
    error: raw.error ?? '',
    errorCode: raw.errorCode ?? '',
  }
}

function normalizeEd2k(raw: RawEd2kInfo): Ed2kInfo {
  return {
    hash: raw.hash ?? '',
    name: raw.name ?? '',
    length: toNumber(raw.length),
    completedLength: toNumber(raw.completedLength),
    partHashCount: toNumber(raw.partHashCount),
    aichRoot: raw.aichRoot,
    peerCount: toNumber(raw.peerCount),
    queuedPeerCount: toNumber(raw.queuedPeerCount),
    acceptedPeerCount: toNumber(raw.acceptedPeerCount),
    deadPeerCount: toNumber(raw.deadPeerCount),
    lowIdPeerCount: toNumber(raw.lowIdPeerCount),
    callbackWaitingPeerCount: toNumber(raw.callbackWaitingPeerCount),
    sharingTime: toNumber(raw.sharingTime),
    corruptPartCount: toNumber(raw.corruptPartCount),
  }
}

function normalizeBitTorrent(raw: RawBitTorrentInfo): BitTorrentInfo {
  return {
    magnetLink: raw.magnetLink,
    infoHashV1: raw.infoHashV1,
    infoHashV2: raw.infoHashV2,
    state: raw.state,
    fileSelectionState: raw.fileSelectionState,
    webSeeds: raw.webSeeds ?? [],
    privateTorrent: toBool(raw.privateTorrent),
    numPeers: toNumber(raw.numPeers),
    numSeeds: toNumber(raw.numSeeds),
    numComplete: toNumber(raw.numComplete),
    numIncomplete: toNumber(raw.numIncomplete),
    progress: toNumber(raw.progress),
    availability: toNumber(raw.availability),
    currentTracker: raw.currentTracker,
    activeTime: toNumber(raw.activeTime),
    finishedTime: toNumber(raw.finishedTime),
    seedingTime: toNumber(raw.seedingTime),
  }
}

/* ------------------------------------------------------------------ *
 * 进度与剩余时间
 * ------------------------------------------------------------------ */

/**
 * 计算完成比例。
 *
 * 媒体任务的 totalLength 恒为 0（输出文件还没写出来，不知道最终多大），
 * 所以必须走 media.progress（按呈现时长算）。这是 aria2-next 文档特别强调的一点。
 */
export function computeProgress(raw: Aria2TaskStatus): number {
  if (raw.media) {
    return Math.min(1, Math.max(0, toNumber(raw.media.progress)))
  }
  const total = toNumber(raw.totalLength)
  if (total <= 0) return 0
  return Math.min(1, Math.max(0, toNumber(raw.completedLength) / total))
}

/**
 * 计算剩余时间（秒）。
 *
 * 规则：
 *  - 直播任务永远没有 ETA（它可能永远录下去），返回 null。
 *  - aria2 给了 eta 字段就用它（单位毫秒，-1 表示未知）。
 *  - 否则用「剩余字节 / 当前速度」估算。
 *  - 速度为 0 时不估算，返回 null —— 宁可说「未知」，也不要给一个假数字。
 */
export function computeEta(raw: Aria2TaskStatus, remainingLength: number, downloadSpeed: number): number | null {
  if (toBool(raw.media?.live)) return null
  if (raw.media && raw.media.state !== 'complete') {
    const duration = toNumber(raw.media.duration)
    const completed = toNumber(raw.media.completedDuration)
    if (duration > 0 && completed >= 0) {
      const remainingMs = duration - completed
      return remainingMs > 0 ? Math.round(remainingMs / 1000) : 0
    }
    return null
  }
  const aria2Eta = toNumber(raw.eta)
  if (aria2Eta > 0) return Math.round(aria2Eta / 1000)
  if (downloadSpeed > 0 && remainingLength > 0) return Math.round(remainingLength / downloadSpeed)
  return null
}

/** 取一个像样的显示名称。aria2-next 的媒体任务可能没有 name，需要用文件名兜底。 */
export function resolveName(raw: Aria2TaskStatus): string {
  if (raw.name?.trim()) return raw.name
  if (raw.ed2k?.name) return raw.ed2k.name

  /*
   * 文件路径兜底。
   *
   * ⚠️ path 可能是**空字符串** —— 任务在服务端还没创建出文件时就失败了
   * （比如 HTTP 直接返回 403）。所以这里必须用 trim() 判断，
   * 光判断真值会被空字符串骗过去。
   */
  const firstFile = raw.files?.[0]?.path
  if (firstFile?.trim()) {
    const parts = firstFile.split(/[\\/]/)
    const base = parts[parts.length - 1]
    if (base) return base
  }

  /*
   * URI 兜底。
   *
   * 走不通的文件名还有一条路：源地址本身。
   * 比如「https://mirrors.aliyun.com/ubuntu/ls-lR.gz」，
   * 取最后一段就是 ls-lR.gz —— 比直接甩一串 GID 给用户友好得多。
   *
   * 这一步实测很有必要：403 失败的任务 files[0].path 是空的，
   * 界面上原本只能显示 48580a09170a1fa4 这种完全无法辨认的字符串。
   */
  const uri = raw.files?.[0]?.uris?.[0]?.uri
  if (uri) {
    const fromUri = nameFromUri(uri)
    if (fromUri) return fromUri
  }

  return raw.gid
}

/**
 * 从 URI 里猜一个可读的名称。
 *
 * 三种 URI 各有各的脾气：
 *  - 普通 http(s)：取路径最后一段，丢掉查询串和锚点
 *  - ed2k://|file|名字|大小|哈希|/：名字在第 3 段
 *  - magnet:?xt=...&dn=名字：名字在 dn 参数里
 */
function nameFromUri(uri: string): string {
  // ed2k 链接：|file|<名称>|<大小>|<哈希>|
  if (uri.startsWith('ed2k://')) {
    const match = /\|file\|([^|]*)\|/.exec(uri)
    if (match?.[1]) return match[1]
    return ''
  }

  // magnet 链接：dn 参数就是显示名（查询串里的 + 代表空格）
  if (uri.startsWith('magnet:')) {
    const match = /[?&]dn=([^&]+)/.exec(uri)
    if (match?.[1]) return safeDecode(match[1].replace(/\+/g, ' '))
    return ''
  }

  // 普通链接：去掉 ?query 和 #anchor，再取最后一段
  const cleaned = uri.split(/[?#]/)[0]
  const parts = cleaned.split(/[\\/]/)
  const base = parts[parts.length - 1]
  return base ? safeDecode(base) : ''
}

/**
 * URL 解码，但要能容错。
 *
 * decodeURIComponent 遇到残缺的百分号序列（比如 %zz）会抛 URIError。
 * 一个名字解码失败不该让整个任务列表崩掉，所以这里兜住异常。
 */
function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

/** 把 aria2 原始状态规整成 Task。 */
export function normalizeTask(raw: Aria2TaskStatus): Task {
  const totalLength = toNumber(raw.totalLength)
  const completedLength = toNumber(raw.completedLength)
  const downloadSpeed = toNumber(raw.downloadSpeed)

  // aria2-next 会直接返回 remainingLength；原版 aria2 省略该字段时按 total - completed 回退计算
  const remainingLength =
    raw.remainingLength !== undefined && raw.remainingLength !== ''
      ? toNumber(raw.remainingLength)
      : Math.max(0, totalLength - completedLength)

  return {
    gid: raw.gid,
    name: resolveName(raw),
    status: raw.status,
    protocol: inferProtocol(raw),

    totalLength,
    completedLength,
    uploadLength: toNumber(raw.uploadLength),
    downloadSpeed,
    uploadSpeed: toNumber(raw.uploadSpeed),

    progress: computeProgress(raw),
    remainingLength,
    etaSeconds: computeEta(raw, remainingLength, downloadSpeed),

    dir: raw.dir ?? '',
    files: raw.files ?? [],
    connections: toNumber(raw.connections),

    errorCode: raw.errorCode ?? '',
    errorMessage: raw.errorMessage ?? '',

    numSeeders: toNumber(raw.numSeeders),
    numLeechers: toNumber(raw.numLeechers),

    media: raw.media ? normalizeMedia(raw.media) : undefined,
    ed2k: raw.ed2k ? normalizeEd2k(raw.ed2k) : undefined,
    bittorrent: raw.bittorrent ? normalizeBitTorrent(raw.bittorrent) : undefined,
  }
}

/** 批量规整。 */
export function normalizeTasks(raws: Aria2TaskStatus[]): Task[] {
  return raws.map(normalizeTask)
}

/**
 * 任务的状态文案。
 *
 * ⚠️ 媒体任务有自己的阶段体系（media.state），但**不能盖过任务本身的错误状态**。
 *
 * 实测踩过的坑：DASH 直播流因为「服务端已超出保留窗口」失败，
 * aria2 报的是 status=error，而 media.state 依然是 downloading。
 * 如果这里无条件优先用 media.state，界面就会显示「下载中」——
 * 一个正在下载的假象，用户会一直等一个永远下不完的任务。
 *
 * 所以错误状态必须**优先于**媒体阶段。
 *
 * @param t 翻译函数，由调用方（UI 层）注入。
 *          core 层刻意不直接依赖 i18n —— 它是零框架依赖的纯 TS，
 *          翻译属于表现层的事。
 */
export function taskStatusText(task: Task, t: (key: string) => string): string {
  if (task.status === 'error') return t('status.error')
  if (task.media) return t(mediaStateI18nKey(task.media.state))
  return t(`status.${task.status}`)
}

/**
 * 进度列的文案。
 *
 * 出错的任务显示「出错」而不是百分比或「下载中」——
 * 一个 0% 的进度条配一句「下载中」，用户会一直等下去。
 */
export function taskProgressText(task: Task, t: (key: string) => string): string {
  if (task.status === 'error') return t('status.error')
  if (task.media) {
    if (task.media.live) return t('status.active')
    return formatPercent(task.media.progress)
  }
  return formatPercent(task.progress)
}
