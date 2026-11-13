import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

/**
 * Vite 构建配置
 *
 * 说明两点：
 * 1. `base: './'` —— 产物使用相对路径，这样 `dist/` 可以直接丢进任意静态服务器、
 *    Docker 镜像或子目录下运行，不需要配置站点根路径。
 * 2. `server.proxy` —— 本地开发时的跨域规避方案。
 *    浏览器对 file:// 以外的 RPC 目标会执行 CORS 检查，而 WebSocket 不受此限制，
 *    所以生产环境推荐用 ws://。若必须用 http://，可把主机地址填成 /rpc，
 *    由 Vite 在开发时转发到真实的 aria2-next。
 */
export default defineConfig({
  plugins: [vue()],
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 开发态：/rpc/xxx  ->  http://127.0.0.1:6800/jsonrpc
      '/rpc': {
        target: 'http://127.0.0.1:6800',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rpc/, '/jsonrpc'),
      },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
