<script setup lang="ts">
/**
 * 应用外壳。
 *
 * 骨架是四区结构（见 docs/wireframe-v0.1.html）：
 *   侧栏（上下文） + 顶栏（全局作用域） + 主区（路由内容） + 浮层（抽屉/对话框/提示）
 *
 * 这里用多根节点（Fragment），因为 #app 已经是 .an-app 这个网格容器了，
 * 侧栏是它的第一个网格子项，主区是第二个。
 * 浮层都是 fixed 定位，不参与网格布局。
 */
import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SideNav from '@/ui/layout/SideNav.vue'
import TopBar from '@/ui/layout/TopBar.vue'
import TaskDetailDrawer from '@/ui/components/TaskDetailDrawer.vue'
import AddTaskDialog from '@/ui/components/AddTaskDialog.vue'
import ToastHost from '@/ui/components/ToastHost.vue'
import { parseUrlApi } from '@/core/api/urlApi'
import { useUiStore } from '@/stores/ui'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()

/**
 * URL 命令行 API。
 *
 * 访问 #/tasks?addUrl=https://example.com/x.iso 时，
 * 自动打开「添加任务」对话框并预填该链接，然后清掉地址栏里的参数
 * （否则刷新页面会重复添加）。
 */
function handleUrlApi(): void {
  const requests = parseUrlApi(route.query ? buildQuery(route.query) : '')
  if (requests.length === 0) return

  // 多个 addUrl / addMagnet 参数全部保留，按行传入对话框以便批量添加
  ui.openAddTask(requests.map((item) => item.value).join('\n'))

  // 清掉参数，避免刷新时重复触发
  const query = { ...route.query }
  delete query.addUrl
  delete query.addMagnet
  void router.replace({ path: route.path, query })
}

/** 把 Vue Router 的 query 对象还原成 "a=b&c=d" 形式（兼容同名多参数数组）。 */
function buildQuery(query: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') {
      params.append(key, value)
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') params.append(key, item)
      }
    }
  }
  return params.toString()
}

onMounted(handleUrlApi)
watch(() => route.query, handleUrlApi)
</script>

<template>
  <SideNav />
  <div class="an-main">
    <TopBar />
    <main class="an-content">
      <RouterView />
    </main>
  </div>
  <TaskDetailDrawer />
  <AddTaskDialog />
  <ToastHost />
</template>
