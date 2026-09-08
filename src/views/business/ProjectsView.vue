<script setup lang="ts">
/**
 * Projects.
 *
 * A project is an initiative, not a job for one customer. "Apartment sales,
 * spring 2027" runs across a dozen clients; "Hotel marketing push" across six.
 * So a project holds MANY clients, and the clients are who it is for rather
 * than what it is.
 *
 * The card is deliberately visual — a cover image, an objective, a progress
 * bar — because a project is the one record somebody scans rather than reads.
 * Everything else is on its own page.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { fetchClients } from '@/api/clients'
import { fetchEmployees } from '@/api/employees'
import {
  blankProject,
  deleteProject,
  fetchProjects,
  fetchServices,
  projectProgress,
  saveProject,
} from '@/api/operations'
import { fetchSales } from '@/api/sales'
import { formatDate } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import {
  PROJECT_STATUSES,
  type Client,
  type Project,
  type ProjectStatus,
  type Service,
} from '@/types/business'
import type { Sale } from '@/types/revenue'
import { BASE_CURRENCY, formatMoney } from '@/types/money'
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
const services = ref<Service[]>([])
const people = ref<EmployeePublic[]>([])
const sales = ref<Sale[]>([])

const search = ref('')
const statusFilter = ref<ProjectStatus | ''>('')
const ownerFilter = ref('')

const pendingDelete = ref<Project | null>(null)
const creating = ref<Project | null>(null)

const today = new Date().toISOString().slice(0, 10)

const canCreate = computed(() => auth.hasPermission(PERMISSIONS.PROJECTS_CREATE))
const canDelete = computed(() => auth.hasPermission(PERMISSIONS.PROJECTS_DELETE))
const canMoney = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_VIEW))

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

const clientNames = computed(() => new Map(clients.value.map((c) => [c.id, c.name])))

/** What each project has sold, from the sales tagged with it. */
const sold = computed(() => {
  const map = new Map<string, number>()
  for (const sale of sales.value) {
    if (!sale.projectId) continue
    map.set(sale.projectId, (map.get(sale.projectId) ?? 0) + sale.value.baseMinor)
  }
  return map
})

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()

  return projects.value.filter((p) => {
    if (statusFilter.value && p.status !== statusFilter.value) return false
    if (ownerFilter.value && p.ownerUid !== ownerFilter.value) return false
    if (!term) return true
    return `${p.name} ${p.description} ${p.objective}`.toLowerCase().includes(term)
  })
})

function isLate(project: Project): boolean {
  return (
    !!project.endDate &&
    project.endDate < today &&
    project.status !== 'completed' &&
    project.status !== 'cancelled'
  )
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const [p, c, sv, e, sl] = await Promise.all([
      fetchProjects(),
      fetchClients().catch(() => []),
      fetchServices().catch(() => []),
      fetchEmployees().catch(() => []),
      fetchSales().catch(() => []),
    ])
    projects.value = p
    clients.value = c
    services.value = sv
    people.value = e
    sales.value = sl
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

/**
 * Creating a project asks four questions and then opens its page.
 *
 * The full editor — team, clients, milestones, cover — lives on the project
 * itself, because filling that in before the project exists is asking somebody
 * to plan a thing they have not started.
 */
function startNew(): void {
  const me = people.value.find((p) => p.uid === auth.uid)
  creating.value = {
    ...blankProject(
      auth.uid,
      me ? `${me.firstName} ${me.lastName}` : (auth.displayName ?? ''),
    ),
  }
}

async function commitNew(): Promise<void> {
  const d = creating.value
  if (!d || saving.value) return
  if (!d.name.trim()) {
    ui.notify('danger', t('projects.nameRequired'))
    return
  }

  saving.value = true
  try {
    const id = await saveProject({
      ...d,
      name: d.name.trim(),
      serviceName: services.value.find((s) => s.id === d.serviceId)?.name ?? '',
    })
    ui.notify('ok', t('projects.saved'))
    creating.value = null
    await router.push(`/projects/${id}`)
  } catch {
    ui.notify('danger', t('projects.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value) return
  await deleteProject(pendingDelete.value)
  ui.notify('ok', t('recycle.movedToBin'))
  pendingDelete.value = null
  await load()
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
      <button v-if="canCreate && !creating" class="btn btn-primary" @click="startNew">
        <AppIcon name="plus" :size="16" /> {{ t('projects.newProject') }}
      </button>
    </header>

    <!-- Create --------------------------------------------------------- -->
    <section v-if="creating" class="card editor">
      <div class="card-header">
        <h2 class="card-title">{{ t('projects.newProject') }}</h2>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="creating = null">
          <AppIcon name="close" :size="18" />
        </button>
      </div>

      <div class="card-body stack">
        <p class="field-hint">{{ t('projects.createHint') }}</p>

        <div class="field">
          <label class="field-label" for="p-name">
            {{ t('projects.name') }}<span class="req">*</span>
          </label>
          <input id="p-name" v-model="creating.name" class="input" maxlength="120" />
        </div>

        <div class="field">
          <label class="field-label" for="p-objective">{{ t('projects.objective') }}</label>
          <input id="p-objective" v-model="creating.objective" class="input" maxlength="200" />
          <p class="field-hint">{{ t('projects.objectiveHint') }}</p>
        </div>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="p-service">{{ t('table.service') }}</label>
            <select id="p-service" v-model="creating.serviceId" class="select">
              <option :value="null">—</option>
              <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="p-end">{{ t('projects.deadline') }}</label>
            <input id="p-end" v-model="creating.endDate" class="input" type="date" />
          </div>
        </div>
      </div>

      <div class="card-footer">
        <button class="btn btn-secondary" @click="creating = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="commitNew">
          <span v-if="saving" class="spinner" />{{ t('projects.createAndOpen') }}
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

      <select v-model="ownerFilter" class="select compact" :aria-label="t('projects.owner')">
        <option value="">{{ t('projects.allOwners') }}</option>
        <option v-for="p in people" :key="p.uid" :value="p.uid">
          {{ p.firstName }} {{ p.lastName }}
        </option>
      </select>
    </div>

    <!-- List ----------------------------------------------------------- -->
    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 120px" />
      </div>
    </div>

    <div v-else-if="visible.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="layers" :size="20" /></span>
        <p class="empty-title">
          {{ projects.length === 0 ? t('projects.empty') : t('projects.noMatch') }}
        </p>
        <p class="empty-text">{{ t('projects.emptyHint') }}</p>
        <button v-if="canCreate && projects.length === 0" class="btn btn-primary" @click="startNew">
          {{ t('projects.newProject') }}
        </button>
      </div>
    </div>

    <div v-else class="grid">
      <article v-for="project in visible" :key="project.id" class="card project">
        <button type="button" class="cover" @click="router.push(`/projects/${project.id}`)">
          <img v-if="project.coverUrl" :src="project.coverUrl" :alt="project.name" />
          <span v-else class="cover-blank"><AppIcon name="layers" :size="22" /></span>
          <span class="badge cover-badge" :class="`ps-${project.status}`">
            {{ t(`projectStatus.${project.status}`) }}
          </span>
        </button>

        <div class="project-body">
          <button type="button" class="project-head" @click="router.push(`/projects/${project.id}`)">
            <span class="project-name">{{ project.name }}</span>
            <span v-if="project.objective" class="tertiary truncate-2">{{ project.objective }}</span>
          </button>

          <div v-if="projectProgress(project) !== null" class="progress">
            <span class="bar-track">
              <span class="bar" :style="{ width: `${projectProgress(project)}%` }" />
            </span>
            <span class="progress-pct">{{ projectProgress(project) }}%</span>
          </div>

          <div class="meta">
            <span v-if="(project.clientIds ?? []).length" class="meta-item">
              <AppIcon name="building" :size="12" />
              {{ project.clientIds.length }}
            </span>
            <span v-if="(project.teamUids ?? []).length" class="meta-item">
              <AppIcon name="users" :size="12" />
              {{ project.teamUids.length }}
            </span>
            <span v-if="project.endDate" class="meta-item" :class="{ late: isLate(project) }">
              <AppIcon name="calendar" :size="12" />
              {{ formatDate(project.endDate) }}
            </span>
            <span v-if="canMoney && sold.get(project.id)" class="meta-item strong">
              {{ money(sold.get(project.id)!) }}
            </span>
          </div>

          <div v-if="(project.clientIds ?? []).length" class="chips">
            <span v-for="id in project.clientIds.slice(0, 3)" :key="id" class="badge badge-plain">
              {{ clientNames.get(id) ?? '—' }}
            </span>
            <span v-if="project.clientIds.length > 3" class="tertiary small">
              +{{ project.clientIds.length - 3 }}
            </span>
          </div>

          <div class="project-foot">
            <span class="tertiary small">{{ project.ownerName || '—' }}</span>
            <span class="spacer" />
            <button
              class="btn btn-ghost btn-sm"
              :aria-label="t('common.open')"
              @click="router.push(`/projects/${project.id}`)"
            >
              <AppIcon name="arrowRight" :size="15" />
            </button>
            <button
              v-if="canDelete"
              class="btn btn-ghost btn-sm danger"
              :aria-label="t('common.delete')"
              @click="pendingDelete = project"
            >
              <AppIcon name="trash" :size="15" />
            </button>
          </div>
        </div>
      </article>
    </div>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('projects.deleteProject')"
      :message="t('recycle.deleteExplain')"
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
.select.compact { max-width: 190px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--space-4); }
.project { display: flex; flex-direction: column; overflow: hidden; padding: 0; }

.cover { position: relative; display: block; width: 100%; height: 128px; background: var(--bg-inset); }
.cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cover-blank { display: grid; place-items: center; width: 100%; height: 100%; color: var(--text-tertiary); }
.cover-badge { position: absolute; top: var(--space-2); left: var(--space-2); }

.project-body { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); flex: 1; }
.project-head { display: flex; flex-direction: column; gap: 2px; text-align: left; }
.project-name { font-size: var(--text-md); font-weight: 650; }
.project-head:hover .project-name { color: var(--text-brand); }
.project-head .tertiary { font-size: var(--text-xs); line-height: var(--leading-relaxed); }
.truncate-2 { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

.progress { display: flex; align-items: center; gap: var(--space-3); }
.bar-track { flex: 1; height: 7px; border-radius: var(--radius-full); background: var(--bg-inset); overflow: hidden; }
.bar { display: block; height: 100%; border-radius: var(--radius-full); background: var(--accent); }
.progress-pct { font-size: var(--text-xs); font-weight: 650; font-variant-numeric: tabular-nums; }

.meta { display: flex; flex-wrap: wrap; gap: var(--space-3); font-size: var(--text-xs); color: var(--text-secondary); }
.meta-item { display: inline-flex; align-items: center; gap: 4px; }
.meta-item.strong { font-weight: 650; color: var(--text-brand); font-variant-numeric: tabular-nums; }
.late { color: var(--danger-500); font-weight: 600; }

.chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); }
.project-foot { display: flex; align-items: center; gap: var(--space-1); margin-top: auto; padding-top: var(--space-3); border-top: 1px solid var(--border-subtle); }
.spacer { flex: 1; }
.small { font-size: var(--text-xs); }
.danger:hover { color: var(--danger-500); }

.ps-active { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.ps-planning { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); color: var(--text-brand); }
.ps-on_hold { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.ps-at_risk { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-500); }
.ps-completed, .ps-cancelled { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }
</style>
