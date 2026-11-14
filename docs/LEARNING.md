# 学习路线

> 目标：把 AriaNg-Next 当作学习前端技术的载体。
> 代码本身是教材 —— 每个非显然的写法旁边都有中文注释说明"为什么这样写"。

---

## 开始之前

**你需要会的**：HTML 标签、CSS 选择器与盒模型。不需要会 JavaScript。

**你需要有的**：Node.js 18+（本机已有 v24）、一个浏览器、一点点好奇心。

**预计投入**：按每周 5–10 小时，全程约 16 周。

---

## 第 0 步：先让它跑起来（半天）

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`，看到仪表盘就成了。

然后做一件小事：**在浏览器 DevTools 里改一个颜色，看它怎么变。**
比如找到任意一个 `.an-card`，在控制台里执行：

```js
document.querySelector('.an-card').style.background = 'red'
```

看到变化了吗？那你已经理解了「CSS 决定外观」这件事。接下来要做的是理解**为什么**改一个颜色能影响所有卡片 —— 答案在第 6 步。

---

## 八个阅读步骤

每一步都能独立跑通，读完再进下一步。

### 1️⃣ RPC 协议层 → `src/core/rpc/`

| 读什么 | 学到什么 |
|---|---|
| `types.ts` | JSON-RPC 2.0 的请求/响应结构；为什么 aria2 的整数全是**字符串** |
| `errors.ts` | `TransportError`（网络问题，可重试）vs `RpcError`（业务问题，重试没用） |
| `transport.ts` | WebSocket 与 HTTP 两种传输；断线指数退避重连；为什么 secret 要插到第一个参数 |
| `aria2.ts` | 把方法名和参数顺序封装成有类型的方法，组件里就不用写字符串了 |
| `registry.ts` | 为什么客户端实例放在普通模块而不是 Pinia 里（避免 store 循环依赖） |

**自测**：为什么 `aria2.pause` 的 token 必须放在 `params[0]`？如果放最后会怎样？

### 2️⃣ 任务模型 → `src/core/model/task.ts`

| 读什么 | 学到什么 |
|---|---|
| `toNumber` / `toBool` | 「规整层」的价值：把后端的怪异格式一次性洗干净 |
| `inferProtocol` | 协议识别 —— 为什么优先看扩展对象而不是猜链接字符串 |
| `computeProgress` | **媒体任务的 `totalLength` 恒为 0**，进度必须读 `media.progress` |
| `computeEta` | 什么时候该返回 `null`（未知）而不是编一个数字 |
| `normalizeTask` | 一个函数把原始 JSON 变成界面能直接用的结构 |
| `taskStatusText` | **翻译函数作为参数注入** —— core 不认识 i18n，却能算出该显示什么文案 |

**自测**：`computeEta` 里为什么「速度为 0 时返回 null」比「返回一个大数字」好？

### 3️⃣ 轮询调度 → `src/core/scheduler/poller.ts`

| 读什么 | 学到什么 |
|---|---|
| `start` / `run` / `scheduleNext` | 为什么**不能**用 `setInterval`（请求慢了会堆积） |
| `ticking` 标志 | 防重入：上一轮没跑完就跳过这一轮 |
| `consecutiveErrors` | 失败退避：出错越多，间隔越长，别把后端打垮 |

**自测**：`setInterval` 在什么情况下会导致「同时发出 5 个请求」？

### 4️⃣ 状态层 → `src/stores/`

| 读什么 | 学到什么 |
|---|---|
| `tasks.ts` | 「后端数据 → 界面」这条链路长什么样 |
| `hosts.ts` | 多主机：每个主机一份独立状态 |
| `appearance.ts` | 主题、令牌、自定义 CSS 三者怎么协同 |

**重点看** `hosts.ts` 里 `runtimeFor()` 的注释 —— 那里藏着一个**极难发现的 Vue 响应式陷阱**（见下文「坑 ②」）。
同一文件里的 `generateHostId()` 则藏着另一个经典陷阱（见「坑 ③」）。

### 5️⃣ 组件层 → `src/ui/`

| 读什么 | 学到什么 |
|---|---|
| `components/TaskTable.vue` | 模板语法、`props`、`emit`、列表渲染、`v-for` 的 `key` |
| `components/TaskDetailDrawer.vue` | `<Teleport>`：把浮层挂到 body 下，避开父容器的 overflow |
| `views/TasksView.vue` | 一个页面怎么把「筛选 → 排序 → 渲染」串起来 |
| `views/AppearanceView.vue` | 实时预览：输入框的值怎么变成生效的样式 |

### 6️⃣ 样式体系 → `src/styles/`

| 读什么 | 学到什么 |
|---|---|
| `layers.css` | **层叠层（`@layer`）**：层与层之间的优先级高于选择器特异性 |
| `reset.css` | 为什么每个项目都要重置浏览器默认样式 |
| `tokens.css` | 设计令牌：用变量表达一切，换主题 = 换变量值 |
| `components.css` | 语义化类名（`.an-task-row`）为什么比工具类（`.flex-1`）更适合当公开 API |

**自测**：为什么组件层里不能写死颜色，只能写 `var(--an-*)`？

### 7️⃣ CSS 引擎 → `src/core/css/engine.ts`（本项目的核心）

| 读什么 | 学到什么 |
|---|---|
| `buildUserLayer` | 用户的 CSS 怎么被包进 `user` 层，从而**永远**赢过组件样式 |
| `validate.ts` | 借用浏览器自己的 CSS 解析器做校验（`CSSStyleSheet.replaceSync`） |
| `detectScopeSupport` | 特性探测：怎么判断浏览器支不支持 `@scope` |

**自测**：普通做法里，用户 CSS 和组件样式特异性相同时，谁赢？为什么那很脆弱？

### 8️⃣ 外观界面 → `src/ui/views/AppearanceView.vue`

把令牌编辑器、主题卡片、CSS 编辑器、作用域开关串起来看一遍，
你会发现**「换主题」和「写自定义 CSS」其实是同一套机制的两个入口** —— 这就是"一处可改"。

---

## 三个里程碑

| 里程碑 | 包含 | 产出 |
|---|---|---|
| **M1** | 步骤 0–5 | 一个能连上 aria2-next、看到任务列表、暂停继续、切换主题的面板 |
| **M2** | 步骤 6 | 详情抽屉、设置页、添加任务、响应式 |
| **M3** | 步骤 7–8 | 自定义 CSS 引擎、诊断面板、多协议支持 —— **这时它才配叫 AriaNg-Next** |

---

## 四个值得记住的坑

这四个坑都极难靠肉眼发现，是本项目真实踩过、并留下了回归测试的。

### 坑 ① `<button>` 的默认 `text-align: center` 会被子元素继承

```css
.an-nav-item__label { flex: 1; }   /* 被拉伸成很宽的盒子 */
```

浏览器给 `<button>` 的默认样式里有 `text-align: center`，这个值会**被子元素继承**。
于是文字在拉伸后的盒子里居中，和左边的图标之间空出一大块 —— 看起来像布局坏了，其实是继承。

**修法**：`.an-nav-item` 显式写 `text-align: left`。

> 同一页面里的 `<a>`（RouterLink）没有这个默认值，所以「诊断」那几行一直是对的 ——
> 对比着看就能定位问题。

### 坑 ② `reactive()` 存的是原始对象，读出来才是代理

```ts
function runtimeFor(id) {
  let runtime = runtimes[id]        // undefined
  if (!runtime) {
    runtime = { status: 'idle' }     // ← 原始对象
    runtimes[id] = runtime
  }
  return runtime                     // ← 把原始对象返回出去
}
```

赋值时 Vue 存的是**原始对象**，之后读取才拿到**响应式代理**。
把原始对象直接 return，后续所有 `runtime.status = 'connected'` 都**绕过了代理**，
Vue 收不到更新通知 —— 界面永远停在旧状态。

**修法**：赋值之后**重新读一次**再返回，让返回值变成代理。

> 这个坑有竞态性质：只有"连接完成"恰好早于"首屏渲染"时才碰巧正常，
> 所以极难复现。回归测试见 `tests/storeReactivity.test.ts`。

### 坑 ③ `Date.now()` 当唯一 ID，会在同一毫秒内撞车

```ts
const host = { ...config, id: `host-${Date.now().toString(36)}` }
```

`Date.now()` 的精度是**毫秒**。用户照着配置文档连着添加两台主机时，
两次点击完全可能落在同一毫秒里 —— 于是两台主机的 id **完全相同**。

**为什么后果很隐蔽**：数组里确实有两条记录，侧栏也确实渲染出两个状态点，
但所有按 id 查找的操作（`selectHost` / `updateHost` / `removeHost`）
都只会命中**第一条**。第二台于是变成一个「连接正常、状态点绿着、
但你永远切不过去」的幽灵主机。

**修法**：时间戳 + 随机后缀，再加一次冲突检测；
同时在**加载时**给历史数据去重（否则已经中招的用户升级后还是坏的）。

> 通用教训：**时间戳不是唯一 ID**。任何用「当前时间」当标识符的地方，
> 都要额外处理同毫秒碰撞 —— 尤其是当用户可能**批量**创建多个对象时。
> 回归测试见 `tests/hosts.test.ts`。

### 坑 ④ 两个状态字段同时存在时，谁的优先级更高？

```ts
// 错误示范
if (task.media) return task.media.state      // 媒体阶段
return t(`status.${task.status}`)             // 任务状态
```

一个 DASH 直播流因为「服务端超出保留窗口」失败了：
`task.status` 是 `error`，但 `task.media.state` 依然是 `downloading`。
上面这段代码会显示「下载中」—— 一个正在下载的假象，
用户会一直等一个永远下不完的任务。

**修法**：**错误状态优先于**任何「更细分的阶段信息**。

```
最终状态判断：error > 媒体阶段 > 通用状态
```

这个顺序在 `core/model/task.ts` 的 `taskStatusText` 里，
表格、卡片、详情抽屉三处共用同一份实现。

> 通用教训：当一个对象上存在**多个描述同一件事**的字段时，
> 必须明确规定优先级，否则每个界面都会做出**不同的**选择，
> 而用户会觉得「有的地方说有错，有的地方说在下载」。

---

## 实测是最好的教材

上面四个坑都不是靠读代码发现的，是在**真实 Firefox + 真实 aria2-next 实例**上
连着三台主机、跑各种协议任务时暴露出来的。

完整的实测过程、协议支持矩阵、以及每个坑的「症状 → 根因 → 修法 → 回归测试」
四段式拆解，见 [VERIFICATION.md](./VERIFICATION.md)。

自己动手跑一遍收获更大：

```bash
node tools/protocol-check.mjs --url http://127.0.0.1:6801/jsonrpc --secret your-secret
```

---

## 学习卡点速查

| 卡在哪 | 先看这个 |
|---|---|
| 看不懂 `async/await` | `core/rpc/transport.ts` 里的 `call()`，它就是一个 Promise 包装 |
| 看不懂 `computed` | `stores/tasks.ts` 的 `stateFor()` 与视图里的 `computed` |
| 看不懂 `<script setup>` | `ui/components/StatCard.vue`（最短的一个组件） |
| 看不懂 CSS 变量 | `styles/tokens.css` 的 `:root` 块 |
| 不知道从哪下手改 | `docs/ARCHITECTURE.md` 的「扩展指引」一节 |

---

## 相关文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) —— 分层设计与扩展方式
- [CUSTOM-CSS.md](./CUSTOM-CSS.md) —— 自定义 CSS 与设计令牌
- [DEVELOPMENT.md](./DEVELOPMENT.md) —— 开发环境与工具链
- [VERIFICATION.md](./VERIFICATION.md) —— 实测报告：协议能力、多主机管理、实测中发现的缺陷
