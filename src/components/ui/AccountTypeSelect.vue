<script setup lang="ts">
/**
 * Employee or affiliate — the first decision made about any account.
 *
 * Presented as two cards rather than a dropdown because it is not a detail:
 * it decides whether this person is inside the company at all, and it is
 * enforced by the security rules rather than by whatever role follows.
 */

import { useI18n } from 'vue-i18n'

import AppIcon from './AppIcon.vue'
import { ACCOUNT_TYPES, type AccountType } from '@/types/domain'

defineProps<{ modelValue: AccountType; disabled?: boolean }>()
defineEmits<{ 'update:modelValue': [AccountType] }>()

const { t } = useI18n()

const icons: Record<AccountType, string> = {
  employee: 'users',
  affiliate: 'building',
}
</script>

<template>
  <div class="field">
    <span class="field-label">{{ t('accountType.label') }}<span class="req">*</span></span>

    <div class="types" role="radiogroup" :aria-label="t('accountType.label')">
      <button
        v-for="type in ACCOUNT_TYPES"
        :key="type"
        type="button"
        role="radio"
        class="type"
        :class="{ 'is-active': modelValue === type }"
        :aria-checked="modelValue === type"
        :disabled="disabled"
        @click="$emit('update:modelValue', type)"
      >
        <span class="type-head">
          <AppIcon :name="icons[type]" :size="17" />
          <span class="type-name">{{ t(`accountType.${type}`) }}</span>
        </span>
        <span class="type-hint">{{ t(`accountType.${type}Hint`) }}</span>
      </button>
    </div>

    <p v-if="modelValue === 'affiliate'" class="field-hint affiliate-note">
      <AppIcon name="lock" :size="13" />
      <span>{{ t('accountType.isolationNotice') }}</span>
    </p>
  </div>
</template>

<style scoped>
.types {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: var(--space-3);
}

.type {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  text-align: left;
  background: var(--bg-inset);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}

.type:hover:not(:disabled) {
  border-color: var(--border-strong);
}

.type.is-active {
  background: var(--accent-soft-bg);
  border-color: var(--accent);
}

.type:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.type-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-primary);
}

.type.is-active .type-head {
  color: var(--text-brand);
}

.type-name {
  font-size: var(--text-md);
  font-weight: 600;
}

.type-hint {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  line-height: var(--leading-relaxed);
}

.affiliate-note {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin-top: var(--space-1);
}
</style>
