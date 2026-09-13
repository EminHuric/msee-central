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

import { useUiStore } from '@/stores/ui'

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

const ui = useUiStore()
const { t, locale } = useI18n()

const loading = ref(true)
const all = ref<Snapshot>(EMPTY_SNAPSHOT)
const period = ref<Period>(periodOf('year'))

const current = computed(() => slice(all.value, period.value))
const earlier = computed(() => slice(all.value, previousPeriod(period.value)))

const figures = computed(() => companyFigures(current.value, all.value))
const before = computed(() => companyFigures(earlier.value, all.value))

/**
 * Every service: what it sold, and whether it is climbing or sliding.
 *
 * ONE NUMBER FOR DIRECTION, NOT THREE FOR CONTEXT. A share of the total says how
 * big a service is, which is visible from the amount beside it; a year-on-year
 * figure needs a year. What is actually being asked is simpler — are we up or
 * down, and by how much a day.
 *
 * So the figure is the daily average of this period against the daily average of
 * the one before. Daily averages rather than totals, because comparing a
 * fortnight with a month would call every service a collapse.
 */
const serviceRows = computed(() => {
  const group = (rows: typeof current.value.sales) => {
    const map = new Map<string, { name: string; value: number; count: number }>()
    rows.forEach((row) => {
      const key = row.serviceId ?? 'none'
      const entry = map.get(key) ?? {
        name: row.serviceName || t('analytics.noService'),
        value: 0,
        count: 0,
      }
      entry.value += row.value.baseMinor
      entry.count += 1
      map.set(key, entry)
    })
    return map
  }

  const daysIn = (p: Period) =>
    Math.max(1, Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1)

  const now = group(current.value.sales)
  const prev = group(earlier.value.sales)
  const nowDays = daysIn(period.value)
  const prevDays = daysIn(previousPeriod(period.value))

  return [...now.entries()]
    .map(([id, row]) => {
      const perDay = row.value / nowDays
      const wasPerDay = (prev.get(id)?.value ?? 0) / prevDays

      return {
        id,
        name: row.name,
        value: row.value,
        count: row.count,
        perDay,
        /* Null when there is nothing before it: new is not the same as flat. */
        daily: wasPerDay > 0 ? Math.round(((perDay - wasPerDay) / wasPerDay) * 100) : null,
      }
    })
    .sort((a, b) => b.value - a.value)
})

/**
 * One line per service over time — the whole business on one chart.
 *
 * The same buckets the money chart above uses, so two charts on this screen can
 * never be showing different days. Capped at the six biggest: a line per service
 * is readable at six and a thicket at twenty, and the rest are in the table
 * underneath where they can be read exactly.
 */
const serviceChart = computed(() => {
  const from = Date.parse(period.value.from)
  const to = Date.parse(period.value.to)
  const days = Math.round((to - from) / 86_400_000) + 1

  /*
   * Days for a short stretch, months for a long one — the same rule the money
   * chart follows, so the two are never showing different buckets. Three hundred
   * daily points is a smear; twelve monthly ones is a trend.
   */
  const byDay = days <= 62
  const keys: string[] = []

  if (byDay) {
    for (let i = 0; i < days; i += 1) {
      keys.push(new Date(from + i * 86_400_000).toISOString().slice(0, 10))
    }
  } else {
    const cursor = new Date(from)
    cursor.setUTCDate(1)
    while (cursor.getTime() <= to) {
      keys.push(cursor.toISOString().slice(0, 7))
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }
  }

  const series = serviceRows.value.slice(0, 6).map((row) => ({
    key: row.id,
    label: row.name,
    values: keys.map((key) =>
      current.value.sales
        .filter((sale) => (sale.serviceId ?? 'none') === row.id && sale.saleDate.startsWith(key))
        .reduce((sum, sale) => sum + sale.value.baseMinor, 0),
    ),
  }))

  return { labels: keys.map((key) => (byDay ? key.slice(5) : key)), series }
})

/**
 * Where this month lands if the rest of it goes like the part already gone.
 *
 * A PACE, NOT A PREDICTION, and the label says so. It is this month's sales
 * divided by the days elapsed, times the days in the month — arithmetic anybody
 * can check, with no model and no confidence anybody has to take on trust.
 *
 * A real forecast needs seasons to learn from, and a company with a few months of
 * history has none: it would produce a convincing line drawn from noise, which is
 * worse than no line. When there is a year to compare with, this is the place it
 * belongs.
 */
const pace = computed(() => {
  const now = new Date()
  const month = slice(all.value, periodOf('month'))
  const sold = month.sales.reduce((sum, row) => sum + row.value.baseMinor, 0)

  const day = now.getUTCDate()
  const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  if (day < 3 || sold <= 0) return null

  return { sold, projected: Math.round((sold / day) * days), day, days }
})

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
  try {
    all.value = await loadSnapshot()
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

      <!--
        Every service, side by side.

        A ranking says which earns most; this says whether each is rising, and
        against what. Those are the two different questions, and only the second
        one changes what anybody does next.
      -->
      <section v-if="serviceRows.length" class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">{{ t('analytics.serviceTable') }}</h2>
            <p class="field-hint">{{ t('analytics.serviceChartHint') }}</p>
          </div>
        </div>

        <!-- Every service over time, one line each. -->
        <div v-if="serviceChart.series.length" class="card-body">
          <TimeChart
            :labels="serviceChart.labels"
            :series="serviceChart.series"
            :format="money"
            :height="230"
            :area="false"
          />
        </div>

        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>{{ t('analytics.service') }}</th>
                <th class="num">{{ t('sales.sold') }}</th>
                <th class="num">{{ t('sales.count') }}</th>
                <th class="num">{{ t('analytics.direction') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in serviceRows" :key="row.id">
                <td>
                  {{ row.name }}
                  <!-- The best seller, said once rather than left to be counted. -->
                  <span v-if="i === 0" class="best">{{ t('analytics.best') }}</span>
                </td>
                <td class="num strong">{{ money(row.value) }}</td>
                <td class="num">{{ row.count }}</td>
                <td class="num" :class="row.daily !== null ? (row.daily >= 0 ? 'up' : 'down') : ''">
                  {{ row.daily === null ? '—' : `${row.daily > 0 ? '+' : ''}${row.daily}%` }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!--
          Where the month lands at this rate. Arithmetic, not a forecast, and it
          says so — a model trained on a few months would draw a convincing line
          through noise.
        -->
        <div v-if="pace" class="card-body pace">
          <span>{{ t('analytics.pace', { amount: money(pace.projected) }) }}</span>
          <span class="tertiary">
            {{ t('analytics.paceBasis', { amount: money(pace.sold), day: pace.day, days: pace.days }) }}
          </span>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.table-wrap {
  overflow-x: auto;
}

.best {
  background: var(--accent-soft-bg);
  border-radius: var(--radius-full);
  color: var(--brand-700);
  font-size: var(--text-xs);
  margin-left: 6px;
  padding: 1px 7px;
}

.up {
  color: var(--ok-500);
}

.down {
  color: var(--danger-500);
}

.pace {
  border-top: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  font-size: var(--text-sm);
  gap: 2px;
}

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
