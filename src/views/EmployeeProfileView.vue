<script setup lang="ts">
/**
 * One employee, seen through the viewer's own permissions.
 *
 * Nothing here decides what is secret. The page asks Firestore for each
 * privacy tier and renders whatever comes back; a tier the viewer may not open
 * simply returns nothing and those fields stay absent. The CEO sees every
 * tier, a colleague sees the public one, and neither outcome depends on this
 * file being written correctly.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import EmployeeManagePanel from '@/components/EmployeeManagePanel.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { fetchEmployee, type EmployeeDetail } from '@/api/employees'
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
import type { Department, Position } from '@/types/domain'
import { PERMISSIONS } from '@/types/permissions'

const route = useRoute()
const auth = useAuthStore()
const { t } = useI18n()

const loading = ref(true)
const notFound = ref(false)
const detail = ref<EmployeeDetail | null>(null)
const departments = ref<Department[]>([])
const positions = ref<Position[]>([])

const showManage = ref(false)

/**
 * Anyone holding one of the three management permissions gets the panel; it
 * then shows only the groups their permissions actually cover.
 */
const canManage = computed(() =>
  auth.hasAny(
    PERMISSIONS.EMPLOYEES_EDIT_PROFESSIONAL,
    PERMISSIONS.ROLES_ASSIGN,
    PERMISSIONS.EMPLOYEES_MANAGE_STATUS,
  ),
)

const uid = computed(() => String(route.params.uid ?? ''))
const isSelf = computed(() => uid.value === auth.uid)

const fullName = computed(() =>
  detail.value ? `${detail.value.profile.firstName} ${detail.value.profile.lastName}`.trim() : '',
)

const positionLabel = computed(() =>
  detail.value
    ? lookupLabel(indexById(positions.value), detail.value.profile.positionId, positionName)
    : null,
)

const departmentLabel = computed(() =>
  detail.value
    ? lookupLabel(indexById(departments.value), detail.value.profile.departmentId, departmentName)
    : null,
)

/** Contact rows the viewer was actually allowed to read. */
const contactRows = computed(() => {
  const p = detail.value?.personal
  if (!p) return []
  return [
    { key: 'email', icon: 'inbox', label: t('auth.email'), value: p.email },
    { key: 'phone', icon: 'user', label: t('register.phone'), value: p.phone },
    { key: 'city', icon: 'building', label: t('register.city'), value: p.city },
    { key: 'country', icon: 'building', label: t('register.country'), value: p.country },
  ].filter((row) => row.value.trim() !== '')
})

/**
 * True when the viewer is seeing a partial picture. Shown as a plain note
 * rather than hidden, because pretending the fields do not exist would be
 * quietly misleading.
 */
const partial = computed(() => detail.value !== null && !detail.value.sawEverything)

async function load(): Promise<void> {
  if (!uid.value) return
  loading.value = true
  notFound.value = false
  detail.value = null

  try {
    const [found, deps, pos] = await Promise.all([
      fetchEmployee(uid.value),
      fetchDepartments().catch(() => []),
      fetchPositions().catch(() => []),
    ])

    if (!found) {
      notFound.value = true
      return
    }

    detail.value = found
    departments.value = deps
    positions.value = pos
  } catch {
    notFound.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(uid, load)
</script>

<template>
  <div class="page">
    <RouterLink to="/employees" class="back">
      <AppIcon name="chevronRight" :size="15" class="back-icon" />
      {{ t('employees.backToList') }}
    </RouterLink>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div class="skeleton" style="height: 96px" />
        <div class="skeleton" style="height: 120px" />
      </div>
    </div>

    <div v-else-if="notFound" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="search" :size="20" /></span>
        <p class="empty-title">{{ t('errors.notFound') }}</p>
        <RouterLink to="/employees" class="btn btn-secondary">
          {{ t('employees.backToList') }}
        </RouterLink>
      </div>
    </div>

    <template v-else-if="detail">
      <!-- Hero --------------------------------------------------------- -->
      <section class="card hero">
        <UserAvatar :name="fullName" :photo-url="detail.profile.photoUrl" :size="112" />

        <div class="hero-body">
          <h1 class="hero-name">
            {{ fullName }}
            <span v-if="isSelf" class="badge badge-plain badge-accent">{{ t('employees.you') }}</span>
          </h1>
          <p class="hero-position">{{ positionLabel ?? t('employees.noPosition') }}</p>
          <p v-if="departmentLabel" class="hero-department">{{ departmentLabel }}</p>

          <div class="hero-meta">
            <StatusBadge :status="detail.profile.status" />
            <span class="badge badge-plain">
              {{ t(`employmentStatus.${detail.profile.employmentStatus}`) }}
            </span>
            <span v-if="detail.profile.employeeCode" class="badge badge-plain mono">
              {{ detail.profile.employeeCode }}
            </span>
          </div>
        </div>

        <div class="hero-actions">
          <RouterLink v-if="isSelf" to="/profile" class="btn btn-secondary">
            {{ t('common.edit') }}
          </RouterLink>
          <button
            v-if="canManage"
            class="btn"
            :class="showManage ? 'btn-secondary' : 'btn-primary'"
            @click="showManage = !showManage"
          >
            <AppIcon name="settings" :size="15" />
            {{ t('manage.open') }}
          </button>
        </div>
      </section>

      <div v-if="partial" class="alert alert-info">
        <AppIcon name="eyeOff" :size="16" />
        <span>{{ t('employees.hiddenNotice') }}</span>
      </div>

      <EmployeeManagePanel
        v-if="canManage && showManage"
        :employee="detail.profile"
        :departments="departments"
        :positions="positions"
        @updated="load"
      />

      <div class="columns">
        <div class="column">
          <!-- About ---------------------------------------------------- -->
          <section v-if="detail.profile.bio || detail.profile.skills?.length" class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('employees.about') }}</h2>
            </div>
            <div class="card-body stack">
              <p v-if="detail.profile.bio" class="prose">{{ detail.profile.bio }}</p>

              <div v-if="detail.profile.skills?.length">
                <p class="eyebrow">{{ t('profile.skills') }}</p>
                <ul class="chips">
                  <li v-for="s in detail.profile.skills" :key="s" class="chip">{{ s }}</li>
                </ul>
              </div>

              <div v-if="detail.profile.expertise?.length">
                <p class="eyebrow">{{ t('profile.expertise') }}</p>
                <ul class="chips">
                  <li v-for="e in detail.profile.expertise" :key="e" class="chip">{{ e }}</li>
                </ul>
              </div>
            </div>
          </section>

          <!-- Personal ------------------------------------------------- -->
          <section
            v-if="
              detail.personal.personalDescription ||
              detail.personal.languages.length ||
              detail.personal.interests.length
            "
            class="card"
          >
            <div class="card-header">
              <h2 class="card-title">{{ t('profile.sectionPersonal') }}</h2>
            </div>
            <div class="card-body stack">
              <p v-if="detail.personal.personalDescription" class="prose">
                {{ detail.personal.personalDescription }}
              </p>

              <div v-if="detail.personal.languages.length">
                <p class="eyebrow">{{ t('profile.languages') }}</p>
                <ul class="chips">
                  <li v-for="l in detail.personal.languages" :key="l" class="chip">{{ l }}</li>
                </ul>
              </div>

              <div v-if="detail.personal.interests.length">
                <p class="eyebrow">{{ t('profile.interests') }}</p>
                <ul class="chips">
                  <li v-for="i in detail.personal.interests" :key="i" class="chip">{{ i }}</li>
                </ul>
              </div>
            </div>
          </section>
        </div>

        <div class="column column-side">
          <!-- Contact -------------------------------------------------- -->
          <section class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('employees.contact') }}</h2>
            </div>
            <div class="card-body">
              <dl v-if="contactRows.length" class="rows">
                <div v-for="row in contactRows" :key="row.key" class="row-item">
                  <dt><AppIcon :name="row.icon" :size="15" /> {{ row.label }}</dt>
                  <dd>{{ row.value }}</dd>
                </div>
              </dl>
              <p v-else class="tertiary small">{{ t('common.hiddenByPrivacy') }}</p>
            </div>
          </section>

          <!-- Work ----------------------------------------------------- -->
          <section class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('employees.work') }}</h2>
            </div>
            <div class="card-body">
              <dl class="rows">
                <div class="row-item">
                  <dt>{{ t('profile.dateJoined') }}</dt>
                  <dd>{{ formatDate(detail.profile.dateJoined) }}</dd>
                </div>
                <div v-if="detail.profile.startDate" class="row-item">
                  <dt>{{ t('profile.startDate') }}</dt>
                  <dd>{{ formatDate(detail.profile.startDate) }}</dd>
                </div>
                <div v-if="detail.profile.responsibilities" class="row-item">
                  <dt>{{ t('profile.responsibilities') }}</dt>
                  <dd class="prose">{{ detail.profile.responsibilities }}</dd>
                </div>
              </dl>
            </div>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.back {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  align-self: flex-start;
}

.back:hover {
  color: var(--text-primary);
  text-decoration: none;
}

.back-icon {
  transform: rotate(180deg);
}

.hero {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  padding: var(--space-8) var(--space-6);
  flex-wrap: wrap;
}

.hero-body {
  flex: 1;
  min-width: 220px;
}

.hero-name {
  font-size: var(--text-2xl);
  font-weight: 650;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.hero-position {
  font-size: var(--text-md);
  color: var(--text-secondary);
  margin-top: var(--space-2);
}

.hero-department {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.hero-meta {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin-top: var(--space-4);
}

.hero-actions {
  display: flex;
  gap: var(--space-2);
  align-self: flex-start;
  flex-wrap: wrap;
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr);
  gap: var(--space-6);
  align-items: start;
}

.column {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  min-width: 0;
}

.prose {
  font-size: var(--text-base);
  line-height: var(--leading-relaxed);
  color: var(--text-secondary);
  white-space: pre-wrap;
}

.chips {
  list-style: none;
  padding: 0;
  margin-top: var(--space-3);
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip {
  padding: 3px var(--space-3);
  background: var(--bg-surface-3);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.row-item dt {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: var(--space-1);
}

.row-item dd {
  margin: 0;
  font-size: var(--text-base);
  overflow-wrap: anywhere;
}

.mono {
  font-family: var(--font-mono);
}

.small {
  font-size: var(--text-sm);
}

@media (max-width: 900px) {
  .columns {
    grid-template-columns: 1fr;
  }
}
</style>
