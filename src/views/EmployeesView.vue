<script setup lang="ts">
/**
 * Employees.
 *
 * Four tabs, because these are four different states of a person and mixing
 * them makes the main list useless: someone still waiting is not an employee,
 * and someone turned away never was.
 *
 *   Employees   active accounts — the working directory
 *   Pending     registration requests awaiting a decision
 *   Suspended   suspended and deactivated accounts, records intact
 *   Rejected    requests that were turned down, with the reason
 *
 * A table rather than cards: this is a list you scan, comparing position,
 * department and status across many rows at once. Cards are for browsing;
 * this is for working.
 *
 * Only the professional tier is fetched. No personal field is requested for
 * anybody, so nothing private can leak from a list that never asks for it.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import AddEmployeeForm from '@/components/AddEmployeeForm.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { nextEmployeeCode } from '@/api/approval'
import { fetchEmployees } from '@/api/employees'
import {
  departmentName,
  fetchDepartments,
  fetchPositions,
  indexById,
  lookupLabel,
  positionName,
} from '@/api/organisation'
import { fetchRoles, ownerRank, roleName } from '@/api/roles'
import { useAuthStore } from '@/stores/auth'
import { ACCOUNT_TYPES, type AccountType } from '@/types/domain'
import type {
  Department,
  EmployeePublic,
  Position,
  Role,
} from '@/types/domain'
import { PERMISSIONS } from '@/types/permissions'

const auth = useAuthStore()
const { t } = useI18n()

type Tab = 'employees' | 'suspended'

const tab = ref<Tab>('employees')
const loading = ref(true)
const loadError = ref(false)

const employees = ref<EmployeePublic[]>([])
const departments = ref<Department[]>([])
const positions = ref<Position[]>([])
const roles = ref<Role[]>([])

const search = ref('')
const departmentFilter = ref('')
const typeFilter = ref<AccountType | ''>('')

/*
 * Creating an account outright touches both the employee profile and the
 * access document, so it needs the permission behind each. Anything less and
 * the write would be refused halfway by the rules.
 */
const canCreateAccounts = computed(() =>
  auth.hasAll(PERMISSIONS.REQUESTS_APPROVE, PERMISSIONS.ROLES_ASSIGN),
)

const showAdd = ref(false)

const departmentIndex = computed(() => indexById(departments.value))
const positionIndex = computed(() => indexById(positions.value))

function positionLabel(employee: EmployeePublic): string | null {
  return lookupLabel(positionIndex.value, employee.positionId, positionName)
}

function departmentLabel(employee: EmployeePublic): string | null {
  return lookupLabel(departmentIndex.value, employee.departmentId, departmentName)
}

const roleIndex = computed(() => new Map(roles.value.map((r) => [r.id, r])))

/** Role names as shown in the list, in the order they were assigned. */
function roleLabels(employee: EmployeePublic): { id: string; name: string; owner: boolean }[] {
  return (employee.roleIds ?? []).map((id) => {
    const role = roleIndex.value.get(id)
    return { id, name: role ? roleName(role) : id, owner: role?.grantsAll === true }
  })
}

/**
 * Owners first, then everybody else by surname.
 *
 * Who runs the company is the first thing anybody scanning this list looks
 * for, and that should not depend on where the alphabet happens to put them.
 */
function byRank(a: EmployeePublic, b: EmployeePublic): number {
  const rank = ownerRank(a.roleIds) - ownerRank(b.roleIds)
  if (rank !== 0) return rank
  return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
}

/* ---- Tab contents ------------------------------------------------- */

const activeEmployees = computed(() => employees.value.filter((e) => e.status === 'active'))

const inactiveEmployees = computed(() =>
  employees.value.filter((e) => e.status === 'suspended' || e.status === 'deactivated'),
)

/*
 * Only people who are actually employed. Deciding who gets an account is a
 * different job and lives on its own page, so this list stays what its name
 * says it is.
 */
const tabs = computed(() => [
  { key: 'employees' as Tab, label: t('tabs.employees'), count: activeEmployees.value.length },
  { key: 'suspended' as Tab, label: t('tabs.suspended'), count: inactiveEmployees.value.length },
])

/** People shown in the current tab, after search and department filter. */
const visiblePeople = computed(() => {
  const source = tab.value === 'suspended' ? inactiveEmployees.value : activeEmployees.value
  const term = search.value.trim().toLowerCase()

  return source
    .filter((employee) => {
      if (departmentFilter.value && employee.departmentId !== departmentFilter.value) return false
      if (typeFilter.value && (employee.accountType ?? 'employee') !== typeFilter.value) return false
      if (!term) return true

      return [
        employee.firstName,
        employee.lastName,
        employee.employeeCode,
        positionLabel(employee) ?? '',
        departmentLabel(employee) ?? '',
        ...roleLabels(employee).map((r) => r.name),
        ...(employee.skills ?? []),
      ]
        .join(' ')
        .toLowerCase()
        .includes(term)
    })
    .sort(byRank)
})

async function load(): Promise<void> {
  loading.value = true
  loadError.value = false

  try {
    // Reference data and requests are optional: a viewer without permission
    // simply gets fewer tabs rather than an error page.
    const [people, deps, pos, allRoles] = await Promise.all([
      fetchEmployees(),
      fetchDepartments().catch(() => []),
      fetchPositions().catch(() => []),
      fetchRoles().catch(() => []),
    ])

    employees.value = people
    departments.value = deps
    positions.value = pos
    roles.value = allRoles
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function switchTab(next: Tab): void {
  tab.value = next
  showAdd.value = false
  search.value = ''
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
      <button
        v-if="canCreateAccounts && !showAdd"
        class="btn btn-primary"
        @click="showAdd = true"
      >
        <AppIcon name="plus" :size="16" />
        {{ t('newEmployee.open') }}
      </button>
    </header>

    <AddEmployeeForm
      v-if="showAdd"
      :roles="roles"
      :departments="departments"
      :positions="positions"
      :employee-code="nextEmployeeCode(employees.length)"
      @created="load"
      @close="showAdd = false"
    />

    <!-- Tabs ----------------------------------------------------------- -->
    <div class="tabs" role="tablist">
      <button
        v-for="item in tabs"
        :key="item.key"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'is-active': tab === item.key }"
        :aria-selected="tab === item.key"
        @click="switchTab(item.key)"
      >
        {{ item.label }}
        <span v-if="item.count > 0" class="tab-count">
          {{ item.count }}
        </span>
      </button>
    </div>

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

      <select v-model="typeFilter" class="select" :aria-label="t('accountType.label')">
        <option value="">{{ t('accountType.filterAll') }}</option>
        <option v-for="type in ACCOUNT_TYPES" :key="type" :value="type">
          {{ t(`accountType.${type}`) }}
        </option>
      </select>

      <select
        v-if="departments.length"
        v-model="departmentFilter"
        class="select"
        :aria-label="t('employees.filterDepartment')"
      >
        <option value="">{{ t('employees.allDepartments') }}</option>
        <option v-for="d in departments" :key="d.id" :value="d.id">{{ departmentName(d) }}</option>
      </select>
    </div>

    <!-- Loading / error ------------------------------------------------ -->
    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 4" :key="n" class="skeleton" style="height: 44px" />
      </div>
    </div>

    <div v-else-if="loadError" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="alert" :size="20" /></span>
        <p class="empty-title">{{ t('errors.generic') }}</p>
        <button class="btn btn-secondary" @click="load">{{ t('common.retry') }}</button>
      </div>
    </div>

    <!-- Employees ------------------------------------------------------ -->
    <div v-else class="card">
      <div v-if="visiblePeople.length === 0" class="empty">
        <span class="empty-icon"><AppIcon name="users" :size="20" /></span>
        <p class="empty-title">
          {{ tab === 'suspended' ? t('approval.emptySuspended') : t('employees.emptyAll') }}
        </p>
        <p class="empty-text">
          {{ tab === 'suspended' ? t('approval.emptySuspendedHint') : t('employees.emptyAllHint') }}
        </p>
      </div>

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('table.name') }}</th>
              <th>{{ t('table.role') }}</th>
              <th>{{ t('table.position') }}</th>
              <th>{{ t('table.department') }}</th>
              <th>{{ t('table.status') }}</th>
              <th class="col-actions" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="employee in visiblePeople" :key="employee.uid">
              <td>
                <RouterLink :to="`/employees/${employee.uid}`" class="person-cell">
                  <UserAvatar
                    :name="`${employee.firstName} ${employee.lastName}`"
                    :photo-url="employee.photoUrl"
                    :size="34"
                  />
                  <div class="person-text">
                    <span class="person-name">
                      {{ employee.firstName }} {{ employee.lastName }}
                      <span v-if="employee.uid === auth.uid" class="you">{{ t('employees.you') }}</span>
                    </span>
                    <span class="person-sub">
                      <span class="mono">{{ employee.employeeCode }}</span>
                      <span v-if="employee.accountType === 'affiliate'" class="affiliate-tag">
                        {{ t('accountType.affiliate') }}
                      </span>
                    </span>
                  </div>
                </RouterLink>
              </td>
              <td>
                <span v-if="roleLabels(employee).length === 0" class="tertiary">—</span>
                <span
                  v-for="role in roleLabels(employee)"
                  :key="role.id"
                  class="badge badge-plain role-chip"
                  :class="{ 'is-owner': role.owner }"
                >
                  {{ role.name }}
                </span>
              </td>
              <td>{{ positionLabel(employee) ?? t('employees.noPosition') }}</td>
              <td class="muted">{{ departmentLabel(employee) ?? '—' }}</td>
              <td><StatusBadge :status="employee.status" /></td>
              <td class="col-actions">
                <RouterLink :to="`/employees/${employee.uid}`" class="btn btn-secondary btn-sm">
                  {{ t('common.edit') }}
                </RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: var(--space-1);
  border-bottom: 1px solid var(--border-subtle);
  overflow-x: auto;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-bottom: 2px solid transparent;
  font-size: var(--text-base);
  font-weight: 550;
  color: var(--text-secondary);
  white-space: nowrap;
  transition:
    color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.tab:hover {
  color: var(--text-primary);
}

.tab.is-active {
  color: var(--text-brand);
  border-bottom-color: var(--accent);
}

.tab-count {
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--bg-surface-3);
  font-size: var(--text-xs);
  font-weight: 650;
  color: var(--text-tertiary);
}

.tab-count.is-alert {
  background: var(--accent-soft-bg);
  color: var(--text-brand);
}

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

.person-cell {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  text-decoration: none;
  color: inherit;
}

.person-cell:hover {
  text-decoration: none;
}

.person-cell:hover .person-name {
  color: var(--text-brand);
}

.person-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.person-name {
  font-weight: 550;
  transition: color var(--dur-fast) var(--ease-out);
}

.person-sub {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.you {
  margin-left: var(--space-2);
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--accent-soft-bg);
  color: var(--text-brand);
  font-size: var(--text-xs);
  font-weight: 600;
}

.mono {
  font-family: var(--font-mono);
}

.role-chip {
  margin-right: var(--space-1);
}

/* Affiliates are outside the company; the list should never let that blur. */
.affiliate-tag {
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--info-bg);
  border: 1px solid var(--info-border);
  color: var(--info-500);
  font-weight: 600;
}

/* Owner roles carry the brand colour, so CEO and CTO read at a glance. */
.role-chip.is-owner {
  background: var(--accent-soft-bg);
  border-color: var(--accent-soft-border);
  color: var(--text-brand);
}
</style>
