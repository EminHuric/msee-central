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
import RequestReviewPanel from '@/components/RequestReviewPanel.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { fetchRequests, nextEmployeeCode } from '@/api/approval'
import { fetchEmployees } from '@/api/employees'
import {
  departmentName,
  fetchDepartments,
  fetchPositions,
  indexById,
  lookupLabel,
  positionName,
} from '@/api/organisation'
import { fetchRoles } from '@/api/roles'
import { formatDate } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import type {
  Department,
  EmployeePublic,
  Position,
  RegistrationRequest,
  Role,
} from '@/types/domain'
import { PERMISSIONS } from '@/types/permissions'

const auth = useAuthStore()
const { t } = useI18n()

type Tab = 'employees' | 'pending' | 'suspended' | 'rejected'

const tab = ref<Tab>('employees')
const loading = ref(true)
const loadError = ref(false)

const employees = ref<EmployeePublic[]>([])
const requests = ref<RegistrationRequest[]>([])
const departments = ref<Department[]>([])
const positions = ref<Position[]>([])
const roles = ref<Role[]>([])

const search = ref('')
const departmentFilter = ref('')
const reviewing = ref<RegistrationRequest | null>(null)

const canSeeRequests = computed(() => auth.hasPermission(PERMISSIONS.REQUESTS_VIEW))

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

/* ---- Tab contents ------------------------------------------------- */

const activeEmployees = computed(() => employees.value.filter((e) => e.status === 'active'))

const inactiveEmployees = computed(() =>
  employees.value.filter((e) => e.status === 'suspended' || e.status === 'deactivated'),
)

const pendingRequests = computed(() => requests.value.filter((r) => r.status === 'pending'))
const rejectedRequests = computed(() => requests.value.filter((r) => r.status === 'rejected'))

const tabs = computed(() => {
  const list: { key: Tab; label: string; count: number }[] = [
    { key: 'employees', label: t('tabs.employees'), count: activeEmployees.value.length },
  ]

  if (canSeeRequests.value) {
    list.push({ key: 'pending', label: t('tabs.pending'), count: pendingRequests.value.length })
  }

  list.push({ key: 'suspended', label: t('tabs.suspended'), count: inactiveEmployees.value.length })

  if (canSeeRequests.value) {
    list.push({ key: 'rejected', label: t('tabs.rejected'), count: rejectedRequests.value.length })
  }

  return list
})

/** People shown in the current tab, after search and department filter. */
const visiblePeople = computed(() => {
  const source = tab.value === 'suspended' ? inactiveEmployees.value : activeEmployees.value
  const term = search.value.trim().toLowerCase()

  return source.filter((employee) => {
    if (departmentFilter.value && employee.departmentId !== departmentFilter.value) return false
    if (!term) return true

    return [
      employee.firstName,
      employee.lastName,
      employee.employeeCode,
      positionLabel(employee) ?? '',
      departmentLabel(employee) ?? '',
      ...(employee.skills ?? []),
    ]
      .join(' ')
      .toLowerCase()
      .includes(term)
  })
})

const visibleRequests = computed(() => {
  const source = tab.value === 'pending' ? pendingRequests.value : rejectedRequests.value
  const term = search.value.trim().toLowerCase()
  if (!term) return source

  return source.filter((r) =>
    [r.firstName, r.lastName, r.email, r.desiredPosition, r.city, r.country]
      .join(' ')
      .toLowerCase()
      .includes(term),
  )
})

const showingRequests = computed(() => tab.value === 'pending' || tab.value === 'rejected')

async function load(): Promise<void> {
  loading.value = true
  loadError.value = false

  try {
    // Reference data and requests are optional: a viewer without permission
    // simply gets fewer tabs rather than an error page.
    const [people, deps, pos, allRoles, reqs] = await Promise.all([
      fetchEmployees(),
      fetchDepartments().catch(() => []),
      fetchPositions().catch(() => []),
      fetchRoles().catch(() => []),
      canSeeRequests.value ? fetchRequests().catch(() => []) : Promise.resolve([]),
    ])

    employees.value = people
    departments.value = deps
    positions.value = pos
    roles.value = allRoles
    requests.value = reqs
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function onDecided(): Promise<void> {
  reviewing.value = null
  await load()
}

function switchTab(next: Tab): void {
  tab.value = next
  reviewing.value = null
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
        @click="showAdd = true; reviewing = null"
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
        <span v-if="item.count > 0" class="tab-count" :class="{ 'is-alert': item.key === 'pending' }">
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

      <select
        v-if="!showingRequests && departments.length"
        v-model="departmentFilter"
        class="select"
        :aria-label="t('employees.filterDepartment')"
      >
        <option value="">{{ t('employees.allDepartments') }}</option>
        <option v-for="d in departments" :key="d.id" :value="d.id">{{ departmentName(d) }}</option>
      </select>
    </div>

    <!-- Review panel --------------------------------------------------- -->
    <RequestReviewPanel
      v-if="reviewing"
      :request="reviewing"
      :roles="roles"
      :departments="departments"
      :positions="positions"
      :employee-code="nextEmployeeCode(employees.length)"
      @decided="onDecided"
      @close="reviewing = null"
    />

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

    <!-- Requests ------------------------------------------------------- -->
    <div v-else-if="showingRequests" class="card">
      <div v-if="visibleRequests.length === 0" class="empty">
        <span class="empty-icon"><AppIcon name="inbox" :size="20" /></span>
        <p class="empty-title">
          {{ tab === 'pending' ? t('approval.emptyPending') : t('approval.emptyRejected') }}
        </p>
        <p class="empty-text">
          {{ tab === 'pending' ? t('approval.emptyPendingHint') : t('approval.emptyRejectedHint') }}
        </p>
      </div>

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('table.name') }}</th>
              <th>{{ t('table.requestedPosition') }}</th>
              <th>{{ t('table.location') }}</th>
              <th>{{ t('table.submitted') }}</th>
              <th v-if="tab === 'rejected'">{{ t('table.reason') }}</th>
              <th class="col-actions" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="request in visibleRequests" :key="request.uid">
              <td>
                <div class="person-cell">
                  <UserAvatar
                    :name="`${request.firstName} ${request.lastName}`"
                    :photo-url="request.photoUrl"
                    :size="34"
                  />
                  <div class="person-text">
                    <span class="person-name">{{ request.firstName }} {{ request.lastName }}</span>
                    <span class="person-sub truncate">{{ request.email }}</span>
                  </div>
                </div>
              </td>
              <td>{{ request.desiredPosition || '—' }}</td>
              <td class="muted">{{ request.city }}, {{ request.country }}</td>
              <td class="muted">{{ formatDate(request.submittedAt) }}</td>
              <td v-if="tab === 'rejected'" class="muted truncate">
                {{ request.rejectionReason || '—' }}
              </td>
              <td class="col-actions">
                <button class="btn btn-secondary btn-sm" @click="reviewing = request">
                  {{ t('approval.review') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
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
              <th>{{ t('table.position') }}</th>
              <th>{{ t('table.department') }}</th>
              <th>{{ t('table.status') }}</th>
              <th>{{ t('table.joined') }}</th>
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
                    <span class="person-sub mono">{{ employee.employeeCode }}</span>
                  </div>
                </RouterLink>
              </td>
              <td>{{ positionLabel(employee) ?? t('employees.noPosition') }}</td>
              <td class="muted">{{ departmentLabel(employee) ?? '—' }}</td>
              <td><StatusBadge :status="employee.status" /></td>
              <td class="muted">{{ formatDate(employee.dateJoined) }}</td>
              <td class="col-actions">
                <RouterLink :to="`/employees/${employee.uid}`" class="btn btn-ghost btn-sm">
                  {{ t('common.view') }}
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
</style>
