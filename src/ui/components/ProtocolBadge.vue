<script setup lang="ts">
/**
 * 协议徽章。
 *
 * 协议是「识别位」而不是排序维度，所以它紧跟在任务名旁边，
 * 不单独占一列。
 */
import { computed } from 'vue'
import { protocolLabel } from '@/core/model/format'

const props = defineProps<{ protocol: string }>()

const badgeClass = computed(() => {
  switch (props.protocol) {
    case 'bittorrent':
      return 'an-badge--bt'
    case 'ed2k':
      return 'an-badge--ed2k'
    case 'hls':
      return 'an-badge--hls'
    case 'dash':
      return 'an-badge--dash'
    case 'sftp':
      return 'an-badge--sftp'
    case 'metalink':
      return 'an-badge--metalink'
    default:
      return ''
  }
})
</script>

<template>
  <span class="an-badge" :class="badgeClass">{{ protocolLabel(protocol) }}</span>
</template>
