# 开发指南

## 环境要求

| 工具 | 版本 | 说明 |
|---|---|---|
| Node.js | ≥ 18（推荐 20+） | 本机已装 v24 |
| npm | ≥ 9 | 随 Node 附带 |
| 浏览器 | 现代版本 | 需支持 CSS `@layer`（Chrome 99+ / Safari 15.4+ / Firefox 97+） |

---

## 命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动开发服务器（含 `/rpc` 代理） |
| `npm run build` | `vue-tsc --noEmit` + Vite 构建，产物在 `dist/` |
| `npm run preview` | 预览构建产物 |
| `npm run typecheck` | 只做类型检查 |
| `npm test` | 跑单元测试 |
| `npm run test:watch` | 监听模式跑测试 |

构建产物是**纯静态文件**，`dist/` 可以直接丢进任意静态服务器、Nginx、Caddy 或 Docker 镜像。
因为用的是 hash 路由（`/#/tasks`），不需要服务器配合 rewrite 规则。

---

## 与真实的 aria2-next 联调

先启动 aria2-next 的 RPC 服务：

```bash
aria2-next --enable-rpc --rpc-listen-port=6800 --rpc-listen-all=false --rpc-secret=your-token
```

然后在面板的「设置 → RPC 主机」里填：

| 字段 | 值 | 说明 |
|---|---|---|
| RPC 地址 | `ws://127.0.0.1:6800/jsonrpc` | **推荐 ws/wss** |
| RPC 密钥 | `your-token` | 对应 `--rpc-secret`，不启用鉴权就留空 |

> **为什么推荐 WebSocket？**
> 浏览器对 HTTP 请求会做 CORS 检查，而 aria2-next 的 HTTP 端点默认不带 CORS 响应头，
> 跨域时会被浏览器直接拦掉；WebSocket 不受这个限制。
> 若必须用 `http://`，可以在开发时走 `vite.config.ts` 里已经配好的 `/rpc` 代理。

---

## 开发辅助工具（`tools/`）

### `tools/mock-aria2.mjs` —— 没有 aria2 服务时也能开发界面

模拟 aria2-next 的 JSON-RPC 接口（HTTP + WebSocket 都支持），返回一批覆盖各协议的示例任务：
HTTP 下载、BT 做种、ED2K、HLS 直播、失败任务。用它可以看全各种界面状态，不必真的去下载。

```bash
node tools/mock-aria2.mjs                    # 监听 6801
node tools/mock-aria2.mjs --port 6801 --secret mytoken
```

面板里把主机地址填成 `ws://127.0.0.1:6801/jsonrpc` 即可。

> 它默认用 6801 而不是 6800，因为 6800 是 aria2-next 自己的默认端口。

### `tools/ff-verify.mjs` —— 在真实 Firefox 里做视觉与度量验证

Firefox 的 `--screenshot` 在页面 `load` 事件时立刻截图，而面板是异步的（那时 WebSocket 还没连上），
截出来是空白。这个脚本改用 Firefox 的 **WebDriver BiDi** 端口，可以自己控制等待时机，
还能在真实 Firefox 里执行 JS 量出元素的实际间距：

```bash
node tools/ff-verify.mjs http://localhost:5173/#/diagnostics shot.png --wait 5000
node tools/ff-verify.mjs http://localhost:5173/#/diagnostics shot.png --measure ".an-page > *"
node tools/ff-verify.mjs http://localhost:5173/#/tasks shot.png --size 700x1000   # 模拟窄界面
```

输出示例（间距为 0 说明栏目粘在一起了）：

```
=== 实测间距（真实 Firefox）===
  [0] div.an-page__head          top=78  h=51  与上一项间距=nullpx
  [1] div.an-grid an-grid--4     top=145 h=87  与上一项间距=16px
  [2] div.an-grid an-grid--2     top=247 h=96  与上一项间距=16px
```

其它参数：`--eval "<表达式>"` 执行任意 JS、`--trace-ws` 追踪 WebSocket 生命周期。

> ⚠️ `--profile` 指向的临时目录**必须放在项目目录之外**，否则 Vite 的文件监听器会盯上
> `parent.lock` 并以 `EBUSY` 崩溃。

---

## aria2-next 能力探测

aria2-next 在保持 aria2 兼容的同时扩展了能力（ED2K、HLS/DASH、运行时诊断），
同时**移除**了部分上游能力（FTP、Metalink 3、JSONP、libaria2、旧版 `.aria2` 控制文件）。

前端不靠猜，启动时通过两个手段问清楚：

1. `system.listMethods` —— 权威的方法清单（aria2-next 文档明确说明）
2. `aria2.getVersion` —— `product` / `mediaFeatures` / `downloadFeatures` 字段

结果会显示在「诊断」页面。**不支持的能力会被显式标灰，而不是静默消失** ——
这是本项目「诚实的数据」原则的一部分。

---

## 与 AriaNg 的能力对照

完整对照表见 [`design/wireframe-v0.1.html`](./design/wireframe-v0.1.html) 的「AriaNg 能力映射」一节。摘要：

**保留**：多 RPC 主机、JSON-RPC（WS/HTTP + secret）、增量轮询、任务分组、排序/搜索/过滤/拖拽调序、文件树、peer/tracker、文件类型过滤、速率图、全局选项与每目录选项、下载完成通知、多语言、设置导入导出、URL 命令行 API、RSS 阅读器、纯静态无运行时。

**重做**：深色模式 → 三主题令牌体系；任务详情页 → 右侧抽屉；任务列表 → 表格/卡片双模；设置页 → 可搜索分组表单。

**新增**：自定义 CSS 引擎、能力探测、诊断面板、卡片视图、移动端底部标签栏。

**未实现**：RSS 阅读器、每目录选项、拖拽调序、浏览器完成通知、设置整体导入导出、ED2K 搜索界面。

---

## 常见问题

**连接报 `Connection refused`**
aria2-next 没开 RPC，或没加 `--enable-rpc`。Docker 部署还要确认 6800 端口已映射。

**提示 token 错误**
面板里的「RPC 密钥」必须和 `--rpc-secret` 完全一致。

**浏览器控制台报 CORS 错误**
说明你在用 `http://` 访问跨域的 RPC。改用 `ws://`，或在开发时走 Vite 的 `/rpc` 代理。

**改了自定义 CSS 没反应**
检查是否写在了 `user` 层之外（引擎会自动包好），以及选择器是否与实际 DOM 匹配 ——
可以在浏览器 DevTools 里搜 `.an-` 查看真实的类名。

**界面不刷新 / 状态卡住**
检查是不是拿到了响应式代理。详见 [LEARNING.md](./LEARNING.md) 的「坑②」。

**npm install 很慢或失败**
国内直连官方 registry 可能超时，换镜像源：
`npm config set registry https://registry.npmmirror.com`
