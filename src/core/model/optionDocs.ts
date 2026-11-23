/**
 * aria2 / aria2-next 全局选项中文说明字典与检索工具。
 *
 * ============================ 为什么放在 core/model ============================
 *
 * 1. `aria2.getGlobalOption` 只返回英文 kebab-case 键名与字符串值（例如
 *    `max-concurrent-downloads: "5"`），对不熟悉 aria2c 手册的用户来说形同密码。
 * 2. 把选项释义抽成零框架依赖的纯 TS 字典（不依赖 Vue / Pinia / i18n），
 *    后续无论是设置页全局选项、单任务选项弹窗还是浏览器扩展，都能直接复用，
 *    也能独立跑在 Node 测试环境里做回归校验。
 * ==============================================================================
 */

/** 单个全局选项的中文文档条目。 */
export interface GlobalOptionDoc {
  /** 简短中文名称，直接展示在选项键下方，方便扫读。 */
  label: string
  /** 完整中文说明：解释用途、取值语义与常见注意事项，在悬停/聚焦气泡中展示。 */
  description: string
  /** 可选示例值（合法取值或常见配置片段）。 */
  example?: string
}

/**
 * aria2 与 aria2-next 常用全局选项中文释义表。
 *
 * 键名严格对应 `aria2.getGlobalOption` 返回的小写连字符格式（不含 `--` 前缀）。
 */
export const GLOBAL_OPTION_DOCS: Record<string, GlobalOptionDoc> = {
  /* ---------------- 1. 基础目录、连接数与分片调度 ---------------- */
  dir: {
    label: '默认下载目录',
    description: '新建任务未单独指定保存路径时，文件默认写入该目录。路径必须已存在或核心有权限创建。',
    example: '/downloads 或 D:\\Downloads',
  },
  'max-concurrent-downloads': {
    label: '最大同时下载任务数',
    description: '同一时刻允许处于活跃下载状态的任务上限，超出部分会在等待队列中排队。',
    example: '5',
  },
  'max-connection-per-server': {
    label: '单服务器最大连接数',
    description: '针对同一个远端服务器地址最多同时建立的连接线程数，过高可能触发网盘或镜像站限流封禁。',
    example: '16',
  },
  split: {
    label: '单任务最大分片数',
    description: '将单个文件切分并行的连接数。实际并发数还会受单服务器连接数上限与最小分片大小约束。',
    example: '16',
  },
  'min-split-size': {
    label: '最小分片大小',
    description: '只有大于此体积的文件才会继续切分多连接；过小的分片反而会增加握手与磁盘寻道开销。',
    example: '20M（可用 K / M 后缀）',
  },
  'piece-length': {
    label: 'HTTP/FTP 分片长度',
    description: 'HTTP/FTP 分块下载时每个逻辑分片的基础大小，会影响断点记录粒度与内存占用。',
    example: '1M',
  },
  'optimize-concurrent-downloads': {
    label: '动态优化并发任务数',
    description: '根据当前观测到的带宽自适应调整实际同时下载的任务数，避免过多任务争抢同一条窄带宽。',
    example: 'true / false',
  },
  'stream-piece-selector': {
    label: '分片选择策略',
    description: '决定多连接先拉取文件的哪一部分：default 均衡吞吐、inorder 顺序拉取（适合边下边播）、random 随机、geom 几何递减。',
    example: 'default / inorder / geom',
  },
  'uri-selector': {
    label: '多镜像源选择策略',
    description: '一个任务传入多个镜像地址时的调度方式：feedback 优先选历史最快源、inorder 顺序使用、adaptive 自适应测速。',
    example: 'feedback',
  },
  'reuse-uri': {
    label: '复用已耗尽的镜像链接',
    description: '当所有镜像 URI 都曾尝试过后，是否重新循环使用它们（多用于带短时效签名的单源重连）。',
    example: 'true',
  },

  /* ---------------- 2. 文件落盘、断点续传与完整性校验 ---------------- */
  continue: {
    label: '启用断点续传',
    description: '允许接着本地未完成的文件继续拉取剩余字节，需服务端支持 Range 请求或存在控制信息。',
    example: 'true',
  },
  'always-resume': {
    label: '强制尝试断点续传',
    description: '开启后即使链接曾遇到不支持 Range 的情况也尽量续传；设为 false 则在连续失败后改从头下载。',
    example: 'true',
  },
  'max-resume-failure-tries': {
    label: '续传失败重试阈值',
    description: '仅当 always-resume 为 false 时生效：连续不支持续传达到该次数后，从零字节重新下载。',
    example: '0',
  },
  'allow-overwrite': {
    label: '允许覆盖同名文件',
    description: '目标路径已存在同名文件且无控制信息时，设为 true 会直接覆盖原文件；false 则配合自动重命名或报错。',
    example: 'false',
  },
  'auto-file-renaming': {
    label: '自动重命名冲突文件',
    description: '遇到同名文件且未开启覆盖时，自动在文件名后追加 .1、.2 等后缀，防止误覆盖已有成果。',
    example: 'true',
  },
  'allow-piece-length-change': {
    label: '允许分片大小变更',
    description: '当配置里的分片长度与控制文件记录不一致时，是否允许继续沿用已有控制进度而非报错中止。',
    example: 'false',
  },
  'file-allocation': {
    label: '磁盘空间预分配方式',
    description: '开始下载前如何占位磁盘空间：none 不预分配（SSD 推荐）、prealloc 填零分配、trunc 截断、falloc 系统级快速预分配（ext4/NTFS 等推荐）。',
    example: 'falloc / none',
  },
  'no-file-allocation-limit': {
    label: '跳过预分配的体积阈值',
    description: '小于该体积的文件不执行磁盘预分配，避免为几十 KB 的小文件额外触发系统调用。',
    example: '5M',
  },
  'disk-cache': {
    label: '磁盘写入缓存大小',
    description: '先将数据缓存在内存再批量刷盘，可显著减少高速下载或 BT 场景下的随机写碎片；0 表示禁用缓存。',
    example: '16M 或 64M',
  },
  'enable-mmap': {
    label: '启用内存映射（mmap）',
    description: '将下载文件映射到进程虚拟地址空间写入。大文件在部分系统上可能占用较高虚拟内存，32 位环境慎用。',
    example: 'false',
  },
  'check-integrity': {
    label: '校验文件完整性',
    description: '对支持哈希校验的任务（如 BT、Metalink 或指定 checksum）在完成后验证所有分片，发现损坏会自动重下。',
    example: 'false',
  },
  'realtime-chunk-checksum': {
    label: '下载期间实时校验分块',
    description: '当任务提供了分块校验和时，每下完一个分块立即校验，不必等到整个文件下完才发现损坏。',
    example: 'true',
  },
  'hash-check-only': {
    label: '仅校验哈希不下载',
    description: '只对本地已存在的文件做完整性核验而不发起网络传输，常用于手工恢复 BT 做种前验盘。',
    example: 'false',
  },
  'conditional-get': {
    label: '仅在远端更新时下载',
    description: '发送 If-Modified-Since 请求头，若远端文件未比本地副本更新则跳过下载，适合周期同步。',
    example: 'false',
  },
  'remote-time': {
    label: '同步服务器文件修改时间',
    description: '下载完成后将本地文件的 mtime 设为 HTTP/FTP 响应头 Last-Modified 提供的服务端时间。',
    example: 'false',
  },
  'remove-control-file': {
    label: '完成后移除控制文件',
    description: '控制任务进度元数据是否在完成前清理。注意与部分断点保留策略互斥。',
    example: 'false',
  },
  'auto-save-interval': {
    label: '自动保存控制文件间隔',
    description: '每隔多少秒把运行中的分段进度写入控制文件，减小异常断电后的回退量；0 表示仅退出时保存。',
    example: '60',
  },
  'force-save': {
    label: '强制保存到会话文件',
    description: '即便任务已完成或失败，依然将其写入 save-session 会话文件，便于重启后保留历史记录。',
    example: 'false',
  },
  'save-not-found': {
    label: '保存失效链接到会话文件',
    description: '因为 404 等资源不存在错误而停止的任务，是否仍保留在 save-session 导出清单中。',
    example: 'true',
  },
  'parameterized-uri': {
    label: '启用参数化链接展开',
    description: '支持把形如 https://example.com/img_[01-20].png 的区间模板展开为多条真实下载链接。',
    example: 'false',
  },
  'dry-run': {
    label: '试运行检查（不落盘）',
    description: '只向远端探测文件是否存在与大小信息，不真正创建或写入任何本地文件。',
    example: 'false',
  },
  'state-dir': {
    label: '状态与断点目录（aria2-next）',
    description: 'aria2-next 将任务进度与崩溃恢复检查点集中存放在该目录，避免在下载文件夹内散布 .aria2 碎片文件。',
    example: '/var/lib/aria2-next/state',
  },
  'state-save-interval': {
    label: '状态检查点保存间隔（aria2-next）',
    description: 'aria2-next 周期性持久化状态检查点的秒数间隔，用于在意外中断后快速无损恢复。',
    example: '30',
  },

  /* ---------------- 3. 速率限制与速度保护 ---------------- */
  'max-overall-download-limit': {
    label: '全局最大下载限速',
    description: '限制整个 aria2 实例所有任务合计的每秒下载字节上限，防止占满出口带宽影响网页浏览；0 为不限速。',
    example: '0 或 10M（字节/秒）',
  },
  'max-download-limit': {
    label: '单任务默认最大下载限速',
    description: '新添加的每个下载任务各自的每秒下载速率上限；0 表示单任务不单独限速。',
    example: '0 或 2M',
  },
  'max-overall-upload-limit': {
    label: '全局最大上传限速',
    description: '限制整个实例在 BT/ED2K 做种时的总上传带宽上限；0 为不限速。',
    example: '0 或 1M',
  },
  'max-upload-limit': {
    label: '单任务默认最大上传限速',
    description: '单个 BT/ED2K 任务的每秒上传速率上限；0 表示不单独限制。',
    example: '0 或 512K',
  },
  'lowest-speed-limit': {
    label: '最低速度保护阈值',
    description: '如果下载速度持续低于该值，核心会主动断开过慢连接并尝试重试或切换镜像；0 表示关闭此保护。',
    example: '0 或 50K',
  },

  /* ---------------- 4. HTTP / HTTPS / Cookies / TLS 证书 ---------------- */
  'user-agent': {
    label: 'HTTP User-Agent 请求头',
    description: '向 HTTP/HTTPS 服务器发起请求时声明的客户端标识字符串，部分站点会据此放行或限制下载。',
    example: 'Mozilla/5.0 或 aria2-next/3.1.0',
  },
  referer: {
    label: 'HTTP Referer 来源页',
    description: '请求头中的来源页面地址，用于通过防盗链校验；设为 * 会自动把当前下载链接自身作为 Referer。',
    example: '* 或 https://example.com/',
  },
  header: {
    label: '自定义 HTTP 请求头',
    description: '附加到 HTTP 请求的额外标头（如 Cookie、Authorization 或 Origin），多条头部通常以换行分隔。',
    example: 'Authorization: Bearer your_token',
  },
  'http-accept-gzip': {
    label: '接受 gzip 压缩响应',
    description: '在请求头发送 Accept-Encoding: gzip, deflate 并在接收时自动解压，适合网页或文本清单，普通二进制大文件通常无需开启。',
    example: 'false',
  },
  'http-no-cache': {
    label: '禁用 HTTP 缓存',
    description: '发送 Cache-Control: no-cache 与 Pragma: no-cache，要求中间代理与 CDN 回源获取最新文件。',
    example: 'false',
  },
  'http-auth-challenge': {
    label: '仅在质询时发送 HTTP 认证',
    description: '仅当服务端返回 401 Unauthorized 质询后再附带基本认证凭据，避免在首次无须认证的请求中泄露账号密码。',
    example: 'false',
  },
  'http-user': {
    label: 'HTTP 基本认证用户名',
    description: '访问受 HTTP Basic Auth 保护的资源时使用的默认用户名。',
    example: 'admin',
  },
  'http-passwd': {
    label: 'HTTP 基本认证密码',
    description: '访问受 HTTP Basic Auth 保护的资源时使用的默认密码。',
    example: 'secret',
  },
  'use-head': {
    label: '优先使用 HEAD 请求探测',
    description: '发起正式拉取前先用 HEAD 获取文件大小与名称；少数不规范服务端不支持 HEAD 时需保持 false。',
    example: 'false',
  },
  'enable-http-keep-alive': {
    label: '启用 HTTP 长连接',
    description: '复用同一条 TCP/TLS 连接发送多次分段请求，明显降低高延迟网络下的重复握手开销。',
    example: 'true',
  },
  'enable-http-pipelining': {
    label: '启用 HTTP 管道化',
    description: '在同一条连接上连续发出多个未等待响应的 HTTP 请求；仅少数服务端完整兼容，通常保持 false。',
    example: 'false',
  },
  'content-disposition-default-utf8': {
    label: '文件名默认按 UTF-8 解码',
    description: '当服务器返回非标准的未转义 Content-Disposition 中文文件名时，优先按 UTF-8 解析以减少乱码。',
    example: 'false',
  },
  'check-certificate': {
    label: '验证 HTTPS 服务端证书',
    description: '校验 HTTPS 服务器的 TLS 证书有效性及域名匹配。仅在可信内网自签证书报错时才考虑临时关闭。',
    example: 'true',
  },
  'ca-certificate': {
    label: 'CA 根证书文件路径',
    description: '指定自定义的 PEM 格式根证书链文件，用于信任企业内网或私有 CA 签发的 HTTPS 证书。',
    example: '/etc/ssl/certs/ca-certificates.crt',
  },
  certificate: {
    label: '客户端 TLS 证书路径',
    description: '访问要求双向 TLS（mTLS）认证的 HTTPS 服务器时，提供给服务端的客户端证书文件（PEM/PKCS12）。',
    example: '/path/to/client.pem',
  },
  'private-key': {
    label: '客户端 TLS 私钥路径',
    description: '与客户端 TLS 证书配对使用的私钥文件路径。',
    example: '/path/to/client.key',
  },
  'min-tls-version': {
    label: '最低 TLS 协议版本',
    description: '限制 HTTPS 连接允许协商的最低加密协议版本，建议保持 TLSv1.2 或更高以确保安全性。',
    example: 'TLSv1.2 / TLSv1.3',
  },
  'load-cookies': {
    label: '加载 Cookies 文件路径',
    description: '启动时从 Netscape / Mozilla 格式的 cookies.txt 导入登录态，用于下载需要登录权限的网盘直链。',
    example: '/path/to/cookies.txt',
  },
  'save-cookies': {
    label: '保存 Cookies 文件路径',
    description: '退出或运行期间将服务端 Set-Cookie 下发的新 Cookie 写回本地 cookies.txt 文件。',
    example: '/path/to/cookies.txt',
  },
  'no-netrc': {
    label: '禁用 .netrc 凭据文件',
    description: '关闭后不再自动读取用户主目录下的 .netrc 账号密码文件（注意部分核心中该项关闭后运行期不可再动态打开）。',
    example: 'false',
  },
  'netrc-path': {
    label: '.netrc 凭据文件路径',
    description: '显式指定存放主机认证账号密码的 netrc 文件路径，替代默认的 ~/.netrc。',
    example: '~/.netrc',
  },

  /* ---------------- 5. 代理、超时重试与底层网络 ---------------- */
  'all-proxy': {
    label: '全局代理地址',
    description: '为 HTTP、HTTPS 和 FTP 请求统一设置代理服务器，支持 http:// 或 socks 形式（按所用核心支持范围）。',
    example: 'http://127.0.0.1:7890',
  },
  'all-proxy-user': {
    label: '全局代理用户名',
    description: '全局代理服务器需要身份验证时使用的用户名。',
    example: 'proxy_user',
  },
  'all-proxy-passwd': {
    label: '全局代理密码',
    description: '全局代理服务器需要身份验证时使用的密码。',
    example: 'proxy_pass',
  },
  'http-proxy': {
    label: 'HTTP 专属代理',
    description: '仅针对明文 HTTP 下载流量使用的代理服务器，优先级高于 all-proxy。',
    example: 'http://127.0.0.1:7890',
  },
  'http-proxy-user': {
    label: 'HTTP 代理用户名',
    description: 'http-proxy 的代理认证用户名。',
    example: 'user',
  },
  'http-proxy-passwd': {
    label: 'HTTP 代理密码',
    description: 'http-proxy 的代理认证密码。',
    example: 'pass',
  },
  'https-proxy': {
    label: 'HTTPS 专属代理',
    description: '仅针对 HTTPS 加密下载流量使用的代理服务器，优先级高于 all-proxy。',
    example: 'http://127.0.0.1:7890',
  },
  'https-proxy-user': {
    label: 'HTTPS 代理用户名',
    description: 'https-proxy 的代理认证用户名。',
    example: 'user',
  },
  'https-proxy-passwd': {
    label: 'HTTPS 代理密码',
    description: 'https-proxy 的代理认证密码。',
    example: 'pass',
  },
  'ftp-proxy': {
    label: 'FTP 专属代理',
    description: '仅针对 FTP 协议使用的代理服务器（aria2-next 已移除 FTP 下载时该项仅作兼容保留）。',
    example: 'http://127.0.0.1:7890',
  },
  'ftp-proxy-user': {
    label: 'FTP 代理用户名',
    description: 'ftp-proxy 的代理认证用户名。',
    example: 'user',
  },
  'ftp-proxy-passwd': {
    label: 'FTP 代理密码',
    description: 'ftp-proxy 的代理认证密码。',
    example: 'pass',
  },
  'no-proxy': {
    label: '绕过代理的主机列表',
    description: '逗号分隔的直连域名、IP 或网段清单，命中后不再经过代理，适合内网地址或本地镜像源。',
    example: 'localhost,127.0.0.1,.local,192.168.0.0/16',
  },
  'proxy-method': {
    label: 'HTTPS 代理隧道方式',
    description: '经 HTTP 代理访问资源时采用 get 直接转发还是 tunnel（CONNECT 隧道）；HTTPS 通常需要 tunnel。',
    example: 'get / tunnel',
  },
  timeout: {
    label: '网络读写超时时间',
    description: '建立连接后连续多少秒收不到任何数据就判定超时并触发重试。单位为秒。',
    example: '60',
  },
  'connect-timeout': {
    label: '建立连接超时时间',
    description: 'TCP 握手或 TLS 建连最多等待多少秒，网络较差或节点失联时调小可加快切换备用源。单位为秒。',
    example: '60',
  },
  'max-tries': {
    label: '最大重试次数',
    description: '遇到可恢复的网络错误时每个链接最多重试多少次；设为 0 表示无限重试直到成功或手动停止。',
    example: '5',
  },
  'retry-wait': {
    label: '重试等待间隔',
    description: '每次请求失败后等待多少秒再重试，适当设置（如 3~10 秒）可避免高频重试触发服务端限流。',
    example: '0 或 5',
  },
  'max-file-not-found': {
    label: '404 资源不存在重试上限',
    description: '收到指定次数 HTTP 404 Not Found 后立即失败放弃，不再反复重试；0 表示按 max-tries 处理。',
    example: '0',
  },
  'retry-on-400': {
    label: '遇 HTTP 400 是否重试',
    description: '服务器返回 400 Bad Request 时是否视作临时故障并重连；需配合 retry-wait 使用。',
    example: 'false',
  },
  'retry-on-403': {
    label: '遇 HTTP 403 是否重试',
    description: '服务器返回 403 Forbidden 时是否自动重试，部分限流站点短暂封禁后重试可恢复。',
    example: 'false',
  },
  'retry-on-406': {
    label: '遇 HTTP 406 是否重试',
    description: '服务器返回 406 Not Acceptable 时是否自动重试。',
    example: 'false',
  },
  'retry-on-unknown': {
    label: '遇未知状态码是否重试',
    description: '遇到 aria2 未明确归类的其他 HTTP 错误状态码时是否仍按重试流程继续尝试。',
    example: 'false',
  },
  'disable-ipv6': {
    label: '禁用 IPv6',
    description: '强制所有连接与域名解析仅使用 IPv4，在宿主机 IPv6 路由异常或无公网 IPv6 时可避免卡顿。',
    example: 'false',
  },
  'async-dns': {
    label: '启用异步 DNS 解析',
    description: '使用内置异步 DNS（c-ares）解析域名，避免大量并发请求在系统阻塞 DNS 调用上卡住主线程。',
    example: 'true',
  },
  'async-dns-server': {
    label: '异步 DNS 服务器列表',
    description: '逗号分隔的自定义 DNS 服务器 IP，仅在启用 async-dns 时生效。',
    example: '223.5.5.5,1.1.1.1',
  },
  interface: {
    label: '绑定本地出口网卡/IP',
    description: '强制出站流量从指定的网卡名或本地 IP 地址发出，多线服务器或 VPN 场景常用。',
    example: 'eth0 或 192.168.1.50',
  },
  'multiple-interface': {
    label: '多网卡轮询出口列表',
    description: '逗号分隔的多个本地网卡或 IP，新建连接会在这些出口间轮询以叠加多条宽带线路。',
    example: 'eth0,eth1',
  },
  dscp: {
    label: 'DSCP 服务质量标记',
    description: '为出站 IP 数据包设置 DSCP（Differentiated Services Code Point）值，便于路由器做 QoS 流控。',
    example: '0',
  },
  'socket-recv-buffer-size': {
    label: 'Socket 接收缓冲区大小',
    description: '调整底层 TCP 套接字 SO_RCVBUF 大小；0 表示由操作系统自动调节（高带宽高延迟链路可适当调大）。',
    example: '0 或 1M',
  },

  /* ---------------- 6. FTP / SFTP（与 aria2-next 兼容边界说明） ---------------- */
  'ftp-user': {
    label: 'FTP 登录用户名',
    description: '连接 FTP 服务器时未在链接中写明账号时使用的默认用户名（注意 aria2-next 已移除 FTP 协议支持）。',
    example: 'anonymous',
  },
  'ftp-passwd': {
    label: 'FTP 登录密码',
    description: '连接 FTP 服务器时使用的默认密码。',
    example: 'ARIA2USER@',
  },
  'ftp-pasv': {
    label: '启用 FTP 被动模式（PASV）',
    description: '处于 NAT 路由器或防火墙之后时必须开启被动模式，才能正常建立 FTP 数据连接。',
    example: 'true',
  },
  'ftp-type': {
    label: 'FTP 传输类型',
    description: '指定 FTP 传输使用 binary（二进制，推荐）还是 ascii（纯文本换行转换）。',
    example: 'binary',
  },
  'ftp-reuse-connection': {
    label: '复用 FTP 控制连接',
    description: '从同一台 FTP 服务器下载多个文件时复用已有控制会话，减少反复登录耗时。',
    example: 'true',
  },
  'ssh-host-key-md': {
    label: 'SSH 主机公钥摘要（SFTP）',
    description: '用于校验 SFTP 远端主机公钥指纹（如 sha-1= 或 md5=），防止中间人劫持。',
    example: 'sha-1=b0:22:...',
  },

  /* ---------------- 7. BitTorrent / DHT / LPD / PEX / 做种与加密 ---------------- */
  'follow-torrent': {
    label: '自动解析 .torrent 种子',
    description: '当 HTTP/本地下载目标本身是 .torrent 文件时：true 立即解析并继续下载内容，mem 仅在内存中解析，false 只保存种子文件本身。',
    example: 'true / mem / false',
  },
  'listen-port': {
    label: 'BT 入站 TCP 监听端口',
    description: '供外部 BitTorrent 节点主动连入的 TCP 端口或端口范围。放行防火墙端口可显著提升做种与连入效率。',
    example: '6881-6999 或 51413',
  },
  'enable-dht': {
    label: '启用 IPv4 DHT 网络',
    description: '开启分布式哈希表（DHT）以在无 Tracker 或 Tracker 失效时仍能通过 P2P 网络发现节点与磁力元数据。',
    example: 'true',
  },
  'enable-dht6': {
    label: '启用 IPv6 DHT 网络',
    description: '为 IPv6 环境开启独立的 DHT6 节点发现网络；仅在主机具备稳定 IPv6 连通性时建议开启。',
    example: 'false',
  },
  'dht-listen-port': {
    label: 'DHT UDP 监听端口',
    description: 'IPv4/IPv6 DHT 协议通信使用的 UDP 端口或范围，路由器需放行对应 UDP 端口才能获得更多节点。',
    example: '6881-6999',
  },
  'dht-entry-point': {
    label: 'IPv4 DHT 引导节点',
    description: '初次启动且本地尚无 DHT 路由表缓存时，用于加入 IPv4 DHT 网络的公共引导服务器（host:port）。',
    example: 'dht.transmissionbt.com:6881',
  },
  'dht-entry-point6': {
    label: 'IPv6 DHT 引导节点',
    description: '用于引导加入 IPv6 DHT 网络的初始节点地址与端口。',
    example: 'router.bittorrent.com:6881',
  },
  'dht-file-path': {
    label: 'IPv4 DHT 路由表缓存文件',
    description: '退出时把当前 IPv4 DHT 已知节点保存到该路径，下次重启可秒级恢复 DHT 连通，无需重新引导。',
    example: '~/.cache/aria2/dht.dat',
  },
  'dht-file-path6': {
    label: 'IPv6 DHT 路由表缓存文件',
    description: '保存与恢复 IPv6 DHT 路由节点表的本地文件路径。',
    example: '~/.cache/aria2/dht6.dat',
  },
  'dht-message-timeout': {
    label: 'DHT 消息超时时间',
    description: '单个 DHT UDP 查询请求等待响应的超时秒数，超时后会尝试其他路由节点。',
    example: '10',
  },
  'enable-peer-exchange': {
    label: '启用节点交换（PEX）',
    description: '允许与已连接的非私有 BT 节点互相交换彼此已知的 Peer 列表，快速扩充连接池。私有 PT 种子会自动禁用。',
    example: 'true',
  },
  'bt-enable-lpd': {
    label: '启用本地节点发现（LPD）',
    description: '通过局域网组播发现同一内网下正在下载相同种子的设备，直接内网高速互传（私有种子不生效）。',
    example: 'false',
  },
  'bt-lpd-interface': {
    label: 'LPD 组播绑定网卡',
    description: '指定发送和监听局域网 LPD 组播包的网卡名或本地 IP，多网卡主机可用来避免发错网段。',
    example: 'eth0',
  },
  'bt-max-peers': {
    label: '单种子最大连接节点数',
    description: '每个 BT 任务最多同时保持连接的 Peer 数量；0 表示不设上限（过低影响速度，过高吃内存与连接数）。',
    example: '55 或 100',
  },
  'bt-request-peer-speed-limit': {
    label: '动态请求节点速度阈值',
    description: '当种子整体下载速度低于该值时，即便未达到 bt-max-peers 上限也会积极向 Tracker/DHT 索要更多 Peer。',
    example: '50K',
  },
  'bt-max-open-files': {
    label: 'BT 最大同时打开文件数',
    description: '所有运行中的 BT 任务合计最多同时打开的句柄数量，遇到多文件大合集报 Too many open files 时需核对系统 ulimit 并调优此值。',
    example: '100',
  },
  'bt-stop-timeout': {
    label: 'BT 无速度自动停止超时',
    description: 'BT 任务连续多少秒下载速度为 0 后自动停止（死种保护）；设为 0 表示永不因无速度而停止。',
    example: '0 或 600',
  },
  'bt-tracker': {
    label: '追加的 BT Tracker 列表',
    description: '逗号分隔的公共 Tracker URL 列表，会自动合并到每个新建 BT/磁力任务中以加快搜寻节点。',
    example: 'udp://tracker.opentrackr.org:1337/announce',
  },
  'bt-exclude-tracker': {
    label: '屏蔽指定的 BT Tracker',
    description: '排除种子内自带的特定 Tracker；填 * 可禁用种子里的全部原始 Tracker（常用于仅走自定义或 DHT）。',
    example: '* 或 udp://bad.tracker/announce',
  },
  'bt-tracker-connect-timeout': {
    label: 'Tracker 连接超时时间',
    description: '与 BT Tracker 建立 TCP/HTTP 连接时的超时秒数。',
    example: '60',
  },
  'bt-tracker-timeout': {
    label: 'Tracker 响应超时时间',
    description: '向 Tracker 发出 announce/scrape 后等待回包的最大秒数。',
    example: '60',
  },
  'bt-tracker-interval': {
    label: 'Tracker 最小汇报间隔',
    description: '两次向同一个 Tracker 汇报状态之间的最小等待秒数；0 表示遵循 Tracker 服务器下发的间隔。',
    example: '0',
  },
  'bt-require-crypto': {
    label: '强制要求 BT 协议加密',
    description: '拒绝未加密的传统明文 BT 握手，可对抗运营商对 BitTorrent 特征流量的限速干扰，但会减少老旧客户端连接。',
    example: 'false',
  },
  'bt-min-crypto-level': {
    label: 'BT 最低加密强度',
    description: '当启用协议加密时允许的最低加密等级：plain 允许仅握手混淆，arc4 要求全流量 RC4 加密。',
    example: 'plain / arc4',
  },
  'bt-force-encryption': {
    label: '强制全程加密 BT 传输',
    description: '等同于同时要求 bt-require-crypto=true 且 bt-min-crypto-level=arc4，严格只与支持全加密的节点通信。',
    example: 'false',
  },
  'bt-save-metadata': {
    label: '保存磁力链种子元数据',
    description: '将磁力链接解析出来的元数据保存为同名 .torrent 文件放到下载目录，方便后续备份或重新加载。',
    example: 'false',
  },
  'bt-load-saved-metadata': {
    label: '优先加载本地种子元数据',
    description: '添加磁力链接时若同目录下已存在对应 infoHash 的 .torrent 文件，直接读取而无需再联网苦等 DHT 元数据。',
    example: 'false',
  },
  'bt-metadata-only': {
    label: '仅获取种子元数据',
    description: '只拉取磁力链接对应的种子结构信息而不真正下载文件载荷，多配合 bt-save-metadata 使用。',
    example: 'false',
  },
  'bt-hash-check-seed': {
    label: '做种前校验完整性',
    description: '在本地已有全部文件准备做种前，是否先做哈希校验确认数据无误再对外供种。',
    example: 'true',
  },
  'bt-seed-unverified': {
    label: '跳过校验直接做种',
    description: '不做哈希校验直接认定本地文件完整并开始做种；仅在绝对确认文件未损坏时使用，否则会向全网分发坏块。',
    example: 'false',
  },
  'bt-detach-seed-only': {
    label: '纯做种任务不占并发名额',
    description: '已下载完成正在做种的任务不计入 max-concurrent-downloads 队列名额，避免做种把后续新下载任务一直堵在等待中。',
    example: 'false',
  },
  'bt-enable-hook-after-hash-check': {
    label: '校验后重读动态选项',
    description: '磁力元数据就绪或哈希校验完成后是否允许重新套用部分动态规则；禁用可保持磁力添加时指定的固定参数。',
    example: 'true',
  },
  'bt-prioritize-piece': {
    label: '优先下载首尾分片',
    description: '优先拉取视频文件的头部和尾部索引分片，实现边下边播预览。可指定 head/tail 体积。',
    example: 'head=32M,tail=32M',
  },
  'bt-remove-unselected-file': {
    label: '移除未勾选的文件',
    description: '对于多文件种子中被取消勾选的文件，下载完成后自动从磁盘清理（注意受分片跨文件边界影响的边缘文件）。',
    example: 'false',
  },
  'bt-external-ip': {
    label: '向 Tracker 汇报的外部 IP',
    description: '在多层 NAT、反代或端口映射环境下，显式告知 Tracker 自己的公网 IPv4 地址。',
    example: '203.0.113.10',
  },
  'peer-id-prefix': {
    label: 'BT Peer ID 客户端前缀',
    description: 'BT 握手时对外展示的客户端 20 字节 Peer ID 前缀；PT 站点通常要求固定白名单客户端标识，请勿随意改动。',
    example: 'A2-1-37-0-',
  },
  'peer-agent': {
    label: 'BT 客户端标识（User-Agent）',
    description: '在 BT 扩展握手与 Tracker 请求中声明的客户端版本名称字符串。',
    example: 'aria2/1.37.0',
  },
  'seed-ratio': {
    label: '目标分享率阈值',
    description: '上传量与下载量之比达到该值后停止做种（如 1.0 表示 1:1）。0.0 表示下完即停（除非同时设置了大于 0 的 seed-time，两者任一满足即停止）。',
    example: '1.0 或 0.0',
  },
  'seed-time': {
    label: '最长做种时长（分钟）',
    description: '下载完成后继续做种的最大分钟数。0 表示下完立即停止做种（与 seed-ratio 共同控制做种退出条件）。',
    example: '0 或 60',
  },
  'rpc-save-upload-metadata': {
    label: '保存 RPC 上传的种子/金属链',
    description: '通过 RPC（addTorrent / addMetalink）提交的任务，是否把种子或金属链原文件一并保存进下载目录。',
    example: 'true',
  },

  /* ---------------- 8. Metalink 金属链 ---------------- */
  'follow-metalink': {
    label: '自动解析 Metalink 文件',
    description: '下载到 .metalink / .meta4 文件后是否自动读取其中镜像列表并拉取实际目标文件（true / mem / false）。',
    example: 'true',
  },
  'metalink-preferred-protocol': {
    label: 'Metalink 首选下载协议',
    description: 'Metalink 清单内同时给出多种协议镜像时优先选择哪一种（http / https / ftp / none）。',
    example: 'https 或 none',
  },
  'metalink-enable-unique-protocol': {
    label: 'Metalink 仅用单一协议',
    description: '若 metalink-preferred-protocol 命中了镜像，是否屏蔽其余协议来源仅从首选协议拉取。',
    example: 'true',
  },
  'metalink-language': {
    label: 'Metalink 优先语言',
    description: '优先挑选声明匹配指定语言标签的资源条目。',
    example: 'zh-CN / en-US',
  },
  'metalink-location': {
    label: 'Metalink 优先地区',
    description: '优先挑选位于指定国家/地区代码（ISO 3166-1 alpha-2）的就近镜像服务器。',
    example: 'cn,jp,us',
  },
  'metalink-os': {
    label: 'Metalink 优先操作系统',
    description: '多平台安装包清单中优先匹配指定操作系统的条目。',
    example: 'linux / windows',
  },
  'metalink-version': {
    label: 'Metalink 优先版本号',
    description: '当清单包含多个版本时优先选择匹配的版本号。',
    example: '24.04',
  },
  'metalink-base-uri': {
    label: 'Metalink 相对路径基准 URI',
    description: '用于解析 Metalink 内部相对 URI 镜像地址的基础前缀。',
    example: 'https://mirrors.example.com/iso/',
  },

  /* ---------------- 9. ED2K / Kad（aria2-next 原生扩展） ---------------- */
  'ed2k-listen-port': {
    label: 'ED2K TCP 监听端口（aria2-next）',
    description: 'aria2-next 内置 eDonkey2000 协议的 TCP 监听端口，开放该端口有助于获取 HighID 与更多源。',
    example: '4662',
  },
  'ed2k-udp-listen-port': {
    label: 'ED2K Kad UDP 端口（aria2-next）',
    description: 'aria2-next 用于 Kad 分布式网络检索与源发现的 UDP 端口。',
    example: '4672',
  },
  'ed2k-port-mapping': {
    label: 'ED2K 自动端口映射（aria2-next）',
    description: '启动时自动尝试通过 UPnP / NAT-PMP 向路由器映射 ED2K 与 Kad 端口。',
    example: 'true',
  },
  'ed2k-server': {
    label: 'ED2K 服务器地址（aria2-next）',
    description: '逗号分隔的 eDonkey 服务器 host:port 列表，用于连接传统 ED2K 中心服务器检索源。',
    example: '192.168.1.2:4661',
  },
  'ed2k-server-list': {
    label: 'ED2K 服务器清单路径（aria2-next）',
    description: '指向标准 server.met 文件的路径，用于批量导入预设 eDonkey 服务器列表。',
    example: '/etc/aria2-next/server.met',
  },
  'ed2k-node-list': {
    label: 'Kad 节点引导文件（aria2-next）',
    description: '指向 nodes.dat 文件的路径，用于在没有中心服务器的情况下引导接入 Kad 网络。',
    example: '/etc/aria2-next/nodes.dat',
  },
  'ed2k-state-file': {
    label: 'ED2K 状态持久化文件（aria2-next）',
    description: '保存本地 ED2K 客户端身份哈希、上传积分与连接状态的文件路径。',
    example: '/var/lib/aria2-next/ed2k-state.dat',
  },

  /* ---------------- 10. 流媒体 HLS / DASH（aria2-next 原生扩展） ---------------- */
  'media-format': {
    label: '媒体输出封装容器（aria2-next）',
    description: 'aria2-next 下载 HLS (.m3u8) 或 DASH (.mpd) 流媒体后直接无损混流输出的封装格式（如 mp4 或 mkv）。',
    example: 'mp4 / mkv',
  },
  'media-video': {
    label: '媒体视频轨道选择（aria2-next）',
    description: '指定自动挑选自适应流中的哪一条视频轨道（如最高画质 best、指定分辨率或特定轨道 ID）。',
    example: 'best',
  },
  'media-audio': {
    label: '媒体音频轨道选择（aria2-next）',
    description: '指定自动挑选流媒体中的哪一条音频轨道（如 best、语言标签或无音频）。',
    example: 'best',
  },
  'media-record-time': {
    label: '直播录制时长上限（aria2-next）',
    description: '录制 HLS/DASH 直播流的最大持续时间（秒）；0 或留空表示一直录制直到手动调用「结束录制」。',
    example: '0 或 3600',
  },

  /* ---------------- 11. RPC 接口、会话队列、日志与回调 ---------------- */
  'enable-rpc': {
    label: '启用 RPC 控制服务',
    description: '开启 JSON-RPC / XML-RPC 监听，使 AriaNg-Next 等 Web 面板或浏览器扩展可以远程连接控制。',
    example: 'true',
  },
  'rpc-listen-port': {
    label: 'RPC 服务监听端口',
    description: 'JSON-RPC / WebSocket 监听端口（默认 6800）。更改后需同步更新面板主机设置里的端口。',
    example: '6800',
  },
  'rpc-listen-all': {
    label: '允许外部主机访问 RPC',
    description: '设为 true 时监听 0.0.0.0（允许局域网或远程连接）；false 仅监听 127.0.0.1 本机回环。开放公网时务必配合 rpc-secret。',
    example: 'false',
  },
  'rpc-allow-origin-all': {
    label: '允许跨域访问 RPC（CORS）',
    description: '在 HTTP 响应中附加 Access-Control-Allow-Origin: *，浏览器通过 http:// 连接 RPC 时需要开启；ws:// 通常不受同源限制。',
    example: 'true / false',
  },
  'rpc-secret': {
    label: 'RPC 访问鉴权密钥',
    description: '所有 RPC 调用必须携带的 Bearer token 密钥。强烈建议在非本机环境或开启 rpc-listen-all 时设置高强度密钥。',
    example: 'your-strong-secret',
  },
  'rpc-secure': {
    label: '启用 RPC TLS 加密',
    description: '将 RPC 端口升级为 HTTPS / WSS 加密传输，防止密钥和下载链接在网络上明文传输（需配置证书与私钥）。',
    example: 'false',
  },
  'rpc-certificate': {
    label: 'RPC 服务端 TLS 证书',
    description: '启用 rpc-secure 时使用的服务端公钥证书文件路径（PEM/PKCS12）。',
    example: '/etc/aria2/rpc.crt',
  },
  'rpc-private-key': {
    label: 'RPC 服务端 TLS 私钥',
    description: '启用 rpc-secure 时与服务端证书配对的私钥文件路径。',
    example: '/etc/aria2/rpc.key',
  },
  'rpc-max-request-size': {
    label: '单次 RPC 请求体积上限',
    description: '允许客户端单次 POST/WebSocket 发送的最大 JSON-RPC 报文长度；上传超大 .torrent 文件若失败可适当调大。',
    example: '2M 或 16M',
  },
  pause: {
    label: '新建任务默认暂停',
    description: '添加新下载任务后先保持 paused 状态等待手工开始，方便先调整 BT 选文件或限速参数。',
    example: 'false',
  },
  'pause-metadata': {
    label: '获取元数据后自动暂停',
    description: '磁力链接或金属链在拉取完文件列表元数据后立即自动暂停，方便用户手动勾选要下载的子文件后再继续。',
    example: 'false',
  },
  'save-session': {
    label: '会话状态保存路径',
    description: '将当前未完成及错误任务队列导出保存到该文本文件，配合 input-file 实现重启后自动恢复下载队列。',
    example: '/var/lib/aria2/aria2.session',
  },
  'save-session-interval': {
    label: '自动保存会话间隔',
    description: '每隔多少秒自动将当前任务队列写入 save-session 文件；0 表示仅在正常退出时保存一次。',
    example: '60',
  },
  'input-file': {
    label: '启动加载的任务清单文件',
    description: '启动时批量读取的任务列表或 aria2.session 会话文件路径。',
    example: '/var/lib/aria2/aria2.session',
  },
  'deferred-input': {
    label: '延迟解析大量输入任务',
    description: '当 input-file 包含上万条任务时按需分批读入，避免启动瞬间占满内存。',
    example: 'false',
  },
  'max-download-result': {
    label: '已完成记录保留上限',
    description: '内存中最多保留多少条已完成/出错/已停止的任务历史记录，超过后最旧的记录会被自动淘汰以控内存。',
    example: '1000',
  },
  'keep-unfinished-download-result': {
    label: '保留未完成任务记录',
    description: '错误或被移除的任务即使超过淘汰数量或重进队列时，是否尽量在内存结果列表保留其错误信息以便排查。',
    example: 'true',
  },
  'download-result': {
    label: '控制台结果摘要显示范围',
    description: '控制退出时或摘要输出的记录过滤范围：default 隐藏内存中已清理项、full 全量显示、hide 不显示。',
    example: 'default / full / hide',
  },
  log: {
    label: '日志文件路径',
    description: '将运行日志写入指定文件路径；留空不写文件，设为 - 则输出到标准输出。',
    example: '/var/log/aria2.log',
  },
  'log-level': {
    label: '日志文件输出级别',
    description: '写入 log 文件的详细程度，从细到粗依次为 debug、info、notice、warn、error。排查疑难连接问题可临时调为 debug。',
    example: 'notice / debug',
  },
  'console-log-level': {
    label: '控制台日志输出级别',
    description: '控制直接打印到终端标准输出的日志详细程度（debug / info / notice / warn / error）。',
    example: 'notice / warn',
  },
  'summary-interval': {
    label: '控制台进度摘要间隔',
    description: '每隔多少秒在终端打印一次全局下载概览；后台无头运行时设为 0 可减少无效日志刷屏。',
    example: '0 或 60',
  },
  quiet: {
    label: '静默模式',
    description: '禁用全部控制台标准输出（仍可写 log 文件与提供 RPC）。',
    example: 'false',
  },
  'show-console-readout': {
    label: '显示实时进度条输出',
    description: '在终端展示每秒刷新的单行实时速率与进度条，作为守护进程或重定向日志时可关闭。',
    example: 'true',
  },
  'truncate-console-readout': {
    label: '截断超长控制台输出行',
    description: '防止过长的文件名或进度条折行破坏终端版面，超出终端宽度的内容会被截断。',
    example: 'true',
  },
  'human-readable': {
    label: '控制台以可读单位显示',
    description: '在终端日志与进度摘要里自动换算为 KiB/MiB/GiB，而不是一长串原始字节数。',
    example: 'true',
  },
  'enable-color': {
    label: '控制台彩色输出',
    description: '为终端日志启用 ANSI 彩色高亮；将日志重定向到纯文本文件时可设为 false 避免转义字符。',
    example: 'true',
  },
  daemon: {
    label: '后台守护进程运行',
    description: '在类 Unix 系统上使进程转入后台 daemon 模式运行。',
    example: 'false',
  },
  stop: {
    label: '定时自动退出秒数',
    description: '运行达到指定秒数后自动停止并退出进程；0 表示持续运行不自动退出。',
    example: '0',
  },
  'stop-with-process': {
    label: '随父进程一同退出',
    description: '监听指定 PID 进程，当该父进程结束时 aria2 自动安全退出（常用于桌面套壳应用托管核心）。',
    example: '12345',
  },
  'conf-path': {
    label: '配置文件路径',
    description: '启动时显式加载的主配置文件路径，默认读取 ~/.aria2/aria2.conf。',
    example: '~/.aria2/aria2.conf',
  },
  'no-conf': {
    label: '忽略默认配置文件',
    description: '启动时不自动加载默认位置的 aria2.conf，完全以命令行和 RPC 传入的参数为准。',
    example: 'false',
  },
  'event-poll': {
    label: 'I/O 事件轮询机制',
    description: '指定底层网络多路复用模型（如 epoll / kqueue / port / poll / select），通常留空由核心按平台自动选优即可。',
    example: 'epoll / kqueue',
  },
  'rlimit-nofile': {
    label: '最大文件描述符数限制',
    description: '在支持的类 Unix 系统上调高进程软限制 RLIMIT_NOFILE，避免高并发连接或超大 BT 合集触发句柄耗尽。',
    example: '4096',
  },
  'server-stat-of': {
    label: '保存服务器测速统计路径',
    description: '将各下载镜像历史响应速度与故障统计保存到文件，供 URI 选择器长期学习优化。',
    example: '~/.cache/aria2/server-stat.txt',
  },
  'server-stat-if': {
    label: '加载服务器测速统计路径',
    description: '启动时载入之前保存的镜像服务器测速统计数据，开局就能避开慢源。',
    example: '~/.cache/aria2/server-stat.txt',
  },
  'server-stat-timeout': {
    label: '服务器测速统计过期时间',
    description: '镜像历史测速记录保留多少秒后失效淘汰，避免陈旧测速影响当前调度决策。',
    example: '86400',
  },
  'on-download-start': {
    label: '开始下载回调脚本',
    description: '任务开始下载时触发执行的本地脚本路径，核心会传入 GID、文件数与首个文件路径三个参数。',
    example: '/path/to/on-start.sh',
  },
  'on-download-pause': {
    label: '暂停下载回调脚本',
    description: '任务被暂停时触发执行的本地通知或联动脚本路径。',
    example: '/path/to/on-pause.sh',
  },
  'on-download-stop': {
    label: '停止下载回调脚本',
    description: '任务被用户停止或移除（未完成）时触发执行的本地清理脚本路径。',
    example: '/path/to/on-stop.sh',
  },
  'on-download-complete': {
    label: '下载完成回调脚本',
    description: '普通下载全部完成时触发执行的脚本路径，常用于自动解压、归档或发送桌面通知。',
    example: '/path/to/on-complete.sh',
  },
  'on-download-error': {
    label: '下载出错回调脚本',
    description: '任务因网络或磁盘错误终止时触发执行的告警脚本路径。',
    example: '/path/to/on-error.sh',
  },
  'on-bt-download-complete': {
    label: 'BT 完成做种回调脚本',
    description: 'BT 任务下载完成并进入做种阶段时触发执行的脚本路径（无需等到停止做种即可触发硬链整理）。',
    example: '/path/to/on-bt-complete.sh',
  },
}

/**
 * 查询某个全局选项的中文文档。
 *
 * 为什么要显式用 `Object.prototype.hasOwnProperty.call`？
 * 因为选项名来自外部输入/搜索框，如果直接写 `GLOBAL_OPTION_DOCS[name]`，
 * 当传入 `'toString'` / `'constructor'` 等 Object 原型属性名时，
 * JS 会误返回原型上的函数对象，而不是预期的 `null`。
 */
export function getGlobalOptionDoc(name: string): GlobalOptionDoc | null {
  const trimmed = name.trim()
  if (!trimmed) return null

  if (Object.prototype.hasOwnProperty.call(GLOBAL_OPTION_DOCS, trimmed)) {
    return GLOBAL_OPTION_DOCS[trimmed]
  }

  const normalized = trimmed.toLowerCase()
  if (Object.prototype.hasOwnProperty.call(GLOBAL_OPTION_DOCS, normalized)) {
    return GLOBAL_OPTION_DOCS[normalized]
  }

  return null
}

/**
 * 判断全局选项是否匹配搜索关键词。
 *
 * 同时匹配四个维度（均忽略英文大小写）：
 *  1. 选项键名（如 `max-concurrent-downloads`）
 *  2. 当前配置值（如 `true`、`/downloads`）
 *  3. 中文短标题（如 `最大同时下载`）
 *  4. 中文详细说明（如 `断点续传`、`DHT`）
 *
 * 让不记得英文选项名的用户，直接搜中文关键词就能找到对应配置项。
 */
export function matchesGlobalOption(name: string, value: string, keyword: string): boolean {
  const query = keyword.trim().toLowerCase()
  if (!query) return true

  if (name.toLowerCase().includes(query) || value.toLowerCase().includes(query)) {
    return true
  }

  const doc = getGlobalOptionDoc(name)
  if (!doc) return false

  return doc.label.toLowerCase().includes(query) || doc.description.toLowerCase().includes(query)
}
