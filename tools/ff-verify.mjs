/**
 * 用真实 Firefox 渲染页面并做视觉/度量验证（开发工具）
 *
 * ============================== 为什么需要它 ==============================
 *
 * Firefox 的 `--screenshot` 有一个硬伤：它在页面 `load` 事件触发时立刻截图。
 * 而我们的面板是异步的 —— 页面 load 时，WebSocket 还没连上、RPC 还没返回，
 * 截出来的是一片空白。
 *
 * 所以这里改用 Firefox 自带的 **WebDriver BiDi** 调试端口（Firefox 129+ 提供，
 * 本机 Firefox 160 输出 "WebDriver BiDi listening on ws://127.0.0.1:9333"），
 * 可以自己控制「等多久再截」，还能在真实 Firefox 里执行 JS 量出实际间距。
 *
 * 用法：
 *   node tools/ff-verify.mjs <url> <输出png> [--wait 3000] [--measure "选择器"]
 *                             [--size 1600x900] [--eval "表达式"] [--eval-file 脚本.js]
 *                             [--trace-ws]
 *
 * 示例：
 *   node tools/ff-verify.mjs http://localhost:5173/#/diagnostics shot.png --wait 4000
 *   node tools/ff-verify.mjs http://localhost:5173/#/diagnostics shot.png \
 *        --measure ".an-page > *"
 *   node tools/ff-verify.mjs http://localhost:5173/#/tasks shot.png \
 *        --wait 5000 --eval-file tools/probe.js
 * ========================================================================
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FIREFOX = process.env.FIREFOX_PATH ?? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe'
const DEBUG_PORT = Number(process.env.FF_DEBUG_PORT ?? 9333)

const args = process.argv.slice(2)
const positional = args.filter((arg) => !arg.startsWith('--') && !/^\d+$/.test(arg))
const url = positional[0]
const output = positional[1]
const waitIndex = args.indexOf('--wait')
const waitMs = waitIndex >= 0 ? Number(args[waitIndex + 1]) : 3000
const measureIndex = args.indexOf('--measure')
const measureSelector = measureIndex >= 0 ? args[measureIndex + 1] : ''
const sizeIndex = args.indexOf('--size')
const [WINDOW_W, WINDOW_H] = sizeIndex >= 0 ? (args[sizeIndex + 1] ?? '1920x1080').split('x').map(Number) : [1920, 1080]

if (!url || !output) {
  console.error('用法: node tools/ff-verify.mjs <url> <输出.png> [--wait 毫秒] [--measure "CSS选择器"]')
  process.exit(1)
}

/**
 * profile 必须放在项目目录之外，否则 Vite 的文件监听器会盯上 parent.lock 并崩溃。
 *
 * 不传 --profile 时用一次性临时目录（跑完就删）。
 * 传了 --profile 则复用同一个目录 —— 这样多次运行之间 localStorage 能保留，
 * 多步交互验证（第一步添加主机 → 第二步切换主机 → 第三步截图）才连得起来。
 */
const profileIndex = args.indexOf('--profile')
const fixedProfile = profileIndex >= 0 ? args[profileIndex + 1] : ''
const profileDir = fixedProfile || mkdtempSync(join(tmpdir(), 'an-next-ff-'))
if (fixedProfile) mkdirSync(profileDir, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ------------------------------------------------------------------ *
 * 启动 Firefox
 * ------------------------------------------------------------------ */

const firefox = spawn(
  FIREFOX,
  [
    '--headless',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--window-size=${WINDOW_W},${WINDOW_H}`,
    '--profile', profileDir,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

/** 等待 BiDi 端口就绪。 */
async function waitForDebugger() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      if (response.ok) return
    } catch {
      // 端口还没起来，继续等
    }
    await sleep(500)
  }
  // BiDi 不提供 /json/version，但端口可能已经在了；直接尝试建连
}

/* ------------------------------------------------------------------ *
 * 极简 WebDriver BiDi 客户端
 * ------------------------------------------------------------------ */

async function connect() {
  const socket = new WebSocket(`ws://127.0.0.1:${DEBUG_PORT}/session`)
  const waiters = new Map()
  let messageId = 0

  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = () => reject(new Error('无法连接 Firefox BiDi 端口'))
  })

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.type === 'event') return // 忽略事件
    const waiter = waiters.get(message.id)
    if (!waiter) return
    waiters.delete(message.id)
    if (message.type === 'error') {
      waiter.reject(new Error(`${message.error}: ${message.message}`))
    } else {
      waiter.resolve(message.result)
    }
  }

  function send(method, params = {}) {
    const id = ++messageId
    return new Promise((resolve, reject) => {
      waiters.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  return { send, close: () => socket.close() }
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

let client
try {
  await waitForDebugger()
  client = await connect()

  // 建立会话
  await client.send('session.new', { capabilities: {} })

  /* ---- 可选：在页面脚本执行前注入 WebSocket 探针 ---- */
  const traceIndex = args.indexOf('--trace-ws')
  if (traceIndex >= 0) {
    const source = `() => {
      window.__anWs = [];
      const Native = window.WebSocket;
      const Traced = function (url, protocols) {
        const entry = { url: String(url), events: [], readyState: -1 };
        window.__anWs.push(entry);
        const socket = protocols === undefined ? new Native(url) : new Native(url, protocols);
        for (const name of ['open', 'error', 'close']) {
          socket.addEventListener(name, () => {
            entry.events.push(name);
            entry.readyState = socket.readyState;
            entry.readyStateName = ['CONNECTING','OPEN','CLOSING','CLOSED'][socket.readyState] ?? '?';
          });
        }
        socket.addEventListener('message', () => { entry.gotMessage = true; });
        return socket;
      };
      Traced.prototype = Native.prototype;
      Traced.CONNECTING = 0; Traced.OPEN = 1; Traced.CLOSING = 2; Traced.CLOSED = 3;
      window.WebSocket = Traced;
    }`
    await client.send('script.addPreloadScript', { functionDeclaration: source })
  }

  // 拿到页面上下文
  const tree = await client.send('browsingContext.getTree', {})
  const context = tree.contexts?.[0]?.context
  if (!context) throw new Error('找不到浏览上下文')

  // 导航并等待
  await client.send('browsingContext.navigate', { context, url, wait: 'complete' })

  // 明确设置视口尺寸。
  // --window-size 只影响 OS 窗口，headless 下页面视口未必跟着变；
  // browsingContext.setViewport 才是直接控制 CSS 视口的（响应式断点就按它算）。
  if (sizeIndex >= 0) {
    await client.send('browsingContext.setViewport', {
      context,
      viewport: { width: WINDOW_W, height: WINDOW_H },
    })
    await client.send('browsingContext.navigate', { context, url, wait: 'complete' })
  }

  // 额外等待，让 WebSocket 连接与首轮 RPC 完成
  await sleep(waitMs)

  /* ---- 度量：在真实 Firefox 里量出元素间距 ---- */
  if (measureSelector) {
    const expression = `(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(measureSelector)})];
      const data = nodes.map((node, index) => {
        const rect = node.getBoundingClientRect();
        const previous = index > 0 ? nodes[index - 1].getBoundingClientRect() : null;
        return {
          index,
          tag: node.tagName.toLowerCase(),
          className: typeof node.className === 'string' ? node.className : '',
          top: Math.round(rect.top),
          height: Math.round(rect.height),
          gapAbove: previous ? Math.round(rect.top - previous.bottom) : null
        };
      });
      return JSON.stringify(data);
    })()`
    const result = await client.send('script.evaluate', {
      expression,
      target: { context },
      awaitPromise: true,
      resultOwnership: 'none',
    })
    const raw = result?.result?.value
    const value = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? [])
    console.log('=== 实测间距（真实 Firefox）===')
    for (const item of value) {
      console.log(
        `  [${item.index}] ${item.tag}.${item.className}  top=${item.top} h=${item.height}  与上一项间距=${item.gapAbove}px`,
      )
    }
  }

  /* ---- 任意表达式求值（调试用）----
   *
   * 两种传参方式：
   *   --eval "表达式字面量"        适合一两行的小探针
   *   --eval-file 脚本.js          适合多步交互流程
   *
   * 为什么要分开？因为多步 UI 流程（点按钮 → 填表单 → 等渲染 → 再点）
   * 的代码动辄上千字符，还带大量引号。在 PowerShell 里把这种字符串
   * 塞进命令行参数，转义地狱会直接把人逼疯 —— 写进文件就没有这个问题。
   */
  const evalIndex = args.indexOf('--eval')
  const evalFileIndex = args.indexOf('--eval-file')
  if (evalIndex >= 0 || evalFileIndex >= 0) {
    // --eval-file 的内容优先级更高（两者同时给时以文件为准）
    const expression = evalFileIndex >= 0
      ? readFileSync(args[evalFileIndex + 1], 'utf-8')
      : args[evalIndex + 1]
    const result = await client.send('script.evaluate', {
      expression,
      target: { context },
      awaitPromise: true,
      resultOwnership: 'none',
    })
    const raw = result?.result?.value
    console.log('=== 表达式结果 ===')
    console.log(typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2))
  }

  /* ---- WebSocket 探针结果 ---- */
  if (traceIndex >= 0) {
    const result = await client.send('script.evaluate', {
      expression: `JSON.stringify({
        pill: document.querySelector('.an-conn')?.textContent?.trim(),
        pillClass: document.querySelector('.an-conn')?.className,
        sockets: window.__anWs ?? []
      })`,
      target: { context },
      awaitPromise: true,
      resultOwnership: 'none',
    })
    console.log('=== WebSocket 探针 ===')
    console.log(result?.result?.value)
  }

  /* ---- 截图 ---- */
  const shot = await client.send('browsingContext.captureScreenshot', { context })
  writeFileSync(output, Buffer.from(shot.data, 'base64'))
  console.log(`截图已保存: ${output}`)
} catch (error) {
  console.error('失败:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  client?.close()
  firefox.kill()
  try {
    // 只有一次性 profile 才删；复用 profile 是为了让 localStorage 跨多次运行保留
    if (!fixedProfile) rmSync(profileDir, { recursive: true, force: true })
  } catch {
    // 清理失败不影响结果
  }
}
