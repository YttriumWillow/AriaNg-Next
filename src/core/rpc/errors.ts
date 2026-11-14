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

/**
 * 判断一个错误是不是「鉴权失败」。
 *
 * aria2 在 rpc-secret 不匹配时返回 JSON-RPC error，code = 1，
 * message 是 "Unauthorized"。这个信息**必须被翻译成人能行动的话** ——
 * 光把 "Unauthorized" 甩给用户，等于让用户自己猜要去哪找密钥。
 */
export function isUnauthorized(error: unknown): boolean {
  if (!(error instanceof RpcError)) return false
  return /unauthorized|authorization|permission denied|forbidden/i.test(error.message)
}

/**
 * 翻译函数的最小签名。
 *
 * core 是零框架依赖的纯 TS，不认识 i18n。
 * 所以这里用「把翻译函数当参数注入」的方式 ——
 * 和 core/model/task.ts 里的 taskStatusText 是同一个套路。
 */
export type Translate = (key: string, params?: Record<string, string | number>) => string

/**
 * 把任意异常转成一句给用户看的话。
 *
 * @param t 可选的翻译函数。不传时退回内置中文文案，
 *          这样 core 依然可以独立使用和测试。
 */
export function describeError(error: unknown, t?: Translate): string {
  // 鉴权失败要单独处理：它是用户**能自己解决**的问题，
  // 必须明确告诉他「去填 RPC 密钥」，而不是丢一个英文单词了事。
  if (isUnauthorized(error)) {
    return t?.('error.unauthorized') ?? '该主机要求 RPC 密钥：请点「编辑」填入 rpc-secret'
  }
  if (error instanceof RpcError) {
    return t?.('error.rpcRejected', { message: error.message }) ?? `服务端拒绝：${error.message}`
  }
  if (error instanceof TransportError) {
    return t?.('error.transportFailed', { message: error.message }) ?? `连接失败：${error.message}`
  }
  if (error instanceof Error) return error.message
  return String(error)
}
