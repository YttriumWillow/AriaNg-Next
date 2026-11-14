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
import { useHostName } from '@/ui/composables/useHostName'
import { getClient } from '@/core/rpc/registry'
import { Aria2Client } from '@/core/rpc/aria2'
import { createTransport } from '@/core/rpc/transport'
import { describeError, TransportError } from '@/core/rpc/errors'
import type { Aria2Options } from '@/core/rpc/types'

type TabKey = 'hosts' | 'options' | 'language'

const hosts = useHostsStore()
const toast = useToastStore()
const { t, locale } = useI18n()
const { hostName } = useHostName()

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
  testResult.value = null
  showSecret.value = false
}

/* ---------------- 测试连接 ---------------- */

/** 密钥输入框是否显示明文。 */
const showSecret = ref(false)

/** 正在测试中。 */
const testing = ref(false)

/** 测试结果：成功显示版本号，失败显示可操作的错误提示。 */
const testResult = ref<{ ok: boolean; text: string } | null>(null)

/**
 * 用**当前草稿**的地址与密钥试连一次。
 *
 * 为什么要有这个按钮？
 * 因为「添加主机」是**先保存、后连接**的：填错密钥不会当场报错，
 * 而是先留下一台红色的主机，再让你自己去猜是哪错了。
 *
 * 实测中最常见的误操作就是密钥 —— aria2 在密钥不匹配时只回一句
 * "Unauthorized"，不填密钥的实例则连地址都对、状态点却是红的。
 * 有一个当场就能出结果的按钮，能省掉大量猜测。
 *
 * ⚠️ 必须加超时：
 * WsRpcTransport 在连不上时会**无限重连**，请求一直排队不返回 ——
 * 不加超时的话这个按钮会永远转圈。
 */
async function testConnection(): Promise<void> {
  const url = draft.value.url.trim()
  if (!url) {
    toast.error(t('connection.urlRequired'))
    return
  }

  testing.value = true
  testResult.value = null

  // 用一个独立的 transport，不碰 hosts store 里的那些连接
  const transport = createTransport({
    url,
    secret: draft.value.secret.trim() || undefined,
    onStatus: () => {},
  })
  const client = new Aria2Client(transport)

  try {
    const version = await Promise.race([
      client.getVersion(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new TransportError(t('connection.testTimeout'), 'aria2.getVersion')), 8000)
      }),
    ])
    testResult.value = { ok: true, text: `${version.product} v${version.version}` }
  } catch (error) {
    testResult.value = { ok: false, text: describeError(error, t) }
  } finally {
    // 一定要关掉：WebSocket 会一直挂着，不关会漏连接
    transport.close()
    testing.value = false
  }
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
            <div style="font-weight: 600; font-size: 14px">{{ hostName(host) }}</div>
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
            <!--
              密钥框带一个「显示/隐藏」开关。
              因为密钥填错是添加主机时最常见的失败原因，
              而 type="password" 会把填错的内容全部变成圆点 —— 用户根本没法核对。
            -->
            <div style="position: relative">
              <input
                v-model="draft.secret"
                class="an-input"
                :type="showSecret ? 'text' : 'password'"
                style="padding-right: 38px"
                autocomplete="off"
              />
              <button
                class="an-btn an-btn--ghost an-btn--icon"
                type="button"
                :title="showSecret ? t('connection.hideSecret') : t('connection.showSecret')"
                style="position: absolute; right: 4px; top: 50%; transform: translateY(-50%);"
                @click="showSecret = !showSecret"
              >
                <AppIcon :name="showSecret ? 'eye-off' : 'eye'" :size="15" />
              </button>
            </div>
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

        <!-- 测试结果：当场给出结论，而不是让人保存后再看红字 -->
        <div
          v-if="testResult"
          class="an-note"
          :class="testResult.ok ? 'an-note--success' : 'an-note--danger'"
          style="margin: 0 0 12px"
        >
          <AppIcon :name="testResult.ok ? 'check' : 'alert'" :size="14" style="vertical-align: -2px; margin-right: 6px" />
          {{ testResult.text }}
        </div>

        <div class="an-dialog__foot">
          <button class="an-btn" type="button" @click="cancelEdit">{{ t('common.cancel') }}</button>
          <!--
            测试连接放在保存前面。
            用户最怕的是「保存了才发现填错了」，所以先给一个当场出结果的按钮。
          -->
          <button class="an-btn" type="button" :disabled="testing" @click="testConnection">
            <AppIcon class="an-btn__icon" name="activity" :size="14" />
            {{ testing ? t('connection.testing') : t('connection.test') }}
          </button>
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
