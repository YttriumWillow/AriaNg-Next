/**
 * 可靠性与回归测试。
 *
 * 锁定本轮审核与压测中暴露出来的核心边界缺陷：
 *  1. WsRpcTransport 帧健壮性、关闭队列拒绝、超时、非法 URL 不空转
 *  2. Poller 并发 trigger 防重入与 stop 后静默
 *  3. hosts / tasks store 断开关闭传输、connect 代际防竞态、失败不留绿点僵尸、refresh 异常冒泡退避
 *  4. 损坏的 localStorage 缓存容错（hosts / appearance / i18n）
 *  5. CSS 令牌与毛玻璃背景图防注入、未闭合注释检测
 *  6. 媒体非直播 ETA、省略 remainingLength 兜底与 URL API 多参数往返
 */
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createTransport, WsRpcTransport } from '@/core/rpc/transport'
import { TransportError } from '@/core/rpc/errors'
import { Poller } from '@/core/scheduler/poller'
import { buildTokenLayer } from '@/core/theme/theme'
import { validateCss } from '@/core/css/validate'
import { computeEta, normalizeTask } from '@/core/model/task'
import { buildUrlApi, parseUrlApi } from '@/core/api/urlApi'
import { STORAGE_KEYS } from '@/core/storage/persist'

interface MockSocket {
  send(data: string): void
  terminate(): void
  on(event: 'message', cb: (raw: Buffer | string) => void): void
  on(event: 'close', cb: () => void): void
}

interface MockWsServer {
  clients: Set<MockSocket>
  address(): { port: number } | string | null
  once(event: 'listening', cb: () => void): void
  on(event: 'connection', cb: (socket: MockSocket) => void): void
  close(cb: () => void): void
}

const require = createRequire(import.meta.url)
const { WebSocketServer } = require('ws') as {
  WebSocketServer: new (opts: { port: number }) => MockWsServer
}

const servers: MockWsServer[] = []

async function startWsServer(): Promise<{ port: number; wss: MockWsServer }> {
  const wss = new WebSocketServer({ port: 0 })
  servers.push(wss)
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()))
  const addr = wss.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return { port, wss }
}

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  while (servers.length > 0) {
    const wss = servers.pop()!
    for (const client of wss.clients) client.terminate()
    await new Promise<void>((resolve) => wss.close(() => resolve()))
  }
})

describe('传输层可靠性', () => {
  it('createTransport 忽略首尾空格与协议大小写', () => {
    const ws = createTransport({ url: '  WS://127.0.0.1:6801/jsonrpc ' })
    expect(ws).toBeInstanceOf(WsRpcTransport)
    ws.close()
  })

  it('收到 JSON null 帧时不会抛出未捕获异常', async () => {
    const { port, wss } = await startWsServer()
    wss.on('connection', (socket) => {
      socket.on('message', (raw) => {
        const req = JSON.parse(String(raw)) as { id: string }
        socket.send('null')
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { product: 'aria2-next', version: '3.1.0' } }))
      })
    })

    const transport = new WsRpcTransport({ url: `ws://127.0.0.1:${port}/jsonrpc` })
    const version = await transport.call<{ product: string }>('aria2.getVersion')
    expect(version.product).toBe('aria2-next')
    transport.close()
  })

  it('close() 会拒绝所有排队请求，且关闭后再调用会立即失败', async () => {
    const { port } = await startWsServer()
    const transport = new WsRpcTransport({ url: `ws://127.0.0.1:${port}/jsonrpc` })

    const pending = transport.call('aria2.getVersion')
    transport.close()
    await expect(pending).rejects.toBeInstanceOf(TransportError)
    await expect(transport.call('aria2.getVersion')).rejects.toBeInstanceOf(TransportError)
  })

  it('静默无响应的 WS 服务端会按 timeoutMs 超时返回', async () => {
    const { port } = await startWsServer()
    const transport = new WsRpcTransport({ url: `ws://127.0.0.1:${port}/jsonrpc`, timeoutMs: 80 })
    await expect(transport.call('aria2.getVersion')).rejects.toThrow(/超时/)
    transport.close()
  })

  it('语法非法的 WS URL 不会启动无限重连定时器', async () => {
    vi.useFakeTimers()
    const transport = new WsRpcTransport({ url: 'ws://[::invalid' })
    await expect(transport.call('aria2.getVersion')).rejects.toBeInstanceOf(TransportError)
    expect(vi.getTimerCount()).toBe(0)
    transport.close()
  })
})

describe('Poller 调度防泄漏', () => {
  it('ticking 期间连续 trigger 不会叠出多个并行定时器', async () => {
    vi.useFakeTimers()
    const poller = new Poller({ intervalMs: 1000 })
    let runs = 0
    let release!: () => void

    const slowTick = () =>
      new Promise<void>((resolve) => {
        runs += 1
        release = resolve
      })

    poller.start(slowTick)
    await vi.advanceTimersByTimeAsync(0)
    expect(runs).toBe(1)

    poller.trigger(slowTick)
    poller.trigger(slowTick)
    release()
    await Promise.resolve()

    await vi.advanceTimersByTimeAsync(1000)
    expect(runs).toBe(2)
    poller.stop()
  })
})

describe('Store 生命周期与坏缓存容错', () => {
  it('disconnect 会关闭底层 WS，connect 竞态与失败不会残留绿点连接', async () => {
    const { port, wss } = await startWsServer()
    let openSockets = 0
    let closeSockets = 0
    wss.on('connection', (socket) => {
      openSockets += 1
      socket.on('close', () => {
        closeSockets += 1
      })
      socket.on('message', (raw) => {
        const req = JSON.parse(String(raw)) as { id: string; method: string }
        if (req.method === 'aria2.getVersion') {
          socket.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: req.id,
              result: { product: 'aria2-next', version: '3.1.0', enabledFeatures: [], mediaFeatures: [], downloadFeatures: [] },
            }),
          )
        } else {
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: [] }))
        }
      })
    })

    setActivePinia(createPinia())
    const { useHostsStore } = await import('@/stores/hosts')
    const hosts = useHostsStore()
    const host = hosts.addHost({
      name: 'Test',
      url: `ws://127.0.0.1:${port}/jsonrpc`,
      secret: '',
      pollIntervalMs: 1000,
      autoConnect: false,
    })

    await hosts.connect(host.id)
    await hosts.connect(host.id)
    hosts.disconnect(host.id)

    await new Promise((r) => setTimeout(r, 40))
    expect(openSockets).toBe(2)
    expect(closeSockets).toBe(2)
  })

  it('慢速首次 connect 在新连接完成后才失败时，不会覆盖新连接状态', async () => {
    const { port, wss } = await startWsServer()
    let connCount = 0
    wss.on('connection', (socket) => {
      connCount += 1
      const current = connCount
      socket.on('message', (raw) => {
        const req = JSON.parse(String(raw)) as { id: string; method: string }
        if (current === 1 && req.method === 'aria2.getVersion') {
          setTimeout(() => {
            socket.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: 1, message: 'slow fail' } }))
          }, 120)
        } else if (req.method === 'aria2.getVersion') {
          socket.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: req.id,
              result: { product: 'aria2-next', version: '9.9.9', enabledFeatures: [], mediaFeatures: [], downloadFeatures: [] },
            }),
          )
        } else {
          socket.send(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: [] }))
        }
      })
    })

    setActivePinia(createPinia())
    const { useHostsStore } = await import('@/stores/hosts')
    const hosts = useHostsStore()
    const host = hosts.addHost({
      name: 'Race',
      url: `ws://127.0.0.1:${port}/jsonrpc`,
      secret: '',
      pollIntervalMs: 5000,
      autoConnect: false,
    })

    const slowFirst = hosts.connect(host.id)
    await new Promise((r) => setTimeout(r, 20))
    await hosts.connect(host.id)
    await slowFirst

    expect(hosts.runtimeFor(host.id).status).toBe('connected')
    expect(hosts.runtimeFor(host.id).capabilities?.version).toBe('9.9.9')
    hosts.disconnect(host.id)
  })

  it('tasks.refresh 失败时会向上抛出异常以触发 Poller 退避', async () => {
    setActivePinia(createPinia())
    const { useTasksStore } = await import('@/stores/tasks')
    const tasks = useTasksStore()
    const fakeClient = {
      tellActive: async () => {
        throw new TransportError('boom', 'aria2.tellActive')
      },
      tellWaiting: async () => [],
      tellStopped: async () => [],
      getGlobalStat: async () => ({ downloadSpeed: '0', uploadSpeed: '0', numActive: '0', numWaiting: '0', numStopped: '0' }),
    }

    await expect(tasks.refresh('h1', fakeClient as never)).rejects.toThrow('boom')
  })

  it('localStorage 存有错误类型 JSON 时不会崩溃', async () => {
    const store = new Map<string, string>([
      [STORAGE_KEYS.hosts, 'null'],
      [STORAGE_KEYS.appearance, '{"customCss":123,"tokenOverrides":null,"glassBackdrop":42}'],
      [STORAGE_KEYS.locale, '"fr"'],
    ])
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    })

    vi.resetModules()
    setActivePinia(createPinia())
    const { useHostsStore } = await import('@/stores/hosts')
    const { useAppearanceStore } = await import('@/stores/appearance')
    const { t } = await import('@/i18n')

    const hosts = useHostsStore()
    const appearance = useAppearanceStore()
    expect(hosts.hosts.length).toBeGreaterThan(0)
    expect(appearance.settings.customCss).toBe('')
    expect(t('nav.dashboard')).toBe('仪表盘')
  })
})

describe('CSS 安全与数据规整边界', () => {
  it('buildTokenLayer 拦截非法变量名与带逃逸字符的值', () => {
    const css = buildTokenLayer({
      '--an-accent': '#b8435f',
      'color: red; } body { display: none': '1',
      '--bad': 'red; } body { display: none',
    })
    expect(css).toContain('--an-accent: #b8435f;')
    expect(css).not.toContain('body { display: none')
  })

  it('sanitizeBackdropUrl 拒绝可闭合 url() 的恶意地址', async () => {
    const { sanitizeBackdropUrl } = await import('@/stores/appearance')
    expect(sanitizeBackdropUrl('https://example.com/bg.png')).toBe('https://example.com/bg.png')
    expect(sanitizeBackdropUrl('x.png"); } body { display: none; } /*')).toBeNull()
    expect(sanitizeBackdropUrl('javascript:alert(1)')).toBeNull()
  })

  it('validateCss 能发现未闭合注释并定位起始行', () => {
    const diag = validateCss('.a { color: red; }\n/* unclosed\n.b { color: blue; }')
    expect(diag).not.toBeNull()
    expect(diag?.line).toBe(2)
  })

  it('computeEta 对 live === "false" 媒体正常计算剩余时长且省略 remainingLength 时兜底', () => {
    const task = normalizeTask({
      gid: 'g1',
      status: 'active',
      totalLength: '1000',
      completedLength: '400',
      uploadLength: '0',
      downloadSpeed: '200',
      uploadSpeed: '0',
      dir: '/dl',
    })
    expect(task.remainingLength).toBe(600)
    expect(task.etaSeconds).toBe(3)

    const vodEta = computeEta(
      {
        gid: 'g2',
        status: 'active',
        totalLength: '0',
        completedLength: '0',
        uploadLength: '0',
        downloadSpeed: '100',
        uploadSpeed: '0',
        dir: '/dl',
        media: {
          state: 'downloading',
          protocol: 'hls',
          live: 'false',
          duration: '120000',
          completedDuration: '30000',
          downloadedLength: '0',
          progress: '0.25',
          lengthKnown: 'true',
          tracks: [],
          error: '',
          errorCode: '',
        },
      },
      0,
      100,
    )
    expect(vodEta).toBe(90)
  })

  it('buildUrlApi 保留多条同动作 URL 往返不变', () => {
    const parsed = parseUrlApi('?addUrl=https://a.example/1.iso&addUrl=https://b.example/2.iso')
    expect(parseUrlApi(buildUrlApi(parsed))).toEqual(parsed)
  })
})
