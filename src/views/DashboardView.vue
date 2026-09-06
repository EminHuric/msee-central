<script setup lang="ts">
/**
 * The dashboard.
 *
 * Built around one question — what is true right now, and what needs doing —
 * rather than around whatever numbers happen to be easy to count. Alerts come
 * first because they are the only part that asks for a decision; the figures
 * are context for them.
 *
 * It is permission-aware without branching into two dashboards. Every read
 * returns empty when the rules refuse it, so a person who may not see finance
 * gets the same page with the money cards absent — not an error, and not a
 * second implementation to keep in step with this one.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import RankChart from '@/components/ui/RankChart.vue'
import TimeChart from '@/components/ui/TimeChart.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { fetchAuditLog } from '@/api/audit'
import { fetchRequests } from '@/api/approval'
import { expiringSoon } from '@/api/revenue'
import {
  EMPTY_SNAPSHOT,
  companyFigures,
  goalProgress,
  loadSnapshot,
  monthlySeries,
  periodOf,
  previousPeriod,
  revenueByService,
  slice,
  trend,
  type PeriodKey,
  type Snapshot,
} from '@/api/metrics'
import { formatRelative } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { OPEN_STAGES } from '@/types/business'
import { BASE_CURRENCY, formatMoney, formatMoneyShort } from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import type { AuditLogEntry, RegistrationRequest } from '@/types/domain'

const auth = useAuthStore()
const router = useRouter()
const { t, locale } = useI18n()

const loading = ref(true)
const snap = ref<Snapshot>(EMPTY_SNAPSHOT)
const activity = ref<AuditLogEntry[]>([])
const requests = ref<RegistrationRequest[]>([])
const periodKey = ref<PeriodKey>('month')

const today = new Date().toISOString().slice(0, 10)

const canMoney = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_VIEW))
const canAudit = computed(() => auth.hasPermission(PERMISSIONS.AUDIT_VIEW))
const canRequests = computed(() => auth.hasPermission(PERMISSIONS.REQUESTS_VIEW))
const isAffiliate = computed(() => auth.access?.accountType === 'affiliate')

const period = computed(() => periodOf(periodKey.value))
const current = computed(() => slice(snap.value, period.value))
const earlier = computed(() => slice(snap.value, previousPeriod(period.value)))

const figures = computed(() => companyFigures(current.value, snap.value))
const before = computed(() => companyFigures(earlier.value, snap.value))

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}
function short(minor: number): string {
  return formatMoneyShort(minor, BASE_CURRENCY, locale.value)
}

const greeting = computed(() =>
  t('dashboard.greeting', { name: auth.displayName?.split(' ')[0] ?? '' }),
)

const subtitle = computed(() => {
  if (isAffiliate.value) return t('dashboard.subtitleAffiliate')
  return canMoney.value ? t('dashboard.subtitleOwner') : t('dashboard.subtitleEmployee')
})

/* ---- Alerts: the only part that asks for a decision ------------------ */

interface Alert {
  key: string
  label: string
  count: number
  detail: string
  link: string
  tone: 'critical' | 'warn'
}

const alerts = computed<Alert[]>(() => {
  const out: Alert[] = []

  const overdueWork = snap.value.work.filter(
    (w) => w.paymentStatus !== 'paid' && w.dueDate && w.dueDate < today,
  )
  if (overdueWork.length && canMoney.value) {
    out.push({
      key: 'overdue',
      label: t('dashboard.overduePayments'),
      count: overdueWork.length,
      detail: money(overdueWork.reduce((n, w) => n + w.revenue.baseMinor, 0)),
      link: '/finance',
      tone: 'critical',
    })
  }

  const lateTasks = snap.value.tasks.filter(
    (task) =>
      task.status !== 'done' &&
      task.status !== 'cancelled' &&
      task.dueDate &&
      task.dueDate < today &&
      (task.assigneeUid === auth.uid || auth.hasPermission(PERMISSIONS.TASKS_VIEW_ALL)),
  )
  if (lateTasks.length) {
    out.push({
      key: 'tasks',
      label: t('dashboard.overdueTasksAlert'),
      count: lateTasks.length,
      detail: lateTasks[0]?.title ?? '',
      link: '/tasks',
      tone: 'warn',
    })
  }

  const expiring = expiringSoon(snap.value.contracts)
  if (expiring.length) {
    out.push({
      key: 'contracts',
      label: t('dashboard.expiringContracts'),
      count: expiring.length,
      detail: expiring[0] ? `${expiring[0].number} · ${expiring[0].clientName}` : '',
      link: '/contracts',
      tone: 'warn',
    })
  }

  /* A lead untouched for a fortnight is a lead nobody is working. */
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const stale = snap.value.leads.filter(
    (l) => OPEN_STAGES.includes(l.stage) && (l.updatedAt ?? l.createdAt ?? '') < cutoff,
  )
  if (stale.length) {
    out.push({
      key: 'leads',
      label: t('dashboard.staleLeads'),
      count: stale.length,
      detail: stale[0]?.company || stale[0]?.name || '',
      link: '/leads',
      tone: 'warn',
    })
  }

  if (requests.value.length) {
    out.push({
      key: 'requests',
      label: t('dashboard.pendingRequests'),
      count: requests.value.length,
      detail: t('dashboard.review'),
      link: '/requests',
      tone: 'warn',
    })
  }

  return out
})

/* ---- Figures --------------------------------------------------------- */

interface Card {
  key: string
  label: string
  value: string
  delta: number | null
  link?: string
}

const moneyCards = computed<Card[]>(() =>
  canMoney.value
    ? [
        {
          key: 'revenue',
          label: t('finance.revenue'),
          value: money(figures.value.revenueBaseMinor),
          delta: trend(figures.value.revenueBaseMinor, before.value.revenueBaseMinor),
          link: '/finance',
        },
        {
          key: 'net',
          label: t('finance.netProfit'),
          value: money(figures.value.netProfitBaseMinor),
          delta: trend(figures.value.netProfitBaseMinor, before.value.netProfitBaseMinor),
          link: '/finance',
        },
        {
          key: 'cash',
          label: t('dashboard.cashFlow'),
          value: money(figures.value.cashFlowBaseMinor),
          delta: trend(figures.value.cashFlowBaseMinor, before.value.cashFlowBaseMinor),
          link: '/finance',
        },
        {
          key: 'outstanding',
          label: t('finance.outstanding'),
          value: money(figures.value.outstandingBaseMinor),
          delta: null,
          link: '/finance',
        },
      ]
    : [],
)

const workCards = computed<Card[]>(() => [
  {
    key: 'clients',
    label: t('dashboard.activeClients'),
    value: String(figures.value.activeClients),
    delta: trend(figures.value.newClients, before.value.newClients),
    link: '/clients',
  },
  {
    key: 'leads',
    label: t('dashboard.newLeads'),
    value: String(figures.value.newLeads),
    delta: trend(figures.value.newLeads, before.value.newLeads),
    link: '/leads',
  },
  {
    key: 'pipeline',
    label: t('dashboard.pipeline'),
    value: short(figures.value.pipelineBaseMinor),
    delta: null,
    link: '/sales',
  },
  {
    key: 'projects',
    label: t('dashboard.activeProjects'),
    value: String(figures.value.activeProjects),
    delta: null,
    link: '/projects',
  },
  {
    key: 'tasks',
    label: t('dashboard.openTasks'),
    value: String(figures.value.openTasks),
    delta: null,
    link: '/tasks',
  },
  {
    key: 'contracts',
    label: t('dashboard.activeContracts'),
    value: String(figures.value.activeContracts),
    delta: null,
    link: '/contracts',
  },
])

const months = computed(() => monthlySeries(snap.value, 12))

const chart = computed(() => ({
  labels: months.value.map((m) => m.label.slice(5)),
  series: [
    { key: 'revenue', label: t('finance.revenue'), values: months.value.map((m) => m.revenue) },
    { key: 'profit', label: t('finance.netProfit'), values: months.value.map((m) => m.profit) },
  ],
}))

const services = computed(() => revenueByService(current.value))

const goals = computed(() =>
  snap.value.goals
    .filter((g) => g.status === 'active')
    .map((g) => goalProgress(g, snap.value))
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 4),
)

const hasAnything = computed(
  () =>
    snap.value.clients.length > 0 ||
    snap.value.leads.length > 0 ||
    snap.value.tasks.length > 0,
)

async function load(): Promise<void> {
  loading.value = true
  const [s, a, r] = await Promise.all([
    loadSnapshot(),
    canAudit.value ? fetchAuditLog(12).catch(() => []) : Promise.resolve([]),
    canRequests.value ? fetchRequests().catch(() => []) : Promise.resolve([]),
  ])
  snap.value = s
  activity.value = a
  requests.value = r.filter((x) => x.status === 'pending')
  loading.value = false
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ greeting }}</h1>
        <p class="page-subtitle">{{ subtitle }}</p>
      </div>
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
    </header>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 4" :key="n" class="skeleton" style="height: 64px" />
      </div>
    </div>

    <template v-else>
      <!-- Alerts ------------------------------------------------------- -->
      <section v-if="alerts.length" class="alerts">
        <button
          v-for="alert in alerts"
          :key="alert.key"
          type="button"
          class="card alert-card"
          :class="`t-${alert.tone}`"
          @click="router.push(alert.link)"
        >
          <AppIcon name="alert" :size="16" />
          <span class="alert-body">
            <span class="alert-label">{{ alert.label }}</span>
            <span class="alert-detail truncate">{{ alert.detail }}</span>
          </span>
          <span class="alert-count">{{ alert.count }}</span>
        </button>
      </section>

      <div v-else-if="hasAnything" class="all-clear">
        <AppIcon name="check" :size="16" />
        {{ t('dashboard.alertsNone') }}
      </div>

      <!-- Nothing at all yet ------------------------------------------- -->
      <div v-if="!hasAnything" class="card">
        <div class="empty">
          <span class="empty-icon"><AppIcon name="dashboard" :size="20" /></span>
          <p class="empty-title">{{ t('clients.empty') }}</p>
          <p class="empty-text">{{ t('clients.emptyHint') }}</p>
          <button class="btn btn-primary" @click="router.push('/clients')">
            {{ t('clients.newClient') }}
          </button>
        </div>
      </div>

      <template v-else>
        <!-- Money ------------------------------------------------------ -->
        <template v-if="moneyCards.length">
          <h2 class="section-title">{{ t('dashboard.money') }}</h2>
          <div class="cards">
            <button
              v-for="card in moneyCards"
              :key="card.key"
              type="button"
              class="card figure"
              @click="card.link && router.push(card.link)"
            >
              <span class="figure-label">{{ card.label }}</span>
              <span class="figure-value">{{ card.value }}</span>
              <span v-if="card.delta !== null" class="delta" :class="card.delta >= 0 ? 'pos' : 'neg'">
                <AppIcon :name="card.delta >= 0 ? 'arrowUp' : 'arrowDown'" :size="12" />
                {{ Math.abs(card.delta) }}%
              </span>
            </button>
          </div>
        </template>

        <p v-else-if="!isAffiliate" class="tertiary small">{{ t('dashboard.restricted') }}</p>

        <!-- Work ------------------------------------------------------- -->
        <h2 class="section-title">{{ t('dashboard.work') }}</h2>
        <div class="cards">
          <button
            v-for="card in workCards"
            :key="card.key"
            type="button"
            class="card figure"
            @click="card.link && router.push(card.link)"
          >
            <span class="figure-label">{{ card.label }}</span>
            <span class="figure-value">{{ card.value }}</span>
            <span v-if="card.delta !== null" class="delta" :class="card.delta >= 0 ? 'pos' : 'neg'">
              <AppIcon :name="card.delta >= 0 ? 'arrowUp' : 'arrowDown'" :size="12" />
              {{ Math.abs(card.delta) }}%
            </span>
          </button>
        </div>

        <!-- Charts ----------------------------------------------------- -->
        <div v-if="canMoney" class="pair">
          <section class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('analytics.revenueOverTime') }}</h2>
              <button class="btn btn-ghost btn-sm" @click="router.push('/analytics')">
                {{ t('dashboard.seeAll') }}
              </button>
            </div>
            <div class="card-body">
              <TimeChart
                :labels="chart.labels"
                :series="chart.series"
                :format="money"
                :height="190"
                :area="false"
              />
            </div>
          </section>

          <section class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('analytics.byService') }}</h2>
            </div>
            <div class="card-body">
              <RankChart v-if="services.length" :rows="services" :format="short" :limit="6" />
              <p v-else class="tertiary small">{{ t('analytics.noData') }}</p>
            </div>
          </section>
        </div>

        <!-- Goals + activity ------------------------------------------- -->
        <div class="pair">
          <section class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('dashboard.goalsCard') }}</h2>
              <button class="btn btn-ghost btn-sm" @click="router.push('/goals')">
                {{ t('dashboard.seeAll') }}
              </button>
            </div>

            <p v-if="goals.length === 0" class="card-body tertiary small">
              {{ t('dashboard.goalsNone') }}
            </p>

            <ul v-else class="goals">
              <li v-for="row in goals" :key="row.goal.id">
                <span class="goal-name truncate">{{ row.goal.title }}</span>
                <span class="bar-track">
                  <span
                    class="bar"
                    :class="row.onTrack ? 'is-ok' : 'is-behind'"
                    :style="{ width: `${Math.min(100, row.percent)}%` }"
                  />
                </span>
                <span class="goal-pct" :class="row.onTrack ? 'pos' : 'warn'">{{ row.percent }}%</span>
              </li>
            </ul>
          </section>

          <section v-if="canAudit" class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('dashboard.recentActivity') }}</h2>
              <button class="btn btn-ghost btn-sm" @click="router.push('/audit')">
                {{ t('dashboard.seeAll') }}
              </button>
            </div>

            <p v-if="activity.length === 0" class="card-body tertiary small">
              {{ t('dashboard.activityNone') }}
            </p>

            <ul v-else class="activity">
              <li v-for="entry in activity" :key="entry.id">
                <UserAvatar :name="entry.actorName" :size="26" />
                <span class="activity-body">
                  <span class="activity-text truncate">
                    <strong>{{ entry.actorName }}</strong>
                    · {{ t(`auditAction.${entry.action}`) }}
                    <span class="tertiary">{{ entry.targetLabel }}</span>
                  </span>
                  <span class="activity-time tertiary">{{ formatRelative(entry.createdAt) }}</span>
                </span>
              </li>
            </ul>
          </section>
        </div>

        <!-- Quick actions ---------------------------------------------- -->
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('dashboard.quickActions') }}</h2>
          </div>
          <div class="card-body quick">
            <button class="btn btn-secondary" @click="router.push('/tasks')">
              <AppIcon name="check" :size="15" /> {{ t('tasks.newTask') }}
            </button>
            <button class="btn btn-secondary" @click="router.push('/leads')">
              <AppIcon name="target" :size="15" /> {{ t('leads.newLead') }}
            </button>
            <button class="btn btn-secondary" @click="router.push('/clients')">
              <AppIcon name="building" :size="15" /> {{ t('clients.newClient') }}
            </button>
            <button v-if="canMoney" class="btn btn-secondary" @click="router.push('/finance')">
              <AppIcon name="wallet" :size="15" /> {{ t('payments.newPayment') }}
            </button>
            <button class="btn btn-secondary" @click="router.push('/workspace')">
              <AppIcon name="briefcase" :size="15" /> {{ t('workspace.title') }}
            </button>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.segmented { display: inline-flex; padding: 2px; gap: 2px; background: var(--bg-inset); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
.segmented button { padding: 0 var(--space-3); height: 30px; border-radius: var(--radius-sm); font-size: var(--text-sm); font-weight: 550; color: var(--text-tertiary); }
.segmented button.is-on { background: var(--bg-surface-3); color: var(--text-primary); box-shadow: var(--shadow-sm); }

.section-title { font-size: var(--text-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); }

.alerts { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: var(--space-3); }
.alert-card { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); text-align: left; }
.alert-card:hover { border-color: var(--border-strong); }
.alert-card.t-critical { border-color: var(--danger-border); background: var(--danger-bg); color: var(--danger-500); }
.alert-card.t-warn { border-color: var(--warn-border); background: var(--warn-bg); color: var(--warn-500); }
.alert-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.alert-label { font-size: var(--text-sm); font-weight: 650; }
.alert-detail { font-size: var(--text-xs); color: var(--text-secondary); }
.alert-count { font-size: var(--text-lg); font-weight: 700; font-variant-numeric: tabular-nums; }

.all-clear {
  display: flex; align-items: center; gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--ok-border); border-radius: var(--radius-md);
  background: var(--ok-bg); color: var(--ok-500);
  font-size: var(--text-sm); font-weight: 550;
}

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--space-3); }
.figure { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4); text-align: left; }
.figure:hover { border-color: var(--border-strong); }
.figure-label { font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.figure-value { font-size: var(--text-lg); font-weight: 700; font-variant-numeric: tabular-nums; }
.delta { display: inline-flex; align-items: center; gap: 3px; font-size: var(--text-xs); font-weight: 600; }

.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--space-4); }

.goals { list-style: none; margin: 0; padding: 0; }
.goals li { display: grid; grid-template-columns: minmax(90px, 1fr) 2fr auto; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-5); }
.goal-name { font-size: var(--text-sm); }
.bar-track { height: 8px; border-radius: var(--radius-full); background: var(--bg-inset); overflow: hidden; }
.bar { display: block; height: 100%; border-radius: var(--radius-full); }
.bar.is-ok { background: var(--ok-500); }
.bar.is-behind { background: var(--warn-500); }
.goal-pct { font-size: var(--text-xs); font-weight: 700; font-variant-numeric: tabular-nums; min-width: 40px; text-align: right; }

.activity { list-style: none; margin: 0; padding: 0; }
.activity li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-5); }
.activity-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.activity-text { font-size: var(--text-xs); }
.activity-time { font-size: 10px; }

.quick { display: flex; flex-wrap: wrap; gap: var(--space-2); }

.pos { color: var(--ok-500); }
.neg { color: var(--danger-500); }
.warn { color: var(--warn-500); }
.small { font-size: var(--text-xs); }
</style>
