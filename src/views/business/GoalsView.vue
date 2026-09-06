<script setup lang="ts">
/**
 * Goals & KPIs.
 *
 * A goal stores what to count, never the count. Progress is recomputed from
 * the live records every time this screen opens, so it moves as work happens
 * and nobody has to remember to update anything — which is the failure mode
 * that makes most goal trackers quietly useless within a month.
 *
 * "On track" compares progress against time elapsed, not against the deadline.
 * A goal at 40% is fine in week two and a problem in week nine, and saying so
 * while there is still time to act is the whole point of tracking it.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { deleteGoal, fetchGoals, saveGoal } from '@/api/company'
import { fetchEmployees } from '@/api/employees'
import { fetchDepartments } from '@/api/organisation'
import { goalProgress, loadSnapshot, type Snapshot } from '@/api/metrics'
import { EMPTY_SNAPSHOT } from '@/api/metrics'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import {
  GOAL_METRICS,
  GOAL_SCOPES,
  GOAL_STATUSES,
  MONEY_METRICS,
  type Goal,
  type GoalMetric,
  type GoalScope,
  type GoalStatus,
} from '@/types/company'
import { BASE_CURRENCY, formatMoney, fromMinor, toMinor } from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import type { Department, EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const loading = ref(true)
const saving = ref(false)

const goals = ref<Goal[]>([])
const snapshot = ref<Snapshot>(EMPTY_SNAPSHOT)
const people = ref<EmployeePublic[]>([])
const departments = ref<Department[]>([])

const scopeFilter = ref<'all' | 'mine'>('all')
const pendingDelete = ref<Goal | null>(null)

const canManage = computed(() => auth.hasPermission(PERMISSIONS.GOALS_MANAGE))
const today = new Date().toISOString().slice(0, 10)

interface Draft {
  id: string
  title: string
  description: string
  scope: GoalScope
  departmentId: string | null
  ownerUid: string | null
  metric: GoalMetric
  targetAmount: number
  manualValue: number
  serviceId: string | null
  startDate: string
  endDate: string
  status: GoalStatus
}

const draft = ref<Draft | null>(null)

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

const rows = computed(() =>
  goals.value
    .filter((g) => scopeFilter.value === 'all' || g.ownerUid === auth.uid)
    .map((g) => goalProgress(g, snapshot.value))
    .sort((a, b) => {
      /* Active first, then by how close the deadline is. */
      if (a.goal.status !== b.goal.status) return a.goal.status === 'active' ? -1 : 1
      return a.goal.endDate.localeCompare(b.goal.endDate)
    }),
)

function display(value: number, isMoney: boolean): string {
  return isMoney ? money(value) : String(value)
}

async function load(): Promise<void> {
  loading.value = true
  const [g, snap, e, d] = await Promise.all([
    fetchGoals(),
    loadSnapshot(),
    fetchEmployees().catch(() => []),
    fetchDepartments().catch(() => []),
  ])
  goals.value = g
  snapshot.value = snap
  people.value = e
  departments.value = d
  loading.value = false
}

function startNew(): void {
  const year = today.slice(0, 4)
  draft.value = {
    id: '',
    title: '',
    description: '',
    scope: 'company',
    departmentId: null,
    ownerUid: null,
    metric: 'revenue',
    targetAmount: 0,
    manualValue: 0,
    serviceId: null,
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    status: 'active',
  }
}

function startEdit(goal: Goal): void {
  const isMoney = MONEY_METRICS.includes(goal.metric)
  draft.value = {
    id: goal.id,
    title: goal.title,
    description: goal.description ?? '',
    scope: goal.scope,
    departmentId: goal.departmentId,
    ownerUid: goal.ownerUid,
    metric: goal.metric,
    targetAmount: isMoney ? fromMinor(goal.target, BASE_CURRENCY) : goal.target,
    manualValue: goal.manualValue ?? 0,
    serviceId: goal.serviceId,
    startDate: goal.startDate,
    endDate: goal.endDate,
    status: goal.status,
  }
}

const draftIsMoney = computed(() => !!draft.value && MONEY_METRICS.includes(draft.value.metric))

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.title.trim()) {
    ui.notify('danger', t('goals.titleRequired'))
    return
  }

  const owner = people.value.find((p) => p.uid === d.ownerUid)
  const isMoney = MONEY_METRICS.includes(d.metric)

  saving.value = true
  try {
    await saveGoal({
      id: d.id,
      title: d.title.trim(),
      description: d.description.trim(),
      scope: d.scope,
      departmentId: d.scope === 'department' ? d.departmentId : null,
      ownerUid: d.scope === 'individual' ? d.ownerUid : null,
      ownerName: owner ? `${owner.firstName} ${owner.lastName}` : '',
      metric: d.metric,
      target: isMoney ? toMinor(d.targetAmount, BASE_CURRENCY) : Math.round(d.targetAmount),
      manualValue: isMoney ? toMinor(d.manualValue, BASE_CURRENCY) : Math.round(d.manualValue),
      serviceId: d.serviceId,
      startDate: d.startDate,
      endDate: d.endDate,
      status: d.status,
    } as Goal)

    ui.notify('ok', t('goals.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('goals.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value) return
  await deleteGoal(pendingDelete.value)
  pendingDelete.value = null
  await load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('goals.title') }}</h1>
        <p class="page-subtitle">{{ t('goals.subtitle') }}</p>
      </div>
      <button v-if="canManage && !draft" class="btn btn-primary" @click="startNew">
        <AppIcon name="plus" :size="16" /> {{ t('goals.newGoal') }}
      </button>
    </header>

    <!-- Editor --------------------------------------------------------- -->
    <section v-if="draft" class="card editor">
      <div class="card-header">
        <h2 class="card-title">{{ draft.id ? t('goals.editGoal') : t('goals.newGoal') }}</h2>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="draft = null">
          <AppIcon name="close" :size="18" />
        </button>
      </div>

      <div class="card-body stack">
        <div class="field">
          <label class="field-label" for="g-title">
            {{ t('goals.goalTitle') }}<span class="req">*</span>
          </label>
          <input id="g-title" v-model="draft.title" class="input" :maxlength="LIMITS.position" />
        </div>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="g-scope">{{ t('goals.scope') }}</label>
            <select id="g-scope" v-model="draft.scope" class="select">
              <option v-for="s in GOAL_SCOPES" :key="s" :value="s">{{ t(`goalScope.${s}`) }}</option>
            </select>
          </div>

          <div v-if="draft.scope === 'department'" class="field">
            <label class="field-label" for="g-dept">{{ t('goals.department') }}</label>
            <select id="g-dept" v-model="draft.departmentId" class="select">
              <option :value="null">—</option>
              <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </div>

          <div v-if="draft.scope === 'individual'" class="field">
            <label class="field-label" for="g-owner">{{ t('goals.owner') }}</label>
            <select id="g-owner" v-model="draft.ownerUid" class="select">
              <option :value="null">—</option>
              <option v-for="p in people" :key="p.uid" :value="p.uid">
                {{ p.firstName }} {{ p.lastName }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="g-metric">{{ t('goals.metric') }}</label>
            <select id="g-metric" v-model="draft.metric" class="select">
              <option v-for="m in GOAL_METRICS" :key="m" :value="m">{{ t(`goalMetric.${m}`) }}</option>
            </select>
            <p class="field-hint">{{ t('goals.metricHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="g-target">{{ t('goals.target') }}</label>
            <input
              id="g-target"
              v-model.number="draft.targetAmount"
              class="input"
              type="number"
              :step="draftIsMoney ? 0.01 : 1"
            />
          </div>

          <div v-if="draft.metric === 'manual'" class="field">
            <label class="field-label" for="g-manual">{{ t('goals.manualValue') }}</label>
            <input id="g-manual" v-model.number="draft.manualValue" class="input" type="number" />
            <p class="field-hint">{{ t('goals.manualHint') }}</p>
          </div>

          <div v-if="snapshot.services.length" class="field">
            <label class="field-label" for="g-svc">{{ t('goals.service') }}</label>
            <select id="g-svc" v-model="draft.serviceId" class="select">
              <option :value="null">{{ t('goals.anyService') }}</option>
              <option v-for="s in snapshot.services" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="g-from">{{ t('goals.startDate') }}</label>
            <input id="g-from" v-model="draft.startDate" class="input" type="date" />
          </div>

          <div class="field">
            <label class="field-label" for="g-to">{{ t('goals.endDate') }}</label>
            <input id="g-to" v-model="draft.endDate" class="input" type="date" />
          </div>

          <div class="field">
            <label class="field-label" for="g-status">{{ t('table.status') }}</label>
            <select id="g-status" v-model="draft.status" class="select">
              <option v-for="s in GOAL_STATUSES" :key="s" :value="s">{{ t(`goalStatus.${s}`) }}</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="g-desc">{{ t('goals.description') }}</label>
          <textarea id="g-desc" v-model="draft.description" class="textarea" :maxlength="LIMITS.longText" />
        </div>
      </div>

      <div class="card-footer">
        <button class="btn btn-secondary" @click="draft = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="commit">
          <span v-if="saving" class="spinner" />{{ t('common.save') }}
        </button>
      </div>
    </section>

    <div class="toolbar">
      <div class="segmented">
        <button type="button" :class="{ 'is-on': scopeFilter === 'all' }" @click="scopeFilter = 'all'">
          {{ t('goals.company') }}
        </button>
        <button type="button" :class="{ 'is-on': scopeFilter === 'mine' }" @click="scopeFilter = 'mine'">
          {{ t('goals.mine') }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 80px" />
      </div>
    </div>

    <div v-else-if="rows.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="flag" :size="20" /></span>
        <p class="empty-title">{{ goals.length === 0 ? t('goals.empty') : t('goals.noMatch') }}</p>
        <p class="empty-text">{{ t('goals.emptyHint') }}</p>
        <button v-if="canManage && goals.length === 0" class="btn btn-primary" @click="startNew">
          {{ t('goals.newGoal') }}
        </button>
      </div>
    </div>

    <div v-else class="grid">
      <article v-for="row in rows" :key="row.goal.id" class="card goal">
        <div class="goal-head">
          <div class="goal-id">
            <h2 class="goal-title">{{ row.goal.title }}</h2>
            <span class="tertiary goal-scope">
              {{ t(`goalScope.${row.goal.scope}`) }}
              <template v-if="row.goal.ownerName"> · {{ row.goal.ownerName }}</template>
              · {{ t(`goalMetric.${row.goal.metric}`) }}
            </span>
          </div>
          <span class="badge" :class="`gs-${row.goal.status}`">
            {{ t(`goalStatus.${row.goal.status}`) }}
          </span>
        </div>

        <p v-if="row.goal.description" class="muted goal-desc">{{ row.goal.description }}</p>

        <div class="bar-row">
          <div class="bar-track">
            <span
              class="bar"
              :class="row.onTrack ? 'is-ok' : 'is-behind'"
              :style="{ width: `${Math.min(100, row.percent)}%` }"
            />
          </div>
          <span class="bar-pct" :class="row.onTrack ? 'pos' : 'warn'">{{ row.percent }}%</span>
        </div>

        <dl class="figures">
          <div>
            <dt>{{ t('goals.current') }}</dt>
            <dd>{{ display(row.current, row.isMoney) }}</dd>
          </div>
          <div>
            <dt>{{ t('goals.target') }}</dt>
            <dd>{{ display(row.goal.target, row.isMoney) }}</dd>
          </div>
          <div>
            <dt>{{ t('goals.endDate') }}</dt>
            <dd class="small-value">{{ formatDate(row.goal.endDate) }}</dd>
          </div>
        </dl>

        <div class="goal-foot">
          <span class="status-line" :class="row.onTrack ? 'pos' : 'warn'">
            <AppIcon :name="row.onTrack ? 'check' : 'alert'" :size="13" />
            {{ row.onTrack ? t('goals.onTrack') : t('goals.behind') }}
            <span class="tertiary">
              ·
              {{ row.daysLeft > 0 ? t('goals.daysLeft', { n: row.daysLeft }) : t('goals.ended') }}
            </span>
          </span>

          <span v-if="canManage" class="goal-actions">
            <button class="btn btn-ghost btn-sm" @click="startEdit(row.goal)">
              {{ t('common.edit') }}
            </button>
            <button
              class="btn btn-ghost btn-sm danger"
              :aria-label="t('common.delete')"
              @click="pendingDelete = row.goal"
            >
              <AppIcon name="trash" :size="14" />
            </button>
          </span>
        </div>
      </article>
    </div>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('goals.deleteGoal')"
      :message="t('goals.deleteText')"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>

<style scoped>
.editor { border-color: var(--accent-soft-border); }
.segmented { display: inline-flex; padding: 2px; gap: 2px; background: var(--bg-inset); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
.segmented button { padding: 0 var(--space-3); height: 30px; border-radius: var(--radius-sm); font-size: var(--text-sm); font-weight: 550; color: var(--text-tertiary); }
.segmented button.is-on { background: var(--bg-surface-3); color: var(--text-primary); box-shadow: var(--shadow-sm); }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: var(--space-4); }
.goal { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5); }
.goal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.goal-id { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.goal-title { font-size: var(--text-md); font-weight: 650; }
.goal-scope { font-size: var(--text-xs); }
.goal-desc { font-size: var(--text-sm); line-height: var(--leading-relaxed); }

.bar-row { display: flex; align-items: center; gap: var(--space-3); }
.bar-track { flex: 1; height: 10px; border-radius: var(--radius-full); background: var(--bg-inset); overflow: hidden; }
.bar { display: block; height: 100%; border-radius: var(--radius-full); transition: width var(--dur-normal) var(--ease-out); }
.bar.is-ok { background: var(--ok-500); }
.bar.is-behind { background: var(--warn-500); }
.bar-pct { font-size: var(--text-sm); font-weight: 700; font-variant-numeric: tabular-nums; min-width: 46px; text-align: right; }

.figures { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); margin: 0; }
.figures dt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); margin-bottom: 2px; }
.figures dd { margin: 0; font-size: var(--text-sm); font-weight: 650; font-variant-numeric: tabular-nums; }
.small-value { font-weight: 550 !important; font-size: var(--text-xs) !important; }

.goal-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-top: auto; padding-top: var(--space-3); border-top: 1px solid var(--border-subtle); }
.status-line { display: inline-flex; align-items: center; gap: 5px; font-size: var(--text-xs); font-weight: 600; }
.goal-actions { display: flex; align-items: center; gap: var(--space-1); }

.gs-active { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); color: var(--text-brand); }
.gs-achieved { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.gs-missed { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-500); }
.gs-cancelled { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }

.pos { color: var(--ok-500); }
.warn { color: var(--warn-500); }
.danger:hover { color: var(--danger-500); }
</style>
