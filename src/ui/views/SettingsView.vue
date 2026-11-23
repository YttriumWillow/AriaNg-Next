<script setup lang="ts">
/**
 * 设置页。
 *
 * 三个分区：
 *  1. RPC 主机 —— AriaNg 把多主机放在设置里，这里同样保留，并支持增删改
 *  2. 全局选项 —— 直接编辑 aria2 的全局选项表（这是 AriaNg 最被低估的能力）
 *  3. 语言
 */
import { computed, onMounted, ref, watch } from 'vue'
import AppIcon from '@/ui/components/AppIcon.vue'
import { useHostsStore, type HostConfig } from '@/stores/hosts'
import { useToastStore } from '@/stores/toast'
import { useI18n, LOCALES, setLocale, type Locale } from '@/i18n'
import { useHostName } from '@/ui/composables/useHostName'
import { getClient } from '@/core/rpc/registry'
import { Aria2Client } from '@/core/rpc/aria2'
import { createTransport } from '@/core/rpc/transport'
import { describeError, TransportError } from '@/core/rpc/errors'
import { getGlobalOptionDoc, matchesGlobalOption, type GlobalOptionDoc } from '@/core/model/optionDocs'
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

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const version = await Promise.race([
      client.getVersion(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new TransportError(t('connection.testTimeout'), 'aria2.getVersion')),
          8000,
        )
      }),
    ])
    testResult.value = { ok: true, text: `${version.product} v${version.version}` }
  } catch (error) {
    testResult.value = { ok: false, text: describeError(error, t) }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    // 一定要关掉：WebSocket 会一直挂着，不关会漏连接
    transport.close()
    testing.value = false
  }
}

function isValidRpcUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw.trim())
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:' || parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function saveHost(): Promise<void> {
  if (!draft.value.name.trim() || !isValidRpcUrl(draft.value.url)) {
    toast.error(t('connection.protocolHint'))
    return
  }

  const safePoll = Number.isFinite(draft.value.pollIntervalMs)
    ? Math.max(200, Math.round(draft.value.pollIntervalMs))
    : 1000

  const payload = {
    name: draft.value.name.trim(),
    url: draft.value.url.trim(),
    secret: draft.value.secret,
    pollIntervalMs: safePoll,
    autoConnect: draft.value.autoConnect,
  }

  if (editingId.value === 'new') {
    const created = hosts.addHost(payload)
    toast.success(t('common.save'))
    void hosts.connect(created.id)
  } else if (editingId.value) {
    hosts.updateHost(editingId.value, payload)
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
const dirtyOptions = ref<Record<string, string>>({})
const optionSearch = ref('')
const optionsLoading = ref(false)

/** 过滤后的选项列表。支持按英文键名、当前值、中文短标题与中文说明模糊检索。 */
const filteredOptions = computed(() => {
  const keyword = optionSearch.value
  const entries = Object.entries(globalOptions.value)
  if (!keyword.trim()) return entries
  return entries.filter(([name, value]) => matchesGlobalOption(name, value, keyword))
})

/** 预先拼装选项文档，避免模板里重复查表。 */
const optionRows = computed(() =>
  filteredOptions.value.map(([name, value]) => ({
    name,
    value,
    doc: getGlobalOptionDoc(name),
  })),
)

/** 生成合法且唯一的提示框 ID，供 aria-describedby 关联无障碍语义。 */
function tooltipId(name: string): string {
  return `an-option-tip-${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

/** 组装原生 title 文本，作为悬停/聚焦气泡的原生兜底说明。 */
function formatOptionTitle(doc: GlobalOptionDoc): string {
  return doc.example ? `${doc.label}：${doc.description}\n示例：${doc.example}` : `${doc.label}：${doc.description}`
}

async function loadOptions(): Promise<void> {
  if (!hosts.activeHostId) return
  const client = getClient(hosts.activeHostId)
  if (!client) return

  optionsLoading.value = true
  try {
    globalOptions.value = await client.getGlobalOption()
    dirtyOptions.value = {}
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('common.error'))
  } finally {
    optionsLoading.value = false
  }
}

function onOptionChange(name: string, value: string): void {
  globalOptions.value[name] = value
  dirtyOptions.value[name] = value
}

async function saveOptions(): Promise<void> {
  if (!hosts.activeHostId) return
  const client = getClient(hosts.activeHostId)
  if (!client) return

  const changed = { ...dirtyOptions.value }
  if (Object.keys(changed).length === 0) {
    toast.success(t('settings.optionsSaved'))
    return
  }

  try {
    await client.changeGlobalOption(changed)
    dirtyOptions.value = {}
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

watch(
  [tab, () => hosts.activeHostId, () => hosts.activeRuntime?.status],
  ([currentTab, , status]) => {
    if (currentTab === 'options' && status === 'connected') {
      void loadOptions()
    }
  },
)
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
          style="margin: 0 16px 12px"
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
        <div v-else class="an-table-wrap an-table-wrap--options">
          <table class="an-table an-option-table">
            <thead>
              <tr>
                <th style="width: 44%">{{ t('common.name') }}</th>
                <th>{{ t('common.value') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in optionRows" :key="row.name">
                <td class="an-option-cell">
                  <div v-if="row.doc" class="an-option-tip">
                    <div class="an-option-tip__head">
                      <span class="an-option-key">{{ row.name }}</span>
                      <button
                        class="an-option-tip__trigger"
                        type="button"
                        :title="formatOptionTitle(row.doc)"
                        :aria-label="`${row.name}：${row.doc.label}`"
                        :aria-describedby="tooltipId(row.name)"
                      >
                        <AppIcon name="info" :size="13" />
                      </button>
                    </div>
                    <div class="an-option-label">{{ row.doc.label }}</div>
                    <div :id="tooltipId(row.name)" class="an-option-popover" role="tooltip">
                      <div class="an-option-popover__head">
                        <span class="an-option-popover__title">{{ row.doc.label }}</span>
                        <span class="an-option-popover__key">{{ row.name }}</span>
                      </div>
                      <p class="an-option-popover__desc">{{ row.doc.description }}</p>
                      <div v-if="row.doc.example" class="an-option-popover__example">
                        <span class="an-option-popover__example-label">示例：</span>
                        <span>{{ row.doc.example }}</span>
                      </div>
                    </div>
                  </div>
                  <div v-else class="an-option-key">{{ row.name }}</div>
                </td>
                <td>
                  <input
                    :value="row.value"
                    class="an-input"
                    style="height: 26px; min-height: 26px"
                    :aria-label="row.doc ? `${row.name}（${row.doc.label}）` : row.name"
                    @change="(event) => onOptionChange(row.name, (event.target as HTMLInputElement).value)"
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

<style>
@layer components {
  /* 全局选项表格必须放开纵向溢出，否则首尾行的悬停气泡会被 .an-table-wrap 裁剪。 */
  .an-table-wrap.an-table-wrap--options {
    overflow: visible;
  }

  .an-option-table {
    table-layout: fixed;
  }

  .an-option-cell {
    overflow: visible;
    vertical-align: middle;
  }

  /* 选项键名与中文标题容器：作为绝对定位气泡的锚点 */
  .an-option-tip {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    max-width: 100%;
  }

  /* 鼠标悬停或键盘聚焦到说明按钮时，抬高当前容器层级以免被相邻行遮挡 */
  .an-option-tip:hover,
  .an-option-tip:focus-within {
    z-index: 25;
  }

  .an-option-tip__head {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
  }

  /* 界面显眼处的选项键名严格保持无衬线字体 */
  .an-option-key {
    font-family: var(--an-font-sans);
    font-size: var(--an-text-sm);
    font-weight: 600;
    color: var(--an-text);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .an-option-label {
    font-family: var(--an-font-sans);
    font-size: var(--an-text-xs);
    color: var(--an-text-muted);
    line-height: 1.4;
  }

  .an-option-tip__trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 20px;
    width: 20px;
    height: 20px;
    border-radius: var(--an-radius-pill);
    color: var(--an-text-faint);
    text-align: left;
    transition: background var(--an-transition), color var(--an-transition);
  }

  .an-option-tip:hover .an-option-tip__trigger,
  .an-option-tip__trigger:focus-visible {
    background: var(--an-accent-soft);
    color: var(--an-accent);
  }

  /* 悬停 / 键盘聚焦气泡：pointer-events: none 防止鼠标离开锚点后气泡挡住下方行操作 */
  .an-option-popover {
    position: absolute;
    left: 0;
    top: calc(100% + 6px);
    z-index: 30;
    width: min(360px, calc(100vw - 48px));
    padding: 10px 12px;
    border-radius: var(--an-radius-md);
    border: 1px solid var(--an-border-strong);
    background: var(--an-surface);
    color: var(--an-text);
    box-shadow: var(--an-card-highlight), var(--an-shadow-2);
    font-family: var(--an-font-sans);
    font-size: var(--an-text-xs);
    line-height: 1.55;
    text-align: left;
    white-space: normal;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transform: translateY(4px);
    transition: opacity var(--an-transition), transform var(--an-transition), visibility var(--an-transition);
  }

  [data-theme='glass'] .an-option-popover {
    backdrop-filter: blur(var(--an-backdrop-blur)) saturate(150%);
    -webkit-backdrop-filter: blur(var(--an-backdrop-blur)) saturate(150%);
  }

  /* 表格最后两行（且不是第一行时）向上弹出，避免超出卡片底部视野 */
  .an-option-table tbody tr:not(:first-child):nth-last-child(-n + 2) .an-option-popover {
    top: auto;
    bottom: calc(100% + 6px);
    transform: translateY(-4px);
  }

  .an-option-tip:hover .an-option-popover,
  .an-option-tip:focus-within .an-option-popover {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }

  .an-option-popover__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 4px;
  }

  .an-option-popover__title {
    font-weight: 600;
    font-size: var(--an-text-sm);
    color: var(--an-text);
  }

  .an-option-popover__key {
    font-family: var(--an-font-sans);
    font-size: var(--an-text-xs);
    color: var(--an-text-faint);
  }

  .an-option-popover__desc {
    margin: 0;
    color: var(--an-text-muted);
  }

  .an-option-popover__example {
    margin-top: 6px;
    padding: 5px 8px;
    border-radius: var(--an-radius-sm);
    background: var(--an-surface-2);
    color: var(--an-text);
    font-family: var(--an-font-sans);
    overflow-wrap: anywhere;
  }

  .an-option-popover__example-label {
    color: var(--an-text-muted);
    font-weight: 600;
  }
}
</style>
