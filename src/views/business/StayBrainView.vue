<script setup lang="ts">
/**
 * StayBrain — the properties we sell stays for.
 *
 * EVERY FIGURE ON THIS PAGE IS OURS ALONE. A property may have taken thirty
 * bookings; if we brought six, every card here says six. The RMS's own total
 * never appears, because this page answers "what did we do" and not "how is the
 * property doing" — the second question is the owner's, and they have a whole
 * system for it.
 *
 * That separation is structural rather than careful arithmetic: these numbers are
 * summed from MsEe Central's own reservations, and the RMS is not even read on
 * this screen. The two cannot converge by accident.
 *
 * NOTHING HERE TOUCHES THE RESERVATION SYSTEM. These figures come from our own
 * records, so this page is correct with nothing connected. Each property holds its
 * own login and signs in when it is opened — see RmsPropertyLogin.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import StayBrainListingDialog from '@/components/StayBrainListingDialog.vue'
import {
  deleteListing,
  fetchListings,
  fetchStayBrainReservations,
  totalsByListing,
} from '@/api/staybrain'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { BASE_CURRENCY, formatMoney } from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import { EMPTY_TOTALS, type StayBrainListing } from '@/types/staybrain'
import type { Reservation } from '@/types/reservations'

const auth = useAuthStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const loading = ref(true)
const listings = ref<StayBrainListing[]>([])
const reservations = ref<Reservation[]>([])

const editing = ref<StayBrainListing | null>(null)
const pendingDelete = ref<StayBrainListing | null>(null)
const deleting = ref(false)

const canManage = computed(() => auth.hasPermission(PERMISSIONS.STAYBRAIN_MANAGE))
const canSeeRevenue = computed(() => auth.hasPermission(PERMISSIONS.STAYBRAIN_VIEW_REVENUE))

const money = (minor: number) => formatMoney(minor, BASE_CURRENCY, locale.value)

/**
 * What this property earns us, in words.
 *
 * On the card because the terms are per client and that is the point: one hotel
 * at a flat fee, another at a percentage, a third at a different fee. Keeping it
 * only inside the edit dialog made per-client pricing look like a single global
 * setting — which is the opposite of what it is.
 */
/**
 * Everything one client is worth to us, in the three parts it is made of.
 *
 * KEPT APART ALL THE WAY UP. The fee is for joining the service; the commission
 * is for the bookings we brought; the client's turnover is neither — it is their
 * money, and it is here only because "we brought them €12,000" is the sentence
 * that justifies the other two. Adding the first two happens once, at the end,
 * under a label that says total.
 */
function valueOf(listing: StayBrainListing) {
  const row = totalsFor(listing.id)
  const fee = listing.joinFee?.baseMinor ?? 0

  return {
    feeBaseMinor: fee,
    reservations: row.reservations,
    turnoverBaseMinor: row.turnoverBaseMinor,
    commissionBaseMinor: row.revenueBaseMinor,
    totalBaseMinor: fee + row.revenueBaseMinor,
  }
}

async function confirmDelete(): Promise<void> {
  const row = pendingDelete.value
  if (!row || deleting.value) return

  deleting.value = true
  try {
    await deleteListing(row)
    ui.notify('ok', t('staybrain.listingDeleted'))
    pendingDelete.value = null
    await load()
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    deleting.value = false
  }
}

const totals = computed(() => totalsByListing(reservations.value))

const totalsFor = (id: string) => totals.value.get(id) ?? EMPTY_TOTALS

/** The whole of StayBrain, across every property. */
const overall = computed(() =>
  [...totals.value.values()].reduce(
    (sum, row) => ({
      reservations: sum.reservations + row.reservations,
      earning: sum.earning + row.earning,
      nights: sum.nights + row.nights,
      turnoverBaseMinor: sum.turnoverBaseMinor + row.turnoverBaseMinor,
      revenueBaseMinor: sum.revenueBaseMinor + row.revenueBaseMinor,
    }),
    { ...EMPTY_TOTALS },
  ),
)

/** Joining fees, across every client. Our revenue for the service itself. */
const feesTotal = computed(() =>
  listings.value.reduce((sum, row) => sum + (row.joinFee?.baseMinor ?? 0), 0),
)

/** Bookings entered here that the RMS never confirmed. Worth chasing. */
const unconfirmed = computed(
  () => reservations.value.filter((r) => r.syncState !== 'taken' && r.syncState !== 'local_only').length,
)

const active = computed(() => listings.value.filter((l) => l.active))
const retired = computed(() => listings.value.filter((l) => !l.active))

async function load(): Promise<void> {
  loading.value = true
  try {
    /*
     * No reservation system is read here.
     *
     * Every figure on this page is counted from MsEe Central's own reservations,
     * so the page works whether or not anything is connected — and each property
     * signs in to its own account when it is opened.
     */
    const [rows, sold] = await Promise.all([fetchListings(), fetchStayBrainReservations()])
    listings.value = rows
    reservations.value = sold
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

function addListing(): void {
  editing.value = null
  dialogOpen.value = true
}

const dialogOpen = ref(false)

function editListing(listing: StayBrainListing): void {
  editing.value = listing
  dialogOpen.value = true
}

async function afterSave(): Promise<void> {
  dialogOpen.value = false
  editing.value = null
  await load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1 class="page-title">{{ t('staybrain.title') }}</h1>
        <p class="page-subtitle">{{ t('staybrain.subtitle') }}</p>
      </div>
      <button v-if="canManage" class="btn btn-primary" @click="addListing">
        <AppIcon name="plus" :size="15" />
        {{ t('staybrain.addListing') }}
      </button>
    </header>

    <div v-if="loading" class="grid">
      <div v-for="n in 3" :key="n" class="skeleton" style="height: 150px" />
    </div>

    <template v-else>
      <!-- What StayBrain has done in total -->
      <section v-if="listings.length" class="card summary">
        <div class="summary-figure">
          <span class="figure-label">{{ t('staybrain.ourReservations') }}</span>
          <span class="figure-value">{{ overall.reservations }}</span>
          <span class="figure-hint">{{ t('staybrain.nightsSold', { n: overall.nights }) }}</span>
        </div>

        <div class="summary-figure">
          <span class="figure-label">{{ t('staybrain.ourTurnover') }}</span>
          <span class="figure-value">{{ money(overall.turnoverBaseMinor) }}</span>
          <span class="figure-hint">{{ t('staybrain.ourTurnoverHint') }}</span>
        </div>

        <div v-if="canSeeRevenue" class="summary-figure">
          <span class="figure-label">{{ t('staybrain.feesTotal') }}</span>
          <span class="figure-value">{{ money(feesTotal) }}</span>
          <span class="figure-hint">{{ t('staybrain.feesTotalHint') }}</span>
        </div>

        <div v-if="canSeeRevenue" class="summary-figure">
          <span class="figure-label">{{ t('staybrain.commissionTotal') }}</span>
          <span class="figure-value">{{ money(overall.revenueBaseMinor) }}</span>
          <span class="figure-hint">{{ t('staybrain.commissionTotalHint') }}</span>
        </div>

        <!-- The only place the two are added, and it says so. -->
        <div v-if="canSeeRevenue" class="summary-figure lead">
          <span class="figure-label">{{ t('staybrain.earnedTotal') }}</span>
          <span class="figure-value brand">{{ money(feesTotal + overall.revenueBaseMinor) }}</span>
          <span class="figure-hint">{{ t('staybrain.earnedTotalHint') }}</span>
        </div>

        <div v-if="unconfirmed > 0" class="summary-figure warn">
          <span class="figure-label">{{ t('staybrain.unconfirmed') }}</span>
          <span class="figure-value">{{ unconfirmed }}</span>
          <span class="figure-hint">{{ t('staybrain.unconfirmedHint') }}</span>
        </div>
      </section>

      <div v-if="!listings.length" class="card">
        <div class="empty">
          <span class="empty-icon"><AppIcon name="building" :size="20" /></span>
          <p class="empty-title">{{ t('staybrain.empty') }}</p>
          <p class="empty-text">{{ t('staybrain.emptyHint') }}</p>
          <button v-if="canManage" class="btn btn-primary btn-sm" @click="addListing">
            {{ t('staybrain.addListing') }}
          </button>
        </div>
      </div>

      <div v-else class="grid">
        <article v-for="listing in active" :key="listing.id" class="listing">
          <RouterLink :to="`/staybrain/${listing.id}`" class="listing-main">
            <header class="listing-head">
              <h2 class="listing-name">{{ listing.name }}</h2>
              <span class="listing-client">{{ listing.clientName }}</span>
            </header>

            <dl class="listing-figures">
              <div>
                <dt>{{ t('staybrain.ourReservations') }}</dt>
                <dd>{{ valueOf(listing).reservations }}</dd>
              </div>
              <div>
                <dt>{{ t('staybrain.ourTurnover') }}</dt>
                <dd>{{ money(valueOf(listing).turnoverBaseMinor) }}</dd>
              </div>
              <template v-if="canSeeRevenue">
                <div>
                  <dt>{{ t('staybrain.joinFeeShort') }}</dt>
                  <dd>{{ money(valueOf(listing).feeBaseMinor) }}</dd>
                </div>
                <div>
                  <dt>{{ t('staybrain.commissionShort') }}</dt>
                  <dd>{{ money(valueOf(listing).commissionBaseMinor) }}</dd>
                </div>
                <div class="total">
                  <dt>{{ t('staybrain.earnedTotal') }}</dt>
                  <dd class="brand">{{ money(valueOf(listing).totalBaseMinor) }}</dd>
                </div>
              </template>
            </dl>

            <p class="listing-open">{{ t('staybrain.openToSee') }}</p>

            <p v-if="!listing.rmsWorkspaceId" class="listing-warning">
              <AppIcon name="alert" :size="13" />
              {{ t('staybrain.notLinked') }}
            </p>
          </RouterLink>

          <footer v-if="canManage" class="listing-foot">
            <button class="btn btn-ghost btn-sm" @click="editListing(listing)">
              <AppIcon name="edit" :size="13" />
              {{ t('staybrain.terms') }}
            </button>
            <span class="spacer" />
            <button
              class="btn btn-ghost btn-sm danger"
              :aria-label="t('staybrain.removeListing')"
              :title="t('staybrain.removeListing')"
              @click="pendingDelete = listing"
            >
              <AppIcon name="trash" :size="14" />
            </button>
          </footer>
        </article>
      </div>

      <section v-if="retired.length" class="card retired">
        <h2 class="card-title">{{ t('staybrain.retired') }}</h2>
        <ul>
          <li v-for="listing in retired" :key="listing.id">
            <RouterLink :to="`/staybrain/${listing.id}`">{{ listing.name }}</RouterLink>
            <span class="tertiary">{{ listing.clientName }}</span>
            <span class="spacer" />
            <button
              v-if="canManage"
              class="btn btn-ghost btn-sm danger"
              :aria-label="t('staybrain.removeListing')"
              :title="t('staybrain.removeListing')"
              @click="pendingDelete = listing"
            >
              <AppIcon name="trash" :size="13" />
            </button>
          </li>
        </ul>
      </section>
    </template>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('staybrain.removeTitle')"
      :message="t('staybrain.removeMessage', { name: pendingDelete?.name ?? '' })"
      danger
      :busy="deleting"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />

    <StayBrainListingDialog
      :open="dialogOpen"
      :listing="editing"
      @saved="afterSave"
      @close="dialogOpen = false"
    />
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}

.summary {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  padding: var(--space-4);
}

.summary-figure {
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

.lead .figure-value {
  font-size: var(--text-2xl);
}

.brand {
  color: var(--brand-500);
}

.figure-hint {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.warn .figure-value {
  color: var(--warn-500);
}

.listing {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.listing-main {
  color: inherit;
  display: block;
  padding: var(--space-4);
  text-decoration: none;
}

.listing-main:hover .listing-name {
  color: var(--brand-500);
}

.listing-head {
  margin-bottom: var(--space-3);
}

.listing-name {
  font-size: var(--text-lg);
  font-weight: 600;
  margin: 0;
}

.listing-client {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.listing-figures {
  display: grid;
  gap: var(--space-2);
  margin: 0;
}

.listing-figures div {
  align-items: baseline;
  display: flex;
  justify-content: space-between;
}

.listing-figures dt {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.listing-figures dd {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  margin: 0;
}

.listing-figures .total {
  border-top: 1px solid var(--border-subtle);
  margin-top: 2px;
  padding-top: 4px;
}

.listing-open {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  margin-top: var(--space-3);
}

.listing-warning {
  align-items: center;
  color: var(--warn-500);
  display: flex;
  font-size: var(--text-xs);
  gap: 4px;
  margin-top: var(--space-3);
}

.listing-foot {
  border-top: 1px solid var(--border-subtle);
  display: flex;
  justify-content: flex-end;
  padding: var(--space-2) var(--space-3);
}

.retired {
  padding: var(--space-4);
}

.retired ul {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
}

.retired li {
  align-items: center;
  display: flex;
  gap: var(--space-2);
  padding: 2px 0;
}

.spacer {
  flex: 1;
}

.danger:hover {
  color: var(--danger-500);
}
</style>
