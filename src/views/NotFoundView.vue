<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'

const { t } = useI18n()
</script>

<template>
  <div class="notfound">
    <div class="card notfound-card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="search" :size="20" /></span>
        <p class="empty-title">{{ t('notFound.title') }}</p>
        <p class="empty-text">{{ t('notFound.text') }}</p>
        <RouterLink to="/" class="btn btn-secondary">{{ t('notFound.action') }}</RouterLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notfound {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: var(--space-6);
  background: var(--bg-base);
}

.notfound-card {
  width: 100%;
  max-width: 460px;
}
</style>
