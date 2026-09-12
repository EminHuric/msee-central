/**
 * Reservations MsEe brought.
 *
 * Entered here, collected by the RMS. Nothing in this module reaches out to the
 * RMS — see the note in `@/types/reservations` for why that direction belongs to
 * the RMS rather than to us.
 */

import { logAudit } from './audit'
import { logActivity, remove } from './records'
import { actor, readAll, readWhere, where, write } from './store'
import type { Reservation } from '@/types/reservations'

export const fetchReservations = () =>
  readAll<Reservation>('reservations', 'checkIn', 'desc')

/**
 * One client's bookings, newest stay first.
 *
 * Sorted in memory deliberately. `where('clientId')` with `orderBy('checkIn')`
 * is two fields, which Firestore will not serve without a composite index, and
 * a query it will not serve comes back through the reader as an empty list —
 * indistinguishable from a client who has no bookings. A panel that silently
 * shows nothing is worse than one that needs a sort.
 */
export const fetchReservationsFor = async (clientId: string): Promise<Reservation[]> => {
  const rows = await readWhere<Reservation>('reservations', where('clientId', '==', clientId))
  return rows.sort((a, b) => b.checkIn.localeCompare(a.checkIn))
}

/**
 * Record a booking we brought.
 *
 * The owner defaults to whoever is entering it, because that is nearly always
 * true and because their performance figures read it. It stays editable for the
 * case where somebody enters a colleague's booking.
 *
 * A new reservation starts `pending`: ours, and not yet collected. Editing one
 * the RMS has already taken deliberately does NOT reset that — the RMS has its
 * own copy by then, and silently queueing it again would produce a duplicate
 * booking at the property. A changed booking the RMS already holds is a
 * conversation, not a retry.
 */
export async function saveReservation(input: Reservation): Promise<string> {
  const me = actor()
  /*
   * `createdAt`, not the id — the same signal `write()` uses.
   *
   * StayBrain picks the id itself before writing, because the id is what makes
   * the write to the RMS idempotent. Judging newness by the id would have called
   * every StayBrain booking an update: the wrong audit line, and `syncState`
   * taken from the input instead of being forced to `pending`.
   */
  const isNew = !input.id || !input.createdAt

  const id = await write('reservations', {
    ...input,
    ownerUid: input.ownerUid ?? me.uid,
    ownerName: input.ownerName || me.name,
    syncState: isNew ? 'pending' : input.syncState,
  })

  await logAudit({
    action: isNew ? 'reservation.created' : 'reservation.updated',
    targetType: 'client',
    targetId: input.clientId,
    targetLabel: input.clientName,
    metadata: {
      reservationId: id,
      guest: input.guestName,
      checkIn: input.checkIn,
      nights: input.nights,
      value: input.value.baseMinor,
      status: input.status,
    },
  })

  await logActivity({
    entity: 'clients',
    entityId: input.clientId,
    entityLabel: input.clientName,
    kind: isNew ? 'created' : 'updated',
    summary: `${input.guestName} · ${input.checkIn}`,
    detail: input.source,
  })

  return id
}

export const deleteReservation = (row: Reservation) =>
  remove('reservations', row.id, `${row.guestName} · ${row.checkIn}`)

/**
 * Put a refused reservation back in the queue.
 *
 * Deliberately manual. A failure means the RMS said no — a date clash, a rate it
 * will not accept — and retrying on a timer would either loop for ever or
 * succeed after somebody fixed it without them knowing which. Somebody looks,
 * changes what was wrong, and asks again.
 */
export async function retrySync(row: Reservation): Promise<void> {
  await write('reservations', {
    ...row,
    syncState: 'pending',
    syncError: '',
  })

  await logAudit({
    action: 'reservation.updated',
    targetType: 'client',
    targetId: row.clientId,
    targetLabel: row.clientName,
    metadata: { reservationId: row.id, retried: true },
  })
}

/**
 * Mark a reservation as living only here.
 *
 * For a booking the RMS will never hold — one taken before the client was on the
 * RMS, or for a property it does not manage. It still counts towards what we
 * brought; it just stops waiting to be collected.
 */
export async function keepLocal(row: Reservation): Promise<void> {
  await write('reservations', { ...row, syncState: 'local_only', syncError: '' })
}
