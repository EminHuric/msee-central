<script setup lang="ts">
/**
 * The dashboard.
 *
 * The CEO should be able to open this and understand the business. So it is
 * arranged as an answer to three questions, in order:
 *
 *   What needs attention?   Alerts, first, because they ask for a decision.
 *   Where does the money stand?  Income, expenses, profit — for the period.
 *   Is it growing?          Charts, with the previous period for comparison.
 *
 * Zero is shown as zero. A day with no revenue is information, and hiding it
 * behind an empty state would make the page lie by omission.
 *
 * Permission-aware without branching into two dashboards: every read returns
 * empty when the rules refuse it, so somebody who may not see finance gets
 * this page with the money section absent — not an error, and not a second
 * implementation to keep in step.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import BusinessOverview, { type MetricInput } from '@/components/BusinessOverview.vue'
import PeriodPicker from '@/components/PeriodPicker.vue'
import RankChart from '@/components/ui/RankChart.vue'
import TimeChart from '@/components/ui/TimeChart.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { fetchRecentActivity } from '@/api/records'
import {
  EMPTY_SNAPSHOT,
  companyFigures,
  conversionOf,
  goalProgress,
  incomeByService,
  loadSnapshot,
  periodOf,
  previousPeriod,
  seriesOver,
  slice,
  soldByChannel,
  trend,
  type Period,
  type Snapshot,
} from '@/api/metrics'
import { balanceOf } from '@/types/revenue'
import { formatRelative } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { OPEN_STAGES } from '@/types/business'
import { BASE_CURRENCY, formatMoney, formatMoneyShort } from '@/types/money'
import { PERMISSIONS, type Permission } from '@/types/permissions'
import { fetchLayout, saveLayout } from '@/api/dashboard'
import {
  availableWidgets,
  defaultLayout,
  resolveLayout,
  type DashboardLayout,
} from '@/types/dashboard'
import type { ActivityEntry } from '@/types/records'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { t, locale } = useI18n()

const loading = ref(true)
const snap = ref<Snapshot>(EMPTY_SNAPSHOT)
const activity = ref<ActivityEntry[]>([])
const period = ref<Period>(periodOf('month'))

const today = new Date().toISOString().slice(0, 10)

const canMoney = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_VIEW))
const isAffiliate = computed(() => auth.access?.accountType === 'affiliate')

const current = computed(() => slice(snap.value, period.value))
const earlier = computed(() => slice(snap.value, previousPeriod(period.value)))

const figures = computed(() => companyFigures(current.value, snap.value))
const before = computed(() => companyFigures(earlier.value, snap.value))

/* Today is always shown alongside the chosen period — it is the one figure
 * the CEO wants without changing a filter. */
const dayFigures = computed(() => companyFigures(slice(snap.value, periodOf('today')), snap.value))

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

/* ---- Alerts ---------------------------------------------------------- */

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

  if (canMoney.value) {
    const overdue = snap.value.transactions.filter(
      (tx) => tx.status !== 'paid' && tx.dueDate && tx.dueDate < today,
    )
    if (overdue.length) {
      out.push({
        key: 'overdue',
        label: t('dashboard.overduePayments'),
        count: overdue.length,
        detail: money(overdue.reduce((n, tx) => n + tx.amount.baseMinor, 0)),
        link: '/finance',
        tone: 'critical',
      })
    }

    const advanceDue = snap.value.sales.filter(
      (s) => balanceOf(s, snap.value.transactions).advanceDue,
    )
    if (advanceDue.length) {
      out.push({
        key: 'advance',
        label: t('dashboard.advanceDue'),
        count: advanceDue.length,
        detail: advanceDue[0]?.title ?? '',
        link: '/sales',
        tone: 'warn',
      })
    }
  }

  /* A lead untouched for a fortnight is a lead nobody is working. */
  const cutoff = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)
  const stale = snap.value.leads.filter(
    (l) => OPEN_STAGES.includes(l.stage) && (l.lastContactedAt ?? '') < cutoff,
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

  const lateProjects = snap.value.projects.filter(
    (p) =>
      p.endDate &&
      p.endDate < today &&
      p.status !== 'completed' &&
      p.status !== 'cancelled',
  )
  if (lateProjects.length) {
    out.push({
      key: 'projects',
      label: t('dashboard.lateProjects'),
      count: lateProjects.length,
      detail: lateProjects[0]?.name ?? '',
      link: '/projects',
      tone: 'warn',
    })
  }

  const pendingWork = snap.value.work.filter((w) => w.status === 'submitted')
  if (pendingWork.length && auth.hasPermission(PERMISSIONS.BONUSES_APPROVE)) {
    out.push({
      key: 'work',
      label: t('dashboard.workToReview'),
      count: pendingWork.length,
      detail: pendingWork[0]?.title ?? '',
      link: '/bonuses',
      tone: 'warn',
    })
  }

  return out
})

/* ---- Cards ----------------------------------------------------------- */

interface Card {
  key: string
  label: string
  value: string
  delta: number | null
  link?: string
  hint?: string
}

const todayCards = computed<Card[]>(() =>
  canMoney.value
    ? [
        {
          key: 'today-income',
          label: t('dashboard.todayIncome'),
          value: money(dayFigures.value.incomeBaseMinor),
          delta: null,
        },
        {
          key: 'today-expense',
          label: t('dashboard.todayExpenses'),
          value: money(dayFigures.value.expenseBaseMinor),
          delta: null,
        },
        {
          key: 'today-profit',
          label: t('dashboard.todayProfit'),
          value: money(dayFigures.value.profitBaseMinor),
          delta: null,
        },
      ]
    : [],
)

const moneyCards = computed<Card[]>(() =>
  canMoney.value
    ? [
        {
          key: 'income',
          label: t('finance.income'),
          value: money(figures.value.incomeBaseMinor),
          delta: trend(figures.value.incomeBaseMinor, before.value.incomeBaseMinor),
          link: '/finance',
        },
        {
          key: 'expense',
          label: t('finance.expenses'),
          value: money(figures.value.expenseBaseMinor),
          delta: trend(figures.value.expenseBaseMinor, before.value.expenseBaseMinor),
          link: '/finance',
        },
        {
          key: 'profit',
          label: t('finance.profit'),
          value: money(figures.value.profitBaseMinor),
          delta: trend(figures.value.profitBaseMinor, before.value.profitBaseMinor),
          link: '/finance',
        },
        {
          key: 'outstanding',
          label: t('finance.outstanding'),
          value: money(figures.value.outstandingBaseMinor),
          delta: null,
          link: '/sales',
          hint: t('dashboard.outstandingHint'),
        },
      ]
    : [],
)

const workCards = computed<Card[]>(() => [
  {
    key: 'sold',
    label: t('sales.sold'),
    value: short(figures.value.soldBaseMinor),
    delta: trend(figures.value.soldBaseMinor, before.value.soldBaseMinor),
    link: '/sales',
  },
  {
    key: 'sales',
    label: t('sales.count'),
    value: String(figures.value.salesCount),
    delta: trend(figures.value.salesCount, before.value.salesCount),
    link: '/sales',
  },
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
    key: 'openLeads',
    label: t('dashboard.openLeads'),
    value: String(figures.value.openLeads),
    delta: null,
    link: '/leads',
  },
  {
    key: 'projects',
    label: t('dashboard.activeProjects'),
    value: String(figures.value.activeProjects),
    delta: null,
    link: '/projects',
  },
])

/* ---- Charts ---------------------------------------------------------- */

const points = computed(() => seriesOver(current.value, period.value))

/**
 * The six metrics the overview chart draws, each with the period before it.
 *
 * Everything is derived from the one snapshot — the totals and the per-point
 * values come from the same records, so the chart and the figure above it can
 * never disagree.
 */
const overviewMetrics = computed<MetricInput[]>(() => [
  {
    key: 'revenue',
    values: points.value.map((p) => p.income),
    total: figures.value.incomeBaseMinor,
    previousTotal: before.value.incomeBaseMinor,
  },
  {
    key: 'expenses',
    values: points.value.map((p) => p.expense),
    total: figures.value.expenseBaseMinor,
    previousTotal: before.value.expenseBaseMinor,
  },
  {
    key: 'profit',
    values: points.value.map((p) => p.profit),
    total: figures.value.profitBaseMinor,
    previousTotal: before.value.profitBaseMinor,
  },
  {
    key: 'clients',
    values: points.value.map((p) => p.clients),
    total: figures.value.newClients,
    previousTotal: before.value.newClients,
  },
  {
    key: 'leads',
    values: points.value.map((p) => p.leads),
    total: figures.value.newLeads,
    previousTotal: before.value.newLeads,
  },
  {
    key: 'sales',
    values: points.value.map((p) => p.salesCount),
    total: figures.value.salesCount,
    previousTotal: before.value.salesCount,
  },
])

const moneyChart = computed(() => ({
  labels: points.value.map((p) => p.label),
  series: [
    { key: 'income', label: t('finance.income'), values: points.value.map((p) => p.income) },
    { key: 'expense', label: t('finance.expenses'), values: points.value.map((p) => p.expense) },
    { key: 'profit', label: t('finance.profit'), values: points.value.map((p) => p.profit) },
  ],
}))

const activityChart = computed(() => ({
  labels: points.value.map((p) => p.label),
  series: [
    { key: 'sales', label: t('sales.count'), values: points.value.map((p) => p.salesCount) },
    { key: 'leads', label: t('dashboard.newLeads'), values: points.value.map((p) => p.leads) },
  ],
}))

const byService = computed(() => incomeByService(current.value))
const byChannel = computed(() =>
  soldByChannel(current.value).map((r) => ({ ...r, label: t(`saleChannel.${r.key}`) })),
)

const conversion = computed(() => conversionOf(current.value))

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
    snap.value.sales.length > 0 ||
    snap.value.transactions.length > 0,
)

/* ---- What this person has chosen to see -------------------------------- */

const layout = ref<DashboardLayout | null>(null)
const customising = ref(false)

const holds = (permission: Permission) => auth.hasPermission(permission)

/**
 * The widgets actually drawn.
 *
 * Filtered through the permission check every time, not only when the picker
 * is open — a layout saved while somebody held `finance.view` keeps naming the
 * money widgets after it is taken away, and this is what stops them appearing.
 * The data behind them is guarded by Firestore's rules regardless; this keeps
 * the screen honest rather than keeping it safe.
 */
const visible = computed(() => resolveLayout(layout.value, holds))
const shows = (id: string) => visible.value.some((w) => w.id === id)

/** Everything this person could add, whether or not it is currently on. */
const offerable = computed(() => availableWidgets(holds))

function toggleWidget(id: string): void {
  if (!layout.value) return
  const list = layout.value.visible
  const at = list.indexOf(id)
  if (at >= 0) list.splice(at, 1)
  else list.push(id)
}

function moveWidget(id: string, by: -1 | 1): void {
  const list = layout.value?.visible
  if (!list) return
  const at = list.indexOf(id)
  const to = at + by
  if (at < 0 || to < 0 || to >= list.length) return
  list.splice(to, 0, ...list.splice(at, 1))
}

async function persistLayout(): Promise<void> {
  if (!layout.value) return
  try {
    await saveLayout(layout.value)
    customising.value = false
    ui.notify('ok', t('widget.saved'))
  } catch {
    ui.notify('danger', t('errors.generic'))
  }
}

async function restoreDefaults(): Promise<void> {
  if (!auth.uid) return
  layout.value = defaultLayout(auth.uid)
  await persistLayout()
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const [s, a, l] = await Promise.all([
      loadSnapshot(),
      fetchRecentActivity(12).catch(() => []),
      auth.uid ? fetchLayout(auth.uid) : Promise.resolve(null),
    ])
    snap.value = s
    activity.value = a
    layout.value = l
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
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
        <h1 class="page-title">{{ greeting }}</h1>
        <p class="page-subtitle">{{ subtitle }}</p>
      </div>
      <button v-if="!loading" class="btn btn-secondary" @click="customising = !customising">
        <AppIcon name="settings" :size="15" />
        {{ t('widget.customise') }}
      </button>
    </header>

    <!--
      The picker.

      It offers only what this person is allowed to see, and what it offers is
      still checked again when each widget renders — see the note on
      `resolveLayout`. Choosing a widget is a preference, never a grant.
    -->
    <section v-if="customising && layout" class="card">
      <div class="card-header">
        <h2 class="card-title">{{ t('widget.customise') }}</h2>
        <button class="btn btn-ghost btn-sm" @click="restoreDefaults">
          {{ t('widget.reset') }}
        </button>
      </div>

      <div class="card-body">
        <p class="field-hint">{{ t('widget.hint') }}</p>

        <ul class="picker">
          <li v-for="widget in offerable" :key="widget.id" class="picker-row">
            <label class="check picker-check">
              <input
                type="checkbox"
                :checked="shows(widget.id)"
                @change="toggleWidget(widget.id)"
              />
              <span class="check-text">{{ t(widget.labelKey) }}</span>
            </label>

            <span v-if="shows(widget.id)" class="picker-move">
              <button
                class="btn btn-ghost btn-sm btn-icon"
                :aria-label="t('fields.moveUp')"
                @click="moveWidget(widget.id, -1)"
              >
                <AppIcon name="arrowUp" :size="14" />
              </button>
              <button
                class="btn btn-ghost btn-sm btn-icon"
                :aria-label="t('fields.moveDown')"
                @click="moveWidget(widget.id, 1)"
              >
                <AppIcon name="arrowDown" :size="14" />
              </button>
            </span>
          </li>
        </ul>
      </div>

      <div class="card-footer">
        <button class="btn btn-secondary" @click="customising = false">
          {{ t('common.cancel') }}
        </button>
        <button class="btn btn-primary" @click="persistLayout">
          {{ t('common.save') }}
        </button>
      </div>
    </section>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 4" :key="n" class="skeleton" style="height: 64px" />
      </div>
    </div>

    <template v-else>
      <!-- Alerts ------------------------------------------------------- -->
      <section v-if="shows('alerts') && alerts.length" class="alerts">
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
          <p class="empty-title">{{ t('dashboard.emptyTitle') }}</p>
          <p class="empty-text">{{ t('dashboard.emptyHint') }}</p>
          <div class="empty-actions">
            <button class="btn btn-primary" @click="router.push('/services')">
              {{ t('services.newService') }}
            </button>
            <button class="btn btn-secondary" @click="router.push('/clients')">
              {{ t('clients.newClient') }}
            </button>
          </div>
        </div>
      </div>

      <template v-else>
        <!-- Today ----------------------------------------------------- -->
        <template v-if="shows('today') && todayCards.length">
          <h2 class="section-title">{{ t('period.today') }}</h2>
          <div class="cards">
            <article v-for="card in todayCards" :key="card.key" class="card figure">
              <span class="figure-label">{{ card.label }}</span>
              <span class="figure-value">{{ card.value }}</span>
            </article>
          </div>
        </template>

        <PeriodPicker v-model="period" />

        <!-- Money ------------------------------------------------------ -->
        <template v-if="shows('money') && moneyCards.length">
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
              <span v-if="card.hint" class="figure-hint">{{ card.hint }}</span>
            </button>
          </div>
        </template>

        <p v-else-if="!isAffiliate" class="tertiary small">{{ t('dashboard.restricted') }}</p>

        <!-- Work ------------------------------------------------------- -->
        <template v-if="shows('work')">
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
        </template>

        <!--
          The overview: one chart, six metrics, each switchable, with the
          period before it beside every figure. See the component for why the
          money and the counts are two groups rather than two axes.
        -->
        <BusinessOverview
          v-if="shows('overview') && canMoney"
          :labels="moneyChart.labels"
          :metrics="overviewMetrics"
          :money="money"
        />

        <!-- Charts ----------------------------------------------------- -->
        <section v-if="shows('moneyChart') && canMoney" class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('finance.overTime') }}</h2>
            <button class="btn btn-ghost btn-sm" @click="router.push('/analytics')">
              {{ t('dashboard.seeAll') }}
            </button>
          </div>
          <div class="card-body">
            <TimeChart
              :labels="moneyChart.labels"
              :series="moneyChart.series"
              :format="money"
              :height="210"
              :area="false"
            />
          </div>
        </section>

        <div class="pair">
          <section v-if="shows('salesAndLeads')" class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('dashboard.salesAndLeads') }}</h2>
            </div>
            <div class="card-body">
              <TimeChart
                :labels="activityChart.labels"
                :series="activityChart.series"
                :height="170"
                :area="false"
              />
              <p class="tertiary small">{{ t('analytics.conversion') }}: {{ conversion }}%</p>
            </div>
          </section>

          <section v-if="shows('byService') && canMoney" class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('finance.byService') }}</h2>
            </div>
            <div class="card-body">
              <RankChart
                v-if="byService.length"
                :rows="byService"
                :format="short"
                :limit="6"
                :other-label="t('analytics.unattributed')"
              />
              <p v-else class="tertiary small">{{ t('analytics.noData') }}</p>
            </div>
          </section>

          <section v-if="shows('bySource')" class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('finance.bySource') }}</h2>
            </div>
            <div class="card-body">
              <RankChart v-if="byChannel.length" :rows="byChannel" :format="short" :limit="6" />
              <p v-else class="tertiary small">{{ t('analytics.noData') }}</p>
            </div>
          </section>
        </div>

        <!-- Goals + activity ------------------------------------------- -->
        <div class="pair">
          <section v-if="shows('goals')" class="card">
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

          <section v-if="shows('activity')" class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('dashboard.recentActivity') }}</h2>
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
                    · {{ t(`activityKind.${entry.kind}`) }}
                    <span class="tertiary">{{ entry.entityLabel }}</span>
                  </span>
                  <span class="activity-time tertiary">{{ formatRelative(entry.createdAt) }}</span>
                </span>
              </li>
            </ul>
          </section>
        </div>

        <!-- Quick actions ---------------------------------------------- -->
        <section v-if="shows('quickActions')" class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('dashboard.quickActions') }}</h2>
          </div>
          <div class="card-body quick">
            <button class="btn btn-secondary" @click="router.push('/leads')">
              <AppIcon name="target" :size="15" /> {{ t('leads.newLead') }}
            </button>
            <button class="btn btn-secondary" @click="router.push('/clients')">
              <AppIcon name="building" :size="15" /> {{ t('clients.newClient') }}
            </button>
            <button class="btn btn-secondary" @click="router.push('/sales')">
              <AppIcon name="trending" :size="15" /> {{ t('sales.newSale') }}
            </button>
            <button v-if="canMoney" class="btn btn-secondary" @click="router.push('/finance')">
              <AppIcon name="wallet" :size="15" /> {{ t('finance.newIncome') }}
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
.section-title { font-size: var(--text-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); }

.picker { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.picker-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-subtle);
}
.picker-row:last-child { border-bottom: 0; }
.picker-check { flex: 1; min-width: 0; }
.picker-move { display: flex; gap: 2px; flex-shrink: 0; }

.alerts { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--space-3); }
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

.empty-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; justify-content: center; }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--space-3); }
.figure { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4); text-align: left; }
.figure-label { font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.figure-value { font-size: var(--text-lg); font-weight: 700; font-variant-numeric: tabular-nums; }
.figure-hint { font-size: 10px; color: var(--text-tertiary); }
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
