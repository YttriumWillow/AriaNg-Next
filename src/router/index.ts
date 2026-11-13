/**
 * 路由。
 *
 * 用的是 **hash 模式**（createWebHashHistory），原因很实际：
 * 构建产物是一堆纯静态文件，用户可能把它丢在任意子目录下，
 * 或者用 nginx / Caddy / Python 的 http.server 直接打开。
 * hash 模式不需要服务器配合 rewrite 规则，URL 长这样：
 *   http://host:8080/#/tasks
 */

import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/dashboard' },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('@/ui/views/DashboardView.vue'),
  },
  {
    path: '/tasks',
    name: 'tasks',
    component: () => import('@/ui/views/TasksView.vue'),
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/ui/views/SettingsView.vue'),
  },
  {
    path: '/appearance',
    name: 'appearance',
    component: () => import('@/ui/views/AppearanceView.vue'),
  },
  {
    path: '/diagnostics',
    name: 'diagnostics',
    component: () => import('@/ui/views/DiagnosticsView.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/ui/views/NotFoundView.vue'),
  },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
