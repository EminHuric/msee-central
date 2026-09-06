<script setup lang="ts">
/**
 * Tasks.
 *
 * Grouped by when they are due rather than by status, because the question
 * somebody opens this page with is "what do I have to do now", not "how many
 * are in progress". Late first, then today, then the week.
 *
 * Client and project are optional. Plenty of real work belongs to neither —
 * fix the site, chase an invoice — and forcing every task under a project is
 * how task lists start being avoided.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import {
  bucketOf,
  deleteTask,
  fetchProjects,
  fetchTasks,
  saveTask,
  setTaskStatus,
  type TaskBucket,
} from '@/api/operations'
import { fetchClients } from '@/api/clients'
import { fetchEmployees } from '@/api/employees'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Client,
  type Project,
  type Task,
} from '@/types/business'
import type { EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const loading = ref(true)
const saving = ref(false)
const tasks = ref<Task[]>([])
const clients = ref<Client[]>([])
const projects = ref<Project[]>([])
const people = ref<EmployeePublic[]>([])

const search = ref('')
const onlyMine = ref(false)
const showDone = ref(false)
const draft = ref<Task | null>(null)
const pendingDelete = ref<Task | null>(null)

const today = new Date().toISOString().slice(0, 10)

const clientNames = computed(() => new Map(clients.value.map((c) => [c.id, c.name])))
const projectNames = computed(() => new Map(projects.value.map((p) => [p.id, p.name])))

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()

  return tasks.value.filter((task) => {
    if (!showDone.value && task.status === 'done') return false
    if (onlyMine.value && task.assigneeUid !== auth.uid) return false
    if (!term) return true

    return [task.title, task.description, task.assigneeName, clientNames.value.get(task.clientId ?? '') ?? '']
      .join(' ')
      .toLowerCase()
      .includes(term)
  })
})

/** Late first: the order somebody actually needs to see them in. */
const ORDER: TaskBucket[] = ['overdue', 'today', 'week', 'later', 'someday', 'done']

const grouped = computed(() =>
  ORDER.map((bucket) => ({
    bucket,
    items: visible.value
      .filter((task) => bucketOf(task, today) === bucket)
      .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')),
  })).filter((group) => group.items.length > 0),
)

const openCount = computed(() => tasks.value.filter((task) => task.status !== 'done').length)
const lateCount = computed(
  () => tasks.value.filter((task) => bucketOf(task, today) === 'overdue').length,
)

async function load(): Promise<void> {
  loading.value = true
  const [t1, c, p, e] = await Promise.all([
    fetchTasks(),
    fetchClients().catch(() => []),
    fetchProjects().catch(() => []),
    fetchEmployees().catch(() => []),
  ])
  tasks.value = t1
  clients.value = c
  projects.value = p
  people.value = e
  loading.value = false
}

function startNew(): void {
  draft.value = {
    id: '',
    title: '',
    description: '',
    clientId: null,
    projectId: null,
    assigneeUid: auth.uid,
    assigneeName: auth.displayName ?? '',
    status: 'todo',
    priority: 'normal',
    dueDate: null,
    completedAt: null,
  } as Task
}

function startEdit(task: Task): void {
  draft.value = { ...task }
}

/** Projects narrow to the chosen client, so the pair cannot contradict. */
const availableProjects = computed(() => {
  if (!draft.value?.clientId) return projects.value
  return projects.value.filter((p) => p.clientId === draft.value?.clientId)
})

function onAssigneeChange(uid: string): void {
  if (!draft.value) return
  const person = people.value.find((p) => p.uid === uid)
  draft.value.assigneeUid = uid || null
  draft.value.assigneeName = person ? `${person.firstName} ${person.lastName}` : ''
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.title.trim()) {
    ui.notify('danger', t('tasks.titleRequired'))
    return
  }

  saving.value = true
  try {
    await saveTask(d)
    ui.notify('ok', t('tasks.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('tasks.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function toggle(task: Task): Promise<void> {
  await setTaskStatus(task, task.status === 'done' ? 'todo' : 'done')
  await load()
}

async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value) return
  await deleteTask(pendingDelete.value.id)
  pendingDelete.value = null
  await load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('tasks.title') }}</h1>
        <p class="page-subtitle">{{ t('tasks.subtitle') }}</p>
      </div>
      <button v-if="!draft" class="btn btn-primary" @click="startNew">
        <AppIcon name="plus" :size="16" /> {{ t('tasks.newTask') }}
      </button>
    </header>

    <div v-if="lateCount > 0" class="alert alert-warn">
      <AppIcon name="alert" :size="16" />
      <span>{{ t('taskBucket.overdue') }}: <strong>{{ lateCount }}</strong> · {{ t('tasks.subtitle') }}</span>
    </div>

    <!-- Editor --------------------------------------------------------- -->
    <section v-if="draft" class="card editor">
      <div class="card-header">
        <h2 class="card-title">{{ draft.id ? t('tasks.editTask') : t('tasks.newTask') }}</h2>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="draft = null">
          <AppIcon name="close" :size="18" />
        </button>
      </div>

      <div class="card-body stack">
        <div class="field">
          <label class="field-label" for="t-title">
            {{ t('tasks.taskTitle') }}<span class="req">*</span>
          </label>
          <input id="t-title" v-model="draft.title" class="input" :maxlength="LIMITS.position" />
        </div>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="t-assignee">{{ t('tasks.assignee') }}</label>
            <select
              id="t-assignee"
              :value="draft.assigneeUid ?? ''"
              class="select"
              @change="onAssigneeChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ t('tasks.unassigned') }}</option>
              <option v-for="p in people" :key="p.uid" :value="p.uid">
                {{ p.firstName }} {{ p.lastName }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="t-due">{{ t('tasks.dueDate') }}</label>
            <input id="t-due" v-model="draft.dueDate" class="input" type="date" />
          </div>

          <div class="field">
            <label class="field-label" for="t-priority">{{ t('tasks.priority') }}</label>
            <select id="t-priority" v-model="draft.priority" class="select">
              <option v-for="p in TASK_PRIORITIES" :key="p" :value="p">
                {{ t(`taskPriority.${p}`) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="t-status">{{ t('table.status') }}</label>
            <select id="t-status" v-model="draft.status" class="select">
              <option v-for="s in TASK_STATUSES" :key="s" :value="s">
                {{ t(`taskStatus.${s}`) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="t-client">{{ t('tasks.client') }}</label>
            <select id="t-client" v-model="draft.clientId" class="select">
              <option :value="null">{{ t('manage.noneSelected') }}</option>
              <option v-for="c in clients" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="t-project">{{ t('tasks.project') }}</label>
            <select id="t-project" v-model="draft.projectId" class="select">
              <option :value="null">{{ t('manage.noneSelected') }}</option>
              <option v-for="p in availableProjects" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="t-desc">{{ t('projects.description') }}</label>
          <textarea id="t-desc" v-model="draft.description" class="textarea" :maxlength="LIMITS.longText" />
        </div>
      </div>

      <div class="card-footer">
        <button class="btn btn-secondary" @click="draft = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="commit">
          <span v-if="saving" class="spinner" />{{ t('common.save') }}
        </button>
      </div>
    </section>

    <!-- Filters -------------------------------------------------------- -->
    <div class="toolbar">
      <div class="search toolbar-grow">
        <AppIcon name="search" :size="16" class="search-icon" />
        <input
          v-model="search"
          class="input search-input"
          type="search"
          :placeholder="t('common.searchPlaceholder')"
          :aria-label="t('common.search')"
        />
      </div>

      <div class="segmented">
        <button type="button" :class="{ 'is-on': !onlyMine }" @click="onlyMine = false">
          {{ t('tasks.everyone') }}
        </button>
        <button type="button" :class="{ 'is-on': onlyMine }" @click="onlyMine = true">
          {{ t('tasks.mine') }}
        </button>
      </div>

      <label class="check inline">
        <input v-model="showDone" type="checkbox" />
        <span class="check-text">{{ t('tasks.showDone') }}</span>
      </label>
    </div>

    <!-- List ----------------------------------------------------------- -->
    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 4" :key="n" class="skeleton" style="height: 40px" />
      </div>
    </div>

    <div v-else-if="grouped.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="check" :size="20" /></span>
        <p class="empty-title">{{ tasks.length === 0 ? t('tasks.empty') : t('tasks.noMatch') }}</p>
        <p class="empty-text">{{ t('tasks.emptyHint') }}</p>
      </div>
    </div>

    <section v-for="group in grouped" v-else :key="group.bucket" class="card">
      <div class="card-header">
        <h2 class="card-title" :class="{ 'is-late': group.bucket === 'overdue' }">
          {{ t(`taskBucket.${group.bucket}`) }}
        </h2>
        <span class="badge badge-plain">{{ group.items.length }}</span>
      </div>

      <ul class="tasks">
        <li v-for="task in group.items" :key="task.id" class="task" :class="{ 'is-done': task.status === 'done' }">
          <button
            type="button"
            class="tick"
            :class="{ 'is-on': task.status === 'done' }"
            :aria-label="t('taskStatus.done')"
            @click="toggle(task)"
          >
            <AppIcon v-if="task.status === 'done'" name="check" :size="13" />
          </button>

          <div class="task-body" @click="startEdit(task)">
            <span class="task-title">{{ task.title }}</span>
            <span class="task-meta">
              <span v-if="task.priority !== 'normal'" class="badge badge-plain" :class="`prio-${task.priority}`">
                {{ t(`taskPriority.${task.priority}`) }}
              </span>
              <span v-if="task.clientId" class="tertiary">
                {{ clientNames.get(task.clientId) }}
              </span>
              <span v-if="task.projectId" class="tertiary">
                · {{ projectNames.get(task.projectId) }}
              </span>
              <span v-if="task.dueDate" class="tertiary">· {{ formatDate(task.dueDate) }}</span>
              <span v-if="task.status !== 'todo' && task.status !== 'done'" class="badge badge-plain">
                {{ t(`taskStatus.${task.status}`) }}
              </span>
            </span>
          </div>

          <UserAvatar v-if="task.assigneeName" :name="task.assigneeName" :size="26" />

          <button class="btn btn-ghost btn-sm danger" @click="pendingDelete = task">
            <AppIcon name="close" :size="14" />
          </button>
        </li>
      </ul>
    </section>

    <p v-if="!loading && tasks.length" class="tertiary foot">
      {{ t('projects.tasksOpen', { n: openCount }) }}
    </p>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('tasks.deleteTask')"
      :message="t('tasks.deleteText')"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>

<style scoped>
.editor { border-color: var(--accent-soft-border); }
.search { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: var(--space-3); color: var(--text-tertiary); pointer-events: none; }
.search-input { padding-left: calc(var(--space-3) * 2 + 16px); }

.segmented { display: inline-flex; padding: 2px; gap: 2px; background: var(--bg-inset); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
.segmented button { padding: 0 var(--space-3); height: 30px; border-radius: var(--radius-sm); font-size: var(--text-sm); font-weight: 550; color: var(--text-tertiary); }
.segmented button.is-on { background: var(--bg-surface-3); color: var(--text-primary); box-shadow: var(--shadow-sm); }

.check.inline { align-items: center; }

.tasks { list-style: none; padding: 0; margin: 0; }
.task { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-5); border-bottom: 1px solid var(--border-subtle); }
.task:last-child { border-bottom: none; }
.task:hover { background: var(--bg-hover); }
.task.is-done .task-title { text-decoration: line-through; color: var(--text-tertiary); }

.tick {
  width: 20px; height: 20px; flex-shrink: 0;
  border: 1.5px solid var(--border-strong); border-radius: var(--radius-sm);
  display: grid; place-items: center; color: var(--accent-text);
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.tick:hover { border-color: var(--accent); }
.tick.is-on { background: var(--accent); border-color: var(--accent); }

.task-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; cursor: pointer; }
.task-title { font-size: var(--text-base); font-weight: 500; }
.task-meta { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; font-size: var(--text-xs); }

.is-late { color: var(--danger-500); }
.prio-high { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.prio-urgent { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-500); }
.prio-low { color: var(--text-tertiary); }
.danger:hover { color: var(--danger-500); }
.foot { font-size: var(--text-xs); }
</style>
