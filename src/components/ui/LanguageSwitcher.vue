<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { SUPPORTED_LOCALES, type AppLocale } from '@/i18n'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const { t } = useI18n()

const labels: Record<AppLocale, string> = {
  sr: 'SR',
  en: 'EN',
}
</script>

<template>
  <div class="lang" role="group" :aria-label="t('language.switch')">
    <button
      v-for="code in SUPPORTED_LOCALES"
      :key="code"
      type="button"
      class="lang-option"
      :class="{ 'is-active': ui.locale === code }"
      :aria-pressed="ui.locale === code"
      @click="ui.changeLocale(code)"
    >
      {{ labels[code] }}
    </button>
  </div>
</template>

<style scoped>
.lang {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.lang-option {
  padding: 0 var(--space-3);
  height: 26px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: 650;
  letter-spacing: 0.03em;
  color: var(--text-tertiary);
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.lang-option:hover {
  color: var(--text-secondary);
}

.lang-option.is-active {
  background: var(--bg-surface-3);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}
</style>
