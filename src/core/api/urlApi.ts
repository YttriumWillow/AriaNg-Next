/**
 * URL 命令行 API。
 *
 * AriaNg 支持用链接直接添加任务，例如：
 *   http://面板地址/#/tasks?addUrl=https://example.com/file.iso
 *
 * 这个能力对「把下载任务丢给 NAS」这类场景非常顺手，本项目继续保留，
 * 并针对 aria2-next 扩展了磁力链接的入口。
 *
 * ⚠️ 因为用的是 hash 路由，查询参数写在 # 之后，而不是 ? 之后。
 */

export type UrlApiAction = 'addUrl' | 'addMagnet'

export interface UrlApiRequest {
  action: UrlApiAction
  value: string
}

/** 支持的查询参数名。 */
const SUPPORTED: Record<string, UrlApiAction> = {
  addUrl: 'addUrl',
  addMagnet: 'addMagnet',
}

/**
 * 解析查询字符串，返回要执行的动作列表。
 *
 * @param search `?addUrl=xxx&addMagnet=yyy` 或带或不带前导问号都可以
 */
export function parseUrlApi(search: string): UrlApiRequest[] {
  const requests: UrlApiRequest[] = []
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)

  for (const [key, value] of params.entries()) {
    const action = SUPPORTED[key]
    if (!action) continue
    const trimmed = value.trim()
    if (trimmed) requests.push({ action, value: trimmed })
  }

  return requests
}

/** 把动作列表还原成查询字符串（用于清空 URL 上的参数）。 */
export function buildUrlApi(requests: UrlApiRequest[]): string {
  if (requests.length === 0) return ''
  const params = new URLSearchParams()
  for (const request of requests) {
    params.set(request.action, request.value)
  }
  return `?${params.toString()}`
}
