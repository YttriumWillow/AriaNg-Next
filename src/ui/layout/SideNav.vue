<script setup lang="ts">
/**
 * 侧边导航。
 *
 * 侧栏从上到下承担五个角色：
 *  1. 品牌块 —— 产品名 + aria2-next 核心的连接状态 + 版本号（身份信息，可点击回仪表盘）
 *  2. 概览 —— 仪表盘，整个面板的总入口
 *  3. 主机 —— 连接对象。AriaNg 里放在设置里，这里提到一级
 *  4. 任务状态分段 —— 带实时计数
 *  5. 工具入口
 *
 * 底部另有一行全局速率。
 *
 * 为什么把连接状态和版本号放进品牌块，而不是留在顶栏？
 * 因为「我是谁 / 连上了吗」是**身份信息**，而顶栏应该留给
 * 「我现在能做什么」这类**全局操作**。两者分开，界面层级才清晰。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/ui/components/AppIcon.vue'
import { useHostsStore } from '@/stores/hosts'
import { useTasksStore } from '@/stores/tasks'
import { useI18n } from '@/i18n'
import { useHostName } from '@/ui/composables/useHostName'
import { formatSpeed } from '@/core/model/format'

import type { TransportStatus } from '@/core/rpc/transport'

const route = useRoute()
const router = useRouter()
const hosts = useHostsStore()
const tasks = useTasksStore()
const { t } = useI18n()
const { hostName } = useHostName()

// 统一用 computed 缓存当前激活主机的运行时与任务快照（只读，不在渲染/计算期调用 mutator）
const runtime = computed(() => hosts.activeRuntime)
const activeTaskState = computed(() => (hosts.activeHostId ? (tasks.byHost[hosts.activeHostId] ?? null) : null))

/** aria2-next 核心的连接状态。 */
const connection = computed(() => {
  const status = runtime.value?.status ?? 'idle'
  switch (status) {
    case 'connected':
      return { class: 'an-brand__pill--online', icon: 'activity', text: t('connection.connected') }
    case 'connecting':
      return { class: 'an-brand__pill--connecting', icon: 'refresh', text: t('connection.connecting') }
    case 'reconnecting':
      return { class: 'an-brand__pill--connecting', icon: 'refresh', text: t('connection.reconnecting') }
    case 'error':
      return { class: 'an-brand__pill--offline', icon: 'offline', text: t('connection.error') }
    default:
      return { class: '', icon: 'offline', text: t('connection.disconnected') }
  }
})

/** 后端核心版本号。 */
const version = computed(() => runtime.value?.capabilities?.version ?? '')

/** 全局速率，显示在侧栏底部。 */
const speeds = computed(() => {
  const state = activeTaskState.value
  return {
    down: state?.globalStat.downloadSpeed ?? 0,
    up: state?.globalStat.uploadSpeed ?? 0,
  }
})

/** 当前主机的任务状态计数（单遍统计 stopped，避免连续两次 filter 分配）。 */
const counts = computed(() => {
  const state = activeTaskState.value
  if (!state) {
    return { active: 0, waiting: 0, complete: 0, error: 0 }
  }
  let complete = 0
  let error = 0
  for (const task of state.stopped) {
    if (task.status === 'complete') complete += 1
    else if (task.status === 'error') error += 1
  }
  return {
    active: state.active.length,
    waiting: state.waiting.length,
    complete,
    error,
  }
})

/** 状态段落到任务列表页的筛选参数。 */
const segments = computed(() => [
  { key: 'active', label: t('nav.downloading'), icon: 'download', count: counts.value.active },
  { key: 'waiting', label: t('nav.waiting'), icon: 'clock', count: counts.value.waiting },
  { key: 'complete', label: t('nav.completed'), icon: 'check', count: counts.value.complete },
  { key: 'error', label: t('nav.error'), icon: 'alert', count: counts.value.error },
])

/** 主机连接状态对应的圆点样式（纯映射函数，不触发 store 写入）。 */
function statusDotClass(status: TransportStatus | undefined): string {
  if (status === 'connected') return 'an-status-dot--active'
  if (status === 'connecting' || status === 'reconnecting') return 'an-status-dot--waiting'
  if (status === 'error') return 'an-status-dot--error'
  return ''
}

/** 缓存侧栏主机条目与圆点样式，避免在模板 v-for 循环里反复调用 runtimeFor / hostName。 */
const hostItems = computed(() =>
  hosts.hosts.map((host) => ({
    id: host.id,
    name: hostName(host),
    dotClass: statusDotClass(hosts.runtimes[host.id]?.status),
  })),
)

function isActive(path: string): boolean {
  return route.path === path
}

function goTasks(status: string): void {
  void router.push({ path: '/tasks', query: { status } })
}

/**
 * 切换到某台主机，并回到仪表盘。
 *
 * 为什么切换主机后要跳转？
 * 因为「这台主机现在怎么样」这个问题，答案就在仪表盘上 ——
 * 活跃任务数、总速率、异常分布、协议分布。
 * 停在任务列表页只能看到任务，看不到主机整体状态。
 */
async function selectHost(hostId: string): Promise<void> {
  hosts.selectHost(hostId)
  await router.push('/dashboard')
}
</script>

<template>
  <aside class="an-sidebar">
    <!--
      品牌块：产品名 + 核心连接状态 + 版本号。
      整块可点击回到仪表盘 —— logo 回首页是通用惯例，
      窄屏下它会缩成一个 40×40 的小方块，正好当主页按钮用。
    -->
    <RouterLink class="an-brand" to="/dashboard" :title="t('nav.dashboard')">
      <span class="an-brand__mark">A</span>
      <div class="an-brand__name">{{ t('app.title') }}</div>
      <div class="an-brand__meta">
        <span class="an-brand__pill" :class="connection.class">
          <AppIcon :name="connection.icon" :size="12" />
          {{ connection.text }}
        </span>
        <span v-if="version" class="an-brand__version">v{{ version }}</span>
      </div>
    </RouterLink>

    <!-- 概览：仪表盘是整个面板的总入口 -->
    <div class="an-sidebar__section">
      <div class="an-sidebar__section-title">{{ t('nav.overview') }}</div>
      <RouterLink class="an-nav-item" :class="{ 'an-nav-item--active': isActive('/dashboard') }" to="/dashboard" :title="t('nav.dashboard')">
        <AppIcon class="an-nav-item__icon" name="dashboard" />
        <span class="an-nav-item__label">{{ t('nav.dashboard') }}</span>
      </RouterLink>
    </div>

    <!-- 主机 -->
    <div class="an-sidebar__section an-sidebar__section--hosts">
      <div class="an-sidebar__section-title">{{ t('nav.hosts') }}</div>
      <div class="an-host-list">
        <button
          v-for="host in hostItems"
          :key="host.id"
          class="an-host-item"
          :class="{ 'an-host-item--active': host.id === hosts.activeHostId }"
          type="button"
          :title="host.name"
          @click="selectHost(host.id)"
        >
          <span class="an-status-dot" :class="host.dotClass" />
          <span class="an-host-item__name">{{ host.name }}</span>
        </button>
      </div>
    </div>

    <!-- 任务状态分段 -->
    <div class="an-sidebar__section">
      <div class="an-sidebar__section-title">{{ t('nav.tasks') }}</div>
      <button
        v-for="segment in segments"
        :key="segment.key"
        class="an-nav-item"
        :class="{ 'an-nav-item--active': route.path === '/tasks' && route.query.status === segment.key }"
        type="button"
        :title="segment.label"
        @click="goTasks(segment.key)"
      >
        <AppIcon class="an-nav-item__icon" :name="segment.icon" />
        <span class="an-nav-item__label">{{ segment.label }}</span>
        <span class="an-nav-item__count">{{ segment.count }}</span>
      </button>
    </div>

    <!-- 工具 -->
    <div class="an-sidebar__section">
      <div class="an-sidebar__section-title">{{ t('nav.tools') }}</div>
      <RouterLink class="an-nav-item" :class="{ 'an-nav-item--active': isActive('/diagnostics') }" to="/diagnostics" :title="t('nav.diagnostics')">
        <AppIcon class="an-nav-item__icon" name="activity" />
        <span class="an-nav-item__label">{{ t('nav.diagnostics') }}</span>
      </RouterLink>
      <RouterLink class="an-nav-item" :class="{ 'an-nav-item--active': isActive('/appearance') }" to="/appearance" :title="t('nav.appearance')">
        <AppIcon class="an-nav-item__icon" name="palette" />
        <span class="an-nav-item__label">{{ t('nav.appearance') }}</span>
      </RouterLink>
      <RouterLink class="an-nav-item" :class="{ 'an-nav-item--active': isActive('/settings') }" to="/settings" :title="t('nav.settings')">
        <AppIcon class="an-nav-item__icon" name="sliders" />
        <span class="an-nav-item__label">{{ t('nav.settings') }}</span>
      </RouterLink>
    </div>

    <!-- 底部：全局速率 -->
    <div class="an-sidebar__footer">
      <span class="an-sidebar__speed">
        <AppIcon name="download" :size="13" style="color: var(--an-accent)" />
        <span class="an-table__num">{{ formatSpeed(speeds.down) }}</span>
      </span>
      <span class="an-sidebar__speed">
        <AppIcon name="activity" :size="13" style="color: var(--an-text-faint)" />
        <span class="an-table__num">{{ formatSpeed(speeds.up) }}</span>
      </span>
    </div>
  </aside>
</template>
