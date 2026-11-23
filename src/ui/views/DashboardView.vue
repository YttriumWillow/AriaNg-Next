<script setup lang="ts">
/**
 * 仪表盘。
 *
 * 回答一个问题：**此刻整体在发生什么**。
 * 所以只放统计、速率曲线与分布，不放明细列表 —— 明细是任务页的事。
 */
import { computed } from 'vue'
import StatCard from '@/ui/components/StatCard.vue'
import SpeedChart from '@/ui/components/SpeedChart.vue'
import EmptyState from '@/ui/components/EmptyState.vue'
import ProtocolBadge from '@/ui/components/ProtocolBadge.vue'
import { useHostsStore } from '@/stores/hosts'
import { useTasksStore } from '@/stores/tasks'
import { useI18n } from '@/i18n'
import { useHostName } from '@/ui/composables/useHostName'
import { formatBytes, formatSpeed, protocolLabel } from '@/core/model/format'
import type { Task } from '@/core/model/task'

const hosts = useHostsStore()
const tasks = useTasksStore()
const { t } = useI18n()
const { hostName } = useHostName()

// 只读访问当前主机快照，避免在 computed / 渲染期触发 stateFor() 写入副作用
const state = computed(() => (hosts.activeHostId ? (tasks.byHost[hosts.activeHostId] ?? null) : null))
const connected = computed(() => hosts.activeRuntime?.status === 'connected')

interface DashboardSummary {
  totalCount: number
  activeCount: number
  anomalyCount: number
  seedingCount: number
  statusCounts: Record<string, number>
  protocolCounts: [string, number][]
  activeProtocolCounts: [string, number][]
  activeProtocolText: string
  recentCompleted: Task[]
}

const STATUS_ORDER = ['active', 'waiting', 'paused', 'complete', 'error'] as const

const STATUS_BAR_COLORS: Record<string, string> = {
  active: 'var(--an-accent)',
  waiting: 'var(--an-info)',
  paused: 'var(--an-warning)',
  complete: 'var(--an-success)',
  error: 'var(--an-danger)',
}

/**
 * 仪表盘单遍统计摘要。
 *
 * 把状态分布、总协议分布、活跃协议分布、做种数、异常数与最近完成 Top 5
 * 合并进一次遍历中完成，避免拼接 allTasks 并反复全量扫表 5 次：
 *  - 当速率历史每秒新增采样但任务列表未变化时，本 computed 不会重新计算；
 *  - ⚠️ 活跃任务的协议分布（activeProtocolCounts）必须与全部任务的协议分布分开：
 *    「活跃任务 N」卡片的副行必须和主数字同一个口径（只数活跃任务），
 *    全部任务的协议分布由下方「协议分布」卡片单独呈现。
 */
const dashboardSummary = computed<DashboardSummary>(() => {
  const value = state.value
  const statusCounts: Record<string, number> = {
    active: 0,
    waiting: 0,
    paused: 0,
    complete: 0,
    error: 0,
  }

  if (!value) {
    return {
      totalCount: 0,
      activeCount: 0,
      anomalyCount: 0,
      seedingCount: 0,
      statusCounts,
      protocolCounts: [],
      activeProtocolCounts: [],
      activeProtocolText: '',
      recentCompleted: [],
    }
  }

  const protocolMap = new Map<string, number>()
  const activeProtocolMap = new Map<string, number>()
  const recentCompleted: Task[] = []
  let totalCount = 0
  let anomalyCount = 0
  let seedingCount = 0

  const visit = (task: Task, isActiveList: boolean): void => {
    totalCount += 1
    statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1
    protocolMap.set(task.protocol, (protocolMap.get(task.protocol) ?? 0) + 1)

    if (isActiveList) {
      activeProtocolMap.set(task.protocol, (activeProtocolMap.get(task.protocol) ?? 0) + 1)
      if (task.totalLength > 0 && task.completedLength >= task.totalLength) {
        seedingCount += 1
      }
    }

    if (task.status === 'error' || task.status === 'paused') {
      anomalyCount += 1
    }

    if (task.status === 'complete') {
      // 仅维护前 5 条最大已完成任务，跳过全量 filter + sort 分配
      if (recentCompleted.length < 5 || task.completedLength > recentCompleted[4].completedLength) {
        let insertAt = recentCompleted.length
        for (let i = 0; i < recentCompleted.length; i += 1) {
          if (task.completedLength > recentCompleted[i].completedLength) {
            insertAt = i
            break
          }
        }
        recentCompleted.splice(insertAt, 0, task)
        if (recentCompleted.length > 5) recentCompleted.pop()
      }
    }
  }

  for (const task of value.active) visit(task, true)
  for (const task of value.waiting) visit(task, false)
  for (const task of value.stopped) visit(task, false)

  const protocolCounts = [...protocolMap.entries()].sort((a, b) => b[1] - a[1])
  const activeProtocolCounts = [...activeProtocolMap.entries()].sort((a, b) => b[1] - a[1])
  const activeProtocolText = activeProtocolCounts
    .map(([protocol, count]) => `${protocolLabel(protocol)} ${count}`)
    .join(' · ')

  return {
    totalCount,
    activeCount: value.active.length,
    anomalyCount,
    seedingCount,
    statusCounts,
    protocolCounts,
    activeProtocolCounts,
    activeProtocolText,
    recentCompleted,
  }
})

/** 速率峰值。 */
const peakDown = computed(() => {
  const points = state.value?.speedHistory
  if (!points || points.length === 0) return 0
  let max = 0
  for (let i = 0; i < points.length; i += 1) {
    if (points[i].down > max) max = points[i].down
  }
  return max
})
</script>

<template>
  <div class="an-page">
    <div class="an-page__head">
      <div>
        <h1 class="an-page__title">{{ t('nav.dashboard') }}</h1>
        <p class="an-page__desc">{{ hostName(hosts.activeHost) }}</p>
      </div>
    </div>

    <EmptyState
      v-if="!connected"
      :title="t('dashboard.noData')"
      :description="t('dashboard.noDataHint')"
      icon="offline"
    />

    <template v-else>
      <!-- 四个统计块 -->
      <div class="an-grid an-grid--4">
        <StatCard
          :label="t('dashboard.activeTasks')"
          :value="String(dashboardSummary.activeCount)"
          :meta="dashboardSummary.activeProtocolText || `${t('dashboard.totalTasks')} ${dashboardSummary.totalCount}`"
        />
        <StatCard
          :label="t('dashboard.downloadSpeed')"
          :value="formatSpeed(state?.globalStat.downloadSpeed ?? 0)"
          :meta="`${t('dashboard.peak')} ${formatSpeed(peakDown)}`"
        />
        <StatCard
          :label="t('dashboard.uploadSpeed')"
          :value="formatSpeed(state?.globalStat.uploadSpeed ?? 0)"
          :meta="`${t('dashboard.seeding')} ${dashboardSummary.seedingCount}`"
        />
        <StatCard
          :label="t('dashboard.anomalies')"
          :value="String(dashboardSummary.anomalyCount)"
          :meta="`${dashboardSummary.statusCounts.error ?? 0} ${t('status.error')}`"
          :alert="dashboardSummary.anomalyCount > 0"
        />
      </div>

      <!-- 速率曲线 -->
      <div class="an-card">
        <div class="an-card__head">
          <span class="an-card__title">{{ t('dashboard.rateHistory') }}</span>
          <span class="an-card__hint">{{ t('dashboard.samples', { count: state?.speedHistory.length ?? 0 }) }}</span>
        </div>
        <div class="an-card__body">
          <SpeedChart :points="state?.speedHistory ?? []" />
        </div>
      </div>

      <!-- 分布 -->
      <div class="an-grid an-grid--2">
        <div class="an-card">
          <div class="an-card__head"><span class="an-card__title">{{ t('dashboard.statusDistribution') }}</span></div>
          <div class="an-card__body" style="display: flex; flex-direction: column; gap: 8px">
            <div v-for="status in STATUS_ORDER" :key="status" style="display: grid; grid-template-columns: 70px 1fr 40px; gap: 10px; align-items: center">
              <span style="font-size: 12px; color: var(--an-text-muted)">{{ t(`status.${status}`) }}</span>
              <div style="height: 7px; border-radius: 4px; background: var(--an-surface-2); overflow: hidden">
                <div
                  style="height: 100%; border-radius: 4px"
                  :style="{
                    width: `${dashboardSummary.totalCount ? ((dashboardSummary.statusCounts[status] ?? 0) / dashboardSummary.totalCount) * 100 : 0}%`,
                    background: STATUS_BAR_COLORS[status] ?? 'var(--an-accent)',
                  }"
                />
              </div>
              <span style="font-size: 12px; text-align: right; font-variant-numeric: tabular-nums">
                {{ dashboardSummary.statusCounts[status] ?? 0 }}
              </span>
            </div>
          </div>
        </div>

        <div class="an-card">
          <div class="an-card__head"><span class="an-card__title">{{ t('dashboard.protocolDistribution') }}</span></div>
          <div class="an-card__body">
            <div style="display: flex; flex-wrap: wrap; gap: 6px">
              <span v-for="[protocol, count] in dashboardSummary.protocolCounts" :key="protocol" class="an-badge an-badge--accent">
                {{ protocolLabel(protocol) }} {{ count }}
              </span>
              <span v-if="!dashboardSummary.protocolCounts.length" style="font-size: 12px; color: var(--an-text-faint)">
                {{ t('common.empty') }}
              </span>
            </div>

            <div v-if="dashboardSummary.recentCompleted.length" style="margin-top: 16px">
              <div class="an-card__title" style="margin-bottom: 8px">{{ t('dashboard.recentCompleted') }}</div>
              <div v-for="task in dashboardSummary.recentCompleted" :key="task.gid" style="display: flex; align-items: center; gap: 8px; padding: 4px 0">
                <ProtocolBadge :protocol="task.protocol" />
                <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px">
                  {{ task.name }}
                </span>
                <span style="font-size: 12px; color: var(--an-text-faint)">{{ formatBytes(task.completedLength) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
