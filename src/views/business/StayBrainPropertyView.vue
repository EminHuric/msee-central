<script setup lang="ts">
/**
 * One property: its units and calendar as the RMS has them, and what we brought.
 *
 * THIS SCREEN READS AND NEVER WRITES TO THE RMS. Bookings are taken in the RMS,
 * because that is where the phone is answered, and marked there as ours with one
 * tick and a percentage. Everything here is the other end of that: the same
 * calendar, and the guests we brought with what each one earned us.
 *
 * WHY READ-ONLY IS THE BETTER DESIGN AND NOT A LIMITATION. Booking from here
 * would mean the RMS granting an outside account permission to write into other
 * people's calendars — a rules change to deploy, flags to switch on, and a second
 * place a booking can come from, which is a second place a guest can be
 * double-booked. Reading needs none of that and works against the RMS exactly as
 * it already stands. One place takes bookings; one place counts them.
 *
 * TWO SOURCES ON ONE SCREEN, AND THEY NEVER MIX.
 *
 *   From the RMS, read fresh every time: the units and every booking against
 *   them, whoever brought it. That is the calendar, and it has to be all of them.
 *
 *   From MsEe Central: the bookings the RMS marked as ours, with the commission
 *   that was agreed on each. These are the only ones that count as sales, and
 *   they are counted from our own records.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import RmsPropertyLogin from '@/components/RmsPropertyLogin.vue'
import StayBrainCalendar from '@/components/StayBrainCalendar.vue'
import { fetchApartments, fetchBookings } from '@/api/rms'
import { fetchReservationsForListing, importMarkedBookings, totalsOf } from '@/api/staybrain'
import { readOne } from '@/api/store'
import { formatDate } from '@/i18n'
import { rmsConnectAs, rmsReady, rmsSession } from '@/lib/rms'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { BASE_CURRENCY, formatMoney } from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import type { RmsApartment, RmsBooking, StayBrainListing } from '@/types/staybrain'
import type { Reservation } from '@/types/reservations'

const route = useRoute()
const auth = useAuthStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const listingId = computed(() => String(route.params.id ?? ''))

const loading = ref(true)
const notFound = ref(false)
const rmsLoading = ref(false)
const rmsError = ref('')

const listing = ref<StayBrainListing | null>(null)
const apartments = ref<RmsApartment[]>([])
const rmsBookings = ref<RmsBooking[]>([])
const ours = ref<Reservation[]>([])

/**
 * Connected to the reservation system at all.
 *
 * NOT "connected as this property's own account", which is what this used to
 * demand and why nothing loaded. Two kinds of login can read a property:
 *
 *   the property's own account — which needs that client's password, and we do
 *   not always have it;
 *
 *   an administrator account on the platform — one login that reads every
 *   property, which is what the owner of the platform already has.
 *
 * Insisting on the first made the second useless and left every property saying
 * "not connected" to somebody who was, in fact, connected. Whether a session can
 * actually read this property is a question only the read can answer, so the read
 * is what decides: it either returns the calendar or it is refused, and a refusal
 * says so.
 */
const connected = computed(() => rmsSession.value !== null)

const connecting = ref(false)
const loginProblem = ref('')
const canSeeRevenue = computed(() => auth.hasPermission(PERMISSIONS.STAYBRAIN_VIEW_REVENUE))

const money = (minor: number) => formatMoney(minor, BASE_CURRENCY, locale.value)
const listingMoney = (minor: number) =>
  formatMoney(minor, listing.value?.currency ?? 'EUR', locale.value)

const totals = computed(() => totalsOf(ours.value))

/** The property's own bookings — not ours, and never counted as sales. */
const theirs = computed(
  () => rmsBookings.value.filter((b) => b.source !== 'MSEE' && b.status !== 'cancelled').length,
)

async function load(): Promise<void> {
  loading.value = true
  notFound.value = false
  try {
    /* rmsReady() is awaited so the session is restored before anything is drawn. */
    const [row] = await Promise.all([
      readOne<StayBrainListing>('staybrainListings', listingId.value),
      rmsReady(),
    ])

    if (!row) {
      notFound.value = true
      return
    }

    listing.value = row
    ours.value = await fetchReservationsForListing(row.id)

    /*
     * Connect as this property's own account, with the password this browser
     * remembers. Nothing is asked of anybody when there is one — which is the
     * point of remembering it.
     */
    if (row.rmsWorkspaceId) await connect()
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

/**
 * Become this property's account, then read it.
 *
 * `password` is passed only the first time on a device. After that it comes from
 * what was remembered, so opening a property is one click and no typing.
 */
async function connect(login?: { email: string; password: string }): Promise<void> {
  const row = listing.value
  if (!row || connecting.value) return

  connecting.value = true
  loginProblem.value = ''
  try {
    /* A login just typed: use it, and remember it if it works. */
    if (login) {
      const result = await rmsConnectAs(login.email, login.password)
      if (result.state !== 'ready') {
        loginProblem.value = t('rms.propertyRefused', {
          code: result.state === 'failed' ? result.code : 'incomplete',
        })
        return
      }
      await loadFromRms()
      return
    }

    /*
     * No login typed, so try in order of preference:
     *
     *   1. this property's own account, if this browser remembers its password;
     *   2. whatever session already exists — an administrator login reads every
     *      property, and that is the common case.
     *
     * Only when neither applies does anybody get asked for anything.
     */
    if (row.rmsAccountEmail) {
      const result = await rmsConnectAs(row.rmsAccountEmail)
      if (result.state === 'ready') {
        await loadFromRms()
        return
      }
    }

    if (rmsSession.value) {
      await loadFromRms()
      return
    }
  } finally {
    connecting.value = false
  }
}

/**
 * The RMS half, separately so it can be re-read without reloading the page.
 *
 * A booking can be taken or marked as ours at any moment, so the refresh button
 * is not decoration.
 */
async function loadFromRms(): Promise<void> {
  const row = listing.value
  if (!row?.rmsWorkspaceId) return

  rmsLoading.value = true
  rmsError.value = ''
  try {
    const [units, bookings] = await Promise.all([
      fetchApartments(row.rmsWorkspaceId),
      fetchBookings(row.rmsWorkspaceId),
    ])
    apartments.value = units
    rmsBookings.value = bookings

    /*
     * Pick up whatever was marked "through MsEe" over there.
     *
     * THIS IS THE WHOLE MECHANISM. One tick on the booking in the RMS, and opening
     * this screen turns it into a reservation here with the commission that was
     * typed beside it. Idempotent, so it runs on every load, does nothing when
     * there is nothing new, and writes nothing at all when nothing has changed.
     */
    const picked = await importMarkedBookings(row, bookings, ours.value)
    if (picked.added > 0) ui.notify('ok', t('staybrain.picked', { n: picked.added }))
    if (picked.added > 0 || picked.updated > 0) {
      ours.value = await fetchReservationsForListing(row.id)
    }
  } catch (error) {
    apartments.value = []
    rmsBookings.value = []
    rmsError.value = (error as Error).message
    /*
     * Refused rather than unreachable means this session cannot see this
     * property — so the login panel is the answer, not a retry.
     */
    if ((error as Error).name === 'RmsRefused') {
      loginProblem.value = t('rms.cannotSeeProperty')
    }
  } finally {
    rmsLoading.value = false
  }
}

/**
 * What the property has collected on one of our bookings.
 *
 * Read from the RMS and never stored here. Deposits and payments are the owner's
 * ledger against their own guest; "booked" and "paid" are different facts, and
 * chasing one should not mean opening a second system to learn the other.
 */
function paymentOf(row: Reservation): { status: string; paid: number; total: number } | null {
  if (!row.rmsBookingId) return null
  const booking = rmsBookings.value.find((b) => b.id === row.rmsBookingId)
  if (!booking) return null
  return { status: booking.paymentStatus, paid: booking.totalPaid, total: booking.totalPrice }
}

/** The percentage typed on the booking in the RMS, when there was one. */
function percentOf(row: Reservation): number | null {
  const booking = rmsBookings.value.find((b) => b.id === row.rmsBookingId)
  return booking?.mseeCommissionPercent || null
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div v-if="loading" class="stack">
      <div class="skeleton" style="height: 70px" />
      <div class="skeleton" style="height: 200px" />
    </div>

    <div v-else-if="notFound" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="alert" :size="20" /></span>
        <p class="empty-title">{{ t('staybrain.listingGone') }}</p>
        <RouterLink to="/staybrain" class="btn btn-secondary btn-sm">
          {{ t('staybrain.backToList') }}
        </RouterLink>
      </div>
    </div>

    <template v-else-if="listing">
      <header class="page-head">
        <div>
          <RouterLink to="/staybrain" class="back">
            <AppIcon name="chevronRight" :size="13" />
            {{ t('staybrain.title') }}
          </RouterLink>
          <h1 class="page-title">{{ listing.name }}</h1>
          <p class="page-subtitle">{{ listing.clientName }}</p>
        </div>
        <button
          class="btn btn-secondary"
          :disabled="rmsLoading || connecting || !listing.rmsAccountEmail"
          @click="connect()"
        >
          <AppIcon name="history" :size="15" />
          {{ t('staybrain.refresh') }}
        </button>
      </header>

      <RmsPropertyLogin
        :email="listing.rmsAccountEmail"
        :problem="loginProblem"
        :busy="connecting || rmsLoading"
        @connect="connect"
        @forget="load"
      />

      <!-- What we brought. Ours only, counted from our own records. -->
      <section class="card summary">
        <div>
          <span class="figure-label">{{ t('staybrain.ourReservations') }}</span>
          <span class="figure-value">{{ totals.reservations }}</span>
          <span class="figure-hint">{{ t('staybrain.nightsSold', { n: totals.nights }) }}</span>
        </div>
        <div>
          <span class="figure-label">{{ t('staybrain.ourTurnover') }}</span>
          <span class="figure-value">{{ money(totals.turnoverBaseMinor) }}</span>
          <span class="figure-hint">{{ t('staybrain.ourTurnoverHint') }}</span>
        </div>
        <div v-if="canSeeRevenue">
          <span class="figure-label">{{ t('staybrain.ourRevenue') }}</span>
          <span class="figure-value brand">{{ money(totals.revenueBaseMinor) }}</span>
          <span class="figure-hint">{{ t('staybrain.ourRevenueHint') }}</span>
        </div>
        <div>
          <span class="figure-label">{{ t('staybrain.theirBookings') }}</span>
          <span class="figure-value">{{ theirs }}</span>
          <span class="figure-hint">{{ t('staybrain.theirBookingsHint') }}</span>
        </div>
      </section>

      <!-- Why nothing here is editable, said once rather than implied. -->
      <p class="where-to-book">
        <AppIcon name="info" :size="14" />
        {{ t('staybrain.bookInRms') }}
      </p>

      <div v-if="!listing.rmsWorkspaceId" class="card">
        <div class="card-body">
          <p class="field-hint warn">
            <AppIcon name="alert" :size="13" />
            {{ t('staybrain.notLinked') }}
          </p>
        </div>
      </div>

      <div v-else-if="!connected" class="card">
        <div class="card-body">
          <p class="field-hint">{{ t('staybrain.connectForAvailability') }}</p>
        </div>
      </div>

      <div v-else-if="rmsLoading" class="card">
        <div class="card-body stack">
          <div v-for="n in 4" :key="n" class="skeleton" style="height: 30px" />
        </div>
      </div>

      <div v-else-if="rmsError" class="card">
        <div class="card-body">
          <p class="field-hint warn">
            <AppIcon name="alert" :size="13" />
            {{ rmsError }}
          </p>
        </div>
      </div>

      <template v-else>
        <!-- The calendar, exactly as the property has it. -->
        <StayBrainCalendar
          v-if="apartments.length"
          :apartments="apartments"
          :bookings="rmsBookings"
          :currency="listing.currency"
        />

        <!-- The units, with what the RMS knows about each. -->
        <section v-if="apartments.length" class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('staybrain.unitsLabel') }}</h2>
            <p class="field-hint">{{ t('staybrain.fromRms') }}</p>
          </div>
          <ul class="units">
            <li v-for="unit in apartments" :key="unit.id" class="unit">
              <span class="unit-name">{{ unit.name }}</span>
              <span class="unit-meta">{{ t('staybrain.sleeps', { n: unit.maxGuests }) }}</span>
              <span class="unit-meta">
                <template v-if="unit.pricePerNight > 0">
                  {{ listingMoney(Math.round(unit.pricePerNight * 100)) }}
                  {{ t('staybrain.perNight') }}
                </template>
              </span>
              <span v-if="unit.description" class="unit-meta desc">{{ unit.description }}</span>
            </li>
          </ul>
        </section>

        <div v-else class="card">
          <div class="empty">
            <p class="empty-title">{{ t('staybrain.noUnits') }}</p>
            <p class="empty-text">{{ t('staybrain.noUnitsHint') }}</p>
          </div>
        </div>
      </template>

      <!-- The guests we brought, with everything the RMS knows about them. -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('staybrain.ourBookings') }}</h2>
        </div>

        <div v-if="!ours.length" class="empty">
          <p class="empty-title">{{ t('staybrain.noneYet') }}</p>
          <p class="empty-text">{{ t('staybrain.noneYetHint') }}</p>
        </div>

        <ul v-else class="bookings">
          <li v-for="row in ours" :key="row.id" class="booking">
            <div class="booking-main">
              <span class="booking-guest">{{ row.guestName }}</span>
              <span v-if="row.guestContact" class="booking-meta">{{ row.guestContact }}</span>
              <span class="booking-meta">
                {{ formatDate(row.checkIn) }} – {{ formatDate(row.checkOut) }}
                <span class="tertiary">·</span>
                {{ t('staybrain.nightsCount', { n: row.nights }) }}
              </span>
              <span v-if="row.note" class="booking-meta desc">{{ row.note }}</span>
            </div>

            <div class="booking-money">
              <span>{{ money(row.value.baseMinor) }}</span>
              <span v-if="canSeeRevenue" class="brand small">
                {{ t('staybrain.weGetShort', { amount: money(row.earning?.baseMinor ?? 0) }) }}
                <template v-if="percentOf(row)">({{ percentOf(row) }}%)</template>
              </span>
            </div>

            <div class="booking-state">
              <span class="pill" :class="row.status === 'cancelled' ? 'taken' : 'free'">
                {{ t(`reservationStatus.${row.status}`) }}
              </span>
              <span v-if="paymentOf(row)" class="paid" :class="`paid-${paymentOf(row)?.status}`">
                {{ t(`paymentState.${paymentOf(row)?.status}`) }}
                <span class="tertiary">
                  {{ listingMoney(Math.round((paymentOf(row)?.paid ?? 0) * 100)) }}
                  /
                  {{ listingMoney(Math.round((paymentOf(row)?.total ?? 0) * 100)) }}
                </span>
              </span>
              <span v-if="row.rmsReservationId" class="tertiary small">
                {{ row.rmsReservationId }}
              </span>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.back {
  align-items: center;
  color: var(--text-tertiary);
  display: inline-flex;
  font-size: var(--text-xs);
  gap: 2px;
  text-decoration: none;
}

.back :deep(svg) {
  transform: rotate(180deg);
}

.summary {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  padding: var(--space-4);
}

.summary > div {
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

.where-to-book {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  font-size: var(--text-sm);
  gap: var(--space-2);
}

.units,
.bookings {
  list-style: none;
  margin: 0;
  padding: 0;
}

.unit {
  align-items: baseline;
  display: grid;
  gap: var(--space-3);
  grid-template-columns: minmax(0, 1fr) auto auto;
  padding: var(--space-2) var(--space-4);
}

.unit + .unit,
.booking + .booking {
  border-top: 1px solid var(--border-subtle);
}

.unit-name,
.booking-guest {
  font-weight: 600;
}

.unit-meta,
.booking-meta {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.desc {
  grid-column: 1 / -1;
}

.booking {
  align-items: center;
  display: grid;
  gap: var(--space-3);
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1.2fr);
  padding: var(--space-3) var(--space-4);
}

.booking-main,
.booking-money,
.booking-state {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.small {
  font-size: var(--text-xs);
}

.pill {
  align-self: flex-start;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  padding: 1px 8px;
}

.pill.free {
  background: var(--ok-bg);
  border: 1px solid var(--ok-border);
  color: var(--ok-500);
}

.pill.taken {
  background: var(--bg-surface-2);
  border: 1px solid var(--border-subtle);
  color: var(--text-tertiary);
}

.paid {
  font-size: var(--text-xs);
}

.paid-paid {
  color: var(--ok-500);
}

.paid-unpaid {
  color: var(--warn-500);
}

.field-hint.warn {
  align-items: center;
  color: var(--warn-500);
  display: flex;
  gap: 4px;
}

@media (max-width: 760px) {
  .booking,
  .unit {
    grid-template-columns: 1fr auto;
  }

  .booking-state {
    grid-column: 1 / -1;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .booking-money {
    align-items: flex-end;
  }
}
</style>
