<script setup lang="ts">
/**
 * 任务表格（表格视图）。
 *
 * 保留了 AriaNg 任务列表的全部列语义：大小、进度、上下速、剩余、ETA，
 * 都可排序、可搜索、可过滤。变化只在于「有列对齐」和「行尾浮出操作条」。
 */
import { computed } from 'vue'
import AppIcon from '@/ui/components/AppIcon.vue'
import ProgressBar from '@/ui/components/ProgressBar.vue'
import ProtocolBadge from '@/ui/components/ProtocolBadge.vue'
import type { Task } from '@/core/model/task'
// 状态文案逻辑放在 core，这里只负责把翻译函数 t() 注入进去
import { taskProgressText, taskStatusText } from '@/core/model/task'
import type { TaskSortKey } from '@/core/model/sort'
import { formatBytes, formatEta, formatSpeed } from '@/core/model/format'
import { useI18n } from '@/i18n'

defineProps<{
  tasks: Task[]
  sortKey: TaskSortKey
  sortDescending: boolean
  busyGids: Set<string>
}>()

const emit = defineEmits<{
  sort: [key: TaskSortKey]
  action: [action: string, gid: string]
  detail: [gid: string]
}>()

const { t } = useI18n()

/** 表头定义。sortable 为 false 的列不参与排序。 */
const columns = computed(() => [
  { key: 'name', label: t('task.name'), sortable: true },
  { key: 'size', label: t('common.size'), sortable: true },
  { key: 'progress', label: t('task.progress'), sortable: true },
  { key: 'downloadSpeed', label: t('task.downloadSpeed'), sortable: true },
  { key: 'uploadSpeed', label: t('task.uploadSpeed'), sortable: true },
  { key: 'remaining', label: t('task.remaining'), sortable: true },
  { key: 'eta', label: t('task.eta'), sortable: true },
])

/** 根据任务状态选择进度条样式。 */
function progressVariant(task: Task): 'default' | 'seeding' | 'paused' | 'error' | 'live' {
  if (task.status === 'error') return 'error'
  if (task.status === 'paused') return 'paused'
  if (task.status === 'complete') return 'seeding'
  if (task.media?.live) return 'live'
  return 'default'
}

/** 任务状态对应的小圆点样式。 */
function statusClass(task: Task): string {
  switch (task.status) {
    case 'active':
      return 'an-status-dot--active'
    case 'waiting':
      return 'an-status-dot--waiting'
    case 'paused':
      return 'an-status-dot--paused'
    case 'error':
      return 'an-status-dot--error'
    case 'complete':
      return 'an-status-dot--complete'
    default:
      return ''
  }
}

/**
 * 状态文字。
 *
 * 具体规则在 core 的 taskStatusText 里（错误状态优先于媒体阶段），
 * 这里只做翻译函数的注入。
 */
function statusText(task: Task): string {
  return taskStatusText(task, t)
}

/** 进度文案。规则同样在 core 的 taskProgressText 里。 */
function progressText(task: Task): string {
  return taskProgressText(task, t)
}

/** 是否显示暂停按钮（下载中/等待中可暂停）。 */
function canPause(task: Task): boolean {
  return task.status === 'active' || task.status === 'waiting'
}

/** 是否显示继续按钮。 */
function canResume(task: Task): boolean {
  return task.status === 'paused'
}
</script>

<template>
  <div class="an-table-wrap">
    <table class="an-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column.key" :class="{ 'is-sortable': column.sortable }" @click="column.sortable && emit('sort', column.key as TaskSortKey)">
            {{ column.label }}
            <span v-if="sortKey === column.key" class="an-table__sort">{{ sortDescending ? '↓' : '↑' }}</span>
          </th>
          <th style="width: 116px; text-align: right">{{ t('common.actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="task in tasks" :key="task.gid">
          <!-- 名称 + 协议 + 路径 -->
          <td style="max-width: 320px">
            <div class="an-task-name">
              <span class="an-status-dot" :class="statusClass(task)" :title="statusText(task)" />
              <span class="an-task-name__text" :title="task.name">{{ task.name }}</span>
              <ProtocolBadge :protocol="task.protocol" />
            </div>
            <div v-if="task.dir || task.errorMessage" class="an-task-name__path" :title="task.errorMessage || task.dir">
              {{ task.errorMessage || task.dir }}
            </div>
          </td>

          <!-- 大小 -->
          <td class="an-table__num">
            {{ task.totalLength > 0 ? formatBytes(task.totalLength) : '—' }}
          </td>

          <!-- 进度 -->
          <td style="min-width: 108px">
            <ProgressBar :progress="task.media?.live ? 0 : task.progress" :variant="progressVariant(task)" />
            <div class="an-task-name__path" style="margin-top: 3px">{{ progressText(task) }}</div>
          </td>

          <!-- 速度 -->
          <td class="an-table__num">{{ formatSpeed(task.downloadSpeed) }}</td>
          <td class="an-table__num">{{ task.uploadSpeed > 0 ? formatSpeed(task.uploadSpeed) : '—' }}</td>

          <!-- 剩余 / ETA -->
          <td class="an-table__num">{{ task.remainingLength > 0 ? formatBytes(task.remainingLength) : '—' }}</td>
          <td class="an-table__num">{{ formatEta(task.etaSeconds) }}</td>

          <!-- 操作 -->
          <td>
            <div class="an-task-actions">
              <button
                v-if="canPause(task)"
                class="an-btn an-btn--ghost an-btn--icon"
                type="button"
                :title="t('task.pause')"
                :disabled="busyGids.has(task.gid)"
                @click="emit('action', 'pause', task.gid)"
              >
                <AppIcon class="an-btn__icon" name="pause" :size="13" />
              </button>
              <button
                v-if="canResume(task)"
                class="an-btn an-btn--ghost an-btn--icon"
                type="button"
                :title="t('task.resume')"
                :disabled="busyGids.has(task.gid)"
                @click="emit('action', 'resume', task.gid)"
              >
                <AppIcon class="an-btn__icon" name="play" :size="13" />
              </button>
              <button
                v-if="task.status === 'error'"
                class="an-btn an-btn--ghost an-btn--icon"
                type="button"
                :title="t('task.retry')"
                :disabled="busyGids.has(task.gid)"
                @click="emit('action', 'retry', task.gid)"
              >
                <AppIcon class="an-btn__icon" name="refresh" :size="13" />
              </button>
              <button
                class="an-btn an-btn--ghost an-btn--icon"
                type="button"
                :title="t('task.viewDetail')"
                @click="emit('detail', task.gid)"
              >
                <AppIcon class="an-btn__icon" name="info" :size="13" />
              </button>
              <button
                class="an-btn an-btn--ghost an-btn--icon"
                type="button"
                :title="t('task.remove')"
                :disabled="busyGids.has(task.gid)"
                @click="emit('action', 'remove', task.gid)"
              >
                <AppIcon class="an-btn__icon" name="trash" :size="13" />
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
