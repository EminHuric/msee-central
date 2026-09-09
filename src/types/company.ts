/**
 * Goals, the calendar, notifications and announcements.
 *
 * The common thread: almost none of these hold a fact of their own. A goal's
 * progress is counted from records that already exist, a calendar entry is
 * often a date that already lives on a sale or a note, and a notification is
 * something that already happened. Storing an independent copy of any of them
 * is how a dashboard ends up reporting a number nobody can reproduce.
 *
 * The exceptions are a manual goal and a typed-in calendar entry, which have
 * no underlying record — and both say so where they are defined.
 */

import type { SoftDeletable } from './records'

/* ------------------------------------------------------------------ *
 * Goals & KPIs
 * ------------------------------------------------------------------ */

/**
 * What a goal counts.
 *
 * Every metric except `manual` is computed from live data, so progress moves
 * on its own as work happens. `manual` is for targets the system cannot see —
 * "hire two developers" — and is the only one somebody updates by hand.
 */
export const GOAL_METRICS = [
  'revenue',
  'profit',
  'collected',
  'new_clients',
  'new_leads',
  'leads_converted',
  'sales_count',
  'sales_value',
  'projects_completed',
  'affiliate_revenue',
  'manual',
] as const
export type GoalMetric = (typeof GOAL_METRICS)[number]

/** Metrics measured in money, so the UI knows to format them as such. */
export const MONEY_METRICS: readonly GoalMetric[] = [
  'revenue',
  'profit',
  'collected',
  'sales_value',
  'affiliate_revenue',
]

export const GOAL_SCOPES = ['company', 'department', 'team', 'individual'] as const
export type GoalScope = (typeof GOAL_SCOPES)[number]

export const GOAL_STATUSES = ['active', 'achieved', 'missed', 'cancelled'] as const
export type GoalStatus = (typeof GOAL_STATUSES)[number]

/** Who is allowed to see a goal that is not the whole company's. */
export const GOAL_VISIBILITY = ['everyone', 'owners', 'management'] as const
export type GoalVisibility = (typeof GOAL_VISIBILITY)[number]

export interface Goal extends SoftDeletable {
  id: string
  title: string
  description: string
  scope: GoalScope
  /** Set for a department goal; the department's id. */
  departmentId: string | null
  /**
   * Whose goal it is — several people, not one.
   *
   * The same target can be set for a pair or a whole team without creating a
   * copy each, and progress is then counted across all of them together. An
   * individual goal is simply this list with one name in it.
   */
  ownerUids: string[]
  ownerNames: string[]
  metric: GoalMetric
  /** Money goals store minor units; count goals store a plain number. */
  target: number
  /** Only used when the metric is `manual`. Otherwise progress is computed. */
  manualValue: number
  startDate: string
  endDate: string
  status: GoalStatus
  visibility: GoalVisibility
  /** Narrows a revenue goal to one service, when that is the point of it. */
  serviceId: string | null
  notes: string
  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Performance
 *
 * There is no stored performance record and no universal score. A developer
 * and a salesperson are not comparable on one number, and inventing one is
 * worse than showing none.
 *
 * Instead a role carries a KPI set: which of the computed metrics matter for
 * the people doing that job. Everything shown is derived from the same records
 * the rest of the system already keeps.
 * ------------------------------------------------------------------ */

export const KPI_METRICS = [
  'leads_created',
  'leads_converted',
  'sales_count',
  'sales_value',
  'revenue_collected',
  'new_clients',
  'projects_completed',
  'commission_generated',
  'bonuses_earned',
] as const
export type KpiMetric = (typeof KPI_METRICS)[number]

/** KPI metrics measured in money. */
export const MONEY_KPIS: readonly KpiMetric[] = [
  'sales_value',
  'revenue_collected',
  'commission_generated',
  'bonuses_earned',
]

/**
 * Metrics where a lower number is the better result.
 *
 * Empty for now, and kept because the moment one is added — response time,
 * overdue anything — every screen already knows to colour it the other way.
 */
export const INVERSE_KPIS: readonly KpiMetric[] = []

/**
 * Which KPIs a role is measured on.
 *
 * Stored per role rather than per person so that adding somebody to a team
 * does not mean deciding again what their job is measured by.
 */
export interface RoleKpiSet {
  roleId: string
  metrics: KpiMetric[]
  updatedAt: string
}

/** Sensible defaults so a new company is not looking at an empty screen. */
export const DEFAULT_KPIS: readonly KpiMetric[] = [
  'leads_created',
  'leads_converted',
  'sales_count',
  'revenue_collected',
]

/* ------------------------------------------------------------------ *
 * Calendar
 * ------------------------------------------------------------------ */

export const EVENT_KINDS = [
  'meeting',
  'deadline',
  'payment',
  'reminder',
  'goal',
  'other',
] as const
export type EventKind = (typeof EVENT_KINDS)[number]

/**
 * A calendar entry somebody typed in.
 *
 * Payment dates, project deadlines and note reminders are NOT stored here —
 * they are read from the records that own them and merged into the same view.
 * Copying them would create a second date that stops matching the first the
 * moment anybody edits one.
 */
export interface CalendarEvent extends SoftDeletable {
  id: string
  title: string
  description: string
  kind: EventKind
  date: string
  /** Blank means an all-day entry. */
  startTime: string
  endTime: string
  /** Empty means everyone; otherwise only these people see it. */
  attendeeUids: string[]
  clientId: string | null
  projectId: string | null
  location: string
  createdAt: string
  createdBy: string
  updatedAt: string
}

/** One row in the merged calendar: typed-in entries and derived dates alike. */
export interface CalendarItem {
  id: string
  date: string
  title: string
  kind: EventKind
  /** Where clicking it should go. */
  link: string | null
  detail: string
  /** True when it is read from another record rather than typed in here. */
  derived: boolean
  done: boolean
}

/* ------------------------------------------------------------------ *
 * Notifications
 * ------------------------------------------------------------------ */

export const NOTIFICATION_PRIORITIES = ['critical', 'important', 'normal', 'info'] as const
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number]

export const NOTIFICATION_KINDS = [
  'lead_new',
  'lead_stale',
  'lead_assigned',
  'client_new',
  'sale_new',
  'payment_received',
  'payment_overdue',
  'expense_recorded',
  'project_deadline',
  'project_assigned',
  'registration_request',
  'affiliate_lead',
  'commission_earned',
  'goal_achieved',
  'bonus_earned',
  'bonus_approved',
  /* Money added to somebody's ledger, or moved along it. */
  'wallet_entry',
  'work_assigned',
  'work_submitted',
  'announcement',
] as const
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]

/**
 * A stored notification.
 *
 * Written to `notifications/{uid}/items`, so a person's notifications are
 * readable by that person and nobody else — the isolation is structural rather
 * than a filter somebody has to remember to apply.
 */
export interface AppNotification {
  id: string
  kind: NotificationKind
  priority: NotificationPriority
  title: string
  body: string
  /** In-app route to the record this is about. */
  link: string | null
  read: boolean
  createdAt: string
  /** Who or what caused it, for the "from" line. */
  actorName: string
}

/** Which kinds a person wants to be told about. Absent means all of them. */
export interface NotificationPreferences {
  uid: string
  muted: NotificationKind[]
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Announcements
 *
 * There is deliberately no chat. An announcement is a notification with a
 * chosen audience, not a thread: it is the CEO telling people something, and
 * building a conversation system around that would be answering a question
 * nobody asked.
 * ------------------------------------------------------------------ */

export const ANNOUNCEMENT_AUDIENCES = ['everyone', 'department', 'selected'] as const
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number]
