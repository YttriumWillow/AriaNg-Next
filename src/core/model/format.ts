/**
 * 显示格式化工具。
 *
 * 全部是纯函数，没有副作用 —— 这类代码最适合写成单元测试，
 * 也是最容易「写对了但看着不对」的地方（单位、进位、空值）。
 */

/** 字节数转成人类可读的字符串。 */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(exponent === 0 ? 0 : fractionDigits)} ${units[exponent]}`
}

/** 速度。默认用 /s 后缀。 */
export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 B/s'
  return `${formatBytes(bytesPerSecond)}/s`
}

/** 百分比。progress 是 0~1。 */
export function formatPercent(progress: number, fractionDigits = 0): string {
  if (!Number.isFinite(progress)) return '0%'
  return `${(progress * 100).toFixed(fractionDigits)}%`
}

/**
 * 剩余时间（秒）转成「1h 02m 03s」这种形态。
 * null / 负数表示未知，返回 '—'。
 */
export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = Math.floor(seconds % 60)
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${String(rest).padStart(2, '0')}s`
  return `${rest}s`
}

/** 毫秒时长 -> 「1h 02m 03s」。用于媒体任务的呈现时长。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  return formatEta(Math.round(ms / 1000))
}

/** 纯数字加千分位。 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return value.toLocaleString('en-US')
}

/**
 * 把字节数拆成「已下载 / 总量」这类展示。
 * 总量为 0 时只显示已下载（媒体任务的常见情况）。
 */
export function formatSizePair(completed: number, total: number): string {
  if (total > 0) return `${formatBytes(completed)} / ${formatBytes(total)}`
  return formatBytes(completed)
}

/**
 * 把相对时间渲染成「刚刚 / 3 分钟前 / 2 小时前」。
 */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 10) return '刚刚'
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(timestamp).toLocaleDateString()
}

/**
 * 协议徽章的显示名与配色键。
 */
export function protocolLabel(protocol: string): string {
  switch (protocol) {
    case 'bittorrent':
      return 'BT'
    case 'ed2k':
      return 'ED2K'
    case 'hls':
      return 'HLS'
    case 'dash':
      return 'DASH'
    case 'metalink':
      return 'Metalink'
    case 'sftp':
      return 'SFTP'
    case 'http':
      return 'HTTP'
    default:
      return '未知'
  }
}
