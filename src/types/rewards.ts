/**
 * Bonuses, incentive work and what an employee has earned.
 *
 * The rule the whole file is arranged around: **nobody awards themselves
 * anything.** Progress is counted from records the employee cannot edit,
 * earning is a consequence of progress, and paying is a separate act by
 * somebody else. Each of those is a different field with a different guard,
 * because collapsing them is how a bonus scheme becomes a way to invoice the
 * company.
 *
 * "Earned" and "paid" are especially not the same. A bonus can be earned in
 * March and paid in May, and a system that stores one boolean for both cannot
 * tell you what it owes.
 */

import type { SoftDeletable } from './records'

/* ------------------------------------------------------------------ *
 * What a bonus is measured on
 * ------------------------------------------------------------------ */

/**
 * Metrics the system can count for itself.
 *
 * `manual` is the escape hatch — for work the system cannot see — and it is
 * the only one where a person types the number. Even then it is a manager who
 * types it, never the employee being measured.
 */
export const BONUS_METRICS = [
  'sales_count',
  'sales_value',
  'revenue_collected',
  'leads_created',
  'leads_converted',
  'new_clients',
  'projects_completed',
  'manual',
] as const
export type BonusMetric = (typeof BONUS_METRICS)[number]

/** Metrics measured in money rather than in things counted. */
export const MONEY_BONUS_METRICS: readonly BonusMetric[] = ['sales_value', 'revenue_collected']

/**
 * A rung on the ladder.
 *
 * A programme is a list of these, in order. The employee sees where they are,
 * what the next one needs, and what it pays.
 */
export interface BonusMilestone {
  id: string
  /** Reaching this number earns the reward. */
  target: number
  /** Cash reward in base-currency minor units. Zero when the reward is a thing. */
  rewardBaseMinor: number
  /** What they get, when it is not money: a day off, a device, a trip. */
  rewardLabel: string
  note: string
}

export const BONUS_AUDIENCES = ['company', 'department', 'team', 'selected'] as const
export type BonusAudience = (typeof BONUS_AUDIENCES)[number]

export const PROGRAMME_STATUSES = ['draft', 'active', 'ended'] as const
export type ProgrammeStatus = (typeof PROGRAMME_STATUSES)[number]

/**
 * A bonus programme.
 *
 * Nothing about it is hardcoded: who it applies to, what it measures, how many
 * rungs it has, what each pays, whether a person has to approve, and whether
 * it starts again next period are all set when it is created.
 */
export interface BonusProgramme extends SoftDeletable {
  id: string
  name: string
  description: string
  metric: BonusMetric
  audience: BonusAudience
  departmentId: string | null
  /** Who it applies to when the audience is `selected`. */
  memberUids: string[]
  milestones: BonusMilestone[]
  startDate: string
  endDate: string
  /** Restricts the count to one service, when that is the point of it. */
  serviceId: string | null
  /**
   * Whether reaching a milestone earns it outright, or only proposes it.
   * On by default: money leaving the company should be somebody's decision.
   */
  requiresApproval: boolean
  /** Starts again each period rather than ending at the last milestone. */
  repeats: boolean
  status: ProgrammeStatus
  /** Employees see programmes they are part of; this hides one while drafting. */
  visibleToStaff: boolean
  notes: string
  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Incentive work — a job with a reward attached
 * ------------------------------------------------------------------ */

export const WORK_STATUSES = [
  'assigned',
  'in_progress',
  'submitted',
  'approved',
  'rejected',
  'cancelled',
] as const
export type WorkStatus = (typeof WORK_STATUSES)[number]

/**
 * Extra work somebody was asked to do, with a bonus on the end of it.
 *
 * The status ladder is the point. An employee may move it as far as
 * `submitted` and no further; `approved` is the only transition that earns
 * anything, and only somebody else can make it.
 */
export interface IncentiveWork extends SoftDeletable {
  id: string
  title: string
  description: string
  assigneeUid: string
  assigneeName: string
  dueDate: string | null
  rewardBaseMinor: number
  rewardLabel: string
  status: WorkStatus
  submittedAt: string | null
  submissionNote: string
  reviewedBy: string | null
  reviewedByName: string
  reviewedAt: string | null
  reviewNote: string
  createdAt: string
  createdBy: string
  createdByName: string
  updatedAt: string
}

/** Statuses the person doing the work is allowed to set. */
export const STAFF_WORK_STATUSES: readonly WorkStatus[] = [
  'assigned',
  'in_progress',
  'submitted',
]

/* ------------------------------------------------------------------ *
 * Awards — what somebody actually got
 * ------------------------------------------------------------------ */

export const AWARD_STATUSES = [
  'pending',
  'earned',
  'approved',
  'paid',
  'rejected',
  'cancelled',
] as const
export type AwardStatus = (typeof AWARD_STATUSES)[number]

/** Statuses that represent money the company owes but has not handed over. */
export const OWED_STATUSES: readonly AwardStatus[] = ['earned', 'approved']

export const AWARD_SOURCES = ['programme', 'incentive_work', 'commission', 'manual'] as const
export type AwardSource = (typeof AWARD_SOURCES)[number]

/**
 * One bonus, for one person, once.
 *
 * Written when a milestone is reached or a piece of work is approved, and then
 * moved along by hand. It carries where it came from so the employee's history
 * can say "for reaching 10 sales in March" rather than just showing a number.
 */
export interface BonusAward {
  id: string
  employeeUid: string
  employeeName: string
  source: AwardSource
  /** The programme, work item or commission that produced it. */
  sourceId: string
  sourceLabel: string
  /** Which rung, when it came from a programme. */
  milestoneId: string
  reason: string
  amountBaseMinor: number
  rewardLabel: string
  status: AwardStatus
  earnedDate: string
  approvedBy: string | null
  approvedAt: string | null
  paidAt: string | null
  note: string
  createdAt: string
  createdBy: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Derived progress
 * ------------------------------------------------------------------ */

export interface MilestoneProgress {
  milestone: BonusMilestone
  reached: boolean
  /** The award, when one exists for this rung. */
  awardStatus: AwardStatus | null
}

/**
 * Where one person stands in one programme.
 *
 * `current` is counted from live records; `nextMilestone` and `remaining` are
 * what the employee actually wants to know, so they are computed here rather
 * than in each screen that shows a progress bar.
 */
export interface ProgrammeProgress {
  programmeId: string
  employeeUid: string
  current: number
  isMoney: boolean
  milestones: MilestoneProgress[]
  nextMilestone: BonusMilestone | null
  remaining: number
  /** Percentage towards the next rung, or towards the last one once past it. */
  percent: number
  earnedBaseMinor: number
}

/** What somebody has been given, and what is still owed to them. */
export interface Earnings {
  employeeUid: string
  /** Cash bonuses marked paid. */
  paidBaseMinor: number
  /** Earned or approved, but not yet handed over. */
  owedBaseMinor: number
  /** Still waiting on somebody's decision. */
  pendingBaseMinor: number
  /** Commission from the affiliate programme, paid. */
  commissionPaidBaseMinor: number
  commissionOwedBaseMinor: number
  /** This calendar month and this calendar year, from paid awards. */
  monthBaseMinor: number
  yearBaseMinor: number
  /** Non-cash rewards earned, for the ones that are a thing rather than money. */
  rewards: string[]
}
