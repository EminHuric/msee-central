<script setup lang="ts">
/**
 * The bookings we brought this client.
 *
 * WHY THE BOOKING IS ENTERED HERE AND NOT THERE.
 *
 * "How much did we bring them" used to be a number somebody decided once a
 * month. Entering the booking here makes it a count instead: a row in this list
 * is one we brought, because entering it is the only way a row gets here. The
 * monthly figure on the finance tab then reads this list rather than a box
 * somebody typed into, and the commission follows from the rate without anybody
 * doing arithmetic.
 *
 * The RMS still holds every booking for the property, ours and everybody's —
 * that is what it is for, and nothing here competes with it. It comes and
 * collects these, which is why each row shows where it has got to. It is not
 * pushed: pushing would mean this browser holding the RMS's credentials, and
 * anything a browser holds is readable by whoever opens the console.
 *
 * So `pending` is not an error state. It means entered, ours, and waiting to be
 * picked up. `failed` is the one that wants a person.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import {
  deleteReservation,
  fetchReservationsFor,
  keepLocal,
  retrySync,
  saveReservation,
} from '@/api/reservations'
import { moneyOf } from '@/api/sales'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { BASE_CURRENCY, formatMoney, fromMinor } from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import {
  RESERVATION_STATUSES,
  blankReservation,
  broughtFor,
  nightsBetween,
  type Reservation,
} from '@/types/reservations'
import type { Client } from '@/types/business'

const props = defineProps<{ client: Client }>()

const auth = useAuthStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const loading = ref(true)
const saving = ref(false)
const busyId = ref('')

const rows = ref<Reservation[]>([])

const draft = ref<Reservation | null>(null)
/** The value in whole currency, because nobody types minor units. */
const draftValue = ref(0)

const pendingDelete = ref<Reservation | null>(null)

const canView = computed(() => auth.hasPermission(PERMISSIONS.RESERVATIONS_VIEW))
const canCreate = computed(() => auth.hasPermission(PERMISSIONS.RESERVATIONS_CREATE))
const canEdit = computed(() => auth.hasPermission(PERMISSIONS.RESERVATIONS_EDIT))
const canDelete = computed(() => auth.hasPermission(PERMISSIONS.RESERVATIONS_DELETE))

const money = (minor: number) => formatMoney(minor, BASE_CURRENCY, locale.value)

/** The client's agreed rate. Edited on the finance tab, read here. */
const sharePercent = computed(() => props.client.msEeSharePercent ?? 0)

const totals = computed(() => broughtFor(rows.value, sharePercent.value))

/**
 * What the booking being typed would earn us.
 *
 * Shown while it can still be corrected. Computed from the value and the rate
 * rather than entered, for the same reason the monthly share is: a third number
 * somebody types is a third number that can disagree with the two it follows
 * from.
 */
const draftShareMinor = computed(() =>
  Math.round(draftValue.value * 100 * (sharePercent.value / 100)),
)

/**
 * Nights, suggested from the dates and then left alone.
 *
 * Only while the dates are being changed, and only on a new booking: a figure
 * somebody deliberately corrected must not be overwritten the next time they
 * touch a date. A three-night rate over four dates is a real thing, and the
 * number that matters for money is the one that was agreed.
 */
watch(
  () => [draft.value?.checkIn, draft.value?.checkOut],
  () => {
    const d = draft.value
    if (!d || d.id) return
    d.nights = nightsBetween(d.checkIn, d.checkOut)
  },
)

async function load(): Promise<void> {
  loading.value = true
  try {
    rows.value = await fetchReservationsFor(props.client.id)
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

function start(): void {
  draft.value = blankReservation(props.client.id, props.client.name)
  draftValue.value = 0
}

function edit(row: Reservation): void {
  draft.value = { ...row }
  draftValue.value = fromMinor(row.value.baseMinor, BASE_CURRENCY)
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return

  if (!d.guestName.trim()) {
    ui.notify('danger', t('reservations.needGuest'))
    return
  }
  if (d.nights < 1) {
    ui.notify('danger', t('reservations.needNights'))
    return
  }

  saving.value = true
  try {
    await saveReservation({
      ...d,
      guestName: d.guestName.trim(),
      guestContact: d.guestContact.trim(),
      source: d.source.trim(),
      note: d.note.trim(),
      value: moneyOf(draftValue.value, BASE_CURRENCY),
    })
    ui.notify('ok', d.id ? t('reservations.updated') : t('reservations.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    saving.value = false
  }
}

/** Put a refused booking back in the queue, once somebody has fixed it. */
async function retry(row: Reservation): Promise<void> {
  busyId.value = row.id
  try {
    await retrySync(row)
    ui.notify('ok', t('reservations.queued'))
    await load()
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    busyId.value = ''
  }
}

/** Stop waiting for a booking the RMS will never hold. */
async function markLocal(row: Reservation): Promise<void> {
  busyId.value = row.id
  try {
    await keepLocal(row)
    ui.notify('ok', t('reservations.keptLocal'))
    await load()
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    busyId.value = ''
  }
}

async function confirmDelete(): Promise<void> {
  const row = pendingDelete.value
  if (!row) return

  busyId.value = row.id
  try {
    await deleteReservation(row)
    ui.notify('ok', t('reservations.deleted'))
    pendingDelete.value = null
    await load()
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    busyId.value = ''
  }
}

/** Which of the three sync states a row is in, as an icon. */
function syncIcon(state: Reservation['syncState']): 'check' | 'alert' | 'clock' {
  if (state === 'taken') return 'check'
  if (state === 'failed') return 'alert'
  return 'clock'
}

/** Our share of one booking, at the client's rate. */
function shareOf(row: Reservation): number {
  return Math.round((row.value.baseMinor * sharePercent.value) / 100)
}

onMounted(load)
</script>

<template>
  <section v-if="canView" class="card">
    <div class="card-header">
      <div>
        <h2 class="card-title">{{ t('reservations.title') }}</h2>
        <p class="field-hint">{{ t('reservations.subtitle') }}</p>
      </div>
      <button v-if="canCreate && !draft" class="btn btn-primary btn-sm" @click="start">
        <AppIcon name="plus" :size="14" />
        {{ t('reservations.add') }}
      </button>
    </div>

    <div v-if="loading" class="card-body stack">
      <div v-for="n in 3" :key="n" class="skeleton" style="height: 40px" />
    </div>

    <template v-else>
      <!-- What we brought, and what it is worth to us. -->
      <div class="card-body figures">
        <div class="lead">
          <span class="figure-label">{{ t('reservations.brought') }}</span>
          <span class="figure-value brand">{{ money(totals.broughtBaseMinor) }}</span>
          <span class="figure-hint">
            {{ t('reservations.broughtHint', { n: totals.reservations, nights: totals.nights }) }}
          </span>
        </div>

        <div>
          <span class="figure-label">{{ t('reservations.ourShare') }}</span>
          <span class="figure-value">{{ money(totals.ourShareBaseMinor) }}</span>
          <span class="figure-hint">
            {{ sharePercent > 0
              ? t('reservations.atRate', { rate: sharePercent })
              : t('reservations.noRate') }}
          </span>
        </div>

        <div>
          <span class="figure-label">{{ t('reservations.withRms') }}</span>
          <span class="figure-value">{{ totals.pending }}</span>
          <span class="figure-hint">
            {{ totals.failed > 0
              ? t('reservations.someFailed', { n: totals.failed })
              : t('reservations.pendingHint') }}
          </span>
        </div>
      </div>

      <!-- Entering or correcting one ---------------------------------- -->
      <div v-if="draft" class="card-body stack editor">
        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="r-guest">{{ t('reservations.guest') }}</label>
            <input
              id="r-guest"
              v-model="draft.guestName"
              class="input"
              :maxlength="LIMITS.name"
              :placeholder="t('reservations.guestPlaceholder')"
            />
          </div>

          <div class="field">
            <label class="field-label" for="r-contact">{{ t('reservations.contact') }}</label>
            <input
              id="r-contact"
              v-model="draft.guestContact"
              class="input"
              :maxlength="LIMITS.shortText"
            />
            <p class="field-hint">{{ t('reservations.contactHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="r-in">{{ t('reservations.checkIn') }}</label>
            <input id="r-in" v-model="draft.checkIn" class="input" type="date" />
          </div>

          <div class="field">
            <label class="field-label" for="r-out">{{ t('reservations.checkOut') }}</label>
            <input id="r-out" v-model="draft.checkOut" class="input" type="date" />
          </div>

          <div class="field">
            <label class="field-label" for="r-nights">{{ t('reservations.nights') }}</label>
            <input
              id="r-nights"
              v-model.number="draft.nights"
              class="input"
              type="number"
              min="1"
              step="1"
            />
            <p class="field-hint">{{ t('reservations.nightsHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="r-guests">{{ t('reservations.guests') }}</label>
            <input
              id="r-guests"
              v-model.number="draft.guests"
              class="input"
              type="number"
              min="1"
              step="1"
            />
          </div>

          <div class="field">
            <label class="field-label" for="r-value">{{ t('reservations.value') }}</label>
            <input
              id="r-value"
              v-model.number="draftValue"
              class="input"
              type="number"
              min="0"
              step="0.01"
            />
            <p class="field-hint">{{ t('reservations.valueHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="r-source">{{ t('reservations.source') }}</label>
            <input
              id="r-source"
              v-model="draft.source"
              class="input"
              :maxlength="LIMITS.shortText"
              :placeholder="t('reservations.sourcePlaceholder')"
            />
            <p class="field-hint">{{ t('reservations.sourceHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="r-status">{{ t('reservations.status') }}</label>
            <select id="r-status" v-model="draft.status" class="select">
              <option v-for="s in RESERVATION_STATUSES" :key="s" :value="s">
                {{ t(`reservationStatus.${s}`) }}
              </option>
            </select>
            <p class="field-hint">{{ t(`reservationStatusHint.${draft.status}`) }}</p>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="r-note">{{ t('reservations.note') }}</label>
          <input id="r-note" v-model="draft.note" class="input" :maxlength="LIMITS.shortText" />
        </div>

        <!--
          Said before saving rather than after: the share is the rate times the
          value, and somebody entering a booking should see what it earns while
          they can still correct the figure it came from.
        -->
        <p v-if="sharePercent > 0" class="computed-line">
          {{ t('reservations.willEarn', { amount: money(draftShareMinor), rate: sharePercent }) }}
        </p>
        <p v-else class="field-hint">{{ t('reservations.setRateFirst') }}</p>

        <div class="row editor-actions">
          <button class="btn btn-secondary" @click="draft = null">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="saving" @click="commit">
            <span v-if="saving" class="spinner" />
            {{ t('common.save') }}
          </button>
        </div>
      </div>

      <!-- The bookings themselves ------------------------------------- -->
      <div v-if="rows.length === 0 && !draft" class="empty">
        <span class="empty-icon"><AppIcon name="calendar" :size="20" /></span>
        <p class="empty-title">{{ t('reservations.empty') }}</p>
        <p class="empty-text">{{ t('reservations.emptyHint') }}</p>
      </div>

      <ul v-else-if="rows.length" class="bookings">
        <li v-for="row in rows" :key="row.id" class="booking">
          <div class="booking-main">
            <span class="booking-guest">{{ row.guestName }}</span>
            <span class="booking-dates">
              {{ formatDate(row.checkIn) }}
              <span class="tertiary">·</span>
              {{ t('reservations.nightsCount', { n: row.nights }) }}
              <span class="tertiary">·</span>
              {{ t('reservations.guestsCount', { n: row.guests }) }}
            </span>
            <span v-if="row.source" class="booking-source">{{ row.source }}</span>
          </div>

          <div class="booking-money">
            <span class="booking-value">{{ money(row.value.baseMinor) }}</span>
            <span v-if="sharePercent > 0" class="booking-share">
              {{ t('reservations.ours', { amount: money(shareOf(row)) }) }}
            </span>
          </div>

          <div class="booking-state">
            <span class="pill" :class="`pill-${row.status}`">
              {{ t(`reservationStatus.${row.status}`) }}
            </span>
            <span class="sync" :class="`sync-${row.syncState}`">
              <AppIcon
                :name="syncIcon(row.syncState)"
                :size="13"
              />
              {{ t(`syncState.${row.syncState}`) }}
            </span>
            <span v-if="row.syncError" class="sync-error">{{ row.syncError }}</span>
            <span v-if="row.rmsReservationId" class="tertiary rms-id">
              {{ t('reservations.rmsId', { id: row.rmsReservationId }) }}
            </span>
          </div>

          <div class="booking-actions">
            <button
              v-if="canEdit"
              class="btn btn-ghost btn-sm"
              :title="t('common.edit')"
              @click="edit(row)"
            >
              <AppIcon name="edit" :size="14" />
            </button>
            <button
              v-if="canEdit && row.syncState === 'failed'"
              class="btn btn-ghost btn-sm"
              :disabled="busyId === row.id"
              :title="t('reservations.retry')"
              @click="retry(row)"
            >
              <AppIcon name="history" :size="14" />
            </button>
            <button
              v-if="canEdit && (row.syncState === 'pending' || row.syncState === 'failed')"
              class="btn btn-ghost btn-sm"
              :disabled="busyId === row.id"
              :title="t('reservations.keepLocal')"
              @click="markLocal(row)"
            >
              <AppIcon name="flag" :size="14" />
            </button>
            <button
              v-if="canDelete"
              class="btn btn-ghost btn-sm danger"
              :disabled="busyId === row.id"
              :title="t('common.delete')"
              @click="pendingDelete = row"
            >
              <AppIcon name="trash" :size="14" />
            </button>
          </div>
        </li>
      </ul>
    </template>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('reservations.deleteTitle')"
      :message="t('reservations.deleteMessage', { guest: pendingDelete?.guestName ?? '' })"
      danger
      :busy="busyId !== ''"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </section>
</template>

<style scoped>
.figures {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  border-bottom: 1px solid var(--border-subtle);
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

.figure-value.brand {
  color: var(--brand-500);
}

.figure-hint {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.lead .figure-value {
  font-size: var(--text-2xl);
}

.editor {
  background: var(--bg-surface-2);
  border-bottom: 1px solid var(--border-subtle);
}

.field-grid {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.computed-line {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.editor-actions {
  justify-content: flex-end;
  gap: var(--space-2);
}

.bookings {
  list-style: none;
  margin: 0;
  padding: 0;
}

.booking {
  display: grid;
  align-items: center;
  gap: var(--space-3);
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1.2fr) auto;
  padding: var(--space-3) var(--space-4);
}

.booking + .booking {
  border-top: 1px solid var(--border-subtle);
}

.booking-main,
.booking-money,
.booking-state {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.booking-guest {
  font-weight: 600;
}

.booking-dates,
.booking-source {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.booking-value {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.booking-share {
  color: var(--brand-500);
  font-size: var(--text-xs);
}

.pill {
  align-self: flex-start;
  background: var(--bg-surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  padding: 1px 8px;
}

.pill-cancelled,
.pill-no_show {
  color: var(--text-tertiary);
}

.pill-stayed {
  border-color: var(--ok-border);
  color: var(--ok-500);
}

.sync {
  align-items: center;
  color: var(--text-tertiary);
  display: flex;
  font-size: var(--text-xs);
  gap: 4px;
}

.sync-taken {
  color: var(--ok-500);
}

.sync-failed {
  color: var(--danger-500);
}

.sync-error,
.rms-id {
  font-size: var(--text-xs);
}

.sync-error {
  color: var(--danger-500);
}

.booking-actions {
  display: flex;
  gap: 2px;
}

.booking-actions .danger:hover {
  color: var(--danger-500);
}

/* Phone: the grid becomes a stack, and nothing is cut off. */
@media (max-width: 720px) {
  .booking {
    grid-template-columns: 1fr auto;
  }

  .booking-money {
    align-items: flex-end;
  }

  .booking-state {
    grid-column: 1 / -1;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .booking-actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}
</style>
