<script setup lang="ts">
/**
 * Analytics.
 *
 * Nothing here is stored. One snapshot is loaded, every chart is derived from
 * it, and the period filter narrows the same snapshot for all of them — so two
 * charts on this screen can never be looking at different data.
 *
 * When there is nothing to show it says so. An empty chart with axes and no
 * marks reads as a broken system rather than a new one.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import PeriodPicker from '@/components/PeriodPicker.vue'
import RankChart from '@/components/ui/RankChart.vue'
import TimeChart from '@/components/ui/TimeChart.vue'
import {
  EMPTY_SNAPSHOT,
  companyFigures,
  conversionOf,
  incomeByClient,
  incomeByService,
  leadFunnel,
  loadSnapshot,
  periodOf,
  previousPeriod,
  seriesOver,
  slice,
  soldByChannel,
  soldByEmployee,
  trend,
  type Period,
  type Snapshot,
} from '@/api/metrics'
import { BASE_CURRENCY, formatMoney, formatMoneyShort } from '@/types/money'

const { t, locale } = useI18n()

const loading = ref(true)
const all = ref<Snapshot>(EMPTY_SNAPSHOT)
const period = ref<Period>(periodOf('year'))

const current = computed(() => slice(all.value, period.value))
const earlier = computed(() => slice(all.value, previousPeriod(period.value)))

const figures = computed(() => companyFigures(current.value, all.value))
const before = computed(() => companyFigures(earlier.value, all.value))

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}
function short(minor: number): string {
  return formatMoneyShort(minor, BASE_CURRENCY, locale.value)
}

const points = computed(() => seriesOver(current.value, period.value))

const moneyChart = computed(() => ({
  labels: points.value.map((p) => p.label),
  series: [
    { key: 'income', label: t('finance.income'), values: points.value.map((p) => p.income) },
    { key: 'expense', label: t('finance.expenses'), values: points.value.map((p) => p.expense) },
    { key: 'profit', label: t('finance.profit'), values: points.value.map((p) => p.profit) },
  ],
}))

const soldChart = computed(() => ({
  labels: points.value.map((p) => p.label),
  series: [{ key: 'sold', label: t('sales.sold'), values: points.value.map((p) => p.sold) }],
}))

const activityChart = computed(() => ({
  labels: points.value.map((p) => p.label),
  series: [
    { key: 'sales', label: t('sales.count'), values: points.value.map((p) => p.salesCount) },
    { key: 'leads', label: t('dashboard.newLeads'), values: points.value.map((p) => p.leads) },
  ],
}))

const byService = computed(() => incomeByService(current.value))
const byClient = computed(() => incomeByClient(current.value))
const byChannel = computed(() =>
  soldByChannel(current.value).map((r) => ({ ...r, label: t(`saleChannel.${r.key}`) })),
)
const byEmployee = computed(() =>
  soldByEmployee(current.value).map((r) => ({
    ...r,
    label: r.key === 'unattributed' ? t('analytics.unattributed') : r.label,
  })),
)
const funnel = computed(() =>
  leadFunnel(current.value).map((r) => ({ ...r, label: t(`leadStage.${r.key}`) })),
)

/** Affiliates ranked by what the sales they brought in are worth. */
const byAffiliate = computed(() => {
  const names = new Map(all.value.affiliates.map((a) => [a.id, a.name]))
  const map = new Map<string, { key: string; label: string; value: number; count: number }>()

  for (const sale of current.value.sales) {
    if (!sale.affiliateId) continue
    const row = map.get(sale.affiliateId) ?? {
      key: sale.affiliateId,
      label: names.get(sale.affiliateId) ?? sale.affiliateName,
      value: 0,
      count: 0,
    }
    row.value += sale.value.baseMinor
    row.count += 1
    map.set(sale.affiliateId, row)
  }

  return [...map.values()].sort((a, b) => b.value - a.value)
})

const conversion = computed(() => conversionOf(current.value))

const headline = computed(() => [
  {
    key: 'income',
    label: t('finance.income'),
    value: money(figures.value.incomeBaseMinor),
    delta: trend(figures.value.incomeBaseMinor, before.value.incomeBaseMinor),
  },
  {
    key: 'profit',
    label: t('finance.profit'),
    value: money(figures.value.profitBaseMinor),
    delta: trend(figures.value.profitBaseMinor, before.value.profitBaseMinor),
  },
  {
    key: 'sold',
    label: t('sales.sold'),
    value: money(figures.value.soldBaseMinor),
    delta: trend(figures.value.soldBaseMinor, before.value.soldBaseMinor),
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

const hasAnything = computed(
  () =>
    all.value.sales.length > 0 ||
    all.value.leads.length > 0 ||
    all.value.transactions.length > 0,
)

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

    <PeriodPicker v-model="period" />

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

      <section class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('finance.overTime') }}</h2>
        </div>
        <div class="card-body">
          <TimeChart
            :labels="moneyChart.labels"
            :series="moneyChart.series"
            :format="money"
            :height="220"
            :area="false"
          />
        </div>
      </section>

      <div class="pair">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('analytics.soldOverTime') }}</h2>
          </div>
          <div class="card-body">
            <TimeChart :labels="soldChart.labels" :series="soldChart.series" :format="money" :height="180" />
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('dashboard.salesAndLeads') }}</h2>
          </div>
          <div class="card-body">
            <TimeChart
              :labels="activityChart.labels"
              :series="activityChart.series"
              :height="180"
              :area="false"
            />
          </div>
        </section>
      </div>

      <div class="pair">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('finance.byService') }}</h2>
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
            <h2 class="card-title">{{ t('finance.byClient') }}</h2>
          </div>
          <div class="card-body">
            <RankChart v-if="byClient.length" :rows="byClient" :format="short" />
            <p v-else class="tertiary small">{{ t('analytics.noData') }}</p>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('finance.bySource') }}</h2>
          </div>
          <div class="card-body">
            <RankChart v-if="byChannel.length" :rows="byChannel" :format="short" />
            <p v-else class="tertiary small">{{ t('analytics.noData') }}</p>
          </div>
        </section>

        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('analytics.byEmployee') }}</h2>
          </div>
          <div class="card-body">
            <RankChart v-if="byEmployee.length" :rows="byEmployee" :format="short" />
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

        <section v-if="byAffiliate.length" class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('analytics.byAffiliate') }}</h2>
          </div>
          <div class="card-body">
            <RankChart :rows="byAffiliate" :format="short" />
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-3); }
.figure { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4); }
.figure-label { font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.figure-value { font-size: var(--text-lg); font-weight: 700; font-variant-numeric: tabular-nums; }
.delta { display: inline-flex; align-items: center; gap: 3px; font-size: var(--text-xs); font-weight: 600; }

.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--space-4); }
.pos { color: var(--ok-500); }
.neg { color: var(--danger-500); }
.small { font-size: var(--text-xs); }
</style>
