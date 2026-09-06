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

  /** What business they are in, for grouping and reporting. */
  industry: string
  tags: string[]

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
  /** Optional label. Money still belongs to the client; this groups it. */
  projectId: string | null
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
  ownerName: string
  /** Everyone working on it, so it can appear in their workspace. */
  teamUids: string[]
  priority: TaskPriority
  serviceId: string | null
  serviceName: string
  contractId: string | null
  milestones: Milestone[]
  createdAt: string
  createdBy: string
  updatedAt: string
}

/**
 * A checkpoint inside a project.
 *
 * Progress is counted from these and from the project's tasks rather than
 * typed in, so "80% done" always means something specific.
 */
export interface Milestone {
  id: string
  title: string
  dueDate: string | null
  done: boolean
}

/* ------------------------------------------------------------------ *
 * Services — the price list
 * ------------------------------------------------------------------ */

export const PRICING_MODELS = ['fixed', 'hourly', 'monthly', 'commission', 'custom'] as const
export type PricingModel = (typeof PRICING_MODELS)[number]

export interface Service {
  id: string
  name: string
  description: string
  /** Free text so a new line of business does not need a code change. */
  category: string
  pricingModel: PricingModel
  defaultPrice: Money
  /** "per month", "per page", "per hour" — free text, it only ever prints. */
  unit: string
  status: 'active' | 'inactive'
  createdAt: string
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
 * Leads
 *
 * Kept apart from clients on purpose. A lead is a conversation that may go
 * nowhere; a client is a relationship with money in it. Mixing them fills the
 * client list with people who never bought anything, and makes every figure
 * about "our clients" quietly wrong.
 *
 * Winning a lead copies its details into a new client rather than converting
 * the record, so the pipeline keeps its own history of what was tried.
 * ------------------------------------------------------------------ */

export const LEAD_STAGES = [
  'new',
  'contacted',
  'interested',
  'offer_sent',
  'negotiation',
  'won',
  'lost',
] as const
export type LeadStage = (typeof LEAD_STAGES)[number]

/** Stages that are still live, for the pipeline view and the counts. */
export const OPEN_STAGES: readonly LeadStage[] = [
  'new',
  'contacted',
  'interested',
  'offer_sent',
  'negotiation',
]

export interface Lead {
  id: string
  name: string
  company: string
  email: string
  phone: string
  city: string
  country: string
  source: ClientSource
  sourceDetail: string
  /** What the work would be worth if it lands. */
  estimatedValue: Money | null
  serviceInterest: string
  stage: LeadStage
  /** Who is working it. Performance and "my leads" both read this. */
  assigneeUid: string | null
  assigneeName: string
  priority: TaskPriority
  /** The one thing to do next. A pipeline without this is just a list. */
  nextStep: string
  nextContactDate: string | null
  notes: string
  lostReason: string
  /** Set when the lead was won and a client was created from it. */
  clientId: string | null
  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Tasks
 * ------------------------------------------------------------------ */

export const TASK_STATUSES = ['todo', 'doing', 'review', 'blocked', 'done', 'cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

/**
 * A piece of work assigned to somebody.
 *
 * Client and project are both optional. Plenty of real work belongs to nobody
 * in particular — fix the website, chase an invoice — and forcing every task
 * under a project is how task lists start being avoided.
 */
export interface Task {
  id: string
  title: string
  description: string
  clientId: string | null
  projectId: string | null
  assigneeUid: string | null
  assigneeName: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  completedAt: string | null
  /** Planned and actual effort, in minutes. Zero means not tracked. */
  estimatedMinutes: number
  actualMinutes: number
  checklist: ChecklistItem[]
  /** Repeats after completion; blank when it does not. */
  repeat: TaskRepeat
  createdAt: string
  createdBy: string
  createdByName: string
  updatedAt: string
}

export const TASK_REPEATS = ['', 'daily', 'weekly', 'monthly'] as const
export type TaskRepeat = (typeof TASK_REPEATS)[number]

/** Days added when a repeating task is completed and re-opened. */
export const REPEAT_DAYS: Record<Exclude<TaskRepeat, ''>, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
}

/** A comment on a task, stored under `tasks/{id}/comments`. */
export interface TaskComment {
  id: string
  body: string
  authorUid: string
  authorName: string
  createdAt: string
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
