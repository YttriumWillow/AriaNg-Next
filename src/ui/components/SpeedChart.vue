<script setup lang="ts">
/**
 * 速率曲线图。
 *
 * 手写 SVG 而不是引入图表库，有三个理由：
 *  1. 这个图只有一个形态（双折线 + 网格），用图表库太重
 *  2. 少一个依赖，构建产物更小
 *  3. 对学习者来说，看得懂 SVG 的每一行比看懂图表库的 API 更有价值
 *
 * 坐标轴说明：
 *  - 横向：最近 N 个采样点（等距，不按真实时间间隔，避免采样抖动导致画面歪斜）
 *  - 纵向：0 ~ max(down, up)
 */
import { computed } from 'vue'
import { useI18n } from '@/i18n'

const props = withDefaults(
  defineProps<{
    /** 采样点 */
    points: { t: number; down: number; up: number }[]
    height?: number
  }>(),
  { height: 180 },
)

const { t } = useI18n()

/** SVG 内部坐标系宽度。用 viewBox + preserveAspectRatio 做等比拉伸。 */
const VIEW_W = 600
const VIEW_H = 180
const PAD = 6

/**
 * 纵轴上限。
 *
 * ⚠️ 这里特意留了 15% 的余量。
 *
 * 如果直接拿采样点的最大值当上限，那么速率打满的那一段曲线会**正好压在图顶**，
 * 看起来像是被裁掉了，而且完全看不出波动形状。
 * 留一点余量，曲线才有呼吸感，读者也更容易分辨起伏。
 *
 * 全 0 的情况返回 1，避免除零（后面要用它做除法）。
 */
const maxValue = computed(() => {
  let max = 0
  for (const point of props.points) {
    if (point.down > max) max = point.down
    if (point.up > max) max = point.up
  }
  return max > 0 ? max * 1.15 : 1
})

/** 把一串数据点转成 SVG path。 */
function buildPath(key: 'down' | 'up'): string {
  const points = props.points
  if (points.length < 2) return ''
  const usable = VIEW_H - PAD * 2
  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * VIEW_W
      const y = VIEW_H - PAD - (point[key] / maxValue.value) * usable
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/** 下载折线下方的填充区域。 */
const areaPath = computed(() => {
  const line = buildPath('down')
  if (!line) return ''
  return `${line} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`
})

const downPath = computed(() => buildPath('down'))
const upPath = computed(() => buildPath('up'))

/** 三条水平网格线。 */
const gridLines = [0, 0.5, 1].map((ratio) => ({
  y1: PAD + ratio * (VIEW_H - PAD * 2),
  y2: PAD + ratio * (VIEW_H - PAD * 2),
}))
</script>

<template>
  <div>
    <svg
      class="an-chart"
      :style="{ height: `${height}px` }"
      :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
      preserveAspectRatio="none"
      role="img"
      aria-label="速率历史曲线"
    >
      <line
        v-for="(line, index) in gridLines"
        :key="index"
        class="an-chart__grid"
        x1="0"
        :y1="line.y1"
        :x2="VIEW_W"
        :y2="line.y2"
      />
      <path class="an-chart__area" :d="areaPath" />
      <path class="an-chart__line--up" :d="upPath" />
      <path class="an-chart__line--down" :d="downPath" />
    </svg>
    <div class="an-legend" style="margin-top: 8px">
      <span class="an-legend__item">
        <span class="an-legend__swatch" />{{ t('chart.download') }}
      </span>
      <span class="an-legend__item">
        <span class="an-legend__swatch an-legend__swatch--muted" />{{ t('chart.upload') }}
      </span>
    </div>
  </div>
</template>
