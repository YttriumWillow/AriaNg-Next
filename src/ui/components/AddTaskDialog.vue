<script setup lang="ts">
/**
 * 添加任务对话框。
 *
 * AriaNg 只支持链接 / 种子 / 金属链；aria2-next 把协议扩到了 7 种，
 * 所以这里按协议动态给出参数：
 *  - 链接输入后立即「探测」，识别出是 HLS/DASH 时展示轨道与容器选项
 *  - ED2K 链接直接识别
 *  - magnet / torrent 走标准流程
 */
import { computed, ref, watch } from 'vue'
import AppDialog from '@/ui/components/AppDialog.vue'
import AppIcon from '@/ui/components/AppIcon.vue'
import { useHostsStore } from '@/stores/hosts'
import { useUiStore } from '@/stores/ui'
import { useToastStore } from '@/stores/toast'
import { useI18n } from '@/i18n'
import { getClient } from '@/core/rpc/registry'
import { formatBytes } from '@/core/model/format'
import type { Aria2ProbeResult } from '@/core/rpc/types'

type TabKey = 'link' | 'torrent' | 'batch'

const hosts = useHostsStore()
const ui = useUiStore()
const toast = useToastStore()
const { t } = useI18n()

const tab = ref<TabKey>('link')
const links = ref('')
const torrentBase64 = ref('')
const submitting = ref(false)

const dir = ref('')
const filename = ref('')
const userAgent = ref('')
const referer = ref('')
const connections = ref('')
const limit = ref('')

// 媒体相关
const mediaFormat = ref('mp4')
const mediaVideo = ref('best')
const mediaAudio = ref('best')
const mediaRecordTime = ref('')

const probe = ref<Aria2ProbeResult | null>(null)
const probing = ref(false)

/** 是否是媒体链接（HLS / DASH）。 */
const isMediaLink = computed(() => {
  const text = links.value.trim().toLowerCase()
  return text.includes('.m3u8') || text.includes('.mpd')
})

/** 链接列表（每行一个）。 */
const linkList = computed(() =>
  links.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== ''),
)

/** 打开时彻底重置表单，避免上次的目录/种子/选项残留；若来自 URL API 则预填链接。 */
watch(
  () => ui.addTaskOpen,
  (open) => {
    if (open) {
      const seed = ui.addTaskSeed
      tab.value = seed.includes('\n') ? 'batch' : 'link'
      links.value = seed
      probe.value = null
      torrentBase64.value = ''
      dir.value = ''
      filename.value = ''
      userAgent.value = ''
      referer.value = ''
      connections.value = ''
      limit.value = ''
      mediaFormat.value = 'mp4'
      mediaVideo.value = 'best'
      mediaAudio.value = 'best'
      mediaRecordTime.value = ''
    }
  },
)

/** 把文件读成 base64（去掉 data URL 前缀）。 */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      const comma = result.indexOf(',')
      resolve(comma === -1 ? result : result.slice(comma + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function onPickTorrent(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    torrentBase64.value = await readFileAsBase64(file)
    if (!filename.value) filename.value = file.name.replace(/\.torrent$/i, '')
  } catch {
    toast.error(t('common.error'))
  }
}

/** 探测链接。aria2-next 的 aria2.probe 不真正开始下载，只返回资源信息。 */
async function probeLink(): Promise<void> {
  const uri = linkList.value[0]
  if (!uri || !hosts.activeHostId) return

  const client = getClient(hosts.activeHostId)
  if (!client) {
    toast.error(t('connection.disconnected'))
    return
  }

  probing.value = true
  try {
    probe.value = await client.probe(uri)
    if (probe.value?.filename && !filename.value) filename.value = probe.value.filename
  } catch (error) {
    probe.value = null
    toast.error(error instanceof Error ? error.message : t('common.error'))
  } finally {
    probing.value = false
  }
}

/** 组装 aria2 选项对象。 */
function buildOptions(): Record<string, string> {
  const options: Record<string, string> = {}
  if (dir.value.trim()) options.dir = dir.value.trim()
  if (filename.value.trim()) options.out = filename.value.trim()
  if (userAgent.value.trim()) options['user-agent'] = userAgent.value.trim()
  if (referer.value.trim()) options.referer = referer.value.trim()
  if (connections.value.trim()) options['max-connection-per-server'] = connections.value.trim()
  if (limit.value.trim()) options['max-download-limit'] = limit.value.trim()

  if (isMediaLink.value) {
    options['media-format'] = mediaFormat.value
    options['media-video'] = mediaVideo.value
    options['media-audio'] = mediaAudio.value
    if (mediaRecordTime.value.trim()) options['media-record-time'] = mediaRecordTime.value.trim()
  }

  return options
}

async function submit(): Promise<void> {
  if (!hosts.activeHostId) return
  const client = getClient(hosts.activeHostId)
  if (!client) {
    toast.error(t('connection.disconnected'))
    return
  }

  submitting.value = true
  try {
    const options = buildOptions()

    if (tab.value === 'torrent') {
      if (!torrentBase64.value.trim()) {
        toast.error(t('add.torrentHint'))
        return
      }
      await client.addTorrent(torrentBase64.value.trim(), [], options)
    } else if (tab.value === 'batch') {
      if (linkList.value.length === 0) {
        toast.error(t('add.urlRequired'))
        return
      }
      // 批量模式逐行创建独立任务（而非单任务的多镜像源）
      for (const uri of linkList.value) {
        await client.addUri([uri], options)
      }
    } else {
      if (linkList.value.length === 0) {
        toast.error(t('add.urlRequired'))
        return
      }
      await client.addUri(linkList.value, options)
    }

    toast.success(t('toast.taskAdded'))
    ui.closeAddTask()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : t('common.error'))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AppDialog :open="ui.addTaskOpen" :title="t('add.title')" wide @close="ui.closeAddTask">
    <!-- 来源切换 -->
    <div class="an-seg" style="align-self: flex-start">
      <button class="an-seg__item" :class="{ 'an-seg__item--active': tab === 'link' }" type="button" @click="tab = 'link'">
        {{ t('add.tabLink') }}
      </button>
      <button class="an-seg__item" :class="{ 'an-seg__item--active': tab === 'torrent' }" type="button" @click="tab = 'torrent'">
        {{ t('add.tabTorrent') }}
      </button>
      <button class="an-seg__item" :class="{ 'an-seg__item--active': tab === 'batch' }" type="button" @click="tab = 'batch'">
        {{ t('add.tabBatch') }}
      </button>
    </div>

    <!-- 链接 / 批量 -->
    <div v-if="tab !== 'torrent'" class="an-field">
      <label class="an-field__label" for="add-links">{{ t('add.tabLink') }}</label>
      <textarea
        id="add-links"
        v-model="links"
        class="an-textarea"
        :placeholder="t('add.linkPlaceholder')"
        rows="4"
      />
      <div class="an-field__hint">
        {{ tab === 'batch' ? t('add.tabBatch') : t('add.linkPlaceholder') }}
      </div>
    </div>

    <!-- 种子文件 -->
    <div v-else class="an-field">
      <label class="an-field__label">{{ t('add.tabTorrent') }}</label>
      <input class="an-input" type="file" accept=".torrent,application/x-bittorrent" @change="onPickTorrent" />
      <textarea v-model="torrentBase64" class="an-textarea" :placeholder="t('add.torrentHint')" rows="3" />
    </div>

    <!-- 探测结果 -->
    <div v-if="tab !== 'torrent'" style="display: flex; gap: 8px; align-items: center">
      <button class="an-btn an-btn--sm" type="button" :disabled="probing || !linkList.length" @click="probeLink">
        <AppIcon class="an-btn__icon" name="search" :size="13" />
        {{ probing ? t('add.probing') : t('add.probe') }}
      </button>
      <span v-if="probe" class="an-badge an-badge--accent">
        {{ probe.contentType || '—' }}
        <template v-if="probe.totalLength"> · {{ formatBytes(Number(probe.totalLength)) }}</template>
      </span>
    </div>

    <!-- 媒体参数（仅媒体链接显示） -->
    <div v-if="isMediaLink" class="an-card">
      <div class="an-card__head">
        <span class="an-card__title">{{ t('add.detected') }} · HLS / DASH</span>
        <span class="an-card__hint">aria2-next</span>
      </div>
      <div class="an-card__body" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px">
        <div class="an-field">
          <label class="an-field__label">{{ t('add.mediaFormat') }}</label>
          <select v-model="mediaFormat" class="an-select">
            <option value="mp4">mp4</option>
            <option value="mkv">mkv</option>
          </select>
        </div>
        <div class="an-field">
          <label class="an-field__label">{{ t('add.mediaVideo') }}</label>
          <input v-model="mediaVideo" class="an-input" placeholder="best" />
        </div>
        <div class="an-field">
          <label class="an-field__label">{{ t('add.mediaAudio') }}</label>
          <input v-model="mediaAudio" class="an-input" placeholder="best" />
        </div>
        <div class="an-field">
          <label class="an-field__label">{{ t('add.mediaRecordTime') }}</label>
          <input v-model="mediaRecordTime" class="an-input" placeholder="0" />
        </div>
      </div>
    </div>

    <!-- 高级选项 -->
    <div class="an-card">
      <div class="an-card__head"><span class="an-card__title">{{ t('add.advanced') }}</span></div>
      <div class="an-card__body" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px">
        <div class="an-field">
          <label class="an-field__label">{{ t('add.dir') }}</label>
          <input v-model="dir" class="an-input" placeholder="/downloads" />
        </div>
        <div class="an-field">
          <label class="an-field__label">{{ t('add.filename') }}</label>
          <input v-model="filename" class="an-input" />
        </div>
        <div class="an-field">
          <label class="an-field__label">{{ t('add.connections') }}</label>
          <input v-model="connections" class="an-input" placeholder="16" />
        </div>
        <div class="an-field">
          <label class="an-field__label">{{ t('add.limit') }}</label>
          <input v-model="limit" class="an-input" placeholder="0" />
        </div>
        <div class="an-field">
          <label class="an-field__label">{{ t('add.userAgent') }}</label>
          <input v-model="userAgent" class="an-input" />
        </div>
        <div class="an-field">
          <label class="an-field__label">{{ t('add.referer') }}</label>
          <input v-model="referer" class="an-input" />
        </div>
      </div>
    </div>

    <template #footer>
      <button class="an-btn" type="button" @click="ui.closeAddTask()">{{ t('common.cancel') }}</button>
      <button class="an-btn an-btn--primary" type="button" :disabled="submitting" @click="submit">
        {{ t('add.start') }}
      </button>
    </template>
  </AppDialog>
</template>
