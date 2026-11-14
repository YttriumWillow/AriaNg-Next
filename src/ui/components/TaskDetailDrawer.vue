<script setup lang="ts">
/**
 * 任务详情抽屉。
 *
 * 相比 AriaNg 的「跳转到详情页」，这里用右侧抽屉覆盖：
 * 列表保持可见、可以来回对照，操作上下文不会丢失。
 *
 * 分段：概览 / 文件 / 邻居 / 轨道
 * 前三段对应 AriaNg 详情页的信息，第四段承载 aria2-next 的扩展信息。
 */
import { computed, ref, watch } from 'vue'
import AppIcon from '@/ui/components/AppIcon.vue'
import ProgressBar from '@/ui/components/ProgressBar.vue'
import ProtocolBadge from '@/ui/components/ProtocolBadge.vue'
import { useHostsStore } from '@/stores/hosts'
import { useTasksStore } from '@/stores/tasks'
import { useI18n } from '@/i18n'
import { formatBytes, formatDuration, formatEta, formatSpeed } from '@/core/model/format'
// 状态文案的规则在 core 里（错误状态优先于媒体阶段），这里只注入翻译函数
import { taskProgressText, taskStatusText } from '@/core/model/task'

const hosts = useHostsStore()
const tasks = useTasksStore()
const { t } = useI18n()

type TabKey = 'overview' | 'files' | 'peers' | 'trackers'
const activeTab = ref<TabKey>('overview')

const tabs: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'detail.overview' },
  { key: 'files', label: 'detail.files' },
  { key: 'peers', label: 'detail.peers' },
  { key: 'trackers', label: 'detail.trackers' },
]

/** 当前查看的任务对象。 */
const task = computed(() => {
  if (!tasks.detailGid || !hosts.activeHostId) return null
  const state = tasks.stateFor(hosts.activeHostId)
  return (
    state.active.find((item) => item.gid === tasks.detailGid) ??
    state.waiting.find((item) => item.gid === tasks.detailGid) ??
    state.stopped.find((item) => item.gid === tasks.detailGid) ??
    null
  )
})

const detail = computed(() => tasks.detail)

// 切换任务时回到第一个分段
watch(
  () => tasks.detailGid,
  () => {
    activeTab.value = 'overview'
  },
)

function close(): void {
  tasks.closeDetail()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="task" class="an-drawer__scrim" @click="close" />
    <aside v-if="task" class="an-drawer an-drawer--open" role="dialog" aria-modal="true">
      <!-- 头部 -->
      <header class="an-drawer__head">
        <div style="min-width: 0; flex: 1">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px">
            <ProtocolBadge :protocol="task.protocol" />
            <span class="an-badge" :class="{
              'an-badge--success': task.status === 'complete',
              'an-badge--danger': task.status === 'error',
              'an-badge--warning': task.status === 'paused',
            }">
              {{ taskStatusText(task, t) }}
            </span>
          </div>
          <div class="an-drawer__title" :title="task.name">{{ task.name }}</div>
          <div class="an-drawer__meta">{{ task.gid }} · {{ task.dir }}</div>
        </div>
        <button class="an-btn an-btn--ghost an-btn--icon" type="button" @click="close">
          <AppIcon class="an-btn__icon" name="close" :size="15" />
        </button>
      </header>

      <!-- 分段导航 -->
      <nav class="an-tabs" style="padding: 0 16px">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="an-tabs__item"
          :class="{ 'an-tabs__item--active': activeTab === tab.key }"
          type="button"
          @click="activeTab = tab.key"
        >
          {{ t(tab.label) }}
        </button>
      </nav>

      <div class="an-drawer__body">
        <!-- 概览 -->
        <section v-if="activeTab === 'overview'" class="an-drawer__section">
          <div>
            <ProgressBar :progress="task.media?.live ? 0 : task.progress" :variant="task.status === 'error' ? 'error' : 'default'" />
            <div class="an-drawer__meta" style="margin-top: 5px">
              {{ taskProgressText(task, t) }}
              <span v-if="task.totalLength > 0"> · {{ formatBytes(task.completedLength) }} / {{ formatBytes(task.totalLength) }}</span>
            </div>
          </div>

          <div class="an-kv">
            <span class="an-kv__key">{{ t('task.downloadSpeed') }}</span>
            <span class="an-kv__value">{{ formatSpeed(task.downloadSpeed) }}</span>
            <span class="an-kv__key">{{ t('task.uploadSpeed') }}</span>
            <span class="an-kv__value">{{ formatSpeed(task.uploadSpeed) }}</span>
            <span class="an-kv__key">{{ t('task.remaining') }}</span>
            <span class="an-kv__value">{{ task.remainingLength > 0 ? formatBytes(task.remainingLength) : '—' }}</span>
            <span class="an-kv__key">{{ t('task.eta') }}</span>
            <span class="an-kv__value">{{ formatEta(task.etaSeconds) }}</span>
            <span class="an-kv__key">{{ t('task.peers') }}</span>
            <span class="an-kv__value">{{ task.connections }}</span>
            <span class="an-kv__key">{{ t('task.dir') }}</span>
            <span class="an-kv__value">{{ task.dir }}</span>
          </div>

          <!-- 媒体任务专属 -->
          <div v-if="task.media" class="an-card">
            <div class="an-card__head">
              <span class="an-card__title">{{ t('detail.mediaTracks') }}</span>
              <span class="an-card__hint">{{ task.media.protocol.toUpperCase() }}</span>
            </div>
            <div class="an-card__body">
              <div class="an-kv">
                <span class="an-kv__key">{{ t('task.progress') }}</span>
                <span class="an-kv__value">
                  {{ task.media.live ? t('status.active') : `${formatDuration(task.media.completedDuration)} / ${formatDuration(task.media.duration)}` }}
                </span>
                <span class="an-kv__key">{{ t('common.size') }}</span>
                <span class="an-kv__value">{{ formatBytes(task.media.downloadedLength) }}</span>
              </div>
              <div v-if="task.media.errorCode" class="an-note an-note--danger" style="margin-top: 10px">
                {{ task.media.errorCode }} · {{ task.media.error }}
              </div>
              <div v-if="task.media.tracks.length" class="an-tree" style="margin-top: 10px">
                <div v-for="track in task.media.tracks" :key="track.id" class="an-tree__node">
                  <span class="an-badge">{{ track.type }}</span>
                  <span class="an-tree__name">{{ track.language || track.id }}</span>
                  <span class="an-tree__size">{{ track.bandwidth ? `${Math.round(track.bandwidth / 1000)} kbps` : '' }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- ED2K 专属 -->
          <div v-if="task.ed2k" class="an-card">
            <div class="an-card__head"><span class="an-card__title">{{ t('detail.ed2kInfo') }}</span></div>
            <div class="an-card__body">
              <div class="an-kv">
                <span class="an-kv__key">Hash</span>
                <span class="an-kv__value">{{ task.ed2k.hash }}</span>
                <span class="an-kv__key">Peer</span>
                <span class="an-kv__value">{{ task.ed2k.peerCount }}</span>
                <span class="an-kv__key">Corrupt</span>
                <span class="an-kv__value">{{ task.ed2k.corruptPartCount }}</span>
                <span class="an-kv__key">Sharing</span>
                <span class="an-kv__value">{{ formatDuration(task.ed2k.sharingTime) }}</span>
              </div>
            </div>
          </div>

          <!-- BitTorrent 专属 -->
          <div v-if="task.bittorrent" class="an-card">
            <div class="an-card__head"><span class="an-card__title">{{ t('detail.btInfo') }}</span></div>
            <div class="an-card__body">
              <div class="an-kv">
                <span class="an-kv__key">Peers</span>
                <span class="an-kv__value">{{ task.bittorrent.numPeers }}</span>
                <span class="an-kv__key">Seeders</span>
                <span class="an-kv__value">{{ task.bittorrent.numSeeds }}</span>
                <span class="an-kv__key">Availability</span>
                <span class="an-kv__value">{{ task.bittorrent.availability }}</span>
                <span class="an-kv__key">InfoHash v1</span>
                <span class="an-kv__value">{{ task.bittorrent.infoHashV1 || '—' }}</span>
                <span class="an-kv__key">InfoHash v2</span>
                <span class="an-kv__value">{{ task.bittorrent.infoHashV2 || '—' }}</span>
                <span class="an-kv__key">File selection</span>
                <span class="an-kv__value">{{ task.bittorrent.fileSelectionState || 'none' }}</span>
              </div>
            </div>
          </div>

          <div v-if="task.errorMessage" class="an-note an-note--danger">
            {{ task.errorCode }} · {{ task.errorMessage }}
          </div>
        </section>

        <!-- 文件 -->
        <section v-else-if="activeTab === 'files'" class="an-drawer__section">
          <div v-if="detail?.loading" class="an-drawer__meta">{{ t('common.loading') }}</div>
          <div v-else-if="!detail?.files.length" class="an-drawer__meta">{{ t('detail.noFiles') }}</div>
          <div v-else class="an-tree">
            <div v-for="file in detail.files" :key="file.index" class="an-tree__node">
              <AppIcon name="folder" :size="13" style="opacity: 0.5" />
              <span class="an-tree__name" :title="file.path">{{ file.path }}</span>
              <span class="an-tree__size">{{ formatBytes(Number(file.length)) }}</span>
            </div>
          </div>
        </section>

        <!-- 邻居 -->
        <section v-else-if="activeTab === 'peers'" class="an-drawer__section">
          <div v-if="detail?.loading" class="an-drawer__meta">{{ t('common.loading') }}</div>
          <div v-else-if="!detail?.peers.length" class="an-drawer__meta">{{ t('detail.noPeers') }}</div>
          <div v-else class="an-tree">
            <div v-for="peer in detail.peers" :key="peer.peerId" class="an-tree__node">
              <span class="an-tree__name">{{ peer.ip }}:{{ peer.port }}</span>
              <span class="an-badge">{{ peer.clientName || '—' }}</span>
              <span class="an-tree__size">{{ formatSpeed(Number(peer.downloadSpeed || 0)) }}</span>
            </div>
          </div>
        </section>

        <!-- 轨道 -->
        <section v-else class="an-drawer__section">
          <div v-if="detail?.loading" class="an-drawer__meta">{{ t('common.loading') }}</div>
          <div v-else-if="!detail?.trackers.length" class="an-drawer__meta">{{ t('detail.noTrackers') }}</div>
          <div v-else class="an-tree">
            <div v-for="tracker in detail.trackers" :key="tracker.announceUrl" class="an-tree__node">
              <span class="an-tree__name" :title="tracker.announceUrl">{{ tracker.announceUrl }}</span>
              <span class="an-badge" :class="tracker.status === 'working' ? 'an-badge--success' : 'an-badge--muted'">
                {{ tracker.status }}
              </span>
            </div>
          </div>
        </section>
      </div>
    </aside>
  </Teleport>
</template>
