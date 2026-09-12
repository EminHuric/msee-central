/**
 * Bookings MsEe brought a client.
 *
 * WHY THIS EXISTS, and why it is better than what it replaces.
 *
 * "How much did we bring them" was an estimate, or at best a sum over channels
 * the RMS had been taught to label. Entering the booking here makes it a fact
 * by construction: a reservation in this collection is one we brought, because
 * that is the only way one gets here. Attribution stops being a measurement and
 * becomes a count.
 *
 * THE DIVISION OF LABOUR, which is the part worth getting right.
 *
 *   The RMS holds every reservation for the property, whatever its source. It
 *   is the truth about the property, and nothing here competes with that.
 *
 *   This holds the ones we brought. It is the truth about our contribution.
 *
 * So the same booking exists in both, and that is not duplication — the two
 * systems are answering different questions about it.
 *
 * HOW IT REACHES THE RMS, and why it is not pushed.
 *
 * MsEe Central writing into the RMS would need the RMS's credentials, and
 * anything a browser holds is readable by whoever opens the console. So the RMS
 * does the reaching in both directions: it sends turnover in, and it comes and
 * takes reservations out. The key stays on the server that owns it, and no
 * server of our own is needed.
 *
 * A row carries `syncState` so the RMS can ask for what it has not taken yet
 * and mark what it has. Nothing is deleted once taken; the record of what we
 * brought is the point.
 */

import type { Money } from './money'

/**
 * How far a reservation has got with the RMS.
 *
 * `pending` means ours and not yet collected. `taken` means the RMS has it and
 * gave us back its own id, so the two can be reconciled later. `failed` means
 * the RMS refused it and somebody needs to look — which is a state worth having
 * rather than a silent retry for ever.
 */
export const SYNC_STATES = ['pending', 'taken', 'failed', 'local_only'] as const
export type SyncState = (typeof SYNC_STATES)[number]

/** What happened to the booking itself. */
export const RESERVATION_STATUSES = [
  'enquiry',
  'confirmed',
  'stayed',
  'cancelled',
  'no_show',
] as const
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]

/** Statuses that count towards what we brought. */
export const EARNING_STATUSES: readonly ReservationStatus[] = ['confirmed', 'stayed']

export interface Reservation {
  id: string

  clientId: string
  clientName: string

  /** The guest, as they gave it. Enough to recognise them, not a full profile. */
  guestName: string
  guestContact: string

  checkIn: string
  checkOut: string
  /**
   * Nights, stored rather than derived from the dates.
   *
   * Because the two can legitimately disagree: a client may agree a three-night
   * rate for a stay that spans four dates, and the figure that matters for
   * money is the one that was agreed.
   */
  nights: number
  guests: number

  /** What the guest pays. */
  value: Money

  /**
   * Where we brought them from. Free text on purpose — a new campaign should
   * not need a code change to be recorded.
   */
  source: string

  status: ReservationStatus
  note: string

  /* ---- The RMS side ------------------------------------------------- */

  syncState: SyncState
  /** The RMS's own reference, e.g. RSV-2026-481023. For a human to quote. */
  rmsReservationId: string
  /**
   * The RMS's document id for this booking.
   *
   * Separate from the reference above because only this one can be used to go
   * back and change the booking. The reference is for people; this is the link.
   */
  rmsBookingId: string
  takenAt: string | null
  /** Why the RMS refused it, when it did. */
  syncError: string

  /* ---- StayBrain ---------------------------------------------------- */

  /**
   * The listing this booking was sold through, when it was.
   *
   * Empty for a booking recorded against a client with no StayBrain property —
   * which stays possible on purpose, because not every client we bring guests to
   * is on the RMS.
   */
  listingId: string
  /** The RMS account the booking lives in. Kept so the link survives a rename. */
  rmsWorkspaceId: string
  apartmentId: string
  apartmentName: string

  /**
   * What this booking earns us, frozen when it was made.
   *
   * Stored rather than derived, and that is the one place in this system where
   * freezing beats recomputing: the earning follows from an agreement, and an
   * agreement can be renegotiated. Recomputing from today's terms would quietly
   * rewrite what we earned last season every time a rate changed. This is the
   * same reason a Money carries the exchange rate of its own date.
   */
  earning: Money

  /** Who entered it. Performance and earnings both read this. */
  ownerUid: string | null
  ownerName: string

  deletedAt: string | null
  deletedBy: string | null
  deletedByName: string

  createdAt: string
  createdBy: string
  updatedAt: string
}

export function blankReservation(clientId = '', clientName = ''): Reservation {
  const today = new Date().toISOString().slice(0, 10)

  return {
    id: '',
    clientId,
    clientName,
    guestName: '',
    guestContact: '',
    checkIn: today,
    checkOut: today,
    nights: 1,
    guests: 2,
    value: { minor: 0, currency: 'EUR', rate: 1, baseMinor: 0, rateDate: today },
    source: '',
    status: 'confirmed',
    note: '',
    syncState: 'pending',
    rmsReservationId: '',
    rmsBookingId: '',
    takenAt: null,
    syncError: '',
    listingId: '',
    rmsWorkspaceId: '',
    apartmentId: '',
    apartmentName: '',
    earning: { minor: 0, currency: 'EUR', rate: 1, baseMinor: 0, rateDate: today },
    ownerUid: null,
    ownerName: '',
    deletedAt: null,
    deletedBy: null,
    deletedByName: '',
    createdAt: '',
    createdBy: '',
    updatedAt: '',
  }
}

/** Nights between two dates, as a starting point somebody can correct. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const from = Date.parse(checkIn)
  const to = Date.parse(checkOut)
  if (!from || !to || to <= from) return 1
  return Math.round((to - from) / 86_400_000)
}

export interface BroughtTotals {
  /** What the guests pay, across the reservations that count. */
  broughtBaseMinor: number
  /** Our share of it, at the client's rate. */
  ourShareBaseMinor: number
  /**
   * What we earn on the StayBrain bookings among them.
   *
   * Kept apart from `ourShareBaseMinor` because the two are different deals: a
   * percentage of a client's attributed trade, and a fixed amount per booking we
   * place in their calendar. Adding them would be adding a rate to a fee.
   */
  earnedBaseMinor: number
  reservations: number
  nights: number
  /** Entered and not yet collected by the RMS. */
  pending: number
  /** The RMS refused these; somebody should look. */
  failed: number
}

/**
 * What we brought a client, and what our share of it is.
 *
 * Cancellations and no-shows are excluded from the money and left in the count
 * of reservations, because "we sent them eleven bookings and two cancelled" is
 * a more useful sentence than either half alone.
 *
 * The share is computed here from the client's rate rather than stored, so a
 * corrected rate corrects every figure derived from it and there is no second
 * copy to go stale.
 */
export function broughtFor(
  rows: Reservation[],
  sharePercent: number,
): BroughtTotals {
  const earning = rows.filter((r) => EARNING_STATUSES.includes(r.status))
  const brought = earning.reduce((n, r) => n + r.value.baseMinor, 0)

  return {
    broughtBaseMinor: brought,
    ourShareBaseMinor: Math.round((brought * sharePercent) / 100),
    earnedBaseMinor: earning.reduce((n, r) => n + (r.earning?.baseMinor ?? 0), 0),
    reservations: rows.length,
    nights: earning.reduce((n, r) => n + r.nights, 0),
    pending: rows.filter((r) => r.syncState === 'pending').length,
    failed: rows.filter((r) => r.syncState === 'failed').length,
  }
}
