<script setup lang="ts">
/**
 * One project.
 *
 * The page answers, in order: what is this, why does it exist, who is on it,
 * which clients it is for, how far along it is, and what it has brought in.
 * Editing happens in place — a project is a living thing and sending somebody
 * to a separate form to add a client is how the client list stops being true.
 *
 * Money is read from the sales tagged with this project, never stored on it.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import CustomFields from '@/components/CustomFields.vue'
import NotesPanel from '@/components/NotesPanel.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { fetchClients } from '@/api/clients'
import { fetchEmployees } from '@/api/employees'
import { deleteProject, fetchProject, fetchServices, projectProgress, saveProject } from '@/api/operations'
import { fetchSalesForProject } from '@/api/sales'
import { fetchTransactions } from '@/api/finance'
import { fetchActivityFor, fieldsFor, fetchFieldDefs } from '@/api/records'
import { processProfilePhoto } from '@/api/photos'
import { formatDate, formatRelative } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import {
  PRIORITIES,
  PROJECT_STATUSES,
  type Client,
  type Milestone,
  type Project,
  type Service,
} from '@/types/business'
import { OUTGOING_TYPES, balanceOf, type Sale, type Transaction } from '@/types/revenue'
import { BASE_CURRENCY, CURRENCIES, formatMoney, fromMinor, type CurrencyCode } from '@/types/money'
import { moneyOf } from '@/api/sales'
import type { ActivityEntry, CustomFieldDef } from '@/types/records'
import { PERMISSIONS } from '@/types/permissions'
import type { EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()

const projectId = computed(() => String(route.params.id ?? ''))

const loading = ref(true)
const saving = ref(false)
const notFound = ref(false)

const project = ref<Project | null>(null)
const clients = ref<Client[]>([])
const services = ref<Service[]>([])
const people = ref<EmployeePublic[]>([])
const sales = ref<Sale[]>([])
const transactions = ref<Transaction[]>([])
const activity = ref<ActivityEntry[]>([])
const fieldDefs = ref<CustomFieldDef[]>([])

const editing = ref(false)
const draft = ref<Project | null>(null)
const draftBudget = ref(0)
const draftCurrency = ref<CurrencyCode>(BASE_CURRENCY)
const newMilestone = ref('')
const newMilestoneDate = ref('')
const pendingDelete = ref(false)

const today = new Date().toISOString().slice(0, 10)

const canEdit = computed(() => auth.hasPermission(PERMISSIONS.PROJECTS_EDIT))
const canDelete = computed(() => auth.hasPermission(PERMISSIONS.PROJECTS_DELETE))
const canMoney = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_VIEW))

const projectFields = computed(() => fieldsFor(fieldDefs.value, 'project'))

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

const clientNames = computed(() => new Map(clients.value.map((c) => [c.id, c])))
const peopleByUid = computed(() => new Map(people.value.map((p) => [p.uid, p])))

const progress = computed(() => (project.value ? projectProgress(project.value) : null))

/** Sold, collected and spent — read from the sales and costs tagged here. */
const figures = computed(() => {
  const balances = sales.value.map((s) => balanceOf(s, transactions.value))

  return {
    salesCount: sales.value.length,
    sold: balances.reduce((n, b) => n + b.valueBaseMinor, 0),
    collected: balances.reduce((n, b) => n + b.paidBaseMinor, 0),
    outstanding: balances.reduce((n, b) => n + b.remainingBaseMinor, 0),
    spent: transactions.value
      .filter(
        (tx) =>
          tx.projectId === projectId.value && tx.status === 'paid' && OUTGOING_TYPES.includes(tx.type),
      )
      .reduce((n, tx) => n + tx.amount.baseMinor, 0),
  }
})

const isLate = computed(
  () =>
    !!project.value?.endDate &&
    project.value.endDate < today &&
    project.value.status !== 'completed' &&
    project.value.status !== 'cancelled',
)

async function load(): Promise<void> {
  if (!projectId.value) return
  loading.value = true
  notFound.value = false

  try {
    const [found, c, sv, e, sl, tx, act, defs] = await Promise.all([
      fetchProject(projectId.value),
      fetchClients().catch(() => []),
      fetchServices().catch(() => []),
      fetchEmployees().catch(() => []),
      fetchSalesForProject(projectId.value).catch(() => []),
      fetchTransactions().catch(() => []),
      fetchActivityFor('projects', projectId.value).catch(() => []),
      fetchFieldDefs().catch(() => []),
    ])

    if (!found || found.deletedAt) {
      notFound.value = true
      return
    }

    project.value = found
    clients.value = c
    services.value = sv
    people.value = e
    sales.value = sl
    transactions.value = tx
    activity.value = act
    fieldDefs.value = defs
  } catch {
    notFound.value = true
  } finally {
    loading.value = false
  }
}

function startEdit(): void {
  if (!project.value) return
  draft.value = {
    ...project.value,
    clientIds: [...(project.value.clientIds ?? [])],
    teamUids: [...(project.value.teamUids ?? [])],
    milestones: (project.value.milestones ?? []).map((m) => ({ ...m })),
  }
  draftBudget.value = project.value.budget
    ? fromMinor(project.value.budget.minor, project.value.budget.currency)
    : 0
  draftCurrency.value = project.value.budget?.currency ?? BASE_CURRENCY
  editing.value = true
}

function toggleClient(id: string): void {
  const list = draft.value?.clientIds
  if (!list) return
  const i = list.indexOf(id)
  if (i >= 0) list.splice(i, 1)
  else list.push(id)
}

function toggleMember(uid: string): void {
  const list = draft.value?.teamUids
  if (!list) return
  const i = list.indexOf(uid)
  if (i >= 0) list.splice(i, 1)
  else list.push(uid)
}

function addMilestone(): void {
  const title = newMilestone.value.trim()
  if (!title || !draft.value) return

  draft.value.milestones.push({
    id: Math.random().toString(36).slice(2, 10),
    title,
    dueDate: newMilestoneDate.value || null,
    done: false,
    doneAt: null,
  })
  newMilestone.value = ''
  newMilestoneDate.value = ''
}

function removeMilestone(milestone: Milestone): void {
  const list = draft.value?.milestones
  if (!list) return
  const i = list.findIndex((m) => m.id === milestone.id)
  if (i >= 0) list.splice(i, 1)
}

async function onCover(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !draft.value) return

  try {
    draft.value.coverUrl = await processProfilePhoto(file)
  } catch {
    ui.notify('danger', t('projects.coverFailed'))
  }
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.name.trim()) {
    ui.notify('danger', t('projects.nameRequired'))
    return
  }

  const previousTeam = project.value?.teamUids ?? []

  saving.value = true
  try {
    await saveProject(
      {
        ...d,
        name: d.name.trim(),
        ownerName: peopleName(d.ownerUid),
        serviceName: services.value.find((s) => s.id === d.serviceId)?.name ?? '',
        budget: draftBudget.value ? moneyOf(draftBudget.value, draftCurrency.value) : null,
      },
      previousTeam,
    )
    ui.notify('ok', t('projects.saved'))
    editing.value = false
    await load()
  } catch {
    ui.notify('danger', t('projects.saveFailed'))
  } finally {
    saving.value = false
  }
}

function peopleName(uid: string | null): string {
  const person = uid ? peopleByUid.value.get(uid) : null
  return person ? `${person.firstName} ${person.lastName}` : ''
}

/** Ticking a milestone off is a one-click act, not an edit session. */
async function toggleMilestone(milestone: Milestone): Promise<void> {
  if (!project.value || !canEdit.value) return

  const milestones = project.value.milestones.map((m) =>
    m.id === milestone.id
      ? { ...m, done: !m.done, doneAt: !m.done ? new Date().toISOString() : null }
      : m,
  )

  await saveProject({ ...project.value, milestones })
  await load()
}

async function confirmDelete(): Promise<void> {
  if (!project.value) return
  await deleteProject(project.value)
  ui.notify('ok', t('recycle.movedToBin'))
  await router.push('/projects')
}

onMounted(load)
watch(projectId, load)
</script>

<template>
  <div class="page">
    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 60px" />
      </div>
    </div>

    <div v-else-if="notFound || !project" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="alert" :size="20" /></span>
        <p class="empty-title">{{ t('projects.notFound') }}</p>
        <button class="btn btn-secondary" @click="router.push('/projects')">
          {{ t('projects.title') }}
        </button>
      </div>
    </div>

    <template v-else>
      <!-- Header ------------------------------------------------------- -->
      <header class="hero card">
        <div v-if="project.coverUrl" class="hero-cover">
          <img :src="project.coverUrl" :alt="project.name" />
        </div>

        <div class="hero-body">
          <div class="hero-text">
            <h1 class="page-title">{{ project.name }}</h1>
            <p v-if="project.objective" class="objective">{{ project.objective }}</p>
            <p v-if="project.description" class="page-subtitle">{{ project.description }}</p>

            <div class="hero-meta">
              <span class="badge" :class="`ps-${project.status}`">
                {{ t(`projectStatus.${project.status}`) }}
              </span>
              <span class="badge badge-plain">{{ t(`priority.${project.priority}`) }}</span>
              <span v-if="project.serviceName" class="tertiary">{{ project.serviceName }}</span>
              <span v-if="project.startDate" class="tertiary">
                {{ formatDate(project.startDate) }}
                <template v-if="project.endDate"> → </template>
              </span>
              <span v-if="project.endDate" class="tertiary" :class="{ late: isLate }">
                {{ formatDate(project.endDate) }}
              </span>
            </div>
          </div>

          <div class="hero-actions">
            <button v-if="canEdit && !editing" class="btn btn-secondary" @click="startEdit">
              <AppIcon name="edit" :size="15" /> {{ t('common.edit') }}
            </button>
            <button v-if="canDelete" class="btn btn-ghost danger" @click="pendingDelete = true">
              <AppIcon name="trash" :size="15" />
            </button>
          </div>
        </div>

        <div v-if="progress !== null" class="hero-progress">
          <span class="bar-track">
            <span class="bar" :style="{ width: `${progress}%` }" />
          </span>
          <span class="progress-pct">{{ progress }}%</span>
        </div>
      </header>

      <!-- Editor ------------------------------------------------------- -->
      <section v-if="editing && draft" class="card editor">
        <div class="card-header">
          <h2 class="card-title">{{ t('projects.editProject') }}</h2>
          <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="editing = false">
            <AppIcon name="close" :size="18" />
          </button>
        </div>

        <div class="card-body stack">
          <div class="field-grid">
            <div class="field">
              <label class="field-label" for="e-name">
                {{ t('projects.name') }}<span class="req">*</span>
              </label>
              <input id="e-name" v-model="draft.name" class="input" maxlength="120" />
            </div>
            <div class="field">
              <label class="field-label" for="e-objective">{{ t('projects.objective') }}</label>
              <input id="e-objective" v-model="draft.objective" class="input" maxlength="200" />
            </div>
            <div class="field">
              <label class="field-label" for="e-status">{{ t('table.status') }}</label>
              <select id="e-status" v-model="draft.status" class="select">
                <option v-for="s in PROJECT_STATUSES" :key="s" :value="s">
                  {{ t(`projectStatus.${s}`) }}
                </option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="e-priority">{{ t('table.priority') }}</label>
              <select id="e-priority" v-model="draft.priority" class="select">
                <option v-for="p in PRIORITIES" :key="p" :value="p">{{ t(`priority.${p}`) }}</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="e-owner">{{ t('projects.owner') }}</label>
              <select id="e-owner" v-model="draft.ownerUid" class="select">
                <option :value="null">—</option>
                <option v-for="p in people" :key="p.uid" :value="p.uid">
                  {{ p.firstName }} {{ p.lastName }}
                </option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="e-service">{{ t('table.service') }}</label>
              <select id="e-service" v-model="draft.serviceId" class="select">
                <option :value="null">—</option>
                <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="e-start">{{ t('projects.startDate') }}</label>
              <input id="e-start" v-model="draft.startDate" class="input" type="date" />
            </div>
            <div class="field">
              <label class="field-label" for="e-end">{{ t('projects.deadline') }}</label>
              <input id="e-end" v-model="draft.endDate" class="input" type="date" />
            </div>
            <div class="field">
              <label class="field-label" for="e-budget">{{ t('projects.budget') }}</label>
              <input id="e-budget" v-model.number="draftBudget" class="input" type="number" step="0.01" />
            </div>
            <div class="field">
              <label class="field-label" for="e-cur">{{ t('finance.currency') }}</label>
              <select id="e-cur" v-model="draftCurrency" class="select">
                <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
          </div>

          <div class="field">
            <label class="field-label" for="e-desc">{{ t('projects.description') }}</label>
            <textarea id="e-desc" v-model="draft.description" class="textarea" :maxlength="LIMITS.longText" />
          </div>

          <div class="field">
            <label class="field-label" for="e-cover">{{ t('projects.cover') }}</label>
            <input id="e-cover" class="input" type="file" accept="image/*" @change="onCover" />
            <p class="field-hint">{{ t('projects.coverHint') }}</p>
          </div>

          <!-- Clients: many, and removable ---------------------------- -->
          <div class="field">
            <span class="field-label">{{ t('projects.clients') }}</span>
            <p class="field-hint">{{ t('projects.clientsHint') }}</p>
            <div class="picker">
              <label v-for="c in clients" :key="c.id" class="check">
                <input
                  type="checkbox"
                  :checked="draft.clientIds.includes(c.id)"
                  @change="toggleClient(c.id)"
                />
                <span class="check-text">{{ c.name }}</span>
              </label>
            </div>
          </div>

          <div class="field">
            <span class="field-label">{{ t('projects.team') }}</span>
            <div class="picker">
              <label v-for="p in people" :key="p.uid" class="check">
                <input
                  type="checkbox"
                  :checked="draft.teamUids.includes(p.uid)"
                  @change="toggleMember(p.uid)"
                />
                <span class="check-text">{{ p.firstName }} {{ p.lastName }}</span>
              </label>
            </div>
          </div>

          <!-- Milestones ----------------------------------------------- -->
          <div class="field">
            <span class="field-label">{{ t('projects.milestones') }}</span>
            <p class="field-hint">{{ t('projects.milestonesHint') }}</p>

            <ul v-if="draft.milestones.length" class="milestones">
              <li v-for="m in draft.milestones" :key="m.id">
                <label class="check">
                  <input v-model="m.done" type="checkbox" />
                  <span class="check-text" :class="{ 'is-done': m.done }">{{ m.title }}</span>
                </label>
                <input v-model="m.dueDate" class="input date" type="date" />
                <button
                  class="btn btn-ghost btn-sm danger"
                  :aria-label="t('common.delete')"
                  @click="removeMilestone(m)"
                >
                  <AppIcon name="close" :size="13" />
                </button>
              </li>
            </ul>

            <form class="add-row" @submit.prevent="addMilestone">
              <input
                v-model="newMilestone"
                class="input"
                :placeholder="t('projects.addMilestone')"
                maxlength="120"
              />
              <input v-model="newMilestoneDate" class="input date" type="date" />
              <button class="btn btn-secondary" type="submit"><AppIcon name="plus" :size="15" /></button>
            </form>
          </div>

          <CustomFields v-model="draft.custom" :fields="projectFields" can-see-management />
        </div>

        <div class="card-footer">
          <button class="btn btn-secondary" @click="editing = false">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="saving" @click="commit">
            <span v-if="saving" class="spinner" />{{ t('common.save') }}
          </button>
        </div>
      </section>

      <!-- Money -------------------------------------------------------- -->
      <div v-if="canMoney" class="figures">
        <article class="card figure">
          <span class="figure-label">{{ t('projects.budget') }}</span>
          <span class="figure-value">
            {{ project.budget ? money(project.budget.baseMinor) : '—' }}
          </span>
        </article>
        <article class="card figure">
          <span class="figure-label">{{ t('sales.sold') }}</span>
          <span class="figure-value">{{ money(figures.sold) }}</span>
          <span class="figure-hint">{{ figures.salesCount }}</span>
        </article>
        <article class="card figure">
          <span class="figure-label">{{ t('finance.collected') }}</span>
          <span class="figure-value pos">{{ money(figures.collected) }}</span>
        </article>
        <article class="card figure">
          <span class="figure-label">{{ t('finance.expenses') }}</span>
          <span class="figure-value neg">{{ money(figures.spent) }}</span>
        </article>
      </div>

      <!-- Body --------------------------------------------------------- -->
      <div class="columns">
        <div class="column">
          <!-- Clients ------------------------------------------------- -->
          <section class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('projects.clients') }}</h2>
              <span class="badge badge-plain">{{ (project.clientIds ?? []).length }}</span>
            </div>

            <p v-if="(project.clientIds ?? []).length === 0" class="card-body tertiary small">
              {{ t('projects.noClients') }}
            </p>

            <ul v-else class="linked">
              <li v-for="id in project.clientIds" :key="id">
                <UserAvatar
                  :name="clientNames.get(id)?.name ?? id"
                  :photo-url="clientNames.get(id)?.logoUrl ?? null"
                  :size="28"
                />
                <button type="button" class="linked-main link" @click="router.push(`/clients/${id}`)">
                  {{ clientNames.get(id)?.name ?? id }}
                </button>
                <span class="tertiary small">{{ clientNames.get(id)?.status ?? '' }}</span>
              </li>
            </ul>
          </section>

          <!-- Milestones ---------------------------------------------- -->
          <section class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('projects.milestones') }}</h2>
              <span v-if="progress !== null" class="badge badge-plain">{{ progress }}%</span>
            </div>

            <p v-if="(project.milestones ?? []).length === 0" class="card-body tertiary small">
              {{ t('projects.noMilestones') }}
            </p>

            <ul v-else class="milestone-list">
              <li v-for="m in project.milestones" :key="m.id">
                <button
                  type="button"
                  class="tick"
                  :class="{ 'is-on': m.done }"
                  :disabled="!canEdit"
                  :aria-label="m.title"
                  @click="toggleMilestone(m)"
                >
                  <AppIcon v-if="m.done" name="check" :size="12" />
                </button>
                <span class="milestone-title" :class="{ 'is-done': m.done }">{{ m.title }}</span>
                <span
                  v-if="m.dueDate"
                  class="tertiary small"
                  :class="{ late: !m.done && m.dueDate < today }"
                >
                  {{ formatDate(m.dueDate) }}
                </span>
              </li>
            </ul>
          </section>

          <!-- Sales ---------------------------------------------------- -->
          <section v-if="canMoney" class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('sales.title') }}</h2>
              <button class="btn btn-ghost btn-sm" @click="router.push('/sales')">
                {{ t('dashboard.seeAll') }}
              </button>
            </div>

            <p v-if="sales.length === 0" class="card-body tertiary small">{{ t('sales.empty') }}</p>

            <ul v-else class="linked">
              <li v-for="sale in sales" :key="sale.id">
                <span class="linked-main">{{ sale.title }}</span>
                <span class="tertiary small">{{ sale.clientName }}</span>
                <span class="linked-value">{{ money(sale.value.baseMinor) }}</span>
              </li>
            </ul>
          </section>
        </div>

        <div class="column">
          <!-- Team ----------------------------------------------------- -->
          <section class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('projects.team') }}</h2>
            </div>

            <ul class="linked">
              <li v-if="project.ownerUid">
                <UserAvatar
                  :name="peopleName(project.ownerUid)"
                  :photo-url="peopleByUid.get(project.ownerUid)?.photoUrl ?? null"
                  :size="28"
                />
                <span class="linked-main">{{ peopleName(project.ownerUid) }}</span>
                <span class="badge badge-plain">{{ t('projects.owner') }}</span>
              </li>
              <li v-for="uid in project.teamUids ?? []" :key="uid">
                <UserAvatar
                  :name="peopleName(uid)"
                  :photo-url="peopleByUid.get(uid)?.photoUrl ?? null"
                  :size="28"
                />
                <span class="linked-main">{{ peopleName(uid) }}</span>
              </li>
              <li v-if="!project.ownerUid && (project.teamUids ?? []).length === 0" class="tertiary small">
                {{ t('projects.noTeam') }}
              </li>
            </ul>
          </section>

          <NotesPanel entity="project" :entity-id="project.id" />

          <!-- Activity -------------------------------------------------- -->
          <section class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('activity.title') }}</h2>
            </div>

            <p v-if="activity.length === 0" class="card-body tertiary small">
              {{ t('activity.empty') }}
            </p>

            <ul v-else class="feed">
              <li v-for="entry in activity.slice(0, 15)" :key="entry.id">
                <UserAvatar :name="entry.actorName" :size="26" />
                <span class="feed-body">
                  <span class="feed-text">
                    <strong>{{ entry.actorName }}</strong>
                    · {{ t(`activityKind.${entry.kind}`) }}
                  </span>
                  <span class="feed-time tertiary">{{ formatRelative(entry.createdAt) }}</span>
                </span>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </template>

    <ConfirmDialog
      :open="pendingDelete"
      :title="t('projects.deleteProject')"
      :message="t('recycle.deleteExplain')"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = false"
    />
  </div>
</template>

<style scoped>
.hero { overflow: hidden; padding: 0; }
.hero-cover { height: 180px; }
.hero-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.hero-body { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); padding: var(--space-5); flex-wrap: wrap; }
.hero-text { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: var(--space-2); }
.objective { font-size: var(--text-md); font-weight: 550; color: var(--text-brand); }
.hero-meta { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; font-size: var(--text-xs); }
.hero-actions { display: flex; gap: var(--space-2); }
.hero-progress { display: flex; align-items: center; gap: var(--space-3); padding: 0 var(--space-5) var(--space-5); }

.editor { border-color: var(--accent-soft-border); }
.picker { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-2); max-height: 190px; overflow-y: auto; }

.milestones { list-style: none; margin: var(--space-2) 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.milestones li { display: flex; align-items: center; gap: var(--space-2); }
.milestones .is-done { text-decoration: line-through; color: var(--text-tertiary); }
.input.date { max-width: 165px; }
.add-row { display: flex; gap: var(--space-2); margin-top: var(--space-2); }
.add-row .input:first-child { flex: 1; }

.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--space-3); }
.figure { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4); }
.figure-label { font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.figure-value { font-size: var(--text-lg); font-weight: 700; font-variant-numeric: tabular-nums; }
.figure-hint { font-size: var(--text-xs); color: var(--text-tertiary); }

.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: var(--space-4); align-items: start; }
.column { display: flex; flex-direction: column; gap: var(--space-4); }

.linked { list-style: none; margin: 0; padding: 0; }
.linked li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-5); border-top: 1px solid var(--border-subtle); font-size: var(--text-sm); }
.linked-main { flex: 1; min-width: 0; font-weight: 550; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.linked-value { font-weight: 650; font-variant-numeric: tabular-nums; }

.milestone-list { list-style: none; margin: 0; padding: 0; }
.milestone-list li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-5); border-top: 1px solid var(--border-subtle); }
.tick { width: 18px; height: 18px; flex-shrink: 0; border: 1.5px solid var(--border-strong); border-radius: var(--radius-sm); display: grid; place-items: center; color: var(--accent-text); }
.tick.is-on { background: var(--accent); border-color: var(--accent); }
.tick:disabled { opacity: 0.5; }
.milestone-title { flex: 1; min-width: 0; font-size: var(--text-sm); }
.milestone-title.is-done { text-decoration: line-through; color: var(--text-tertiary); }

.bar-track { flex: 1; height: 8px; border-radius: var(--radius-full); background: var(--bg-inset); overflow: hidden; }
.bar { display: block; height: 100%; border-radius: var(--radius-full); background: var(--accent); }
.progress-pct { font-size: var(--text-sm); font-weight: 700; font-variant-numeric: tabular-nums; }

.feed { list-style: none; margin: 0; padding: 0; }
.feed li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-5); }
.feed-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.feed-text { font-size: var(--text-xs); }
.feed-time { font-size: 10px; }

.pos { color: var(--ok-500); }
.neg { color: var(--danger-500); }
.late { color: var(--danger-500); font-weight: 600; }
.small { font-size: var(--text-xs); }
.danger:hover { color: var(--danger-500); }

.ps-active { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.ps-planning { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); color: var(--text-brand); }
.ps-on_hold { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.ps-at_risk { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-500); }
.ps-completed, .ps-cancelled { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }
</style>
