/**
 * aria2-next 后端协议自检脚本
 *
 * ============================== 为什么需要它 ==============================
 *
 * 面板本身不实现下载协议 —— 那是 aria2-next 核心的活。
 * 但「面板声称支持 HTTP / BT / ED2K / HLS / DASH / Metalink」这句话，
 * 到底在**真实后端**上成立吗？还是只是我们想象出来的？
 *
 * 这个脚本就是去回答这个问题：对一个真实的 aria2-next 实例，
 * 逐个协议下发任务，看核心到底认不认。
 *
 * 用法：
 *   node tools/protocol-check.mjs --url http://127.0.0.1:6801/jsonrpc --secret your-secret
 *
 * 可选参数：
 *   --torrent <路径>    本地种子文件。用于测 BitTorrent（网络上的种子源经常挂，
 *                       阿里云镜像就返回过 0.3 KB 的错误页冒充 .torrent）
 *   --keep              测试完成后不删除任务（默认会清掉，避免污染下载目录）
 *
 * ============================== 读脚本的收获 ==============================
 *
 * 1. JSON-RPC 的「数组参数」约定：aria2 的方法几乎都收数组，
 *    而且**第一个元素固定是 token**，后面的才是真正的参数。
 *    注意 addUri 的第二个参数（URI 列表）**必须再包一层数组**，
 *    写成字符串会直接报 "options must be an object" 之类的错。
 * 2. 状态查询要用 tellStatus 并**显式列出需要的字段**（第二个参数是键数组），
 *    全量查询的字段特别多，噪音很大。
 * 3. 任务的完成/失败不是一次调用能看出来的，要**轮询**。
 */

import { readFileSync, existsSync } from 'node:fs'

/* ------------------------------------------------------------------ *
 * 1. 解析命令行参数
 * ------------------------------------------------------------------ */

const args = process.argv.slice(2)

function argValue(flag, fallback = '') {
  const index = args.indexOf(flag)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const URL = argValue('--url', 'http://127.0.0.1:6800/jsonrpc')
const SECRET = argValue('--secret', '')
const TORRENT = argValue('--torrent', '')
const KEEP = args.includes('--keep')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ------------------------------------------------------------------ *
 * 2. 一个极简 JSON-RPC 客户端
 * ------------------------------------------------------------------ */

let rpcId = 0

async function rpc(method, params = []) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `c${++rpcId}`,
      method,
      // ⚠️ token 永远放在 params[0]，这是 aria2 的固定约定
      params: SECRET ? [`token:${SECRET}`, ...params] : params,
    }),
  })
  const json = await res.json()
  if (json.error) throw new Error(`${method} → [${json.error.code}] ${json.error.message}`)
  return json.result
}

/* ------------------------------------------------------------------ *
 * 3. 测试用例
 * ------------------------------------------------------------------ */

const cases = [
  { key: 'http', label: 'HTTP', url: 'http://archive.ubuntu.com/ubuntu/ls-lR.gz' },
  { key: 'https', label: 'HTTPS', url: 'https://mirrors.kernel.org/ubuntu/ls-lR.gz' },
  { key: 'hls', label: 'HLS', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' },
  { key: 'dash', label: 'DASH', url: 'https://livesim.dashif.org/livesim/testpic_2s/Manifest.mpd' },
  { key: 'ed2k', label: 'ED2K', url: 'ed2k://|file|eMule0.49c.zip|2868871|0F88EEFA9D8AD3F43DABAC9982D2450C|/' },
  { key: 'sftp', label: 'SFTP（核心默认不支持）', url: 'sftp://127.0.0.1:65999/none.bin' },
  { key: 'ftp', label: 'FTP（aria2-next 已移除）', url: 'ftp://ftp.gnu.org/gnu/README' },
]

/* ------------------------------------------------------------------ *
 * 4. 执行
 * ------------------------------------------------------------------ */

console.log(`目标：${URL}\n`)

let version
try {
  version = await rpc('aria2.getVersion')
  console.log(`核心版本：${version.version}`)
  console.log(`启用特性：${(version.enabledFeatures ?? []).join(', ') || '(无)'}\n`)
} catch (error) {
  console.error(`连不上目标：${error.message}`)
  process.exit(1)
}

const gids = {}

for (const item of cases) {
  try {
    const gid = await rpc('aria2.addUri', [[item.url]])
    gids[item.key] = gid
    console.log(`  ✓ ${item.label.padEnd(26)} gid=${gid}`)
  } catch (error) {
    gids[item.key] = null
    console.log(`  ✗ ${item.label.padEnd(26)} ${error.message}`)
  }
}

// BitTorrent 走的是另一个方法：addTorrent，且第一个参数是种子文件的 base64
if (TORRENT && existsSync(TORRENT)) {
  try {
    const seed = readFileSync(TORRENT).toString('base64')
    const gid = await rpc('aria2.addTorrent', [seed, []])
    gids.bt = gid
    console.log(`  ✓ ${'BitTorrent'.padEnd(26)} gid=${gid}`)
  } catch (error) {
    gids.bt = null
    console.log(`  ✗ ${'BitTorrent'.padEnd(26)} ${error.message}`)
  }
} else {
  console.log(`  – ${'BitTorrent'.padEnd(26)} 跳过（用 --torrent 指定本地种子文件）`)
}

console.log('\n等待 30 秒让任务推进…\n')
await sleep(30000)

console.log('=========== 结果 ===========')
for (const item of cases) {
  const gid = gids[item.key]
  if (!gid) {
    console.log(`\n▸ ${item.label}\n  状态：未能创建任务`)
    continue
  }
  try {
    const status = await rpc('aria2.tellStatus', [gid, ['status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorCode', 'errorMessage']])
    console.log(`\n▸ ${item.label}`)
    console.log(`  状态    ：${status.status}`)
    console.log(`  进度    ：${status.completedLength} / ${status.totalLength} B`)
    console.log(`  速度    ：${status.downloadSpeed} B/s`)
    if (status.errorCode) console.log(`  错误    ：[${status.errorCode}] ${status.errorMessage}`)
  } catch (error) {
    console.log(`\n▸ ${item.label}\n  查询失败：${error.message}`)
  }
}

if (gids.bt) {
  try {
    const status = await rpc('aria2.tellStatus', [gids.bt, ['infoHash', 'numSeeders', 'numPeers', 'bittorrent']])
    console.log(`\n▸ BitTorrent`)
    console.log(`  infoHash：${status.infoHash ?? '(无)'}`)
    console.log(`  做种/-peer：${status.numSeeders ?? '?'} / ${status.numPeers ?? '?'}`)
    if (status.bittorrent) console.log(`  扩展    ：${JSON.stringify(status.bittorrent).slice(0, 300)}`)
  } catch (error) {
    console.log(`\n▸ BitTorrent 查询失败：${error.message}`)
  }
}

if (!KEEP) {
  console.log('\n清理测试任务…')
  for (const gid of Object.values(gids)) {
    if (!gid) continue
    try {
      await rpc('aria2.forceRemove', [gid])
    } catch {
      // 任务可能已经结束了，忽略
    }
  }
}
