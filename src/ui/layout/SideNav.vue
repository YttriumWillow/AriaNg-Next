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

const route = useRoute()
const router = useRouter()
const hosts = useHostsStore()
const tasks = useTasksStore()
const { t } = useI18n()
const { hostName } = useHostName()

const runtime = computed(() => (hosts.activeHostId ? hosts.runtimeFor(hosts.activeHostId) : null))

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
  const state = hosts.activeHostId ? tasks.stateFor(hosts.activeHostId) : null
  return {
    down: state?.globalStat.downloadSpeed ?? 0,
    up: state?.globalStat.uploadSpeed ?? 0,
  }
})

/** 当前主机的任务状态计数。 */
const counts = computed(() => {
  const state = hosts.activeHostId ? tasks.stateFor(hosts.activeHostId) : null
  return {
    active: state?.active.length ?? 0,
    waiting: state?.waiting.length ?? 0,
    complete: state?.stopped.filter((task) => task.status === 'complete').length ?? 0,
    error: state?.stopped.filter((task) => task.status === 'error').length ?? 0,
  }
})

/** 状态段落到任务列表页的筛选参数。 */
const segments = computed(() => [
  { key: 'active', label: t('nav.downloading'), icon: 'download', count: counts.value.active },
  { key: 'waiting', label: t('nav.waiting'), icon: 'clock', count: counts.value.waiting },
  { key: 'complete', label: t('nav.completed'), icon: 'check', count: counts.value.complete },
  { key: 'error', label: t('nav.error'), icon: 'alert', count: counts.value.error },
])

function isActive(path: string): boolean {
  return route.path === path
}

function goTasks(status: string): void {
  void router.push({ path: '/tasks', query: { status } })
}

/** 主机连接状态对应的圆点样式。 */
function statusClass(hostId: string): string {
  const runtime = hosts.runtimeFor(hostId)
  if (runtime.status === 'connected') return 'an-status-dot--active'
  if (runtime.status === 'connecting' || runtime.status === 'reconnecting') return 'an-status-dot--waiting'
  if (runtime.status === 'error') return 'an-status-dot--error'
  return ''
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
      <RouterLink class="an-nav-item" :class="{ 'an-nav-item--active': isActive('/dashboard') }" to="/dashboard">
        <AppIcon class="an-nav-item__icon" name="dashboard" />
        <span class="an-nav-item__label">{{ t('nav.dashboard') }}</span>
      </RouterLink>
    </div>

    <!-- 主机 -->
    <div class="an-sidebar__section">
      <div class="an-sidebar__section-title">{{ t('nav.hosts') }}</div>
      <div class="an-host-list">
        <button
          v-for="host in hosts.hosts"
          :key="host.id"
          class="an-host-item"
          :class="{ 'an-host-item--active': host.id === hosts.activeHostId }"
          type="button"
          @click="selectHost(host.id)"
        >
          <span class="an-status-dot" :class="statusClass(host.id)" />
          <span class="an-host-item__name">{{ hostName(host) }}</span>
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
      <RouterLink class="an-nav-item" :class="{ 'an-nav-item--active': isActive('/diagnostics') }" to="/diagnostics">
        <AppIcon class="an-nav-item__icon" name="activity" />
        <span class="an-nav-item__label">{{ t('nav.diagnostics') }}</span>
      </RouterLink>
      <RouterLink class="an-nav-item" :class="{ 'an-nav-item--active': isActive('/appearance') }" to="/appearance">
        <AppIcon class="an-nav-item__icon" name="palette" />
        <span class="an-nav-item__label">{{ t('nav.appearance') }}</span>
      </RouterLink>
      <RouterLink class="an-nav-item" :class="{ 'an-nav-item--active': isActive('/settings') }" to="/settings">
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
