/**
 * What the company owes a person, and why.
 *
 * THE ONE RULE: the balance is never stored. It is the sum of the entries
 * below, every one of which says what happened, when, and who decided it.
 *
 * The alternative — a `balance` field somebody adds to and subtracts from — is
 * the reason payroll disputes are unanswerable. When the number is wrong there
 * is nothing to check it against, and when somebody asks "why do I have €50?"
 * the honest answer is "because the field says so". Here the answer is three
 * lines and their dates.
 *
 * So entries are append-only. A mistake is corrected by writing a correcting
 * entry, not by editing the wrong one — the history of what the company
 * believed it owed is itself worth keeping.
 *
 * This is NOT company finance. Finance tracks money moving in and out of the
 * business; this tracks what an individual has earned from it. They are
 * connected — a payout is both — but they answer different questions and a
 * single ledger for both cannot answer either well.
 */

import type { Money } from './money'

/**
 * Why an entry exists.
 *
 * `payout` is the only one that is normally negative: it records money leaving
 * the ledger because it reached the person.
 */
export const WALLET_KINDS = [
  'commission',
  'bonus',
  'adjustment',
  'deduction',
  'payout',
] as const
export type WalletKind = (typeof WALLET_KINDS)[number]

/**
 * How far along an entry is.
 *
 * `earned` and `paid` are deliberately different states, because they are
 * different facts: a commission earned in March and paid in May is a debt for
 * two months, and a ledger that cannot express that cannot tell the company
 * what it owes.
 */
export const WALLET_STATUSES = ['pending', 'approved', 'paid', 'cancelled'] as const
export type WalletStatus = (typeof WALLET_STATUSES)[number]

/** Statuses that count towards what is still owed. */
export const OWED: readonly WalletStatus[] = ['pending', 'approved']

export interface WalletEntry {
  id: string
  employeeUid: string
  employeeName: string

  kind: WalletKind
  /**
   * Signed, in base-currency minor units. Positive is owed to the person;
   * negative has left the ledger.
   *
   * Signed rather than a separate direction flag so the balance is a sum and
   * cannot be got wrong by reading the flag the wrong way round.
   */
  amountBaseMinor: number

  status: WalletStatus
  /** In the words of whoever created it. Shown to the employee. */
  reason: string

  /* What produced it, when something did. */
  saleId: string | null
  saleLabel: string
  bonusAwardId: string | null
  goalId: string | null

  /** The date it belongs to, which is not always the date it was typed. */
  date: string

  approvedBy: string | null
  approvedAt: string | null
  paidAt: string | null

  createdAt: string
  createdBy: string
  createdByName: string
  updatedAt: string
}

export interface WalletBalance {
  /** Everything positive, whatever its status: the gross of what was earned. */
  earnedBaseMinor: number
  pendingBaseMinor: number
  approvedBaseMinor: number
  paidBaseMinor: number
  /**
   * Approved and not yet paid out — what the company owes today.
   *
   * Deliberately not "earned minus paid": a pending entry is a proposal, and
   * counting proposals as debt would overstate what is owed.
   */
  availableBaseMinor: number
  entries: number
}

const EMPTY: WalletBalance = {
  earnedBaseMinor: 0,
  pendingBaseMinor: 0,
  approvedBaseMinor: 0,
  paidBaseMinor: 0,
  availableBaseMinor: 0,
  entries: 0,
}

/**
 * The balance, worked out from the entries.
 *
 * Every figure on the earnings screen comes through here, so there is one
 * definition of each and no way for two screens to disagree.
 */
export function balanceFrom(entries: WalletEntry[]): WalletBalance {
  const live = entries.filter((e) => e.status !== 'cancelled')
  if (live.length === 0) return { ...EMPTY }

  let earned = 0
  let pending = 0
  let approved = 0
  let paid = 0

  for (const entry of live) {
    const amount = entry.amountBaseMinor

    if (amount > 0) earned += amount

    if (entry.status === 'pending') pending += amount
    if (entry.status === 'approved') approved += amount

    /*
     * Paid means it reached them. A payout is stored negative, so its
     * magnitude is what was handed over.
     */
    if (entry.status === 'paid') paid += Math.abs(amount)
  }

  return {
    earnedBaseMinor: earned,
    pendingBaseMinor: pending,
    approvedBaseMinor: approved,
    paidBaseMinor: paid,
    availableBaseMinor: approved,
    entries: live.length,
  }
}

/** A blank entry, for the form that creates one. */
export function blankEntry(employeeUid: string, employeeName: string): WalletEntry {
  return {
    id: '',
    employeeUid,
    employeeName,
    kind: 'bonus',
    amountBaseMinor: 0,
    status: 'approved',
    reason: '',
    saleId: null,
    saleLabel: '',
    bonusAwardId: null,
    goalId: null,
    date: new Date().toISOString().slice(0, 10),
    approvedBy: null,
    approvedAt: null,
    paidAt: null,
    createdAt: '',
    createdBy: '',
    createdByName: '',
    updatedAt: '',
  }
}

/** Whether a kind is normally money leaving the ledger. */
export const isOutgoing = (kind: WalletKind) => kind === 'payout' || kind === 'deduction'

export type { Money }
