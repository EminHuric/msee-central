<script setup lang="ts">
/**
 * An editor that opens OVER the page rather than above it.
 *
 * WHY THIS EXISTS. Every list in this application used to put its form between
 * the heading and the rows. Pressing "edit" on the fortieth client threw the
 * page to the top, and when the form was saved or closed the person was left
 * three screens away from where they had been working. On a phone it was worse:
 * the form filled the screen, so there was no sign the list was still there.
 *
 * A dialog fixes both at once — the list does not move, and closing returns to
 * exactly the row that was being edited.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not own the header, the fields or
 * the save button; those stay in the view that knows what it is editing. This
 * is a frame, which is why fourteen screens could adopt it without any of them
 * changing a single field.
 *
 * ESCAPE AND THE BACKDROP both close it, because every dialog a person has ever
 * used does. The listener is bound only while it is open, so fourteen of these
 * on one page cost nothing when they are not showing.
 */

import { onBeforeUnmount, watch } from 'vue'

const props = defineProps<{
  open: boolean
  /** Wider than the default, for forms with two columns of fields. */
  wide?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

/*
 * The scroll lock matters more than it looks.
 *
 * Without it, scrolling to the bottom of a long form carries on scrolling the
 * list behind it, so closing the dialog lands somewhere else entirely — which
 * is the exact problem this component was made to solve.
 */
function lock(on: boolean): void {
  if (typeof document === 'undefined') return
  document.body.style.overflow = on ? 'hidden' : ''
}

watch(
  () => props.open,
  (open) => {
    lock(open)
    if (open) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  lock(false)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <!--
    Teleported to the body so a dialog is never clipped by a card's
    `overflow: hidden` or trapped under a sibling's stacking context — the two
    ways a correctly written modal ends up half visible.
  -->
  <Teleport to="body">
    <div v-if="open" class="editor-backdrop" @click.self="emit('close')">
      <section class="card editor-panel" :class="{ 'editor-wide': wide }" role="dialog" aria-modal="true">
        <slot />
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.editor-backdrop {
  background: rgb(0 0 0 / 55%);
  display: grid;
  inset: 0;
  padding: var(--space-4);
  place-items: center;
  position: fixed;
  z-index: 90;
}

.editor-panel {
  border-color: var(--accent-soft-border);
  box-shadow: var(--shadow-lg);
  /*
   * Capped and scrolled inside: this form is taller than a phone, and without
   * the cap the save button sits below the fold with no way to reach it.
   */
  max-height: 92vh;
  overflow-y: auto;
  width: min(640px, 100%);
}

.editor-wide {
  width: min(860px, 100%);
}

/* On a phone a centred box wastes the edges; it takes the screen instead. */
@media (max-width: 640px) {
  .editor-backdrop {
    padding: 0;
    place-items: stretch;
  }

  .editor-panel,
  .editor-wide {
    border-radius: 0;
    max-height: 100vh;
    min-height: 100vh;
    width: 100%;
  }
}
</style>
