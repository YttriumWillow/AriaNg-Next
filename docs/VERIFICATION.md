# 实测报告：协议能力与多主机管理

这份文档记录的是**真刀真枪跑出来的结果**，不是设计意图。

面板的代码里写着「支持 HTTP / BT / ED2K / HLS / DASH / Metalink」——
但这句话在真实后端上成立吗？多台 aria2-next 同时连着的时候，
数据会不会串？这一轮就用两个真实实例把这些全验了一遍。

---

## 1. 测试环境

| 项 | 值 |
|---|---|
| 核心 | aria2-next **v3.1.0**（`aria2c.exe`） |
| 实例 A | `http://127.0.0.1:6801/jsonrpc`，secret `lab-secret-a` |
| 实例 B | `http://127.0.0.1:6802/jsonrpc`，secret `lab-secret-b` |
| 实例 C | 用户本机默认实例 `127.0.0.1:6800` |
| 面板 | AriaNg-Next dev server（Vite） |
| 浏览器 | **真实 Firefox 160**，通过 WebDriver BiDi 驱动（不是内置 Chromium） |

三个实例的下载目录与状态文件完全独立，这是后面验证「数据隔离」的前提。

---

## 2. 协议支持矩阵

「核心是否接受」指 `aria2.addUri` 是否返回 gid；
「实测结果」指任务建起来之后，核心到底能不能真的把数据拉下来。

| 协议 | 核心是否接受 | 实测结果 | 备注 |
|---|---|---|---|
| HTTP | ✅ | ✅ 38 MB 完整落地 | `http://archive.ubuntu.com/ubuntu/ls-lR.gz` |
| HTTPS | ✅ | ✅ 完整落地 | `https://mirrors.kernel.org/ubuntu/ls-lR.gz` |
| HLS | ✅ | ✅ `media` 扩展对象完整 | 状态 `downloading`，含 tracks / duration |
| DASH | ✅ | ✅ `media` 扩展对象完整 | 状态 `recording`，`live: true` |
| ED2K | ✅ | ⚠️ 任务能建，但拿不到 peer | 见 §2.1 |
| BitTorrent（种子文件） | ✅ | ✅ **42 个做种，8 MB/s** | `aria2.addTorrent` |
| Magnet（磁力链接） | ✅ | ✅ **43 seeds，8.4 MB/s** | 见 §2.2 |
| Metalink | ✅ | ✅ RFC 5854 文件完整落地 | 本地起静态服务喂给核心 |
| SFTP | ❌ | — | `Unsupported URI: sftp://…` |
| FTP | ❌ | — | `Unsupported URI: ftp://…`（aria2-next 已移除 FTP） |

SFTP 出现在 `enabledFeatures` 里，但 `addUri` 仍拒绝 `sftp://` ——
**能力探测列表不等于实际可用**，这正是面板做能力探测时最容易踩空的地方。

### 2.1 ED2K：任务能建，不代表有人分享

ED2K 任务正常创建，`ed2k` 扩展对象字段齐全
（hash / partHashCount / peerCount / kadNodeCount / tcpPort / userHash / clientId），
文件也确实落到了磁盘。

但 `peerCount = 0`、`completedLength = 0` —— eMule 官方网络里已经没有这个文件的 peer 了。

**结论**：ED2K 链路本身是通的（解析、扩展对象、落盘都正常），
缺的是网络上的分享者。这是资源问题，不是协议实现问题。

### 2.2 Magnet：必须带 tracker 参数

第一轮构造的磁力链接只给了 `xt` 和 `dn`：

```
magnet:?xt=urn:btih:e274b63536b067459ca5bf5c8369cedd0576164e&dn=Tears%20of%20Steel
```

核心接受了任务，但状态卡在 `downloadingMetadata`，
`announceList` 是空的 —— 没有 tracker，它只能靠 DHT 慢慢碰运气。

补上 `tr` 参数后立刻通畅：

```
magnet:?xt=urn:btih:...&dn=...&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce
```

| | 无 tracker | 带 tracker |
|---|---|---|
| 状态 | `downloadingMetadata` | `downloading` |
| peers | 0 | 46 |
| seeds | 0 | 43 |
| 速度 | 0 B/s | 8.4 MB/s |
| currentTracker | 空 | `https://torrent.ubuntu.com/announce` |

真实用户手里的磁力链接几乎都带 `tr`，所以面板直接透传用户输入即可，
**不需要自己补 tracker** —— 但别指望光有 `xt` 就能跑。

### 2.3 BitTorrent 种子源：内容必须是真种子

这一轮最费时间的坑。

最初用阿里云镜像的 `.torrent` 地址，核心报：

```
Invalid torrent file: expected value ... in bencoded string
```

看起来像核心解析能力有问题，其实是**那个文件根本不是种子** ——
下载下来只有 0.3 KB，是镜像站的错误页 / 重定向内容。

换成真正合法的种子（文件以 `d8:announce` 开头）后一次通过：

| 种子 | 大小 | 结果 |
|---|---|---|
| webtorrent.io sintel | 20.3 KB | ✅ 42 seeders，124 MB / 129 MB，8 MB/s |
| Ubuntu 官方 ISO | 466 KB | ✅ 28 seeders，6.25 GB ISO 正常下载 |

**教训**：验证 BT 能力时，种子文件本身要单独确认是合法 bencode，
否则你测的是「镜像站」，不是「核心」。

---

## 3. aria2-next 的实际接口面

实测中摸清的几条约定，写在这里省得下次再踩。

### 3.1 token 永远在 `params[0]`

```json
{ "jsonrpc": "2.0", "id": "1", "method": "aria2.tellStatus",
  "params": ["token:secret", "<gid>", ["status", "totalLength"]] }
```

第二个参数（这里）是 **gid**，第三个是**要查的字段名数组**。
全量 `tellStatus` 字段极多，噪音大，显式列字段更清爽。

### 3.2 三个扩展对象

| 扩展 | 关键字段 |
|---|---|
| `media` | `state` / `protocol` / `live` / `duration` / `completedDuration` / `downloadedLength` / `lengthKnown` / `tracks[]` / `error` / `errorCode` |
| `ed2k` | 任务级：`hash` / `length` / `partHashCount` / `peerCount` / `queuedPeerCount`（全局 `aria2.getEd2kStatus`：`tcpPort` / `userHash` / `clientId`） |
| `bittorrent` | `announceList[]` / `webSeeds[]` / `magnetLink` / `infoHashV1` / `state` / `numPeers` / `numSeeds` / `progress` / `availability` / `currentTracker` |

### 3.3 `options` 必须是对象，不是键值数组

```js
// ✗ 报错：options must be an object
{ "max-download-limit": "600000" }  ← 这样其实对
['max-download-limit=600000']        ← 这样错
```

`addUri` / `addTorrent` 的第三个参数是 **options 对象**：

```json
params: ["token:xxx", ["http://..."], { "max-download-limit": "600000", "dir": "D:\\downloads" }]
```

> 这个限速参数在实测里很有用：给任务设 600 KB/s 上限，
> 一个 38 MB 的文件就能持续下载一分钟，速率曲线立刻有内容可看，
> 不用真去下载几个 GB 的 ISO 填磁盘。

### 3.4 同哈希任务会被去重

同一个 infoHash 重复添加，核心直接报错：

```
Info hash 08ada5a7a6183aae1e09d831df6748d566095a10 is already being downloaded
```

这是**正确行为**（不是缺陷），但做 Magnet 实测时要注意：
要验证磁力链接，就用一个**从未添加过**的哈希，
否则你测到的是去重逻辑而不是磁力解析。

---

## 4. 多主机管理实测

### 4.1 配置与连接

面板的「设置 → RPC 主机」里添加主机，走的是完整链路：

```
表单填写 → hosts.addHost() → hosts.connect() → 能力探测 → 轮询 → 写入 tasks store
```

实测同时连上三台，全部状态点变绿：

```json
[{"name":"本机 aria2-next","online":true},
 {"name":"实验室实例 A","online":true},
 {"name":"实验室实例 B","online":true}]
```

### 4.2 数据隔离

两台实例的任务 GID 集合**完全没有交集**：

```
实例 A (6801) 9 个：edea0db4797371d7, 3adcca33ebc9b5dc, 6a3a1ec4b46c2ede, …
实例 B (6802) 3 个：9980906a5e822ac7, f85c889e52231fc8, ce9051848de6d39d
交集：(空)
```

面板层面同样：切到实例 B 后，任务列表是 B 的 3 个任务
（`__down` / `ls-lR.gz` / `x36xhzz.mp4`），
切回实例 A 是 A 的 11 个任务，两边的**同名任务交集为空**。

### 4.3 协议徽章

任务列表的协议徽章在真实多协议数据下全部正确显示：

```
实例 A：ED2K | HTTP | HTTP | HTTP | DASH | BT | BT | Metalink | BT | BT | HLS
实例 B：HTTP | HTTP | HLS
```

仪表盘的「协议分布」卡片同样正确：
`BT 4 · HTTP 6 · ED2K 1 · Metalink 1 · HLS 1 · DASH 1`。

---

## 5. 实测中发现并修复的缺陷

这一轮最有价值的产出。以下每一条都是**在真实浏览器 + 真实后端下暴露的**，
不是代码审查能看出来的。

### 5.1 主机 id 撞车（严重）

**症状**：侧栏显示三台主机全绿，但切到「实验室实例 B」时看到的还是 A 的任务数据。

**根因**：`addHost` 用 `Date.now().toString(36)` 生成 id。
`Date.now()` 的精度只有**毫秒**，用户照着配置文档连着添加两台主机时，
两次点击完全可能落在同一毫秒里 —— 于是两台主机的 id **完全相同**。

**为什么难发现**：`hosts` 数组里确实有两条记录，侧栏也确实渲染出两个状态点，
但所有按 id 查找的操作（`selectHost` / `updateHost` / `removeHost` / `runtimeFor`）
都只会命中**第一条**。第二台于是变成一个「连接正常、状态点绿着、
但你永远切不过去」的幽灵主机 —— 点它的名字，实际操作的是第一台。

**修法**（`src/stores/hosts.ts`）：

1. id 改为「时间戳 + 随机后缀」，并额外做冲突检测兜底；
2. 加载时对历史数据去重（保留第一台的 id，只给后面的重复项换新 id），
   保证已经中招的用户升级后自动恢复；
3. `activeHostId` 加存在性校验，指向已删除主机时回落到第一台。

**回归测试**：`tests/hosts.test.ts`（5 个用例）。

### 5.2 媒体任务的错误状态被吞掉

**症状**：一个失败的 DASH 直播流，界面进度列显示「下载中」。

**根因**：`statusText` / `progressText` 里，媒体任务一旦有 `media` 扩展对象
就**无条件优先用 `media.state`**。而实测中这个 DASH 任务因
「服务端已超出保留窗口」失败，`aria2` 报的是 `status=error`，
`media.state` 却依然是 `downloading`。

于是界面显示「下载中」—— 一个正在下载的假象，用户会一直等一个永远下不完的任务。

**修法**：错误状态**优先于**媒体阶段。规则下沉到 `core/model/task.ts` 的
`taskStatusText` / `taskProgressText`，翻译函数由 UI 层注入
（core 是零框架依赖的纯 TS，不该认识 i18n）。
表格、卡片、详情抽屉三处统一走这一份实现。

### 5.3 任务名没有 URI 兜底

**症状**：一个 HTTP 403 失败的任务，名字显示成 `48580a09170a1fa4`（一串 GID）。

**根因**：`resolveName` 的兜底链是 `name → ed2k.name → files[0].path → gid`。
而 403 任务的 `files[0].path` 是**空字符串**（服务端还没创建出文件就失败了），
于是直接落到 GID。

**修法**：在 GID 之前插一层 URI 兜底 ——
`files[0].uris[0].uri` 的最后一段就是文件名
（`https://mirrors.aliyun.com/ubuntu/ls-lR.gz` → `ls-lR.gz`）。
另外 ed2k 链接取 `|file|…|` 段、magnet 取 `dn` 参数，各有各的解析方式。

顺带把 `media.state` 的英文状态词（`downloading` / `recording` / …）
也纳入 i18n，中文界面里不再夹英文。

### 5.4 仪表盘卡片口径不一致

**症状**：「活跃任务 **2**」卡片下方写着「BT 4 · HTTP 3 · ED2K 1」。

**根因**：那行副行用的是**全部**任务的协议分布，而主数字是**活跃**任务数。
两个数字口径不一致，用户会以为「活跃任务里有 4 个 BT」。

**修法**：副行改为只统计活跃任务，与主数字同口径；
全部任务的协议分布由下方独立的「协议分布」卡片呈现，不重复。

### 5.5 速率曲线贴顶 + 图例硬编码中文

**症状**：限速下载时曲线正好压在图顶，看不出波动；英文界面下图例写着「下载 / 上传」。

**修法**：

- 纵轴上限留 15% 余量，曲线才有呼吸感；
- 图例改走 i18n。

### 5.6 鉴权失败提示不可操作

**症状**：手动添加一台启用了 `rpc-secret` 的主机，界面显示

```
服务端拒绝：Unauthorized
```

用户完全不知道该做什么 —— `Unauthorized` 是个英文单词，
而"这个主机需要 RPC 密钥、密钥要去 aria2 配置里找"这层信息一个字都没给。

**根因**：`describeError` 把所有 `RpcError` 一视同仁，
只是把后端的 message 原样拼在「服务端拒绝：」后面。

**修法**：

1. 新增 `isUnauthorized()`，识别 aria2 的鉴权失败；
2. 鉴权失败改用**可操作的**提示：
   「该主机要求 RPC 密钥：请点「编辑」填入 rpc-secret」；
3. 错误文案整体改走 i18n（以前全是硬编码中文，英文界面会露馅），
   同样用「翻译函数注入」的方式，core 依旧不依赖 i18n。

**顺带补上的两处**（同一个场景下的实际痛点）：

| 改进 | 为什么 |
|---|---|
| 「测试连接」按钮 | 添加主机是**先保存、后连接**的，填错密钥不会当场报错。先给一个当场出结果的按钮，能省掉大量猜测。这个 i18n 键本来就存在，只是没接上 |
| 密钥框的显示/隐藏开关 | `type="password"` 把填错的内容全变成圆点，用户根本没法核对 |

回归测试见 `tests/errors.test.ts`。

---

## 6. 自己复现

### 6.1 协议自检

```bash
node tools/protocol-check.mjs --url http://127.0.0.1:6801/jsonrpc --secret your-secret
# 想连 BT 就带上本地种子文件（网络上的种子源经常是假的）
node tools/protocol-check.mjs --url http://127.0.0.1:6801/jsonrpc --secret your-secret \
     --torrent ./some.torrent
```

### 6.2 真实浏览器验证

```bash
# 截图 + 量 DOM 间距
node tools/ff-verify.mjs "http://localhost:5173/#/tasks" out.png --wait 5000 --size 1600x900

# 跑一段多步交互脚本（存在文件里，避免命令行转义地狱）
node tools/ff-verify.mjs "http://localhost:5173/#/settings" out.png --wait 4000 \
     --eval-file tools/probe.js
```

`ff-verify` 用的是 Firefox 的 **WebDriver BiDi** 调试端口，
所以能在真实 Firefox 里执行 JS、量实际间距、按需控制截图时机。
`--profile` 可以指定固定 profile 目录，让多次运行之间保留 localStorage。

---

## 7. 已知限制

| 项 | 状态 |
|---|---|
| SFTP | 核心 `enabledFeatures` 里有，但 `addUri` 拒绝 `sftp://` URI，未找到可用形式 |
| ED2K | 链路通，但测试用的文件在 eMule 网络上已无 peer |
| HTTPS 403 | 部分镜像站（如阿里云的某些路径）对直连请求返回 403，是站点策略不是协议缺陷 |
| FTP | aria2-next 已移除，核心直接拒绝 |
| 上传速度 | 实测环境无可上传源，上传速率恒为 0，未验证上传链路 |
| 做种 | BT 任务完成后进入 seeding 状态，但没有验证多个节点互传数据 |

---

## 8. 相关截图

| 文件 | 内容 |
|---|---|
| `verification/vf-multi-host-a.png` | 实例 A 的任务列表，六种协议徽章齐全 |
| `verification/vf-multi-host-b.png` | 实例 B 的任务列表，与 A 数据无交集 |
| `verification/vf-dashboard-speed.png` | 仪表盘：速率曲线、协议分布、状态分布 |
| `verification/vf-dashboard-chart.png` | 修正 Y 轴余量后的速率曲线 |
