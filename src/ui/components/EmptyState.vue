<script setup lang="ts">
/** 空状态。明确告诉用户「为什么空」和「下一步做什么」，而不是只画个空白。 */
import AppIcon from '@/ui/components/AppIcon.vue'

withDefaults(
  defineProps<{
    title: string
    description?: string
    icon?: string
  }>(),
  { description: '', icon: 'info' },
)
</script>

<template>
  <div class="an-empty">
    <AppIcon :name="icon" :size="26" style="opacity: 0.45" />
    <div class="an-empty__title">{{ title }}</div>
    <div v-if="description" class="an-empty__desc">{{ description }}</div>
    <slot />
  </div>
</template>
