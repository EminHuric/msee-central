<script setup lang="ts">
/**
 * Registration requests.
 *
 * This route existed in the menu and on the dashboard from the beginning and
 * led to a placeholder: the review flow had been built as a tab inside
 * Employees instead. Two doors, one of them locked.
 *
 * Deciding who gets an account is its own job, not a filter on the staff
 * list, so it gets its own page and Employees keeps only people who are
 * actually employed.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import RequestReviewPanel from '@/components/RequestReviewPanel.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { fetchRequests, nextEmployeeCode } from '@/api/approval'
import { fetchEmployees } from '@/api/employees'
import { fetchDepartments, fetchPositions } from '@/api/organisation'
import { fetchRoles } from '@/api/roles'
import { formatDate, formatRelative } from '@/i18n'
import type {
  Department,
  EmployeePublic,
  Position,
  RegistrationRequest,
  Role,
} from '@/types/domain'

const { t } = useI18n()

type Tab = 'pending' | 'rejected' | 'approved'

const tab = ref<Tab>('pending')
const loading = ref(true)
const loadError = ref(false)
const search = ref('')

const requests = ref<RegistrationRequest[]>([])
const roles = ref<Role[]>([])
const departments = ref<Department[]>([])
const positions = ref<Position[]>([])
const employees = ref<EmployeePublic[]>([])
const reviewing = ref<RegistrationRequest | null>(null)

const byStatus = computed(() => ({
  pending: requests.value.filter((r) => r.status === 'pending'),
  rejected: requests.value.filter((r) => r.status === 'rejected'),
  approved: requests.value.filter((r) => r.status === 'approved'),
}))

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()
  const source = byStatus.value[tab.value]
  if (!term) return source

  return source.filter((r) =>
    [r.firstName, r.lastName, r.email, r.desiredPosition, r.city, r.country]
      .join(' ')
      .toLowerCase()
      .includes(term),
  )
})

async function load(): Promise<void> {
  loading.value = true
  loadError.value = false

  try {
    const [reqs, allRoles, deps, pos, people] = await Promise.all([
      fetchRequests(),
      fetchRoles().catch(() => []),
      fetchDepartments().catch(() => []),
      fetchPositions().catch(() => []),
      fetchEmployees().catch(() => []),
    ])
    requests.value = reqs
    roles.value = allRoles
    departments.value = deps
    positions.value = pos
    employees.value = people
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
  search.value = ''
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('nav.requests') }}</h1>
        <p class="page-subtitle">{{ t('approval.emptyPendingHint') }}</p>
      </div>
    </header>

    <div class="tabs" role="tablist">
      <button
        v-for="key in (['pending', 'rejected', 'approved'] as Tab[])"
        :key="key"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'is-active': tab === key }"
        :aria-selected="tab === key"
        @click="switchTab(key)"
      >
        {{ t(`tabs.${key === 'approved' ? 'employees' : key}`) }}
        <span
          v-if="byStatus[key].length"
          class="tab-count"
          :class="{ 'is-alert': key === 'pending' }"
        >
          {{ byStatus[key].length }}
        </span>
      </button>
    </div>

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
    </div>

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

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 48px" />
      </div>
    </div>

    <div v-else-if="loadError" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="alert" :size="20" /></span>
        <p class="empty-title">{{ t('errors.generic') }}</p>
        <button class="btn btn-secondary" @click="load">{{ t('common.retry') }}</button>
      </div>
    </div>

    <div v-else-if="visible.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="inbox" :size="20" /></span>
        <p class="empty-title">
          {{ tab === 'rejected' ? t('approval.emptyRejected') : t('approval.emptyPending') }}
        </p>
        <p class="empty-text">
          {{ tab === 'rejected' ? t('approval.emptyRejectedHint') : t('approval.emptyPendingHint') }}
        </p>
      </div>
    </div>

    <div v-else class="card">
      <div class="table-wrap">
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
            <tr v-for="request in visible" :key="request.uid">
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
              <td class="muted">{{ [request.city, request.country].filter(Boolean).join(', ') }}</td>
              <td class="muted nowrap">
                {{ formatDate(request.submittedAt) }}
                <div class="tertiary small">{{ formatRelative(request.submittedAt) }}</div>
              </td>
              <td v-if="tab === 'rejected'" class="muted truncate">
                {{ request.rejectionReason || '—' }}
              </td>
              <td class="col-actions">
                <button
                  class="btn"
                  :class="tab === 'pending' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'"
                  @click="reviewing = request"
                >
                  {{ tab === 'pending' ? t('approval.review') : t('common.view') }}
                </button>
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
}

.person-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.person-name {
  font-weight: 550;
}

.person-sub {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.nowrap {
  white-space: nowrap;
}

.small {
  font-size: var(--text-xs);
}
</style>
