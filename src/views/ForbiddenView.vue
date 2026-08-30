<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'

const { t } = useI18n()
</script>

<template>
  <div class="page">
    <div class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="lock" :size="20" /></span>
        <p class="empty-title">{{ t('forbidden.title') }}</p>
        <p class="empty-text">{{ t('forbidden.text') }}</p>
        <RouterLink to="/" class="btn btn-secondary">{{ t('forbidden.action') }}</RouterLink>
      </div>
    </div>
  </div>
</template>
