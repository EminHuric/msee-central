/**
 * The employee earnings ledger.
 *
 * Append-only by design — see the note in `@/types/wallet`. Nothing here
 * updates an amount, and the rules refuse it independently: a wrong entry is
 * corrected by writing a correcting one, so the record of what the company
 * believed it owed survives being wrong.
 *
 * The one field that does change is `status`, as an entry moves from proposed
 * to approved to paid. That is not a rewrite of history; it is the history.
 */

import { logAudit } from './audit'
import { notify } from './notifications'
import { actor, newId, now, orderBy, readWhere, today, where, write } from './store'
import { getDb } from '@/lib/firebase'
import { doc, setDoc } from 'firebase/firestore'
import {
  balanceFrom,
  type WalletBalance,
  type WalletEntry,
  type WalletStatus,
} from '@/types/wallet'

/**
 * One person's entries.
 *
 * The rules allow this for the person themselves, or for somebody holding
 * `wallet.view_all`. Asking for anybody else's returns nothing rather than
 * failing, because a refused read is a legitimate answer.
 */
export function fetchWallet(uid: string): Promise<WalletEntry[]> {
  return readWhere<WalletEntry>('walletEntries', where('employeeUid', '==', uid))
}

/** Everybody's, for the CEO's view of what the company owes. */
export function fetchAllWallets(): Promise<WalletEntry[]> {
  return readWhere<WalletEntry>('walletEntries', orderBy('employeeUid'))
}

export async function balanceOfWallet(uid: string): Promise<WalletBalance> {
  return balanceFrom(await fetchWallet(uid))
}

/**
 * Add an entry to somebody's ledger.
 *
 * Never for yourself. The rules refuse `employeeUid == me()` outright, so this
 * is a courtesy check rather than the defence — but it is the check that gives
 * the person a sentence instead of a permission error.
 */
export class SelfCreditError extends Error {
  constructor() {
    super('Nobody adds to their own ledger.')
    this.name = 'SelfCreditError'
  }
}

export async function addEntry(input: Omit<WalletEntry, 'id'>): Promise<string> {
  const me = actor()
  if (input.employeeUid === me.uid) throw new SelfCreditError()

  const id = newId()

  await write('walletEntries', {
    ...input,
    id,
    createdByName: me.name,
    approvedBy: input.status === 'approved' || input.status === 'paid' ? me.uid : null,
    approvedAt: input.status === 'approved' || input.status === 'paid' ? now() : null,
    paidAt: input.status === 'paid' ? now() : null,
  } as WalletEntry)

  await logAudit({
    action: 'wallet.entry_added',
    targetType: 'wallet',
    targetId: id,
    targetLabel: input.employeeName,
    metadata: {
      kind: input.kind,
      amount: input.amountBaseMinor,
      status: input.status,
      reason: input.reason,
    },
  })

  /* Money is worth telling somebody about. */
  await notify(input.employeeUid, {
    kind: 'wallet_entry',
    priority: 'important',
    title: input.reason || input.kind,
    body: '',
    link: '/earnings',
  }).catch(() => {})

  return id
}

/**
 * Move an entry along: proposed → approved → paid.
 *
 * The amount is deliberately not a parameter. Changing what somebody was told
 * they had earned, after they were told, is the thing this ledger exists to
 * prevent; a different figure is a second entry.
 */
export async function setEntryStatus(entry: WalletEntry, status: WalletStatus): Promise<void> {
  const me = actor()
  const stamp = now()

  await setDoc(
    doc(getDb(), 'walletEntries', entry.id),
    {
      status,
      approvedBy: status === 'approved' || status === 'paid' ? me.uid : entry.approvedBy,
      approvedAt: status === 'approved' || status === 'paid' ? stamp : entry.approvedAt,
      paidAt: status === 'paid' ? stamp : entry.paidAt,
      updatedAt: stamp,
    },
    { merge: true },
  )

  await logAudit({
    action: 'wallet.status_changed',
    targetType: 'wallet',
    targetId: entry.id,
    targetLabel: entry.employeeName,
    metadata: { from: entry.status, to: status, amount: entry.amountBaseMinor },
  })

  await notify(entry.employeeUid, {
    kind: 'wallet_entry',
    priority: status === 'paid' ? 'important' : 'normal',
    title: entry.reason || entry.kind,
    body: '',
    link: '/earnings',
  }).catch(() => {})
}

/**
 * Record a payout: the company has handed over what it owed.
 *
 * Written as a negative entry rather than by marking the positive ones paid,
 * because those are two different facts. "You earned €100 in March" stays
 * true after you are paid; the payout is a separate event with its own date,
 * and the ledger should be able to show both.
 */
export async function recordPayout(
  employee: { uid: string; name: string },
  amountBaseMinor: number,
  reason: string,
): Promise<string> {
  return addEntry({
    employeeUid: employee.uid,
    employeeName: employee.name,
    kind: 'payout',
    amountBaseMinor: -Math.abs(amountBaseMinor),
    status: 'paid',
    reason,
    saleId: null,
    saleLabel: '',
    bonusAwardId: null,
    goalId: null,
    date: today(),
    approvedBy: null,
    approvedAt: null,
    paidAt: null,
    createdAt: '',
    createdBy: '',
    createdByName: '',
    updatedAt: '',
  })
}
