/**
 * 轻量提示（Toast）store。
 *
 * 任务操作的成功/失败反馈都走这里。
 * 之所以做成 store 而不是组件内状态，是因为操作可能发生在任何一层，
 * 需要一个全局的、唯一的提示出口。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  message: string
  kind: ToastKind
}

let nextId = 1

export const useToastStore = defineStore('toast', () => {
  const toasts = ref<Toast[]>([])

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }

  /** 弹出一条提示。duration 毫秒后自动消失。 */
  function push(message: string, kind: ToastKind = 'info', duration = 4000): void {
    const id = nextId++
    toasts.value.push({ id, message, kind })
    if (duration > 0) {
      window.setTimeout(() => dismiss(id), duration)
    }
  }

  const success = (message: string) => push(message, 'success')
  const error = (message: string) => push(message, 'error', 6000)

  return { toasts, push, success, error, dismiss }
})
