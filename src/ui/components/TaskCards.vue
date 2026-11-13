<script setup lang="ts">
/**
 * 任务卡片（卡片视图）。
 *
 * 卡片视图是 AriaNg 没有的新增项，适合两种场景：
 *  1. 手机等窄屏 —— 表格横向滚动体验很差
 *  2. 少量大任务 —— 比如正在录制的直播、做种中的 BT，进度与状态更直观
 */
import AppIcon from '@/ui/components/AppIcon.vue'
import ProgressBar from '@/ui/components/ProgressBar.vue'
import ProtocolBadge from '@/ui/components/ProtocolBadge.vue'
import type { Task } from '@/core/model/task'
import { formatBytes, formatEta, formatPercent, formatSpeed } from '@/core/model/format'
import { useI18n } from '@/i18n'

defineProps<{
  tasks: Task[]
  busyGids: Set<string>
}>()

const emit = defineEmits<{
  action: [action: string, gid: string]
  detail: [gid: string]
}>()

const { t } = useI18n()

function progressVariant(task: Task): 'default' | 'seeding' | 'paused' | 'error' | 'live' {
  if (task.status === 'error') return 'error'
  if (task.status === 'paused') return 'paused'
  if (task.status === 'complete') return 'seeding'
  if (task.media?.live) return 'live'
  return 'default'
}
</script>

<template>
  <div class="an-task-cards">
    <article v-for="task in tasks" :key="task.gid" class="an-task-card">
      <div class="an-task-name">
        <span class="an-task-name__text" :title="task.name">{{ task.name }}</span>
        <ProtocolBadge :protocol="task.protocol" />
      </div>

      <div>
        <ProgressBar :progress="task.media?.live ? 0 : task.progress" :variant="progressVariant(task)" />
        <div class="an-task-name__path" style="margin-top: 5px">
          {{ task.media?.live ? t('status.active') : formatPercent(task.progress) }}
          <span v-if="task.totalLength > 0"> · {{ formatBytes(task.completedLength) }} / {{ formatBytes(task.totalLength) }}</span>
        </div>
      </div>

      <div class="an-task-card__stats">
        <span>{{ t('task.downloadSpeed') }} <b>{{ formatSpeed(task.downloadSpeed) }}</b></span>
        <span>{{ t('task.uploadSpeed') }} <b>{{ task.uploadSpeed > 0 ? formatSpeed(task.uploadSpeed) : '—' }}</b></span>
        <span>{{ t('task.eta') }} <b>{{ formatEta(task.etaSeconds) }}</b></span>
      </div>

      <div style="display: flex; align-items: center; gap: 4px; justify-content: flex-end">
        <button class="an-btn an-btn--sm an-btn--ghost" type="button" @click="emit('detail', task.gid)">
          <AppIcon class="an-btn__icon" name="info" :size="13" />
          {{ t('task.viewDetail') }}
        </button>
        <button
          v-if="task.status === 'active' || task.status === 'waiting'"
          class="an-btn an-btn--sm an-btn--ghost an-btn--icon"
          type="button"
          :title="t('task.pause')"
          :disabled="busyGids.has(task.gid)"
          @click="emit('action', 'pause', task.gid)"
        >
          <AppIcon class="an-btn__icon" name="pause" :size="13" />
        </button>
        <button
          v-if="task.status === 'paused'"
          class="an-btn an-btn--sm an-btn--ghost an-btn--icon"
          type="button"
          :title="t('task.resume')"
          :disabled="busyGids.has(task.gid)"
          @click="emit('action', 'resume', task.gid)"
        >
          <AppIcon class="an-btn__icon" name="play" :size="13" />
        </button>
        <button
          class="an-btn an-btn--sm an-btn--ghost an-btn--icon"
          type="button"
          :title="t('task.remove')"
          :disabled="busyGids.has(task.gid)"
          @click="emit('action', 'remove', task.gid)"
        >
          <AppIcon class="an-btn__icon" name="trash" :size="13" />
        </button>
      </div>
    </article>
  </div>
</template>
