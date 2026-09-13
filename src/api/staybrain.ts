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
 * NOTHING HERE WRITES TO THE RMS. Bookings are taken there and marked there;
 * this side reads them, records what it brought, and works out what it earned.
 */

import { logAudit } from './audit'
import { saveReservation } from './reservations'
import { actor, patch, readAll, readWhere, today, where, write } from './store'
import { blankTransaction, saveTransaction } from './finance'
import { fetchServices } from './operations'
import { blankSale, saveSale } from './sales'
import { moneyOf } from './sales'
import { remove } from './records'
import { BASE_CURRENCY, type Money } from '@/types/money'
import {
  EMPTY_TOTALS,
  MSEE_SOURCE,
  earningOf,
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

  /* The fee is revenue for the service, so it is recorded as a sale. */
  await recordFeeSale(input, id)

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
  const service = await stayBrainService()
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
    /* What was agreed on the booking, or the listing's standing terms. */
    const earning = earningOf(listing.earning, value, booking.mseeCommissionAmount)

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
      /* What was agreed on the booking, or the listing's standing terms. */
      earning,
      ownerUid: null,
      /* Who brought it, as named in the reservation system. A name and not an
       * account: the other system has no idea who our people are. */
      ownerName: booking.mseeBroughtBy ?? '',
      deletedAt: null,
      deletedBy: null,
      deletedByName: '',
      createdAt: '',
      createdBy: '',
      updatedAt: '',
    })

    /*
     * And as a sale — unless it arrives already cancelled, which happens when a
     * booking is marked as ours and called off before anybody opened this screen.
     * A cancelled booking was never a sale.
     */
    if (booking.status !== 'cancelled') {
      await recordSale(listing, id, booking.guestName, booking.checkIn, earning, service)
    }

    added += 1
  }

  return { added, updated }
}

/**
 * The StayBrain service, found once per import.
 *
 * By name, the same way the services screen decides which card opens a property.
 * `null` when there is no such service, and then no sale is written — inventing
 * a service to hang revenue on would put a row in the company's sales that
 * matches nothing anybody sold.
 */
async function stayBrainService(): Promise<{ id: string; name: string } | null> {
  const services = await fetchServices().catch(() => [])
  const match = services.find(
    (row) => row.name.toLowerCase().replace(/[^a-z]/g, '') === 'staybrain',
  )
  return match ? { id: match.id, name: match.name } : null
}

/**
 * Record a commission as what it is: a sale.
 *
 * WHY A SALE AND NOT A FIGURE OF ITS OWN. Bringing a booking and earning a
 * commission on it is selling — the same act as any other sale this company
 * makes, with a client, a service and a value. Writing it into `sales` means the
 * dashboard, the service's own performance, the client's totals and every report
 * that already reads sales pick it up without knowing StayBrain exists. The
 * alternative was a parallel set of figures that would agree with the first only
 * as long as somebody kept them agreeing.
 *
 * THE VALUE IS OUR COMMISSION, NOT THE GUEST'S BILL. A €500 booking that earns us
 * €50 is a €50 sale. The €500 is the property owner's money; counting it as
 * revenue would multiply this company's income by the size of other people's
 * businesses.
 *
 * The id is derived from the reservation, so re-importing rewrites the same sale
 * instead of adding another.
 */
async function recordSale(
  listing: StayBrainListing,
  reservationId: string,
  guestName: string,
  date: string,
  earning: Money,
  service: { id: string; name: string } | null,
): Promise<void> {
  /* Nothing earned, nothing sold. A booking nobody priced is not a sale. */
  if (earning.minor <= 0) return

  await saveSale({
    ...blankSale(null, ''),
    id: `sb_${reservationId}`,
    title: `${listing.name} · ${guestName}`,
    clientId: listing.clientId,
    clientName: listing.clientName,
    serviceId: service?.id ?? null,
    serviceName: service?.name ?? 'StayBrain',
    value: earning,
    saleDate: date,
    notes: 'StayBrain',
  })
}

/**
 * The joining fee, recorded as the sale of the service itself.
 *
 * Selling StayBrain to a client is a sale like any other: a client, a service, a
 * value. In `sales` it reaches the dashboard and the service's own card with no
 * second set of figures to keep in step.
 *
 * One per listing, by a derived id, so correcting the fee corrects that sale
 * rather than adding another. A fee of zero writes nothing — that means the
 * amount has not been agreed yet, not that the client paid nothing.
 */
async function recordFeeSale(listing: StayBrainListing, id: string): Promise<void> {
  if ((listing.joinFee?.minor ?? 0) <= 0) return

  const service = await stayBrainService()
  const me = actor()

  await saveSale({
    ...blankSale(me.uid, me.name),
    id: `sb_fee_${id}`,
    title: `StayBrain · ${listing.name}`,
    clientId: listing.clientId,
    clientName: listing.clientName,
    serviceId: service?.id ?? null,
    serviceName: service?.name ?? 'StayBrain',
    value: listing.joinFee,
    saleDate: listing.createdAt ? listing.createdAt.slice(0, 10) : today(),
    notes: listing.joinFeeNote || 'StayBrain',
  })
}

/**
 * Bring one reservation back in step with its booking.
 *
 * Only the facts the RMS owns — the guest, the dates, the money the guest pays,
 * and whether it still stands. Our earning and our own ids are left alone.
 */
/**
 * A cancelled booking stops being a sale.
 *
 * The sale was written when the booking counted; when it stops counting the sale
 * has to go with it, or the service keeps reporting a sale that did not happen.
 * Moved to the recycle bin rather than destroyed — it did exist, and the record
 * of a booking that was made and then called off is worth keeping.
 */
async function dropSale(reservationId: string): Promise<void> {
  await patch('sales', `sb_${reservationId}`, {
    deletedAt: new Date().toISOString(),
    deletedBy: actor().uid,
    deletedByName: actor().name,
  }).catch(() => {
    /* No sale to drop — a booking that never earned anything never had one. */
  })
}

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

  /*
   * Cancelled here means cancelled everywhere it was counted.
   *
   * And the reverse: a booking that was cancelled and then reinstated in the
   * reservation system becomes a sale again, because it is one again.
   */
  if (status === 'cancelled' && mine.status !== 'cancelled') {
    await dropSale(mine.id)
  } else if (status !== 'cancelled' && mine.status === 'cancelled') {
    await recordSale(listing, mine.id, booking.guestName, booking.checkIn, mine.earning, await stayBrainService())
  }

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
