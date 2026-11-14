/**
 * 错误提示的单元测试。
 *
 * 这里锁的是一条来自真实反馈的改进：
 *
 * 用户的原话是「手动添加主机失败了」—— 界面上只显示
 * 「服务端拒绝：Unauthorized」。这句话**没有任何可操作性**：
 * 用户不知道 Unauthorized 是什么意思，更不知道该去填 RPC 密钥。
 *
 * 所以 Unauthorized 必须被翻译成一句「你可以怎么做」的话。
 *
 * 另外，错误文案以前是硬编码中文，英文界面下会露馅 ——
 * 现在改成「翻译函数注入」，core 依然不依赖 i18n。
 */
import { describe, expect, it } from 'vitest'
import { describeError, isUnauthorized, RpcError, TransportError } from '@/core/rpc/errors'

/** 一个假翻译函数：直接变成 `t:<key>`，方便断言。 */
const t = (key: string, params?: Record<string, string | number>) => {
  let text = `t:${key}`
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value))
  }
  return text
}

describe('isUnauthorized', () => {
  it('能认出 aria2 的鉴权失败', () => {
    expect(isUnauthorized(new RpcError(1, 'Unauthorized', 'aria2.getVersion'))).toBe(true)
  })

  it('其它服务端错误不算鉴权失败', () => {
    expect(isUnauthorized(new RpcError(1, 'No such method', 'aria2.foo'))).toBe(false)
    expect(isUnauthorized(new TransportError('连接被关闭'))).toBe(false)
    expect(isUnauthorized(new Error('随便什么错'))).toBe(false)
  })
})

describe('describeError', () => {
  it('鉴权失败时给出可操作的提示', () => {
    const error = new RpcError(1, 'Unauthorized', 'aria2.getVersion')
    const text = describeError(error, t)

    // 必须指向「填 rpc-secret」这个具体动作
    expect(text).toBe('t:error.unauthorized')
    expect(text).not.toContain('Unauthorized')
  })

  it('不传翻译函数时退回中文兜底', () => {
    const error = new RpcError(1, 'Unauthorized', 'aria2.getVersion')
    const text = describeError(error)

    expect(text).toContain('rpc-secret')
    expect(text).not.toContain('Unauthorized')
  })

  it('普通服务端错误带上原始消息', () => {
    const error = new RpcError(1, 'No such method', 'aria2.foo')
    expect(describeError(error, t)).toBe('t:error.rpcRejected')
  })

  it('传输层错误走另一套文案', () => {
    expect(describeError(new TransportError('连接被关闭'), t)).toBe('t:error.transportFailed')
  })

  it('普通异常原样透出', () => {
    expect(describeError(new Error('随便什么错'), t)).toBe('随便什么错')
  })

  it('非异常值转成字符串', () => {
    expect(describeError('字符串错误', t)).toBe('字符串错误')
  })
})
