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
import { formatBytes, formatSpeed } from '@/core/model/format'
import { protocolLabel } from '@/core/model/format'

const hosts = useHostsStore()
const tasks = useTasksStore()
const { t } = useI18n()

const state = computed(() => (hosts.activeHostId ? tasks.stateFor(hosts.activeHostId) : null))
const connected = computed(() => hosts.activeRuntime?.status === 'connected')

/** 所有任务（三个状态段合起来）。 */
const allTasks = computed(() => {
  const value = state.value
  if (!value) return []
  return [...value.active, ...value.waiting, ...value.stopped]
})

/** 异常任务数：出错的 + 已暂停但仍在等待队列里的。 */
const anomalyCount = computed(
  () => allTasks.value.filter((task) => task.status === 'error' || task.status === 'paused').length,
)

/** 各协议的任务数量。 */
const protocolCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const task of allTasks.value) {
    counts.set(task.protocol, (counts.get(task.protocol) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
})

/** 各状态的任务数量。 */
const statusCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const task of allTasks.value) {
    counts.set(task.status, (counts.get(task.status) ?? 0) + 1)
  }
  return counts
})

/** 速率峰值。 */
const peakDown = computed(() => {
  const points = state.value?.speedHistory ?? []
  return points.reduce((max, point) => Math.max(max, point.down), 0)
})

/** 最近完成的任务。 */
const recentCompleted = computed(() =>
  allTasks.value
    .filter((task) => task.status === 'complete')
    .sort((a, b) => b.completedLength - a.completedLength)
    .slice(0, 5),
)
</script>

<template>
  <div class="an-page">
    <div class="an-page__head">
      <div>
        <h1 class="an-page__title">{{ t('nav.dashboard') }}</h1>
        <p class="an-page__desc">{{ hosts.activeHost?.name ?? '—' }}</p>
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
          :value="String(state?.active.length ?? 0)"
          :meta="protocolCounts.slice(0, 3).map(([p, n]) => `${protocolLabel(p)} ${n}`).join(' · ')"
        />
        <StatCard
          :label="t('dashboard.downloadSpeed')"
          :value="formatSpeed(state?.globalStat.downloadSpeed ?? 0)"
          :meta="`${t('dashboard.peak')} ${formatSpeed(peakDown)}`"
        />
        <StatCard
          :label="t('dashboard.uploadSpeed')"
          :value="formatSpeed(state?.globalStat.uploadSpeed ?? 0)"
          :meta="`${t('dashboard.seeding')} ${statusCounts.get('complete') ?? 0}`"
        />
        <StatCard
          :label="t('dashboard.anomalies')"
          :value="String(anomalyCount)"
          :meta="`${statusCounts.get('error') ?? 0} ${t('status.error')}`"
          :alert="anomalyCount > 0"
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
            <div v-for="status in ['active', 'waiting', 'paused', 'complete', 'error']" :key="status" style="display: grid; grid-template-columns: 70px 1fr 40px; gap: 10px; align-items: center">
              <span style="font-size: 12px; color: var(--an-text-muted)">{{ t(`status.${status}`) }}</span>
              <div style="height: 7px; border-radius: 4px; background: var(--an-surface-2); overflow: hidden">
                <div
                  style="height: 100%; border-radius: 4px; background: var(--an-accent)"
                  :style="{ width: `${allTasks.length ? ((statusCounts.get(status) ?? 0) / allTasks.length) * 100 : 0}%` }"
                />
              </div>
              <span style="font-size: 12px; text-align: right; font-variant-numeric: tabular-nums">
                {{ statusCounts.get(status) ?? 0 }}
              </span>
            </div>
          </div>
        </div>

        <div class="an-card">
          <div class="an-card__head"><span class="an-card__title">{{ t('dashboard.protocolDistribution') }}</span></div>
          <div class="an-card__body">
            <div style="display: flex; flex-wrap: wrap; gap: 6px">
              <span v-for="[protocol, count] in protocolCounts" :key="protocol" class="an-badge an-badge--accent">
                {{ protocolLabel(protocol) }} {{ count }}
              </span>
              <span v-if="!protocolCounts.length" style="font-size: 12px; color: var(--an-text-faint)">
                {{ t('common.empty') }}
              </span>
            </div>

            <div v-if="recentCompleted.length" style="margin-top: 16px">
              <div class="an-card__title" style="margin-bottom: 8px">{{ t('dashboard.recentCompleted') }}</div>
              <div v-for="task in recentCompleted" :key="task.gid" style="display: flex; align-items: center; gap: 8px; padding: 4px 0">
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
