<script setup lang="ts">
/**
 * 任务列表页。
 *
 * 保留 AriaNg 的核心列表交互：排序、搜索、状态/协议过滤，
 * 并提供表格 / 卡片双模切换。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/ui/components/AppIcon.vue'
import TaskTable from '@/ui/components/TaskTable.vue'
import TaskCards from '@/ui/components/TaskCards.vue'
import EmptyState from '@/ui/components/EmptyState.vue'
import { useHostsStore } from '@/stores/hosts'
import { useTasksStore } from '@/stores/tasks'
import { useToastStore } from '@/stores/toast'
import { useI18n } from '@/i18n'
import { sortTasks, type TaskSortKey } from '@/core/model/sort'
import { protocolLabel } from '@/core/model/format'
import type { Task } from '@/core/model/task'

const route = useRoute()
const router = useRouter()
const hosts = useHostsStore()
const tasks = useTasksStore()
const toast = useToastStore()
const { t } = useI18n()

const search = ref('')
const protocolFilter = ref('all')
const viewMode = ref<'table' | 'card'>('table')
const sortKey = ref<TaskSortKey>('name')
const sortDescending = ref(false)

/** 当前状态分段。侧栏点进来时通过 query 传递。 */
const statusFilter = computed(() => (route.query.status as string) ?? 'all')

watch(
  () => route.query.status,
  () => {
    // 状态变化时重置搜索，并校验协议筛选是否在当前分类内存在，避免出现空下拉与空列表
    search.value = ''
    if (protocolFilter.value !== 'all' && !availableProtocols.value.includes(protocolFilter.value)) {
      protocolFilter.value = 'all'
    }
  },
)

// 只读获取当前主机任务状态，避免计算属性期间意外触发 store 写入
const state = computed(() => (hosts.activeHostId ? (tasks.byHost[hosts.activeHostId] ?? null) : null))

/** 按状态分段取任务。 */
const statusTasks = computed<Task[]>(() => {
  const value = state.value
  if (!value) return []

  switch (statusFilter.value) {
    case 'active':
      return value.active
    case 'waiting':
      return value.waiting
    case 'complete':
      return value.stopped.filter((task) => task.status === 'complete')
    case 'error':
      return value.stopped.filter((task) => task.status === 'error')
    case 'stopped':
      return value.stopped.filter((task) => task.status !== 'complete' && task.status !== 'error')
    default: {
      const { active, waiting, stopped } = value
      if (!active.length && !waiting.length) return stopped
      if (!waiting.length && !stopped.length) return active
      if (!active.length && !stopped.length) return waiting
      return [...active, ...waiting, ...stopped]
    }
  }
})

/** 可选的协议筛选项（只列出实际存在的，并在集合不变时保持引用稳定以跳过下拉重绘）。 */
const availableProtocols = computed<string[]>((previous) => {
  const set = new Set<string>()
  for (const task of statusTasks.value) set.add(task.protocol)
  const next = set.size > 0 ? [...set].sort() : []
  if (previous && previous.length === next.length && previous.every((item, idx) => item === next[idx])) {
    return previous
  }
  return next
})

/** 预格式化协议选项，避免模板循环中重复映射显示名。 */
const protocolOptions = computed(() =>
  availableProtocols.value.map((value) => ({
    value,
    label: protocolLabel(value),
  })),
)

/** 搜索 + 协议过滤 + 排序。 */
const visibleTasks = computed<Task[]>((previous) => {
  const source = statusTasks.value
  if (source.length === 0) {
    return previous && previous.length === 0 ? previous : []
  }

  const protocol = protocolFilter.value
  const keyword = search.value.trim().toLowerCase()

  // 无筛选条件时跳过中间 filter 数组分配，直接交给 sortTasks 复制并排序
  if (protocol === 'all' && !keyword) {
    return sortTasks(source, sortKey.value, sortDescending.value)
  }

  const filtered: Task[] = []
  for (let i = 0; i < source.length; i += 1) {
    const task = source[i]
    if (protocol !== 'all' && task.protocol !== protocol) continue
    if (
      keyword &&
      !task.name.toLowerCase().includes(keyword) &&
      !task.gid.toLowerCase().includes(keyword) &&
      !task.dir.toLowerCase().includes(keyword) &&
      !task.files.some((file) => file.path.toLowerCase().includes(keyword))
    ) {
      continue
    }
    filtered.push(task)
  }
  return sortTasks(filtered, sortKey.value, sortDescending.value)
})

/** 点击表头排序：同列再点一次就反向。 */
function onSort(key: TaskSortKey): void {
  if (sortKey.value === key) {
    sortDescending.value = !sortDescending.value
  } else {
    sortKey.value = key
    sortDescending.value = false
  }
}

/** 任务操作分发。 */
async function onAction(action: string, gid: string): Promise<void> {
  if (!hosts.activeHostId) return
  const hostId = hosts.activeHostId
  const task = visibleTasks.value.find((item) => item.gid === gid)

  try {
    switch (action) {
      case 'pause':
        await tasks.pause(hostId, gid)
        toast.success(t('toast.taskPaused'))
        break
      case 'resume':
        await tasks.unpause(hostId, gid)
        toast.success(t('toast.taskResumed'))
        break
      case 'retry':
        await tasks.retry(hostId, gid, Boolean(task?.media))
        toast.success(t('toast.taskResumed'))
        break
      case 'remove':
        if (task && (task.status === 'complete' || task.status === 'error' || task.status === 'removed')) {
          await tasks.clearFinished(hostId, gid)
        } else {
          await tasks.remove(hostId, gid)
        }
        toast.success(t('toast.taskRemoved'))
        break
    }
  } catch {
    toast.error(state.value?.error ?? t('common.error'))
  }
}

function onDetail(gid: string): void {
  if (!hosts.activeHostId) return
  void tasks.openDetail(hosts.activeHostId, gid)
}

function setStatus(status: string): void {
  void router.replace({ path: '/tasks', query: status === 'all' ? {} : { status } })
}
</script>

<template>
  <div class="an-page">
    <div class="an-page__head">
      <div>
        <h1 class="an-page__title">{{ t('nav.tasks') }}</h1>
        <p class="an-page__desc">{{ visibleTasks.length }} / {{ statusTasks.length }}</p>
      </div>
    </div>

    <!-- 工具栏 -->
    <div class="an-toolbar">
      <!-- 搜索 -->
      <div class="an-toolbar__search">
        <AppIcon name="search" :size="13" style="opacity: 0.5" />
        <input v-model="search" :placeholder="t('common.searchPlaceholder')" />
      </div>

      <!-- 状态分段 -->
      <div class="an-seg">
        <button class="an-seg__item" :class="{ 'an-seg__item--active': statusFilter === 'all' }" type="button" @click="setStatus('all')">
          {{ t('common.all') }}
        </button>
        <button class="an-seg__item" :class="{ 'an-seg__item--active': statusFilter === 'active' }" type="button" @click="setStatus('active')">
          {{ t('status.active') }}
        </button>
        <button class="an-seg__item" :class="{ 'an-seg__item--active': statusFilter === 'waiting' }" type="button" @click="setStatus('waiting')">
          {{ t('status.waiting') }}
        </button>
        <button class="an-seg__item" :class="{ 'an-seg__item--active': statusFilter === 'complete' }" type="button" @click="setStatus('complete')">
          {{ t('status.complete') }}
        </button>
        <button class="an-seg__item" :class="{ 'an-seg__item--active': statusFilter === 'error' }" type="button" @click="setStatus('error')">
          {{ t('status.error') }}
        </button>
      </div>

      <!-- 协议过滤 -->
      <select v-model="protocolFilter" class="an-select" style="width: auto">
        <option value="all">{{ t('task.filterProtocol') }}</option>
        <option v-for="option in protocolOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>

      <!-- 视图切换 -->
      <div class="an-seg">
        <button class="an-seg__item" :class="{ 'an-seg__item--active': viewMode === 'table' }" type="button" @click="viewMode = 'table'">
          <AppIcon name="list" :size="12" />
        </button>
        <button class="an-seg__item" :class="{ 'an-seg__item--active': viewMode === 'card' }" type="button" @click="viewMode = 'card'">
          <AppIcon name="grid" :size="12" />
        </button>
      </div>
    </div>

    <!-- 列表 -->
    <div class="an-card an-card__body--flush">
      <EmptyState
        v-if="!visibleTasks.length"
        :title="t('task.empty')"
        :description="t('task.emptyHint')"
        icon="download"
      />
      <TaskTable
        v-else-if="viewMode === 'table'"
        :tasks="visibleTasks"
        :sort-key="sortKey"
        :sort-descending="sortDescending"
        :busy-gids="tasks.busyGids"
        @sort="onSort"
        @action="onAction"
        @detail="onDetail"
      />
      <div v-else style="padding: 12px">
        <TaskCards
          :tasks="visibleTasks"
          :busy-gids="tasks.busyGids"
          @action="onAction"
          @detail="onDetail"
        />
      </div>
    </div>
  </div>
</template>
