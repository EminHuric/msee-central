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
import { tellOwners } from './owners'
import { saveReservation } from './reservations'
import { actor, patch, readAll, readOne, readWhere, today, where, write } from './store'
import { blankTransaction, saveTransaction } from './finance'
import { fetchServices } from './operations'
import { blankSale, saveSale } from './sales'
import { moneyOf } from './sales'
import { remove } from './records'
import { BASE_CURRENCY, formatMoney, type Money } from '@/types/money'
import {
  EMPTY_TOTALS,
  MSEE_SOURCE,
  earningOf,
  type ListingTotals,
  type RmsBooking,
  type StayBrainListing,
} from '@/types/staybrain'
import { EARNING_STATUSES, type Reservation } from '@/types/reservations'
import type { Sale, Transaction } from '@/types/revenue'

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
    /*
     * The ones that count, and only those.
     *
     * This used to be every row, cancellations included, on the reasoning that
     * "eleven brought, two cancelled" is a fuller sentence. It reads as a wrong
     * number: cancel a booking and the card still says seven. The headline is
     * what stands; the cancelled ones are counted separately for anybody who
     * wants them.
     */
    reservations: earning.length,
    cancelled: rows.filter((r) => r.status === 'cancelled').length,
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

/**
 * What has been invoiced to a client for StayBrain, and what they have paid.
 *
 * Two different facts and never one. A sale is revenue the moment it is agreed —
 * that is what the dashboard counts as sold — and it becomes money when it
 * arrives. Showing only one of them would either flatter the company or hide what
 * it has earned.
 *
 * Found by the service stamped on the invoice, so it survives the description
 * being edited. A client with two StayBrain properties would see both here; that
 * is a real limit and not worth a second identifier until it happens.
 */
export async function invoicedFor(
  clientId: string,
  serviceId: string | null,
): Promise<{ invoicedBaseMinor: number; paidBaseMinor: number }> {
  const rows = await readWhere<Transaction>('transactions', where('clientId', '==', clientId))
  const mine = rows.filter(
    (row) => row.type === 'income' && (!serviceId || row.serviceId === serviceId),
  )

  return {
    invoicedBaseMinor: mine.reduce((n, row) => n + row.amount.baseMinor, 0),
    paidBaseMinor: mine
      .filter((row) => row.status === 'paid')
      .reduce((n, row) => n + row.amount.baseMinor, 0),
  }
}

/**
 * Record what a property owner has actually paid us.
 *
 * PART OR ALL, AND AS MANY TIMES AS IT TAKES. An owner settles a season in one
 * transfer or in four, and both are normal. So this is a payment and not a
 * settlement: each one is its own record, what remains is what the commissions
 * come to minus what has arrived, and nothing here has to be reconciled by hand.
 *
 * It writes into the ordinary Finance model as income against the client, marked
 * paid because the money is in — the same row any other payment produces, so it
 * lands in the same totals and the same reports with nothing special about it.
 */
export async function recordOwnerPayment(
  listing: StayBrainListing,
  amountBaseMinor: number,
  date: string,
  note: string,
): Promise<string> {
  if (amountBaseMinor <= 0) throw new Error('An amount is needed.')

  const service = await stayBrainService()
  const me = actor()

  return saveTransaction({
    ...blankTransaction('income'),
    category: 'service_payment',
    description: note || `StayBrain · ${listing.name}`,
    amount: {
      minor: amountBaseMinor,
      currency: BASE_CURRENCY,
      rate: 1,
      baseMinor: amountBaseMinor,
      rateDate: date,
    },
    date,
    status: 'paid',
    clientId: listing.clientId,
    clientName: listing.clientName,
    serviceId: service?.id ?? null,
    serviceName: service?.name ?? 'StayBrain',
    employeeUid: me.uid,
    employeeName: me.name,
  })
}

/** The StayBrain service, for callers that need its id. */
export const stayBrainServiceId = async (): Promise<string | null> =>
  (await stayBrainService())?.id ?? null

/**
 * Pick up bookings from every linked property, without anybody asking.
 *
 * WHY THIS EXISTS. Importing only when a property is opened means a week of not
 * opening it is a week of not knowing what was earned — the money was made and
 * the system stayed quiet. Selling is not an excuse to go and check a screen.
 *
 * IT IS DELIBERATELY QUIET AND DELIBERATELY CHEAP.
 *
 *   It does nothing at all unless the browser already holds a password for the
 *   property, or a session is already open. It never asks for a login: a
 *   background task must not interrupt somebody to demand credentials.
 *
 *   It writes nothing when nothing changed, because the import compares before
 *   it writes. The usual run costs a read and no writes.
 *
 *   Every failure is swallowed. A property whose password has changed, or a
 *   reservation system that is down, must not stop a dashboard from drawing.
 *
 * Returns how many arrived, so a screen can say so once rather than per property.
 */
export async function syncAllListings(): Promise<number> {
  const { rmsConnectAs } = await import('@/lib/rms')
  const { fetchBookings } = await import('./rms')

  let added = 0

  try {
    const listings = (await fetchListings()).filter(
      (row) => row.active && row.rmsWorkspaceId && row.rmsAccountEmail,
    )

    for (const listing of listings) {
      try {
        const result = await rmsConnectAs(listing.rmsAccountEmail)
        /* No remembered password: leave it for when somebody opens the property. */
        if (result.state !== 'ready') continue

        const bookings = await fetchBookings(listing.rmsWorkspaceId)
        const mine = await fetchReservationsForListing(listing.id)
        const picked = await importMarkedBookings(listing, bookings, mine)
        added += picked.added
      } catch {
        /* One property being unreachable says nothing about the next. */
      }
    }
  } catch {
    /* No listings, or no access to them. Either way: nothing to do. */
  }

  return added
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
/**
 * Say that bookings arrived, once, however many there were.
 *
 * ONE MESSAGE AND NOT ONE PER BOOKING. Six bookings picked up in one go is one
 * piece of news; six notifications is a system that has to be silenced, and a
 * silenced system tells nobody anything.
 */
async function announce(
  listing: StayBrainListing,
  added: number,
  earnedBaseMinor: number,
): Promise<void> {
  if (added <= 0) return

  await tellOwners({
    kind: 'sale_new',
    title: `${listing.name} · ${added}`,
    body: formatMoney(earnedBaseMinor, listing.currency, 'en'),
    link: `/staybrain/${listing.id}`,
  })
}

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
  let earned = 0

  /*
   * Every reservation must have its sale, including the ones imported before
   * there were any.
   *
   * WHY THIS IS A REPAIR AND NOT A MIGRATION. Commissions became sales after some
   * bookings had already been picked up, so those earned money that appeared
   * nowhere — the property knew about it and the dashboard did not. A one-off
   * script would have fixed today and left the same hole open for any future gap.
   *
   * So the sales are read once, and anything missing is written as it is found.
   * A run with nothing missing costs one query and no writes, which is the usual
   * case; the first run after a gap quietly closes it.
   */
  const sales = await readAll<Sale>('sales', 'saleDate', 'desc')
  const haveSale = new Set(sales.map((row) => row.id))

  /* The joining fee is the same story: written on save, and repaired here. */
  if (!haveSale.has(`sb_fee_${listing.id}`)) {
    await recordFeeSale(listing, listing.id)
  }

  for (const row of existing) {
    if (row.status === 'cancelled') continue
    if ((row.earning?.baseMinor ?? 0) <= 0) continue

    /*
     * When this was earned: the day it entered this system, not the day the
     * guest arrives.
     *
     * A booking taken in September for a stay in October is September's income —
     * the work was done and the commission was owed then, and dating it by the
     * stay put it in a month that had not happened yet. `takenAt` is when we
     * picked it up, which is the closest thing we hold to when it was agreed.
     */
    const earnedDate = (row.takenAt ?? row.createdAt ?? '').slice(0, 10) || today()
    const sale = sales.find((one) => one.id === `sb_${row.id}`)

    /* Missing entirely — the gap this repair exists for. */
    if (!sale) {
      await recordSale(listing, row.id, row.guestName, earnedDate, row.earning, service, row.value)
      continue
    }

    /*
     * Or present and dated by the stay, from before this was understood. Corrected
     * once and then left alone, so this costs nothing on every later run.
     */
    if (sale.saleDate !== earnedDate) {
      await patch('sales', sale.id, { saleDate: earnedDate })
    }
  }

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
      await recordSale(listing, id, booking.guestName, earnedOn(booking), earning, service, value)
    }

    added += 1
    earned += earning.baseMinor
  }

  /* News, not a receipt: sent once for the batch, and never to whoever ran it. */
  await announce(listing, added, earned)

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
 * The day a commission was earned.
 *
 * NOT THE GUEST'S ARRIVAL, which is what this used to be and why today's takings
 * read as nothing: a booking taken today for a stay in October dated the sale in
 * October, so it fell outside this month, outside today, and outside every
 * figure on the dashboard. The money was earned the moment the booking was
 * marked as ours.
 *
 * `mseeMarkedAt` is stamped by the reservation system when the box is ticked.
 * Falling back to today rather than to check-in, because a booking being read for
 * the first time now is closer to earned now than to earned whenever the guest
 * happens to arrive.
 */
function earnedOn(booking: RmsBooking): string {
  return booking.mseeMarkedAt ? booking.mseeMarkedAt.slice(0, 10) : today()
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
  /** What the guest pays. Ours is a cut of it, and the two are never one figure. */
  basis?: Money,
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
    /*
     * What the booking was worth to the owner, kept beside what it was worth to
     * us. The company earned the commission; the client earned the booking, and
     * "how much have we made for our clients" is a question only this field can
     * answer.
     */
    basisValue: basis ?? null,
    commissionPercent:
      basis && basis.baseMinor > 0
        ? Math.round((earning.baseMinor / basis.baseMinor) * 1000) / 10
        : 0,
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

  /*
   * Anything decided on the sale itself survives this.
   *
   * The fee is written here, but instalments, an advance and the notes are
   * decided on the sale in Finance — and this runs again every time the listing
   * is saved. Rebuilding the sale from scratch would quietly reset a payment plan
   * somebody had agreed with a client, which is the kind of loss nobody notices
   * until the client asks why the second instalment never appeared.
   */
  const existing = await readOne<Sale>('sales', `sb_fee_${id}`)

  await saveSale({
    ...blankSale(me.uid, me.name),
    ...(existing ? { payment: existing.payment, notes: existing.notes } : {}),
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

  /*
   * The commission follows the booking, including when it is changed there.
   *
   * IT USED TO BE FROZEN, and the reasoning was that an agreement should not be
   * rewritten by a later change of terms. That is right for the listing's
   * standing terms and wrong for this: the figure typed on the booking IS the
   * agreement for that booking, so correcting it there is correcting the
   * agreement, and refusing to follow it left MsEe Central quietly reporting a
   * number nobody had agreed to any more.
   */
  const earning = earningOf(listing.earning, value, booking.mseeCommissionAmount)

  const same =
    mine.guestName === booking.guestName &&
    mine.guestContact === booking.phone &&
    mine.checkIn === booking.checkIn &&
    mine.checkOut === booking.checkOut &&
    mine.note === booking.notes &&
    mine.ownerName === (booking.mseeBroughtBy ?? '') &&
    mine.value.minor === value.minor &&
    (mine.earning?.minor ?? 0) === earning.minor &&
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
    await recordSale(listing, mine.id, booking.guestName, earnedOn(booking), earning, await stayBrainService(), value)
  }

  await patch('reservations', mine.id, {
    guestName: booking.guestName,
    guestContact: booking.phone,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    nights: booking.days || nightsOf(booking.checkIn, booking.checkOut),
    value,
    earning,
    note: booking.notes,
    ownerName: booking.mseeBroughtBy ?? '',
    status,
    rmsReservationId: booking.reservationId,
  })

  /*
   * And the sale with it, so the dashboard is not left quoting the old figure.
   * Rewritten by the same derived id rather than added to.
   */
  if (status !== 'cancelled') {
    await recordSale(listing, mine.id, booking.guestName, earnedOn(booking), earning, await stayBrainService(), value)
  }
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

  const service = await stayBrainService()

  return saveTransaction({
    ...blankTransaction('income'),
    category: 'service_payment',
    /* Stamped with the service so the property can find its own invoices. */
    serviceId: service?.id ?? null,
    serviceName: service?.name ?? 'StayBrain',
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
