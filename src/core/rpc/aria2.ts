/**
 * aria2 方法封装。
 *
 * 这一层把「方法名 + 参数顺序」固定下来，上层就不会到处写字符串。
 * 参数顺序是 aria2 JSON-RPC 的硬约定（位置参数），写错顺序服务端会直接报错，
 * 所以集中在这里比散落在各个组件里安全得多。
 *
 * ⚠️ secret（token）不需要在这里传 —— 传输层会自动把它插到第一个参数位置。
 */

import type { RpcTransport } from './transport'
import type {
  Aria2File,
  Aria2GlobalStat,
  Aria2Options,
  Aria2Peer,
  Aria2ProbeResult,
  Aria2SessionInfo,
  Aria2TaskStatus,
  Aria2Tracker,
  Aria2Version,
  Ed2kStatus,
} from './types'

export class Aria2Client {
  constructor(private readonly transport: RpcTransport) {}

  /** 暴露传输层，方便上层读取连接状态。 */
  get connection(): RpcTransport {
    return this.transport
  }

  private call<T>(method: string, params: unknown[] = []): Promise<T> {
    return this.transport.call<T>(method, params)
  }

  /* ---------------------------------------------------------------- *
   * 系统信息
   * ---------------------------------------------------------------- */

  /** 版本信息。aria2-next 会额外返回 product / mediaFeatures / downloadFeatures。 */
  getVersion(): Promise<Aria2Version> {
    return this.call<Aria2Version>('aria2.getVersion')
  }

  /**
   * 列出后端支持的全部方法名。
   *
   * 这是能力探测的权威来源：aria2-next 文档明确说「system.listMethods lists every method name」。
   * 与其在前端猜哪些功能可用，不如直接问后端。
   */
  listMethods(): Promise<string[]> {
    return this.call<string[]>('system.listMethods')
  }

  /** 全局统计：总速度、各状态任务数。 */
  getGlobalStat(): Promise<Aria2GlobalStat> {
    return this.call<Aria2GlobalStat>('aria2.getGlobalStat')
  }

  /** 会话信息，用于判断后端是否重启过。 */
  getSessionInfo(): Promise<Aria2SessionInfo> {
    return this.call<Aria2SessionInfo>('aria2.getSessionInfo')
  }

  /* ---------------------------------------------------------------- *
   * 任务查询
   * ---------------------------------------------------------------- */

  /** 正在下载的任务。 */
  tellActive(): Promise<Aria2TaskStatus[]> {
    return this.call<Aria2TaskStatus[]>('aria2.tellActive')
  }

  /** 等待中的任务（offset 从 0 开始，num 为数量，-1 表示全部）。 */
  tellWaiting(offset = 0, num = 100): Promise<Aria2TaskStatus[]> {
    return this.call<Aria2TaskStatus[]>('aria2.tellWaiting', [offset, num])
  }

  /** 已停止的任务（已完成 / 出错 / 被移除）。 */
  tellStopped(offset = 0, num = 100): Promise<Aria2TaskStatus[]> {
    return this.call<Aria2TaskStatus[]>('aria2.tellStopped', [offset, num])
  }

  /** 单个任务的完整状态。 */
  tellStatus(gid: string, keys?: string[]): Promise<Aria2TaskStatus> {
    return this.call<Aria2TaskStatus>('aria2.tellStatus', keys?.length ? [gid, keys] : [gid])
  }

  /** 任务的文件列表（BT 会是多个文件）。 */
  getFiles(gid: string): Promise<Aria2File[]> {
    return this.call<Aria2File[]>('aria2.getFiles', [gid])
  }

  /** BT 对等端列表。 */
  getPeers(gid: string): Promise<Aria2Peer[]> {
    return this.call<Aria2Peer[]>('aria2.getPeers', [gid])
  }

  /** 标准 tracker 列表。 */
  getTrackers(gid: string): Promise<Aria2Tracker[]> {
    return this.call<Aria2Tracker[]>('aria2.getTrackers', [gid])
  }

  /** 全局选项表。 */
  getGlobalOption(): Promise<Aria2Options> {
    return this.call<Aria2Options>('aria2.getGlobalOption')
  }

  /** 单个任务的选项表。 */
  getOption(gid: string): Promise<Aria2Options> {
    return this.call<Aria2Options>('aria2.getOption', [gid])
  }

  /* ---------------------------------------------------------------- *
   * 任务控制
   * ---------------------------------------------------------------- */

  pause(gid: string): Promise<string> {
    return this.call<string>('aria2.pause', [gid])
  }

  forcePause(gid: string): Promise<string> {
    return this.call<string>('aria2.forcePause', [gid])
  }

  unpause(gid: string): Promise<string> {
    return this.call<string>('aria2.unpause', [gid])
  }

  forceUnpause(gid: string): Promise<string> {
    return this.call<string>('aria2.forceUnpause', [gid])
  }

  pauseAll(): Promise<string> {
    return this.call<string>('aria2.pauseAll')
  }

  unpauseAll(): Promise<string> {
    return this.call<string>('aria2.unpauseAll')
  }

  /** 移除任务。第二个参数 true 表示同时删除已下载的文件。 */
  remove(gid: string, withFiles = false): Promise<string> {
    return this.call<string>('aria2.remove', [gid, withFiles])
  }

  /**
   * 只清除「已完成记录」，不动任务本身。
   *
   * ⚠️ 媒体任务不要用这个方法 —— aria2-next 文档明确说 removeDownloadResult
   * 会丢弃媒体的恢复数据，想重试失败的媒体任务应该用 aria2.retryMedia。
   */
  removeDownloadResult(gid: string): Promise<string> {
    return this.call<string>('aria2.removeDownloadResult', [gid])
  }

  /** 调整任务在队列中的位置。how: 'POS_SET' | 'POS_CUR'。 */
  changePosition(gid: string, position: number, how: 'POS_SET' | 'POS_CUR' = 'POS_CUR'): Promise<number> {
    return this.call<number>('aria2.changePosition', [gid, position, how])
  }

  /** 修改单个任务的选项。 */
  changeOption(gid: string, options: Aria2Options): Promise<string> {
    return this.call<string>('aria2.changeOption', [gid, options])
  }

  /** 修改全局选项。 */
  changeGlobalOption(options: Aria2Options): Promise<string> {
    return this.call<string>('aria2.changeGlobalOption', [options])
  }

  /* ---------------------------------------------------------------- *
   * 添加任务
   * ---------------------------------------------------------------- */

  /**
   * 通过链接添加任务。
   * uris 可以是 http/https、magnet、ed2k、thunder 等，aria2-next 会自动按协议分派。
   */
  addUri(uris: string[], options?: Aria2Options): Promise<string> {
    return this.call<string>('aria2.addUri', options ? [uris, options] : [uris])
  }

  /** 通过种子文件添加任务（内容为 base64 编码的 .torrent）。 */
  addTorrent(base64Torrent: string, uris?: string[], options?: Aria2Options): Promise<string> {
    const params: unknown[] = [base64Torrent]
    if (uris) params.push(uris)
    if (options) params.push(options)
    return this.call<string>('aria2.addTorrent', params)
  }

  /** 通过金属链（metalink）添加任务。 */
  addMetalink(base64Metalink: string, options?: Aria2Options): Promise<string> {
    return this.call<string>('aria2.addMetalink', options ? [base64Metalink, options] : [base64Metalink])
  }

  /* ---------------------------------------------------------------- *
   * aria2-next 扩展方法
   * 下面这些方法在原版 aria2 中不存在，只有 aria2-next 才有。
   * 调用前应当先用 capability.ts 探测后端是否支持。
   * ---------------------------------------------------------------- */

  /** 探测链接的资源信息（文件名、大小、是否可续传），不真正开始下载。 */
  probe(uri: string, options?: Aria2Options): Promise<Aria2ProbeResult> {
    return this.call<Aria2ProbeResult>('aria2.probe', options ? [uri, options] : [uri])
  }

  /** 结束直播录制并收尾（与「删除」是两件不同的事）。 */
  finishMedia(gid: string): Promise<string> {
    return this.call<string>('aria2.finishMedia', [gid])
  }

  /** 用同一个 GID 重新入队一个失败的媒体任务，保留恢复数据。 */
  retryMedia(gid: string, options?: Aria2Options): Promise<string> {
    return this.call<string>('aria2.retryMedia', options ? [gid, options] : [gid])
  }

  /** BT tracker 详情（含 announce 状态、scrape 次数、最后错误）。 */
  getBtTrackers(gid: string): Promise<unknown[]> {
    return this.call<unknown[]>('aria2.getBtTrackers', [gid])
  }

  /** 会话级 BT 状态。 */
  getBtSessionStatus(): Promise<unknown> {
    return this.call<unknown>('aria2.getBtSessionStatus')
  }

  /** ED2K 客户端状态（客户端 ID、端口、上传与信用计数）。 */
  getEd2kStatus(): Promise<Ed2kStatus> {
    return this.call<Ed2kStatus>('aria2.getEd2kStatus')
  }

  /** 检查种子文件内容，不添加任务。 */
  inspectTorrent(base64Torrent: string): Promise<unknown> {
    return this.call<unknown>('aria2.inspectTorrent', [base64Torrent])
  }
}
