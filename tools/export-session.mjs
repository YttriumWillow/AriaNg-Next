/**
 * 导出会话历史为可读 Markdown + 原始数据打包。
 *
 * 用法：
 *   node export-session.mjs <sessionDir> <输出目录>
 *
 * 会生成：
 *   <输出目录>/
 *     README.md          各部分说明
 *     conversation.md    可读版对话记录（主文件）
 *     raw/               原始 messages.jsonl / manifest / snapshots
 *     tool-outputs/      工具输出与自动截图
 *     attachments/       用户上传的图片
 *
 * 为什么要有「可读版」？
 * messages.jsonl 是机器格式：一条消息一行 JSON，思考过程、工具调用、
 * 工具输出全混在一起。存档用 raw/ 就够了，但要**回顾**这次会话做了什么，
 * 还得有一个能直接读的 Markdown。
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const sessionDir = process.argv[2]
const outDir = process.argv[3]

if (!sessionDir || !outDir) {
  console.error('用法: node export-session.mjs <sessionDir> <输出目录>')
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(join(sessionDir, 'manifest.json'), 'utf-8'))

/* ------------------------------------------------------------------ *
 * 1. 解析消息流
 * ------------------------------------------------------------------ */

const rawLines = readFileSync(join(sessionDir, 'messages.jsonl'), 'utf-8').split('\n').filter((l) => l.trim())

const records = []
for (const line of rawLines) {
  try {
    records.push(JSON.parse(line))
  } catch {
    // 跳过写了一半的行
  }
}

/** 统计各角色数量。 */
const roleCount = new Map()
for (const rec of records) {
  const role = rec.message?.role ?? '(unknown)'
  roleCount.set(role, (roleCount.get(role) ?? 0) + 1)
}

/* ------------------------------------------------------------------ *
 * 2. 工具输出文件索引
 *
 * 关键点：tool-outputs 里的文件名就是 toolCallId（去掉 call_ 前缀和下划线），
 * 所以能把截图精确挂回它对应的那次工具调用下面。
 * ------------------------------------------------------------------ */

const toolOutputDir = join(sessionDir, 'reports', 'tool-outputs')
const toolOutputFiles = new Set()
try {
  for (const name of readdirSync(toolOutputDir)) {
    toolOutputFiles.add(name)
  }
} catch {
  // 没有就算了
}

/** 由 toolCallId 推出 tool-outputs 里的文件名（不含扩展名）。 */
function outputStem(toolCallId) {
  return String(toolCallId ?? '').replace(/^call_/, '').replace(/_/g, '')
}

/** 找出这次工具调用落盘的所有文件。 */
function filesForCall(toolCallId) {
  const stem = outputStem(toolCallId)
  const hits = []
  for (const name of toolOutputFiles) {
    if (name.startsWith(stem)) hits.push(name)
  }
  return hits.sort()
}

/* ------------------------------------------------------------------ *
 * 3. 工具调用 → 工具结果 的索引
 * ------------------------------------------------------------------ */

const resultByCallId = new Map()
for (const rec of records) {
  const m = rec.message
  if (m?.role === 'toolResult' && m.toolCallId) {
    resultByCallId.set(m.toolCallId, m)
  }
}

/* ------------------------------------------------------------------ *
 * 4. 时间格式化
 * ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, '0')

function fmtTime(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/* ------------------------------------------------------------------ *
 * 5. 生成可读 Markdown
 * ------------------------------------------------------------------ */

/** 工具结果的完整文本。 */
function resultText(m) {
  return (m.content ?? []).map((c) => c.text ?? '').join('\n')
}

/*
 * 图片是**内联 base64** 存在 content part 里的：
 *   { type: 'image', data: '<base64>', mimeType: 'image/png' }
 *
 * 用户上传的截图、以及 read 工具读回来的图，都是这个形状。
 * 所以统一在这里解码成文件，再在 Markdown 里用相对路径引用 ——
 * 否则 47 万字符的 base64 会把文档撑爆，而且大部分阅读器也不认。
 */
const mediaDir = join(outDir, 'media')
mkdirSync(mediaDir, { recursive: true })
let mediaSeq = 0

/** 抽取并落盘一个 content 数组里的所有图片，返回 Markdown 片段。 */
function extractImages(parts, altPrefix) {
  const lines = []
  for (const p of parts ?? []) {
    if (p?.type !== 'image' || !p.data) continue
    mediaSeq += 1
    const ext = (p.mimeType ?? 'image/png').split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
    const name = `img-${String(mediaSeq).padStart(3, '0')}.${ext}`
    writeFileSync(join(mediaDir, name), Buffer.from(p.data, 'base64'))
    lines.push(`![${altPrefix} ${mediaSeq}](media/${name})`)
    lines.push('')
  }
  return lines.join('\n')
}

/** 工具调用参数的可读摘要。 */
function callSummary(part) {
  const args = part.arguments ?? {}
  if (typeof args !== 'object') return String(args)
  const bits = []
  if (args.description) bits.push(String(args.description))
  // 常见的「主参数」字段
  for (const key of ['command', 'url', 'path', 'file_path', 'pattern', 'query', 'message', 'content']) {
    if (args[key]) {
      const v = String(args[key])
      bits.push(`${key}: ${v.length > 200 ? v.slice(0, 200) + '…' : v}`)
    }
  }
  if (!bits.length) {
    const keys = Object.keys(args)
    bits.push(keys.length ? `参数: ${keys.join(', ')}` : '（无参数）')
  }
  return bits.join('\n')
}

/** 把可能超长的文本收进 details 块，动态选择比正文最长反引号串更长的围栏。 */
function block(summary, body, lang = '') {
  if (!body) return ''
  let maxRun = 2
  for (const m of body.matchAll(/`+/g)) {
    if (m[0].length > maxRun) maxRun = m[0].length
  }
  const fence = '`'.repeat(maxRun + 1)
  return `<details>\n<summary>${summary}</summary>\n\n${fence}${lang}\n${body}\n${fence}\n\n</details>\n`
}

/** 围栏代码块内的内容打断连续反引号，防止破坏外层 Markdown 结构。 */
function safeFence(body) {
  return String(body ?? '').replace(/```/g, '``\u200b`')
}

/**
 * 把回复里的交付标签转成可读文本。
 *
 * 助手回复里可能出现 <deliver-assets> / <media src="本地绝对路径" />，
 * 这些路径指向当时的本机文件，导出后已经不可访问了 ——
 * 直接留着会变成一堆坏链接，不如明确写成「本地文件」。
 */
function normalizeDeliveries(text) {
  return text
    .replace(/<deliver-assets>([\s\S]*?)<\/deliver-assets>/g, (_all, inner) => {
      const files = [...inner.matchAll(/<media[^>]*src="([^"]+)"[^>]*>/g)].map((m) => m[1])
      if (!files.length) return ''
      return `> 📎 交付文件（原始路径，导出包内不含）：\n> ${files.map((f) => `\`${f}\``).join('\n> ')}\n`
    })
    .replace(/<media[^>]*src="([^"]+)"[^>]*\/?>/g, (_all, src) => `📎 \`${src}\``)
    .replace(/<\/?(?:deliver-assets|media)\b[^>]*>/g, '')
}

const md = []
const push = (s = '') => md.push(s)

const times = records.map((r) => r.message?.timestamp).filter((t) => typeof t === 'number' && Number.isFinite(t))
let startTime = times[0] ?? Date.now()
let endTime = times[0] ?? Date.now()
for (const ts of times) {
  if (ts < startTime) startTime = ts
  if (ts > endTime) endTime = ts
}

push('# 会话记录')
push()
push('> 由 `tools/export-session.mjs` 从本地会话存档自动生成。')
push()
push('| 项 | 值 |')
push('|---|---|')
push(`| 会话 ID | \`${manifest.sessionId}\` |`)
push(`| 开始 | ${fmtTime(startTime)} |`)
push(`| 结束 | ${fmtTime(endTime)} |`)
push(`| 消息总数 | ${records.length} |`)
push(`| 原始数据 | \`raw/messages.jsonl\`（${(statSync(join(sessionDir, 'messages.jsonl')).size / 1024 / 1024).toFixed(1)} MB） |`)
push()
push('## 消息构成')
push()
push('| 类型 | 数量 |')
push('|---|---|')
for (const [role, n] of [...roleCount.entries()].sort((a, b) => b[1] - a[1])) {
  push(`| ${role} | ${n} |`)
}
push()
push('---')
push()

/* ---- 压缩摘要（如果有）放在最前面，它是整段会话的"目录" ---- */
const compaction = records.find((r) => r.message?.role === 'compactionSummary')
if (compaction) {
  push('## 压缩摘要')
  push()
  push('> 上下文过长时，运行时会把之前的对话压缩成这份摘要。继续往下读之前，先看它。')
  push()
  push(block('展开摘要', safeFence(compaction.message.summary)))
  push('---')
  push()
}

/* ---- 逐条消息 ---- */

let turnIndex = 0
let currentTurn = null
const turnToc = []

for (const rec of records) {
  const m = rec.message ?? {}
  const role = m.role
  const ts = m.timestamp

  if (role === 'compactionSummary') continue

  // 切换 turn（turn_id 以 :compaction 结尾的算同一个大回合）
  if (rec.turn_id !== currentTurn) {
    currentTurn = rec.turn_id
    turnIndex++
  }

  if (role === 'custom') {
    // 系统提醒之类，display=false 的不显示
    if (m.display === false) continue
    push(block(`系统提示 · ${fmtTime(ts)}`, safeFence(String(m.content ?? ''))))
    continue
  }

  if (role === 'user') {
    const parts = m.content ?? []
    const text = parts.map((c) => c.text ?? '').join('\n').trim()
    const images = extractImages(parts, '用户上传')
    if (!text && !images) continue
    push(`### 👤 用户 · ${fmtTime(ts)}`)
    push()
    if (text) push(text)
    if (text && images) push()
    push(images.trimEnd())
    push()
    turnToc.push({ index: turnIndex, time: fmtTime(ts), first: (text || '[图片]').split('\n')[0].slice(0, 60) })
    continue
  }

  if (role === 'assistant') {
    const parts = m.content ?? []
    const texts = parts.filter((p) => p.type === 'text').map((p) => p.text ?? '').filter(Boolean)
    const thinking = parts.filter((p) => p.type === 'thinking').map((p) => p.thinking ?? '').filter(Boolean)
    const calls = parts.filter((p) => p.type === 'toolCall')

    if (thinking.length) {
      push(block(`💭 思考 · ${fmtTime(ts)}`, safeFence(thinking.join('\n\n---\n\n'))))
    }

    for (const part of calls) {
      const res = resultByCallId.get(part.id)
      const files = filesForCall(part.id)

      push(`<details>`)
      push(`<summary>🔧 工具调用 · <code>${part.name}</code></summary>`)
      push()
      push('```')
      push(safeFence(callSummary(part)))
      push('```')
      push()

      if (res) {
        const text = resultText(res)
        const label = res.isError ? `结果（错误）· ${res.toolName}` : `结果 · ${res.toolName}`
        push(block(label, safeFence(text.slice(0, 6000)), ''))
        if (text.length > 6000) {
          push(`> 输出过长，已截断（完整内容见 \`raw/messages.jsonl\` 与 \`tool-outputs/\`）。`)
          push()
        }
        // 这次调用带回来的图片（read 工具读图最常见）
        const imgs = extractImages(res.content, `工具 ${part.name} 输出`)
        if (imgs) {
          push(imgs)
        }
      }

      // 自动截图与落盘文件
      const imgs = files.filter((f) => f.toLowerCase().endsWith('.png'))
      const others = files.filter((f) => !f.toLowerCase().endsWith('.png'))
      if (others.length) {
        push(`落盘文件：${others.map((f) => `\`tool-outputs/${f}\``).join('、')}`)
        push()
      }
      for (const img of imgs) {
        push(`![${part.name} 输出](tool-outputs/${img})`)
        push()
      }

      push('</details>')
      push()
    }

    if (texts.length) {
      push(`### 🤖 助手 · ${fmtTime(ts)}`)
      push()
      push(normalizeDeliveries(texts.join('\n\n')))
      push()
    }
    continue
  }

  if (role === 'toolResult') {
    // 已经在 assistant 的 toolCall 里输出了，这里跳过避免重复
    continue
  }
}

// 目录
push('---')
push()
push('## 对话轮次索引')
push()
push('| # | 时间 | 用户首句 |')
push('|---|---|---|')
for (const t of turnToc) {
  push(`| ${t.index} | ${t.time} | ${t.first.replace(/\|/g, '\\|')} |`)
}
push()

const conversationMd = md.join('\n')
writeFileSync(join(outDir, 'conversation.md'), conversationMd, 'utf-8')

/* ------------------------------------------------------------------ *
 * 6. 复制原始数据
 * ------------------------------------------------------------------ */

mkdirSync(join(outDir, 'raw'), { recursive: true })
for (const name of ['messages.jsonl', 'manifest.json', 'llm-call.json']) {
  try {
    cpSync(join(sessionDir, name), join(outDir, 'raw', name))
  } catch {
    // 缺了就跳过
  }
}
try {
  cpSync(join(sessionDir, 'snapshots'), join(outDir, 'raw', 'snapshots'), { recursive: true })
} catch {
  // 同上
}

// 工具输出
try {
  cpSync(toolOutputDir, join(outDir, 'tool-outputs'), { recursive: true })
} catch {
  // 同上
}

/* ------------------------------------------------------------------ *
 * 7. 用户上传的原始附件
 *
 * assets/ 目录里是用户发过来的原始文件（带原始文件名）。
 * 会话记录里已经有内联的 base64 副本，但原始文件保留了
 * 真实扩展名和元数据，值得一并带走。
 * ------------------------------------------------------------------ */

/*
 * 用户上传的原始文件放在运行时的 assets 目录里。
 *
 * 路径不写死 —— 写死会把本机用户名带进仓库。
 * 默认从用户主目录推导，也可以用环境变量覆盖。
 */
const assetsRoot = process.env.MIMAX_ASSETS ?? join(homedir(), '.minimax', 'v2', 'assets')
const attachDir = join(outDir, 'attachments')
let attachCount = 0
try {
  mkdirSync(attachDir, { recursive: true })
  const stack = [assetsRoot]
  while (stack.length) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (/\.(png|jpe?g|gif|webp)$/i.test(entry.name)) {
        // 只收本会话时间范围内的（会话 2026-11-13 ~ 2026-11-23）
        const mtime = statSync(full).mtimeMs
        if (mtime >= startTime - 86400000 && mtime <= endTime + 86400000) {
          cpSync(full, join(attachDir, entry.name))
          attachCount++
        }
      }
    }
  }
} catch {
  // 没有就跳过
}

/* ------------------------------------------------------------------ *
 * 8. README
 * ------------------------------------------------------------------ */

const readme = `# 会话历史导出

由 \`tools/export-session.mjs\` 从本地会话存档生成。

## 目录结构

| 路径 | 内容 |
|---|---|
| \`conversation.md\` | **可读版对话记录** —— 从上到下就是这次会话的全过程。思考过程、工具调用、工具输出都折叠在 \`<details>\` 里，点开可看 |
| \`media/\` | 会话中出现过的图片（${mediaSeq} 张），按出现顺序编号 |
| \`attachments/\` | 用户上传的原始文件（${attachCount} 个） |
| \`tool-outputs/\` | 工具输出落盘文件（超长输出、读取的文本文件等） |
| \`raw/messages.jsonl\` | **原始消息流**，一条消息一行 JSON，无损 |
| \`raw/manifest.json\` | 会话元数据（ID、路径等） |
| \`raw/llm-call.json\` | 模型调用记录 |
| \`raw/snapshots/\` | 上下文压缩前的完整历史快照 |

## 怎么读

1. 先读 \`conversation.md\` 开头的**压缩摘要** —— 它是整段会话的浓缩版
2. 再按「对话轮次索引」跳到感兴趣的轮次
3. 需要逐字原文时，去 \`raw/messages.jsonl\`

## 注意

- 交付物标签（\`📎 本地文件：...\`）里的路径是**当时的本机绝对路径**，
  导出包内不含这些文件，仅作记录
- 工具输出在可读版里截断到 6000 字符，完整内容见 \`raw/\` 与 \`tool-outputs/\`
`
writeFileSync(join(outDir, 'README.md'), readme, 'utf-8')

console.log('conversation.md 已生成:', (conversationMd.length / 1024).toFixed(0), 'KB')
console.log('消息统计:', [...roleCount.entries()].map(([r, n]) => `${r}=${n}`).join(' '))
console.log('用户轮次:', turnToc.length)
console.log('导出图片:', mediaSeq, '张 | 附件:', attachCount, '个')
