/**
 * 任务排序。
 *
 * 放在 core 而不是组件里，因为它是一个纯函数（输入数组，输出新数组），
 * 表格视图和卡片视图共用同一套排序逻辑。
 */

import type { Task } from './task'

/** 可排序的字段。 */
export type TaskSortKey =
  | 'name'
  | 'size'
  | 'progress'
  | 'downloadSpeed'
  | 'uploadSpeed'
  | 'remaining'
  | 'eta'

/** 取某个排序字段的比较值。 */
function sortValue(task: Task, key: TaskSortKey): number | string {
  switch (key) {
    case 'name':
      return task.name.toLowerCase()
    case 'size':
      return task.totalLength
    case 'progress':
      return task.progress
    case 'downloadSpeed':
      return task.downloadSpeed
    case 'uploadSpeed':
      return task.uploadSpeed
    case 'remaining':
      return task.remainingLength
    case 'eta':
      // ETA 未知（null）时排在最后，而不是最前面
      return task.etaSeconds ?? Number.POSITIVE_INFINITY
  }
}

/**
 * 排序任务列表。
 *
 * @param descending 是否倒序（默认升序）
 */
export function sortTasks(tasks: Task[], key: TaskSortKey, descending = false): Task[] {
  const sorted = [...tasks].sort((a, b) => {
    const left = sortValue(a, key)
    const right = sortValue(b, key)

    if (typeof left === 'string' || typeof right === 'string') {
      return String(left).localeCompare(String(right))
    }
    return left - right
  })

  return descending ? sorted.reverse() : sorted
}
