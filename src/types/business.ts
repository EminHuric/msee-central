/**
 * The business side: clients, projects, services and the money either way.
 *
 * Deliberately one connected set rather than separate modules for Sales,
 * Projects and Finance. The questions an agency actually asks cross all three
 * — "did this project make money", "what comes in every month without new
 * work", "which client is worth keeping" — and splitting them early turns
 * every one of those into a join.
 */

import type { Money } from './money'

/* ------------------------------------------------------------------ *
 * Clients
 * ------------------------------------------------------------------ */

export const CLIENT_STATUSES = ['prospect', 'active', 'paused', 'former'] as const
export type ClientStatus = (typeof CLIENT_STATUSES)[number]

export interface Client {
  id: string
  name: string
  /** The person you actually talk to, when the client is a company. */
  contactName: string
  email: string
  phone: string
  city: string
  country: string
  website: string
  status: ClientStatus
  /** Archived clients drop out of every list but keep their whole history. */
  archived: boolean
  notes: string

  /** Data URI, resized in the browser like an employee photo. */
  logoUrl: string | null

  /* The people behind the company. */
  ownerName: string
  managerName: string
  instagram: string
  facebook: string
  address: string
  otherContact: string

  /* Terms. */
  paymentTerm: PaymentTerm
  agreedAmount: Money | null
  paymentDueDays: number | null
  nextChargeDate: string | null
  paymentNote: string

  referral: Referral
  customFields: CustomField[]

  clientSince: string | null
  /** Reserved for the StayBrain link. Unused until that integration lands. */
  externalClientId: string | null
  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Everything that hangs off one client
 *
 * Stored as subcollections of clients/{clientId} rather than as top-level
 * collections with a clientId field. Two reasons, and both matter more than
 * the slight extra nesting:
 *
 *   - a security rule can say "this belongs to a client" by its path, without
 *     reading the document to find out;
 *   - opening a client reads one subtree instead of six filtered queries.
 * ------------------------------------------------------------------ */

/** How a client pays. Drives the instalment plan and the next-due figure. */
export const PAYMENT_TERMS = [
  'one_off',
  'monthly',
  'yearly',
  'instalments',
  'per_project',
  'per_result',
  'custom',
] as const
export type PaymentTerm = (typeof PAYMENT_TERMS)[number]

export const PAYMENT_STATUSES = ['unpaid', 'paid', 'waiting'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

/**
 * One thing done for a client: a campaign, a website, an extra design.
 *
 * The heart of the dossier. Profit is stored rather than computed at read
 * time so a total can be summed by the database, and it is recomputed on
 * every save — revenue minus cost, never entered by hand.
 */
export interface WorkItem {
  id: string
  clientId: string
  date: string
  title: string
  serviceId: string | null
  serviceName: string
  cost: Money
  revenue: Money
  /** revenue.baseMinor - cost.baseMinor. Derived, never typed in. */
  profitBaseMinor: number
  dueDate: string | null
  paymentStatus: PaymentStatus
  paidDate: string | null
  note: string
  createdAt: string
  createdBy: string
  updatedAt: string
}

/** A service this particular client uses, with their agreed terms. */
export interface ClientService {
  id: string
  clientId: string
  name: string
  description: string
  price: Money
  paymentTerm: PaymentTerm
  startDate: string | null
  endDate: string | null
  status: 'active' | 'paused' | 'ended'
  note: string
  createdAt: string
  updatedAt: string
}

/** One payment in a plan. */
export interface Instalment {
  id: string
  clientId: string
  /** 1 of 4, 2 of 4 — kept explicit so the order survives a deletion. */
  sequence: number
  total: number
  amount: Money
  dueDate: string
  status: PaymentStatus
  paidDate: string | null
  note: string
  createdAt: string
  updatedAt: string
}

/** A discount or special arrangement, kept as history rather than overwritten. */
export interface SpecialOffer {
  id: string
  clientId: string
  title: string
  regularPrice: Money
  agreedPrice: Money
  /** regular - agreed, in base minor units. */
  discountBaseMinor: number
  validUntil: string | null
  note: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export const ACTIVITY_TYPES = [
  'call',
  'meeting',
  'email',
  'message',
  'offer',
  'report',
  'other',
] as const
export type ActivityType = (typeof ACTIVITY_TYPES)[number]

/** One touchpoint. The timeline of the relationship. */
export interface ClientActivity {
  id: string
  clientId: string
  date: string
  type: ActivityType
  title: string
  detail: string
  createdAt: string
  createdBy: string
  createdByName: string
}

/** Internal note. Visible to the team, never to the client. */
export interface ClientNote {
  id: string
  clientId: string
  content: string
  pinned: boolean
  createdAt: string
  createdBy: string
  createdByName: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Custom fields
 *
 * Stored on the client document as a list rather than as loose keys, so a
 * field can be renamed or removed without a migration and two clients can
 * carry entirely different ones.
 * ------------------------------------------------------------------ */

export const CUSTOM_FIELD_TYPES = ['text', 'number', 'date', 'boolean', 'choice', 'money'] as const
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

export interface CustomField {
  id: string
  label: string
  type: CustomFieldType
  value: string
  /** Only for `choice`. */
  options: string[]
}

/* ------------------------------------------------------------------ *
 * Who brought the client in
 * ------------------------------------------------------------------ */

export const CLIENT_SOURCES = ['direct', 'referral', 'other'] as const
export type ClientSource = (typeof CLIENT_SOURCES)[number]

/**
 * The referral arrangement.
 *
 * Commission is computed from the work recorded against the client, not typed
 * in, so it cannot drift from what was actually earned. `fixedAmount` overrides
 * the percentage when it is set, because some arrangements are a flat fee.
 */
export interface Referral {
  source: ClientSource
  /** Free text: this may be somebody outside the company. */
  referrerName: string
  /** Set when the referrer is an employee, so it can link to their profile. */
  referrerUid: string | null
  percent: number
  fixedAmountMinor: number | null
  /** What the percentage applies to. */
  basis: 'revenue' | 'profit'
  status: PaymentStatus
  note: string
}

export const EMPTY_REFERRAL: Referral = {
  source: 'direct',
  referrerName: '',
  referrerUid: null,
  percent: 0,
  fixedAmountMinor: null,
  basis: 'revenue',
  status: 'unpaid',
  note: '',
}

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

/**
 * How a project is paid for.
 *
 * The distinction matters more than it looks: one-off work is revenue that
 * happens once, monthly work is revenue that keeps arriving. An agency lives
 * on the second kind, and mixing them into a single "value" hides how much of
 * the business is actually stable.
 */
export const BILLING_TYPES = ['one_off', 'monthly'] as const
export type BillingType = (typeof BILLING_TYPES)[number]

export const PROJECT_STATUSES = [
  'draft',
  'active',
  'on_hold',
  'completed',
  'cancelled',
] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export interface Project {
  id: string
  clientId: string
  name: string
  description: string
  billing: BillingType
  /** Total for one-off work; the monthly figure for a retainer. */
  value: Money
  status: ProjectStatus
  startDate: string | null
  endDate: string | null
  /** Which employee runs it. */
  ownerUid: string | null
  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Services — the price list
 * ------------------------------------------------------------------ */

export interface Service {
  id: string
  name: string
  description: string
  defaultPrice: Money
  /** "per month", "per page", "per hour" — free text, it only ever prints. */
  unit: string
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Money in
 * ------------------------------------------------------------------ */

/**
 * Where an amount stands.
 *
 * `planned` is expected but not asked for yet, `issued` has been sent to the
 * client, `paid` has arrived. Keeping the three apart is what separates "we
 * earned this" from "we have this", which are not the same number and are
 * confused constantly.
 */
export const INCOME_STATUSES = ['planned', 'issued', 'paid'] as const
export type IncomeStatus = (typeof INCOME_STATUSES)[number]

export interface IncomeEntry {
  id: string
  clientId: string
  projectId: string | null
  description: string
  amount: Money
  /** When the work was delivered or the charge applies. */
  date: string
  status: IncomeStatus
  paidDate: string | null
  /** Set once documents are generated; the number printed on it. */
  documentNumber: string | null
  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Money out
 * ------------------------------------------------------------------ */

export const EXPENSE_CATEGORIES = [
  'tools',
  'subcontractor',
  'advertising',
  'hosting',
  'salary',
  'office',
  'other',
] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export interface ExpenseEntry {
  id: string
  /** Attached to a project when it belongs to one; otherwise a running cost. */
  projectId: string | null
  clientId: string | null
  description: string
  amount: Money
  date: string
  category: ExpenseCategory
  /** True for costs that repeat every month, so they can be projected. */
  recurring: boolean
  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Derived figures
 * ------------------------------------------------------------------ */

/**
 * What a project actually did, in base currency minor units.
 *
 * `earned` counts everything issued or paid; `received` counts only what
 * arrived. An agency that watches only the first runs out of cash while its
 * reports look healthy.
 */
export interface ProjectResult {
  projectId: string
  earnedMinor: number
  receivedMinor: number
  spentMinor: number
  profitMinor: number
}
