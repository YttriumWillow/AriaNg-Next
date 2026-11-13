<script setup lang="ts">
/**
 * 侧边导航。
 *
 * 侧栏只放「上下文」三类东西：
 *  1. 主机（连接对象）—— AriaNg 里放在设置里，这里提到一级
 *  2. 任务状态分段 —— 带实时计数
 *  3. 工具入口
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/ui/components/AppIcon.vue'
import { useHostsStore } from '@/stores/hosts'
import { useTasksStore } from '@/stores/tasks'
import { useI18n } from '@/i18n'

const route = useRoute()
const router = useRouter()
const hosts = useHostsStore()
const tasks = useTasksStore()
const { t } = useI18n()

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
</script>

<template>
  <aside class="an-sidebar">
    <div class="an-sidebar__brand">
      <div class="an-sidebar__logo">A</div>
      <div style="min-width: 0">
        <div class="an-sidebar__title">{{ t('app.title') }}</div>
        <div class="an-sidebar__version">{{ t('app.tagline') }}</div>
      </div>
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
          @click="hosts.selectHost(host.id)"
        >
          <span class="an-status-dot" :class="statusClass(host.id)" />
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
  </aside>
</template>
