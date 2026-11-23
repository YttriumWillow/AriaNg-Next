<script setup lang="ts">
/**
 * 外观与自定义 CSS 页。
 *
 * 这是本项目的核心卖点。三个层次：
 *   1. 主题预设（亮 / 暗 / 毛玻璃）
 *   2. 设计令牌（可视化调节，写回 CSS 变量）
 *   3. 自定义 CSS（任意规则，永远覆盖组件样式）
 */
import { computed, ref, watch } from 'vue'
import AppIcon from '@/ui/components/AppIcon.vue'
import { useAppearanceStore } from '@/stores/appearance'
import { useToastStore } from '@/stores/toast'
import { useI18n } from '@/i18n'
import { EDITABLE_TOKENS, THEMES, type ThemeName } from '@/core/theme/theme'
import type { CssScope } from '@/core/css/engine'

const appearance = useAppearanceStore()
const toast = useToastStore()
const { t } = useI18n()

/** 编辑中的 CSS 文本（与 store 里的同步，但本地编辑手感更好）。 */
const cssDraft = ref(appearance.settings.customCss)

watch(
  () => appearance.settings.customCss,
  (val) => {
    if (cssDraft.value !== val) cssDraft.value = val
  },
)

/** 令牌按分组归类。 */
const tokenGroups = computed(() => {
  const groups = new Map<string, typeof EDITABLE_TOKENS>()
  for (const token of EDITABLE_TOKENS) {
    const list = groups.get(token.group) ?? []
    list.push(token)
    groups.set(token.group, list)
  }
  return [...groups.entries()]
})

/** 把 rgb()/rgba()/#rgb/#rrggbbaa 归一化为 <input type="color"> 要求的 7 位 #rrggbb。 */
function normalizeColorHex(color: string, fallback: string): string {
  const trimmed = color.trim()
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase()
  if (/^#[0-9a-f]{8}$/i.test(trimmed)) return trimmed.slice(0, 7).toLowerCase()
  const shortHex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(trimmed)
  if (shortHex) {
    return `#${shortHex[1]}${shortHex[1]}${shortHex[2]}${shortHex[2]}${shortHex[3]}${shortHex[3]}`.toLowerCase()
  }
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed)
  if (match) {
    const hex = [match[1], match[2], match[3]]
      .map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0'))
      .join('')
    return `#${hex}`
  }
  return fallback
}

/** 当前令牌值（用户覆盖优先；否则按当前生效主题读取 DOM 上的真实计算值）。 */
function tokenValue(name: string, fallback: string, type?: string): string {
  const overridden = appearance.settings.tokenOverrides[name]
  if (overridden !== undefined) {
    return type === 'color' ? normalizeColorHex(overridden, fallback) : overridden
  }
  // 读取 resolvedTheme 与 density，确保主题或密度切换时自动触发回显刷新
  void appearance.resolvedTheme
  void appearance.settings.density
  if (typeof document !== 'undefined') {
    const live = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (live) return type === 'color' ? normalizeColorHex(live, fallback) : live
  }
  return fallback
}

/** 令牌是否被用户改过。 */
function isOverridden(name: string): boolean {
  return appearance.settings.tokenOverrides[name] !== undefined
}

/** 修改令牌。 */
function onTokenChange(name: string, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  appearance.setToken(name, value)
}

/** 颜色令牌用取色器，尺寸令牌用文本框。 */
function onColorChange(name: string, event: Event): void {
  appearance.setToken(name, (event.target as HTMLInputElement).value)
}

function setTheme(theme: ThemeName): void {
  appearance.setTheme(theme)
}

function setScope(scope: CssScope): void {
  appearance.setCssScope(scope)
}

/** CSS 文本变化 -> 实时预览。 */
function onCssInput(event: Event): void {
  cssDraft.value = (event.target as HTMLTextAreaElement).value
  appearance.setCustomCss(cssDraft.value)
}

/** 导出 CSS：令牌覆盖 + 用户 CSS 拼成一份可直接使用的文件。 */
function exportCss(): void {
  const tokenLines = Object.entries(appearance.settings.tokenOverrides)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')

  const parts: string[] = ['/* AriaNg-Next 自定义样式导出 */', '']
  if (tokenLines) {
    // 容器作用域下 @scope (.an-app) 内需匹配 .an-app 自身；全局作用域用 :root
    const selector = appearance.settings.cssScope === 'container' ? '.an-app' : ':root'
    parts.push(`${selector} {`, tokenLines, '}', '')
  }
  if (appearance.settings.customCss.trim()) {
    parts.push(appearance.settings.customCss.trim())
  }

  const blob = new Blob([parts.join('\n')], { type: 'text/css;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'ariang-next-custom.css'
  link.click()
  URL.revokeObjectURL(url)
  toast.success(t('toast.cssExported'))
}

/** 导入 CSS 文件：提取顶层令牌覆盖并校验剩余自定义 CSS。 */
function importCss(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = () => {
    const raw = String(reader.result)
    const tokenBlockPattern = /(?:^|\n)\s*(?::root|\.an-app)\s*\{([^}]*)\}/g
    const extractedTokens: Record<string, string> = {}
    const stripped = raw
      .replace('/* AriaNg-Next 自定义样式导出 */', '')
      .replace(tokenBlockPattern, (full, body: string) => {
        const lines = body
          .split(';')
          .map((line) => line.trim())
          .filter(Boolean)
        const allAreTokens =
          lines.length > 0 && lines.every((line) => /^--an-[a-zA-Z0-9_-]+\s*:\s*.+$/.test(line))
        if (!allAreTokens) return full
        for (const line of lines) {
          const colon = line.indexOf(':')
          extractedTokens[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
        }
        return ''
      })
      .trim()

    for (const [name, value] of Object.entries(extractedTokens)) {
      appearance.setToken(name, value)
    }

    cssDraft.value = stripped
    appearance.setCustomCss(stripped)
    if (appearance.cssDiagnostic) {
      toast.error(appearance.cssDiagnostic.message)
    } else {
      toast.success(t('toast.cssImported'))
    }
  }
  reader.readAsText(file)
  // 清空 file input，确保再次选择同一个文件仍会触发 change
  input.value = ''
}

function resetCss(): void {
  cssDraft.value = ''
  appearance.resetCustomCss()
}
</script>

<template>
  <div class="an-page">
    <div class="an-page__head">
      <div>
        <h1 class="an-page__title">{{ t('appearance.title') }}</h1>
        <p class="an-page__desc">{{ t('appearance.themeHint') }}</p>
      </div>
    </div>

    <!-- 主题预设 -->
    <div class="an-card">
      <div class="an-card__head">
        <span class="an-card__title">{{ t('appearance.theme') }}</span>
        <label class="an-switch" :class="{ 'an-switch--on': appearance.settings.followSystem }">
          <input
            class="an-switch__input"
            type="checkbox"
            :checked="appearance.settings.followSystem"
            @change="appearance.setFollowSystem(($event.target as HTMLInputElement).checked)"
          />
          <span class="an-switch__track" />
          <span>{{ t('appearance.followSystem') }}</span>
        </label>
      </div>
      <div class="an-card__body">
        <div class="an-theme-grid">
          <button
            v-for="theme in THEMES"
            :key="theme.name"
            class="an-theme-card"
            :class="{ 'an-theme-card--active': appearance.resolvedTheme === theme.name }"
            type="button"
            @click="setTheme(theme.name)"
          >
            <div class="an-theme-card__preview" :class="`an-theme-card__preview--${theme.name}`">
              <div class="an-theme-card__bar" />
              <div class="an-theme-card__body">
                <div class="an-theme-card__side" />
                <div class="an-theme-card__main" />
              </div>
            </div>
            <div class="an-theme-card__meta">
              <div class="an-theme-card__name">{{ theme.label }}</div>
              <div class="an-theme-card__desc">{{ theme.description }}</div>
            </div>
          </button>
        </div>

        <div style="display: flex; gap: 16px; margin-top: 16px; flex-wrap: wrap; align-items: center">
          <div class="an-field" style="min-width: 180px">
            <label class="an-field__label">{{ t('appearance.density') }}</label>
            <select
              class="an-select"
              :value="appearance.settings.density"
              @change="appearance.setDensity(($event.target as HTMLSelectElement).value as 'comfortable' | 'compact')"
            >
              <option value="comfortable">{{ t('appearance.densityComfortable') }}</option>
              <option value="compact">{{ t('appearance.densityCompact') }}</option>
            </select>
          </div>
          <div v-if="appearance.resolvedTheme === 'glass'" class="an-field" style="flex: 1; min-width: 240px">
            <label class="an-field__label">{{ t('appearance.glassBackdrop') }}</label>
            <input
              class="an-input"
              :value="appearance.settings.glassBackdrop"
              :placeholder="t('appearance.glassBackdropHint')"
              @change="appearance.setGlassBackdrop(($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 设计令牌 -->
    <div class="an-card">
      <div class="an-card__head">
        <span class="an-card__title">{{ t('appearance.tokens') }}</span>
        <button class="an-btn an-btn--sm" type="button" @click="appearance.resetTokens()">{{ t('common.reset') }}</button>
      </div>
      <div class="an-card__body">
        <p class="an-field__hint" style="margin: 0 0 14px">{{ t('appearance.tokensHint') }}</p>

        <div v-for="[group, tokens] in tokenGroups" :key="group" style="margin-bottom: 16px">
          <div class="an-card__title" style="margin-bottom: 8px">{{ group }}</div>
          <div style="display: grid; gap: 8px">
            <div v-for="token in tokens" :key="token.name" class="an-token-row">
              <span class="an-token-row__label">{{ token.label }}</span>
              <span v-if="token.type === 'color'" class="an-token-row__control">
                <span class="an-token-row__swatch">
                  <input
                    type="color"
                    :value="tokenValue(token.name, token.defaultValue, token.type)"
                    @input="onColorChange(token.name, $event)"
                  />
                </span>
                <button
                  v-if="isOverridden(token.name)"
                  class="an-btn an-btn--sm an-btn--ghost an-btn--icon"
                  type="button"
                  :title="t('appearance.resetToken')"
                  @click="appearance.resetToken(token.name)"
                >
                  <AppIcon class="an-btn__icon" name="refresh" :size="12" />
                </button>
              </span>
              <span v-else class="an-token-row__control">
                <input
                  class="an-input"
                  :value="tokenValue(token.name, token.defaultValue, token.type)"
                  @change="onTokenChange(token.name, $event)"
                />
                <button
                  v-if="isOverridden(token.name)"
                  class="an-btn an-btn--sm an-btn--ghost an-btn--icon"
                  type="button"
                  :title="t('appearance.resetToken')"
                  @click="appearance.resetToken(token.name)"
                >
                  <AppIcon class="an-btn__icon" name="refresh" :size="12" />
                </button>
              </span>
              <span class="an-token-row__name">{{ token.name }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 自定义 CSS -->
    <div class="an-card">
      <div class="an-card__head">
        <span class="an-card__title">{{ t('appearance.customCss') }}</span>
        <div style="display: flex; gap: 6px; align-items: center">
          <div class="an-seg">
            <button
              class="an-seg__item"
              :class="{ 'an-seg__item--active': appearance.settings.cssScope === 'container' }"
              type="button"
              @click="setScope('container')"
            >
              {{ t('appearance.scopeContainer') }}
            </button>
            <button
              class="an-seg__item"
              :class="{ 'an-seg__item--active': appearance.settings.cssScope === 'global' }"
              type="button"
              @click="setScope('global')"
            >
              {{ t('appearance.scopeGlobal') }}
            </button>
          </div>
          <button class="an-btn an-btn--sm" type="button" @click="resetCss">{{ t('appearance.resetCss') }}</button>
          <button class="an-btn an-btn--sm" type="button" @click="exportCss">{{ t('appearance.exportCss') }}</button>
          <label class="an-btn an-btn--sm" style="cursor: pointer">
            {{ t('appearance.importCss') }}
            <input type="file" accept=".css,text/css" style="display: none" @change="importCss" />
          </label>
        </div>
      </div>
      <div class="an-card__body">
        <p class="an-field__hint" style="margin: 0 0 10px">{{ t('appearance.customCssHint') }}</p>

        <textarea
          class="an-code"
          :class="{ 'an-code--error': appearance.cssDiagnostic }"
          spellcheck="false"
          :value="cssDraft"
          @input="onCssInput"
          placeholder="/* 例如 */&#10;.an-card { border-radius: 20px; }&#10;.an-progress__fill { background: linear-gradient(90deg, #f59e0b, #ef4444); }"
        />

        <div v-if="appearance.cssDiagnostic" class="an-code-error" style="margin-top: 8px">
          <AppIcon name="alert" :size="14" style="flex: 0 0 14px; margin-top: 1px" />
          <span>
            {{ appearance.cssDiagnostic.message }}
            <template v-if="appearance.cssDiagnostic.line">（{{ t('appearance.cssError') }} · 第 {{ appearance.cssDiagnostic.line }} 行）</template>
          </span>
        </div>

        <div v-if="appearance.settings.cssScope === 'container' && !appearance.canScope" class="an-note an-note--warn" style="margin-top: 10px">
          {{ t('appearance.scopeUnsupported') }}
        </div>

        <!-- 层叠顺序说明 -->
        <div class="an-note" style="margin-top: 12px">
          <AppIcon name="layers" :size="14" style="flex: 0 0 14px; margin-top: 1px" />
          <span>
            {{ t('appearance.layerOrderHint') }}
            <code>@layer reset, tokens, components, user</code>
          </span>
        </div>
      </div>
    </div>

    <button class="an-btn an-btn--danger" type="button" @click="appearance.resetAll()">
      {{ t('appearance.resetAll') }}
    </button>
  </div>
</template>
