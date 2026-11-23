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
const USABLE_H = VIEW_H - PAD * 2
const VIEW_BOX = `0 0 ${VIEW_W} ${VIEW_H}`
const BASE_Y_STR = (VIEW_H - PAD).toFixed(1)

interface ChartPaths {
  down: string
  up: string
  area: string
}

/** 采样不足两条时复用空路径常量，避免分配任何字符串或数组。 */
const EMPTY_PATHS: ChartPaths = { down: '', up: '', area: '' }

/** 全 0 速率时折线退化为底边水平线，整段只需两个端点即可与 N 点共线完全等价。 */
const FLAT_LINE_PATH = `M0.0,${BASE_Y_STR} L${VIEW_W.toFixed(1)},${BASE_Y_STR}`
const FLAT_PATHS: ChartPaths = {
  down: FLAT_LINE_PATH,
  up: FLAT_LINE_PATH,
  area: `${FLAT_LINE_PATH} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`,
}

/**
 * 在单次计算里同时生成下载线、上传线与下载填充区路径。
 *
 * 为什么合到一个 computed 里？
 *  - 旧实现里 areaPath 与 downPath 会分别调用一次 buildPath('down')，
 *    加上 upPath 和 maxValue，相当于每次轮询对同一组点扫描 4 遍、拼接 900+ 字符串；
 *  - 合并后共用横坐标 x 与纵轴比例 yScale，并针对「空数据」和「全 0 闲置期」做零分配短路；
 *  - 纵轴上限特意留 15% 余量：避免速率打满时曲线正好压在图顶、像被裁切一样看不出起伏。
 */
const chartPaths = computed<ChartPaths>((previous) => {
  const points = props.points
  const len = points.length
  if (len < 2) return EMPTY_PATHS

  let max = 0
  for (let i = 0; i < len; i += 1) {
    const point = points[i]
    if (point.down > max) max = point.down
    if (point.up > max) max = point.up
  }
  if (max <= 0) return FLAT_PATHS

  const yScale = USABLE_H / (max * 1.15)
  const lastIndex = len - 1
  const downParts = new Array<string>(len)
  const upParts = new Array<string>(len)

  for (let i = 0; i < len; i += 1) {
    const point = points[i]
    const cmd = i === 0 ? 'M' : 'L'
    const x = ((i / lastIndex) * VIEW_W).toFixed(1)
    const yDown = (VIEW_H - PAD - point.down * yScale).toFixed(1)
    const yUp = (VIEW_H - PAD - point.up * yScale).toFixed(1)
    downParts[i] = `${cmd}${x},${yDown}`
    upParts[i] = `${cmd}${x},${yUp}`
  }

  const down = downParts.join(' ')
  const up = upParts.join(' ')
  if (previous && previous.down === down && previous.up === up) {
    return previous
  }

  return {
    down,
    up,
    area: `${down} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`,
  }
})

const chartStyle = computed(() => ({ height: `${props.height}px` }))

/** 三条水平网格线。 */
const gridLines = [0, 0.5, 1].map((ratio) => ({
  y1: PAD + ratio * USABLE_H,
  y2: PAD + ratio * USABLE_H,
}))
</script>

<template>
  <div>
    <svg
      class="an-chart"
      :style="chartStyle"
      :viewBox="VIEW_BOX"
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
      <path class="an-chart__area" :d="chartPaths.area" />
      <path class="an-chart__line--up" :d="chartPaths.up" />
      <path class="an-chart__line--down" :d="chartPaths.down" />
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
