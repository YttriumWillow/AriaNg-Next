/**
 * 轮询调度器。
 *
 * 为什么不直接用 setInterval？
 *  - setInterval 不会等上一次请求结束。如果某次轮询慢了 5 秒，
 *    就会堆积出多个并发请求，后端压力和前端状态都会乱。
 *  - setInterval 也不管失败。连接断了还一直重试，会刷屏式报错。
 *
 * 所以这里用「上一次跑完再排下一次」的串行模型，并加上错误退避。
 */

export interface PollerOptions {
  /** 正常情况下的轮询间隔（毫秒） */
  intervalMs: number
  /** 出错时的退避倍率：间隔 = intervalMs * backoffFactor^连续错误次数 */
  backoffFactor?: number
  /** 退避后的最大间隔 */
  maxIntervalMs?: number
  /** 错误回调 */
  onError?: (error: unknown) => void
}

export class Poller {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private ticking = false
  private consecutiveErrors = 0
  private currentInterval: number

  constructor(private readonly options: PollerOptions) {
    this.currentInterval = options.intervalMs
  }

  /** 当前的实际轮询间隔（受退避影响）。UI 可以把它显示出来。 */
  get interval(): number {
    return this.currentInterval
  }

  get isRunning(): boolean {
    return this.running
  }

  /**
   * 开始轮询。
   *
   * @param tick 每一次轮询要做的事。返回值被忽略，异常会被捕获并交给 onError。
   */
  start(tick: () => Promise<void> | void): void {
    if (this.running) return
    this.running = true
    this.scheduleNext(tick, 0)
  }

  /** 停止轮询。正在进行的 tick 不会被强制中断，只是不会再排下一次。 */
  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /**
   * 立刻触发一次轮询（不等下一个周期）。
   * 用来做「用户点了刷新」这种即时反馈。
   */
  trigger(tick: () => Promise<void> | void): void {
    if (!this.running) {
      // 还没开始运行的话，先启动
      this.start(tick)
      return
    }
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    void this.run(tick)
  }

  private scheduleNext(tick: () => Promise<void> | void, delay: number): void {
    if (!this.running) return
    // 清掉已有的待触发定时器，避免 trigger() 与 run() 并发时叠出多条轮询链
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run(tick)
    }, delay)
  }

  private async run(tick: () => Promise<void> | void): Promise<void> {
    // 防止重入：上一轮还没结束就又到点了，直接跳过这一轮
    if (this.ticking) {
      this.scheduleNext(tick, this.currentInterval)
      return
    }
    this.ticking = true
    try {
      await tick()
      this.consecutiveErrors = 0
      this.currentInterval = this.options.intervalMs
    } catch (error) {
      // 如果在请求途中已被 stop()，不再累计错误或向外弹窗
      if (!this.running) return
      this.consecutiveErrors += 1
      const factor = this.options.backoffFactor ?? 2
      const max = this.options.maxIntervalMs ?? 60_000
      this.currentInterval = Math.min(max, this.options.intervalMs * factor ** this.consecutiveErrors)
      this.options.onError?.(error)
    } finally {
      this.ticking = false
      this.scheduleNext(tick, this.currentInterval)
    }
  }
}
