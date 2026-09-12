<script setup lang="ts">
/**
 * StayBrain on the dashboard.
 *
 * ONLY MSEE-ATTRIBUTED BOOKINGS, like everywhere else in StayBrain. This reads
 * our own reservations and never the RMS, so the figures here are the same
 * figures as on the property cards by construction rather than by agreement.
 *
 * It answers the questions worth asking from a dashboard: how much, where from,
 * and when. Best property and best month are shown as the ranked lists they
 * are — a single "best" with nothing beside it tells you the winner and hides
 * whether it won by a mile or a nose.
 *
 * Loaded by the widget itself rather than by the dashboard's snapshot. The
 * snapshot is the company's money and is read by half the screen; this is one
 * card, and a card that can fail on its own is better than a dashboard that
 * fails as a whole.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RankChart from '@/components/ui/RankChart.vue'
import { fetchListings, fetchStayBrainReservations, totalsByListing, totalsOf } from '@/api/staybrain'
import { useAuthStore } from '@/stores/auth'
import { BASE_CURRENCY, formatMoney, fromMinor } from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import { EARNING_STATUSES, type Reservation } from '@/types/reservations'
import type { StayBrainListing } from '@/types/staybrain'

const auth = useAuthStore()
const { t, locale } = useI18n()

const loading = ref(true)
const failed = ref(false)
const rows = ref<Reservation[]>([])
const listings = ref<StayBrainListing[]>([])

const canSeeRevenue = computed(() => auth.hasPermission(PERMISSIONS.STAYBRAIN_VIEW_REVENUE))

const money = (minor: number) => formatMoney(minor, BASE_CURRENCY, locale.value)
/** Compact, for chart labels where a full amount would not fit. */
const short = (minor: number) => `${Math.round(fromMinor(minor, BASE_CURRENCY)).toLocaleString(locale.value)}`

const totals = computed(() => totalsOf(rows.value))

/** Our revenue per property, highest first. */
const byProperty = computed(() => {
  const byListing = totalsByListing(rows.value)
  const names = new Map(listings.value.map((l) => [l.id, l.name]))

  return [...byListing.entries()]
    .map(([id, row]) => ({
      key: id,
      label: names.get(id) ?? t('staybrain.unknownProperty'),
      value: canSeeRevenue.value ? row.revenueBaseMinor : row.turnoverBaseMinor,
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
})

/**
 * By month of arrival, not of entry.
 *
 * A booking made in March for August belongs to August: that is when the guest
 * stays, when the owner earns, and when we are owed. Grouping by when somebody
 * typed it in would put next season's work in this month's figures.
 */
const byMonth = computed(() => {
  const months = new Map<string, number>()

  rows.value.forEach((row) => {
    if (!EARNING_STATUSES.includes(row.status)) return
    const month = row.checkIn.slice(0, 7)
    const amount = canSeeRevenue.value ? (row.earning?.baseMinor ?? 0) : row.value.baseMinor
    months.set(month, (months.get(month) ?? 0) + amount)
  })

  return [...months.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)
    .map(([month, value]) => ({ key: month, label: month, value }))
})

onMounted(async () => {
  try {
    const [sold, props] = await Promise.all([fetchStayBrainReservations(), fetchListings()])
    rows.value = sold
    listings.value = props
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <section class="card">
    <div class="card-header">
      <h2 class="card-title">{{ t('staybrain.title') }}</h2>
      <RouterLink to="/staybrain" class="btn btn-ghost btn-sm">
        {{ t('dashboard.seeAll') }}
      </RouterLink>
    </div>

    <div v-if="loading" class="card-body stack">
      <div class="skeleton" style="height: 48px" />
      <div class="skeleton" style="height: 80px" />
    </div>

    <p v-else-if="failed" class="card-body tertiary small">{{ t('errors.loadFailed') }}</p>

    <p v-else-if="!rows.length" class="card-body tertiary small">
      {{ t('staybrain.noneSoldYet') }}
    </p>

    <template v-else>
      <div class="card-body figures">
        <div>
          <span class="figure-label">{{ t('staybrain.ourReservations') }}</span>
          <span class="figure-value">{{ totals.reservations }}</span>
          <span class="figure-hint">{{ t('staybrain.nightsSold', { n: totals.nights }) }}</span>
        </div>
        <div>
          <span class="figure-label">{{ t('staybrain.ourTurnover') }}</span>
          <span class="figure-value">{{ money(totals.turnoverBaseMinor) }}</span>
        </div>
        <div v-if="canSeeRevenue">
          <span class="figure-label">{{ t('staybrain.ourRevenue') }}</span>
          <span class="figure-value brand">{{ money(totals.revenueBaseMinor) }}</span>
        </div>
      </div>

      <div class="card-body ranks">
        <div>
          <h3 class="rank-title">
            {{ canSeeRevenue ? t('staybrain.revenueByProperty') : t('staybrain.turnoverByProperty') }}
          </h3>
          <RankChart v-if="byProperty.length" :rows="byProperty" :format="short" :limit="5" />
          <p v-else class="tertiary small">{{ t('analytics.noData') }}</p>
        </div>

        <div>
          <h3 class="rank-title">{{ t('staybrain.byMonth') }}</h3>
          <RankChart v-if="byMonth.length" :rows="byMonth" :format="short" :limit="6" />
          <p v-else class="tertiary small">{{ t('analytics.noData') }}</p>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.figures {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
}

.figures > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.figure-label {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.figure-value {
  font-size: var(--text-xl);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.figure-hint {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.brand {
  color: var(--brand-500);
}

.ranks {
  border-top: 1px solid var(--border-subtle);
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.rank-title {
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  margin: 0 0 var(--space-2);
  text-transform: uppercase;
}
</style>
