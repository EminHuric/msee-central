<script setup lang="ts">
/**
 * Confirmation for actions that are hard to undo.
 *
 * Built on <dialog>, so the browser handles focus trapping, Escape and the
 * top layer rather than us reimplementing them badly.
 */

import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

/**
 * Open and close it, and lock the page behind it.
 *
 * `showModal()` is what puts the dialog in the browser's top layer, and the
 * top layer is what makes it centre on the viewport no matter what it is
 * nested inside — a transform on an ancestor traps `position: fixed`, but not
 * this. A dialog that only has the `open` attribute set is NOT in the top
 * layer: it lays out inline, in the middle of whatever container holds it,
 * which is exactly what "stuck in the middle" looks like. So every path here
 * goes through `showModal()`.
 *
 * The body is locked because the page behind a modal scrolling under the
 * pointer is disorienting, and on a phone it is how people lose their place.
 */
function sync(open: boolean): void {
  const el = dialog.value
  if (!el) return

  if (open && !el.open) {
    el.showModal()
    document.body.style.overflow = 'hidden'
  }
  if (!open && el.open) {
    el.close()
    document.body.style.overflow = ''
  }
}

watch(() => props.open, sync)

/* Mounted already open is a real case — a parent may render it that way — and
   the watcher above never fires for it, because nothing changed. */
onMounted(() => sync(props.open))

/** Escape and the backdrop both count as cancelling. */
function onClose(): void {
  if (props.open) emit('cancel')
}

function onBackdropClick(event: MouseEvent): void {
  if (event.target === dialog.value && !props.busy) emit('cancel')
}

onBeforeUnmount(() => {
  dialog.value?.close()
  /* Unmounting while open must not leave the page unable to scroll. */
  document.body.style.overflow = ''
})
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
/*
 * Centring is stated rather than inherited from the user agent, which differs
 * between browsers, and `max-height` with an inner scroll means a long message
 * on a short screen scrolls inside the dialog rather than off the end of it.
 */
/*
 * A closed dialog stays closed.
 *
 * This rule needs `[open]` on it, and the reason is worth writing down: the
 * browser hides a closed <dialog> with `dialog:not([open]) { display: none }`
 * in its own stylesheet, and ANY author rule setting `display` beats that
 * regardless of specificity. Writing a plain `display: flex` here therefore
 * made every confirmation permanently visible, centred, on every page that has
 * one — "delete this project?" sitting on the screen with no way to dismiss
 * it, because it was never open in the first place.
 */
.dialog[open] {
  display: flex;
  flex-direction: column;
}

.dialog {
  position: fixed;
  inset: 0;
  margin: auto;
  width: min(420px, calc(100vw - var(--space-8)));
  max-height: calc(100dvh - var(--space-8));
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
}

/* On a phone it sits against the bottom, where the thumb is. */
@media (max-width: 640px) {
  .dialog {
    inset: auto 0 0 0;
    margin: 0;
    width: 100%;
    max-height: 85dvh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    border-bottom: 0;
  }

  .dialog-actions {
    padding-bottom: max(var(--space-4), env(safe-area-inset-bottom));
  }

  .dialog-actions .btn { flex: 1; }
}

.dialog::backdrop {
  background: var(--scrim);
  backdrop-filter: blur(2px);
}

.dialog-body {
  flex: 1;
  overflow-y: auto;
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
