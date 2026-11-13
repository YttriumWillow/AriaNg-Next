/**
 * 界面状态 store：控制对话框的开关、当前选中的任务等纯 UI 状态。
 *
 * 和业务数据分开，界面状态不需要持久化。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  /** 「添加任务」对话框是否打开 */
  const addTaskOpen = ref(false)
  /** 打开对话框时预填的内容（来自 URL 命令行 API） */
  const addTaskSeed = ref('')

  function openAddTask(seed = ''): void {
    addTaskSeed.value = seed
    addTaskOpen.value = true
  }

  function closeAddTask(): void {
    addTaskOpen.value = false
    addTaskSeed.value = ''
  }

  return { addTaskOpen, addTaskSeed, openAddTask, closeAddTask }
})
