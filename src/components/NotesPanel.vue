<script setup lang="ts">
/**
 * Notes on a record — and, in this system, the replacement for a task module.
 *
 * A note with a date is as close to a task as MsEe Central goes, deliberately.
 * A separate task system would be a second place to record "call them back on
 * Tuesday", and the second place is the one nobody keeps up to date. Here the
 * reminder sits on the client it is about, where somebody would actually look
 * for it, and it turns up in the calendar and the workspace on its own.
 *
 * Pinned notes sort first and stay at the top of the record's overview.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { deleteNote, fetchNotes, saveNote } from '@/api/records'
import { formatDate, formatRelative } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import type { Note, NoteEntity } from '@/types/business'

const props = defineProps<{ entity: NoteEntity; entityId: string; title?: string }>()

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const notes = ref<Note[]>([])
const loading = ref(true)
const saving = ref(false)

const body = ref('')
const dueDate = ref('')
const pinned = ref(false)

const today = new Date().toISOString().slice(0, 10)

const open = computed(() => notes.value.filter((n) => n.dueDate && !n.done))
const overdue = computed(() => open.value.filter((n) => (n.dueDate ?? '') < today))

async function load(): Promise<void> {
  loading.value = true
  try {
    notes.value = await fetchNotes(props.entity, props.entityId)
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function add(): Promise<void> {
  if (!body.value.trim() || saving.value) return

  saving.value = true
  try {
    await saveNote({
      id: '',
      entity: props.entity,
      entityId: props.entityId,
      body: body.value.trim(),
      pinned: pinned.value,
      dueDate: dueDate.value || null,
      done: false,
      authorUid: '',
      authorName: '',
      createdAt: '',
      updatedAt: '',
    })
    body.value = ''
    dueDate.value = ''
    pinned.value = false
    await load()
  } finally {
    saving.value = false
  }
}

/** Anybody may tick off a reminder; only the author may reword the note. */
async function toggleDone(note: Note): Promise<void> {
  await saveNote({ ...note, done: !note.done })
  await load()
}

async function togglePin(note: Note): Promise<void> {
  await saveNote({ ...note, pinned: !note.pinned })
  await load()
}

async function remove(note: Note): Promise<void> {
  await deleteNote(note.id)
  await load()
}

onMounted(load)
watch(() => props.entityId, load)
</script>

<template>
  <section class="card">
    <div class="card-header">
      <h2 class="card-title">{{ title ?? t('notes.title') }}</h2>
      <span v-if="overdue.length" class="badge badge-danger">{{ overdue.length }}</span>
      <span v-else-if="open.length" class="badge badge-plain">{{ open.length }}</span>
    </div>

    <form class="composer" @submit.prevent="add">
      <textarea
        v-model="body"
        class="textarea"
        rows="2"
        :placeholder="t('notes.placeholder')"
        :maxlength="LIMITS.longText"
      />
      <div class="composer-row">
        <input
          v-model="dueDate"
          class="input date"
          type="date"
          :aria-label="t('notes.remindOn')"
        />
        <label class="check">
          <input v-model="pinned" type="checkbox" />
          <span class="check-text">{{ t('notes.pin') }}</span>
        </label>
        <span class="spacer" />
        <button class="btn btn-primary btn-sm" type="submit" :disabled="saving || !body.trim()">
          {{ t('notes.add') }}
        </button>
      </div>
      <p class="field-hint">{{ t('notes.hint') }}</p>
    </form>

    <div v-if="loading" class="card-body stack">
      <div v-for="n in 2" :key="n" class="skeleton" style="height: 32px" />
    </div>

    <p v-else-if="notes.length === 0" class="card-body tertiary small">{{ t('notes.empty') }}</p>

    <ul v-else class="notes">
      <li v-for="note in notes" :key="note.id" class="note" :class="{ 'is-done': note.done }">
        <button
          v-if="note.dueDate"
          type="button"
          class="tick"
          :class="{ 'is-on': note.done }"
          :aria-label="t('notes.markDone')"
          @click="toggleDone(note)"
        >
          <AppIcon v-if="note.done" name="check" :size="12" />
        </button>
        <UserAvatar v-else :name="note.authorName" :size="26" />

        <div class="note-body">
          <p class="note-text">{{ note.body }}</p>
          <p class="note-meta tertiary">
            <span v-if="note.pinned" class="pin-flag">{{ t('notes.pinned') }} · </span>
            {{ note.authorName }} · {{ formatRelative(note.createdAt) }}
            <span
              v-if="note.dueDate"
              :class="{ late: !note.done && note.dueDate < today }"
            >
              · {{ formatDate(note.dueDate) }}
            </span>
          </p>
        </div>

        <button
          class="btn btn-ghost btn-sm"
          :aria-label="t('notes.pin')"
          @click="togglePin(note)"
        >
          <AppIcon name="flag" :size="13" :class="note.pinned ? 'on' : 'tertiary'" />
        </button>
        <button
          v-if="note.authorUid === auth.uid"
          class="btn btn-ghost btn-sm danger"
          :aria-label="t('common.delete')"
          @click="remove(note)"
        >
          <AppIcon name="trash" :size="13" />
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.composer { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--border-subtle); }
.composer-row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.input.date { max-width: 170px; }
.spacer { flex: 1; }

.notes { list-style: none; margin: 0; padding: 0; }
.note { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-3) var(--space-5); border-bottom: 1px solid var(--border-subtle); }
.note:last-child { border-bottom: none; }
.note:hover { background: var(--bg-hover); }
.note.is-done .note-text { text-decoration: line-through; color: var(--text-tertiary); }

.tick {
  width: 18px; height: 18px; flex-shrink: 0; margin-top: 2px;
  border: 1.5px solid var(--border-strong); border-radius: var(--radius-sm);
  display: grid; place-items: center; color: var(--accent-text);
}
.tick:hover { border-color: var(--accent); }
.tick.is-on { background: var(--accent); border-color: var(--accent); }

.note-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.note-text { font-size: var(--text-sm); line-height: var(--leading-relaxed); white-space: pre-wrap; word-break: break-word; }
.note-meta { font-size: var(--text-xs); }
.pin-flag { color: var(--text-brand); font-weight: 600; }
.late { color: var(--danger-500); font-weight: 600; }
.on { color: var(--text-brand); }
.danger:hover { color: var(--danger-500); }
.small { font-size: var(--text-xs); }
</style>
