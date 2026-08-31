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
  notes: string
  /** Reserved for the StayBrain link. Unused until that integration lands. */
  externalClientId: string | null
  createdAt: string
  createdBy: string
  updatedAt: string
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
