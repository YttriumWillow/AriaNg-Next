<script setup lang="ts">
/**
 * 进度条。
 *
 * variant 用来区分不同的进度语义：
 *   default  正常下载
 *   seeding  做种中（已完成但还在上传）
 *   paused   已暂停
 *   error    出错
 *   live     直播录制（进度按呈现时长走，用渐变表示「还在继续」）
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 0~1 */
    progress: number
    variant?: 'default' | 'seeding' | 'paused' | 'error' | 'live'
  }>(),
  { variant: 'default' },
)

const percent = computed(() => Math.min(100, Math.max(0, props.progress * 100)))

const variantClass = computed(() => {
  switch (props.variant) {
    case 'seeding':
      return 'an-progress--seeding'
    case 'paused':
      return 'an-progress--paused'
    case 'error':
      return 'an-progress--error'
    case 'live':
      return 'an-progress--live'
    default:
      return ''
  }
})
</script>

<template>
  <div
    class="an-progress"
    :class="variantClass"
    role="progressbar"
    :aria-valuenow="Math.round(percent)"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div class="an-progress__fill" :style="{ width: `${percent}%` }" />
  </div>
</template>
