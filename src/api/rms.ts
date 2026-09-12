/**
 * Reading the RMS, and writing one booking into it.
 *
 * EVERY READ IS ON DEMAND. Nothing from the RMS is stored here. Open a property
 * and its units, bookings and availability are fetched; close it and they are
 * gone. That is not laziness about caching — it is the only way "the RMS is the
 * source of truth" can be true. A copy kept here would be right until the owner
 * took a booking on the phone, and then it would be confidently wrong, which is
 * worse than slow.
 *
 * THE WRITE IS THE CAREFUL PART. Creating a booking has to satisfy three things
 * at once:
 *
 *   it must not double-book — enforced on Google's servers by a transaction
 *   over the apartment's night index, not by a check in this browser;
 *
 *   it must be impossible to run twice — the document id is derived from our own
 *   reservation id, so a retry after a lost connection writes the same document
 *   instead of a second booking;
 *
 *   it must be unmistakably ours — the stamp fields are required by the RMS's
 *   own security rules, so a booking that reaches that collection through this
 *   function can always be told from one the owner entered.
 *
 * NOTHING HERE REPORTS SUCCESS THE RMS DID NOT GIVE. Every function either
 * returns what the RMS confirmed or throws. There is no optimistic path.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'

import { rmsDb, rmsUser } from '@/lib/rms'
import {
  MSEE_SOURCE,
  MSEE_VIA,
  clashesWith,
  nightsBetween,
  type RmsAccount,
  type RmsApartment,
  type RmsBooking,
} from '@/types/staybrain'

/* ------------------------------------------------------------------ *
 * Failures, named
 * ------------------------------------------------------------------ */

/**
 * Why naming them matters: every one of these needs a different sentence on
 * screen and a different decision. "Something went wrong" would leave somebody
 * guessing whether to try again, pick another unit, or call the owner.
 */
export class RmsNotConnected extends Error {
  constructor() {
    super('Not signed in to the RMS')
    this.name = 'RmsNotConnected'
  }
}

export class RmsUnavailable extends Error {
  constructor(cause?: unknown) {
    super(`The RMS could not be reached: ${describe(cause)}`)
    this.name = 'RmsUnavailable'
  }
}

export class RmsRefused extends Error {
  constructor(cause?: unknown) {
    super(`The RMS refused the write: ${describe(cause)}`)
    this.name = 'RmsRefused'
  }
}

/** The unit is taken for those dates. Carries the booking in the way. */
export class RmsConflict extends Error {
  constructor(
    public readonly guestName: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Already booked by ${guestName} from ${from} to ${to}`)
    this.name = 'RmsConflict'
  }
}

function describe(cause: unknown): string {
  const code = (cause as { code?: string } | undefined)?.code
  const message = (cause as { message?: string } | undefined)?.message
  return code || message || String(cause ?? 'unknown')
}

/**
 * Turn a Firestore failure into the right one of ours.
 *
 * `permission-denied` is the one worth separating: it means the rules said no,
 * which on a write almost always means this account is not the agency yet or the
 * property has not switched access on — a thing somebody can fix, not an outage.
 */
function wrap(error: unknown): Error {
  const code = (error as { code?: string }).code ?? ''
  if (code === 'permission-denied') return new RmsRefused(error)
  if (error instanceof RmsConflict) return error
  return new RmsUnavailable(error)
}

function requireSession(): { uid: string; email: string } {
  const user = rmsUser()
  if (!user) throw new RmsNotConnected()
  return user
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/**
 * The RMS accounts that have invited us to sell for them.
 *
 * THE FILTER IS NOT COSMETIC — IT IS WHAT MAKES THE QUERY LEGAL. The RMS's rules
 * let the agency read an account only when that account has set
 * `agencyAccess: true`, and Firestore checks a rule against every document a
 * query would return. So an unfiltered list of `users` fails on the first account
 * that never invited us; asking only for the ones that did is both the narrower
 * request and the one that succeeds.
 *
 * It also makes the picker honest: an account that has not switched access on
 * cannot be chosen, rather than being chosen and refusing every booking later.
 */
export async function fetchRmsAccounts(): Promise<RmsAccount[]> {
  requireSession()
  try {
    const snap = await getDocs(
      query(collection(rmsDb(), 'users'), where('agencyAccess', '==', true)),
    )
    return snap.docs
      .map((d) => {
        const data = d.data()
        return {
          id: d.id,
          username: String(data.username ?? ''),
          email: String(data.email ?? ''),
          role: String(data.role ?? 'user'),
          disabled: data.disabled === true,
          apartmentCount: Number(data.apartmentCount ?? 0),
          bookingCount: Number(data.bookingCount ?? 0),
          agencyAccess: data.agencyAccess === true,
        }
      })
      .sort((a, b) => (a.username || a.email).localeCompare(b.username || b.email))
  } catch (error) {
    throw wrap(error)
  }
}

export async function fetchRmsAccount(workspaceId: string): Promise<RmsAccount | null> {
  requireSession()
  try {
    const snap = await getDoc(doc(rmsDb(), 'users', workspaceId))
    if (!snap.exists()) return null
    const data = snap.data()
    return {
      id: snap.id,
      username: String(data.username ?? ''),
      email: String(data.email ?? ''),
      role: String(data.role ?? 'user'),
      disabled: data.disabled === true,
      apartmentCount: Number(data.apartmentCount ?? 0),
      bookingCount: Number(data.bookingCount ?? 0),
      agencyAccess: data.agencyAccess === true,
    }
  } catch (error) {
    throw wrap(error)
  }
}

export async function fetchApartments(workspaceId: string): Promise<RmsApartment[]> {
  requireSession()
  try {
    const snap = await getDocs(
      query(collection(rmsDb(), 'apartments'), where('workspaceId', '==', workspaceId)),
    )
    return snap.docs
      .map((d) => {
        const data = d.data()
        return {
          id: d.id,
          name: String(data.name ?? ''),
          maxGuests: Number(data.maxGuests ?? data.capacity ?? 0),
          pricePerNight: Number(data.pricePerNight ?? 0),
          description: String(data.description ?? ''),
          features: Array.isArray(data.features) ? (data.features as string[]) : [],
          color: String(data.color ?? ''),
          workspaceId: String(data.workspaceId ?? ''),
          bookedNights: Array.isArray(data.bookedNights) ? (data.bookedNights as string[]) : [],
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    throw wrap(error)
  }
}

/**
 * Every booking for a property, whoever brought it.
 *
 * All of them, deliberately: availability is the question, and a booking the
 * owner took on the phone blocks a unit exactly as firmly as one of ours. Which
 * of them are ours is a separate question, answered by the stamp, and it never
 * changes what is free.
 */
export async function fetchBookings(workspaceId: string): Promise<RmsBooking[]> {
  requireSession()
  try {
    const snap = await getDocs(
      query(collection(rmsDb(), 'bookings'), where('workspaceId', '==', workspaceId)),
    )
    return snap.docs
      .map((d) => {
        const data = d.data()
        return {
          id: d.id,
          reservationId: String(data.reservationId ?? ''),
          guestName: String(data.guestName ?? ''),
          phone: String(data.phone ?? ''),
          origin: String(data.origin ?? ''),
          notes: String(data.notes ?? ''),
          tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
          apartmentId: String(data.apartmentId ?? ''),
          checkIn: String(data.checkIn ?? ''),
          checkOut: String(data.checkOut ?? ''),
          pricePerNight: Number(data.pricePerNight ?? 0),
          days: Number(data.days ?? 0),
          totalPrice: Number(data.totalPrice ?? 0),
          depositAmount: Number(data.depositAmount ?? 0),
          depositPaid: data.depositPaid === true,
          totalPaid: Number(data.totalPaid ?? 0),
          paymentStatus: String(data.paymentStatus ?? ''),
          status: String(data.status ?? ''),
          workspaceId: String(data.workspaceId ?? ''),
          source: data.source ? String(data.source) : undefined,
          createdVia: data.createdVia ? String(data.createdVia) : undefined,
          createdByAgency: data.createdByAgency ? String(data.createdByAgency) : undefined,
          mseeReservationId: data.mseeReservationId ? String(data.mseeReservationId) : undefined,
          mseeUserName: data.mseeUserName ? String(data.mseeUserName) : undefined,
        }
      })
      .sort((a, b) => b.checkIn.localeCompare(a.checkIn))
  } catch (error) {
    throw wrap(error)
  }
}

/* ------------------------------------------------------------------ *
 * Writing one booking
 * ------------------------------------------------------------------ */

/** The RMS's own human-readable reference, in its own format. */
function reservationReference(): string {
  const year = new Date().getFullYear()
  const random = Math.floor(Math.random() * 900_000 + 100_000)
  return `RSV-${year}-${random}`
}

/**
 * Our reservation id, as an RMS document id.
 *
 * Prefixed so that anybody looking at the RMS database can see at a glance which
 * bookings came from us, and so the two id spaces can never collide with an
 * auto-generated one.
 */
export const rmsDocIdFor = (mseeReservationId: string): string => `msee_${mseeReservationId}`

export interface NewRmsBooking {
  workspaceId: string
  apartmentId: string
  /** Our own reservation id. Must already exist — it is the idempotency key. */
  mseeReservationId: string
  guestName: string
  phone: string
  /** The guest's town or country, which is what the RMS means by origin. */
  origin: string
  checkIn: string
  checkOut: string
  /** In the property's own currency, as a plain amount — the RMS's convention. */
  pricePerNight: number
  totalPrice: number
  depositAmount: number
  notes: string
  /** Who here is making the booking, for the RMS to show. */
  mseeUserName: string
}

export interface RmsBookingResult {
  /** The RMS document id. */
  id: string
  /** The RMS's own reference, e.g. RSV-2026-481023. */
  reservationId: string
  /** True when the booking was already there and this call changed nothing. */
  alreadyExisted: boolean
}

/**
 * Create the booking in the RMS, atomically, and idempotently.
 *
 * The order of the three reads inside the transaction is the whole correctness
 * argument:
 *
 *   1. our own document — if it is there, this is a retry of a call that did
 *      succeed, and the right answer is to report success and write nothing;
 *   2. the apartment — its night index is what makes the clash check atomic;
 *   3. the nights themselves — if any is taken the transaction throws and
 *      nothing at all is written.
 *
 * Firestore retries a transaction whose documents changed underneath it, so two
 * people booking the same unit in the same second cannot both pass step 3.
 *
 * The caller must already have written its own reservation record. That is
 * deliberate: if this function succeeds and the caller then fails to save the
 * link, the booking in the RMS still names our reservation, so it can be found
 * and reconciled. The reverse order would leave a booking in the property's
 * calendar that nothing here knows about.
 */
export async function createRmsBooking(input: NewRmsBooking): Promise<RmsBookingResult> {
  const session = requireSession()
  const nights = nightsBetween(input.checkIn, input.checkOut)
  if (!nights.length) throw new RmsRefused('check-out must be after check-in')

  const db = rmsDb()
  const bookingRef = doc(db, 'bookings', rmsDocIdFor(input.mseeReservationId))
  const apartmentRef = doc(db, 'apartments', input.apartmentId)
  const reference = reservationReference()

  /*
   * The query check, before the transaction.
   *
   * A transaction cannot run a query, so the night index is what it can check —
   * and an apartment whose index has not been built yet would have an empty one.
   * This catches that case by reading the bookings themselves, and it is also
   * what produces a sentence naming the guest who is already there. The
   * transaction is still what guarantees it.
   */
  const existing = await fetchBookings(input.workspaceId)
  const clash = existing.find(
    (b) =>
      b.apartmentId === input.apartmentId &&
      b.mseeReservationId !== input.mseeReservationId &&
      clashesWith(b, input.checkIn, input.checkOut),
  )
  if (clash) throw new RmsConflict(clash.guestName, clash.checkIn, clash.checkOut)

  try {
    return await runTransaction(db, async (tx) => {
      const mine = await tx.get(bookingRef)
      if (mine.exists()) {
        return {
          id: bookingRef.id,
          reservationId: String(mine.data().reservationId ?? ''),
          alreadyExisted: true,
        }
      }

      const apartment = await tx.get(apartmentRef)
      if (!apartment.exists()) throw new RmsRefused('that unit no longer exists')

      const taken: string[] = Array.isArray(apartment.data().bookedNights)
        ? (apartment.data().bookedNights as string[])
        : []

      const hit = nights.find((night) => taken.includes(night))
      if (hit) {
        const other = existing.find(
          (b) => b.apartmentId === input.apartmentId && nightsBetween(b.checkIn, b.checkOut).includes(hit),
        )
        throw new RmsConflict(other?.guestName ?? '', other?.checkIn ?? hit, other?.checkOut ?? hit)
      }

      const days = nights.length

      tx.set(bookingRef, {
        reservationId: reference,
        guestName: input.guestName,
        phone: input.phone,
        origin: input.origin,
        notes: input.notes,
        tags: [],
        apartmentId: input.apartmentId,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        pricePerNight: input.pricePerNight,
        days,
        totalPrice: input.totalPrice,
        depositAmount: input.depositAmount,
        depositPaid: false,
        totalPaid: 0,
        /* The RMS's own vocabulary, so its screens read this correctly. */
        paymentStatus: 'unpaid',
        payments: [],
        status: 'confirmed',
        workspaceId: input.workspaceId,
        createdAt: serverTimestamp(),

        /*
         * The stamp. Not decoration: the RMS's security rules refuse this write
         * unless all four are present and correct, which is what makes "MsEe
         * brought this booking" a fact in their database rather than a claim in
         * ours.
         */
        source: MSEE_SOURCE,
        createdVia: MSEE_VIA,
        createdByAgency: session.uid,
        mseeReservationId: input.mseeReservationId,
        mseeUserName: input.mseeUserName,
      })

      tx.update(apartmentRef, { bookedNights: [...taken, ...nights].sort() })

      return { id: bookingRef.id, reservationId: reference, alreadyExisted: false }
    })
  } catch (error) {
    throw wrap(error)
  }
}

/**
 * Cancel a booking we brought, and free its nights.
 *
 * Cancelled rather than deleted, because the RMS treats a cancelled booking as
 * one that existed and then did not happen — and because the agency is not
 * allowed to delete anything, which is the right limit for somebody else's
 * property.
 */
export async function cancelRmsBooking(
  workspaceId: string,
  rmsBookingId: string,
  apartmentId: string,
): Promise<void> {
  requireSession()
  const db = rmsDb()

  try {
    await updateDoc(doc(db, 'bookings', rmsBookingId), {
      status: 'cancelled',
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  } catch (error) {
    throw wrap(error)
  }

  /*
   * Then rebuild the night index from the bookings that remain.
   *
   * Recomputed rather than subtracted, for the same reason the RMS does it that
   * way: a subtraction that runs twice, or half-runs, leaves a unit unsellable
   * on nights nobody is staying.
   */
  try {
    const remaining = await fetchBookings(workspaceId)
    const nights = new Set<string>()
    remaining.forEach((b) => {
      if (b.apartmentId !== apartmentId || b.status === 'cancelled' || b.id === rmsBookingId) return
      nightsBetween(b.checkIn, b.checkOut).forEach((n) => nights.add(n))
    })

    await updateDoc(doc(db, 'apartments', apartmentId), {
      bookedNights: [...nights].sort(),
    })
  } catch {
    /*
     * The cancellation is what mattered and it is done. A stale index only ever
     * refuses a booking that could have been taken, and the owner's own app
     * repairs it the next time they open their data.
     */
  }
}

/**
 * Find a booking in the RMS by our reservation id.
 *
 * The recovery path for the one failure that cannot be prevented: the RMS
 * accepted the booking and then the answer never arrived here. A read by our own
 * id says whether it exists, so the link can be repaired rather than the guest
 * being booked twice.
 */
export async function findBookingByReservation(
  mseeReservationId: string,
): Promise<RmsBooking | null> {
  requireSession()
  try {
    const snap = await getDoc(doc(rmsDb(), 'bookings', rmsDocIdFor(mseeReservationId)))
    if (!snap.exists()) return null
    const data = snap.data()
    return {
      id: snap.id,
      reservationId: String(data.reservationId ?? ''),
      guestName: String(data.guestName ?? ''),
      phone: String(data.phone ?? ''),
      origin: String(data.origin ?? ''),
      notes: String(data.notes ?? ''),
      tags: [],
      apartmentId: String(data.apartmentId ?? ''),
      checkIn: String(data.checkIn ?? ''),
      checkOut: String(data.checkOut ?? ''),
      pricePerNight: Number(data.pricePerNight ?? 0),
      days: Number(data.days ?? 0),
      totalPrice: Number(data.totalPrice ?? 0),
      depositAmount: Number(data.depositAmount ?? 0),
      depositPaid: data.depositPaid === true,
      totalPaid: Number(data.totalPaid ?? 0),
      paymentStatus: String(data.paymentStatus ?? ''),
      status: String(data.status ?? ''),
      workspaceId: String(data.workspaceId ?? ''),
      source: data.source ? String(data.source) : undefined,
      mseeReservationId: data.mseeReservationId ? String(data.mseeReservationId) : undefined,
    }
  } catch (error) {
    throw wrap(error)
  }
}
