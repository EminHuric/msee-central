<script setup lang="ts">
/**
 * Organization — departments and positions.
 *
 * Departments and positions are reference data every employee profile points
 * at. Both are deactivated rather than deleted: an employee who once held a
 * position keeps a valid reference to it, and deleting the record would leave
 * their history pointing at nothing.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import {
  saveDepartment,
  savePosition,
  slugify,
  type DepartmentInput,
  type PositionInput,
} from '@/api/administration'
import { fetchEmployees } from '@/api/employees'
import { departmentName, fetchDepartments, fetchPositions } from '@/api/organisation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { LIMITS } from '@/lib/validation'
import type { Department, EmployeePublic, Position } from '@/types/domain'
import { PERMISSIONS } from '@/types/permissions'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const loading = ref(true)
const departments = ref<Department[]>([])
const positions = ref<Position[]>([])
const employees = ref<EmployeePublic[]>([])

const canManageDepartments = computed(() => auth.hasPermission(PERMISSIONS.DEPARTMENTS_MANAGE))
const canManagePositions = computed(() => auth.hasPermission(PERMISSIONS.POSITIONS_MANAGE))

const departmentDraft = ref<DepartmentInput | null>(null)
const positionDraft = ref<PositionInput | null>(null)
const savingDepartment = ref(false)
const savingPosition = ref(false)

/** How many people sit in a department or hold a position. */
function departmentUsage(id: string): number {
  return employees.value.filter((e) => e.departmentId === id).length
}

function positionUsage(id: string): number {
  return employees.value.filter((e) => e.positionId === id).length
}

async function load(): Promise<void> {
  loading.value = true
  const [deps, pos, people] = await Promise.all([
    fetchDepartments().catch(() => []),
    fetchPositions().catch(() => []),
    fetchEmployees().catch(() => []),
  ])
  departments.value = deps
  positions.value = pos
  employees.value = people
  loading.value = false
}

/* ---- Departments ------------------------------------------------- */

function newDepartment(): void {
  departmentDraft.value = { id: '', name: '', nameSr: '', description: '', status: 'active' }
}

function editDepartment(department: Department): void {
  departmentDraft.value = {
    id: department.id,
    name: department.name,
    nameSr: department.nameSr,
    description: department.description ?? '',
    status: department.status,
  }
}

async function commitDepartment(): Promise<void> {
  const draft = departmentDraft.value
  if (!draft || !draft.name.trim() || savingDepartment.value) return

  // The id is derived once from the first name given and then frozen, so a
  // later rename cannot orphan the employees pointing at it.
  const isNew = draft.id === ''
  const id = isNew ? slugify(draft.name) : draft.id
  if (!id) return

  savingDepartment.value = true
  try {
    await saveDepartment({ ...draft, id }, isNew)
    ui.notify('ok', t('organisation.saved'))
    departmentDraft.value = null
    await load()
  } catch {
    ui.notify('danger', t('organisation.saveFailed'))
  } finally {
    savingDepartment.value = false
  }
}

/* ---- Positions --------------------------------------------------- */

function newPosition(): void {
  positionDraft.value = {
    id: '',
    title: '',
    titleSr: '',
    departmentId: null,
    description: '',
    status: 'active',
  }
}

function editPosition(position: Position): void {
  positionDraft.value = {
    id: position.id,
    title: position.title,
    titleSr: position.titleSr,
    departmentId: position.departmentId,
    description: position.description ?? '',
    status: position.status,
  }
}

async function commitPosition(): Promise<void> {
  const draft = positionDraft.value
  if (!draft || !draft.title.trim() || savingPosition.value) return

  const isNew = draft.id === ''
  const id = isNew ? slugify(draft.title) : draft.id
  if (!id) return

  savingPosition.value = true
  try {
    await savePosition({ ...draft, id }, isNew)
    ui.notify('ok', t('organisation.saved'))
    positionDraft.value = null
    await load()
  } catch {
    ui.notify('danger', t('organisation.saveFailed'))
  } finally {
    savingPosition.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('nav2.organization') }}</h1>
        <p class="page-subtitle">{{ t('organisation.positionVsRole') }}</p>
      </div>
    </header>

    <!-- Departments ---------------------------------------------------- -->
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">{{ t('organisation.departments') }}</h2>
        <button
          v-if="canManageDepartments && !departmentDraft"
          class="btn btn-secondary btn-sm"
          @click="newDepartment"
        >
          <AppIcon name="plus" :size="15" />
          {{ t('organisation.addDepartment') }}
        </button>
      </div>

      <div v-if="departmentDraft" class="card-body draft">
        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="d-name">{{ t('organisation.nameEn') }}</label>
            <input id="d-name" v-model="departmentDraft.name" class="input" :maxlength="LIMITS.name" />
          </div>
          <div class="field">
            <label class="field-label" for="d-namesr">{{ t('organisation.nameSr') }}</label>
            <input id="d-namesr" v-model="departmentDraft.nameSr" class="input" :maxlength="LIMITS.name" />
          </div>
          <div class="field">
            <label class="field-label" for="d-status">{{ t('employees.filterStatus') }}</label>
            <select id="d-status" v-model="departmentDraft.status" class="select">
              <option value="active">{{ t('organisation.statusActive') }}</option>
              <option value="inactive">{{ t('organisation.statusInactive') }}</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="d-desc">{{ t('organisation.description') }}</label>
          <input id="d-desc" v-model="departmentDraft.description" class="input" :maxlength="LIMITS.shortText" />
        </div>

        <div class="row draft-actions">
          <button class="btn btn-primary btn-sm" :disabled="savingDepartment" @click="commitDepartment">
            <span v-if="savingDepartment" class="spinner" />
            {{ t('common.save') }}
          </button>
          <button class="btn btn-ghost btn-sm" @click="departmentDraft = null">
            {{ t('common.cancel') }}
          </button>
        </div>
      </div>

      <div v-if="loading" class="card-body">
        <div class="skeleton" style="height: 60px" />
      </div>

      <div v-else-if="departments.length === 0 && !departmentDraft" class="empty">
        <span class="empty-icon"><AppIcon name="building" :size="20" /></span>
        <p class="empty-title">{{ t('organisation.emptyDepartments') }}</p>
        <p class="empty-text">{{ t('organisation.emptyDepartmentsHint') }}</p>
      </div>

      <div v-else-if="departments.length" class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('organisation.nameEn') }}</th>
              <th>{{ t('organisation.nameSr') }}</th>
              <th>{{ t('employees.filterStatus') }}</th>
              <th>{{ t('employees.title') }}</th>
              <th class="col-actions" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in departments" :key="d.id">
              <td>{{ d.name }}</td>
              <td class="muted">{{ d.nameSr }}</td>
              <td>
                <span class="badge" :class="d.status === 'active' ? 'badge-active' : 'badge-deactivated'">
                  {{ d.status === 'active' ? t('organisation.statusActive') : t('organisation.statusInactive') }}
                </span>
              </td>
              <td class="muted">{{ departmentUsage(d.id) }}</td>
              <td class="col-actions">
                <button
                  v-if="canManageDepartments"
                  class="btn btn-ghost btn-sm"
                  @click="editDepartment(d)"
                >
                  {{ t('common.edit') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Positions ------------------------------------------------------ -->
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">{{ t('organisation.positions') }}</h2>
        <button
          v-if="canManagePositions && !positionDraft"
          class="btn btn-secondary btn-sm"
          @click="newPosition"
        >
          <AppIcon name="plus" :size="15" />
          {{ t('organisation.addPosition') }}
        </button>
      </div>

      <div v-if="positionDraft" class="card-body draft">
        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="p-title">{{ t('organisation.titleEn') }}</label>
            <input id="p-title" v-model="positionDraft.title" class="input" :maxlength="LIMITS.position" />
          </div>
          <div class="field">
            <label class="field-label" for="p-titlesr">{{ t('organisation.titleSr') }}</label>
            <input id="p-titlesr" v-model="positionDraft.titleSr" class="input" :maxlength="LIMITS.position" />
          </div>
          <div class="field">
            <label class="field-label" for="p-dep">{{ t('organisation.parentDepartment') }}</label>
            <select id="p-dep" v-model="positionDraft.departmentId" class="select">
              <option :value="null">{{ t('manage.noneSelected') }}</option>
              <option v-for="d in departments" :key="d.id" :value="d.id">{{ departmentName(d) }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="p-status">{{ t('employees.filterStatus') }}</label>
            <select id="p-status" v-model="positionDraft.status" class="select">
              <option value="active">{{ t('organisation.statusActive') }}</option>
              <option value="inactive">{{ t('organisation.statusInactive') }}</option>
            </select>
          </div>
        </div>

        <div class="row draft-actions">
          <button class="btn btn-primary btn-sm" :disabled="savingPosition" @click="commitPosition">
            <span v-if="savingPosition" class="spinner" />
            {{ t('common.save') }}
          </button>
          <button class="btn btn-ghost btn-sm" @click="positionDraft = null">
            {{ t('common.cancel') }}
          </button>
        </div>
      </div>

      <div v-if="loading" class="card-body">
        <div class="skeleton" style="height: 60px" />
      </div>

      <div v-else-if="positions.length === 0 && !positionDraft" class="empty">
        <span class="empty-icon"><AppIcon name="users" :size="20" /></span>
        <p class="empty-title">{{ t('organisation.emptyPositions') }}</p>
        <p class="empty-text">{{ t('organisation.emptyPositionsHint') }}</p>
      </div>

      <div v-else-if="positions.length" class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('organisation.titleEn') }}</th>
              <th>{{ t('organisation.parentDepartment') }}</th>
              <th>{{ t('employees.filterStatus') }}</th>
              <th>{{ t('employees.title') }}</th>
              <th class="col-actions" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in positions" :key="p.id">
              <td>
                {{ p.title }}
                <span v-if="p.titleSr && p.titleSr !== p.title" class="muted"> · {{ p.titleSr }}</span>
              </td>
              <td class="muted">
                {{ departmentName(departments.find((d) => d.id === p.departmentId)) ?? '—' }}
              </td>
              <td>
                <span class="badge" :class="p.status === 'active' ? 'badge-active' : 'badge-deactivated'">
                  {{ p.status === 'active' ? t('organisation.statusActive') : t('organisation.statusInactive') }}
                </span>
              </td>
              <td class="muted">{{ positionUsage(p.id) }}</td>
              <td class="col-actions">
                <button v-if="canManagePositions" class="btn btn-ghost btn-sm" @click="editPosition(p)">
                  {{ t('common.edit') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.draft {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  background: var(--bg-surface-2);
  border-bottom: 1px solid var(--border-subtle);
}

.draft-actions {
  justify-content: flex-end;
}

</style>
