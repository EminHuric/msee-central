<script setup lang="ts">
/**
 * Analytics.
 *
 * Nothing on this page is stored. One snapshot is loaded, every chart is
 * derived from it, and the period filter narrows the same snapshot for all of
 * them — so two charts on this screen can never be looking at different data.
 *
 * When there is nothing to show it says so. An empty chart with an axis and no
 * marks looks like a system that is broken rather than one that is new.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import RankChart from '@/components/ui/RankChart.vue'
import TimeChart from '@/components/ui/TimeChart.vue'
import {
  EMPTY_SNAPSHOT,
  companyFigures,
  conversionOf,
  leadFunnel,
  loadSnapshot,
  monthlySeries,
  periodOf,
  previousPeriod,
  revenueByClient,
  revenueByEmployee,
  revenueByService,
  slice,
  trend,
  type PeriodKey,
  type Snapshot,
} from '@/api/metrics'
import { expiringSoon } from '@/api/revenue'
import { formatDate } from '@/i18n'
import { BASE_CURRENCY, formatMoney, formatMoneyShort } from '@/types/money'

const { t, locale } = useI18n()

const loading = ref(true)
const all = ref<Snapshot>(EMPTY_SNAPSHOT)
const periodKey = ref<PeriodKey>('year')

const period = computed(() => periodOf(periodKey.value))
const current = computed(() => slice(all.value, period.value))
const previous = computed(() => slice(all.value, previousPeriod(period.value)))

const figures = computed(() => companyFigures(current.value, all.value))
const before = computed(() => companyFigures(previous.value, all.value))

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

function short(minor: number): string {
  return formatMoneyShort(minor, BASE_CURRENCY, locale.value)
}

/* ---- Series --------------------------------------------------------- */

const months = computed(() => monthlySeries(all.value, 12))

const revenueSeries = computed(() => ({
  labels: months.value.map((m) => m.label.slice(5)),
  series: [
    { key: 'revenue', label: t('finance.revenue'), values: months.value.map((m) => m.revenue) },
    { key: 'collected', label: t('contracts.paid'), values: months.value.map((m) => m.collected) },
  ],
}))

const profitSeries = computed(() => ({
  labels: months.value.map((m) => m.label.slice(5)),
  series: [{ key: 'profit', label: t('finance.netProfit'), values: months.value.map((m) => m.profit) }],
}))

const byService = computed(() =>
  revenueByService(current.value).map((r) => ({ key: r.key, label: r.label, value: r.value })),
)
const byClient = computed(() =>
  revenueByClient(current.value).map((r) => ({ key: r.key, label: r.label, value: r.value })),
)
const byEmployee = computed(() =>
  revenueByEmployee(current.value).map((r) => ({
    key: r.key,
    label: r.key === 'unattributed' ? t('analytics.unattributed') : r.label,
    value: r.value,
  })),
)

const funnel = computed(() =>
  leadFunnel(current.value).map((r) => ({
    key: r.key,
    label: t(`leadStage.${r.key}`),
    value: r.value,
  })),
)

const conversion = computed(() => conversionOf(current.value))
const renewals = computed(() => expiringSoon(all.value.contracts, 90))

const hasAnything = computed(
  () => all.value.work.length > 0 || all.value.leads.length > 0 || all.value.sales.length > 0,
)

/** Cards along the top: the four numbers a period is judged on. */
const headline = computed(() => [
  {
    key: 'revenue',
    label: t('finance.revenue'),
    value: money(figures.value.revenueBaseMinor),
    delta: trend(figures.value.revenueBaseMinor, before.value.revenueBaseMinor),
  },
  {
    key: 'profit',
    label: t('finance.netProfit'),
    value: money(figures.value.netProfitBaseMinor),
    delta: trend(figures.value.netProfitBaseMinor, before.value.netProfitBaseMinor),
  },
  {
    key: 'clients',
    label: t('analytics.clientGrowth'),
    value: String(figures.value.newClients),
    delta: trend(figures.value.newClients, before.value.newClients),
  },
  {
    key: 'conversion',
    label: t('analytics.conversion'),
    value: `${conversion.value}%`,
    delta: null,
  },
])

async function load(): Promise<void> {
  loading.value = true
  all.value = await loadSnapshot()
  loading.value = false
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('analytics.title') }}</h1>
        <p class="page-subtitle">{{ t('analytics.subtitle') }}</p>
      </div>
    </header>

    <div class="toolbar">
      <div class="segmented">
        <button
          v-for="key in (['month', 'quarter', 'year', 'all'] as PeriodKey[])"
          :key="key"
          type="button"
          :class="{ 'is-on': periodKey === key }"
          @click="periodKey = key"
        >
          {{ t(`period.${key}`) }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 90px" />
      </div>
    </div>

    <div v-else-if="!hasAnything" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="chart" :size="20" /></span>
        <p class="empty-title">{{ t('analytics.noData') }}</p>
        <p class="empty-text">{{ t('analytics.noDataHint') }}</p>
      </div>
    </div>

    <template v-else>
      <!-- Headline ---------------------------------------------------- -->
      <div class="figures">
        <article v-for="card in headline" :key="card.key" class="card figure">
          <span class="figure-label">{{ card.label }}</span>
          <span class="figure-value">{{ card.value }}</span>
          <span v-if="card.delta !== null" class="delta" :class="card.delta >= 0 ? 'pos' : 'neg'">
            <AppIcon :name="card.delta >= 0 ? 'arrowUp' : 'arrowDown'" :size="12" />
            {{ Math.abs(card.delta) }}% · {{ t('analytics.compare') }}
          </span>
        </article>
      </div>

      <!-- Over time --------------------------------------------------- -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('analytics.revenueOverTime') }}</h2>
        </div>
        <div class="card-body">
          <TimeChart
            :labels="revenueSeries.labels"
            :series="revenueSeries.series"
            :format="money"
            :height="210"
          />
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('analytics.profitOverTime') }}</h2>
        </div>
        <div class="card-body">
          <TimeChart
            :labels="profitSeries.labels"
            :series="profitSeries.series"
            :format="money"
            :height="180"
          />
        </div>
      </section>

      <!-- Breakdowns -------------------------------------------------- -->
      <div class="pair">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('analytics.byService') }}</h2>
          </div>
          <div class="card-body">
            <RankChart
              v-if="byService.length"
              :rows="byService"
              :format="short"
              :other-label="t('analytics.unattributed')"
            />
            <p v-else class="tertiary small">{{ t('analytics.noData') }}</p>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('analytics.byClient') }}</h2>
          </div>
          <div class="card-body">
            <RankChart
              v-if="byClient.length"
              :rows="byClient"
              :format="short"
              :other-label="t('analytics.unattributed')"
            />
            <p v-else class="tertiary small">{{ t('analytics.noData') }}</p>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('analytics.byEmployee') }}</h2>
          </div>
          <div class="card-body">
            <RankChart
              v-if="byEmployee.length"
              :rows="byEmployee"
              :format="short"
              :other-label="t('analytics.unattributed')"
            />
            <p v-else class="tertiary small">{{ t('analytics.noData') }}</p>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('analytics.funnel') }}</h2>
          </div>
          <div class="card-body">
            <RankChart v-if="funnel.length" :rows="funnel" :limit="7" />
            <p v-else class="tertiary small">{{ t('analytics.noData') }}</p>
          </div>
        </section>
      </div>

      <!-- Renewals ---------------------------------------------------- -->
      <section v-if="renewals.length" class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('analytics.renewals') }}</h2>
          <span class="badge badge-plain">{{ renewals.length }}</span>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>{{ t('contracts.number') }}</th>
                <th>{{ t('table.client') }}</th>
                <th>{{ t('contracts.renewalDate') }}</th>
                <th class="num">{{ t('table.value') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in renewals" :key="c.id">
                <td class="strong">{{ c.number }}</td>
                <td class="muted">{{ c.clientName }}</td>
                <td class="muted nowrap">{{ formatDate(c.renewalDate ?? c.endDate ?? '') }}</td>
                <td class="num">{{ money(c.value.baseMinor) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.segmented { display: inline-flex; padding: 2px; gap: 2px; background: var(--bg-inset); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
.segmented button { padding: 0 var(--space-3); height: 30px; border-radius: var(--radius-sm); font-size: var(--text-sm); font-weight: 550; color: var(--text-tertiary); }
.segmented button.is-on { background: var(--bg-surface-3); color: var(--text-primary); box-shadow: var(--shadow-sm); }

.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: var(--space-3); }
.figure { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4) var(--space-5); }
.figure-label { font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.figure-value { font-size: var(--text-xl); font-weight: 700; font-variant-numeric: tabular-nums; }
.delta { display: inline-flex; align-items: center; gap: 3px; font-size: var(--text-xs); font-weight: 600; }

.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--space-4); }

.pos { color: var(--ok-500); }
.neg { color: var(--danger-500); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.strong { font-weight: 650; }
.nowrap { white-space: nowrap; }
.small { font-size: var(--text-xs); }
</style>
