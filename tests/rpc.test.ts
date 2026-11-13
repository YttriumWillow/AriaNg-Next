/**
 * JSON-RPC 传输层的单元测试。
 *
 * 用假的 fetch 来验证请求体格式与错误处理，
 * 不需要真的起一个 aria2 服务。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpRpcTransport } from '@/core/rpc/transport'
import { RpcError, TransportError, describeError, isMethodNotFound } from '@/core/rpc/errors'

/** 构造一个成功的 JSON-RPC 响应。 */
function okResponse(result: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ jsonrpc: '2.0', id: '1', result }),
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HttpRpcTransport', () => {
  it('发送的请求体符合 JSON-RPC 2.0 规范', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse(['gid-1']))
    vi.stubGlobal('fetch', fetchMock)

    const transport = new HttpRpcTransport({ url: 'http://localhost:6800/jsonrpc' })
    const result = await transport.call<string[]>('aria2.tellActive')

    expect(result).toEqual(['gid-1'])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:6800/jsonrpc')
    expect(init.method).toBe('POST')

    const body = JSON.parse(String(init.body))
    expect(body.jsonrpc).toBe('2.0')
    expect(body.method).toBe('aria2.tellActive')
    expect(body.id).toBeTruthy()
    expect(body.params).toEqual([])
  })

  it('设置了 secret 时，token 被插到第一个参数位置', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse('ok'))
    vi.stubGlobal('fetch', fetchMock)

    const transport = new HttpRpcTransport({
      url: 'http://localhost:6800/jsonrpc',
      secret: 'mysecret',
    })
    await transport.call('aria2.pause', ['gid-1'])

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body.params).toEqual(['token:mysecret', 'gid-1'])
  })

  it('服务端返回 error 对象时抛 RpcError（而不是当成成功）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          jsonrpc: '2.0',
          id: '1',
          error: { code: 1, message: 'No such method' },
        }),
      })),
    )

    const transport = new HttpRpcTransport({ url: 'http://localhost:6800/jsonrpc' })
    await expect(transport.call('aria2.nope')).rejects.toBeInstanceOf(RpcError)
  })

  it('HTTP 状态码非 2xx 时抛 TransportError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })),
    )

    const transport = new HttpRpcTransport({ url: 'http://localhost:6800/jsonrpc' })
    await expect(transport.call('aria2.tellActive')).rejects.toBeInstanceOf(TransportError)
  })

  it('网络异常被包装成 TransportError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )

    const transport = new HttpRpcTransport({ url: 'http://localhost:6800/jsonrpc' })
    await expect(transport.call('aria2.tellActive')).rejects.toBeInstanceOf(TransportError)
  })
})

describe('isMethodNotFound', () => {
  it('识别 code = -32601', () => {
    expect(isMethodNotFound(new RpcError(-32601, 'Method not found'))).toBe(true)
  })

  it('识别 aria2 的 "No such method"', () => {
    expect(isMethodNotFound(new RpcError(1, 'No such method'))).toBe(true)
  })

  it('其它错误不算「方法不存在」', () => {
    expect(isMethodNotFound(new RpcError(1, 'Bad request'))).toBe(false)
    expect(isMethodNotFound(new Error('boom'))).toBe(false)
  })
})

describe('describeError', () => {
  it('把不同错误翻译成中文提示', () => {
    expect(describeError(new RpcError(1, 'x'))).toContain('服务端拒绝')
    expect(describeError(new TransportError('x'))).toContain('连接失败')
    expect(describeError(new Error('plain'))).toBe('plain')
  })
})
