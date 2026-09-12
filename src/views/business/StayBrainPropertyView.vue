<script setup lang="ts">
/**
 * One property: its units as the RMS has them, and the bookings we brought.
 *
 * TWO SOURCES ON ONE PAGE, AND THEY NEVER MIX.
 *
 *   From the RMS, read fresh every time: the units, and every booking against
 *   them whoever took it. This is availability, and it has to be all of them —
 *   a booking the owner took on the phone blocks a unit exactly as firmly as
 *   one of ours.
 *
 *   From MsEe Central: the bookings WE brought, with what each earns us. These
 *   are the only ones that count as sales, and they are counted from our own
 *   database, never from the RMS's list.
 *
 * So the page can say "this unit is taken" about somebody else's booking and
 * still report that we sold six — which is the whole point of the integration.
 *
 * NOTHING IS CACHED. Every visit re-reads the RMS. A remembered calendar would
 * be right until the owner took a booking, and then it would be confidently
 * wrong, which is how a guest gets double-booked.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import RmsConnectionPanel from '@/components/RmsConnectionPanel.vue'
import { RmsConflict, fetchApartments, fetchBookings } from '@/api/rms'
import {
  cancelReservation,
  createReservation,
  fetchReservationsForListing,
  repairReservation,
  totalsOf,
} from '@/api/staybrain'
import { readOne } from '@/api/store'
import { formatDate } from '@/i18n'
import { rmsReady } from '@/lib/rms'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { BASE_CURRENCY, formatMoney } from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import {
  availabilityFor,
  earningFor,
  isOurs,
  nightsBetween,
  type RmsApartment,
  type RmsBooking,
  type StayBrainListing,
} from '@/types/staybrain'
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
const connected = ref(false)

const listing = ref<StayBrainListing | null>(null)
const apartments = ref<RmsApartment[]>([])
const rmsBookings = ref<RmsBooking[]>([])
const ours = ref<Reservation[]>([])

const canCreate = computed(() => auth.hasPermission(PERMISSIONS.STAYBRAIN_CREATE_RESERVATION))
const canSeeRevenue = computed(() => auth.hasPermission(PERMISSIONS.STAYBRAIN_VIEW_REVENUE))

const money = (minor: number) => formatMoney(minor, BASE_CURRENCY, locale.value)
const listingMoney = (minor: number) =>
  formatMoney(minor, listing.value?.currency ?? 'EUR', locale.value)

const totals = computed(() => totalsOf(ours.value))

/* ---- the stay being planned ------------------------------------------- */

const today = new Date().toISOString().slice(0, 10)
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

const checkIn = ref(today)
const checkOut = ref(tomorrow)
const guests = ref(2)

const nights = computed(() => nightsBetween(checkIn.value, checkOut.value).length)

const availability = computed(() =>
  availabilityFor(apartments.value, rmsBookings.value, checkIn.value, checkOut.value, guests.value),
)

const freeCount = computed(() => availability.value.filter((u) => u.free).length)

/* ---- the booking form ------------------------------------------------- */

const formOpen = ref(false)
const chosenUnit = ref<RmsApartment | null>(null)
const guestName = ref('')
const guestContact = ref('')
const guestOrigin = ref('')
const note = ref('')
const total = ref(0)
const saving = ref(false)

/** What the guest pays, suggested from the unit's nightly rate. */
watch([chosenUnit, nights], () => {
  if (!chosenUnit.value) return
  total.value = Number((chosenUnit.value.pricePerNight * nights.value).toFixed(2))
})

/** What we would earn on it, at this listing's terms. */
const earningPreview = computed(() => {
  if (!listing.value) return 0
  const value = {
    minor: Math.round(total.value * 100),
    currency: listing.value.currency,
    rate: listing.value.rate,
    baseMinor: Math.round(total.value * 100 * listing.value.rate),
    rateDate: checkIn.value,
  }
  return earningFor(listing.value.earning, value).minor
})

function startBooking(unit: RmsApartment): void {
  chosenUnit.value = unit
  total.value = Number((unit.pricePerNight * nights.value).toFixed(2))
  guestName.value = ''
  guestContact.value = ''
  guestOrigin.value = ''
  note.value = ''
  formOpen.value = true
}

/* ---- loading ---------------------------------------------------------- */

async function load(): Promise<void> {
  loading.value = true
  notFound.value = false
  try {
    const [row, session] = await Promise.all([
      readOne<StayBrainListing>('staybrainListings', listingId.value),
      rmsReady(),
    ])

    if (!row) {
      notFound.value = true
      return
    }

    listing.value = row
    connected.value = session !== null
    ours.value = await fetchReservationsForListing(row.id)

    if (connected.value && row.rmsWorkspaceId) await loadFromRms()
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

/**
 * The RMS half, on its own so it can be refreshed without reloading the page.
 *
 * Separated because availability goes stale in seconds and somebody about to
 * book wants to be sure — the refresh button is not decoration.
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
  } catch (error) {
    apartments.value = []
    rmsBookings.value = []
    rmsError.value = (error as Error).message
  } finally {
    rmsLoading.value = false
  }
}

/* ---- making the booking ---------------------------------------------- */

async function commit(): Promise<void> {
  const row = listing.value
  const unit = chosenUnit.value
  if (!row || !unit || saving.value) return

  if (!guestName.value.trim()) {
    ui.notify('danger', t('staybrain.needGuest'))
    return
  }
  if (nights.value < 1) {
    ui.notify('danger', t('staybrain.needNights'))
    return
  }

  saving.value = true
  try {
    const outcome = await createReservation({
      listing: row,
      apartmentId: unit.id,
      apartmentName: unit.name,
      pricePerNight: unit.pricePerNight,
      total: total.value,
      guestName: guestName.value.trim(),
      guestContact: guestContact.value.trim(),
      guestOrigin: guestOrigin.value.trim(),
      checkIn: checkIn.value,
      checkOut: checkOut.value,
      nights: nights.value,
      guests: guests.value,
      note: note.value.trim(),
    })

    ui.notify(
      'ok',
      outcome.rms.alreadyExisted
        ? t('staybrain.alreadyThere', { reference: outcome.rms.reservationId })
        : t('staybrain.booked', { reference: outcome.rms.reservationId }),
    )

    formOpen.value = false
    chosenUnit.value = null
    /* Both halves: ours changed, and so did the property's calendar. */
    ours.value = await fetchReservationsForListing(row.id)
    await loadFromRms()
  } catch (error) {
    /*
     * Each failure gets its own sentence. A clash names the guest in the way, so
     * somebody can pick another unit or another week instead of guessing.
     */
    if (error instanceof RmsConflict) {
      ui.notify(
        'danger',
        t('staybrain.clash', {
          guest: error.guestName || t('staybrain.anotherGuest'),
          from: formatDate(error.from),
          to: formatDate(error.to),
        }),
      )
      await loadFromRms()
    } else {
      ui.notify('danger', (error as Error).message || t('errors.generic'))
      ours.value = await fetchReservationsForListing(row.id)
    }
  } finally {
    saving.value = false
  }
}

/* ---- repair and cancel ----------------------------------------------- */

const busyId = ref('')
const pendingCancel = ref<Reservation | null>(null)

/** Ask the RMS whether a booking it never confirmed actually got there. */
async function repair(row: Reservation): Promise<void> {
  busyId.value = row.id
  try {
    const result = await repairReservation(row)
    ui.notify(
      result === 'linked' ? 'ok' : 'warn',
      result === 'linked' ? t('staybrain.repaired') : t('staybrain.notInRms'),
    )
    ours.value = await fetchReservationsForListing(listingId.value)
    await loadFromRms()
  } catch (error) {
    ui.notify('danger', (error as Error).message || t('errors.generic'))
  } finally {
    busyId.value = ''
  }
}

async function confirmCancel(): Promise<void> {
  const row = pendingCancel.value
  if (!row) return

  busyId.value = row.id
  try {
    await cancelReservation(row)
    ui.notify('ok', t('staybrain.cancelled'))
    pendingCancel.value = null
    ours.value = await fetchReservationsForListing(listingId.value)
    await loadFromRms()
  } catch (error) {
    ui.notify('danger', (error as Error).message || t('errors.generic'))
  } finally {
    busyId.value = ''
  }
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
      </header>

      <RmsConnectionPanel :connected="connected" @changed="load" />

      <!-- What we sold here. Ours only, counted from our own records. -->
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
          <span class="figure-label">{{ t('staybrain.unitsLabel') }}</span>
          <span class="figure-value">{{ apartments.length }}</span>
          <span class="figure-hint">{{ t('staybrain.fromRms') }}</span>
        </div>
      </section>

      <!-- Availability ------------------------------------------------- -->
      <section class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">{{ t('staybrain.availability') }}</h2>
            <p class="field-hint">{{ t('staybrain.availabilityHint') }}</p>
          </div>
          <button
            class="btn btn-ghost btn-sm"
            :disabled="rmsLoading || !connected"
            @click="loadFromRms"
          >
            <AppIcon name="history" :size="14" />
            {{ t('staybrain.refresh') }}
          </button>
        </div>

        <div class="card-body dates">
          <div class="field">
            <label class="field-label" for="sb-in">{{ t('staybrain.checkIn') }}</label>
            <input id="sb-in" v-model="checkIn" class="input" type="date" />
          </div>
          <div class="field">
            <label class="field-label" for="sb-out">{{ t('staybrain.checkOut') }}</label>
            <input id="sb-out" v-model="checkOut" class="input" type="date" />
          </div>
          <div class="field">
            <label class="field-label" for="sb-guests">{{ t('staybrain.guests') }}</label>
            <input id="sb-guests" v-model.number="guests" class="input" type="number" min="1" />
          </div>
          <div class="field summary-line">
            <span class="field-label">{{ t('staybrain.nights') }}</span>
            <p class="computed">{{ nights }}</p>
          </div>
        </div>

        <div v-if="!listing.rmsWorkspaceId" class="card-body">
          <p class="field-hint warn">
            <AppIcon name="alert" :size="13" />
            {{ t('staybrain.notLinked') }}
          </p>
        </div>

        <div v-else-if="!connected" class="card-body">
          <p class="field-hint warn">{{ t('staybrain.connectForAvailability') }}</p>
        </div>

        <div v-else-if="rmsLoading" class="card-body stack">
          <div v-for="n in 3" :key="n" class="skeleton" style="height: 36px" />
        </div>

        <div v-else-if="rmsError" class="card-body">
          <p class="field-hint warn">
            <AppIcon name="alert" :size="13" />
            {{ rmsError }}
          </p>
        </div>

        <div v-else-if="!apartments.length" class="empty">
          <p class="empty-title">{{ t('staybrain.noUnits') }}</p>
          <p class="empty-text">{{ t('staybrain.noUnitsHint') }}</p>
        </div>

        <template v-else>
          <p class="card-body count">
            {{ t('staybrain.freeOf', { free: freeCount, all: apartments.length }) }}
          </p>

          <ul class="units">
            <li v-for="unit in availability" :key="unit.apartment.id" class="unit">
              <div class="unit-main">
                <span class="unit-name">{{ unit.apartment.name }}</span>
                <span class="unit-meta">
                  {{ t('staybrain.sleeps', { n: unit.apartment.maxGuests }) }}
                  <template v-if="unit.apartment.pricePerNight > 0">
                    <span class="tertiary">·</span>
                    {{ listingMoney(Math.round(unit.apartment.pricePerNight * 100)) }}
                    {{ t('staybrain.perNight') }}
                  </template>
                </span>
              </div>

              <div class="unit-state">
                <span v-if="unit.free" class="pill free">{{ t('staybrain.free') }}</span>
                <span v-else class="pill taken">{{ t('staybrain.taken') }}</span>
                <span v-if="unit.clash" class="unit-clash">
                  {{ unit.clash.guestName || t('staybrain.anotherGuest') }}
                  <span class="tertiary">
                    {{ formatDate(unit.clash.checkIn) }} – {{ formatDate(unit.clash.checkOut) }}
                  </span>
                  <span v-if="isOurs(unit.clash)" class="mine">{{ t('staybrain.oursTag') }}</span>
                </span>
                <span v-if="unit.tooSmall" class="unit-clash warn">
                  {{ t('staybrain.tooSmall', { n: unit.apartment.maxGuests }) }}
                </span>
              </div>

              <button
                v-if="canCreate"
                class="btn btn-secondary btn-sm"
                :disabled="!unit.free"
                @click="startBooking(unit.apartment)"
              >
                {{ t('staybrain.book') }}
              </button>
            </li>
          </ul>
        </template>
      </section>

      <!-- The booking form --------------------------------------------- -->
      <section v-if="formOpen && chosenUnit" class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">
              {{ t('staybrain.bookingIn', { unit: chosenUnit.name }) }}
            </h2>
            <p class="field-hint">
              {{ formatDate(checkIn) }} – {{ formatDate(checkOut) }} ·
              {{ t('staybrain.nightsCount', { n: nights }) }}
            </p>
          </div>
          <button class="btn btn-ghost btn-sm" @click="formOpen = false">
            <AppIcon name="close" :size="15" />
          </button>
        </div>

        <div class="card-body field-grid">
          <div class="field">
            <label class="field-label" for="sb-guest">{{ t('staybrain.guestName') }}</label>
            <input id="sb-guest" v-model="guestName" class="input" :maxlength="LIMITS.name" />
          </div>
          <div class="field">
            <label class="field-label" for="sb-contact">{{ t('staybrain.contact') }}</label>
            <input id="sb-contact" v-model="guestContact" class="input" :maxlength="LIMITS.shortText" />
          </div>
          <div class="field">
            <label class="field-label" for="sb-origin">{{ t('staybrain.origin') }}</label>
            <input id="sb-origin" v-model="guestOrigin" class="input" :maxlength="LIMITS.shortText" />
            <p class="field-hint">{{ t('staybrain.originHint') }}</p>
          </div>
          <div class="field">
            <label class="field-label" for="sb-total">{{ t('staybrain.total') }}</label>
            <input id="sb-total" v-model.number="total" class="input" type="number" min="0" step="0.01" />
            <p class="field-hint">{{ t('staybrain.totalHint') }}</p>
          </div>
        </div>

        <div class="card-body">
          <div class="field">
            <label class="field-label" for="sb-note">{{ t('staybrain.note') }}</label>
            <input id="sb-note" v-model="note" class="input" :maxlength="LIMITS.shortText" />
          </div>

          <!--
            Said before the booking is made: what the guest pays is the owner's,
            what we earn is ours, and they are different numbers.
          -->
          <p v-if="canSeeRevenue" class="split">
            <span>{{ t('staybrain.theyGet', { amount: listingMoney(Math.round(total * 100)) }) }}</span>
            <span class="brand">{{ t('staybrain.weGet', { amount: listingMoney(earningPreview) }) }}</span>
          </p>

          <div class="row end">
            <button class="btn btn-secondary" @click="formOpen = false">
              {{ t('common.cancel') }}
            </button>
            <button class="btn btn-primary" :disabled="saving" @click="commit">
              <span v-if="saving" class="spinner" />
              {{ t('staybrain.confirmBooking') }}
            </button>
          </div>
          <p class="field-hint">{{ t('staybrain.confirmHint') }}</p>
        </div>
      </section>

      <!-- What we brought --------------------------------------------- -->
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
              <span class="booking-meta">
                {{ row.apartmentName }}
                <span class="tertiary">·</span>
                {{ formatDate(row.checkIn) }} – {{ formatDate(row.checkOut) }}
              </span>
              <span v-if="row.rmsReservationId" class="tertiary small">
                {{ row.rmsReservationId }}
              </span>
            </div>

            <div class="booking-money">
              <span>{{ money(row.value.baseMinor) }}</span>
              <span v-if="canSeeRevenue" class="brand small">
                {{ t('staybrain.weGetShort', { amount: money(row.earning?.baseMinor ?? 0) }) }}
              </span>
            </div>

            <div class="booking-state">
              <span class="pill" :class="row.status === 'cancelled' ? 'taken' : 'free'">
                {{ t(`reservationStatus.${row.status}`) }}
              </span>
              <span class="sync" :class="`sync-${row.syncState}`">
                {{ t(`syncState.${row.syncState}`) }}
              </span>
              <span v-if="row.syncError" class="sync-error">{{ row.syncError }}</span>
            </div>

            <div class="booking-actions">
              <button
                v-if="row.syncState !== 'taken' && canCreate"
                class="btn btn-ghost btn-sm"
                :disabled="busyId === row.id || !connected"
                :title="t('staybrain.checkRms')"
                @click="repair(row)"
              >
                <AppIcon name="history" :size="14" />
              </button>
              <button
                v-if="row.status !== 'cancelled' && canCreate"
                class="btn btn-ghost btn-sm danger"
                :disabled="busyId === row.id"
                :title="t('staybrain.cancel')"
                @click="pendingCancel = row"
              >
                <AppIcon name="close" :size="14" />
              </button>
            </div>
          </li>
        </ul>
      </section>
    </template>

    <ConfirmDialog
      :open="pendingCancel !== null"
      :title="t('staybrain.cancelTitle')"
      :message="t('staybrain.cancelMessage', { guest: pendingCancel?.guestName ?? '' })"
      danger
      :busy="busyId !== ''"
      @confirm="confirmCancel"
      @cancel="pendingCancel = null"
    />
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

.dates {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
}

.summary-line .computed {
  font-size: var(--text-lg);
  font-weight: 600;
  margin: 0;
}

.count {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.units,
.bookings {
  list-style: none;
  margin: 0;
  padding: 0;
}

.unit,
.booking {
  align-items: center;
  display: grid;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}

.unit {
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.5fr) auto;
}

.booking {
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1.2fr) auto;
}

.unit + .unit,
.booking + .booking {
  border-top: 1px solid var(--border-subtle);
}

.unit-main,
.unit-state,
.booking-main,
.booking-money,
.booking-state {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.unit-name,
.booking-guest {
  font-weight: 600;
}

.unit-meta,
.booking-meta,
.unit-clash {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
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

.mine {
  background: var(--brand-50);
  border-radius: var(--radius-full);
  color: var(--brand-700);
  font-size: var(--text-xs);
  margin-left: 4px;
  padding: 0 6px;
}

.sync {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.sync-taken {
  color: var(--ok-500);
}

.sync-failed,
.sync-error {
  color: var(--danger-500);
  font-size: var(--text-xs);
}

.warn {
  color: var(--warn-500);
}

.field-hint.warn {
  align-items: center;
  display: flex;
  gap: 4px;
}

.field-grid {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.split {
  border-top: 1px solid var(--border-subtle);
  display: flex;
  font-size: var(--text-sm);
  gap: var(--space-4);
  justify-content: space-between;
  margin: var(--space-3) 0;
  padding-top: var(--space-3);
}

.row.end {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

.booking-actions {
  display: flex;
  gap: 2px;
}

.booking-actions .danger:hover {
  color: var(--danger-500);
}

@media (max-width: 760px) {
  .unit,
  .booking {
    grid-template-columns: 1fr auto;
  }

  .unit-state,
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
