<script setup lang="ts">
/**
 * 统计块。
 *
 * 刻意保留 meta 这一行：只有大数字没有上下文是没用的，
 * 比如「18.4 MB/s」必须同时说明这是「总下载速度」还是「单任务速度」。
 */
withDefaults(
  defineProps<{
    label: string
    value: string
    /** 补充说明，例如协议构成 / 峰值 / 做种数 */
    meta?: string
    /** 是否用告警色（异常统计用） */
    alert?: boolean
  }>(),
  { meta: '', alert: false },
)
</script>

<template>
  <div class="an-stat" :class="{ 'an-stat--alert': alert }">
    <div class="an-stat__label">{{ label }}</div>
    <div class="an-stat__value">{{ value }}</div>
    <div class="an-stat__meta">{{ meta }}</div>
  </div>
</template>
