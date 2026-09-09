/**
 * The records the company is made of: clients, leads, projects, services and
 * the notes stuck to them.
 *
 * Two shapes changed here and both were deliberate.
 *
 * A PROJECT HOLDS MANY CLIENTS. It used to hold one, which made it a synonym
 * for "a job for a client" and left no way to describe the thing MsEe actually
 * runs — a season of apartment sales, a marketing push across six hotels. A
 * project is an initiative; the clients are who it is for.
 *
 * A SERVICE CARRIES ITS PAYMENT STRUCTURE. Price alone cannot express "half up
 * front, the rest in three parts", and without that the system can never say
 * whether an advance is outstanding. The structure is copied onto a sale when
 * one is made, so raising a price next year does not rewrite last year's deal.
 *
 * The work ledger that used to live under each client is gone. It recorded
 * what was sold and what it earned, which is what a sale records — and two
 * places to write one fact is two places for it to be wrong.
 */

import type { CustomValues, SoftDeletable } from './records'
import type { Money } from './money'
import type { PaymentStructure } from './revenue'

/* ------------------------------------------------------------------ *
 * Shared vocabulary
 * ------------------------------------------------------------------ */

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type Priority = (typeof PRIORITIES)[number]

export const CLIENT_SOURCES = ['direct', 'referral', 'affiliate', 'other'] as const
export type ClientSource = (typeof CLIENT_SOURCES)[number]

/* ------------------------------------------------------------------ *
 * Clients
 * ------------------------------------------------------------------ */

export const CLIENT_STATUSES = ['prospect', 'active', 'paused', 'former'] as const
export type ClientStatus = (typeof CLIENT_STATUSES)[number]

/**
 * Where a client came from.
 *
 * Commission is never stored here — it is computed from the affiliate's rules
 * against the sales that followed, so it cannot drift from what was earned.
 */
export interface Referral {
  source: ClientSource
  /** Free text: this may be somebody outside the company. */
  referrerName: string
  /** Set when the referrer is a registered affiliate. */
  affiliateId: string | null
  note: string
}

export const NO_REFERRAL: Referral = {
  source: 'direct',
  referrerName: '',
  affiliateId: null,
  note: '',
}

/**
 * The other systems MsEe runs, that a client may also exist in.
 *
 * A list rather than one field because a hotel can be on StayBrain and the
 * booking system at once, and because the next product should not need a
 * schema change to be recorded here.
 */
export const EXTERNAL_SYSTEMS = ['staybrain', 'booking', 'website', 'other'] as const
export type ExternalSystem = (typeof EXTERNAL_SYSTEMS)[number]

export interface ExternalRef {
  system: ExternalSystem
  /** Their id or account name over there. */
  reference: string
  /** A link straight to them, when the system has one. */
  url: string
}

export interface Client extends SoftDeletable {
  id: string
  name: string
  /** What they do, in a line. Shown in the list so it is scannable. */
  description: string
  /** The person you actually talk to, when the client is a company. */
  contactName: string
  email: string
  phone: string
  city: string
  country: string
  address: string
  website: string
  industry: string
  tags: string[]
  status: ClientStatus
  /** Archived clients drop out of lists but keep their whole history. */
  archived: boolean
  notes: string

  /** Data URI, resized in the browser like an employee photo. */
  logoUrl: string | null

  /* The people behind the company. */
  ownerName: string
  managerName: string
  instagram: string
  facebook: string
  otherContact: string

  /** Which employee looks after them. */
  responsibleUid: string | null
  responsibleName: string

  /** Services they use. Ids into the catalogue. */
  serviceIds: string[]

  referral: Referral
  custom: CustomValues

  clientSince: string | null
  /**
   * Where this client exists in the other systems MsEe runs.
   *
   * A reference somebody writes down, not a connection. There is no API
   * between this and StayBrain or the booking system, and until there is, the
   * honest thing is a field that lets a person find the client over there —
   * not a status light that implies something is being synchronised.
   *
   * When an integration does land it reads from here: the id is already
   * recorded against the right client, so the first version of it has nothing
   * to migrate.
   */
  externalRefs: ExternalRef[]
  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Leads
 *
 * Kept apart from clients on purpose. A lead is a conversation that may go
 * nowhere; a client is a relationship with money in it. Mixing them fills the
 * client list with people who never bought anything and makes every figure
 * about "our clients" quietly wrong.
 * ------------------------------------------------------------------ */

export const LEAD_STAGES = [
  'new',
  'contacted',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
] as const
export type LeadStage = (typeof LEAD_STAGES)[number]

/** Stages still in play, for the pipeline and the counts. */
export const OPEN_STAGES: readonly LeadStage[] = [
  'new',
  'contacted',
  'qualified',
  'proposal',
  'negotiation',
]

export interface Lead extends SoftDeletable {
  id: string
  name: string
  company: string
  /** What they want, in a line. */
  description: string
  email: string
  phone: string
  city: string
  country: string
  source: ClientSource
  sourceDetail: string
  /** Set when an affiliate submitted this lead through their panel. */
  affiliateId: string | null
  affiliateName: string
  /** What the work would be worth if it lands. */
  estimatedValue: Money | null
  serviceId: string | null
  serviceInterest: string
  stage: LeadStage
  /** Who is working it. Performance and "my leads" both read this. */
  assigneeUid: string | null
  assigneeName: string
  priority: Priority
  /**
   * When somebody last actually spoke to them. Separate from `updatedAt`,
   * because editing a note is not contact and a pipeline that confuses the two
   * will tell you a cold lead is warm.
   */
  lastContactedAt: string | null
  /** The one thing to do next. A pipeline without this is just a list. */
  nextStep: string
  nextContactDate: string | null
  notes: string
  lostReason: string
  custom: CustomValues
  /** Set when the lead was converted, so the trail survives. */
  clientId: string | null
  saleId: string | null
  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

export const PROJECT_STATUSES = [
  'planning',
  'active',
  'on_hold',
  'at_risk',
  'completed',
  'cancelled',
] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/**
 * A checkpoint inside a project.
 *
 * Progress is counted from these rather than typed in, so "80% done" always
 * means something specific. A project with no milestones reports no progress
 * rather than nought — "cannot tell" and "nothing done" are different answers.
 */
export interface Milestone {
  id: string
  title: string
  dueDate: string | null
  done: boolean
  doneAt: string | null
}

export interface Project extends SoftDeletable {
  id: string
  name: string
  /** Data URI cover image, resized in the browser. */
  coverUrl: string | null
  description: string
  /** Why it exists. The line that stops a project drifting. */
  objective: string
  status: ProjectStatus
  priority: Priority
  startDate: string | null
  endDate: string | null

  /** Which employee runs it. */
  ownerUid: string | null
  ownerName: string
  /** Everyone working on it, so it appears in their workspace. */
  teamUids: string[]

  /**
   * The clients this project is for. Many, not one — see the note at the top
   * of this file.
   */
  clientIds: string[]

  serviceId: string | null
  serviceName: string
  /** What was set aside for it. Revenue is read from the sales attached. */
  budget: Money | null
  milestones: Milestone[]
  notes: string
  custom: CustomValues

  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Services — the catalogue
 * ------------------------------------------------------------------ */

export const PRICING_MODELS = ['fixed', 'hourly', 'monthly', 'per_unit', 'custom'] as const
export type PricingModel = (typeof PRICING_MODELS)[number]

export interface Service extends SoftDeletable {
  id: string
  name: string
  /** One line, for the list and for pickers. */
  description: string
  /** The full explanation, for whoever has to sell it. */
  details: string
  /** Free text so a new line of business needs no code change. */
  category: string
  pricingModel: PricingModel
  defaultPrice: Money
  /** "per month", "per page", "per hour" — free text, it only ever prints. */
  unit: string

  /**
   * How this service is normally paid for.
   *
   * Copied onto a sale when one is made, and editable there: a structure is a
   * default, not a rule, because somebody will always agree something else.
   */
  payment: PaymentStructure

  /** Default commission for affiliates who sell it, as a percentage. */
  commissionPercent: number
  status: 'active' | 'inactive'
  notes: string
  custom: CustomValues
  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Notes
 *
 * One flat collection, attachable to anything. This is what replaced the task
 * module: a note is enough to track "call them back Tuesday" without a second
 * system to keep up to date, and a note pinned to a client is where somebody
 * actually looks for it.
 * ------------------------------------------------------------------ */

export const NOTE_ENTITIES = ['client', 'lead', 'project', 'sale', 'employee'] as const
export type NoteEntity = (typeof NOTE_ENTITIES)[number]

export interface Note {
  id: string
  entity: NoteEntity
  entityId: string
  body: string
  /** Pinned notes sort first and show on the record's overview. */
  pinned: boolean
  /** An optional reminder date, which is as close to a task as this gets. */
  dueDate: string | null
  done: boolean
  authorUid: string
  authorName: string
  createdAt: string
  updatedAt: string
}
