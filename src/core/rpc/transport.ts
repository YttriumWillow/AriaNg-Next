/**
 * JSON-RPC 传输层。
 *
 * 设计要点：
 *  1. **零框架依赖** —— 这个文件里没有 import Vue。core/ 目录下的所有代码都是纯 TS，
 *     因此可以被 Vitest 直接单元测试，将来换框架也能整体搬走。
 *  2. **两种传输实现** —— WebSocket 与 HTTP。WS 是首选：浏览器不会对 WS 做 CORS 检查，
 *     而 aria2-next 的 HTTP 端点默认不带 CORS 响应头，跨域时会被浏览器拦掉。
 *  3. **secret 自动注入** —— aria2 约定：设置了 rpc-secret 时，token 必须作为
 *     **第一个** 参数传入（`token:xxx`）。这属于传输细节，统一在这里处理，
 *     上层调用方法时不必关心有没有设密码。
 */

import type { JsonRpcRequest, JsonRpcResponse } from './types'
import { RpcError, TransportError } from './errors'

/** 传输层状态，供 UI 展示连接情况。 */
export type TransportStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'closed'

export interface TransportOptions {
  /**
   * RPC 端点地址。
   *   ws://host:6800/jsonrpc   —— 推荐
   *   wss://host:6800/jsonrpc  —— 推荐（HTTPS 场景）
   *   http://host:6800/jsonrpc —— 需要后端允许 CORS
   */
  url: string
  /** rpc-secret。为空表示未启用鉴权。 */
  secret?: string
  /** 单次请求超时（毫秒），HTTP 传输用。 */
  timeoutMs?: number
  /** 状态变化回调。 */
  onStatus?: (status: TransportStatus, detail?: string) => void
}

/** 所有传输实现的统一接口。上层只认这个接口，不关心底下是 WS 还是 HTTP。 */
export interface RpcTransport {
  call<T = unknown>(method: string, params?: unknown[]): Promise<T>
  close(): void
  readonly status: TransportStatus
}

/**
 * 组装请求体。
 *
 * secret 作为第一个参数注入，是 aria2 的硬性约定：
 *   params = ["token:mysecret", ...其余参数]
 */
function buildRequest(method: string, params: unknown[], secret: string | undefined, id: string): JsonRpcRequest {
  const finalParams = secret ? [`token:${secret}`, ...params] : [...params]
  return { jsonrpc: '2.0', id, method, params: finalParams }
}

/**
 * 从响应里取出 result，失败则抛出 RpcError。
 * 这是 JSON-RPC 的标准约定：HTTP 200 不代表调用成功，要看 body 里的 error 字段。
 */
function unwrap<T>(response: JsonRpcResponse<T>, method: string): T {
  if (!response || typeof response !== 'object') {
    throw new TransportError('服务端返回了非对象 JSON-RPC 响应', method)
  }
  if (response.error) {
    throw new RpcError(response.error.code, response.error.message, method)
  }
  return response.result as T
}

/* ------------------------------------------------------------------ *
 * HTTP 传输
 * ------------------------------------------------------------------ */

/**
 * 用 fetch + POST 实现 JSON-RPC。
 *
 * 注意：aria2 的 JSON-RPC 端点只接受 POST，GET 会返回 405。
 */
export class HttpRpcTransport implements RpcTransport {
  private currentStatus: TransportStatus = 'idle'
  private nextId = 1
  private closed = false
  private readonly controllers = new Set<AbortController>()

  constructor(private readonly options: TransportOptions) {}

  get status(): TransportStatus {
    return this.currentStatus
  }

  async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    if (this.closed) {
      throw new TransportError('连接已关闭', method)
    }

    const id = `http-${this.nextId++}`
    const body = buildRequest(method, params, this.options.secret, id)
    const timeout = this.options.timeoutMs ?? 15_000

    const controller = new AbortController()
    this.controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), timeout)
    this.setStatus('connecting')

    try {
      const response = await fetch(this.options.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new TransportError(`HTTP ${response.status} ${response.statusText}`, method)
      }

      const payload = (await response.json()) as JsonRpcResponse<T>
      if (!this.closed) this.setStatus('connected')
      return unwrap(payload, method)
    } catch (error) {
      if (error instanceof RpcError) {
        // 服务端明确拒绝 = 连接是通的，只是这次调用有问题
        if (!this.closed) this.setStatus('connected')
        throw error
      }
      if (!this.closed) {
        this.setStatus('error', error instanceof Error ? error.message : String(error))
      }
      if (error instanceof Error && error.name === 'AbortError') {
        if (this.closed) {
          throw new TransportError('连接已关闭', method, error)
        }
        throw new TransportError(`请求超时（${timeout}ms）`, method, error)
      }
      throw new TransportError(error instanceof Error ? error.message : String(error), method, error)
    } finally {
      clearTimeout(timer)
      this.controllers.delete(controller)
    }
  }

  close(): void {
    this.closed = true
    for (const controller of this.controllers) {
      controller.abort()
    }
    this.controllers.clear()
    this.setStatus('closed')
  }

  private setStatus(status: TransportStatus, detail?: string): void {
    if (this.currentStatus === status) return
    this.currentStatus = status
    this.options.onStatus?.(status, detail)
  }
}

/* ------------------------------------------------------------------ *
 * WebSocket 传输
 * ------------------------------------------------------------------ */

/** 一条尚未发送的请求，断线期间先排队。 */
interface QueuedCall {
  method: string
  params: unknown[]
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

/**
 * WebSocket 传输，带自动重连。
 *
 * 为什么不用 `system.multicall` 之类的高级特性？
 * 因为 aria2-next 的文档明确要求：probe 和 moveDownload 是异步方法，
 * 必须单独调用，不能放进 multicall 批量里。保持「一次一个方法」的简单模型更安全。
 */
interface PendingWsCall {
  resolve: (v: unknown) => void
  reject: (r: unknown) => void
  method: string
  timer?: ReturnType<typeof setTimeout>
}

export class WsRpcTransport implements RpcTransport {
  private socket: WebSocket | null = null
  private currentStatus: TransportStatus = 'idle'
  private nextId = 1
  /** 已发出但还没回来的请求 */
  private readonly pending = new Map<string, PendingWsCall>()
  /** 还没发出去的请求（断线时排队） */
  private readonly queue: QueuedCall[] = []
  private closedByUser = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly options: TransportOptions) {}

  get status(): TransportStatus {
    return this.currentStatus
  }

  call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    if (this.closedByUser) {
      return Promise.reject(new TransportError('连接已关闭', method))
    }
    return new Promise<T>((resolve, reject) => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send(method, params, resolve as (v: unknown) => void, reject)
      } else {
        // 还没连上：先排队，连上后自动补发
        this.queue.push({ method, params, resolve: resolve as (v: unknown) => void, reject })
        this.ensureConnected()
      }
    })
  }

  close(): void {
    this.closedByUser = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.rejectQueued(new TransportError('连接已关闭', 'close'))
    for (const [id, waiter] of this.pending) {
      this.pending.delete(id)
      if (waiter.timer) clearTimeout(waiter.timer)
      waiter.reject(new TransportError('连接已关闭', waiter.method))
    }
    this.socket?.close()
    this.socket = null
    this.setStatus('closed')
  }

  private rejectQueued(reason: TransportError): void {
    const queued = this.queue.splice(0, this.queue.length)
    for (const item of queued) {
      item.reject(new TransportError(reason.message, item.method, reason))
    }
  }

  private ensureConnected(): void {
    if (this.closedByUser) return
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return
    }
    this.setStatus(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting')

    let socket: WebSocket
    try {
      socket = new WebSocket(this.options.url)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.setStatus('error', msg)
      // 地址本身语法非法时重连只会空转死循环，直接把排队请求失败掉并停止
      this.rejectQueued(new TransportError(msg, 'connect'))
      return
    }
    this.socket = socket

    socket.onopen = () => {
      if (this.closedByUser || this.socket !== socket) {
        socket.close()
        return
      }
      this.reconnectAttempt = 0
      this.setStatus('connected')
      // 把断线期间排队的请求全部补发出去
      const queued = this.queue.splice(0, this.queue.length)
      for (const item of queued) {
        this.send(item.method, item.params, item.resolve, item.reject)
      }
    }

    socket.onmessage = (event: MessageEvent<string>) => {
      let payload: JsonRpcResponse
      try {
        payload = JSON.parse(event.data) as JsonRpcResponse
      } catch {
        return // 收到非法 JSON，忽略即可（服务端一般不会发非 JSON 帧）
      }
      if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string') {
        return
      }
      const waiter = this.pending.get(payload.id)
      if (!waiter) return
      this.pending.delete(payload.id)
      if (waiter.timer) clearTimeout(waiter.timer)
      try {
        waiter.resolve(unwrap(payload, waiter.method))
      } catch (error) {
        waiter.reject(error)
      }
    }

    socket.onerror = () => {
      // onerror 之后一定会触发 onclose，重连逻辑统一放在 onclose 里
      if (!this.closedByUser) this.setStatus('error')
    }

    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = null
      }
      // 连接断开时，所有在途请求都要失败掉，否则调用方会永远等下去
      for (const [id, waiter] of this.pending) {
        this.pending.delete(id)
        if (waiter.timer) clearTimeout(waiter.timer)
        waiter.reject(new TransportError('连接已断开', waiter.method))
      }
      if (!this.closedByUser) {
        this.setStatus('reconnecting')
        this.scheduleReconnect()
      }
    }
  }

  private send(
    method: string,
    params: unknown[],
    resolve: (value: unknown) => void,
    reject: (reason: unknown) => void,
  ): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      this.queue.push({ method, params, resolve, reject })
      this.ensureConnected()
      return
    }
    const id = `ws-${this.nextId++}`
    const body = buildRequest(method, params, this.options.secret, id)
    const timeout = this.options.timeoutMs ?? 15_000
    const timer =
      timeout > 0
        ? setTimeout(() => {
            const pending = this.pending.get(id)
            if (!pending) return
            this.pending.delete(id)
            pending.reject(new TransportError(`请求超时（${timeout}ms）`, method))
          }, timeout)
        : undefined
    this.pending.set(id, { resolve, reject, method, timer })
    try {
      socket.send(JSON.stringify(body))
    } catch (error) {
      this.pending.delete(id)
      if (timer) clearTimeout(timer)
      reject(new TransportError(error instanceof Error ? error.message : String(error), method, error))
    }
  }

  /** 指数退避重连：0.5s → 1s → 2s → … 最长 30s。 */
  private scheduleReconnect(): void {
    if (this.closedByUser || this.reconnectTimer) return
    const delay = Math.min(30_000, 500 * 2 ** this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.ensureConnected()
    }, delay)
  }

  private setStatus(status: TransportStatus, detail?: string): void {
    if (this.currentStatus === status) return
    this.currentStatus = status
    this.options.onStatus?.(status, detail)
  }
}

/**
 * 根据地址协议创建合适的传输实现。
 *
 * 这是「策略」而不是「分支」的典型例子：上层只依赖 RpcTransport 接口，
 * 新增一种传输（比如 SSE）只要再写一个实现即可，上层不用改。
 */
export function createTransport(options: TransportOptions): RpcTransport {
  const normalized = options.url.trim().toLowerCase()
  const isWebSocket = normalized.startsWith('ws://') || normalized.startsWith('wss://')
  return isWebSocket ? new WsRpcTransport(options) : new HttpRpcTransport(options)
}
