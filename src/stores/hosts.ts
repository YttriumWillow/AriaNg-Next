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

export const useHostsStore = defineStore('hosts', () => {
  /* ---------------- 配置 ---------------- */

  const hosts = ref<HostConfig[]>(
    loadJson<HostConfig[]>(STORAGE_KEYS.hosts, [DEFAULT_HOST]),
  )
  const activeHostId = ref<string>(loadJson<string>(STORAGE_KEYS.activeHostId, hosts.value[0]?.id ?? ''))

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

  function addHost(config: Omit<HostConfig, 'id'>): HostConfig {
    const host: HostConfig = { ...config, id: `host-${Date.now().toString(36)}` }
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
    }
  }

  function removeHost(hostId: string): void {
    disconnect(hostId)
    hosts.value = hosts.value.filter((host) => host.id !== hostId)
    removeClient(hostId)
    delete runtimes[hostId]
    if (activeHostId.value === hostId) {
      activeHostId.value = hosts.value[0]?.id ?? ''
    }
    persist()
  }

  function selectHost(hostId: string): void {
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

    const transport = createTransport({
      url: host.url,
      secret: host.secret.trim() || undefined,
      onStatus: (status, detail) => {
        runtime.status = status
        if (detail && status === 'error') runtime.error = detail
      },
    })

    const client = new Aria2Client(transport)
    setClient(hostId, client)

    try {
      // 能力探测：先问清楚后端支持什么，再决定 UI 显示哪些功能
      runtime.capabilities = await probeCapabilities(client)
      runtime.status = 'connected'
      startPolling(hostId, client)
    } catch (error) {
      runtime.status = 'error'
      runtime.error = describeError(error)
    }
  }

  /** 断开某个主机。 */
  function disconnect(hostId: string): void {
    pollers.get(hostId)?.stop()
    pollers.delete(hostId)
    removeClient(hostId)
    const runtime = runtimes[hostId]
    if (runtime) {
      runtime.status = 'closed'
      runtime.capabilities = null
    }
  }

  /** 启动轮询。 */
  function startPolling(hostId: string, client: Aria2Client): void {
    const host = hosts.value.find((item) => item.id === hostId)
    const runtime = runtimeFor(hostId)
    const tasks = useTasksStore()

    const poller = new Poller({
      intervalMs: host?.pollIntervalMs ?? 1000,
      onError: (error) => {
        runtime.error = describeError(error)
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
