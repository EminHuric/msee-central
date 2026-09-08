/**
 * What was sold, what was paid, and what that earns anybody.
 *
 * The chain is short on purpose:
 *
 *   Service      what we sell, and how it is normally paid for
 *   Sale         what somebody actually bought, at what price
 *   Transaction  money that actually moved, in either direction
 *   Commission   what a sale earns an affiliate, once the money arrives
 *
 * There used to be contracts and invoices between the sale and the money. They
 * are gone. A contract said what was agreed — which is the sale — and an
 * invoice said what was asked for, which for an agency with no VAT was the
 * sale again under another name. Three records for one fact is three chances
 * to disagree about it.
 *
 * What survived from them is the part that was load-bearing: a sale carries a
 * payment structure, so "agreed 1,500, paid 500, 1,000 outstanding" is
 * answerable without inventing a second document.
 */

import type { CustomValues, SoftDeletable } from './records'
import type { Money } from './money'

/* ------------------------------------------------------------------ *
 * Payment structure
 *
 * Copied onto the sale from the service at the moment of sale, then editable.
 * Copied rather than referenced because changing a service's price next year
 * must not silently rewrite what last year's customer agreed to.
 * ------------------------------------------------------------------ */

export const PAYMENT_MODELS = ['one_off', 'advance_remainder', 'instalments', 'custom'] as const
export type PaymentModel = (typeof PAYMENT_MODELS)[number]

export interface PaymentStructure {
  model: PaymentModel
  /** Minor units in the base currency. 0 means no advance is required. */
  advanceBaseMinor: number
  /** Number of instalments after any advance. 0 for a single payment. */
  instalmentCount: number
  /** Days from the sale to the first amount being due. */
  dueInDays: number
  note: string
}

export const NO_STRUCTURE: PaymentStructure = {
  model: 'one_off',
  advanceBaseMinor: 0,
  instalmentCount: 0,
  dueInDays: 15,
  note: '',
}

/**
 * Where a sale stands financially.
 *
 * Every figure is derived from the sale's value and the transactions recorded
 * against it. Nothing here is stored, so a payment recorded anywhere updates
 * every screen that shows it.
 */
export interface SaleBalance {
  valueBaseMinor: number
  paidBaseMinor: number
  remainingBaseMinor: number
  /** True when an advance was required and has not been covered yet. */
  advanceDue: boolean
  advanceBaseMinor: number
  status: 'unpaid' | 'advance_due' | 'part_paid' | 'paid' | 'overpaid'
  /** What each remaining instalment comes to, when there are instalments. */
  instalmentBaseMinor: number
}

/* ------------------------------------------------------------------ *
 * Sales — the historical record of everything sold
 * ------------------------------------------------------------------ */

/** How the customer reached us. */
export const SALE_CHANNELS = [
  'referral',
  'affiliate',
  'inbound',
  'outbound',
  'repeat',
  'social',
  'event',
  'other',
] as const
export type SaleChannel = (typeof SALE_CHANNELS)[number]

/** How the conversation actually happened. */
export const CONTACT_CHANNELS = [
  'in_person',
  'phone',
  'whatsapp',
  'email',
  'instagram',
  'video_call',
  'other',
] as const
export type ContactChannel = (typeof CONTACT_CHANNELS)[number]

/**
 * What we learned from a sale.
 *
 * This is the part of the record worth more in two years than the amount is.
 * Free text on purpose: the useful thing about "he only answers WhatsApp after
 * six" is precisely that nobody could have designed a field for it.
 */
export interface SaleAnalysis {
  howAcquired: string
  whatWorked: string
  whatDidNot: string
  clientPreferences: string
  notes: string
}

export const EMPTY_ANALYSIS: SaleAnalysis = {
  howAcquired: '',
  whatWorked: '',
  whatDidNot: '',
  clientPreferences: '',
  notes: '',
}

export interface Sale extends SoftDeletable {
  id: string
  /** What it is called in conversation: "Hotel ABC — marketing 2027". */
  title: string
  clientId: string
  clientName: string
  serviceId: string | null
  serviceName: string
  /** A sale may belong to a larger project; most do not. */
  projectId: string | null
  /** Kept when the sale came out of a lead, so the trail survives. */
  leadId: string | null
  /** Who closed it. Performance and earnings both read this. */
  ownerUid: string | null
  ownerName: string
  /** Set when an affiliate brought it in. */
  affiliateId: string | null
  affiliateName: string

  value: Money
  payment: PaymentStructure
  saleDate: string
  channel: SaleChannel
  contactChannel: ContactChannel
  analysis: SaleAnalysis
  notes: string
  custom: CustomValues

  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Transactions — money that moved
 * ------------------------------------------------------------------ */

/**
 * One collection for every financial record, distinguished by type.
 *
 * `income` is money against a sale; `other_income` arrived for some other
 * reason; `refund` leaves; `transfer` moves between our own accounts. Counting
 * any of the last three as revenue would overstate what the company earned,
 * which is why the type is required rather than inferred from the sign.
 */
export const TRANSACTION_TYPES = [
  'income',
  'other_income',
  'expense',
  'refund',
  'transfer',
] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

/** Types that add to what the company earned. */
export const INCOME_TYPES: readonly TransactionType[] = ['income', 'other_income']

/** Types that take money out. A transfer is neither. */
export const OUTGOING_TYPES: readonly TransactionType[] = ['expense', 'refund']

export const TRANSACTION_CATEGORIES = [
  'service_payment',
  'advance',
  'instalment',
  'tools',
  'subcontractor',
  'advertising',
  'hosting',
  'salary',
  'bonus',
  'commission',
  'office',
  'tax',
  'other',
] as const
export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number]

export const PAYMENT_STATES = ['paid', 'pending', 'overdue'] as const
export type PaymentState = (typeof PAYMENT_STATES)[number]

export interface Transaction extends SoftDeletable {
  id: string
  type: TransactionType
  category: TransactionCategory
  description: string
  amount: Money
  date: string
  /** When it is expected, for anything not yet paid. */
  dueDate: string | null
  status: PaymentState
  method: string

  clientId: string | null
  clientName: string
  serviceId: string | null
  serviceName: string
  projectId: string | null
  saleId: string | null
  /** Who to credit. Earnings and performance both read this. */
  employeeUid: string | null
  employeeName: string
  affiliateId: string | null

  notes: string

  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Affiliates
 * ------------------------------------------------------------------ */

export const AFFILIATE_TYPES = ['employee', 'partner'] as const
export type AffiliateType = (typeof AFFILIATE_TYPES)[number]

export const COMMISSION_MODELS = ['percentage', 'fixed'] as const
export type CommissionModel = (typeof COMMISSION_MODELS)[number]

/**
 * A commission rule.
 *
 * A rule naming a service beats the one that names none. That is the only
 * precedence anybody expects, and the only one worth implementing.
 */
export interface CommissionRule {
  id: string
  serviceId: string | null
  serviceName: string
  model: CommissionModel
  percent: number
  fixedBaseMinor: number
  /** Earns on every payment against the sale, not only the first. */
  recurring: boolean
  /**
   * Whether the customer must have paid in full before the commission counts
   * as earned. Off means the advance is enough.
   */
  requiresFullPayment: boolean
  note: string
}

export interface Affiliate extends SoftDeletable {
  id: string
  name: string
  type: AffiliateType
  /** Set when the affiliate has a login — an employee, or an outside partner. */
  employeeUid: string | null
  email: string
  phone: string
  status: 'active' | 'paused' | 'ended'
  rules: CommissionRule[]
  notes: string
  createdAt: string
  createdBy: string
  updatedAt: string
}

/**
 * Commission lifecycle.
 *
 * `pending` sits between earning and approving because approving is a decision
 * a person makes. An affiliate can submit a lead and watch what happens to it;
 * nothing they do moves a commission along.
 */
export const COMMISSION_STATUSES = ['pending', 'approved', 'paid', 'rejected'] as const
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number]

export interface Commission {
  id: string
  affiliateId: string
  affiliateName: string
  /** Denormalised so an affiliate can read their own row without a join. */
  affiliateEmployeeUid: string
  saleId: string
  saleTitle: string
  clientId: string | null
  clientName: string
  serviceId: string | null
  /** What the rule was applied to, kept so the arithmetic can be re-checked. */
  baseAmountBaseMinor: number
  ruleDescription: string
  amountBaseMinor: number
  status: CommissionStatus
  earnedDate: string
  approvedBy: string | null
  approvedAt: string | null
  paidAt: string | null
  note: string
  createdAt: string
  createdBy: string
  updatedAt: string
}

/** Apply an affiliate's rules to an amount. A named service wins. */
export function commissionFromRules(
  affiliate: Affiliate,
  serviceId: string | null,
  amountBaseMinor: number,
): { amountBaseMinor: number; description: string; rule: CommissionRule } | null {
  const rules = affiliate.rules ?? []
  const rule =
    rules.find((r) => r.serviceId && r.serviceId === serviceId) ?? rules.find((r) => !r.serviceId)
  if (!rule) return null

  if (rule.model === 'fixed') {
    return { amountBaseMinor: rule.fixedBaseMinor, description: rule.note || 'fixed', rule }
  }

  return {
    amountBaseMinor: Math.round((amountBaseMinor * rule.percent) / 100),
    description: `${rule.percent}%`,
    rule,
  }
}

/* ------------------------------------------------------------------ *
 * Derivations
 * ------------------------------------------------------------------ */

/**
 * Where one sale stands.
 *
 * Recomputed from the sale and its transactions every time it is asked for. A
 * stored balance is a balance that can be wrong, and a wrong balance is worse
 * than none because somebody will act on it.
 */
export function balanceOf(sale: Sale, transactions: Transaction[]): SaleBalance {
  const paid = transactions
    .filter((tx) => tx.saleId === sale.id && !tx.deletedAt && tx.status === 'paid')
    .reduce((n, tx) => {
      if (INCOME_TYPES.includes(tx.type)) return n + tx.amount.baseMinor
      if (tx.type === 'refund') return n - tx.amount.baseMinor
      return n
    }, 0)

  const value = sale.value.baseMinor
  const advance = sale.payment?.advanceBaseMinor ?? 0
  const remaining = value - paid

  const status: SaleBalance['status'] =
    paid <= 0
      ? advance > 0
        ? 'advance_due'
        : 'unpaid'
      : remaining < 0
        ? 'overpaid'
        : remaining === 0
          ? 'paid'
          : advance > 0 && paid < advance
            ? 'advance_due'
            : 'part_paid'

  const count = sale.payment?.instalmentCount ?? 0

  return {
    valueBaseMinor: value,
    paidBaseMinor: paid,
    remainingBaseMinor: Math.max(0, remaining),
    advanceDue: advance > 0 && paid < advance,
    advanceBaseMinor: advance,
    status,
    instalmentBaseMinor: count > 0 ? Math.round(Math.max(0, value - advance) / count) : 0,
  }
}
