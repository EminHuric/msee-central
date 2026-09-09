<script setup lang="ts">
/**
 * Transient messages: saved, refused, went wrong.
 *
 * Each kind is identifiable at a glance and without relying on colour alone —
 * a tick, a warning triangle, an information mark — because a red left border
 * and a green left border are the same border to a colour-blind reader, and
 * because the message is often read out of the corner of an eye.
 *
 * The surface is opaque. An earlier version tinted it and let the page show
 * through, and the text became hard to read against whatever happened to be
 * behind it.
 */

import { useI18n } from 'vue-i18n'

import AppIcon from './AppIcon.vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const { t } = useI18n()

const ICONS: Record<string, string> = {
  ok: 'check',
  danger: 'alert',
  warn: 'alert',
  info: 'info',
}
</script>

<template>
  <div class="toast-host" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="toast in ui.toasts" :key="toast.id" class="toast" :class="`toast-${toast.kind}`">
        <span class="toast-icon">
          <AppIcon :name="ICONS[toast.kind] ?? 'info'" :size="16" />
        </span>

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
/*
 * Bottom-left on a desktop, so it never covers the primary action, which by
 * convention in this application sits top-right of a page or card.
 */
.toast-host {
  position: fixed;
  bottom: var(--space-5);
  left: var(--space-5);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  pointer-events: none;
  max-width: min(400px, calc(100vw - var(--space-8)));
}

.toast {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  /* Opaque, deliberately: see the note at the top. */
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 1px solid var(--border-strong);
  border-left: 3px solid var(--neutral-500);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
}

.toast-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-top: 1px;
  color: var(--neutral-500);
}

.toast-ok { border-left-color: var(--ok-500); }
.toast-ok .toast-icon { color: var(--ok-500); }

.toast-danger { border-left-color: var(--danger-500); }
.toast-danger .toast-icon { color: var(--danger-500); }

.toast-warn { border-left-color: var(--warn-500); }
.toast-warn .toast-icon { color: var(--warn-500); }

.toast-info { border-left-color: var(--info-500); }
.toast-info .toast-icon { color: var(--info-500); }

.toast-text {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
  /* A long message wraps rather than pushing the close button off the edge. */
  overflow-wrap: anywhere;
}

.toast-close {
  flex-shrink: 0;
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
  transform: translateY(8px);
}

.toast-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

/* On a phone it spans the width, clear of the home indicator. */
@media (max-width: 900px) {
  .toast-host {
    left: var(--space-3);
    right: var(--space-3);
    bottom: max(var(--space-3), env(safe-area-inset-bottom));
    max-width: none;
  }
}
</style>
