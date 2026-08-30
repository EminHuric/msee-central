<script setup lang="ts">
/**
 * Who may see one personal field.
 *
 * Changing this does not toggle a flag — it moves the value into a different
 * document with different security rules. See src/api/employees.ts.
 */

import { useI18n } from 'vue-i18n'

import AppIcon from './AppIcon.vue'
import { VISIBILITY_LEVELS, type Visibility } from '@/types/domain'

defineProps<{ modelValue: Visibility; disabled?: boolean }>()
defineEmits<{ 'update:modelValue': [Visibility] }>()

const { t } = useI18n()

const icons: Record<Visibility, string> = {
  everyone: 'users',
  management: 'shield',
  private: 'lock',
}
</script>

<template>
  <div class="vis" role="radiogroup" :aria-label="t('visibility.label')">
    <button
      v-for="level in VISIBILITY_LEVELS"
      :key="level"
      type="button"
      role="radio"
      class="vis-option"
      :class="{ 'is-active': modelValue === level }"
      :aria-checked="modelValue === level"
      :disabled="disabled"
      :title="t(`visibility.${level}Hint`)"
      @click="$emit('update:modelValue', level)"
    >
      <AppIcon :name="icons[level]" :size="14" />
      <span>{{ t(`visibility.${level}`) }}</span>
    </button>
  </div>
</template>

<style scoped>
.vis {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  flex-wrap: wrap;
}

.vis-option {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-3);
  height: 28px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: 550;
  color: var(--text-tertiary);
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.vis-option:hover:not(:disabled) {
  color: var(--text-secondary);
}

.vis-option.is-active {
  background: var(--bg-surface-3);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

.vis-option:disabled {
  cursor: not-allowed;
}
</style>
