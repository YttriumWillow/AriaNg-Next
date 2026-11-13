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
  if (raw.media?.live) return null
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
  const firstFile = raw.files?.[0]?.path
  if (firstFile) {
    const parts = firstFile.split(/[\\/]/)
    return parts[parts.length - 1] || firstFile
  }
  return raw.gid
}

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

/** 把 aria2 原始状态规整成 Task。 */
export function normalizeTask(raw: Aria2TaskStatus): Task {
  const totalLength = toNumber(raw.totalLength)
  const completedLength = toNumber(raw.completedLength)
  const downloadSpeed = toNumber(raw.downloadSpeed)

  // 媒体任务的「剩余」按未完成的呈现时长算比较合理，但字节口径无从得知，
  // 所以这里保留 aria2 给的 remainingLength（媒体任务通常为 0）。
  const remainingLength = toNumber(raw.remainingLength)

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
