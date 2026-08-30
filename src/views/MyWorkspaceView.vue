<script setup lang="ts">
/**
 * My Workspace — the part of the system that belongs to one person.
 *
 * Separate from the dashboard on purpose. The dashboard answers "how are
 * things", which for an owner means the whole company; this answers "what is
 * mine", which is the same question for everybody regardless of rank.
 *
 * Most of it is waiting on modules that do not exist yet. The cards are shown
 * rather than hidden so the shape is legible, and each says plainly that it is
 * empty rather than pretending to be a feature.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { completeness, fetchEmployee, missingFields, type EmployeeDetail } from '@/api/employees'
import { departmentName, fetchDepartments, fetchPositions, positionName } from '@/api/organisation'
import { formatDate } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import type { Department, Position } from '@/types/domain'

const auth = useAuthStore()
const { t } = useI18n()

const loading = ref(true)
const me = ref<EmployeeDetail | null>(null)
const departments = ref<Department[]>([])
const positions = ref<Position[]>([])

const fullName = computed(() =>
  me.value ? `${me.value.profile.firstName} ${me.value.profile.lastName}`.trim() : '',
)

const percent = computed(() => (me.value ? completeness(me.value) : 0))
const missing = computed(() => (me.value ? missingFields(me.value) : []))

const positionLabel = computed(() => {
  const id = me.value?.profile.positionId
  if (!id) return null
  return positionName(positions.value.find((p) => p.id === id)) ?? id
})

const departmentLabel = computed(() => {
  const id = me.value?.profile.departmentId
  if (!id) return null
  return departmentName(departments.value.find((d) => d.id === id)) ?? id
})

const isAffiliate = computed(() => auth.access?.accountType === 'affiliate')

async function load(): Promise<void> {
  if (!auth.uid) return
  loading.value = true

  const [detail, deps, pos] = await Promise.all([
    fetchEmployee(auth.uid).catch(() => null),
    fetchDepartments().catch(() => []),
    fetchPositions().catch(() => []),
  ])

  me.value = detail
  departments.value = deps
  positions.value = pos
  loading.value = false
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('workspace.title') }}</h1>
        <p class="page-subtitle">{{ t('workspace.subtitle') }}</p>
      </div>
    </header>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div class="skeleton" style="height: 100px" />
      </div>
    </div>

    <template v-else>
      <!-- Who you are -------------------------------------------------- -->
      <section v-if="me" class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('workspace.profileCard') }}</h2>
          <RouterLink to="/profile" class="btn btn-secondary btn-sm">
            {{ t('workspace.openProfile') }}
          </RouterLink>
        </div>

        <div class="card-body identity">
          <UserAvatar :name="fullName" :photo-url="me.profile.photoUrl" :size="72" />

          <div class="identity-body">
            <p class="identity-name">{{ fullName }}</p>
            <p class="muted">{{ positionLabel ?? t('employees.noPosition') }}</p>
            <p v-if="departmentLabel" class="tertiary small">{{ departmentLabel }}</p>

            <div class="identity-meta">
              <StatusBadge :status="me.profile.status" />
              <span class="badge badge-plain mono">{{ me.profile.employeeCode }}</span>
              <span class="badge badge-plain">
                {{ t('employees.joined', { date: formatDate(me.profile.dateJoined) }) }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="missing.length > 0" class="card-footer meter-footer">
          <div class="meter">
            <div class="meter-fill" :style="{ width: `${percent}%` }" />
          </div>
          <span class="tertiary small">
            {{ t('profile.missingMany', { n: missing.length }) }} · {{ percent }}%
          </span>
        </div>
      </section>

      <!-- What is coming ----------------------------------------------- -->
      <div class="soon-grid">
        <section class="card soon-card">
          <span class="soon-icon"><AppIcon name="check" :size="18" /></span>
          <div>
            <p class="soon-title">{{ t('workspace.tasksCard') }}</p>
            <p class="soon-text">{{ t('workspace.tasksSoon') }}</p>
          </div>
          <span class="badge badge-plain soon-tag">{{ t('nav2.soon') }}</span>
        </section>

        <section class="card soon-card">
          <span class="soon-icon"><AppIcon name="wallet" :size="18" /></span>
          <div>
            <p class="soon-title">{{ t('workspace.earningsCard') }}</p>
            <p class="soon-text">
              {{ isAffiliate ? t('dashboard.commissionSoon') : t('workspace.earningsSoon') }}
            </p>
          </div>
          <span class="badge badge-plain soon-tag">{{ t('nav2.soon') }}</span>
        </section>

        <section class="card soon-card">
          <span class="soon-icon"><AppIcon name="chat" :size="18" /></span>
          <div>
            <p class="soon-title">{{ t('workspace.notificationsCard') }}</p>
            <p class="soon-text">{{ t('workspace.notificationsSoon') }}</p>
          </div>
          <span class="badge badge-plain soon-tag">{{ t('nav2.soon') }}</span>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.identity {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  flex-wrap: wrap;
}

.identity-body {
  flex: 1;
  min-width: 200px;
}

.identity-name {
  font-size: var(--text-lg);
  font-weight: 650;
  letter-spacing: -0.012em;
}

.identity-meta {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-top: var(--space-3);
}

.meter-footer {
  justify-content: flex-start;
  gap: var(--space-4);
}

.meter {
  flex: 1;
  height: 5px;
  background: var(--bg-inset);
  border-radius: var(--radius-full);
  overflow: hidden;
  min-width: 120px;
}

.meter-fill {
  height: 100%;
  background: var(--accent);
  transition: width var(--dur-slow) var(--ease-out);
}

.soon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--space-4);
}

.soon-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-5);
  opacity: 0.85;
}

.soon-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  background: var(--bg-surface-3);
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.soon-title {
  font-size: var(--text-md);
  font-weight: 600;
}

.soon-text {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  line-height: var(--leading-relaxed);
  margin-top: var(--space-1);
}

.soon-tag {
  margin-left: auto;
  flex-shrink: 0;
}

.small {
  font-size: var(--text-sm);
}

.mono {
  font-family: var(--font-mono);
}
</style>
