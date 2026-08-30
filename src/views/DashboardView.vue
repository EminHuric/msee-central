<script setup lang="ts">
/**
 * Dashboard.
 *
 * One route, three different pages, decided by who is looking:
 *
 *   owner      how the company stands — headcount, who is waiting, what
 *              changed recently
 *   employee   their own corner: profile, and later earnings and tasks
 *   affiliate  their own figures and nothing else
 *
 * Every panel is gated on the permission that guards the data behind it, so a
 * marketing manager without registration_requests.view simply never sees that
 * card. The same permissions guard the reads themselves, so a hidden card is
 * not what keeps the data private — it just stops the page asking for
 * something it will be refused.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import StatusBadge from '@/components/ui/StatusBadge.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { fetchRequests } from '@/api/approval'
import { fetchAuditLog } from '@/api/audit'
import { completeness, fetchEmployee, fetchEmployees, type EmployeeDetail } from '@/api/employees'
import { formatDate, formatRelative } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import type { AuditLogEntry, EmployeePublic, RegistrationRequest } from '@/types/domain'
import { PERMISSIONS } from '@/types/permissions'

const auth = useAuthStore()
const { t } = useI18n()

const loading = ref(true)
const employees = ref<EmployeePublic[]>([])
const requests = ref<RegistrationRequest[]>([])
const activity = ref<AuditLogEntry[]>([])
const me = ref<EmployeeDetail | null>(null)

const isAffiliate = computed(() => auth.access?.accountType === 'affiliate')
const isOwnerView = computed(() => auth.hasPermission(PERMISSIONS.EMPLOYEES_VIEW) && !isAffiliate.value)

const canSeeRequests = computed(() => auth.hasPermission(PERMISSIONS.REQUESTS_VIEW))
const canSeeActivity = computed(() => auth.hasPermission(PERMISSIONS.AUDIT_VIEW))

const firstName = computed(() => me.value?.profile.firstName ?? auth.displayName ?? '')

const subtitle = computed(() => {
  if (isAffiliate.value) return t('dashboard.subtitleAffiliate')
  if (isOwnerView.value) return t('dashboard.subtitleOwner')
  return t('dashboard.subtitleEmployee')
})

/* ---- Company figures ---------------------------------------------- */

const staff = computed(() => employees.value.filter((e) => (e.accountType ?? 'employee') === 'employee'))
const affiliates = computed(() => employees.value.filter((e) => e.accountType === 'affiliate'))
const activeCount = computed(() => employees.value.filter((e) => e.status === 'active').length)
const suspendedCount = computed(
  () => employees.value.filter((e) => e.status === 'suspended' || e.status === 'deactivated').length,
)
const pendingCount = computed(() => requests.value.filter((r) => r.status === 'pending').length)

const recentlyJoined = computed(() =>
  [...employees.value]
    .filter((e) => e.status === 'active')
    .sort((a, b) => (b.dateJoined ?? '').localeCompare(a.dateJoined ?? ''))
    .slice(0, 5),
)

const profilePercent = computed(() => (me.value ? completeness(me.value) : 0))

async function load(): Promise<void> {
  loading.value = true

  /*
   * Each of these is asked for only when the viewer may have it. Requesting
   * and swallowing the denial would work too, but it fills the console with
   * permission errors that make real faults harder to spot.
   */
  const [mine, people, reqs, log] = await Promise.all([
    auth.uid ? fetchEmployee(auth.uid).catch(() => null) : Promise.resolve(null),
    isOwnerView.value ? fetchEmployees().catch(() => []) : Promise.resolve([]),
    canSeeRequests.value ? fetchRequests().catch(() => []) : Promise.resolve([]),
    canSeeActivity.value ? fetchAuditLog(6).catch(() => []) : Promise.resolve([]),
  ])

  me.value = mine
  employees.value = people
  requests.value = reqs
  activity.value = log
  loading.value = false
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('dashboard.greeting', { name: firstName }) }}</h1>
        <p class="page-subtitle">{{ subtitle }}</p>
      </div>
    </header>

    <div v-if="loading" class="stat-row">
      <div v-for="n in 4" :key="n" class="card skeleton" style="height: 92px" />
    </div>

    <template v-else>
      <!-- Company figures, for whoever may see the directory ------------ -->
      <div v-if="isOwnerView" class="stat-row">
        <RouterLink to="/employees" class="card stat">
          <span class="stat-label">{{ t('dashboard.totalEmployees') }}</span>
          <span class="stat-value">{{ staff.length }}</span>
        </RouterLink>

        <div class="card stat">
          <span class="stat-label">{{ t('dashboard.activeEmployees') }}</span>
          <span class="stat-value">{{ activeCount }}</span>
        </div>

        <RouterLink v-if="canSeeRequests" to="/requests" class="card stat" :class="{ 'is-alert': pendingCount > 0 }">
          <span class="stat-label">{{ t('dashboard.pendingRequests') }}</span>
          <span class="stat-value">{{ pendingCount }}</span>
        </RouterLink>

        <div v-if="suspendedCount > 0" class="card stat">
          <span class="stat-label">{{ t('dashboard.suspended') }}</span>
          <span class="stat-value">{{ suspendedCount }}</span>
        </div>

        <div v-if="affiliates.length > 0" class="card stat">
          <span class="stat-label">{{ t('dashboard.affiliates') }}</span>
          <span class="stat-value">{{ affiliates.length }}</span>
        </div>
      </div>

      <div class="columns">
        <div class="column">
          <!-- Waiting for a decision ---------------------------------- -->
          <section v-if="canSeeRequests" class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('dashboard.pendingTitle') }}</h2>
              <RouterLink v-if="pendingCount > 0" to="/requests" class="btn btn-primary btn-sm">
                {{ t('dashboard.review') }}
              </RouterLink>
            </div>

            <div v-if="pendingCount === 0" class="card-body">
              <p class="muted">{{ t('dashboard.pendingNone') }}</p>
            </div>

            <ul v-else class="list">
              <li v-for="request in requests.filter((r) => r.status === 'pending').slice(0, 5)" :key="request.uid" class="row-line">
                <UserAvatar
                  :name="`${request.firstName} ${request.lastName}`"
                  :photo-url="request.photoUrl"
                  :size="34"
                />
                <div class="row-text">
                  <span class="row-name">{{ request.firstName }} {{ request.lastName }}</span>
                  <span class="row-sub">{{ request.desiredPosition || request.email }}</span>
                </div>
                <span class="tertiary row-when">{{ formatRelative(request.submittedAt) }}</span>
              </li>
            </ul>
          </section>

          <!-- Your own profile ---------------------------------------- -->
          <section v-if="me" class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('dashboard.yourProfile') }}</h2>
              <RouterLink v-if="profilePercent < 100" to="/profile" class="btn btn-secondary btn-sm">
                {{ t('dashboard.completeProfile') }}
              </RouterLink>
            </div>

            <div class="card-body profile-body">
              <UserAvatar
                :name="`${me.profile.firstName} ${me.profile.lastName}`"
                :photo-url="me.profile.photoUrl"
                :size="56"
              />
              <div class="profile-text">
                <p class="row-name">{{ me.profile.firstName }} {{ me.profile.lastName }}</p>
                <p class="row-sub">{{ me.profile.employeeCode }}</p>
                <p class="field-hint profile-note">
                  {{
                    profilePercent === 100
                      ? t('dashboard.profileComplete')
                      : t('dashboard.profileIncomplete', { percent: profilePercent })
                  }}
                </p>
              </div>
              <StatusBadge :status="me.profile.status" />
            </div>
          </section>

          <!-- Placeholder for the modules that are coming -------------- -->
          <section class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('dashboard.comingSoon') }}</h2>
            </div>
            <div class="card-body">
              <p class="muted soon-text">
                {{ isAffiliate ? t('dashboard.commissionSoon') : t('dashboard.earningsSoon') }}
              </p>
            </div>
          </section>
        </div>

        <div class="column column-side">
          <!-- What changed recently ----------------------------------- -->
          <section v-if="canSeeActivity" class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('dashboard.recentActivity') }}</h2>
              <RouterLink to="/audit" class="btn btn-ghost btn-sm">
                {{ t('dashboard.seeAll') }}
              </RouterLink>
            </div>

            <div v-if="activity.length === 0" class="card-body">
              <p class="muted">{{ t('dashboard.activityNone') }}</p>
            </div>

            <ul v-else class="list">
              <li v-for="entry in activity" :key="entry.id" class="row-line activity">
                <span class="activity-dot" />
                <div class="row-text">
                  <span class="row-name">{{ t(`auditAction.${entry.action}`) }}</span>
                  <span class="row-sub">{{ entry.targetLabel }}</span>
                </div>
                <span class="tertiary row-when">{{ formatRelative(entry.createdAt) }}</span>
              </li>
            </ul>
          </section>

          <!-- Recently joined ------------------------------------------ -->
          <section v-if="isOwnerView && recentlyJoined.length > 0" class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('dashboard.recentlyJoined') }}</h2>
            </div>
            <ul class="list">
              <li v-for="person in recentlyJoined" :key="person.uid" class="row-line">
                <UserAvatar
                  :name="`${person.firstName} ${person.lastName}`"
                  :photo-url="person.photoUrl"
                  :size="30"
                />
                <div class="row-text">
                  <span class="row-name">{{ person.firstName }} {{ person.lastName }}</span>
                  <span class="row-sub">{{ formatDate(person.dateJoined) }}</span>
                </div>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-4);
}

.stat {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-5);
  text-decoration: none;
  color: inherit;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

a.stat:hover {
  text-decoration: none;
  border-color: var(--accent-soft-border);
  transform: translateY(-2px);
}

.stat.is-alert {
  border-color: var(--accent-soft-border);
  background: var(--accent-soft-bg);
}

.stat-label {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.stat-value {
  font-size: var(--text-3xl);
  font-weight: 650;
  letter-spacing: -0.02em;
}

.stat.is-alert .stat-value {
  color: var(--text-brand);
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: var(--space-6);
  align-items: start;
}

.column {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  min-width: 0;
}

.list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.row-line {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--border-subtle);
}

.row-line:last-child {
  border-bottom: none;
}

.row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.row-name {
  font-size: var(--text-base);
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-sub {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-when {
  font-size: var(--text-xs);
  white-space: nowrap;
}

.activity-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  background: var(--accent);
  flex-shrink: 0;
}

.profile-body {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.profile-text {
  flex: 1;
  min-width: 0;
}

.profile-note {
  margin-top: var(--space-1);
}

.soon-text {
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
}

@media (max-width: 900px) {
  .columns {
    grid-template-columns: 1fr;
  }
}
</style>
