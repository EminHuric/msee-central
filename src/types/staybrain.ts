/**
 * StayBrain — the properties we sell for, and what selling one earns us.
 *
 * THE DIVISION OF LABOUR, which is the whole design.
 *
 *   The RMS owns the property: its units, its prices, every booking taken
 *   through any channel, and therefore availability. It is the source of truth
 *   and nothing here copies it.
 *
 *   StayBrain owns three things the RMS has no opinion about: which properties
 *   we sell for, which bookings WE brought, and what each one earns us.
 *
 * So a listing is a thin record — a link to an RMS account plus our commercial
 * terms. Open it and the units, the calendar and the bookings are read live from
 * the RMS; what is stored here is only what the RMS could not answer.
 *
 * WHY THE FIGURES CANNOT COME FROM THE RMS. The RMS knows the property took
 * thirty bookings. It cannot know that six of them are ours, because from its
 * side a booking is a booking. Ours are the ones created through MsEe Central,
 * stamped at creation by a rule in the RMS's own security rules, and recorded
 * here as well. Every MsEe number on every screen counts that record and never
 * the RMS's total — which is why "MsEe turnover" and "their turnover" can never
 * quietly become the same number.
 */

/*
 * Type-only, deliberately.
 *
 * The i18n checker imports this module under Node's type stripping, which erases
 * a type-only import entirely and therefore never resolves the path. A value
 * import here makes Node try to load './money' as a real file and the whole tool
 * dies with ERR_MODULE_NOT_FOUND — which is how every other type module in this
 * folder came to import Money the same way.
 */
import type { CurrencyCode, Money } from './money'

/** A zero, spelled out rather than imported, for the reason just above. */
const NO_MONEY = (currency: CurrencyCode): Money => ({
  minor: 0,
  currency,
  rate: 1,
  baseMinor: 0,
  rateDate: '',
})

/* ------------------------------------------------------------------ *
 * What a listing earns us
 * ------------------------------------------------------------------ */

/**
 * How our earning on one booking is worked out.
 *
 * Only `fixed_per_reservation` exists, because that is the deal: a flat amount
 * per booking we bring, set per property. The shape is a named model with an
 * amount rather than a bare number so that the day a client is agreed on a
 * percentage, the new model is a case in one function and not a migration of
 * every listing and every reservation ever recorded.
 */
export const EARNING_MODELS = ['fixed_per_reservation', 'percent_of_value'] as const
export type EarningModel = (typeof EARNING_MODELS)[number]

export interface EarningTerms {
  model: EarningModel
  /** For `fixed_per_reservation`: what one booking earns us. */
  amount: Money
  /** For `percent_of_value`: the share of the booking, 0–100. */
  percent: number
}

/**
 * What one booking of a given value earns us.
 *
 * The single place the question is answered, so a figure on a card, a figure in
 * the ledger and a figure on the dashboard cannot disagree.
 */
export function earningFor(terms: EarningTerms, value: Money): Money {
  if (terms.model === 'percent_of_value') {
    const minor = Math.round((value.minor * terms.percent) / 100)
    return {
      minor,
      currency: value.currency,
      rate: value.rate,
      baseMinor: Math.round((value.baseMinor * terms.percent) / 100),
      rateDate: value.rateDate,
    }
  }

  /*
   * A fixed amount, and deliberately not scaled by anything.
   *
   * €50 per booking is €50 whether the guest stayed one night or ten. The rate
   * and date are carried from the terms, not from the booking, because it is our
   * agreement that fixes the amount.
   */
  return { ...terms.amount }
}

/* ------------------------------------------------------------------ *
 * A listing
 * ------------------------------------------------------------------ */

export interface StayBrainListing {
  id: string

  /** The client this property belongs to, in our own records. */
  clientId: string
  clientName: string

  /**
   * The RMS account whose apartments and bookings this listing shows.
   *
   * This is the `workspaceId` over there — which is also that account's user id,
   * because the RMS makes every account its own tenant. Empty means a listing
   * somebody created before choosing the account; it shows as unlinked rather
   * than showing nothing.
   */
  rmsWorkspaceId: string
  /** Their login, kept so a person can recognise the account they picked. */
  rmsAccountEmail: string

  /** What we call it. Usually the property's name. */
  name: string
  note: string

  earning: EarningTerms

  /** Bookings are entered in the currency the property prices in. */
  currency: CurrencyCode
  /** Base-currency units per one unit of `currency`. 1 keeps it as entered. */
  rate: number

  active: boolean

  deletedAt: string | null
  deletedBy: string | null
  deletedByName: string

  createdAt: string
  createdBy: string
  updatedAt: string
}

export function blankListing(currency: CurrencyCode = 'EUR'): StayBrainListing {
  return {
    id: '',
    clientId: '',
    clientName: '',
    rmsWorkspaceId: '',
    rmsAccountEmail: '',
    name: '',
    note: '',
    earning: {
      model: 'fixed_per_reservation',
      amount: NO_MONEY(currency),
      percent: 0,
    },
    currency,
    rate: 1,
    active: true,
    deletedAt: null,
    deletedBy: null,
    deletedByName: '',
    createdAt: '',
    createdBy: '',
    updatedAt: '',
  }
}

/* ------------------------------------------------------------------ *
 * The RMS's own shapes, as they actually are
 * ------------------------------------------------------------------ */

/**
 * An apartment, exactly as the RMS stores it.
 *
 * Written out rather than guessed: these are the fields `ApartmentsView` writes
 * and nothing more. There is no photograph and no unit type in the RMS, so
 * neither can be shown here — a screen inventing them would be showing our
 * imagination rather than their property.
 */
export interface RmsApartment {
  id: string
  name: string
  maxGuests: number
  pricePerNight: number
  description: string
  features: string[]
  color: string
  workspaceId: string
  /** The night index the RMS keeps so a booking can be created atomically. */
  bookedNights?: string[]
}

/** A booking, as the RMS stores it, plus the stamps we add to our own. */
export interface RmsBooking {
  id: string
  reservationId: string
  guestName: string
  phone: string
  /** The guest's town or country. NOT a channel — the RMS has no channel. */
  origin: string
  notes: string
  tags: string[]
  apartmentId: string
  checkIn: string
  checkOut: string
  pricePerNight: number
  days: number
  totalPrice: number
  depositAmount: number
  depositPaid: boolean
  totalPaid: number
  paymentStatus: string
  status: string
  workspaceId: string

  /* ---- present only on bookings we brought -------------------------- */
  source?: string
  createdVia?: string
  createdByAgency?: string
  mseeReservationId?: string
  mseeUserName?: string
}

/** An RMS account, from its `users` collection. */
export interface RmsAccount {
  id: string
  username: string
  email: string
  role: string
  disabled: boolean
  apartmentCount: number
  bookingCount: number
  /** Whether this account has let the agency write bookings into it. */
  agencyAccess: boolean
}

/**
 * The RMS's payment states, as its own `calcPaymentStatus` produces them.
 *
 * Mirrored here only so the labels can be checked: this system never writes one.
 * The owner's ledger against their own guest is theirs.
 *
 * Named RMS_ because `PAYMENT_STATES` already exists in `revenue.ts` and means
 * something else — paid / pending / overdue, about an invoice of ours. Two
 * different vocabularies under one name is how a screen ends up showing
 * "overdue" for a guest who has paid a deposit.
 */
export const RMS_PAYMENT_STATES = ['paid', 'deposit_paid', 'partial', 'unpaid'] as const
export type RmsPaymentState = (typeof RMS_PAYMENT_STATES)[number]

/** The stamp that makes a booking ours, checked by the RMS's own rules. */
export const MSEE_SOURCE = 'MSEE'
export const MSEE_VIA = 'MSEE_CENTRAL'

/** Was this booking brought by us? */
export const isOurs = (booking: RmsBooking): boolean => booking.source === MSEE_SOURCE

/* ------------------------------------------------------------------ *
 * Availability
 * ------------------------------------------------------------------ */

/**
 * Every night a stay occupies, as 'YYYY-MM-DD'.
 *
 * Check-in counts, check-out does not: a guest leaving on the 4th frees the 4th.
 * That is the RMS's own rule — its `checkConflict` allows a same-day
 * checkout/checkin pair — and the two systems must agree about it exactly, or
 * one of them will refuse a booking the other considers fine.
 */
export function nightsBetween(checkIn: string, checkOut: string): string[] {
  const nights: string[] = []
  const start = Date.parse(checkIn)
  const end = Date.parse(checkOut)
  if (!start || !end || end <= start) return nights

  for (let day = start; day < end && nights.length < 370; day += 86_400_000) {
    nights.push(new Date(day).toISOString().slice(0, 10))
  }
  return nights
}

/** Does a stay clash with a booking that already exists? */
export function clashesWith(
  booking: RmsBooking,
  checkIn: string,
  checkOut: string,
): boolean {
  if (booking.status === 'cancelled') return false
  return checkIn < booking.checkOut && checkOut > booking.checkIn
}

/**
 * Which units can take a stay, and which cannot, and why.
 *
 * Returned together rather than filtered, because "Apartment 5 is taken by
 * Marko until the 4th" is the sentence somebody needs; a unit that has silently
 * vanished from a list teaches nobody anything.
 */
export interface UnitAvailability {
  apartment: RmsApartment
  free: boolean
  /** The booking in the way, when there is one. */
  clash: RmsBooking | null
  /** Below the stay's guest count. Shown, never hidden. */
  tooSmall: boolean
}

export function availabilityFor(
  apartments: RmsApartment[],
  bookings: RmsBooking[],
  checkIn: string,
  checkOut: string,
  guests = 1,
): UnitAvailability[] {
  return apartments
    .map((apartment) => {
      const clash =
        bookings.find((b) => b.apartmentId === apartment.id && clashesWith(b, checkIn, checkOut)) ??
        null

      return {
        apartment,
        clash,
        free: clash === null,
        tooSmall: (apartment.maxGuests || 0) < guests,
      }
    })
    .sort((a, b) => a.apartment.name.localeCompare(b.apartment.name))
}

/* ------------------------------------------------------------------ *
 * What we made here
 * ------------------------------------------------------------------ */

export interface ListingTotals {
  /** Bookings we brought. Cancellations counted, because they happened. */
  reservations: number
  /** Of those, the ones that still count for money. */
  earning: number
  nights: number
  /** What the guests pay. Theirs, not ours. */
  turnoverBaseMinor: number
  /** What we earn on it. Ours. */
  revenueBaseMinor: number
}

export const EMPTY_TOTALS: ListingTotals = {
  reservations: 0,
  earning: 0,
  nights: 0,
  turnoverBaseMinor: 0,
  revenueBaseMinor: 0,
}
