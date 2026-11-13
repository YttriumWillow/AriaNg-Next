/**
 * aria2-next 模拟服务器（开发工具）
 *
 * ============================ 它解决什么问题 ============================
 *
 * 做前端时，你不一定手边就有一个跑着 aria2-next 的 NAS。
 * 但任务列表、详情抽屉、图表这些界面，没有数据是没法看的。
 *
 * 这个脚本用最少的代码模拟 aria2-next 的 JSON-RPC 接口，
 * 返回一批「假装存在」的任务，让面板能跑出完整的样子：
 *
 *   - HTTP 下载任务（带进度、限速、剩余时间）
 *   - BitTorrent 任务（做种中，含 peer / tracker 信息）
 *   - ED2K 任务（含扩展字段 ed2k）
 *   - HLS 直播任务（media 扩展字段，直播无 ETA）
 *   - 一个失败任务（带错误信息）
 *
 * 它同时支持 HTTP 与 WebSocket 两种传输，和真实 aria2-next 一致。
 *
 * ============================== 怎么用 ==============================
 *
 *   node tools/mock-aria2.mjs            # 监听 6800（面板默认地址）
 *   node tools/mock-aria2.mjs --port 6801
 *
 * 然后在面板「设置 → RPC 主机」里填：
 *   ws://127.0.0.1:6800/jsonrpc
 *
 * 注意：真实 aria2-next 也默认占 6800，两者不能同时开。
 *       如果你已经在跑 aria2-next，就别启动这个脚本。
 * ======================================================================
 */

import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'

/* ------------------------------------------------------------------ *
 * 参数
 * ------------------------------------------------------------------ */

const args = process.argv.slice(2)
const portIndex = args.indexOf('--port')
/*
 * 默认用 6801 而不是 6800 —— 6800 是 aria2-next 的默认端口，
 * 真实服务在跑的时候不要跟它抢。面板里把主机地址填成 ws://127.0.0.1:6801/jsonrpc 即可。
 */
const PORT = portIndex >= 0 ? Number(args[portIndex + 1]) : 6801
const SECRET = args.includes('--secret') ? args[args.indexOf('--secret') + 1] : ''

/* ------------------------------------------------------------------ *
 * 模拟数据
 * ------------------------------------------------------------------ */

const startedAt = Date.now()

/** 速度随时间起伏，让速率曲线看起来是「活」的。 */
function wave(base, periodSec, offset = 0) {
  const t = (Date.now() - startedAt) / 1000 + offset
  return Math.max(0, Math.round(base * (0.55 + 0.45 * Math.sin((t / periodSec) * Math.PI * 2))))
}

/** 构造一个 aria2 任务状态对象。字段严格按 aria2 的约定：整型都是十进制字符串。 */
function makeTask(overrides) {
  return {
    gid: '2089b05ecca3d829',
    status: 'active',
    totalLength: '0',
    completedLength: '0',
    uploadLength: '0',
    downloadSpeed: '0',
    uploadSpeed: '0',
    dir: '/downloads',
    ...overrides,
  }
}

const ACTIVE = [
  makeTask({
    gid: 'a1b2c3d4e5f60001',
    status: 'active',
    name: 'ubuntu-24.04.1-desktop-amd64.iso',
    totalLength: '6073252352',
    completedLength: '4372741696',
    uploadLength: '0',
    downloadSpeed: String(wave(8388608, 17)),
    uploadSpeed: '0',
    dir: '/downloads/iso',
  }),
  makeTask({
    gid: 'a1b2c3d4e5f60002',
    status: 'active',
    name: 'Sintel.2021.2160p.mkv',
    totalLength: '13314393042',
    completedLength: '13314393042',
    uploadLength: '1073741824',
    downloadSpeed: '0',
    uploadSpeed: String(wave(1258291, 23)),
    dir: '/downloads/movies',
    connections: '64',
    numSeeders: '12',
    numLeechers: '4',
    bittorrent: {
      magnetLink: 'magnet:?xt=urn:btih:9c7b0d2f4e1a',
      infoHashV1: '9c7b0d2f4e1a3b5c7d9e1f3a5b7c9d1e',
      state: 'active',
      fileSelectionState: 'none',
      webSeeds: [],
      privateTorrent: false,
      numPeers: '16',
      numSeeds: '12',
      numComplete: '48',
      numIncomplete: '7',
      progress: '1',
      availability: '2.4',
      currentTracker: 'udp://tracker.opentrackr.org:1337/announce',
      activeTime: '864000',
      finishedTime: '7200000',
      seedingTime: '7200000',
    },
  }),
  makeTask({
    gid: 'a1b2c3d4e5f60003',
    status: 'active',
    name: 'concert-live-1080p.m3u8',
    totalLength: '0',
    completedLength: '0',
    downloadSpeed: String(wave(3554432, 31)),
    uploadSpeed: '0',
    dir: '/downloads/live',
    media: {
      state: 'recording',
      protocol: 'hls',
      live: 'true',
      duration: '0',
      completedDuration: String(Math.floor(wave(1500000, 31) / 1000)),
      downloadedLength: String(wave(3554432, 31) * 40),
      progress: '0',
      lengthKnown: 'false',
      tracks: [
        { id: 'v-1080', type: 'video', bandwidth: '5200000', width: '1920', height: '1080', frameRate: '30.000' },
        { id: 'v-720', type: 'video', bandwidth: '2800000', width: '1280', height: '720', frameRate: '30.000' },
        { id: 'a-zh', type: 'audio', bandwidth: '128000', language: 'zh' },
      ],
      error: '',
      errorCode: '',
    },
  }),
  makeTask({
    gid: 'a1b2c3d4e5f60004',
    status: 'active',
    name: 'ubuntu-22.04-server.iso',
    totalLength: '2035623680',
    completedLength: '244274841',
    downloadSpeed: '0',
    uploadSpeed: '0',
    dir: '/downloads/iso',
    errorCode: '3',
    errorMessage: 'Remote server returned 403 Forbidden',
  }),
  makeTask({
    gid: 'a1b2c3d4e5f60005',
    status: 'active',
    name: 'Planet.Earth.II.2160p',
    totalLength: '0',
    completedLength: '0',
    downloadSpeed: String(wave(1048576, 41)),
    uploadSpeed: '0',
    dir: '/downloads/ed2k',
    ed2k: {
      hash: '3F2A9C81D5E4B6071918AA2B3C4D5E6F7',
      name: 'Planet.Earth.II.2160p',
      length: '68719476736',
      completedLength: '21474836480',
      partHashCount: '4096',
      aichRoot: 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4',
      peerCount: '38',
      queuedPeerCount: '12',
      acceptedPeerCount: '26',
      deadPeerCount: '4',
      lowIdPeerCount: '2',
      callbackWaitingPeerCount: '1',
      sharingTime: '432000',
      corruptPartCount: '0',
    },
  }),
]

const WAITING = [
  makeTask({
    gid: 'b1b2c3d4e5f60001',
    status: 'waiting',
    name: 'debian-12.7.0-amd64-netinst.iso',
    totalLength: '671088640',
    completedLength: '0',
    dir: '/downloads/iso',
  }),
  makeTask({
    gid: 'b1b2c3d4e5f60002',
    status: 'waiting',
    name: 'BigBuckBunny.mp4',
    totalLength: '1585446912',
    completedLength: '0',
    dir: '/downloads/movies',
  }),
]

const STOPPED = [
  makeTask({
    gid: 'c1b2c3d4e5f60001',
    status: 'complete',
    name: 'archlinux-2024.09.01-x86_64.iso',
    totalLength: '1408393131',
    completedLength: '1408393131',
    uploadLength: '0',
    dir: '/downloads/iso',
    errorCode: '0',
    errorMessage: '',
  }),
  makeTask({
    gid: 'c1b2c3d4e5f60002',
    status: 'error',
    name: 'fedora-workstation-40.iso',
    totalLength: '2415919104',
    completedLength: '1207959552',
    dir: '/downloads/iso',
    errorCode: '1',
    errorMessage: 'No such directory',
  }),
]

/** 全部方法清单（与 aria2-next 实际支持的方法名保持一致的规模感）。 */
const METHODS = [
  'aria2.addUri', 'aria2.addTorrent', 'aria2.addMetalink', 'aria2.addFile',
  'aria2.remove', 'aria2.forceRemove', 'aria2.removeDownloadResult',
  'aria2.pause', 'aria2.forcePause', 'aria2.unpause', 'aria2.forceUnpause',
  'aria2.pauseAll', 'aria2.forcePauseAll', 'aria2.unpauseAll', 'aria2.forceUnpauseAll',
  'aria2.changePosition', 'aria2.changeUri', 'aria2.changeFile',
  'aria2.changeOption', 'aria2.changeGlobalOption',
  'aria2.getOption', 'aria2.getGlobalOption', 'aria2.getDefaultOption', 'aria2.getGlobalDefaultOption',
  'aria2.getVersion', 'aria2.getGlobalStat', 'aria2.getSessionInfo',
  'aria2.getFiles', 'aria2.getPeers', 'aria2.getTrackers', 'aria2.getUris',
  'aria2.tellStatus', 'aria2.tellActive', 'aria2.tellWaiting', 'aria2.tellStopped',
  'aria2.shutdown', 'aria2.forceShutdown', 'aria2.getNetInfo', 'aria2.getGlobalNetInfo',
  'aria2.saveSession', 'aria2.purgeDownloadResult',
  'system.multicall', 'system.listMethods',
  // aria2-next 扩展
  'aria2.probe', 'aria2.resolveFilename', 'aria2.moveDownload',
  'aria2.finishMedia', 'aria2.retryMedia',
  'aria2.getBtTrackers', 'aria2.replaceBtTrackers', 'aria2.replaceBtWebSeeds',
  'aria2.addBtPeers', 'aria2.forceBtAnnounce', 'aria2.forceBtRecheck',
  'aria2.setBtPeerBlocklist', 'aria2.getBtSessionStatus', 'aria2.inspectTorrent',
  'aria2.ed2kSearch', 'aria2.getEd2kSearchResults', 'aria2.ed2kSearchMore',
  'aria2.removeEd2kSearch', 'aria2.getEd2kStatus',
]

const GLOBAL_OPTIONS = {
  'max-concurrent-downloads': '5',
  'max-connection-per-server': '16',
  'split': '16',
  'min-split-size': '20M',
  'max-download-limit': '0',
  'max-upload-limit': '0',
  'continue': 'true',
  'dir': '/downloads',
  'auto-file-renaming': 'true',
  'allow-overwrite': 'false',
  'file-allocation': 'falloc',
  'keep-unfinished-download-result': 'true',
  'max-concurrent-downloads': '5',
  'rpc-listen-port': '6800',
  'dht-listen-port': '6881',
  'enable-dht': 'true',
  'bt-enable-lpd': 'true',
  'follow-torrent': 'true',
  'seed-time': '0',
  'bt-stop-timeout': '600',
  'check-certificate': 'true',
  'user-agent': 'aria2-next/3.1.0',
  'summary-interval': '0',
  'console-log-level': 'notice',
  'max-download-result': '1000',
}

/* ------------------------------------------------------------------ *
 * RPC 分发
 * ------------------------------------------------------------------ */

/** 根据方法名返回结果。 */
function dispatch(method, params) {
  switch (method) {
    case 'aria2.getVersion':
      return {
        version: '3.1.0',
        product: 'aria2-next',
        rpcVersion: '1.1.0',
        enabledFeatures: [
          'HTTP', 'HTTPS', 'SFTP', 'Metalink', 'BitTorrent', 'ED2K', 'HLS', 'DASH',
          'HTTP2', 'WebSocket', 'XML-RPC', 'JSON-RPC', 'SQLite-state', 'Disk-queue',
        ],
        mediaFeatures: ['request-contexts', 'stable-track-ids', 'structured-errors', 'captured-inputs'],
        downloadFeatures: ['filename-hints', 'filename-resolution'],
      }

    case 'system.listMethods':
      return METHODS

    case 'aria2.getGlobalStat': {
      const down = ACTIVE.reduce((sum, task) => sum + Number(task.downloadSpeed), 0)
      const up = ACTIVE.reduce((sum, task) => sum + Number(task.uploadSpeed), 0)
      return {
        downloadSpeed: String(down),
        uploadSpeed: String(up),
        numActive: String(ACTIVE.length),
        numWaiting: String(WAITING.length),
        numStopped: String(STOPPED.length),
        numStoppedTotal: '128',
        numWaitingTotal: '6',
      }
    }

    case 'aria2.tellActive':
      return ACTIVE

    case 'aria2.tellWaiting':
      return WAITING.slice(params[0] ?? 0, (params[0] ?? 0) + (params[1] ?? 100))

    case 'aria2.tellStopped':
      return STOPPED.slice(params[0] ?? 0, (params[0] ?? 0) + (params[1] ?? 100))

    case 'aria2.tellStatus': {
      const gid = params[0]
      return [...ACTIVE, ...WAITING, ...STOPPED].find((task) => task.gid === gid) ?? ACTIVE[0]
    }

    case 'aria2.getFiles':
      return [
        { index: '1', path: '/downloads/movies/Sintel/Sintel.2021.mkv', length: '8741198848', completedLength: '8741198848', selected: 'true', uris: [] },
        { index: '2', path: '/downloads/movies/Sintel/Sintel.2021.srt', length: '43725', completedLength: '43725', selected: 'true', uris: [] },
      ]

    case 'aria2.getPeers':
      return [
        { peerId: '-WG0011-', ip: '203.0.113.4', port: '51413', amChoking: 'false', peerChoking: 'false', downloadSpeed: '4404019', uploadSpeed: '0', seeder: 'false', clientName: 'qBittorrent' },
        { peerId: '-UT3442-', ip: '198.51.100.7', port: '6881', amChoking: 'false', peerChoking: 'false', downloadSpeed: '1887436', uploadSpeed: '1048576', seeder: 'true', clientName: 'Transmission' },
        { peerId: '-DE9021-', ip: '192.0.2.55', port: '6889', amChoking: 'true', peerChoking: 'false', downloadSpeed: '0', uploadSpeed: '0', seeder: 'true', clientName: 'aria2' },
      ]

    case 'aria2.getTrackers':
    case 'aria2.getBtTrackers':
      return [
        { announceUrl: 'udp://tracker.opentrackr.org:1337/announce', status: 'working', tier: '0', lastAnnounceTime: '1767890000', nextAnnounceTime: '1767890600', scrapeCount: '12' },
        { announceUrl: 'udp://open.demonii.com:1337/announce', status: 'working', tier: '0', lastAnnounceTime: '1767890000', nextAnnounceTime: '1767890600', scrapeCount: '9' },
        { announceUrl: 'udp://tracker.torrent.eu.org:451/announce', status: 'error', tier: '1', lastAnnounceTime: '1767885000', nextAnnounceTime: '1767885600', scrapeCount: '3' },
      ]

    case 'aria2.getGlobalOption':
      return GLOBAL_OPTIONS

    case 'aria2.getOption':
      return GLOBAL_OPTIONS

    case 'aria2.changeGlobalOption':
    case 'aria2.changeOption':
      return 'OK'

    case 'aria2.getEd2kStatus':
      return {
        clientId: '0A1B2C3D',
        userHash: '4E5F60718293A4B5',
        tcpPort: '4662',
        udpPort: '4663',
        portMapping: '1',
      }

    case 'aria2.getSessionInfo':
      return { sessionId: 'mock-session-0001' }

    case 'aria2.probe':
      return {
        status: 'success',
        finalUrl: params[0],
        contentType: 'application/x-iso9660-image',
        filename: 'ubuntu-24.04.1-desktop-amd64.iso',
        totalLength: '6073252352',
        resumable: true,
      }

    // 其余控制类方法：回一个合理的值即可
    default:
      if (method.startsWith('aria2.')) return 'OK'
      return null
  }
}

/** 处理一次 JSON-RPC 请求，返回响应体。 */
function handleRpc(body) {
  const { id, method, params = [] } = body

  // secret 校验：第一个参数是 "token:xxx" 形式
  if (SECRET && typeof params[0] === 'string' && params[0].startsWith('token:')) {
    if (params[0].slice(6) !== SECRET) {
      return { jsonrpc: '2.0', id, error: { code: 1, message: 'Unauthorized' } }
    }
  }

  try {
    return { jsonrpc: '2.0', id, result: dispatch(method, params) }
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: 1, message: error instanceof Error ? error.message : String(error) },
    }
  }
}

/* ------------------------------------------------------------------ *
 * HTTP + WebSocket 服务
 * ------------------------------------------------------------------ */

const server = createServer((req, res) => {
  // CORS：浏览器跨域访问 JSON-RPC 需要这两个头
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'text/plain' }).end('Method Not Allowed')
    return
  }

  let raw = ''
  req.on('data', (chunk) => {
    raw += chunk
  })
  req.on('end', () => {
    try {
      const body = JSON.parse(raw)
      console.log(`[mock-aria2] <- HTTP ${body.method}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(handleRpc(body)))
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }))
    }
  })
})

// WebSocket：与 HTTP 共用同一个端口
const wss = new WebSocketServer({ server, path: '/jsonrpc' })

wss.on('connection', (socket) => {
  console.log('[mock-aria2] WebSocket 已连接')
  socket.on('message', (data) => {
    let body
    try {
      body = JSON.parse(String(data))
    } catch {
      return
    }
    console.log(`[mock-aria2] <- ${body.method}`)
    socket.send(JSON.stringify(handleRpc(body)))
  })
  socket.on('close', () => console.log('[mock-aria2] WebSocket 已断开'))
})

server.listen(PORT, () => {
  console.log(`[mock-aria2] 监听 http://127.0.0.1:${PORT}/jsonrpc  (WebSocket 同端口)`)
  console.log(`[mock-aria2] ${ACTIVE.length} 个活跃任务 / ${WAITING.length} 个等待 / ${STOPPED.length} 个已停止`)
  if (SECRET) console.log(`[mock-aria2] secret = ${SECRET}`)
  console.log('[mock-aria2] Ctrl+C 退出')
})
