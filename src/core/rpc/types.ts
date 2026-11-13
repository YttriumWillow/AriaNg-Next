/**
 * JSON-RPC 与 aria2 任务状态的类型定义。
 *
 * 这里的类型严格对应 aria2-next 的真实契约，来源：
 *   - aria2 官方 JSON-RPC 规范（标准方法与标准字段）
 *   - aria2-next `docs/rpc-extensions.md`（扩展方法与扩展字段）
 *   - aria2-next `docs/media-downloads.md`（媒体任务的字段语义）
 *
 * ⚠️ aria2 的一个重要约定：**所有整型计数器都以十进制字符串返回**。
 *    例如 totalLength = "1048576" 而不是 1048576。
 *    统一转换放在 src/core/model/task.ts 的 normalizeTask() 里做，
 *    这样上层拿到的永远是 number，不必每次都记着转换。
 */

/* ------------------------------------------------------------------ *
 * JSON-RPC 2.0 协议
 * ------------------------------------------------------------------ */

/** 一次 JSON-RPC 请求。注意 params 是数组（位置参数），不是对象。 */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string
  method: string
  params: unknown[]
}

/** JSON-RPC 错误对象。aria2 用 code 区分「方法不存在」与「参数非法」。 */
export interface JsonRpcErrorObject {
  code: number
  message: string
}

/** 一次 JSON-RPC 响应。成功时有 result，失败时有 error，二者互斥。 */
export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0'
  id: string
  result?: T
  error?: JsonRpcErrorObject
}

/* ------------------------------------------------------------------ *
 * aria2 标准字段
 * ------------------------------------------------------------------ */

/** 任务在 aria2 里的生命周期状态。 */
export type TaskStatusName = 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed'

/** 单个文件的下载信息（aria2.getFiles 的元素）。 */
export interface Aria2File {
  index: string
  path: string
  length: string
  completedLength: string
  selected: string
  uris?: { uri: string; status: string }[]
}

/** BT 对等端信息（aria2.getPeers 的元素）。 */
export interface Aria2Peer {
  peerId: string
  ip: string
  port: string
  amChoking?: string
  peerChoking?: string
  downloadSpeed?: string
  uploadSpeed?: string
  seeder?: string
  clientName?: string
}

/** 标准 tracker 信息（aria2.getTrackers 的元素）。 */
export interface Aria2Tracker {
  announceUrl: string
  status: string
  tier?: string
  lastAnnounceTime?: string
  nextAnnounceTime?: string
  scrapeCount?: string
}

/* ------------------------------------------------------------------ *
 * aria2-next 扩展字段
 * ------------------------------------------------------------------ */

/**
 * 媒体任务（HLS / DASH）的专属对象，挂在任务状态的 `media` 字段上。
 *
 * 关键语义（来自 media-downloads.md）：
 *  - 媒体任务在输出文件写完之前 **没有总字节数**，standard totalLength 恒为 "0"。
 *    所以进度必须读 media.progress（已完成的呈现时长占比），而不是拿 0 当分母。
 *  - 所有时长都是 **毫秒**。
 *  - live 为 true 的直播任务不报告伪造的总时长百分比。
 */
export interface MediaInfo {
  /** 媒体阶段：waiting/probing/awaiting-selection/downloading/recording/finalizing/paused/complete/error/removed */
  state: string
  /** 协议：hls 或 dash */
  protocol: string
  /** 是否为直播 */
  live: boolean
  /** 总呈现时长（毫秒），直播时为 0 */
  duration: number
  /** 已完成的呈现时长（毫秒） */
  completedDuration: number
  /** 已下载的媒体负载字节数（独立于网络速度统计） */
  downloadedLength: number
  /** 已完成时长占比，0~1 */
  progress: number
  /** 是否已知总时长 */
  lengthKnown: boolean
  /** 可选轨道（清晰度 / 音频 / 字幕） */
  tracks: MediaTrack[]
  /** 错误描述，正常时为空字符串 */
  error: string
  /** 结构化错误码：unsupported_source / authentication_required / protected_media / unsupported_selection / probe_failed */
  errorCode: string
}

/** 媒体轨道。id 是不透明标识符，不要去解析它的含义。 */
export interface MediaTrack {
  id: string
  /** video / audio / subtitles */
  type: string
  /** 带宽（bps） */
  bandwidth?: number
  /** 语言标签 */
  language?: string
  /** 帧率，十进制字符串，0 表示未知 */
  frameRate?: string
  width?: number
  height?: number
}

/** ED2K 任务的专属对象，挂在任务状态的 `ed2k` 字段上。 */
export interface Ed2kInfo {
  hash: string
  name: string
  length: number
  completedLength: number
  partHashCount: number
  aichRoot?: string
  peerCount: number
  queuedPeerCount: number
  acceptedPeerCount: number
  deadPeerCount: number
  lowIdPeerCount: number
  callbackWaitingPeerCount: number
  sharingTime: number
  corruptPartCount: number
}

/** BitTorrent 任务的补充信息，挂在任务状态的 `bittorrent` 字段上。 */
export interface BitTorrentInfo {
  magnetLink?: string
  infoHashV1?: string
  infoHashV2?: string
  state?: string
  /** awaiting（磁力暂停等待选文件）/ ready（已选文件但仍暂停）/ none */
  fileSelectionState?: string
  webSeeds?: string[]
  privateTorrent?: boolean
  numPeers: number
  numSeeds: number
  numComplete: number
  numIncomplete: number
  progress: number
  availability: number
  currentTracker?: string
  activeTime: number
  finishedTime: number
  seedingTime: number
}

/**
 * aria2 任务状态（tellStatus / tellActive / tellWaiting / tellStopped 的元素）。
 *
 * 标准字段始终存在；`media` / `ed2k` / `bittorrent` 三个扩展对象按任务类型出现，
 * 只读取标准字段的前端会把它当成普通下载任务 —— 这正是向后兼容的关键。
 */
export interface Aria2TaskStatus {
  gid: string
  status: TaskStatusName
  totalLength: string
  completedLength: string
  uploadLength: string
  downloadSpeed: string
  uploadSpeed: string
  /** 剩余字节数 */
  remainingLength?: string
  /** 剩余时间（毫秒），-1 表示未知 */
  eta?: string
  dir: string
  errorCode?: string
  errorMessage?: string
  /** 任务名。aria2-next 对媒体任务可能为空，需要用文件名兜底 */
  name?: string
  files?: Aria2File[]
  /** 连接数 */
  connections?: string
  /** BT 做种数 / 下载者数 */
  numSeeders?: string
  numLeechers?: string
  /** magnet / infohash 标识 */
  infoHash?: string
  magnetUri?: string
  /** 扩展对象 */
  media?: RawMediaInfo
  ed2k?: RawEd2kInfo
  bittorrent?: RawBitTorrentInfo
}

/** 扩展对象在「原始 JSON」形态下的样子：数值是字符串，布尔是 "true"/"false"。 */
export interface RawMediaInfo {
  state: string
  protocol: string
  live: string | boolean
  duration: string
  completedDuration: string
  downloadedLength: string
  progress: string
  lengthKnown: string | boolean
  tracks: RawMediaTrack[]
  error: string
  errorCode: string
}

export interface RawMediaTrack {
  id: string
  type: string
  bandwidth?: string
  language?: string
  frameRate?: string
  width?: string
  height?: string
}

export type RawEd2kInfo = Omit<
  Ed2kInfo,
  | 'length'
  | 'completedLength'
  | 'partHashCount'
  | 'peerCount'
  | 'queuedPeerCount'
  | 'acceptedPeerCount'
  | 'deadPeerCount'
  | 'lowIdPeerCount'
  | 'callbackWaitingPeerCount'
  | 'sharingTime'
  | 'corruptPartCount'
> & {
  length: string
  completedLength: string
  partHashCount: string
  peerCount: string
  queuedPeerCount: string
  acceptedPeerCount: string
  deadPeerCount: string
  lowIdPeerCount: string
  callbackWaitingPeerCount: string
  sharingTime: string
  corruptPartCount: string
}

export type RawBitTorrentInfo = Omit<
  BitTorrentInfo,
  | 'numPeers'
  | 'numSeeds'
  | 'numComplete'
  | 'numIncomplete'
  | 'progress'
  | 'availability'
  | 'activeTime'
  | 'finishedTime'
  | 'seedingTime'
  | 'privateTorrent'
> & {
  numPeers: string
  numSeeds: string
  numComplete: string
  numIncomplete: string
  progress: string
  availability: string
  activeTime: string
  finishedTime: string
  seedingTime: string
  privateTorrent?: string | boolean
}

/* ------------------------------------------------------------------ *
 * 其它 RPC 返回值
 * ------------------------------------------------------------------ */

/** aria2.getVersion 的返回值。aria2-next 会额外填 product / mediaFeatures / downloadFeatures。 */
export interface Aria2Version {
  version: string
  product?: string
  rpcVersion?: string
  enabledFeatures?: string[]
  mediaFeatures?: string[]
  downloadFeatures?: string[]
}

/** aria2.getGlobalStat 的返回值。 */
export interface Aria2GlobalStat {
  downloadSpeed: string
  uploadSpeed: string
  numActive: string
  numWaiting: string
  numStopped: string
  numStoppedTotal?: string
  numWaitingTotal?: string
}

/** aria2.getSessionInfo 的返回值。 */
export interface Aria2SessionInfo {
  sessionId: string
}

/** aria2.getEd2kStatus 的返回值。 */
export interface Ed2kStatus {
  clientId?: string
  userHash?: string
  tcpPort?: string
  udpPort?: string
  portMapping?: string
}

/** aria2.probe 的返回值：探测一个链接的资源信息，不真正开始下载。 */
export interface Aria2ProbeResult {
  status: string
  finalUrl?: string
  contentType?: string
  filename?: string
  totalLength?: string
  resumable?: boolean
  error?: string
}

/** 选项表：aria2 的选项名 -> 值 */
export type Aria2Options = Record<string, string>
