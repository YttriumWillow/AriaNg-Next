<script setup lang="ts">
/**
 * 任务列表页。
 *
 * 这是复刻 AriaNg 的主战场：排序、搜索、过滤、拖拽调序、批量操作一个不少，
 * 只是换成了有列对齐的表格 / 卡片双模。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/ui/components/AppIcon.vue'
import TaskTable from '@/ui/components/TaskTable.vue'
import TaskCards from '@/ui/components/TaskCards.vue'
import EmptyState from '@/ui/components/EmptyState.vue'
import { useHostsStore } from '@/stores/hosts'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'
import { useToastStore } from '@/stores/toast'
import { useI18n } from '@/i18n'
import { sortTasks, type TaskSortKey } from '@/core/model/sort'
import { protocolLabel } from '@/core/model/format'
import type { Task } from '@/core/model/task'

const route = useRoute()
const router = useRouter()
const hosts = useHostsStore()
const tasks = useTasksStore()
const ui = useUiStore()
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
    // 状态变化时重置搜索，避免残留的搜索词让用户以为「任务不见了」
    search.value = ''
  },
)

const state = computed(() => (hosts.activeHostId ? tasks.stateFor(hosts.activeHostId) : null))

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
    default:
      return [...value.active, ...value.waiting, ...value.stopped]
  }
})

/** 可选的协议筛选项（只列出实际存在的）。 */
const availableProtocols = computed(() => {
  const set = new Set<string>()
  for (const task of statusTasks.value) set.add(task.protocol)
  return [...set].sort()
})

/** 搜索 + 协议过滤 + 排序。 */
const visibleTasks = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  const filtered = statusTasks.value.filter((task) => {
    if (protocolFilter.value !== 'all' && task.protocol !== protocolFilter.value) return false
    if (!keyword) return true
    return (
      task.name.toLowerCase().includes(keyword) ||
      task.gid.toLowerCase().includes(keyword) ||
      task.dir.toLowerCase().includes(keyword) ||
      task.files.some((file) => file.path.toLowerCase().includes(keyword))
    )
  })
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
        await tasks.remove(hostId, gid)
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
      <button class="an-btn an-btn--primary" type="button" @click="ui.openAddTask()">
        <AppIcon class="an-btn__icon" name="plus" :size="14" />
        {{ t('task.add') }}
      </button>
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
        <option v-for="protocol in availableProtocols" :key="protocol" :value="protocol">
          {{ protocolLabel(protocol) }}
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
