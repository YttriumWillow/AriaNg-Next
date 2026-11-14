/**
 * 主机显示名的统一处理。
 *
 * 为什么需要它？
 *
 * 侧栏、设置页、仪表盘三处都要显示主机名字。如果每处都写一遍
 * 「如果是默认主机就翻译一下」的判断，很快会漏掉一处 ——
 * 然后英文界面里就会冒出一行没翻译的中文。
 *
 * 更麻烦的是：默认主机的名字「本机 aria2-next」是**内置的中文**，
 * 它来自 DEFAULT_HOST 常量。用户在中文界面下看不出问题，
 * 一切到英文就露馅了。
 *
 * 解决方式：默认主机（id 为 default）的名字走 i18n，
 * 用户自己起的名字原样显示 —— 用户命名不该被翻译。
 */
import { useI18n } from '@/i18n'
import type { HostConfig } from '@/stores/hosts'

export function useHostName() {
  const { t } = useI18n()

  /** 取主机的显示名。 */
  function hostName(host: HostConfig | null | undefined): string {
    if (!host) return '—'
    if (host.id === 'default') return t('host.defaultName')
    return host.name
  }

  return { hostName }
}
