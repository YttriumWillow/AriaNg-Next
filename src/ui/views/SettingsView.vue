<script setup lang="ts">
/**
 * 设置页。
 *
 * 三个分区：
 *  1. RPC 主机 —— AriaNg 把多主机放在设置里，这里同样保留，并支持增删改
 *  2. 全局选项 —— 直接编辑 aria2 的全局选项表（这是 AriaNg 最被低估的能力）
 *  3. 语言
 */
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/ui/components/AppIcon.vue'
import { useHostsStore, type HostConfig } from '@/stores/hosts'
import { useToastStore } from '@/stores/toast'
import { useI18n, LOCALES, setLocale, type Locale } from '@/i18n'
import { getClient } from '@/core/rpc/registry'
import type { Aria2Options } from '@/core/rpc/types'

type TabKey = 'hosts' | 'options' | 'language'

const hosts = useHostsStore()
const toast = useToastStore()
const { t, locale } = useI18n()

const tab = ref<TabKey>('hosts')

/* ---------------- 主机编辑 ---------------- */

const editingId = ref<string | null>(null)
const draft = ref<HostConfig>({ id: '', name: '', url: '', secret: '', pollIntervalMs: 1000, autoConnect: true })

function startEdit(host: HostConfig): void {
  editingId.value = host.id
  draft.value = { ...host }
}

function startCreate(): void {
  editingId.value = 'new'
  draft.value = {
    id: 'new',
    name: '新主机',
    url: 'ws://127.0.0.1:6800/jsonrpc',
    secret: '',
    pollIntervalMs: 1000,
    autoConnect: true,
  }
}

function cancelEdit(): void {
  editingId.value = null
}

async function saveHost(): Promise<void> {
  if (!draft.value.name.trim() || !draft.value.url.trim()) {
    toast.error(t('common.error'))
    return
  }

  if (editingId.value === 'new') {
    const { id: _ignored, ...rest } = draft.value
    const created = hosts.addHost(rest)
    toast.success(t('common.save'))
    void hosts.connect(created.id)
  } else if (editingId.value) {
    hosts.updateHost(editingId.value, {
      name: draft.value.name,
      url: draft.value.url,
      secret: draft.value.secret,
      pollIntervalMs: draft.value.pollIntervalMs,
      autoConnect: draft.value.autoConnect,
    })
    toast.success(t('common.save'))
  }
  cancelEdit()
}

async function removeHost(hostId: string): Promise<void> {
  hosts.removeHost(hostId)
  toast.success(t('common.remove'))
}

/* ---------------- 全局选项 ---------------- */

const globalOptions = ref<Aria2Options>({})
const optionSearch = ref('')
const optionsLoading = ref(false)

/** 过滤后的选项列表。aria2 的选项有一百多项，必须能搜。 */
const filteredOptions = computed(() => {
  const keyword = optionSearch.value.trim().toLowerCase()
  const entries = Object.entries(globalOptions.value)
  if (!keyword) return entries
  return entries.filter(([name, value]) => name.toLowerCase().includes(keyword) || value.toLowerCase().includes(keyword))
})

async function loadOptions(): Promise<void> {
  if (!hosts.activeHostId) return
  const client = getClient(hosts.activeHostId)
  if (!client) return

  optionsLoading.value = true
  try {
    globalOptions.value = await client.getGlobalOption()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('common.error'))
  } finally {
    optionsLoading.value = false
  }
}

async function saveOptions(): Promise<void> {
  if (!hosts.activeHostId) return
  const client = getClient(hosts.activeHostId)
  if (!client) return

  try {
    await client.changeGlobalOption(globalOptions.value)
    toast.success(t('settings.optionsSaved'))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('common.error'))
  }
}

function changeLocale(next: Locale): void {
  setLocale(next)
}

/** 取某主机的能力信息（可能还没探测过）。 */
function capabilityOf(hostId: string) {
  return hosts.runtimeFor(hostId).capabilities
}

onMounted(() => {
  void loadOptions()
})
</script>

<template>
  <div class="an-page">
    <div class="an-page__head">
      <div>
        <h1 class="an-page__title">{{ t('settings.title') }}</h1>
      </div>
    </div>

    <div class="an-tabs">
      <button class="an-tabs__item" :class="{ 'an-tabs__item--active': tab === 'hosts' }" type="button" @click="tab = 'hosts'">
        {{ t('settings.hosts') }}
      </button>
      <button class="an-tabs__item" :class="{ 'an-tabs__item--active': tab === 'options' }" type="button" @click="tab = 'options'">
        {{ t('settings.globalOptions') }}
      </button>
      <button class="an-tabs__item" :class="{ 'an-tabs__item--active': tab === 'language' }" type="button" @click="tab = 'language'">
        {{ t('settings.language') }}
      </button>
    </div>

    <!-- 主机 -->
    <section v-if="tab === 'hosts'" style="display: flex; flex-direction: column; gap: 12px">
      <div v-for="host in hosts.hosts" :key="host.id" class="an-card">
        <div class="an-card__body" style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
          <span class="an-status-dot" :class="{
            'an-status-dot--active': hosts.runtimeFor(host.id).status === 'connected',
            'an-status-dot--waiting': ['connecting', 'reconnecting'].includes(hosts.runtimeFor(host.id).status),
            'an-status-dot--error': hosts.runtimeFor(host.id).status === 'error',
          }" />
          <div style="flex: 1; min-width: 160px">
            <div style="font-weight: 600; font-size: 14px">{{ host.name }}</div>
            <div class="an-task-name__path">{{ host.url }}</div>
            <div v-if="hosts.runtimeFor(host.id).error" style="font-size: 11.5px; color: var(--an-danger)">
              {{ hosts.runtimeFor(host.id).error }}
            </div>
          </div>
          <span v-if="capabilityOf(host.id)" class="an-badge an-badge--muted">
            {{ capabilityOf(host.id)?.product || 'aria2' }}
            v{{ capabilityOf(host.id)?.version }}
          </span>
          <button class="an-btn an-btn--sm" type="button" @click="hosts.connect(host.id)">
            <AppIcon class="an-btn__icon" name="refresh" :size="13" />
          </button>
          <button class="an-btn an-btn--sm" type="button" @click="startEdit(host)">{{ t('common.edit') }}</button>
          <button class="an-btn an-btn--sm an-btn--danger" type="button" @click="removeHost(host.id)">
            <AppIcon class="an-btn__icon" name="trash" :size="13" />
          </button>
        </div>
      </div>

      <button class="an-btn" type="button" style="align-self: flex-start" @click="startCreate">
        <AppIcon class="an-btn__icon" name="plus" :size="14" />
        {{ t('connection.addHost') }}
      </button>

      <!-- 编辑表单 -->
      <div v-if="editingId" class="an-card">
        <div class="an-card__head"><span class="an-card__title">{{ editingId === 'new' ? t('connection.addHost') : t('connection.editHost') }}</span></div>
        <div class="an-card__body" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px">
          <div class="an-field">
            <label class="an-field__label">{{ t('connection.hostName') }}</label>
            <input v-model="draft.name" class="an-input" />
          </div>
          <div class="an-field">
            <label class="an-field__label">{{ t('connection.url') }}</label>
            <input v-model="draft.url" class="an-input" placeholder="ws://127.0.0.1:6800/jsonrpc" />
            <span class="an-field__hint">{{ t('connection.protocolHint') }}</span>
          </div>
          <div class="an-field">
            <label class="an-field__label">{{ t('connection.secret') }}</label>
            <input v-model="draft.secret" class="an-input" type="password" />
            <span class="an-field__hint">{{ t('connection.secretHint') }}</span>
          </div>
          <div class="an-field">
            <label class="an-field__label">{{ t('connection.pollInterval') }} ({{ t('connection.pollIntervalUnit') }})</label>
            <input v-model.number="draft.pollIntervalMs" class="an-input" type="number" min="200" step="100" />
          </div>
          <label class="an-switch" :class="{ 'an-switch--on': draft.autoConnect }" style="align-self: end; padding-bottom: 6px">
            <input v-model="draft.autoConnect" class="an-switch__input" type="checkbox" />
            <span class="an-switch__track" />
            <span>{{ t('connection.autoConnect') }}</span>
          </label>
        </div>
        <div class="an-dialog__foot">
          <button class="an-btn" type="button" @click="cancelEdit">{{ t('common.cancel') }}</button>
          <button class="an-btn an-btn--primary" type="button" @click="saveHost">{{ t('common.save') }}</button>
        </div>
      </div>
    </section>

    <!-- 全局选项 -->
    <section v-else-if="tab === 'options'" style="display: flex; flex-direction: column; gap: 12px">
      <div class="an-toolbar">
        <div class="an-toolbar__search">
          <AppIcon name="search" :size="13" style="opacity: 0.5" />
          <input v-model="optionSearch" :placeholder="t('settings.optionSearch')" />
        </div>
        <button class="an-btn an-btn--sm" type="button" :disabled="optionsLoading" @click="loadOptions">
          <AppIcon class="an-btn__icon" name="refresh" :size="13" />
          {{ t('common.refresh') }}
        </button>
        <button class="an-btn an-btn--sm an-btn--primary" type="button" @click="saveOptions">
          {{ t('settings.saveOptions') }}
        </button>
      </div>

      <div class="an-card">
        <div v-if="!filteredOptions.length" class="an-empty">
          <div class="an-empty__title">{{ t('settings.noOptions') }}</div>
        </div>
        <div v-else class="an-table-wrap">
          <table class="an-table">
            <thead>
              <tr>
                <th style="width: 38%">{{ t('common.name') }}</th>
                <th>{{ t('common.value') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="[name, value] in filteredOptions" :key="name">
                <td style="font-family: var(--an-font-mono); font-size: 12px">{{ name }}</td>
                <td>
                  <input
                    :value="value"
                    class="an-input"
                    style="height: 26px; min-height: 26px"
                    @change="(event) => { globalOptions[name] = (event.target as HTMLInputElement).value }"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- 语言 -->
    <section v-else class="an-card">
      <div class="an-card__head"><span class="an-card__title">{{ t('settings.language') }}</span></div>
      <div class="an-card__body" style="display: flex; gap: 8px; flex-wrap: wrap">
        <button
          v-for="item in LOCALES"
          :key="item.value"
          class="an-btn"
          :class="{ 'an-btn--primary': locale === item.value }"
          type="button"
          @click="changeLocale(item.value)"
        >
          {{ item.label }}
        </button>
      </div>
    </section>
  </div>
</template>
