<script setup lang="ts">
import EmptyState from '@/ui/components/EmptyState.vue'
import { useI18n } from '@/i18n'

const { t } = useI18n()
</script>

<template>
  <EmptyState title="404" description="这个页面不存在" icon="alert">
    <RouterLink class="an-btn an-btn--primary" to="/dashboard">{{ t('nav.dashboard') }}</RouterLink>
  </EmptyState>
</template>
