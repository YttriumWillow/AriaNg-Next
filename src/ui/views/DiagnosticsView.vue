<script setup lang="ts">
/**
 * 诊断页。
 *
 * aria2-next 会在 JSON-RPC 里暴露运行时诊断数据（对等发现、tracker 状态、
 * 磁盘队列、协议开销等），同时它也明确移除了部分上游能力。
 * 这一页把两件事都摊开：**我们能用什么，以及我们不能用什么**。
 */
import { computed, ref } from 'vue'
import AppIcon from '@/ui/components/AppIcon.vue'
import EmptyState from '@/ui/components/EmptyState.vue'
import { useHostsStore } from '@/stores/hosts'
import { useToastStore } from '@/stores/toast'
import { useI18n } from '@/i18n'
import { probeCapabilities } from '@/core/model/capability'
import { getClient } from '@/core/rpc/registry'

const hosts = useHostsStore()
const toast = useToastStore()
const { t } = useI18n()

const showMethods = ref(false)

const runtime = computed(() => (hosts.activeHostId ? hosts.runtimeFor(hosts.activeHostId) : null))
const capabilities = computed(() => runtime.value?.capabilities ?? null)

/**
 * aria2-next 相对上游 aria2 的兼容边界。
 * 这些能力是被**移除**的，所以前端不应该给用户显示相关入口。
 */
const removedFeatures = [
  { name: 'FTP', note: '协议栈已移除' },
  { name: 'Metalink 3', note: '仅保留 RFC 5854' },
  { name: 'JSONP', note: '接口不再提供' },
  { name: 'libaria2', note: 'C++ 库不再兼容' },
  { name: '.aria2 控制文件', note: '旧版任务状态不会导入' },
]

/** aria2-next 相对上游**新增**的能力。 */
const addedFeatures = [
  { name: 'ED2K / eMule', note: '服务器 + Kad 双源发现' },
  { name: 'HLS / DASH', note: '原生解析、直播录制、轨道选择' },
  { name: 'SQLite 状态目录', note: '断点续传状态集中保存' },
  { name: '运行时诊断', note: '磁盘队列、协议开销、性能警告' },
]

async function reprobe(): Promise<void> {
  if (!hosts.activeHostId) return
  const client = getClient(hosts.activeHostId)
  if (!client) {
    toast.error(t('connection.disconnected'))
    return
  }
  try {
    const result = await probeCapabilities(client)
    const runtimeValue = hosts.runtimeFor(hosts.activeHostId)
    runtimeValue.capabilities = result
    toast.success(t('settings.optionsSaved'))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('common.error'))
  }
}
</script>

<template>
  <div class="an-page">
    <div class="an-page__head">
      <div>
        <h1 class="an-page__title">{{ t('diagnostics.title') }}</h1>
        <p class="an-page__desc">{{ t('diagnostics.subtitle') }}</p>
      </div>
      <button class="an-btn" type="button" @click="reprobe">
        <AppIcon class="an-btn__icon" name="refresh" :size="14" />
        {{ t('diagnostics.reprobe') }}
      </button>
    </div>

    <EmptyState
      v-if="!capabilities"
      :title="t('connection.disconnected')"
      :description="t('dashboard.noDataHint')"
      icon="offline"
    />

    <template v-else>
      <!-- 基本信息 -->
      <div class="an-grid an-grid--4">
        <div class="an-stat">
          <div class="an-stat__label">{{ t('connection.product') }}</div>
          <div class="an-stat__value" style="font-size: 18px">{{ capabilities.product || 'aria2' }}</div>
          <div class="an-stat__meta">
            {{ capabilities.isAria2Next ? 'aria2-next' : 'aria2 (兼容模式)' }}
          </div>
        </div>
        <div class="an-stat">
          <div class="an-stat__label">{{ t('common.version') }}</div>
          <div class="an-stat__value" style="font-size: 18px">{{ capabilities.version || '—' }}</div>
          <div class="an-stat__meta">{{ t('connection.rpcVersion') }} {{ capabilities.rpcVersion || '—' }}</div>
        </div>
        <div class="an-stat">
          <div class="an-stat__label">{{ t('diagnostics.methods') }}</div>
          <div class="an-stat__value" style="font-size: 18px">{{ capabilities.methods.length }}</div>
          <div class="an-stat__meta">{{ t('diagnostics.methodCount', { count: capabilities.methods.length }) }}</div>
        </div>
        <div class="an-stat">
          <div class="an-stat__label">{{ t('diagnostics.enabledFeatures') }}</div>
          <div class="an-stat__value" style="font-size: 18px">{{ capabilities.enabledFeatures.length }}</div>
          <div class="an-stat__meta">{{ t('diagnostics.featureCount', { count: capabilities.enabledFeatures.length }) }}</div>
        </div>
      </div>

      <div v-if="!capabilities.isAria2Next" class="an-note an-note--warn">
        <AppIcon name="info" :size="14" style="flex: 0 0 14px; margin-top: 1px" />
        <span>{{ t('diagnostics.notAria2Next') }}</span>
      </div>

      <!-- 特性列表 -->
      <div class="an-grid an-grid--2">
        <div class="an-card">
          <div class="an-card__head"><span class="an-card__title">{{ t('diagnostics.mediaFeatures') }}</span></div>
          <div class="an-card__body" style="display: flex; flex-wrap: wrap; gap: 6px">
            <span v-for="feature in capabilities.mediaFeatures" :key="feature" class="an-badge an-badge--accent">
              {{ feature }}
            </span>
            <span v-if="!capabilities.mediaFeatures.length" class="an-field__hint">{{ t('common.empty') }}</span>
          </div>
        </div>
        <div class="an-card">
          <div class="an-card__head"><span class="an-card__title">{{ t('diagnostics.downloadFeatures') }}</span></div>
          <div class="an-card__body" style="display: flex; flex-wrap: wrap; gap: 6px">
            <span v-for="feature in capabilities.downloadFeatures" :key="feature" class="an-badge an-badge--accent">
              {{ feature }}
            </span>
            <span v-if="!capabilities.downloadFeatures.length" class="an-field__hint">{{ t('common.empty') }}</span>
          </div>
        </div>
      </div>

      <!-- 能力开关 -->
      <div class="an-card">
        <div class="an-card__head"><span class="an-card__title">{{ t('diagnostics.capabilities') }}</span></div>
        <div class="an-card__body" style="display: flex; flex-wrap: wrap; gap: 8px">
          <span class="an-badge" :class="capabilities.supports.ed2k ? 'an-badge--success' : 'an-badge--muted'">
            ED2K {{ capabilities.supports.ed2k ? '✓' : '✕' }}
          </span>
          <span class="an-badge" :class="capabilities.supports.media ? 'an-badge--success' : 'an-badge--muted'">
            HLS/DASH {{ capabilities.supports.media ? '✓' : '✕' }}
          </span>
          <span class="an-badge" :class="capabilities.supports.btExtensions ? 'an-badge--success' : 'an-badge--muted'">
            BT 扩展 {{ capabilities.supports.btExtensions ? '✓' : '✕' }}
          </span>
          <span class="an-badge" :class="capabilities.supports.probe ? 'an-badge--success' : 'an-badge--muted'">
            Probe {{ capabilities.supports.probe ? '✓' : '✕' }}
          </span>
          <span class="an-badge" :class="capabilities.supports.finishMedia ? 'an-badge--success' : 'an-badge--muted'">
            FinishMedia {{ capabilities.supports.finishMedia ? '✓' : '✕' }}
          </span>
        </div>
      </div>

      <!-- 兼容边界 -->
      <div class="an-grid an-grid--2">
        <div class="an-card">
          <div class="an-card__head">
            <span class="an-card__title">{{ t('diagnostics.compatBoundary') }}</span>
          </div>
          <div class="an-card__body">
            <p class="an-field__hint" style="margin: 0 0 10px">{{ t('diagnostics.compatHint') }}</p>
            <div v-for="feature in removedFeatures" :key="feature.name" style="display: flex; gap: 8px; align-items: baseline; padding: 4px 0">
              <span class="an-badge an-badge--muted">{{ feature.name }}</span>
              <span style="font-size: 12px; color: var(--an-text-muted)">{{ feature.note }}</span>
            </div>
          </div>
        </div>
        <div class="an-card">
          <div class="an-card__head"><span class="an-card__title">aria2-next 新增</span></div>
          <div class="an-card__body">
            <div v-for="feature in addedFeatures" :key="feature.name" style="display: flex; gap: 8px; align-items: baseline; padding: 4px 0">
              <span class="an-badge an-badge--success">{{ feature.name }}</span>
              <span style="font-size: 12px; color: var(--an-text-muted)">{{ feature.note }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 方法清单 -->
      <div class="an-card">
        <div class="an-card__head">
          <span class="an-card__title">{{ t('diagnostics.methods') }}</span>
          <button class="an-btn an-btn--sm an-btn--ghost" type="button" @click="showMethods = !showMethods">
            {{ showMethods ? '收起' : '展开' }}
          </button>
        </div>
        <div v-if="showMethods" class="an-card__body" style="display: flex; flex-wrap: wrap; gap: 5px">
          <span v-for="method in capabilities.methods" :key="method" class="an-badge" style="font-size: 10px">
            {{ method }}
          </span>
        </div>
      </div>
    </template>
  </div>
</template>
