/**
 * 多主机管理的回归测试。
 *
 * 这里锁的是一个真实存在过的 bug —— **主机 id 撞车**。
 *
 * 起因：早期版本用 `host-${Date.now().toString(36)}` 生成主机 id。
 * Date.now() 只有毫秒精度，而用户照着配置文档连着添加两台主机时，
 * 两次点击完全可能落在同一毫秒里，于是两台主机的 id 完全相同。
 *
 * 后果极其隐蔽：hosts 数组里确实有两条记录，侧栏也确实渲染出两个状态点，
 * 但所有按 id 查找的操作（selectHost / updateHost / removeHost / runtimeFor）
 * 都只会命中第一条。第二台于是变成一个「连接正常、状态点绿着、
 * 但你永远切不过去」的幽灵主机 —— 点它的名字，实际操作的是第一台。
 *
 * 这个 bug 是在真实 Firefox 里同时连三台 aria2-next 时被抓到的：
 * 侧栏显示三台全绿，切到「实验室实例 B」却仍然是 A 的任务数据。
 */
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { dedupeHostIds, useHostsStore } from '@/stores/hosts'

/** 造一台主机配置。 */
function host(id: string, name: string) {
  return { id, name, url: `ws://127.0.0.1:${6800}/jsonrpc`, secret: '', pollIntervalMs: 1000, autoConnect: true }
}

describe('多主机管理', () => {
  it('连续添加两台主机不会撞 id', () => {
    setActivePinia(createPinia())
    const hosts = useHostsStore()

    // 故意不加任何延时 —— 模拟「同一毫秒内连点两次保存」
    const a = hosts.addHost({ name: 'A', url: 'ws://127.0.0.1:6801/jsonrpc', secret: '', pollIntervalMs: 1000, autoConnect: true })
    const b = hosts.addHost({ name: 'B', url: 'ws://127.0.0.1:6802/jsonrpc', secret: '', pollIntervalMs: 1000, autoConnect: true })

    expect(a.id).not.toBe(b.id)
    expect(a.id.length).toBeGreaterThan(0)
  })

  it('批量添加的主机 id 全部唯一', () => {
    setActivePinia(createPinia())
    const hosts = useHostsStore()

    const created = Array.from({ length: 20 }, (_, i) =>
      hosts.addHost({ name: `主机 ${i}`, url: 'ws://127.0.0.1:6800/jsonrpc', secret: '', pollIntervalMs: 1000, autoConnect: true }),
    )

    const ids = created.map((h) => h.id)
    expect(new Set(ids).size).toBe(created.length)
  })

  it('按 id 查找时每台主机都能被独立命中', () => {
    setActivePinia(createPinia())
    const hosts = useHostsStore()

    const a = hosts.addHost({ name: 'A', url: 'ws://127.0.0.1:6801/jsonrpc', secret: '', pollIntervalMs: 1000, autoConnect: true })
    const b = hosts.addHost({ name: 'B', url: 'ws://127.0.0.1:6802/jsonrpc', secret: '', pollIntervalMs: 1000, autoConnect: true })

    // 这是旧 bug 最要命的地方：两台 id 相同，第二台成了摸不到的幽灵
    expect(hosts.hosts.find((h) => h.id === b.id)?.name).toBe('B')
    expect(hosts.hosts.find((h) => h.id === a.id)?.name).toBe('A')

    hosts.selectHost(b.id)
    expect(hosts.activeHostId).toBe(b.id)
    expect(hosts.activeHost?.name).toBe('B')
  })

  it('加载时发现重复 id 会自动去重，且第一台的 id 保持不变', () => {
    const input = [host('dup', '第一台'), host('dup', '第二台'), host('dup', '第三台')]
    const { list, changed } = dedupeHostIds(input)

    expect(changed).toBe(true)
    // 第一台保持原样 —— 这样 activeHostId 指向的还是原来那台
    expect(list[0].id).toBe('dup')
    expect(new Set(list.map((h) => h.id)).size).toBe(3)
  })

  it('没有重复 id 时不做任何改动', () => {
    const input = [host('a', 'A'), host('b', 'B')]
    const { list, changed } = dedupeHostIds(input)

    expect(changed).toBe(false)
    expect(list).toEqual(input)
  })
})
