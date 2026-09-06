/**
 * The chain that turns a conversation into money: sale → contract → invoice →
 * payment, with an affiliate commission hanging off the end of it.
 *
 * Each link answers a different question, and they are kept apart because
 * merging them is how a business ends up unable to say what it is owed:
 *
 *   Sale      what we expect to win, and how likely it is
 *   Contract  what was agreed, and until when
 *   Invoice   what we have actually asked to be paid
 *   Payment   what has actually arrived
 *
 * A contract of €18,000 with €1,500 invoiced and €0 paid is three completely
 * different numbers, and a system that stores only one of them is guessing.
 */

import type { Money } from './money'

/* ------------------------------------------------------------------ *
 * Sales
 * ------------------------------------------------------------------ */

export const SALE_STAGES = [
  'qualifying',
  'proposal',
  'negotiation',
  'won',
  'lost',
] as const
export type SaleStage = (typeof SALE_STAGES)[number]

/** Stages still in play, for pipeline value and conversion rate. */
export const OPEN_SALE_STAGES: readonly SaleStage[] = ['qualifying', 'proposal', 'negotiation']

/**
 * How likely each stage is to close, used for the weighted pipeline.
 *
 * A default, not a rule: the figure is stored on the sale so it can be
 * overridden per deal, because the salesperson knows things the stage does not.
 */
export const STAGE_PROBABILITY: Record<SaleStage, number> = {
  qualifying: 20,
  proposal: 50,
  negotiation: 75,
  won: 100,
  lost: 0,
}

export interface Sale {
  id: string
  /** What it is called in a conversation: "Hotel ABC — marketing 2027". */
  title: string
  /** A sale starts on a lead and ends on a client. Both may be set. */
  leadId: string | null
  clientId: string | null
  clientName: string
  serviceId: string | null
  serviceName: string
  /** Who owns the deal. Performance and commission both read this. */
  ownerUid: string | null
  ownerName: string
  /** Set when the deal came through the affiliate programme. */
  affiliateId: string | null
  value: Money
  /** Percent, 0–100. Seeded from the stage, then editable. */
  probability: number
  stage: SaleStage
  expectedCloseDate: string | null
  closedDate: string | null
  lostReason: string
  notes: string
  /** Filled in when the won sale was turned into a contract. */
  contractId: string | null
  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Contracts — what was agreed
 * ------------------------------------------------------------------ */

export const CONTRACT_STATUSES = [
  'draft',
  'pending_signature',
  'active',
  'expired',
  'cancelled',
  'renewal',
] as const
export type ContractStatus = (typeof CONTRACT_STATUSES)[number]

export const BILLING_FREQUENCIES = ['one_off', 'monthly', 'quarterly', 'yearly'] as const
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number]

/** Months covered by one billing period, for projecting contract value. */
export const PERIOD_MONTHS: Record<BillingFrequency, number> = {
  one_off: 0,
  monthly: 1,
  quarterly: 3,
  yearly: 12,
}

export interface Contract {
  id: string
  /** Human reference, e.g. MSE-2027-004. Generated, then editable. */
  number: string
  clientId: string
  clientName: string
  serviceId: string | null
  serviceName: string
  projectId: string | null
  saleId: string | null
  /** Per billing period for a recurring contract; the total for a one-off. */
  value: Money
  billingFrequency: BillingFrequency
  /** Days from invoice to due date. */
  paymentTermDays: number
  startDate: string
  endDate: string | null
  status: ContractStatus
  /** Set when the contract should be revisited before it lapses. */
  renewalDate: string | null
  responsibleUid: string | null
  responsibleName: string
  notes: string
  /** Link to the signed document, until file storage is available. */
  documentUrl: string
  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Invoices and payments — what was asked for, and what arrived
 * ------------------------------------------------------------------ */

export const INVOICE_STATUSES = ['draft', 'sent', 'part_paid', 'paid', 'cancelled'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export interface Invoice {
  id: string
  number: string
  clientId: string
  clientName: string
  contractId: string | null
  projectId: string | null
  serviceId: string | null
  saleId: string | null
  description: string
  amount: Money
  /** Sum of the payments recorded against it. Derived, never typed in. */
  paidBaseMinor: number
  issueDate: string
  dueDate: string
  status: InvoiceStatus
  notes: string
  createdAt: string
  createdBy: string
  updatedAt: string
}

/**
 * Money that actually moved.
 *
 * `type` exists because not every arriving euro is revenue: a refund leaves,
 * a transfer moves between our own accounts, and counting either as income
 * would overstate what the company earned.
 */
export const TRANSACTION_TYPES = [
  'revenue',
  'other_income',
  'expense',
  'refund',
  'transfer',
] as const
export type TransactionType = (typeof TRANSACTION_TYPES)[number]

/** Types that count towards income, used everywhere a total is computed. */
export const INCOME_TYPES: readonly TransactionType[] = ['revenue', 'other_income']

export interface Payment {
  id: string
  invoiceId: string | null
  clientId: string | null
  clientName: string
  contractId: string | null
  projectId: string | null
  serviceId: string | null
  saleId: string | null
  /** Who gets credited for it in performance and commission. */
  employeeUid: string | null
  affiliateId: string | null
  type: TransactionType
  description: string
  amount: Money
  date: string
  method: string
  notes: string
  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Affiliate programme
 * ------------------------------------------------------------------ */

export const AFFILIATE_TYPES = ['employee', 'partner'] as const
export type AffiliateType = (typeof AFFILIATE_TYPES)[number]

export const COMMISSION_MODELS = ['percentage', 'fixed'] as const
export type CommissionModel = (typeof COMMISSION_MODELS)[number]

/**
 * A commission rule.
 *
 * `serviceId` narrows a rule to one service; the rule with no service is the
 * fallback. Specific beats general, which is the only precedence anybody
 * expects and the only one worth implementing.
 */
export interface CommissionRule {
  id: string
  serviceId: string | null
  serviceName: string
  model: CommissionModel
  /** Percent when the model is percentage. */
  percent: number
  /** Minor units in the base currency when the model is fixed. */
  fixedBaseMinor: number
  /** Applies to every payment on the contract, not only the first. */
  recurring: boolean
  note: string
}

export interface Affiliate {
  id: string
  /** Short public code that appears in the referral link. */
  code: string
  name: string
  type: AffiliateType
  /** Set when the affiliate is an employee, so their record can be linked. */
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
 * A click is not money. Commission becomes real only once the customer has
 * actually paid, which is why `pending` exists between earning and approving:
 * approving is a decision a person makes, and the audit log records it.
 */
export const COMMISSION_STATUSES = ['pending', 'approved', 'paid', 'rejected'] as const
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number]

export interface Commission {
  id: string
  affiliateId: string
  affiliateName: string
  /** The payment that earned it. One commission per payment, per affiliate. */
  paymentId: string
  clientId: string | null
  clientName: string
  serviceId: string | null
  saleId: string | null
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

/** Apply the affiliate's rules to a payment. Specific service wins. */
export function commissionFromRules(
  affiliate: Affiliate,
  serviceId: string | null,
  amountBaseMinor: number,
): { amountBaseMinor: number; description: string } | null {
  const rules = affiliate.rules ?? []
  const rule = rules.find((r) => r.serviceId && r.serviceId === serviceId) ?? rules.find((r) => !r.serviceId)
  if (!rule) return null

  if (rule.model === 'fixed') {
    return { amountBaseMinor: rule.fixedBaseMinor, description: rule.note || 'fixed' }
  }

  return {
    amountBaseMinor: Math.round((amountBaseMinor * rule.percent) / 100),
    description: `${rule.percent}%`,
  }
}
