<script setup lang="ts">
/**
 * The calendar.
 *
 * Most of what appears here is not stored here. Payment dates, project
 * deadlines, note reminders and goal end-dates are read from the records that
 * own them and merged into the same grid, so moving a deadline means editing
 * the record — there is no second copy to forget.
 *
 * Only meetings and one-off entries are typed in, because those have no
 * underlying record to derive from. They are the exception, and they say so.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { buildCalendar, deleteEvent, fetchEvents, fetchGoals, monthGrid, saveEvent } from '@/api/company'
import { fetchClients } from '@/api/clients'
import { fetchEmployees } from '@/api/employees'
import { fetchDatedNotes } from '@/api/records'
import { fetchProjects } from '@/api/operations'
import { fetchTransactions } from '@/api/finance'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import type { Client, Note, Project } from '@/types/business'
import { EVENT_KINDS, type CalendarEvent, type EventKind, type Goal } from '@/types/company'
import type { Transaction } from '@/types/revenue'
import { PERMISSIONS } from '@/types/permissions'
import type { EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { t, locale } = useI18n()

const loading = ref(true)
const saving = ref(false)

const events = ref<CalendarEvent[]>([])
const transactions = ref<Transaction[]>([])
const notes = ref<Note[]>([])
const goals = ref<Goal[]>([])
const clients = ref<Client[]>([])
const projects = ref<Project[]>([])
const people = ref<EmployeePublic[]>([])

const today = new Date().toISOString().slice(0, 10)
const cursor = ref(new Date())
const selected = ref(today)
const pendingDelete = ref<CalendarEvent | null>(null)

const canManage = computed(() => auth.hasPermission(PERMISSIONS.CALENDAR_MANAGE))

interface Draft {
  id: string
  title: string
  description: string
  kind: EventKind
  date: string
  startTime: string
  endTime: string
  attendeeUids: string[]
  clientId: string | null
  projectId: string | null
  location: string
}

const draft = ref<Draft | null>(null)

/* ---- Data ----------------------------------------------------------- */

const items = computed(() =>
  buildCalendar({
    events: events.value,
    transactions: transactions.value,
    projects: projects.value,
    notes: notes.value.filter((n) => n.authorUid === auth.uid),
    goals: goals.value,
    uid: auth.uid ?? '',
  }),
)

/** Day → entries, so the grid renders without scanning the list per cell. */
const byDay = computed(() => {
  const map = new Map<string, typeof items.value>()
  for (const item of items.value) {
    const row = map.get(item.date) ?? []
    row.push(item)
    map.set(item.date, row)
  }
  return map
})

const grid = computed(() => monthGrid(cursor.value.getFullYear(), cursor.value.getMonth()))

const monthLabel = computed(() =>
  new Intl.DateTimeFormat(locale.value === 'sr' ? 'sr-RS' : 'en-GB', {
    month: 'long',
    year: 'numeric',
  }).format(cursor.value),
)

const weekdays = computed(() => {
  /* A Monday, so the labels line up with the Monday-first grid. */
  const base = new Date(Date.UTC(2024, 0, 1))
  const fmt = new Intl.DateTimeFormat(locale.value === 'sr' ? 'sr-RS' : 'en-GB', {
    weekday: 'short',
  })
  return Array.from({ length: 7 }, (_, i) =>
    fmt.format(new Date(base.getTime() + i * 86_400_000)),
  )
})

const selectedItems = computed(() => byDay.value.get(selected.value) ?? [])

/** The next three weeks, for the agenda beside the grid. */
const upcoming = computed(() => {
  const limit = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10)
  return items.value.filter((i) => !i.done && i.date >= today && i.date <= limit).slice(0, 25)
})

function inMonth(date: string): boolean {
  return Number(date.slice(5, 7)) === cursor.value.getMonth() + 1
}

function step(months: number): void {
  cursor.value = new Date(cursor.value.getFullYear(), cursor.value.getMonth() + months, 1)
}

function goToday(): void {
  cursor.value = new Date()
  selected.value = today
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const [e, tx, n, g, cl, pr, p] = await Promise.all([
      fetchEvents(),
      fetchTransactions().catch(() => []),
      fetchDatedNotes().catch(() => []),
      fetchGoals().catch(() => []),
      fetchClients().catch(() => []),
      fetchProjects().catch(() => []),
      fetchEmployees().catch(() => []),
    ])
    events.value = e
    transactions.value = tx
    notes.value = n
    goals.value = g
    clients.value = cl
    projects.value = pr
    people.value = p
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

/* ---- Editor --------------------------------------------------------- */

function startNew(date = selected.value): void {
  draft.value = {
    id: '',
    title: '',
    description: '',
    kind: 'meeting',
    date,
    startTime: '',
    endTime: '',
    attendeeUids: [],
    clientId: null,
    projectId: null,
    location: '',
  }
}

function startEdit(id: string): void {
  const event = events.value.find((e) => `event-${e.id}` === id)
  if (!event) return

  draft.value = {
    id: event.id,
    title: event.title,
    description: event.description ?? '',
    kind: event.kind,
    date: event.date,
    startTime: event.startTime ?? '',
    endTime: event.endTime ?? '',
    attendeeUids: [...(event.attendeeUids ?? [])],
    clientId: event.clientId,
    projectId: event.projectId,
    location: event.location ?? '',
  }
}

function toggleAttendee(uid: string): void {
  const list = draft.value?.attendeeUids
  if (!list) return
  const i = list.indexOf(uid)
  if (i >= 0) list.splice(i, 1)
  else list.push(uid)
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.title.trim()) {
    ui.notify('danger', t('calendar.titleRequired'))
    return
  }

  saving.value = true
  try {
    await saveEvent({
      id: d.id,
      title: d.title.trim(),
      description: d.description.trim(),
      kind: d.kind,
      date: d.date,
      startTime: d.startTime,
      endTime: d.endTime,
      attendeeUids: d.attendeeUids,
      clientId: d.clientId,
      projectId: d.projectId,
      location: d.location.trim(),
    } as CalendarEvent)

    ui.notify('ok', t('calendar.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('calendar.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function confirmDelete(): Promise<void> {
  try {
    if (!pendingDelete.value) return
    await deleteEvent(pendingDelete.value)
    await load()
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    /* Always clears, so a refused delete cannot leave the
       confirmation on screen with nothing happening. */
    pendingDelete.value = null
  }
}

function open(item: { link: string | null; id: string; derived: boolean }): void {
  if (item.derived && item.link) {
    router.push(item.link)
  } else if (!item.derived) {
    startEdit(item.id)
  }
}

function eventFor(id: string): CalendarEvent | undefined {
  return events.value.find((e) => `event-${e.id}` === id)
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('calendar.title') }}</h1>
        <p class="page-subtitle">{{ t('calendar.subtitle') }}</p>
      </div>
      <button v-if="canManage && !draft" class="btn btn-primary" @click="startNew()">
        <AppIcon name="plus" :size="16" /> {{ t('calendar.newEvent') }}
      </button>
    </header>

    <!-- Editor --------------------------------------------------------- -->
    <section v-if="draft" class="card editor">
      <div class="card-header">
        <h2 class="card-title">{{ draft.id ? t('calendar.editEvent') : t('calendar.newEvent') }}</h2>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="draft = null">
          <AppIcon name="close" :size="18" />
        </button>
      </div>

      <div class="card-body stack">
        <div class="field">
          <label class="field-label" for="e-title">
            {{ t('calendar.eventTitle') }}<span class="req">*</span>
          </label>
          <input id="e-title" v-model="draft.title" class="input" :maxlength="LIMITS.position" />
        </div>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="e-kind">{{ t('calendar.kind') }}</label>
            <select id="e-kind" v-model="draft.kind" class="select">
              <option v-for="k in EVENT_KINDS" :key="k" :value="k">{{ t(`eventKind.${k}`) }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="e-date">{{ t('calendar.date') }}</label>
            <input id="e-date" v-model="draft.date" class="input" type="date" />
          </div>
          <div class="field">
            <label class="field-label" for="e-from">{{ t('calendar.startTime') }}</label>
            <input id="e-from" v-model="draft.startTime" class="input" type="time" />
          </div>
          <div class="field">
            <label class="field-label" for="e-to">{{ t('calendar.endTime') }}</label>
            <input id="e-to" v-model="draft.endTime" class="input" type="time" />
          </div>
          <div class="field">
            <label class="field-label" for="e-loc">{{ t('calendar.location') }}</label>
            <input id="e-loc" v-model="draft.location" class="input" :maxlength="LIMITS.name" />
          </div>
          <div class="field">
            <label class="field-label" for="e-client">{{ t('calendar.client') }}</label>
            <select id="e-client" v-model="draft.clientId" class="select">
              <option :value="null">—</option>
              <option v-for="c in clients" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="e-proj">{{ t('calendar.project') }}</label>
            <select id="e-proj" v-model="draft.projectId" class="select">
              <option :value="null">—</option>
              <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
        </div>

        <div class="field">
          <span class="field-label">{{ t('calendar.attendees') }}</span>
          <p class="field-hint">{{ t('calendar.attendeesHint') }}</p>
          <div class="attendees">
            <label v-for="p in people" :key="p.uid" class="check">
              <input
                type="checkbox"
                :checked="draft.attendeeUids.includes(p.uid)"
                @change="toggleAttendee(p.uid)"
              />
              <span class="check-text">{{ p.firstName }} {{ p.lastName }}</span>
            </label>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="e-desc">{{ t('calendar.description') }}</label>
          <textarea id="e-desc" v-model="draft.description" class="textarea" :maxlength="LIMITS.longText" />
        </div>
      </div>

      <div class="card-footer">
        <button
          v-if="draft.id"
          class="btn btn-ghost danger"
          @click="pendingDelete = eventFor(`event-${draft.id}`) ?? null"
        >
          {{ t('common.delete') }}
        </button>
        <span class="spacer" />
        <button class="btn btn-secondary" @click="draft = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="commit">
          <span v-if="saving" class="spinner" />{{ t('common.save') }}
        </button>
      </div>
    </section>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div class="skeleton" style="height: 320px" />
      </div>
    </div>

    <div v-else class="layout">
      <!-- Month grid --------------------------------------------------- -->
      <section class="card month">
        <div class="card-header">
          <h2 class="card-title cap">{{ monthLabel }}</h2>
          <div class="nav">
            <button class="btn btn-ghost btn-sm" :aria-label="t('common.previous')" @click="step(-1)">
              <AppIcon name="chevronDown" :size="16" class="rot-r" />
            </button>
            <button class="btn btn-secondary btn-sm" @click="goToday">{{ t('calendar.today') }}</button>
            <button class="btn btn-ghost btn-sm" :aria-label="t('common.next')" @click="step(1)">
              <AppIcon name="chevronDown" :size="16" class="rot-l" />
            </button>
          </div>
        </div>

        <div class="weekdays">
          <span v-for="d in weekdays" :key="d">{{ d }}</span>
        </div>

        <div class="days">
          <button
            v-for="date in grid"
            :key="date"
            type="button"
            class="day"
            :class="{
              'is-out': !inMonth(date),
              'is-today': date === today,
              'is-selected': date === selected,
            }"
            @click="selected = date"
            @dblclick="canManage && startNew(date)"
          >
            <span class="day-number">{{ Number(date.slice(8, 10)) }}</span>
            <span class="dots">
              <span
                v-for="item in (byDay.get(date) ?? []).slice(0, 4)"
                :key="item.id"
                class="dot"
                :class="[`k-${item.kind}`, { 'is-done': item.done }]"
              />
            </span>
          </button>
        </div>
      </section>

      <!-- Selected day + agenda ---------------------------------------- -->
      <div class="side">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ formatDate(selected) }}</h2>
            <button v-if="canManage" class="btn btn-ghost btn-sm" @click="startNew(selected)">
              <AppIcon name="plus" :size="14" />
            </button>
          </div>

          <p v-if="selectedItems.length === 0" class="card-body tertiary small">
            {{ t('calendar.nothingToday') }}
          </p>

          <ul v-else class="entries">
            <li v-for="item in selectedItems" :key="item.id">
              <button type="button" class="entry" :class="{ 'is-done': item.done }" @click="open(item)">
                <span class="entry-dot" :class="`k-${item.kind}`" />
                <span class="entry-body">
                  <span class="entry-title">{{ item.title }}</span>
                  <span class="entry-meta tertiary">
                    {{ t(`eventKind.${item.kind}`) }}
                    <template v-if="item.detail"> · {{ item.detail }}</template>
                    <template v-if="item.derived"> · {{ t('calendar.derived') }}</template>
                  </span>
                </span>
              </button>
            </li>
          </ul>
        </section>

        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('calendar.agenda') }}</h2>
          </div>

          <div v-if="upcoming.length === 0" class="empty">
            <span class="empty-icon"><AppIcon name="calendar" :size="20" /></span>
            <p class="empty-title">{{ t('calendar.empty') }}</p>
            <p class="empty-text">{{ t('calendar.emptyHint') }}</p>
          </div>

          <ul v-else class="entries">
            <li v-for="item in upcoming" :key="item.id">
              <button type="button" class="entry" @click="open(item)">
                <span class="entry-date" :class="{ late: item.date < today }">
                  {{ formatDate(item.date) }}
                </span>
                <span class="entry-body">
                  <span class="entry-title">{{ item.title }}</span>
                  <span class="entry-meta tertiary">{{ t(`eventKind.${item.kind}`) }}</span>
                </span>
              </button>
            </li>
          </ul>
          <p class="card-body tertiary small">{{ t('calendar.derivedHint') }}</p>
        </section>
      </div>
    </div>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('calendar.deleteEvent')"
      :message="pendingDelete?.title ?? ''"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>

<style scoped>
.editor { border-color: var(--accent-soft-border); }
.spacer { flex: 1; }
.cap { text-transform: capitalize; }
.nav { display: flex; align-items: center; gap: var(--space-1); }
.rot-r { transform: rotate(90deg); }
.rot-l { transform: rotate(-90deg); }

.layout { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr); gap: var(--space-4); align-items: start; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }

.weekdays {
  display: grid; grid-template-columns: repeat(7, 1fr);
  padding: 0 var(--space-4) var(--space-2);
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--text-tertiary); text-align: center;
}

.days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; padding: 0 var(--space-4) var(--space-4); }
.day {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  min-height: 58px; padding: var(--space-2) 2px;
  border-radius: var(--radius-sm); border: 1px solid transparent;
  transition: background var(--dur-fast) var(--ease-out);
}
.day:hover { background: var(--bg-hover); }
.day.is-out { opacity: 0.35; }
.day.is-today { border-color: var(--accent); }
.day.is-selected { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); }
.day-number { font-size: var(--text-sm); font-weight: 600; font-variant-numeric: tabular-nums; }
.dots { display: flex; gap: 2px; flex-wrap: wrap; justify-content: center; }
.dot { width: 5px; height: 5px; border-radius: 50%; background: var(--text-tertiary); }
.dot.is-done { opacity: 0.35; }

.k-meeting, .entry-dot.k-meeting { background: var(--accent); }
.k-deadline, .entry-dot.k-deadline { background: var(--danger-500); }
.k-task, .entry-dot.k-task { background: var(--ok-500); }
.k-contract, .entry-dot.k-contract { background: var(--warn-500); }
.k-payment, .entry-dot.k-payment { background: var(--danger-500); }
.k-reminder, .entry-dot.k-reminder { background: var(--text-tertiary); }
.k-other, .entry-dot.k-other { background: var(--text-tertiary); }

.side { display: flex; flex-direction: column; gap: var(--space-4); }
.entries { list-style: none; margin: 0; padding: 0; }
.entry {
  display: flex; align-items: flex-start; gap: var(--space-3); width: 100%;
  padding: var(--space-3) var(--space-5); text-align: left;
  border-top: 1px solid var(--border-subtle);
}
.entry:hover { background: var(--bg-hover); }
.entry.is-done .entry-title { text-decoration: line-through; color: var(--text-tertiary); }
.entry-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
.entry-date { font-size: var(--text-xs); font-weight: 600; font-variant-numeric: tabular-nums; min-width: 78px; color: var(--text-secondary); }
.entry-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.entry-title { font-size: var(--text-sm); font-weight: 550; }
.entry-meta { font-size: var(--text-xs); }
.late { color: var(--danger-500); }
.small { font-size: var(--text-xs); }
.danger:hover { color: var(--danger-500); }
.attendees { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-2); }
</style>
