<script setup lang="ts">
/**
 * 提示条容器。
 *
 * 用 fixed 定位挂在右下角，不占据文档流，不会挤动页面布局。
 */
import { useToastStore } from '@/stores/toast'
import AppIcon from '@/ui/components/AppIcon.vue'

const toast = useToastStore()
</script>

<template>
  <div class="an-toasts" role="status" aria-live="polite">
    <div
      v-for="item in toast.toasts"
      :key="item.id"
      class="an-toast"
      :class="{
        'an-toast--error': item.kind === 'error',
        'an-toast--success': item.kind === 'success',
      }"
      @click="toast.dismiss(item.id)"
    >
      <AppIcon
        :name="item.kind === 'error' ? 'alert' : item.kind === 'success' ? 'check' : 'info'"
        :size="15"
        style="flex: 0 0 15px; margin-top: 1px"
      />
      <span>{{ item.message }}</span>
    </div>
  </div>
</template>
