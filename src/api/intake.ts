/**
 * What the RMS sent, and what we do about it.
 *
 * An intake row is a claim by another system, not a fact about ours. So there
 * are two deliberate steps: matching a row to a client or a person, and then
 * applying it. Receiving something is not the same as acting on it, and a
 * pipeline that conflates them cannot be reviewed.
 *
 * Nothing here invents a match. A row whose reference matches no client stays
 * unmatched and visible, because attaching somebody's turnover to the
 * closest-looking account is worse than leaving a question on the screen.
 */

import { doc, setDoc } from 'firebase/firestore'

import { logAudit } from './audit'
import { addEntry } from './wallet'
import { actor, now, orderBy, readWhere } from './store'
import { getDb } from '@/lib/firebase'
import { matchClient, type IntakeRow } from '@/types/intake'
import type { Client } from '@/types/business'

export const fetchIntake = () =>
  readWhere<IntakeRow>('intake', orderBy('date', 'desc'))

/**
 * Attach rows to the clients they belong to.
 *
 * Runs over everything unmatched each time rather than only over new rows:
 * recording a client's RMS reference today should pick up the figures that
 * arrived last week, and it does.
 *
 * Returns how many found a home, so the screen can say so.
 */
export async function matchRows(rows: IntakeRow[], clients: Client[]): Promise<number> {
  const db = getDb()
  let matched = 0

  for (const row of rows) {
    if (row.clientId || row.kind !== 'client_day') continue

    const clientId = matchClient(row, clients)
    if (!clientId) continue

    await setDoc(
      doc(db, 'intake', row.id),
      { clientId, status: 'matched', updatedAt: now() },
      { merge: true },
    )
    matched += 1
  }

  return matched
}

/**
 * Turn an earning the RMS reported into an entry in somebody's ledger.
 *
 * Written as `pending`, never `paid`. The RMS knows what somebody earned; it
 * does not get to decide that the company has approved it — that stays a
 * decision made here, by a person, for the same reason every other earning
 * does.
 *
 * The row records which entry it produced, so applying it twice is impossible
 * rather than merely unlikely.
 */
export async function applyEarning(
  row: IntakeRow,
  employee: { uid: string; name: string },
): Promise<string> {
  if (row.walletEntryId) return row.walletEntryId

  const entryId = await addEntry({
    employeeUid: employee.uid,
    employeeName: employee.name,
    kind: 'commission',
    amountBaseMinor: row.earning?.baseMinor ?? 0,
    status: 'pending',
    reason: row.note || `${row.source.toUpperCase()} · ${row.date}`,
    saleId: null,
    saleLabel: row.externalClientName,
    bonusAwardId: null,
    goalId: null,
    date: row.date,
    approvedBy: null,
    approvedAt: null,
    paidAt: null,
    createdAt: '',
    createdBy: '',
    createdByName: '',
    updatedAt: '',
  })

  const me = actor()

  await setDoc(
    doc(getDb(), 'intake', row.id),
    {
      status: 'applied',
      employeeUid: employee.uid,
      walletEntryId: entryId,
      appliedAt: now(),
      appliedBy: me.uid,
      updatedAt: now(),
    },
    { merge: true },
  )

  await logAudit({
    action: 'wallet.entry_added',
    targetType: 'wallet',
    targetId: entryId,
    targetLabel: employee.name,
    metadata: {
      from: row.source,
      externalId: row.externalId,
      amount: row.earning?.baseMinor ?? 0,
    },
  })

  return entryId
}

/** Set a row aside without acting on it. It stays readable. */
export async function ignoreRow(row: IntakeRow, note: string): Promise<void> {
  await setDoc(
    doc(getDb(), 'intake', row.id),
    { status: 'ignored', note, updatedAt: now() },
    { merge: true },
  )
}
