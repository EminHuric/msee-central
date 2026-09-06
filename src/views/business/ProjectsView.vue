<script setup lang="ts">
/**
 * Projects.
 *
 * A project is a container, not a second ledger. Its figures are read back out
 * of the client work items tagged with its id, so a project can never disagree
 * with the books — there is only one place the money was ever typed.
 *
 * `value` is what was agreed. Earned is what actually got recorded. Showing
 * both side by side is the only way to see a job quietly running over.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import { fetchAllWork } from '@/api/clientDossier'
import { fetchClients } from '@/api/clients'
import { fetchEmployees } from '@/api/employees'
import { fetchProjects, fetchServiceCatalogue, fetchTasks, saveProject } from '@/api/operations'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import {
  BILLING_TYPES,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  type BillingType,
  type Client,
  type Project,
  type ProjectStatus,
  type Service,
  type Task,
  type TaskPriority,
  type WorkItem,
} from '@/types/business'
import {
  BASE_CURRENCY,
  CURRENCIES,
  formatMoney,
  fromMinor,
  makeMoney,
  type CurrencyCode,
} from '@/types/money'
import { projectProgress } from '@/api/metrics'
import { PERMISSIONS } from '@/types/permissions'
import type { EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { t, locale } = useI18n()

const loading = ref(true)
const saving = ref(false)
const projects = ref<Project[]>([])
const clients = ref<Client[]>([])
const tasks = ref<Task[]>([])
const work = ref<WorkItem[]>([])
const people = ref<EmployeePublic[]>([])
const services = ref<Service[]>([])

const search = ref('')
const statusFilter = ref<ProjectStatus | ''>('')

const canManage = computed(() => auth.hasPermission(PERMISSIONS.PROJECTS_MANAGE))
const today = new Date().toISOString().slice(0, 10)

interface Draft {
  id: string
  clientId: string
  name: string
  description: string
  billing: BillingType
  amount: number
  currency: CurrencyCode
  status: ProjectStatus
  startDate: string
  endDate: string
  ownerUid: string
  teamUids: string[]
  priority: TaskPriority
  serviceId: string | null
}

const draft = ref<Draft | null>(null)

const clientNames = computed(() => new Map(clients.value.map((c) => [c.id, c.name])))

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

/**
 * What each project has actually earned, cost and collected, read from the
 * client ledger. Derived every time rather than stored, so it cannot go stale.
 */
const figures = computed(() => {
  const map = new Map<string, { earned: number; spent: number; unpaid: number }>()

  for (const item of work.value) {
    if (!item.projectId) continue
    const row = map.get(item.projectId) ?? { earned: 0, spent: 0, unpaid: 0 }
    row.earned += item.revenue.baseMinor
    row.spent += item.cost.baseMinor
    if (item.paymentStatus !== 'paid') row.unpaid += item.revenue.baseMinor
    map.set(item.projectId, row)
  }

  return map
})

const openTasks = computed(() => {
  const map = new Map<string, number>()
  for (const task of tasks.value) {
    if (!task.projectId || task.status === 'done') continue
    map.set(task.projectId, (map.get(task.projectId) ?? 0) + 1)
  }
  return map
})

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()

  return projects.value.filter((p) => {
    if (statusFilter.value && p.status !== statusFilter.value) return false
    if (!term) return true
    return `${p.name} ${p.description} ${clientNames.value.get(p.clientId) ?? ''}`
      .toLowerCase()
      .includes(term)
  })
})

const activeCount = computed(() => projects.value.filter((p) => p.status === 'active').length)

function isLate(project: Project): boolean {
  return (
    !!project.endDate &&
    project.endDate < today &&
    project.status !== 'completed' &&
    project.status !== 'cancelled'
  )
}

function nameOf(uid: string): string {
  const person = people.value.find((p) => p.uid === uid)
  return person ? `${person.firstName} ${person.lastName}` : ''
}

function toggleMember(uid: string): void {
  const list = draft.value?.teamUids
  if (!list) return
  const i = list.indexOf(uid)
  if (i >= 0) list.splice(i, 1)
  else list.push(uid)
}

/** Counted from milestones when there are any, otherwise from tasks. */
function progressOf(project: Project): number | null {
  return projectProgress(project, tasks.value)
}

async function load(): Promise<void> {
  loading.value = true
  const [p, c, tk, w, e, sv] = await Promise.all([
    fetchProjects(),
    fetchClients().catch(() => []),
    fetchTasks().catch(() => []),
    fetchAllWork().catch(() => []),
    fetchEmployees().catch(() => []),
    fetchServiceCatalogue().catch(() => []),
  ])
  projects.value = p
  clients.value = c
  tasks.value = tk
  work.value = w
  people.value = e
  services.value = sv
  loading.value = false
}

function startNew(): void {
  draft.value = {
    id: '',
    clientId: clients.value[0]?.id ?? '',
    name: '',
    description: '',
    billing: 'one_off',
    amount: 0,
    currency: BASE_CURRENCY,
    status: 'active',
    startDate: today,
    endDate: '',
    ownerUid: auth.uid ?? '',
    teamUids: [],
    priority: 'normal',
    serviceId: null,
  }
}

function startEdit(project: Project): void {
  draft.value = {
    id: project.id,
    clientId: project.clientId,
    name: project.name,
    description: project.description ?? '',
    billing: project.billing ?? 'one_off',
    amount: fromMinor(project.value?.minor ?? 0, project.value?.currency),
    currency: project.value?.currency ?? BASE_CURRENCY,
    status: project.status,
    startDate: project.startDate ?? '',
    endDate: project.endDate ?? '',
    ownerUid: project.ownerUid ?? '',
    teamUids: [...(project.teamUids ?? [])],
    priority: project.priority ?? 'normal',
    serviceId: project.serviceId ?? null,
  }
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.clientId) {
    ui.notify('danger', t('projects.clientRequired'))
    return
  }
  if (!d.name.trim()) {
    ui.notify('danger', t('projects.nameRequired'))
    return
  }

  saving.value = true
  try {
    await saveProject({
      id: d.id,
      clientId: d.clientId,
      name: d.name.trim(),
      description: d.description.trim(),
      billing: d.billing,
      value: makeMoney(d.amount, d.currency, 1, d.startDate || today),
      status: d.status,
      startDate: d.startDate || null,
      endDate: d.endDate || null,
      ownerUid: d.ownerUid || null,
      ownerName: nameOf(d.ownerUid),
      teamUids: d.teamUids,
      priority: d.priority,
      serviceId: d.serviceId,
      serviceName: services.value.find((s) => s.id === d.serviceId)?.name ?? '',
      contractId: null,
      milestones: projects.value.find((p) => p.id === d.id)?.milestones ?? [],
    } as Project)
    ui.notify('ok', t('projects.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('projects.saveFailed'))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('projects.title') }}</h1>
        <p class="page-subtitle">{{ t('projects.subtitle') }}</p>
      </div>
      <button v-if="canManage && !draft" class="btn btn-primary" @click="startNew">
        <AppIcon name="plus" :size="16" /> {{ t('projects.newProject') }}
      </button>
    </header>

    <!-- Editor --------------------------------------------------------- -->
    <section v-if="draft" class="card editor">
      <div class="card-header">
        <h2 class="card-title">
          {{ draft.id ? t('projects.editProject') : t('projects.newProject') }}
        </h2>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="draft = null">
          <AppIcon name="close" :size="18" />
        </button>
      </div>

      <div class="card-body stack">
        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="p-name">
              {{ t('projects.name') }}<span class="req">*</span>
            </label>
            <input id="p-name" v-model="draft.name" class="input" :maxlength="LIMITS.position" />
          </div>

          <div class="field">
            <label class="field-label" for="p-client">
              {{ t('projects.client') }}<span class="req">*</span>
            </label>
            <select id="p-client" v-model="draft.clientId" class="select">
              <option value="">—</option>
              <option v-for="c in clients" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="p-status">{{ t('table.status') }}</label>
            <select id="p-status" v-model="draft.status" class="select">
              <option v-for="s in PROJECT_STATUSES" :key="s" :value="s">
                {{ t(`projectStatus.${s}`) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="p-billing">{{ t('projects.billing') }}</label>
            <select id="p-billing" v-model="draft.billing" class="select">
              <option v-for="b in BILLING_TYPES" :key="b" :value="b">{{ t(`billing.${b}`) }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="p-value">{{ t('projects.value') }}</label>
            <input id="p-value" v-model.number="draft.amount" class="input" type="number" step="0.01" />
          </div>

          <div class="field">
            <label class="field-label" for="p-cur">{{ t('finance.amount') }}</label>
            <select id="p-cur" v-model="draft.currency" class="select">
              <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="p-start">{{ t('projects.startDate') }}</label>
            <input id="p-start" v-model="draft.startDate" class="input" type="date" />
          </div>

          <div class="field">
            <label class="field-label" for="p-end">{{ t('projects.endDate') }}</label>
            <input id="p-end" v-model="draft.endDate" class="input" type="date" />
          </div>

          <div class="field">
            <label class="field-label" for="p-service">{{ t('table.service') }}</label>
            <select id="p-service" v-model="draft.serviceId" class="select">
              <option :value="null">—</option>
              <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="p-priority">{{ t('table.priority') }}</label>
            <select id="p-priority" v-model="draft.priority" class="select">
              <option v-for="pr in TASK_PRIORITIES" :key="pr" :value="pr">
                {{ t(`taskPriority.${pr}`) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="p-owner">{{ t('projects.owner') }}</label>
            <select id="p-owner" v-model="draft.ownerUid" class="select">
              <option value="">—</option>
              <option v-for="e in people" :key="e.uid" :value="e.uid">
                {{ e.firstName }} {{ e.lastName }}
              </option>
            </select>
          </div>
        </div>

        <div class="field">
          <span class="field-label">{{ t('performance.team') }}</span>
          <div class="team-picker">
            <label v-for="e in people" :key="e.uid" class="check">
              <input
                type="checkbox"
                :checked="draft.teamUids.includes(e.uid)"
                @change="toggleMember(e.uid)"
              />
              <span class="check-text">{{ e.firstName }} {{ e.lastName }}</span>
            </label>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="p-desc">{{ t('projects.description') }}</label>
          <textarea id="p-desc" v-model="draft.description" class="textarea" :maxlength="LIMITS.longText" />
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
      <select v-model="statusFilter" class="select compact" :aria-label="t('table.status')">
        <option value="">{{ t('clients.allStatuses') }}</option>
        <option v-for="s in PROJECT_STATUSES" :key="s" :value="s">
          {{ t(`projectStatus.${s}`) }}
        </option>
      </select>
    </div>

    <!-- List ----------------------------------------------------------- -->
    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 68px" />
      </div>
    </div>

    <div v-else-if="visible.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="layers" :size="20" /></span>
        <p class="empty-title">
          {{ projects.length === 0 ? t('projects.empty') : t('projects.noMatch') }}
        </p>
        <p class="empty-text">{{ t('projects.emptyHint') }}</p>
        <button v-if="canManage && projects.length === 0" class="btn btn-primary" @click="startNew">
          {{ t('projects.newProject') }}
        </button>
      </div>
    </div>

    <div v-else class="grid">
      <article v-for="project in visible" :key="project.id" class="card project">
        <div class="project-head">
          <div class="project-id">
            <h2 class="project-name">{{ project.name }}</h2>
            <button
              v-if="project.clientId"
              type="button"
              class="link-quiet"
              @click="router.push(`/clients/${project.clientId}`)"
            >
              {{ clientNames.get(project.clientId) ?? t('projects.noClient') }}
            </button>
          </div>
          <span class="badge" :class="`st-${project.status}`">
            {{ t(`projectStatus.${project.status}`) }}
          </span>
        </div>

        <p v-if="project.description" class="muted project-desc truncate-2">
          {{ project.description }}
        </p>

        <div v-if="progressOf(project) !== null" class="progress">
          <span class="bar-track">
            <span class="bar" :style="{ width: `${progressOf(project)}%` }" />
          </span>
          <span class="progress-pct">{{ progressOf(project) }}%</span>
        </div>

        <dl class="figures">
          <div>
            <dt>{{ t('projects.value') }}</dt>
            <dd>{{ money(project.value?.baseMinor ?? 0) }}</dd>
          </div>
          <div>
            <dt>{{ t('dossier.earned') }}</dt>
            <dd class="pos">{{ money(figures.get(project.id)?.earned ?? 0) }}</dd>
          </div>
          <div>
            <dt>{{ t('finance.outstanding') }}</dt>
            <dd :class="{ neg: (figures.get(project.id)?.unpaid ?? 0) > 0 }">
              {{ money(figures.get(project.id)?.unpaid ?? 0) }}
            </dd>
          </div>
        </dl>

        <div class="project-foot">
          <span class="meta">
            <span v-if="project.endDate" :class="{ late: isLate(project) }">
              <AppIcon name="calendar" :size="13" />
              {{ isLate(project) ? t('projects.overdue') : formatDate(project.endDate) }}
            </span>
            <span v-if="openTasks.get(project.id)" class="tertiary">
              <AppIcon name="check" :size="13" />
              {{ t('projects.tasksOpen', { n: openTasks.get(project.id) }) }}
            </span>
          </span>
          <button v-if="canManage" class="btn btn-ghost btn-sm" @click="startEdit(project)">
            {{ t('common.edit') }}
          </button>
        </div>
      </article>
    </div>

    <p v-if="!loading && projects.length" class="tertiary foot">
      {{ activeCount }} / {{ projects.length }} · {{ t('projectStatus.active') }}
    </p>
  </div>
</template>

<style scoped>
.editor { border-color: var(--accent-soft-border); }
.search { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: var(--space-3); color: var(--text-tertiary); pointer-events: none; }
.search-input { padding-left: calc(var(--space-3) * 2 + 16px); }
.select.compact { max-width: 200px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--space-4); }
.project { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5); }
.project-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.project-id { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.project-name { font-size: var(--text-md); font-weight: 650; }
.link-quiet { font-size: var(--text-xs); color: var(--text-tertiary); text-align: left; }
.link-quiet:hover { color: var(--text-brand); text-decoration: underline; }
.project-desc { font-size: var(--text-sm); line-height: var(--leading-relaxed); }
.truncate-2 { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.progress { display: flex; align-items: center; gap: var(--space-3); }
.bar-track { flex: 1; height: 8px; border-radius: var(--radius-full); background: var(--bg-inset); overflow: hidden; }
.bar { display: block; height: 100%; border-radius: var(--radius-full); background: var(--accent); }
.progress-pct { font-size: var(--text-xs); font-weight: 650; font-variant-numeric: tabular-nums; }
.team-picker { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-2); }

.figures { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); margin: 0; }
.figures dt { font-size: var(--text-xs); color: var(--text-tertiary); margin-bottom: 2px; }
.figures dd { margin: 0; font-size: var(--text-sm); font-weight: 650; font-variant-numeric: tabular-nums; }
.pos { color: var(--ok-500); }
.neg { color: var(--warn-500); }

.project-foot {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
  margin-top: auto; padding-top: var(--space-3); border-top: 1px solid var(--border-subtle);
}
.meta { display: flex; align-items: center; gap: var(--space-3); font-size: var(--text-xs); color: var(--text-secondary); }
.meta span { display: inline-flex; align-items: center; gap: 4px; }
.late { color: var(--danger-500); font-weight: 600; }

.st-active { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.st-on_hold { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.st-completed { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); color: var(--text-brand); }
.st-cancelled, .st-draft { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }
.foot { font-size: var(--text-xs); }
</style>
