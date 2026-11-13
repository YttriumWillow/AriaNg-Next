/**
 * 响应式回归测试。
 *
 * 这里锁的是一个曾经真实存在、且极难靠肉眼发现的 bug：
 *
 *   reactive() 存进去的是**原始对象**，之后读出来才是**响应式代理**。
 *   如果把创建时的原始对象直接 return 出去，后续所有赋值都绕过了代理，
 *   Vue 收不到更新通知 —— 界面永远不刷新。
 *
 * 症状当时表现为：连接明明成功了，界面却一直停在「连接中」；
 * 任务列表永远不更新。而且只在「连接速度快于首屏渲染」时才碰巧正常，
 * 所以极难复现。
 *
 * 这两个用例就是防它再犯的。
 */
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, watch } from 'vue'
import { useHostsStore } from '@/stores/hosts'
import { useTasksStore } from '@/stores/tasks'

describe('store 响应式', () => {
  it('主机连接状态变化能触发界面更新', async () => {
    setActivePinia(createPinia())
    const hosts = useHostsStore()

    const runtime = hosts.runtimeFor('host-test')
    let notified = 0
    // 读取发生在代理上，才会被 Vue 收集成依赖
    watch(() => runtime.status, () => { notified += 1 })

    runtime.status = 'connecting'
    await nextTick()
    expect(notified).toBe(1)

    runtime.status = 'connected'
    await nextTick()
    expect(notified).toBe(2)
  })

  it('任务列表变化能触发界面更新', async () => {
    setActivePinia(createPinia())
    const tasks = useTasksStore()

    const state = tasks.stateFor('host-test')
    let notified = 0
    watch(() => state.active, () => { notified += 1 })

    state.active = [
      {
        gid: 'g1',
        name: 'test.iso',
        status: 'active',
        protocol: 'http',
        totalLength: 100,
        completedLength: 50,
        uploadLength: 0,
        downloadSpeed: 10,
        uploadSpeed: 0,
        progress: 0.5,
        remainingLength: 50,
        etaSeconds: 5,
        dir: '/downloads',
        files: [],
        connections: 1,
        errorCode: '',
        errorMessage: '',
        numSeeders: 0,
        numLeechers: 0,
      },
    ]
    await nextTick()
    expect(notified).toBe(1)
    expect(state.active).toHaveLength(1)
  })

  it('全局统计变化能触发界面更新', async () => {
    setActivePinia(createPinia())
    const tasks = useTasksStore()

    const state = tasks.stateFor('host-test-2')
    let notified = 0
    watch(() => state.globalStat.downloadSpeed, () => { notified += 1 })

    state.globalStat.downloadSpeed = 1024
    await nextTick()
    expect(notified).toBe(1)
  })
})
