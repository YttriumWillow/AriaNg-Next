/**
 * 应用入口。
 *
 * 这里的顺序很重要：
 *  1. 样式表必须按 layers -> reset -> tokens -> components 的顺序导入，
 *     因为 layers.css 里的 @layer 顺序声明必须先于任何 @layer 规则出现。
 *  2. 外观要在 mount 之前应用，否则会出现主题闪烁（先白屏再变暗）。
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useAppearanceStore } from './stores/appearance'
import { useHostsStore } from './stores/hosts'

import './styles/layers.css'
import './styles/reset.css'
import './styles/tokens.css'
import './styles/components.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

// 挂载前应用外观（主题 / 令牌 / 自定义 CSS）
useAppearanceStore(pinia).initialize()

// 自动连接配置好的主机
const hosts = useHostsStore(pinia)
for (const host of hosts.hosts) {
  if (host.autoConnect) {
    void hosts.connect(host.id)
  }
}

app.mount('#app')
