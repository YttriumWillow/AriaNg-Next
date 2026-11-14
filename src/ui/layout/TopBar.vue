<script setup lang="ts">
/**
 * 顶栏：只放全局操作。
 *
 * 这里曾经还放连接状态、版本号和总速率，但它们属于「身份信息」，
 * 现在统一挪到了侧栏左上角的品牌块里（见 SideNav.vue）。
 * 顶栏因此只剩下「不管在哪个页面都能做的操作」：
 * 暂停/恢复全部任务、刷新、添加任务。
 */
import { computed } from 'vue'
import AppIcon from '@/ui/components/AppIcon.vue'
import { useHostsStore } from '@/stores/hosts'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'
import { useToastStore } from '@/stores/toast'
import { useI18n } from '@/i18n'

const hosts = useHostsStore()
const tasks = useTasksStore()
const ui = useUiStore()
const toast = useToastStore()
const { t } = useI18n()

const runtime = computed(() => (hosts.activeHostId ? hosts.runtimeFor(hosts.activeHostId) : null))
const state = computed(() => (hosts.activeHostId ? tasks.stateFor(hosts.activeHostId) : null))

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
