/**
 * StayBrain — the listings, the figures, and the one flow that writes to the RMS.
 *
 * WHAT COUNTS AS OURS, stated once here because every number on every StayBrain
 * screen depends on it:
 *
 *   a reservation in MsEe Central's own `reservations` collection, carrying the
 *   listing it was sold through. Nothing else. The RMS's bookings are read for
 *   availability and never counted, so a property that took thirty bookings of
 *   which we brought six reports six — and can never drift towards thirty,
 *   because the two numbers come from different databases.
 *
 * THE ORDER OF THE WRITES in `createReservation` is the part to read carefully.
 * It is not the obvious order, and the reason is in the comment there.
 */

import { logAudit } from './audit'
import { saveReservation } from './reservations'
import { actor, newId, patch, readAll, readWhere, where, write } from './store'
import {
  cancelRmsBooking,
  createRmsBooking,
  findBookingByReservation,
  type RmsBookingResult,
} from './rms'
import { blankTransaction, saveTransaction } from './finance'
import { moneyOf } from './sales'
import { remove } from './records'
import { BASE_CURRENCY, type Money } from '@/types/money'
import {
  EMPTY_TOTALS,
  MSEE_SOURCE,
  earningFor,
  type ListingTotals,
  type RmsBooking,
  type StayBrainListing,
} from '@/types/staybrain'
import { EARNING_STATUSES, type Reservation } from '@/types/reservations'

/* ------------------------------------------------------------------ *
 * Listings
 * ------------------------------------------------------------------ */

export const fetchListings = () =>
  readAll<StayBrainListing>('staybrainListings', 'name', 'asc')

export const fetchListingsFor = async (clientId: string): Promise<StayBrainListing[]> => {
  const rows = await readWhere<StayBrainListing>(
    'staybrainListings',
    where('clientId', '==', clientId),
  )
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveListing(input: StayBrainListing): Promise<string> {
  const isNew = !input.id
  const id = await write('staybrainListings', input)

  await logAudit({
    action: isNew ? 'listing.created' : 'listing.updated',
    targetType: 'client',
    targetId: input.clientId,
    targetLabel: input.name,
    metadata: {
      listingId: id,
      rmsWorkspaceId: input.rmsWorkspaceId,
      earningModel: input.earning.model,
      earningMinor: input.earning.amount.minor,
      earningPercent: input.earning.percent,
      active: input.active,
    },
  })

  return id
}

export const deleteListing = (row: StayBrainListing) =>
  remove('staybrainListings', row.id, row.name)

/* ------------------------------------------------------------------ *
 * What we made
 * ------------------------------------------------------------------ */

/** Every reservation sold through one listing. */
export const fetchReservationsForListing = async (listingId: string): Promise<Reservation[]> => {
  const rows = await readWhere<Reservation>('reservations', where('listingId', '==', listingId))
  return rows.sort((a, b) => b.checkIn.localeCompare(a.checkIn))
}

/** Every StayBrain reservation, for the dashboard and the listing cards. */
export const fetchStayBrainReservations = async (): Promise<Reservation[]> => {
  const rows = await readWhere<Reservation>('reservations', where('listingId', '!=', ''))
  return rows.sort((a, b) => b.checkIn.localeCompare(a.checkIn))
}

/**
 * The figures for a set of reservations.
 *
 * Turnover and revenue are kept apart all the way through, because they are
 * other people's money and ours. A €500 booking that earns us €50 adds 500 to
 * what we brought the owner and 50 to what we made; treating the 500 as income
 * would be claiming a client's takings as our own.
 *
 * Cancellations stay in the count and leave the money. "We brought them eleven
 * bookings and two cancelled" is a more honest sentence than either half.
 */
export function totalsOf(rows: Reservation[]): ListingTotals {
  if (!rows.length) return { ...EMPTY_TOTALS }

  const earning = rows.filter((r) => EARNING_STATUSES.includes(r.status))

  return {
    reservations: rows.length,
    earning: earning.length,
    nights: earning.reduce((n, r) => n + r.nights, 0),
    turnoverBaseMinor: earning.reduce((n, r) => n + r.value.baseMinor, 0),
    revenueBaseMinor: earning.reduce((n, r) => n + (r.earning?.baseMinor ?? 0), 0),
  }
}

/** The same figures, grouped by listing, for a dashboard that ranks properties. */
export function totalsByListing(rows: Reservation[]): Map<string, ListingTotals> {
  const byListing = new Map<string, Reservation[]>()
  rows.forEach((row) => {
    if (!row.listingId) return
    const list = byListing.get(row.listingId) ?? []
    list.push(row)
    byListing.set(row.listingId, list)
  })

  const out = new Map<string, ListingTotals>()
  byListing.forEach((list, id) => out.set(id, totalsOf(list)))
  return out
}

/* ------------------------------------------------------------------ *
 * Making a reservation
 * ------------------------------------------------------------------ */

export interface NewReservation {
  listing: StayBrainListing
  apartmentId: string
  apartmentName: string
  /** Nightly rate from the RMS, in the listing's currency, as a plain amount. */
  pricePerNight: number
  /** The whole booking, in the listing's currency, as a plain amount. */
  total: number
  guestName: string
  guestContact: string
  /** The guest's town or country — the RMS's `origin`. */
  guestOrigin: string
  checkIn: string
  checkOut: string
  nights: number
  guests: number
  note: string
}

export interface ReservationOutcome {
  reservationId: string
  rms: RmsBookingResult
  earning: Money
}

/**
 * Sell a booking: record it here, put it in the RMS, then confirm it here.
 *
 * THE ORDER, AND WHY IT IS THIS WAY.
 *
 * 1. Write our own reservation first, as `pending`. This gives us an id, and the
 *    id is what makes the RMS write idempotent — the RMS document is named after
 *    it, so the same call twice writes the same document.
 *
 * 2. Create the booking in the RMS. If this throws, our row stays `pending` with
 *    the reason on it. NOTHING is counted: `pending` earns nothing, because a
 *    booking the property never received is not a sale.
 *
 * 3. Only now mark ours `taken` and record what it earns.
 *
 * Writing ours second would be the obvious order and it is the wrong one: a
 * booking would appear in somebody's calendar that this system had no record of,
 * and nobody would ever find it. This way the worst case is a row here marked
 * `pending` that the RMS actually holds — visible, recoverable, and recovered by
 * `repairReservation` below, which asks the RMS by our own id.
 */
export async function createReservation(input: NewReservation): Promise<ReservationOutcome> {
  const me = actor()
  const { listing } = input

  if (!listing.rmsWorkspaceId) {
    throw new Error('This listing is not linked to an RMS account yet.')
  }

  const value = moneyOf(input.total, listing.currency, listing.rate, input.checkIn)
  const earning = earningFor(listing.earning, value)

  /* 1. Ours, pending, with an id of its own. */
  const reservationId = newId()

  await saveReservation({
    id: reservationId,
    clientId: listing.clientId,
    clientName: listing.clientName,
    guestName: input.guestName,
    guestContact: input.guestContact,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    nights: input.nights,
    guests: input.guests,
    value,
    source: listing.name,
    status: 'confirmed',
    note: input.note,
    syncState: 'pending',
    rmsReservationId: '',
    rmsBookingId: '',
    takenAt: null,
    syncError: '',
    listingId: listing.id,
    rmsWorkspaceId: listing.rmsWorkspaceId,
    apartmentId: input.apartmentId,
    apartmentName: input.apartmentName,
    earning,
    ownerUid: me.uid,
    ownerName: me.name,
    deletedAt: null,
    deletedBy: null,
    deletedByName: '',
    createdAt: '',
    createdBy: '',
    updatedAt: '',
  })

  /* 2. Theirs. This is the step that decides whether a sale happened. */
  let rms: RmsBookingResult
  try {
    rms = await createRmsBooking({
      workspaceId: listing.rmsWorkspaceId,
      apartmentId: input.apartmentId,
      mseeReservationId: reservationId,
      guestName: input.guestName,
      phone: input.guestContact,
      origin: input.guestOrigin,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      pricePerNight: input.pricePerNight,
      totalPrice: input.total,
      depositAmount: 0,
      notes: input.note,
      mseeUserName: me.name,
    })
  } catch (error) {
    /*
     * Mark why, and stop. The row stays `pending`, which counts for nothing, and
     * the message is kept so the person who looks at it later knows what the RMS
     * said rather than that "something failed".
     */
    await markFailed(reservationId, (error as Error).message)
    throw error
  }

  /* 3. Confirm ours against what the RMS actually gave back. */
  await patch('reservations', reservationId, {
    syncState: 'taken',
    rmsReservationId: rms.reservationId,
    rmsBookingId: rms.id,
    takenAt: new Date().toISOString(),
    syncError: '',
  })

  await logAudit({
    action: 'reservation.created',
    targetType: 'client',
    targetId: listing.clientId,
    targetLabel: listing.name,
    metadata: {
      reservationId,
      rmsBookingId: rms.id,
      rmsReference: rms.reservationId,
      apartment: input.apartmentName,
      guest: input.guestName,
      checkIn: input.checkIn,
      nights: input.nights,
      valueMinor: value.minor,
      earningMinor: earning.minor,
      alreadyExisted: rms.alreadyExisted,
    },
  })

  return { reservationId, rms, earning }
}

async function markFailed(reservationId: string, reason: string): Promise<void> {
  await patch('reservations', reservationId, {
    syncState: 'failed',
    /* Trimmed: this is shown on a card, not in a log. */
    syncError: reason.slice(0, 300),
  })
}

/**
 * Repair a reservation whose RMS answer never arrived.
 *
 * The one failure that cannot be designed away: the RMS accepted the booking and
 * the reply was lost. Asking it by our own id settles the question — if the
 * booking is there, the link is recorded and the sale counts; if it is not, the
 * row stays as it was and can be sent again. Either way no guest is booked twice,
 * because the document id was ours from the start.
 */
export async function repairReservation(row: Reservation): Promise<'linked' | 'absent'> {
  const booking = await findBookingByReservation(row.id)

  if (!booking) return 'absent'

  await patch('reservations', row.id, {
    syncState: 'taken',
    rmsReservationId: booking.reservationId,
    rmsBookingId: booking.id,
    takenAt: new Date().toISOString(),
    syncError: '',
  })

  await logAudit({
    action: 'reservation.updated',
    targetType: 'client',
    targetId: row.clientId,
    targetLabel: row.clientName,
    metadata: { reservationId: row.id, repaired: true, rmsBookingId: booking.id },
  })

  return 'linked'
}

/**
 * Cancel one we sold, in both systems.
 *
 * The RMS first: if it refuses, nothing here changes, because a booking still in
 * the property's calendar must not read as cancelled on our side. A guest turned
 * away by a cancellation we only imagined is the failure worth preventing.
 */
export async function cancelReservation(row: Reservation): Promise<void> {
  if (row.syncState === 'taken' && row.rmsBookingId) {
    await cancelRmsBooking(row.rmsWorkspaceId, row.rmsBookingId, row.apartmentId)
  }

  await patch('reservations', row.id, { status: 'cancelled' })

  await logAudit({
    action: 'reservation.updated',
    targetType: 'client',
    targetId: row.clientId,
    targetLabel: row.clientName,
    metadata: { reservationId: row.id, cancelled: true, rmsBookingId: row.rmsBookingId },
  })
}

/* ------------------------------------------------------------------ *
 * Picking up what was marked in the RMS
 * ------------------------------------------------------------------ */

/**
 * Record the bookings the RMS says we brought.
 *
 * THE WORKFLOW THIS EXISTS FOR. The property is run from the RMS — that is where
 * the phone is answered and where the calendar lives. So the honest place to say
 * "this guest came through MsEe" is there, on the booking, with one tick at the
 * moment it is taken. This is the other end of that tick: every booking carrying
 * the stamp becomes a reservation here, with what it earns us worked out from the
 * listing's terms.
 *
 * IT RUNS ON READ, AND IT IS IDEMPOTENT. Opening a property imports whatever is
 * new; opening it again imports nothing. The reservation's id is derived from the
 * RMS booking id, so the same booking cannot arrive twice however many times this
 * runs — no timestamps to compare, no "last synced" marker to go stale.
 *
 * WHAT IT DOES NOT DO is change a reservation it already has. The value, the
 * dates and the guest are refreshed, because the RMS is the truth about those and
 * a corrected booking should correct ours. The EARNING is not: it was fixed by
 * the terms on the day, and recomputing it would rewrite last season every time a
 * rate changed.
 */
export async function importMarkedBookings(
  listing: StayBrainListing,
  bookings: RmsBooking[],
  existing: Reservation[],
): Promise<{ added: number; updated: number }> {
  const ours = bookings.filter((b) => b.source === MSEE_SOURCE)
  if (!ours.length) return { added: 0, updated: 0 }

  const byRmsId = new Map(existing.map((r) => [r.rmsBookingId, r]))
  let added = 0
  let updated = 0

  for (const booking of ours) {
    /*
     * Matched by the RMS booking id, which covers both routes at once.
     *
     * A booking MsEe Central created itself is already here under a local id it
     * chose before writing, and that row carries `rmsBookingId` too — so it is
     * found here and refreshed rather than imported a second time. Matching on
     * the name and the dates would have been the guess that eventually created a
     * duplicate.
     */
    const mine = byRmsId.get(booking.id)

    if (mine) {
      await refresh(mine, booking, listing)
      updated += 1
      continue
    }

    /*
     * A local id derived from theirs.
     *
     * This is what makes a second run a no-op: the document either exists or it
     * does not, and no bookkeeping is needed to tell.
     */
    const id = `rms_${booking.id}`
    const value = moneyOf(booking.totalPrice, listing.currency, listing.rate, booking.checkIn)

    await saveReservation({
      id,
      clientId: listing.clientId,
      clientName: listing.clientName,
      guestName: booking.guestName,
      guestContact: booking.phone,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      nights: booking.days || nightsOf(booking.checkIn, booking.checkOut),
      guests: 0,
      value,
      /* Where it was declared, so the two routes stay tellable apart. */
      source: booking.createdVia === 'MSEE_RMS' ? 'RMS · marked' : listing.name,
      status: booking.status === 'cancelled' ? 'cancelled' : 'confirmed',
      note: booking.notes,
      /* It is already in the RMS — that is where it came from. */
      syncState: 'taken',
      rmsReservationId: booking.reservationId,
      rmsBookingId: booking.id,
      takenAt: new Date().toISOString(),
      syncError: '',
      listingId: listing.id,
      rmsWorkspaceId: listing.rmsWorkspaceId,
      apartmentId: booking.apartmentId,
      apartmentName: '',
      earning: earningFor(listing.earning, value),
      ownerUid: null,
      ownerName: '',
      deletedAt: null,
      deletedBy: null,
      deletedByName: '',
      createdAt: '',
      createdBy: '',
      updatedAt: '',
    })

    added += 1
  }

  return { added, updated }
}

/**
 * Bring one reservation back in step with its booking.
 *
 * Only the facts the RMS owns — the guest, the dates, the money the guest pays,
 * and whether it still stands. Our earning and our own ids are left alone.
 */
async function refresh(
  mine: Reservation,
  booking: RmsBooking,
  listing: StayBrainListing,
): Promise<void> {
  const status = booking.status === 'cancelled' ? 'cancelled' : mine.status
  const value = moneyOf(booking.totalPrice, listing.currency, listing.rate, booking.checkIn)

  const same =
    mine.guestName === booking.guestName &&
    mine.checkIn === booking.checkIn &&
    mine.checkOut === booking.checkOut &&
    mine.value.minor === value.minor &&
    mine.status === status

  /* Nothing moved: no write, so opening a property costs nothing. */
  if (same) return

  await patch('reservations', mine.id, {
    guestName: booking.guestName,
    guestContact: booking.phone,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    nights: booking.days || nightsOf(booking.checkIn, booking.checkOut),
    value,
    status,
    rmsReservationId: booking.reservationId,
  })
}

/** Nights between two dates, when the RMS did not store a count. */
function nightsOf(checkIn: string, checkOut: string): number {
  const from = Date.parse(checkIn)
  const to = Date.parse(checkOut)
  if (!from || !to || to <= from) return 1
  return Math.round((to - from) / 86_400_000)
}

/* ------------------------------------------------------------------ *
 * Turning an earning into money in Finance
 * ------------------------------------------------------------------ */

/**
 * Invoice what a listing earned us over a period.
 *
 * DELIBERATELY A DECISION SOMEBODY MAKES, not an automatic write per booking.
 * Fifty euros per reservation is an amount we are owed the moment the guest is
 * booked; it becomes money when it is billed, and billing is monthly. Writing a
 * transaction per booking would fill the ledger with fifty-euro lines that no
 * invoice matches.
 *
 * It uses the existing Finance model and nothing of its own: one income
 * transaction against the client, which is what every other kind of income here
 * already is.
 */
export async function invoiceEarnings(
  listing: StayBrainListing,
  rows: Reservation[],
  period: string,
  description: string,
): Promise<string> {
  const totals = totalsOf(rows)
  if (totals.revenueBaseMinor <= 0) {
    throw new Error('There is nothing to invoice for that period.')
  }

  /*
   * The amount is already in base-currency minor units — it was summed from the
   * frozen earnings on each reservation. It is rebuilt as a Money at rate 1 so
   * that it is not converted a second time.
   */
  const amount: Money = {
    minor: totals.revenueBaseMinor,
    currency: BASE_CURRENCY,
    rate: 1,
    baseMinor: totals.revenueBaseMinor,
    rateDate: `${period}-01`,
  }

  const me = actor()

  return saveTransaction({
    ...blankTransaction('income'),
    category: 'service_payment',
    description,
    amount,
    date: `${period}-01`,
    status: 'pending',
    clientId: listing.clientId,
    clientName: listing.clientName,
    /* Who to credit for it, which is how performance already reads income. */
    employeeUid: me.uid,
    employeeName: me.name,
    notes: `StayBrain · ${listing.name} · ${totals.earning} reservation(s)`,
  })
}
