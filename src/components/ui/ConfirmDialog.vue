<script setup lang="ts">
/**
 * Confirmation for actions that are hard to undo.
 *
 * Built on <dialog>, so the browser handles focus trapping, Escape and the
 * top layer rather than us reimplementing them badly.
 */

import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    message: string
    confirmLabel?: string
    danger?: boolean
    busy?: boolean
  }>(),
  { danger: false, busy: false },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const { t } = useI18n()
const dialog = ref<HTMLDialogElement | null>(null)

watch(
  () => props.open,
  (open) => {
    const el = dialog.value
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  },
)

/** Escape and the backdrop both count as cancelling. */
function onClose(): void {
  if (props.open) emit('cancel')
}

function onBackdropClick(event: MouseEvent): void {
  if (event.target === dialog.value && !props.busy) emit('cancel')
}

onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <dialog ref="dialog" class="dialog" @close="onClose" @click="onBackdropClick">
    <div class="dialog-body">
      <h2 class="dialog-title">{{ title }}</h2>
      <p class="dialog-message">{{ message }}</p>
    </div>

    <div class="dialog-actions">
      <button type="button" class="btn btn-secondary" :disabled="busy" @click="emit('cancel')">
        {{ t('common.cancel') }}
      </button>
      <button
        type="button"
        class="btn"
        :class="danger ? 'btn-danger' : 'btn-primary'"
        :disabled="busy"
        @click="emit('confirm')"
      >
        <span v-if="busy" class="spinner" />
        {{ confirmLabel ?? t('common.confirm') }}
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.dialog {
  width: min(420px, calc(100vw - var(--space-8)));
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
}

.dialog::backdrop {
  background: var(--scrim);
  backdrop-filter: blur(2px);
}

.dialog-body {
  padding: var(--space-6);
}

.dialog-title {
  font-size: var(--text-lg);
  font-weight: 650;
}

.dialog-message {
  margin-top: var(--space-3);
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
  color: var(--text-secondary);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-6);
  background: var(--bg-surface-2);
  border-top: 1px solid var(--border-subtle);
}
</style>
