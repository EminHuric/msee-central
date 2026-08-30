<script setup lang="ts">
/**
 * Employee directory.
 *
 * Only the professional tier is fetched here — no personal field is requested
 * for anybody. A phone number cannot leak from a list that never asks for one,
 * which is why the card shows position and department and nothing else.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { fetchEmployees } from '@/api/employees'
import {
  departmentName,
  fetchDepartments,
  fetchPositions,
  indexById,
  lookupLabel,
  positionName,
} from '@/api/organisation'
import { formatDate } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { ACCOUNT_STATUSES, type AccountStatus, type Department, type EmployeePublic, type Position } from '@/types/domain'

const auth = useAuthStore()
const { t } = useI18n()

const loading = ref(true)
const loadError = ref(false)
const employees = ref<EmployeePublic[]>([])
const departments = ref<Department[]>([])
const positions = ref<Position[]>([])

const search = ref('')
const statusFilter = ref<AccountStatus | ''>('')
const departmentFilter = ref('')

const departmentIndex = computed(() => indexById(departments.value))
const positionIndex = computed(() => indexById(positions.value))

function labelFor(employee: EmployeePublic): { position: string | null; department: string | null } {
  return {
    position: lookupLabel(positionIndex.value, employee.positionId, positionName),
    department: lookupLabel(departmentIndex.value, employee.departmentId, departmentName),
  }
}

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()

  return employees.value.filter((employee) => {
    if (statusFilter.value && employee.status !== statusFilter.value) return false
    if (departmentFilter.value && employee.departmentId !== departmentFilter.value) return false
    if (!term) return true

    const { position, department } = labelFor(employee)
    const haystack = [
      employee.firstName,
      employee.lastName,
      employee.employeeCode,
      position ?? '',
      department ?? '',
      ...(employee.skills ?? []),
      ...(employee.expertise ?? []),
    ]
      .join(' ')
      .toLowerCase()

    return haystack.includes(term)
  })
})

const hasFilters = computed(
  () => search.value.trim() !== '' || statusFilter.value !== '' || departmentFilter.value !== '',
)

function clearFilters(): void {
  search.value = ''
  statusFilter.value = ''
  departmentFilter.value = ''
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = false

  try {
    // Departments and positions are reference data; failing to read them is not
    // fatal, the directory just falls back to showing raw identifiers.
    const [people, deps, pos] = await Promise.all([
      fetchEmployees(),
      fetchDepartments().catch(() => []),
      fetchPositions().catch(() => []),
    ])
    employees.value = people
    departments.value = deps
    positions.value = pos
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('employees.title') }}</h1>
        <p class="page-subtitle">{{ t('employees.subtitle') }}</p>
      </div>
      <span v-if="!loading" class="badge badge-plain">
        {{ t('common.results', filtered.length, { named: { n: filtered.length } }) }}
      </span>
    </header>

    <!-- Toolbar -------------------------------------------------------- -->
    <div class="toolbar">
      <div class="search toolbar-grow">
        <AppIcon name="search" :size="16" class="search-icon" />
        <input
          v-model="search"
          class="input search-input"
          type="search"
          :placeholder="t('employees.searchPlaceholder')"
          :aria-label="t('common.search')"
        />
      </div>

      <select v-model="statusFilter" class="select" :aria-label="t('employees.filterStatus')">
        <option value="">{{ t('employees.allStatuses') }}</option>
        <option v-for="s in ACCOUNT_STATUSES" :key="s" :value="s">{{ t(`status.${s}`) }}</option>
      </select>

      <select
        v-if="departments.length"
        v-model="departmentFilter"
        class="select"
        :aria-label="t('employees.filterDepartment')"
      >
        <option value="">{{ t('employees.allDepartments') }}</option>
        <option v-for="d in departments" :key="d.id" :value="d.id">
          {{ departmentName(d) }}
        </option>
      </select>

      <button v-if="hasFilters" type="button" class="btn btn-ghost" @click="clearFilters">
        {{ t('common.clear') }}
      </button>
    </div>

    <!-- Loading -------------------------------------------------------- -->
    <div v-if="loading" class="grid">
      <div v-for="n in 6" :key="n" class="card skeleton-card">
        <div class="skeleton" style="width: 60px; height: 60px; border-radius: 999px" />
        <div class="skeleton" style="height: 15px; width: 60%" />
        <div class="skeleton" style="height: 12px; width: 40%" />
      </div>
    </div>

    <!-- Error ---------------------------------------------------------- -->
    <div v-else-if="loadError" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="alert" :size="20" /></span>
        <p class="empty-title">{{ t('errors.generic') }}</p>
        <button class="btn btn-secondary" @click="load">{{ t('common.retry') }}</button>
      </div>
    </div>

    <!-- Empty ---------------------------------------------------------- -->
    <div v-else-if="filtered.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="users" :size="20" /></span>
        <p class="empty-title">
          {{ employees.length === 0 ? t('employees.emptyAll') : t('employees.empty') }}
        </p>
        <p class="empty-text">
          {{ employees.length === 0 ? t('employees.emptyAllHint') : t('employees.emptyHint') }}
        </p>
        <button v-if="hasFilters" class="btn btn-secondary" @click="clearFilters">
          {{ t('common.clear') }}
        </button>
      </div>
    </div>

    <!-- Directory ------------------------------------------------------ -->
    <div v-else class="grid">
      <RouterLink
        v-for="employee in filtered"
        :key="employee.uid"
        :to="`/employees/${employee.uid}`"
        class="card person"
      >
        <UserAvatar
          :name="`${employee.firstName} ${employee.lastName}`"
          :photo-url="employee.photoUrl"
          :size="64"
        />

        <div class="person-body">
          <p class="person-name truncate">
            {{ employee.firstName }} {{ employee.lastName }}
            <span v-if="employee.uid === auth.uid" class="badge badge-plain badge-accent person-you">
              {{ t('employees.you') }}
            </span>
          </p>

          <p class="person-position truncate">
            {{ labelFor(employee).position ?? t('employees.noPosition') }}
          </p>

          <p v-if="labelFor(employee).department" class="person-department truncate">
            {{ labelFor(employee).department }}
          </p>
        </div>

        <div class="person-foot">
          <StatusBadge :status="employee.status" />
          <span class="tertiary person-joined">
            {{ t('employees.joined', { date: formatDate(employee.dateJoined) }) }}
          </span>
        </div>

        <ul v-if="employee.skills?.length" class="person-skills">
          <li v-for="skill in employee.skills.slice(0, 3)" :key="skill" class="person-skill">
            {{ skill }}
          </li>
          <li v-if="employee.skills.length > 3" class="person-skill person-skill-more">
            +{{ employee.skills.length - 3 }}
          </li>
        </ul>
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.search {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: var(--space-3);
  color: var(--text-tertiary);
  pointer-events: none;
}

.search-input {
  padding-left: calc(var(--space-3) * 2 + 16px);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
  gap: var(--space-4);
}

.skeleton-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-6);
}

.person {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-6) var(--space-5);
  text-align: center;
  text-decoration: none;
  color: inherit;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.person:hover {
  text-decoration: none;
  border-color: var(--accent-soft-border);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.person-body {
  width: 100%;
  min-width: 0;
}

.person-name {
  font-size: var(--text-md);
  font-weight: 620;
  letter-spacing: -0.008em;
}

.person-you {
  margin-left: var(--space-2);
  vertical-align: middle;
}

.person-position {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  margin-top: var(--space-1);
}

.person-department {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.person-foot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.person-joined {
  font-size: var(--text-xs);
}

.person-skills {
  list-style: none;
  padding: var(--space-3) 0 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
  border-top: 1px solid var(--border-subtle);
  width: 100%;
}

.person-skill {
  padding: 2px var(--space-2);
  background: var(--bg-surface-3);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.person-skill-more {
  color: var(--text-tertiary);
}
</style>
