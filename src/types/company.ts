/**
 * Goals, the calendar, notifications and internal messages.
 *
 * The common thread: none of these hold a fact of their own. A goal's progress
 * is counted from the records that already exist, a calendar entry is a date
 * that already lives on a task or a contract, and a notification is something
 * that already happened. Storing an independent copy of any of them is how a
 * dashboard ends up reporting a number nobody can reproduce.
 *
 * The exception is a manual goal and a manual calendar entry, which have no
 * underlying record — those are typed in, and say so.
 */

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
  'new_clients',
  'new_leads',
  'leads_converted',
  'sales_won',
  'sales_value',
  'projects_completed',
  'tasks_completed',
  'affiliate_revenue',
  'manual',
] as const
export type GoalMetric = (typeof GOAL_METRICS)[number]

/** Metrics measured in money, so the UI knows to format them as such. */
export const MONEY_METRICS: readonly GoalMetric[] = [
  'revenue',
  'profit',
  'sales_value',
  'affiliate_revenue',
]

export const GOAL_SCOPES = ['company', 'department', 'team', 'individual'] as const
export type GoalScope = (typeof GOAL_SCOPES)[number]

export const GOAL_STATUSES = ['active', 'achieved', 'missed', 'cancelled'] as const
export type GoalStatus = (typeof GOAL_STATUSES)[number]

export interface Goal {
  id: string
  title: string
  description: string
  scope: GoalScope
  /** Set for a department goal; the department's id. */
  departmentId: string | null
  /** Set for an individual goal; whose it is. */
  ownerUid: string | null
  ownerName: string
  metric: GoalMetric
  /** Money goals store minor units; count goals store a plain number. */
  target: number
  /** Only used when the metric is `manual`. Otherwise progress is computed. */
  manualValue: number
  startDate: string
  endDate: string
  status: GoalStatus
  /** Narrows a revenue goal to one service, when that is the point of it. */
  serviceId: string | null
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
  'sales_won',
  'sales_value',
  'revenue_generated',
  'tasks_completed',
  'tasks_overdue',
  'projects_completed',
  'commission_generated',
] as const
export type KpiMetric = (typeof KPI_METRICS)[number]

/** KPI metrics measured in money. */
export const MONEY_KPIS: readonly KpiMetric[] = [
  'sales_value',
  'revenue_generated',
  'commission_generated',
]

/** Metrics where a lower number is the better result. */
export const INVERSE_KPIS: readonly KpiMetric[] = ['tasks_overdue']

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
  'tasks_completed',
  'tasks_overdue',
  'leads_converted',
  'revenue_generated',
]

/* ------------------------------------------------------------------ *
 * Calendar
 * ------------------------------------------------------------------ */

export const EVENT_KINDS = [
  'meeting',
  'deadline',
  'task',
  'contract',
  'payment',
  'reminder',
  'other',
] as const
export type EventKind = (typeof EVENT_KINDS)[number]

/**
 * A calendar entry the user typed in.
 *
 * Deadlines, contract renewals and payment dates are NOT stored here — they
 * are read from the tasks, contracts and invoices that own them and merged
 * into the same view. Copying them would create a second date that stops
 * matching the first the moment anybody edits one.
 */
export interface CalendarEvent {
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
  /** True when it comes from a task, contract or invoice rather than an event. */
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
  'client_new',
  'sale_won',
  'payment_received',
  'payment_overdue',
  'contract_expiring',
  'project_deadline',
  'task_assigned',
  'task_overdue',
  'registration_request',
  'commission_earned',
  'goal_achieved',
  'announcement',
  'message',
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
 * Internal messages
 * ------------------------------------------------------------------ */

export const THREAD_KINDS = ['direct', 'group', 'announcement'] as const
export type ThreadKind = (typeof THREAD_KINDS)[number]

export interface ChatThread {
  id: string
  kind: ThreadKind
  /** Empty for a direct thread, where the other person's name is the title. */
  title: string
  /** Everybody who can read it. Membership is what the rules check. */
  memberUids: string[]
  createdAt: string
  createdBy: string
  /** Denormalised so the thread list does not need a read per thread. */
  lastMessage: string
  lastMessageAt: string
  lastMessageBy: string
  /** uid → ISO timestamp they last opened it, for the unread count. */
  readAt: Record<string, string>
  updatedAt: string
}

export interface ChatMessage {
  id: string
  threadId: string
  authorUid: string
  authorName: string
  body: string
  /** uids mentioned with @, so they can be notified. */
  mentions: string[]
  createdAt: string
  editedAt: string | null
}

/** An announcement is a thread nobody can reply to. */
export const ANNOUNCEMENT_AUDIENCES = ['everyone', 'department', 'selected'] as const
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number]
