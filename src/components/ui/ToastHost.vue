<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import AppIcon from './AppIcon.vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const { t } = useI18n()
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="toast in ui.toasts" :key="toast.id" class="toast" :class="`toast-${toast.kind}`">
        <span class="toast-text">{{ toast.message }}</span>
        <button
          type="button"
          class="toast-close"
          :aria-label="t('common.close')"
          @click="ui.dismissToast(toast.id)"
        >
          <AppIcon name="close" :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  bottom: var(--space-5);
  right: var(--space-5);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  pointer-events: none;
  max-width: min(380px, calc(100vw - var(--space-8)));
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  background: var(--bg-surface-2);
  border: 1px solid var(--border-default);
  border-left: 3px solid var(--neutral-500);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
}

.toast-ok {
  border-left-color: var(--ok-500);
}
.toast-danger {
  border-left-color: var(--danger-500);
}
.toast-warn {
  border-left-color: var(--warn-500);
}
.toast-info {
  border-left-color: var(--info-500);
}

.toast-text {
  flex: 1;
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
}

.toast-close {
  color: var(--text-tertiary);
  padding: 2px;
  border-radius: var(--radius-sm);
}

.toast-close:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(16px);
}

.toast-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

@media (max-width: 640px) {
  .toast-host {
    left: var(--space-4);
    right: var(--space-4);
    bottom: var(--space-4);
    max-width: none;
  }
}
</style>
