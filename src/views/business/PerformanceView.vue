<script setup lang="ts">
/**
 * Performance.
 *
 * There is no score on this page, and that is a decision rather than an
 * omission. A developer's task count and a salesperson's revenue are not the
 * same axis; averaging them produces a number that is precise, comparable and
 * meaningless, and people quickly learn to work for the number instead of the
 * job.
 *
 * What exists instead: each role carries the KPIs that matter for it, and each
 * person is shown against those. Every figure is counted from records the
 * system already holds, so nobody is scored on data somebody typed about them.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { fetchEmployees } from '@/api/employees'
import { fetchRoles } from '@/api/roles'
import { fetchRoleKpis, saveRoleKpi } from '@/api/company'
import {
  EMPTY_SNAPSHOT,
  kpisFor,
  loadSnapshot,
  periodOf,
  type PeriodKey,
  type Snapshot,
} from '@/api/metrics'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { DEFAULT_KPIS, INVERSE_KPIS, KPI_METRICS, MONEY_KPIS, type KpiMetric } from '@/types/company'
import { BASE_CURRENCY, formatMoney } from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import type { EmployeePublic, Role } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const loading = ref(true)
const saving = ref(false)

const snapshot = ref<Snapshot>(EMPTY_SNAPSHOT)
const people = ref<EmployeePublic[]>([])
const roles = ref<Role[]>([])
const roleKpis = ref<Record<string, KpiMetric[]>>({})

const periodKey = ref<PeriodKey>('month')
const configuringRole = ref<string | null>(null)
const chosen = ref<KpiMetric[]>([])

const canSeeAll = computed(() => auth.hasPermission(PERMISSIONS.PERFORMANCE_VIEW_ALL))
const canConfigure = computed(() => auth.hasPermission(PERMISSIONS.ROLES_EDIT))

const period = computed(() => periodOf(periodKey.value))

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

/** Which people this viewer may see. Without the wider permission: only you. */
const visiblePeople = computed(() => {
  const all = people.value.filter((p) => p.accountType !== 'affiliate')
  if (canSeeAll.value) return all
  return all.filter((p) => p.uid === auth.uid)
})

const roleName = computed(() => new Map(roles.value.map((r) => [r.id, r.name])))

function roleLabel(person: EmployeePublic): string {
  const names = (person.roleIds ?? []).map((id) => roleName.value.get(id)).filter(Boolean)
  return names.length > 0 ? names.join(', ') : '—'
}

/** The KPI set for one role, falling back to the shared default. */
function metricsFor(roleId: string | null | undefined): KpiMetric[] {
  if (!roleId) return [...DEFAULT_KPIS]
  const set = roleKpis.value[roleId]
  return set && set.length > 0 ? set : [...DEFAULT_KPIS]
}

/**
 * What one person is measured on.
 *
 * Somebody holding two roles is measured on the union of both. Taking the
 * intersection would mean a person gains a title and is judged on less, which
 * is exactly backwards.
 */
function metricsForPerson(person: EmployeePublic): KpiMetric[] {
  const roleIds = person.roleIds ?? []
  if (roleIds.length === 0) return [...DEFAULT_KPIS]
  return [...new Set(roleIds.flatMap((id) => metricsFor(id)))]
}

const rows = computed(() =>
  visiblePeople.value.map((person) => ({
    person,
    metrics: metricsForPerson(person),
    values: kpisFor(person.uid, snapshot.value, period.value),
  })),
)

function display(metric: KpiMetric, value: number): string {
  return MONEY_KPIS.includes(metric) ? money(value) : String(value)
}

/** For a metric where lower is better, a non-zero value is the bad case. */
function tone(metric: KpiMetric, value: number): string {
  if (!INVERSE_KPIS.includes(metric)) return value > 0 ? 'pos' : ''
  return value > 0 ? 'neg' : 'pos'
}

async function load(): Promise<void> {
  loading.value = true
  const [snap, e, r, k] = await Promise.all([
    loadSnapshot(),
    fetchEmployees().catch(() => []),
    fetchRoles().catch(() => []),
    fetchRoleKpis().catch(() => ({})),
  ])
  snapshot.value = snap
  people.value = e
  roles.value = r
  roleKpis.value = k
  loading.value = false
}

function startConfigure(roleId: string): void {
  configuringRole.value = roleId
  chosen.value = [...metricsFor(roleId)]
}

function toggleMetric(metric: KpiMetric): void {
  const i = chosen.value.indexOf(metric)
  if (i >= 0) chosen.value.splice(i, 1)
  else chosen.value.push(metric)
}

async function commitKpis(): Promise<void> {
  const roleId = configuringRole.value
  if (!roleId || saving.value) return

  saving.value = true
  try {
    await saveRoleKpi(roleId, chosen.value)
    ui.notify('ok', t('performance.kpisSaved'))
    configuringRole.value = null
    await load()
  } catch {
    ui.notify('danger', t('goals.saveFailed'))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('performance.title') }}</h1>
        <p class="page-subtitle">{{ t('performance.subtitle') }}</p>
      </div>
    </header>

    <div class="note">
      <AppIcon name="gauge" :size="16" />
      <div>
        <p class="note-title">{{ t('performance.noScore') }}</p>
        <p class="note-text">{{ t('performance.noScoreHint') }}</p>
      </div>
    </div>

    <div class="toolbar">
      <div class="segmented">
        <button
          v-for="key in (['week', 'month', 'quarter', 'year'] as PeriodKey[])"
          :key="key"
          type="button"
          :class="{ 'is-on': periodKey === key }"
          @click="periodKey = key"
        >
          {{ t(`period.${key}`) }}
        </button>
      </div>
      <span v-if="!canSeeAll" class="tertiary small">{{ t('performance.onlyMine') }}</span>
    </div>

    <!-- Role KPI configuration ---------------------------------------- -->
    <section v-if="canConfigure && roles.length" class="card">
      <div class="card-header">
        <h2 class="card-title">{{ t('performance.configure') }}</h2>
      </div>
      <p class="card-body tertiary small">{{ t('performance.configureHint') }}</p>

      <ul class="roles">
        <li v-for="role in roles" :key="role.id" class="role">
          <div class="role-line">
            <span class="role-name">{{ role.name }}</span>
            <span class="role-metrics tertiary">
              {{ metricsFor(role.id).map((m) => t(`kpi.${m}`)).join(' · ') }}
            </span>
            <button class="btn btn-ghost btn-sm" @click="startConfigure(role.id)">
              {{ t('common.edit') }}
            </button>
          </div>

          <div v-if="configuringRole === role.id" class="picker">
            <label v-for="m in KPI_METRICS" :key="m" class="check">
              <input type="checkbox" :checked="chosen.includes(m)" @change="toggleMetric(m)" />
              <span class="check-text">{{ t(`kpi.${m}`) }}</span>
            </label>

            <div class="picker-foot">
              <button class="btn btn-secondary btn-sm" @click="configuringRole = null">
                {{ t('common.cancel') }}
              </button>
              <button class="btn btn-primary btn-sm" :disabled="saving" @click="commitKpis">
                {{ t('performance.saveKpis') }}
              </button>
            </div>
          </div>
        </li>
      </ul>
    </section>

    <!-- People --------------------------------------------------------- -->
    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 72px" />
      </div>
    </div>

    <div v-else-if="rows.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="gauge" :size="20" /></span>
        <p class="empty-title">{{ t('performance.empty') }}</p>
        <p class="empty-text">{{ t('performance.emptyHint') }}</p>
      </div>
    </div>

    <div v-else class="grid">
      <article v-for="row in rows" :key="row.person.uid" class="card person">
        <div class="person-head">
          <UserAvatar
            :name="`${row.person.firstName} ${row.person.lastName}`"
            :photo-url="row.person.photoUrl"
            :size="40"
          />
          <div class="person-id">
            <h2 class="person-name">{{ row.person.firstName }} {{ row.person.lastName }}</h2>
            <span class="tertiary">{{ roleLabel(row.person) }}</span>
          </div>
        </div>

        <p v-if="row.metrics.length === 0" class="tertiary small">{{ t('performance.noKpis') }}</p>

        <dl v-else class="kpis">
          <div v-for="m in row.metrics" :key="m">
            <dt>{{ t(`kpi.${m}`) }}</dt>
            <dd :class="tone(m, row.values[m])">{{ display(m, row.values[m]) }}</dd>
          </div>
        </dl>
      </article>
    </div>
  </div>
</template>

<style scoped>
.note {
  display: flex; align-items: flex-start; gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  background: var(--bg-inset); color: var(--text-secondary);
}
.note-title { font-size: var(--text-sm); font-weight: 650; color: var(--text-primary); }
.note-text { font-size: var(--text-xs); line-height: var(--leading-relaxed); margin-top: 2px; }

.segmented { display: inline-flex; padding: 2px; gap: 2px; background: var(--bg-inset); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
.segmented button { padding: 0 var(--space-3); height: 30px; border-radius: var(--radius-sm); font-size: var(--text-sm); font-weight: 550; color: var(--text-tertiary); }
.segmented button.is-on { background: var(--bg-surface-3); color: var(--text-primary); box-shadow: var(--shadow-sm); }

.roles { list-style: none; margin: 0; padding: 0; }
.role { border-top: 1px solid var(--border-subtle); }
.role-line { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-5); }
.role-name { font-weight: 600; min-width: 140px; }
.role-metrics { flex: 1; min-width: 0; font-size: var(--text-xs); }
.picker { display: flex; flex-wrap: wrap; gap: var(--space-3); padding: 0 var(--space-5) var(--space-4); }
.picker-foot { display: flex; gap: var(--space-2); width: 100%; justify-content: flex-end; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--space-4); }
.person { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5); }
.person-head { display: flex; align-items: center; gap: var(--space-3); }
.person-id { min-width: 0; display: flex; flex-direction: column; }
.person-name { font-size: var(--text-md); font-weight: 650; }
.person-id .tertiary { font-size: var(--text-xs); }

.kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-3); margin: 0; }
.kpis dt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); margin-bottom: 2px; }
.kpis dd { margin: 0; font-size: var(--text-md); font-weight: 700; font-variant-numeric: tabular-nums; }

.pos { color: var(--ok-500); }
.neg { color: var(--danger-500); }
.small { font-size: var(--text-xs); }
</style>
