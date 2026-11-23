<script setup lang="ts">
/**
 * 对话框。
 *
 * 用 <Teleport to="body"> 把它挂到 body 下 —— 这样它就不会被父容器的
 * overflow 或 stacking context 影响（这正是「详情抽屉」要解决的问题）。
 */
import { onMounted, onUnmounted } from 'vue'
import AppIcon from '@/ui/components/AppIcon.vue'

const props = defineProps<{
  open: boolean
  title: string
  /** 是否使用更宽的版式 */
  wide?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

/** Esc 关闭对话框 —— 键盘用户的基本预期（仅在打开态响应）。 */
function onKeydown(event: KeyboardEvent): void {
  if (props.open && event.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="an-dialog__scrim" @click.self="emit('close')">
      <div class="an-dialog" :class="{ 'an-dialog--wide': wide }" role="dialog" aria-modal="true">
        <div class="an-dialog__head">
          <div class="an-dialog__title">{{ title }}</div>
          <button class="an-btn an-btn--ghost an-btn--icon" type="button" @click="emit('close')">
            <AppIcon class="an-btn__icon" name="close" :size="15" />
          </button>
        </div>
        <div class="an-dialog__body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="an-dialog__foot">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
