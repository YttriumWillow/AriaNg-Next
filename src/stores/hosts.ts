/**
 * 多主机连接 store。
 *
 * 负责：
 *  - 主机配置的增删改查（持久化到 localStorage）
 *  - 建立/断开与 aria2-next 的连接
 *  - 能力探测（getVersion + system.listMethods）
 *  - 驱动轮询，把数据写进 tasks store
 */

import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { Aria2Client } from '@/core/rpc/aria2'
import { describeError } from '@/core/rpc/errors'
import { getClient, removeClient, setClient } from '@/core/rpc/registry'
import { createTransport, type TransportStatus } from '@/core/rpc/transport'
import { probeCapabilities, type Capabilities } from '@/core/model/capability'
import { Poller } from '@/core/scheduler/poller'
import { loadJson, saveJson, STORAGE_KEYS } from '@/core/storage/persist'
import { useI18n } from '@/i18n'
import { useTasksStore } from './tasks'

/** 一台 aria2-next 主机的配置。 */
export interface HostConfig {
  id: string
  /** 显示名称 */
  name: string
  /** RPC 端点，例如 ws://192.168.1.10:6800/jsonrpc */
  url: string
  /** rpc-secret，留空表示未启用鉴权 */
  secret: string
  /** 轮询间隔（毫秒） */
  pollIntervalMs: number
  /** 页面加载时是否自动连接 */
  autoConnect: boolean
}

/** 某个主机的运行时状态。 */
export interface HostRuntime {
  status: TransportStatus
  capabilities: Capabilities | null
  /** 最近一次错误描述 */
  error: string
  /** 最近一次成功同步的时间戳 */
  lastSyncAt: number | null
}

/** 默认主机：指向本机 aria2-next 的默认端口。 */
export const DEFAULT_HOST: HostConfig = {
  id: 'default',
  name: '本机 aria2-next',
  url: 'ws://127.0.0.1:6800/jsonrpc',
  secret: '',
  pollIntervalMs: 1000,
  autoConnect: true,
}

/**
 * 修掉重复的主机 id。
 *
 * ⚠️ 这段历史包袱值得单独说明：
 *
 * 早期版本用 `host-${Date.now().toString(36)}` 生成 id。Date.now() 的精度只有
 * **毫秒**，而用户完全可能在同一毫秒里添加两台主机 —— 比如照着一份配置文档
 * 连着填两行再点两次保存。两台主机会拿到**完全相同的 id**。
 *
 * 后果很隐蔽：hosts 数组里确实有两条记录，但所有按 id 查找的操作
 * （selectHost / updateHost / removeHost / runtimeFor）都只会命中**第一条**。
 * 第二台从界面上看「连接正常、状态点是绿的」，你却永远切不过去，
 * 点它的名字也只会操作第一台 —— 一个连上了但摸不到的幽灵主机。
 *
 * 现在生成 id 的逻辑已经加了随机后缀（见 generateHostId），
 * 但用户的浏览器里可能还存着旧版本写下的脏数据，
 * 所以加载时顺手去重一次，保证存量用户也不会中招。
 *
 * 去重策略：**保留第一台的 id 不动**，只给后面的重复项换新 id。
 * 这样 activeHostId 指向的仍然是原来那台，行为符合直觉。
 */
export function dedupeHostIds(list: HostConfig[]): { list: HostConfig[]; changed: boolean } {
  const seen = new Set<string>()
  let changed = false

  const result = list.map((host) => {
    if (!seen.has(host.id)) {
      seen.add(host.id)
      return host
    }
    changed = true
    // 换一个当前列表里没人用的 id
    let id = ''
    do {
      id = `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    } while (seen.has(id))
    seen.add(id)
    return { ...host, id }
  })

  return { list: result, changed }
}

/** 清洗从 localStorage 读出来的主机列表，防止坏 JSON 或缺字段导致初始化崩溃。 */
function sanitizeHosts(raw: unknown): HostConfig[] {
  if (!Array.isArray(raw)) return [{ ...DEFAULT_HOST }]

  const cleaned: HostConfig[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const url = typeof record.url === 'string' && record.url.trim() ? record.url.trim() : ''
    if (!url) continue

    const poll = typeof record.pollIntervalMs === 'number' && Number.isFinite(record.pollIntervalMs)
      ? Math.max(200, Math.round(record.pollIntervalMs))
      : 1000

    cleaned.push({
      id: typeof record.id === 'string' && record.id.trim() ? record.id : `host-${cleaned.length + 1}`,
      name: typeof record.name === 'string' ? record.name : '',
      url,
      secret: typeof record.secret === 'string' ? record.secret : '',
      pollIntervalMs: poll,
      autoConnect: typeof record.autoConnect === 'boolean' ? record.autoConnect : true,
    })
  }

  return cleaned.length > 0 ? cleaned : [{ ...DEFAULT_HOST }]
}

export const useHostsStore = defineStore('hosts', () => {
  /*
   * 错误提示要跟着界面语言走，所以这里拿一份翻译函数。
   *
   * core 的 describeError 不认识 i18n（它是零框架依赖的纯 TS），
   * 做法是把 t() 当参数传进去 —— 和 taskStatusText 一个套路。
   */
  const { t } = useI18n()

  /* ---------------- 配置 ---------------- */

  const initialHosts = sanitizeHosts(loadJson<unknown>(STORAGE_KEYS.hosts, [DEFAULT_HOST]))
  const deduped = dedupeHostIds(initialHosts)

  const hosts = ref<HostConfig[]>(deduped.list)

  /*
   * activeHostId 要做一次存在性校验。
   *
   * 它是从 localStorage 里读出来的缓存值，完全可能指向一台已经被删掉的主机
   * （比如用户在另一个标签页删了，这边的缓存还没刷新）。
   * 这种情况下如果直接沿用，所有按 activeHostId 取数据的 computed 都会拿到
   * undefined，界面表现是「一片空白但也不报错」—— 最难排查的那种问题。
   */
  const storedActiveHostId = loadJson<string>(STORAGE_KEYS.activeHostId, '')
  const activeHostId = ref<string>(
    hosts.value.some((host) => host.id === storedActiveHostId)
      ? storedActiveHostId
      : (hosts.value[0]?.id ?? ''),
  )

  /** 每个主机的运行时状态。用 reactive 而不是 ref，方便按 id 动态增删。 */
  const runtimes = reactive<Record<string, HostRuntime>>({})

  /** 每个主机的轮询器。 */
  const pollers = new Map<string, Poller>()

  function runtimeFor(hostId: string): HostRuntime {
    if (!runtimes[hostId]) {
      runtimes[hostId] = { status: 'idle', capabilities: null, error: '', lastSyncAt: null }
    }
    /*
     * ⚠️⚠️ 必须 return 重新从 reactive 代理里读出来的值，不能 return 上面那个原始对象。
     *
     * 这是一个极其隐蔽的 Vue 3 坑：
     *
     *   runtimes 是 reactive()，往里赋值时，Vue 存的是**原始对象**；
     *   之后再读 runtimes[hostId]，拿到的才是它的**响应式代理**。
     *
     * 如果我们把创建时的原始对象直接 return 出去，后面所有的
     *   runtime.status = 'connected'
     * 都是写在这个原始对象上 —— **绕过了代理，Vue 完全收不到通知**，
     * 界面不会重新渲染，状态就永远停在 'connecting'。
     *
     * 只有「写代理」才会触发依赖收集与更新。所以这里必须再读一次，
     * 让返回值变成代理。
     */
    return runtimes[hostId]
  }

  const activeHost = computed(() => hosts.value.find((host) => host.id === activeHostId.value) ?? null)
  const activeRuntime = computed(() => (activeHostId.value ? runtimeFor(activeHostId.value) : null))

  function persist(): void {
    saveJson(STORAGE_KEYS.hosts, hosts.value)
    saveJson(STORAGE_KEYS.activeHostId, activeHostId.value)
  }

  /* ---------------- 增删改 ---------------- */

  /**
   * 生成一个当前列表里没人用的主机 id。
   *
   * ⚠️ 千万不要图省事只用 `Date.now().toString(36)`。
   *
   * Date.now() 的精度是**毫秒**。用户照着配置文档连着添加两台主机时，
   * 两次点击完全可能落在同一毫秒里 —— 那么两台主机会拿到同一个 id，
   * 界面就再也切不过去第二台了（详见 dedupeHostIds 的注释）。
   *
   * 所以这里用「时间戳 + 随机后缀」，并且额外做一次冲突检测兜底。
   * 随机后缀用的是 Math.random().toString(36).slice(2, 8)：
   *   toString(36) 把数字转成 36 进制字符串（0-9a-z），
   *   slice(2, 8) 去掉开头恒定的 "0."，取 6 位有效字符。
   */
  function generateHostId(): string {
    const taken = hosts.value.map((host) => host.id)
    let id = ''
    do {
      id = `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    } while (taken.includes(id))
    return id
  }

  function addHost(config: Omit<HostConfig, 'id'>): HostConfig {
    const host: HostConfig = { ...config, id: generateHostId() }
    hosts.value.push(host)
    persist()
    return host
  }

  function updateHost(hostId: string, patch: Partial<HostConfig>): void {
    const index = hosts.value.findIndex((host) => host.id === hostId)
    if (index === -1) return
    hosts.value[index] = { ...hosts.value[index], ...patch }
    persist()
    // 地址或密钥变了，需要重连
    if (patch.url !== undefined || patch.secret !== undefined) {
      void connect(hostId)
    } else if (patch.pollIntervalMs !== undefined) {
      const client = getClient(hostId)
      if (client && runtimeFor(hostId).status === 'connected') {
        startPolling(hostId, client)
      }
    }
  }

  function removeHost(hostId: string): void {
    disconnect(hostId)
    hosts.value = hosts.value.filter((host) => host.id !== hostId)
    removeClient(hostId)
    delete runtimes[hostId]
    if (activeHostId.value === hostId) {
      activeHostId.value = hosts.value[0]?.id ?? ''
      useTasksStore().closeDetail()
    }
    persist()
  }

  function selectHost(hostId: string): void {
    if (activeHostId.value !== hostId) {
      useTasksStore().closeDetail()
    }
    activeHostId.value = hostId
    persist()
  }

  /* ---------------- 连接 ---------------- */

  /** 连接（或重连）某个主机。 */
  async function connect(hostId: string): Promise<void> {
    const host = hosts.value.find((item) => item.id === hostId)
    if (!host) return

    // 先断开旧的，避免两个 transport 同时存在
    disconnect(hostId)

    const runtime = runtimeFor(hostId)
    runtime.status = 'connecting'
    runtime.error = ''

    const client = new Aria2Client(
      createTransport({
        url: host.url,
        secret: (host.secret ?? '').trim() || undefined,
        onStatus: (status, detail) => {
          // 如果已经有更新的连接替代了当前客户端，旧 transport 的迟到事件必须忽略
          if (getClient(hostId) !== client) return
          runtime.status = status
          if (detail && status === 'error') runtime.error = detail
        },
      }),
    )
    setClient(hostId, client)

    try {
      // 能力探测：先问清楚后端支持什么，再决定 UI 显示哪些功能
      const capabilities = await probeCapabilities(client)
      // 异步等待期间可能被重连、断开或删库；只有仍是当前客户端时才继续接管
      if (getClient(hostId) !== client) {
        client.connection.close()
        return
      }
      runtime.capabilities = capabilities
      runtime.status = 'connected'
      startPolling(hostId, client)
    } catch (error) {
      if (getClient(hostId) !== client) return
      // 探测失败就彻底关掉 transport，防止 WS 后台重连后把状态点刷成绿色「幽灵已连接」
      client.connection.close()
      removeClient(hostId)
      runtime.status = 'error'
      runtime.error = describeError(error, t)
    }
  }

  /** 断开某个主机。 */
  function disconnect(hostId: string): void {
    pollers.get(hostId)?.stop()
    pollers.delete(hostId)
    getClient(hostId)?.connection.close()
    removeClient(hostId)
    const runtime = runtimes[hostId]
    if (runtime) {
      runtime.status = 'closed'
      runtime.capabilities = null
    }
  }

  /** 启动轮询。 */
  function startPolling(hostId: string, client: Aria2Client): void {
    // 防止同主机残留旧轮询器并行触发
    pollers.get(hostId)?.stop()

    const host = hosts.value.find((item) => item.id === hostId)
    const runtime = runtimeFor(hostId)
    const tasks = useTasksStore()

    const poller = new Poller({
      intervalMs: Math.max(200, host?.pollIntervalMs ?? 1000),
      onError: (error) => {
        runtime.error = describeError(error, t)
      },
    })

    poller.start(async () => {
      await tasks.refresh(hostId, client)
      runtime.lastSyncAt = Date.now()
    })

    pollers.set(hostId, poller)
  }

  /** 立即刷新一次（用户手动点刷新时用）。 */
  function refreshNow(hostId: string): void {
    const poller = pollers.get(hostId)
    const client = getClient(hostId)
    if (!poller || !client) return

    const runtime = runtimeFor(hostId)
    const tasks = useTasksStore()
    poller.trigger(async () => {
      await tasks.refresh(hostId, client)
      runtime.lastSyncAt = Date.now()
    })
  }

  return {
    hosts,
    activeHostId,
    activeHost,
    activeRuntime,
    runtimes,
    runtimeFor,
    addHost,
    updateHost,
    removeHost,
    selectHost,
    connect,
    disconnect,
    refreshNow,
  }
})
