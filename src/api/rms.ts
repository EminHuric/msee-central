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
 * IT ONLY READS, AND THAT IS THE WHOLE DESIGN. Bookings are taken in the RMS,
 * where the phone is answered, and marked there as MsEe's with one tick. Nothing
 * in MsEe Central writes into that database.
 *
 * WHY THAT IS BETTER THAN THE WRITE PATH IT REPLACED. Creating bookings from here
 * meant the RMS had to grant an outside account permission to write into other
 * people's calendars — a rules change to deploy, two flags to switch on, and a
 * second place a booking could come from. Reading needs none of it: the RMS's
 * existing rules already let an administrator read every account, so this works
 * against the database exactly as it stands. One place takes bookings, one place
 * counts them.
 */

import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'

import { rmsDb, rmsUser } from '@/lib/rms'
import type { RmsAccount, RmsApartment, RmsBooking } from '@/types/staybrain'

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
    super(`The RMS refused the read: ${describe(cause)}`)
    this.name = 'RmsRefused'
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
 * `permission-denied` is the one worth separating: it means the RMS's rules said
 * no, which almost always means the connected account is not an administrator
 * there — a thing somebody can fix, not an outage.
 */
function wrap(error: unknown): Error {
  const code = (error as { code?: string }).code ?? ''
  if (code === 'permission-denied') return new RmsRefused(error)
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
 * Every account on the RMS platform.
 *
 * Read once, when a property is linked to the account it belongs to. This is the
 * same list the RMS's own admin screen shows, read with the same permission — so
 * it needs nothing switched on anywhere.
 */
export async function fetchRmsAccounts(): Promise<RmsAccount[]> {
  requireSession()
  try {
    const snap = await getDocs(collection(rmsDb(), 'users'))
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
          mseeCommissionPercent:
            data.mseeCommissionPercent != null ? Number(data.mseeCommissionPercent) : undefined,
          mseeCommissionAmount:
            data.mseeCommissionAmount != null ? Number(data.mseeCommissionAmount) : undefined,
        }
      })
      .sort((a, b) => b.checkIn.localeCompare(a.checkIn))
  } catch (error) {
    throw wrap(error)
  }
}
