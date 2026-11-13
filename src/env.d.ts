/// <reference types="vite/client" />

/**
 * 让 TypeScript 认识 .vue 单文件组件。
 * 这是 Vue 官方脚手架的标准写法，不需要改动。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
