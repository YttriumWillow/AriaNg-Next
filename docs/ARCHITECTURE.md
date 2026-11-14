# 架构说明

## 一句话

```
ui  ──依赖──▶  stores  ──依赖──▶  core
```

`core/` 是**零框架依赖的纯 TypeScript**，不 import 任何 Vue；`stores/` 用 Pinia 把 core 的能力组织成界面需要的状态；`ui/` 只负责把状态画出来。

---

## 目录结构

```
src/
├── core/           ← 纯 TypeScript，零框架依赖，可直接单元测试
│   ├── rpc/          JSON-RPC 协议、传输层（WS / HTTP）、aria2 方法封装、客户端注册表
│   ├── model/        任务模型、协议识别、能力探测、格式化、排序
│   ├── scheduler/    轮询调度器（串行 + 错误退避）
│   ├── theme/        设计令牌定义与主题应用
│   ├── css/          自定义 CSS 引擎（校验 + 注入 + 作用域）
│   ├── api/          URL 命令行 API
│   └── storage/      localStorage 封装
│
├── stores/         ← Pinia
│   ├── hosts.ts       主机配置、连接状态、能力探测
│   ├── tasks.ts       任务数据、轮询刷新、任务操作
│   ├── appearance.ts  主题、密度、令牌、自定义 CSS
│   ├── toast.ts       全局提示
│   └── ui.ts          对话框开关等纯界面状态
│
├── ui/             ← Vue 组件
│   ├── layout/       AppShell / SideNav / TopBar
│   ├── components/   通用组件（表格、卡片、抽屉、图表、对话框…）
│   └── views/        页面（仪表盘 / 任务 / 设置 / 外观 / 诊断）
│
├── styles/         ← 四层 CSS
│   ├── layers.css      @layer 顺序声明（必须最先加载）
│   ├── reset.css       浏览器默认值重置
│   ├── tokens.css      设计变量（--an-*）与三套主题
│   └── components.css  组件样式（.an-*）
│
└── i18n/           ← 极简多语言（中/英）
```

---

## 为什么分成 core 和 ui

这条分界线带来三个好处：

1. **可测试** —— `core/` 里没有一行 `import Vue`，Vitest 直接调用即可，不用 mount 组件。
2. **可迁移** —— 将来换框架，`core/` 整体搬走即可，业务规则一行不用改。
3. **作用域天然对齐** —— `core/` 与 `ui/` 的边界，正好就是自定义 CSS 的作用域边界（`.an-app` 容器）。

依赖方向是**单向**的：`core` 从不依赖 `ui`；两个 store 之间如果需要互相访问，走 `core/rpc/registry.ts`
这个普通模块（存客户端实例），避免 Pinia store 互相 import 形成循环引用。

### core 需要文案时怎么办？

「任务状态该显示成什么」是业务规则，但它需要 i18n —— 而 i18n 属于表现层。

解法是**把翻译函数当参数注入**：

```ts
// core/model/task.ts —— 不 import 任何 i18n
export function taskStatusText(task: Task, t: (key: string) => string): string {
  if (task.status === 'error') return t('status.error')
  if (task.media) return t(mediaStateI18nKey(task.media.state))
  return t(`status.${task.status}`)
}

// ui/components/TaskTable.vue —— 由 UI 层提供 t
taskStatusText(task, t)
```

好处有三层：

1. `core` 依然是零框架依赖的纯 TS，能直接单元测试
   （测试里传一个假 `t` 即可，见 `tests/taskText.test.ts`）；
2. 文案规则**只有一份**，表格 / 卡片 / 详情抽屉三处不会各说各话；
3. 换语言不用碰 core。

> 这个模式来自实测：媒体任务同时有 `task.status` 和 `task.media.state` 两个字段，
> 三处界面各自决定「用哪个」，结果一个失败的任务在列表里显示「下载中」、
> 在详情里又显示别的。规则一旦下沉到 core 并规定优先级，这类问题就消失了。
> 详见 [VERIFICATION.md](./VERIFICATION.md) §5.2。

---

## 一次轮询的完整数据流

```
hosts.ts  startPolling()
   │
   ├─▶ scheduler/poller.ts     串行调度 + 错误退避
   │      │
   │      └─▶ tasks.ts  refresh(hostId, client)
   │             ├─ client.tellActive()    ─┐
   │             ├─ client.tellWaiting()    │ aria2.ts 封装
   │             ├─ client.tellStopped()    │  ↓
   │             └─ client.getGlobalStat()  ─┘
   │                        ↓
   │             model/task.ts  normalizeTasks()   ← 规整层
   │                        ↓
   │             写入 reactive 状态（⚠️ 必须写代理，见 LEARNING.md 坑②）
   │
   └─▶ ui/  computed → 组件自动重渲染
```

---

## 各模块职责

| 模块 | 职责 | 关键文件 |
|---|---|---|
| **传输层** | 把 JSON-RPC 请求送到后端并等回响应；WS 断线重连；HTTP 超时 | `core/rpc/transport.ts` |
| **方法封装** | 把 `aria2.xxx` 方法名与参数顺序固定下来 | `core/rpc/aria2.ts` |
| **规整层** | 把后端的原始 JSON 变成界面能直接用的结构 | `core/model/task.ts` |
| **能力探测** | 问后端到底支持什么（`system.listMethods` + `getVersion`） | `core/model/capability.ts` |
| **调度器** | 控制轮询节奏、失败退避、防重入 | `core/scheduler/poller.ts` |
| **主题引擎** | 主题切换 = 换一层 CSS 变量；令牌覆盖也是 | `core/theme/theme.ts` |
| **CSS 引擎** | 校验用户 CSS → 包进 `user` 层 → 注入 `<style>` | `core/css/engine.ts` |

---

## CSS 的分层

```
@layer reset, tokens, components, user;
```

| 层 | 内容 | 谁写 |
|---|---|---|
| `reset` | 浏览器默认值重置 | 框架 |
| `tokens` | `--an-*` 设计变量与三套主题 | 框架 + 用户令牌覆盖 |
| `components` | `.an-*` 组件样式 | 框架 |
| `user` | 用户的自定义 CSS | **用户，永远赢** |

层与层之间的优先级**高于**选择器特异性 —— 所以用户写 `.an-card { … }` 不需要 `!important`，
也不会因为组件层后来改了顺序而失效。详见 [CUSTOM-CSS.md](./CUSTOM-CSS.md)。

---

## 扩展指引

### 加一个新页面

1. 在 `src/ui/views/` 建 `XxxView.vue`，根元素写 `<div class="an-page">`（**这个类提供栏目间距**）
2. 在 `src/router/index.ts` 加一条路由（记得用懒加载 `() => import(...)`）
3. 在 `src/ui/layout/SideNav.vue` 的导航组里加一个 `<RouterLink>`

### 加一种协议

1. 在 `core/model/task.ts` 的 `TaskProtocol` 里加一项
2. 在 `inferProtocol()` 里加识别逻辑（优先看后端给的扩展对象）
3. 在 `core/model/format.ts` 的 `protocolLabel()` 里加显示名
4. 在 `src/styles/components.css` 里加 `.an-badge--xxx` 徽章样式

### 加一个能力探测项

在 `core/model/capability.ts` 的 `probeCapabilities()` 里加字段，
并用 `system.listMethods` 的结果判断后端是否支持（**不要靠猜**）。

### 加一个设置项

1. `src/core/theme/theme.ts` 的 `AppearanceSettings` 接口加字段
2. `src/stores/appearance.ts` 加 setter（记得 `persist()`）
3. `src/ui/views/AppearanceView.vue` 加控件
4. 如果是视觉项，在 `src/styles/tokens.css` 加对应变量

---

## 测试策略

`core/` 的纯函数是测试重点：

| 测试文件 | 覆盖什么 |
|---|---|
| `tests/task.test.ts` | 规整层：类型转换、协议识别、进度与 ETA 的边界情况 |
| `tests/rpc.test.ts` | JSON-RPC 请求体格式、secret 注入位置、错误分类 |
| `tests/cssEngine.test.ts` | 层叠层包装、作用域降级、CSS 校验 |
| `tests/storeReactivity.test.ts` | 响应式回归（防止"坑②"复发） |
| `tests/appearance.test.ts` | 主题切换（防止"跟随系统吞掉用户选择"复发） |
| `tests/format.test.ts` | 单位换算与空值处理 |

```bash
npm test              # 全部
npm run test:watch    # 监听
```
