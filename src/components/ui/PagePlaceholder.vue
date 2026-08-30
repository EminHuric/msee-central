<script setup lang="ts">
/** Temporary body for screens whose stage has not been built yet. */

import { useI18n } from 'vue-i18n'

import AppIcon from './AppIcon.vue'

defineProps<{ titleKey: string; subtitle?: string }>()

const { t } = useI18n()
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t(titleKey) }}</h1>
        <p v-if="subtitle" class="page-subtitle">{{ subtitle }}</p>
      </div>
    </header>

    <div class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="clock" :size="20" /></span>
        <p class="empty-title">{{ t('soon.title') }}</p>
        <p class="empty-text">{{ t('soon.text') }}</p>
      </div>
    </div>
  </div>
</template>
