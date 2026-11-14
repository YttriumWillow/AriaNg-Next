<script setup lang="ts">
/**
 * 图标组件。
 *
 * 统一用 lucide 风格的线性图标，尺寸 24x24、描边宽度 2。
 * 抽成组件而不是到处内联 SVG，是为了：
 *  1. 避免重复的 path 数据
 *  2. 颜色统一跟随 currentColor，用户改 CSS 就能改图标颜色
 */
import { computed } from 'vue'

/** 图标名 -> SVG path 数据（d 属性） */
const PATHS: Record<string, string[]> = {
  dashboard: ['M3 3h7v7H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
  check: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4 12 14.01l-3-3'],
  alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z', 'M12 9v4', 'M12 17h.01'],
  sliders: ['M21 4H14', 'M10 4H3', 'M21 12H12', 'M8 12H3', 'M21 20H16', 'M12 20H3', 'M14 2v4', 'M10 10v4', 'M17 18v4'],
  activity: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  palette: [
    'M12 22a10 10 0 1 1 10-10c0 2-1.5 3-3 3h-2a2 2 0 0 0-1 1.7c0 .3-.1 .6-.3.8-.2.2-.5.5-.7.5a10 10 0 0 1-3 0Z',
    'M7.5 10.5h.01',
    'M12 7.5h.01',
    'M16.5 10.5h.01',
  ],
  server: ['M4 4h16v6H4z', 'M4 14h16v6H4z', 'M8 7h.01', 'M8 17h.01'],
  plus: ['M12 5v14', 'M5 12h14'],
  refresh: ['M21 12a9 9 0 0 1-15 6.7L3 16', 'M3 12a9 9 0 0 1 15-6.7L21 8', 'M3 21v-5h5', 'M21 3v5h-5'],
  pause: ['M6 4h4v16H6z', 'M14 4h4v16h-4z'],
  play: ['m6 3 14 9-14 9V3z'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  copy: ['M9 9h10v12H9z', 'M5 15H4V3h12v1'],
  folder: ['M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.5l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2z'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
  offline: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M4.9 4.9l14.2 14.2'],
  chevron: ['m9 18 6-6-6-6'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'],
  layers: ['m12 2 9 5-9 5-9-5 9-5z', 'M3 17l9 5 9-5', 'M3 12l9 5 9-5'],
  code: ['m16 18 6-6-6-6', 'M8 6l-6 6 6 6'],
  sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 1v2', 'M12 21v2', 'M4.2 4.2l1.4 1.4', 'M18.4 18.4l1.4 1.4', 'M1 12h2', 'M21 12h2', 'M4.2 19.8l1.4-1.4', 'M18.4 5.6l1.4-1.4'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
  // 眼睛 / 闭眼 —— 用来切换密码框的明文显示
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  'eye-off': [
    'M10.7 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a13.3 13.3 0 0 1-1.7 2.7',
    'M6.6 6.6A13.4 13.4 0 0 0 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6',
    'M14.1 14.1a3 3 0 1 1-4.2-4.2',
  ],
}

const props = withDefaults(
  defineProps<{
    /** 图标名，取值见 PATHS */
    name: keyof typeof PATHS | string
    /** 尺寸（像素） */
    size?: number
  }>(),
  { size: 16 },
)

const paths = computed(() => PATHS[props.name] ?? PATHS.info)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(d, index) in paths" :key="index" :d="d" />
  </svg>
</template>
