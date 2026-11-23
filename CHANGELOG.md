# 更新日志

本项目的版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)：
`主版本.次版本.修订号` —— 破坏性改动 / 新功能 / 修复。

---

## v0.3.0

**主题：可靠性加固、三大原生主题、全局选项中文注释与渲染性能优化**

### 可靠性与安全加固

- **传输层与调度防漏**：为 `WsRpcTransport` 补齐请求超时、`close()` 队列清理、非法 JSON/非对象帧防护、断线在途请求快速失败及非法 WS 地址短路；`Poller.trigger()` 增加定时器去重，避免重入泄漏
- **多主机连接竞态与防泄漏**：`hosts` store 增加连接代际校验，并在断开或切换时显式关闭旧 `connection`，同时让 `tasks.refresh()` 向上抛出异常以恢复轮询退避与错误计数
- **坏缓存容错与注入防护**：为 `hosts` / `appearance` / `i18n` 读取补充类型清洗，损坏的 `localStorage` 数据不再导致启动崩溃；校验自定义令牌名/值、毛玻璃背景图 URL 与未闭合 CSS 注释/字符串，防止 CSS 注入或逃逸 `@scope`/`@layer`
- **协议与交互修复**：修正任务请求 `user-agent` 键名、批量 URI 独立提交、添加对话框状态残留、`AddTaskDialog`/`App.vue` 多链接 URL API、完成/出错记录清理及移动端与键盘无障碍适配

### 外观主题重构与切换修复

- **三大原生主题**：精细调校「亮色 · 轻盈空气感」「暗色 · 精致桌面台」「毛玻璃 · 柔和弥散玻璃」三套设计令牌与预览卡，补全 `color-scheme` 与无 `backdrop-filter` 降级样式
- **修复右侧主面板切换不刷新**：切主题与跟随系统切换时自动清理与主题强绑定的颜色/表面/毛玻璃覆盖（同时保留圆角、字号、侧栏宽度等布局自定义），解决 `#an-token-css` 压过 `[data-theme]` 导致的左右撕裂；同步优化 `AppearanceView` 实时色值回显与单项重置

### 全局选项中文说明与悬停提示

- **197 项中文释义字典**（`src/core/model/optionDocs.ts`）：零框架依赖，覆盖 aria2 与 aria2-next 常用下载、限速、HTTP/代理、BT/DHT、Metalink、ED2K、媒体流及 RPC/会话选项
- **搜索与无障碍悬停气泡**：设置页全局选项支持按英文键名、当前值、中文短标题与说明正文搜索；选项键严格保持无衬线字体，鼠标悬停或键盘聚焦信息图标时弹出详细说明与示例

### 渲染效率与打包优化

- **状态去抖与行级缓存**：`tasks` store 在轮询时对比并复用未变化任务引用（保留 Pinia 响应式代理不变式）；`TaskTable` / `TaskCards` 引入 `v-memo` 与 `content-visibility: auto` 跳过静止行与视口外重绘
- **单遍统计与 `vendor` 分包**：`DashboardView` 合并为单遍摘要计算，`SpeedChart` 合并路径生成并短路空/零速率，`SideNav` / `TasksView` 缓存只读计算属性；`vite.config.ts` 拆分 `vendor`（`vue` / `pinia` / `vue-router`）并保持 `base: './'` 纯静态输出

### 文档、工具与测试

- 同步 `README.md`、`docs/ARCHITECTURE.md`、`docs/VERIFICATION.md` 及 `tools/` 脚本（支持安全 JSON 输出、跨平台测试与多链接验证）
- 新增 `tests/reliability.test.ts` 与 `tests/optionDocs.test.ts`，并扩充 `tests/appearance.test.ts`、`tests/cssContract.test.ts`（单元测试 **91 → 121**）

---

## v0.2.0

**主题：真实后端实测 —— 把「声称支持」变成「验证过支持」**

这一版把面板放到**两个真实 aria2-next 实例**上跑了一遍，用真实 Firefox 驱动界面验证，
抓到了 5 个靠读代码发现不了的缺陷。

### 修复

| # | 问题 | 影响 |
|---|---|---|
| 1 | **主机 id 撞车** | `Date.now()` 只有毫秒精度，同一毫秒内添加两台主机会拿到相同 id，第二台变成「状态点绿着、但永远切不过去」的幽灵主机 |
| 2 | **媒体任务的错误状态被吞** | `media.state` 覆盖了 `status=error`，失败的 DASH 任务显示「下载中」—— 一个正在下载的假象 |
| 3 | **任务名缺 URI 兜底** | HTTP 403 任务只显示一串 GID（`48580a09170a1fa4`），现在显示 `ls-lR.gz` |
| 4 | **仪表盘卡片口径不一致** | 「活跃任务 2」下方却列着全部 11 个任务的协议分布 |
| 5 | **鉴权失败提示不可操作** | 「服务端拒绝：Unauthorized」对用户毫无指导性，现在直接告诉你要去填 `rpc-secret` |

### 新增

- **设置页「测试连接」按钮** —— 添加主机原本是「先保存、后连接」的，填错密钥不会当场报错。
  现在可以当场测出结果。（这个 i18n 键本来就存在，只是从没被接上）
- **密钥输入框的显示/隐藏开关** —— `type="password"` 把填错的内容全变成圆点，没法核对
- **`tools/protocol-check.mjs`** —— 协议自检脚本，对真实后端逐个协议下任务看结果
- **`docs/VERIFICATION.md`** —— 完整实测报告：协议支持矩阵、aria2-next 真实接口面、
  每个缺陷的「症状 → 根因 → 修法 → 回归测试」四段式拆解
- **`ff-verify.mjs` 的 `--eval-file` / `--profile`** —— 驱动多步交互流程，且能跨运行保留 localStorage

### 界面

- 侧栏品牌块重构 —— 身份信息（产品名 / 连接状态 / 版本号）上移，全局速率下沉到底部
- 补上仪表盘入口 —— 点击主机项回到仪表盘
- 速率图纵轴留 15% 余量，曲线不再压在图顶
- 媒体阶段词（`downloading` / `recording` / …）纳入 i18n
- 英文界面不再漏翻：图表图例、默认主机名、全部错误提示

### 协议实测结论

在真实 aria2-next v3.1.0 上逐个验证：

| 协议 | 结论 |
|---|---|
| HTTP / HTTPS / Metalink | ✅ 完整落地 |
| HLS / DASH | ✅ `media` 扩展对象完整 |
| BitTorrent | ✅ 42 seeders / 8 MB/s |
| Magnet | ✅ 43 seeds / 8.4 MB/s（**必须带 `tr` tracker 参数**） |
| ED2K | ⚠️ 链路通，但 eMule 网络已无该文件 peer |
| SFTP | ❌ 在 `enabledFeatures` 里，但 `addUri` 拒绝 `sftp://` URI |
| FTP | ❌ aria2-next 已移除 |

> 顺带得到一条通用结论：**后端的能力探测列表 ≠ 实际可用**。

### 其它

- 新增 CI 与 Release 工作流
- 修复开关「开启」状态不生效，并改善无障碍可达性
- 加宽令牌编辑器的数值输入框（`420px` 曾被挤成 `42C`）
- 单元测试 60 → 91

---

## v0.1.0

首个版本。

- 任务列表 / 仪表盘 / 设置 / 外观 / 诊断五个视图
- `core/`（零框架依赖的纯 TS）→ `stores/`（Pinia）→ `ui/`（Vue）三层架构
- 自定义 CSS 引擎：用户样式永远赢，不需要 `!important`
- 亮 / 暗 / 毛玻璃三套主题，设计令牌可实时编辑
- HTTP / HTTPS / BitTorrent / ED2K / HLS / DASH / Metalink / SFTP 协议徽章
- 中英双语界面
