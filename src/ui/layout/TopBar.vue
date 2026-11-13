<script setup lang="ts">
/**
 * 顶栏：常驻的全局作用域。
 *
 * 这里放的是「不管你在哪个页面都成立」的信息与操作：
 * 连接状态、总速度、版本号、暂停/恢复全部、添加任务、刷新。
 */
import { computed } from 'vue'
import AppIcon from '@/ui/components/AppIcon.vue'
import { useHostsStore } from '@/stores/hosts'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'
import { useToastStore } from '@/stores/toast'
import { useI18n } from '@/i18n'
import { formatSpeed } from '@/core/model/format'

const hosts = useHostsStore()
const tasks = useTasksStore()
const ui = useUiStore()
const toast = useToastStore()
const { t } = useI18n()

const runtime = computed(() => (hosts.activeHostId ? hosts.runtimeFor(hosts.activeHostId) : null))
const state = computed(() => (hosts.activeHostId ? tasks.stateFor(hosts.activeHostId) : null))

/** 连接状态对应的展示。 */
const connection = computed(() => {
  const status = runtime.value?.status ?? 'idle'
  switch (status) {
    case 'connected':
      return { class: 'an-conn--online', text: t('connection.connected') }
    case 'connecting':
      return { class: 'an-conn--connecting', text: t('connection.connecting') }
    case 'reconnecting':
      return { class: 'an-conn--connecting', text: t('connection.reconnecting') }
    case 'error':
      return { class: 'an-conn--offline', text: t('connection.error') }
    default:
      return { class: '', text: t('connection.disconnected') }
  }
})

const version = computed(() => runtime.value?.capabilities?.version ?? '')

async function togglePauseAll(): Promise<void> {
  if (!hosts.activeHostId) return
  try {
    await tasks.pauseAll(hosts.activeHostId)
    toast.success(t('toast.allPaused'))
  } catch {
    toast.error(state.value?.error ?? t('common.error'))
  }
}

async function toggleResumeAll(): Promise<void> {
  if (!hosts.activeHostId) return
  try {
    await tasks.unpauseAll(hosts.activeHostId)
    toast.success(t('toast.allResumed'))
  } catch {
    toast.error(state.value?.error ?? t('common.error'))
  }
}
</script>

<template>
  <header class="an-topbar">
    <!-- 连接状态 -->
    <span class="an-conn" :class="connection.class">
      <AppIcon :name="connection.class === 'an-conn--online' ? 'activity' : 'offline'" :size="12" />
      {{ connection.text }}
    </span>

    <span v-if="version" class="an-sidebar__version">v{{ version }}</span>

    <!-- 全局速度 -->
    <div class="an-topbar__group">
      <span class="an-topbar__group" style="gap: 4px">
        <AppIcon name="download" :size="13" style="color: var(--an-accent)" />
        <span class="an-table__num">{{ formatSpeed(state?.globalStat.downloadSpeed ?? 0) }}</span>
      </span>
      <span class="an-topbar__group" style="gap: 4px">
        <AppIcon name="activity" :size="13" style="color: var(--an-text-faint)" />
        <span class="an-table__num">{{ formatSpeed(state?.globalStat.uploadSpeed ?? 0) }}</span>
      </span>
    </div>

    <div class="an-topbar__spacer" />

    <!-- 全局操作 -->
    <div class="an-topbar__group">
      <button
        class="an-btn an-btn--sm"
        type="button"
        :disabled="runtime?.status !== 'connected'"
        @click="togglePauseAll"
      >
        <AppIcon class="an-btn__icon" name="pause" :size="13" />
        {{ t('task.pauseAll') }}
      </button>
      <button
        class="an-btn an-btn--sm"
        type="button"
        :disabled="runtime?.status !== 'connected'"
        @click="toggleResumeAll"
      >
        <AppIcon class="an-btn__icon" name="play" :size="13" />
        {{ t('task.resumeAll') }}
      </button>
      <button
        class="an-btn an-btn--sm an-btn--icon"
        type="button"
        :title="t('common.refresh')"
        :disabled="runtime?.status !== 'connected'"
        @click="hosts.activeHostId && hosts.refreshNow(hosts.activeHostId)"
      >
        <AppIcon class="an-btn__icon" name="refresh" :size="13" />
      </button>
      <button class="an-btn an-btn--sm an-btn--primary" type="button" @click="ui.openAddTask()">
        <AppIcon class="an-btn__icon" name="plus" :size="13" />
        {{ t('task.add') }}
      </button>
    </div>
  </header>
</template>
