<script setup lang="ts">
/**
 * The property's calendar, as the RMS has it.
 *
 * A UNIT PER ROW, A NIGHT PER COLUMN, and every booking drawn whoever brought it.
 * It has to be every booking: this is what somebody looks at before promising a
 * guest a room, and a calendar showing only our own would show a free week that
 * the owner filled yesterday.
 *
 * TWO COLOURS, AND THEY MEAN ONE THING. Orange is ours, blue is the property's
 * own. That is the only distinction drawn here, because it is the only one this
 * screen is for: what is free, and of what is taken, how much of it we brought.
 *
 * The colours are deliberately NOT the per-apartment colours the RMS stores. A
 * colour already used to tell apartments apart cannot also tell provenance
 * apart — and provenance is the question MsEe Central exists to answer.
 *
 * WHY A GRID AND NOT A MONTH VIEW. A stay is a range, and ranges read as bars.
 * A month grid would have to break every booking into squares and a four-night
 * stay would stop looking like one booking.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import { formatDate } from '@/i18n'
import { formatMoney } from '@/types/money'
import { isOurs, nightsBetween, type RmsApartment, type RmsBooking } from '@/types/staybrain'
import type { CurrencyCode } from '@/types/money'

const props = defineProps<{
  apartments: RmsApartment[]
  bookings: RmsBooking[]
  /** The currency the property prices in, for the amounts in the tooltips. */
  currency: CurrencyCode
  /** Highlighted, so the dates being considered are visible in context. */
  fromDate?: string
  toDate?: string
}>()

const { t, locale } = useI18n()

/** How many nights the grid shows at once. A month reads well on a laptop. */
const SPAN = 31

const offset = ref(0)

const start = computed(() => {
  const base = props.fromDate ? Date.parse(props.fromDate) : Date.now()
  /* Snapped to the day, so a time component cannot shift every column by hours. */
  const day = new Date(base)
  day.setHours(12, 0, 0, 0)
  return day.getTime() + offset.value * SPAN * 86_400_000
})

interface Night {
  date: string
  /** Day of month, the only part there is room to print. */
  day: number
  weekend: boolean
  today: boolean
  inRange: boolean
}

const nights = computed<Night[]>(() => {
  const today = new Date().toISOString().slice(0, 10)
  const from = props.fromDate ?? ''
  const to = props.toDate ?? ''

  return Array.from({ length: SPAN }, (_, i) => {
    const at = new Date(start.value + i * 86_400_000)
    const date = at.toISOString().slice(0, 10)
    const weekday = at.getDay()

    return {
      date,
      day: at.getDate(),
      weekend: weekday === 0 || weekday === 6,
      today: date === today,
      inRange: Boolean(from && to && date >= from && date < to),
    }
  })
})

/** The month or months on screen, for the header. */
const spanLabel = computed(() => {
  const first = nights.value[0]
  const last = nights.value[nights.value.length - 1]
  if (!first || !last) return ''
  return `${formatDate(first.date)} – ${formatDate(last.date)}`
})

interface Bar {
  booking: RmsBooking
  /** 1-based column the bar starts in. */
  from: number
  /** How many columns it covers, clipped to the window. */
  span: number
  ours: boolean
  /** True when the stay began before this window, so the bar is cut off. */
  clippedStart: boolean
  clippedEnd: boolean
}

/**
 * The bars for one unit.
 *
 * Clipping is done here rather than by overflow, because a bar that starts
 * before the window still has to begin at column 1 — and it says so, so nobody
 * reads a cut-off bar as a short stay.
 */
function barsFor(apartmentId: string): Bar[] {
  const window = nights.value
  const firstNight = window[0]
  const lastIn = window[window.length - 1]
  if (!firstNight || !lastIn) return []

  const first = firstNight.date
  const lastNight = lastIn.date

  return props.bookings
    .filter((b) => b.apartmentId === apartmentId && b.status !== 'cancelled')
    .filter((b) => b.checkIn <= lastNight && b.checkOut > first)
    .map((booking) => {
      const stay = nightsBetween(booking.checkIn, booking.checkOut)
      const visible = stay.filter((night) => night >= first && night <= lastNight)
      if (!visible.length) return null

      const from = window.findIndex((n) => n.date === visible[0]) + 1

      return {
        booking,
        from,
        span: visible.length,
        ours: isOurs(booking),
        clippedStart: booking.checkIn < first,
        clippedEnd: booking.checkOut > lastNight,
      }
    })
    .filter((bar): bar is Bar => bar !== null)
    .sort((a, b) => a.from - b.from)
}

const money = (amount: number) =>
  formatMoney(Math.round(amount * 100), props.currency, locale.value)

/** Everything a bar can say in a tooltip, since it cannot all fit on screen. */
function describe(bar: Bar): string {
  const who = bar.ours ? t('stayCalendar.oursLabel') : t('stayCalendar.theirsLabel')
  return [
    bar.booking.guestName || t('staybrain.anotherGuest'),
    `${formatDate(bar.booking.checkIn)} – ${formatDate(bar.booking.checkOut)}`,
    money(bar.booking.totalPrice),
    bar.booking.reservationId,
    who,
  ]
    .filter(Boolean)
    .join(' · ')
}

const oursCount = computed(() => props.bookings.filter((b) => isOurs(b) && b.status !== 'cancelled').length)
const theirsCount = computed(
  () => props.bookings.filter((b) => !isOurs(b) && b.status !== 'cancelled').length,
)
</script>

<template>
  <section class="card">
    <div class="card-header">
      <div>
        <h2 class="card-title">{{ t('stayCalendar.title') }}</h2>
        <p class="field-hint">{{ spanLabel }}</p>
      </div>

      <div class="controls">
        <span class="legend">
          <span class="dot ours" />{{ t('stayCalendar.ours', { n: oursCount }) }}
        </span>
        <span class="legend">
          <span class="dot theirs" />{{ t('stayCalendar.theirs', { n: theirsCount }) }}
        </span>
        <button class="btn btn-ghost btn-sm" :title="t('stayCalendar.earlier')" @click="offset -= 1">
          <AppIcon name="chevronRight" :size="14" class="flip" />
        </button>
        <button v-if="offset !== 0" class="btn btn-ghost btn-sm" @click="offset = 0">
          {{ t('stayCalendar.now') }}
        </button>
        <button class="btn btn-ghost btn-sm" :title="t('stayCalendar.later')" @click="offset += 1">
          <AppIcon name="chevronRight" :size="14" />
        </button>
      </div>
    </div>

    <div v-if="!apartments.length" class="empty">
      <p class="empty-title">{{ t('staybrain.noUnits') }}</p>
    </div>

    <!-- The grid scrolls inside itself; the page never scrolls sideways. -->
    <div v-else class="scroller">
      <div class="grid" :style="{ '--nights': nights.length }">
        <!-- Header row -->
        <div class="corner" :style="{ gridRow: 1, gridColumn: 1 }">
          {{ t('stayCalendar.unit') }}
        </div>
        <div
          v-for="(night, n) in nights"
          :key="night.date"
          class="head"
          :class="{ weekend: night.weekend, today: night.today, ranged: night.inRange }"
          :style="{ gridRow: 1, gridColumn: n + 2 }"
        >
          {{ night.day }}
        </div>

        <!--
          One row per unit, and EVERY cell says which row it is in.

          Without an explicit `grid-row` the bars would be auto-placed: the cells
          fill the unit's row, the grid is then full, and each bar drops onto a
          new row below instead of lying over the nights it covers. Naming the row
          is what puts a booking on top of its own dates.

          Row 1 is the header, so unit `i` is row `i + 2`.
        -->
        <template v-for="(apartment, i) in apartments" :key="apartment.id">
          <div class="unit" :style="{ gridRow: i + 2 }" :title="apartment.name">
            <span class="unit-name">{{ apartment.name }}</span>
            <span class="unit-size">{{ t('staybrain.sleeps', { n: apartment.maxGuests }) }}</span>
          </div>

          <!--
            The empty nights come first and the bars lie over them. Not clickable:
            bookings are taken in the RMS, and a cell that looked like a button
            here would be a promise this screen cannot keep.
          -->
          <div
            v-for="(night, n) in nights"
            :key="`${apartment.id}-${night.date}`"
            class="cell"
            :class="{ weekend: night.weekend, today: night.today, ranged: night.inRange }"
            :style="{ gridRow: i + 2, gridColumn: n + 2 }"
            :title="`${apartment.name} · ${formatDate(night.date)}`"
          />

          <div
            v-for="bar in barsFor(apartment.id)"
            :key="bar.booking.id"
            class="bar"
            :class="{
              ours: bar.ours,
              theirs: !bar.ours,
              'cut-start': bar.clippedStart,
              'cut-end': bar.clippedEnd,
            }"
            :style="{ gridRow: i + 2, gridColumn: `${bar.from + 1} / span ${bar.span}` }"
            :title="describe(bar)"
          >
            <span class="bar-text">{{ bar.booking.guestName || t('staybrain.anotherGuest') }}</span>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.controls {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.legend {
  align-items: center;
  color: var(--text-tertiary);
  display: flex;
  font-size: var(--text-xs);
  gap: 4px;
}

.dot {
  border-radius: 50%;
  height: 9px;
  width: 9px;
}

.dot.ours {
  background: var(--brand-500);
}

.dot.theirs {
  background: var(--unit-theirs);
}

.flip {
  transform: rotate(180deg);
}

.scroller {
  overflow-x: auto;
  padding: 0 var(--space-4) var(--space-4);
}

/*
 * One column for the unit name, then one per night. Every child names its own
 * row and column — see the note in the template for why that is not optional.
 */
.grid {
  display: grid;
  grid-auto-rows: minmax(30px, auto);
  grid-template-columns: 130px repeat(var(--nights), minmax(26px, 1fr));
  min-width: 760px;
}

.corner,
.head {
  background: var(--bg-surface);
  font-size: var(--text-xs);
  padding: 4px 2px;
  position: sticky;
  text-align: center;
  top: 0;
  z-index: 2;
}

.corner {
  color: var(--text-tertiary);
  left: 0;
  text-align: left;
  z-index: 3;
}

.head {
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

.head.weekend {
  color: var(--text-secondary);
}

.head.today {
  background: var(--brand-50);
  border-radius: var(--radius-sm);
  color: var(--brand-700);
  font-weight: 600;
}

.unit {
  align-items: flex-start;
  background: var(--bg-surface);
  display: flex;
  flex-direction: column;
  justify-content: center;
  left: 0;
  overflow: hidden;
  padding-right: var(--space-2);
  position: sticky;
  z-index: 1;
}

.unit-name {
  font-size: var(--text-sm);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.unit-size {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.cell {
  border-left: 1px solid var(--border-subtle);
  border-top: 1px solid var(--border-subtle);
}

.cell.weekend {
  background: var(--bg-surface-2);
}

.cell.ranged {
  background: var(--brand-50);
}

.cell.today {
  border-left-color: var(--brand-300);
}

/*
 * The bars.
 *
 * `pointer-events: none` on the label only — the bar itself stays hoverable for
 * its tooltip, while clicks fall through to nothing rather than to the cell
 * underneath, because clicking a taken night should do nothing at all.
 */
.bar {
  align-items: center;
  border-radius: var(--radius-full);
  display: flex;
  font-size: var(--text-xs);
  margin: 3px 1px;
  overflow: hidden;
  padding: 0 7px;
  white-space: nowrap;
}

.bar.ours {
  background: var(--brand-500);
  color: #fff;
}

.bar.theirs {
  background: var(--unit-theirs);
  color: #fff;
}

.bar.cut-start {
  border-bottom-left-radius: 2px;
  border-top-left-radius: 2px;
}

.bar.cut-end {
  border-bottom-right-radius: 2px;
  border-top-right-radius: 2px;
}

.bar-text {
  overflow: hidden;
  pointer-events: none;
  text-overflow: ellipsis;
}
</style>
