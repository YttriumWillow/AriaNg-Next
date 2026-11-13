/**
 * 错误类型。
 *
 * 把「传输层失败」和「服务端返回的业务错误」分开，
 * 上层才能决定：前者该重试 / 弹连接提示，后者该提示用户操作有误。
 */

/** 网络层面的失败：连不上、超时、连接被关闭等。可以重试。 */
export class TransportError extends Error {
  constructor(
    message: string,
    /** 触发错误的方法名，方便在日志里定位 */
    readonly method?: string,
    /** cause 是 Error 基类上的标准字段（ES2022），这里覆盖它以保留原始错误 */
    override readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'TransportError'
  }
}

/** 服务端返回了 JSON-RPC error 对象。说明请求到了，但被拒绝了。 */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly method?: string,
  ) {
    super(message)
    this.name = 'RpcError'
  }
}

/**
 * 判断一个错误是不是「方法不存在」。
 *
 * aria2 对未知方法返回 code = 1（"No such method"）或 code = -32601（JSON-RPC 标准错误）。
 * 能力探测（capability.ts）依赖这个判断来区分「后端不支持」和「真的出错了」。
 */
export function isMethodNotFound(error: unknown): boolean {
  if (!(error instanceof RpcError)) return false
  if (error.code === -32601) return true
  return /no such method|method not found|unknown method/i.test(error.message)
}

/** 把任意异常转成一句给用户看的话。 */
export function describeError(error: unknown): string {
  if (error instanceof RpcError) return `服务端拒绝：${error.message}`
  if (error instanceof TransportError) return `连接失败：${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}
