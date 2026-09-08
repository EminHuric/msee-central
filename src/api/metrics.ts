/**
 * The derivation engine.
 *
 * Every figure the dashboard, analytics, goals, performance and workspace show
 * is computed here from one snapshot of the underlying records. Five screens
 * asking five questions of the same data is a feature; five screens each doing
 * their own arithmetic is how a company ends up with two revenue numbers and
 * an argument about which is right.
 *
 * Nothing in this file is stored. If a number here is wrong, the fix is in the
 * record it came from — there is no cached total to clear and no nightly job.
 *
 * The distinction the whole file rests on: **sold is not collected.** A sale is
 * what somebody agreed to pay; income is what arrived. Revenue figures come
 * from transactions, never from sales, because a business that counts the
 * first as the second runs out of cash while its reports look healthy.
 */

import { fetchClients } from './clients'
import { fetchGoals } from './company'
import { fetchAffiliates } from './affiliates'
import { fetchCommissions, fetchTransactions } from './finance'
import { fetchLeads, fetchProjects, fetchServices } from './operations'
import { fetchSales } from './sales'
import { fetchAwards, fetchIncentiveWork, fetchProgrammes } from './rewards'
import { OPEN_STAGES, type Client, type Lead, type Project, type Service } from '@/types/business'
import type { Goal, GoalMetric, KpiMetric } from '@/types/company'
import { MONEY_METRICS } from '@/types/company'
import {
  INCOME_TYPES,
  OUTGOING_TYPES,
  balanceOf,
  type Affiliate,
  type Commission,
  type Sale,
  type Transaction,
} from '@/types/revenue'
import type { BonusAward, BonusProgramme, IncentiveWork } from '@/types/rewards'
import { OWED_STATUSES } from '@/types/rewards'

/* ------------------------------------------------------------------ *
 * The snapshot
 * ------------------------------------------------------------------ */

export interface Snapshot {
  clients: Client[]
  leads: Lead[]
  sales: Sale[]
  transactions: Transaction[]
  projects: Project[]
  services: Service[]
  affiliates: Affiliate[]
  commissions: Commission[]
  goals: Goal[]
  programmes: BonusProgramme[]
  awards: BonusAward[]
  work: IncentiveWork[]
}

export const EMPTY_SNAPSHOT: Snapshot = {
  clients: [],
  leads: [],
  sales: [],
  transactions: [],
  projects: [],
  services: [],
  affiliates: [],
  commissions: [],
  goals: [],
  programmes: [],
  awards: [],
  work: [],
}

/**
 * Load everything the derived screens need, in parallel.
 *
 * Each read already returns `[]` when the rules refuse it, so somebody who may
 * not see finance gets a dashboard with the parts they may see rather than an
 * error page. Permission is decided by the rules; this decides how a refusal
 * looks.
 */
export async function loadSnapshot(): Promise<Snapshot> {
  const [
    clients,
    leads,
    sales,
    transactions,
    projects,
    services,
    affiliates,
    commissions,
    goals,
    programmes,
    awards,
    work,
  ] = await Promise.all([
    fetchClients().catch(() => []),
    fetchLeads().catch(() => []),
    fetchSales().catch(() => []),
    fetchTransactions().catch(() => []),
    fetchProjects().catch(() => []),
    fetchServices().catch(() => []),
    fetchAffiliates().catch(() => []),
    fetchCommissions().catch(() => []),
    fetchGoals().catch(() => []),
    fetchProgrammes().catch(() => []),
    fetchAwards().catch(() => []),
    fetchIncentiveWork().catch(() => []),
  ])

  return {
    clients,
    leads,
    sales,
    transactions,
    projects,
    services,
    affiliates,
    commissions,
    goals,
    programmes,
    awards,
    work,
  }
}

/* ------------------------------------------------------------------ *
 * Periods
 * ------------------------------------------------------------------ */

export type PeriodKey =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'month'
  | 'prev_month'
  | 'quarter'
  | 'year'
  | 'all'
  | 'custom'

export interface Period {
  from: string
  to: string
  key: PeriodKey
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const shift = (days: number, base = new Date()) => iso(new Date(base.getTime() + days * 86_400_000))

/** A named period as concrete dates, so every comparison uses the same rule. */
export function periodOf(key: PeriodKey, now = new Date()): Period {
  const to = iso(now)

  switch (key) {
    case 'today':
      return { from: to, to, key }

    case 'yesterday': {
      const day = shift(-1, now)
      return { from: day, to: day, key }
    }

    case 'last7':
      return { from: shift(-6, now), to, key }

    case 'last30':
      return { from: shift(-29, now), to, key }

    case 'month':
      return { from: `${to.slice(0, 7)}-01`, to, key }

    case 'prev_month': {
      const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
      return { from: iso(first), to: iso(last), key }
    }

    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3) * 3
      return { from: iso(new Date(Date.UTC(now.getFullYear(), q, 1))), to, key }
    }

    case 'year':
      return { from: `${to.slice(0, 4)}-01-01`, to, key }

    default:
      return { from: '0000-01-01', to: '9999-12-31', key: 'all' }
  }
}

/**
 * The equivalent stretch immediately before a period, for the trend arrow.
 *
 * Measured in days rather than calendar units, so "this month" on the 3rd
 * compares against the first three days of last month and not against a full
 * month that will always look bigger.
 */
export function previousPeriod(period: Period): Period {
  const from = Date.parse(period.from)
  const to = Date.parse(period.to)
  const span = Math.max(86_400_000, to - from + 86_400_000)

  return {
    from: iso(new Date(from - span)),
    to: iso(new Date(from - 86_400_000)),
    key: 'custom',
  }
}

const within = (date: string | null | undefined, p: Period) =>
  !!date && date >= p.from && date <= p.to

/** Narrow a whole snapshot to one period. Every screen filters the same way. */
export function slice(snap: Snapshot, p: Period): Snapshot {
  return {
    ...snap,
    leads: snap.leads.filter((l) => within(l.createdAt?.slice(0, 10), p)),
    sales: snap.sales.filter((s) => within(s.saleDate, p)),
    transactions: snap.transactions.filter((t) => within(t.date, p)),
    clients: snap.clients.filter((c) => within(c.createdAt?.slice(0, 10), p)),
    commissions: snap.commissions.filter((c) => within(c.earnedDate, p)),
    awards: snap.awards.filter((a) => within(a.earnedDate, p)),
  }
}

/* ------------------------------------------------------------------ *
 * Company figures
 * ------------------------------------------------------------------ */

export interface CompanyFigures {
  /** Money that arrived, from transactions marked paid. */
  incomeBaseMinor: number
  expenseBaseMinor: number
  profitBaseMinor: number
  /** What was agreed in the period — sold, not collected. */
  soldBaseMinor: number
  salesCount: number
  /** Owed across every sale, whenever it was made. */
  outstandingBaseMinor: number
  overdueBaseMinor: number
  /** Sales still waiting on the advance they were sold on. */
  advanceDueCount: number

  activeClients: number
  newClients: number
  newLeads: number
  openLeads: number
  activeProjects: number
  commissionsOwedBaseMinor: number
  bonusesOwedBaseMinor: number
}

/**
 * The company at a glance.
 *
 * `snap` is the period; `all` is everything, and the two are separate
 * arguments because some figures are period figures and some are not. Money
 * owed from last year is still owed today, so receivables ignore the filter —
 * hiding them would be the one number on the page that lies.
 */
export function companyFigures(snap: Snapshot, all: Snapshot = snap): CompanyFigures {
  const today = iso(new Date())
  const paid = snap.transactions.filter((tx) => tx.status === 'paid')

  const income = paid
    .filter((tx) => INCOME_TYPES.includes(tx.type))
    .reduce((n, tx) => n + tx.amount.baseMinor, 0)

  const expense = paid
    .filter((tx) => OUTGOING_TYPES.includes(tx.type))
    .reduce((n, tx) => n + tx.amount.baseMinor, 0)

  const allBalances = all.sales.map((sale) => balanceOf(sale, all.transactions))

  return {
    incomeBaseMinor: income,
    expenseBaseMinor: expense,
    profitBaseMinor: income - expense,
    soldBaseMinor: snap.sales.reduce((n, s) => n + s.value.baseMinor, 0),
    salesCount: snap.sales.length,
    outstandingBaseMinor: allBalances.reduce((n, b) => n + b.remainingBaseMinor, 0),
    overdueBaseMinor: all.transactions
      .filter((tx) => tx.status !== 'paid' && tx.dueDate && tx.dueDate < today)
      .reduce((n, tx) => n + tx.amount.baseMinor, 0),
    advanceDueCount: allBalances.filter((b) => b.advanceDue).length,

    activeClients: all.clients.filter((c) => c.status === 'active' && !c.archived).length,
    newClients: snap.clients.length,
    newLeads: snap.leads.length,
    openLeads: all.leads.filter((l) => OPEN_STAGES.includes(l.stage)).length,
    activeProjects: all.projects.filter((p) => p.status === 'active').length,
    commissionsOwedBaseMinor: all.commissions
      .filter((c) => c.status === 'pending' || c.status === 'approved')
      .reduce((n, c) => n + c.amountBaseMinor, 0),
    bonusesOwedBaseMinor: all.awards
      .filter((a) => OWED_STATUSES.includes(a.status))
      .reduce((n, a) => n + a.amountBaseMinor, 0),
  }
}

/** Percentage change, or null when there is no earlier figure to compare to. */
export function trend(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return Math.round(((current - previous) / Math.abs(previous)) * 100)
}

/* ------------------------------------------------------------------ *
 * Series, for the charts
 * ------------------------------------------------------------------ */

export interface SeriesPoint {
  label: string
  income: number
  expense: number
  profit: number
  sold: number
  salesCount: number
  leads: number
}

/**
 * Buckets over a period, by day or by month.
 *
 * Which one is chosen from the length of the period rather than by the caller:
 * a week of monthly buckets is one bar, and a year of daily ones is 365 marks
 * nobody can read.
 */
export function seriesOver(snap: Snapshot, period: Period): SeriesPoint[] {
  const from = Date.parse(period.from)
  const to = Date.parse(period.to)
  const days = Math.round((to - from) / 86_400_000) + 1
  const byDay = days <= 62

  const buckets = new Map<string, SeriesPoint>()
  const keyOf = (date: string) => (byDay ? date : date.slice(0, 7))

  if (byDay) {
    for (let i = 0; i < Math.max(1, Math.min(days, 400)); i += 1) {
      const key = iso(new Date(from + i * 86_400_000))
      buckets.set(key, blankPoint(key.slice(5)))
    }
  } else {
    const start = new Date(from)
    for (let i = 0; i < 60; i += 1) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))
      if (d.getTime() > to) break
      buckets.set(iso(d).slice(0, 7), blankPoint(iso(d).slice(0, 7)))
    }
  }

  for (const tx of snap.transactions) {
    const row = buckets.get(keyOf(tx.date))
    if (!row || tx.status !== 'paid') continue
    if (INCOME_TYPES.includes(tx.type)) row.income += tx.amount.baseMinor
    if (OUTGOING_TYPES.includes(tx.type)) row.expense += tx.amount.baseMinor
  }

  for (const sale of snap.sales) {
    const row = buckets.get(keyOf(sale.saleDate))
    if (!row) continue
    row.sold += sale.value.baseMinor
    row.salesCount += 1
  }

  for (const lead of snap.leads) {
    const row = buckets.get(keyOf((lead.createdAt ?? '').slice(0, 10)))
    if (row) row.leads += 1
  }

  for (const row of buckets.values()) row.profit = row.income - row.expense

  return [...buckets.values()]
}

function blankPoint(label: string): SeriesPoint {
  return { label, income: 0, expense: 0, profit: 0, sold: 0, salesCount: 0, leads: 0 }
}

export interface Breakdown {
  key: string
  label: string
  value: number
  count: number
}

const rank = (rows: Breakdown[]) => rows.sort((a, b) => b.value - a.value)

/**
 * Income by service.
 *
 * Attributed through the transaction's own service when it has one, and
 * through its sale when it does not. Money with neither is grouped as
 * unattributed rather than spread around, because guessing makes the figure
 * useless to the person deciding what to sell more of.
 */
export function incomeByService(snap: Snapshot): Breakdown[] {
  const saleService = new Map(snap.sales.map((s) => [s.id, { id: s.serviceId, name: s.serviceName }]))
  const map = new Map<string, Breakdown>()

  for (const tx of snap.transactions) {
    if (tx.status !== 'paid' || !INCOME_TYPES.includes(tx.type)) continue

    const fromSale = tx.saleId ? saleService.get(tx.saleId) : null
    const key = tx.serviceId ?? fromSale?.id ?? 'unattributed'
    const label = tx.serviceName || fromSale?.name || ''

    const row = map.get(key) ?? { key, label, value: 0, count: 0 }
    row.value += tx.amount.baseMinor
    row.count += 1
    map.set(key, row)
  }

  return rank([...map.values()])
}

export function incomeByClient(snap: Snapshot): Breakdown[] {
  const map = new Map<string, Breakdown>()

  for (const tx of snap.transactions) {
    if (tx.status !== 'paid' || !INCOME_TYPES.includes(tx.type) || !tx.clientId) continue
    const row = map.get(tx.clientId) ?? {
      key: tx.clientId,
      label: tx.clientName,
      value: 0,
      count: 0,
    }
    row.value += tx.amount.baseMinor
    row.count += 1
    map.set(tx.clientId, row)
  }

  return rank([...map.values()])
}

/** Sold value by the channel it came through — where business actually comes from. */
export function soldByChannel(snap: Snapshot): Breakdown[] {
  const map = new Map<string, Breakdown>()

  for (const sale of snap.sales) {
    const row = map.get(sale.channel) ?? { key: sale.channel, label: sale.channel, value: 0, count: 0 }
    row.value += sale.value.baseMinor
    row.count += 1
    map.set(sale.channel, row)
  }

  return rank([...map.values()])
}

/** Sold value by the person credited with it. */
export function soldByEmployee(snap: Snapshot): Breakdown[] {
  const map = new Map<string, Breakdown>()

  for (const sale of snap.sales) {
    const key = sale.ownerUid ?? 'unattributed'
    const row = map.get(key) ?? { key, label: sale.ownerName || '', value: 0, count: 0 }
    row.value += sale.value.baseMinor
    row.count += 1
    map.set(key, row)
  }

  return rank([...map.values()])
}

/** How many leads sit at each stage, for the funnel. */
export function leadFunnel(snap: Snapshot): Breakdown[] {
  const map = new Map<string, number>()
  for (const lead of snap.leads) map.set(lead.stage, (map.get(lead.stage) ?? 0) + 1)
  return [...map.entries()].map(([key, count]) => ({ key, label: key, value: count, count }))
}

/** Won as a share of everything closed. Open leads are not failures yet. */
export function conversionOf(snap: Snapshot): number {
  const closed = snap.leads.filter((l) => l.stage === 'won' || l.stage === 'lost')
  if (closed.length === 0) return 0
  return Math.round((closed.filter((l) => l.stage === 'won').length / closed.length) * 100)
}

/* ------------------------------------------------------------------ *
 * Goals
 * ------------------------------------------------------------------ */

export interface GoalProgress {
  goal: Goal
  current: number
  percent: number
  isMoney: boolean
  onTrack: boolean
  daysLeft: number
}

/**
 * How far along a goal is.
 *
 * Counted from the records inside the goal's own dates, so progress moves as
 * work happens and nobody has to remember to update it. `manual` is the one
 * exception and the only metric where a person types the number.
 *
 * "On track" compares progress against time elapsed rather than against the
 * deadline alone: a goal at 40% with 30% of the period gone is fine; the same
 * goal with 80% gone is not, and saying so while there is still time to act is
 * the entire value of tracking it.
 */
export function goalProgress(goal: Goal, snap: Snapshot): GoalProgress {
  const period: Period = { from: goal.startDate, to: goal.endDate, key: 'custom' }
  const win = slice(snap, period)
  const owners = goal.ownerUids ?? []

  const mineOnly = <T extends { ownerUid?: string | null; assigneeUid?: string | null }>(rows: T[]) =>
    owners.length === 0
      ? rows
      : rows.filter(
          (r) =>
            (r.ownerUid && owners.includes(r.ownerUid)) ||
            (r.assigneeUid && owners.includes(r.assigneeUid)),
        )

  const serviceMatch = (id: string | null | undefined) => !goal.serviceId || id === goal.serviceId

  const current = ((): number => {
    switch (goal.metric) {
      case 'revenue':
      case 'collected':
        return win.transactions
          .filter(
            (tx) =>
              tx.status === 'paid' && INCOME_TYPES.includes(tx.type) && serviceMatch(tx.serviceId),
          )
          .reduce((n, tx) => n + tx.amount.baseMinor, 0)

      case 'profit': {
        const paid = win.transactions.filter((tx) => tx.status === 'paid')
        return (
          paid
            .filter((tx) => INCOME_TYPES.includes(tx.type))
            .reduce((n, tx) => n + tx.amount.baseMinor, 0) -
          paid
            .filter((tx) => OUTGOING_TYPES.includes(tx.type))
            .reduce((n, tx) => n + tx.amount.baseMinor, 0)
        )
      }

      case 'new_clients':
        return win.clients.length

      case 'new_leads':
        return mineOnly(win.leads).length

      case 'leads_converted':
        return mineOnly(win.leads).filter((l) => l.stage === 'won').length

      case 'sales_count':
        return mineOnly(win.sales).filter((s) => serviceMatch(s.serviceId)).length

      case 'sales_value':
        return mineOnly(win.sales)
          .filter((s) => serviceMatch(s.serviceId))
          .reduce((n, s) => n + s.value.baseMinor, 0)

      case 'projects_completed':
        return snap.projects.filter(
          (p) => p.status === 'completed' && within(p.endDate, period),
        ).length

      case 'affiliate_revenue':
        return win.commissions.reduce((n, c) => n + c.baseAmountBaseMinor, 0)

      default:
        return goal.manualValue ?? 0
    }
  })()

  const target = goal.target || 1
  const start = Date.parse(goal.startDate)
  const end = Date.parse(goal.endDate)
  const elapsed = end > start ? Math.min(1, Math.max(0, (Date.now() - start) / (end - start))) : 1

  return {
    goal,
    current,
    percent: Math.min(999, Math.round((current / target) * 100)),
    isMoney: MONEY_METRICS.includes(goal.metric),
    onTrack: current / target >= elapsed - 0.05,
    daysLeft: Math.ceil((end - Date.now()) / 86_400_000),
  }
}

export const isMoneyMetric = (metric: GoalMetric) => MONEY_METRICS.includes(metric)

/* ------------------------------------------------------------------ *
 * Performance
 * ------------------------------------------------------------------ */

export type KpiValues = Record<KpiMetric, number>

/**
 * One person's numbers.
 *
 * No score and no ranking: a developer's project count and a salesperson's
 * revenue are not the same axis, and averaging them produces a figure that is
 * precise and meaningless. The role decides which of these are shown; this
 * computes all of them.
 */
export function kpisFor(uid: string, snap: Snapshot, period: Period): KpiValues {
  const win = slice(snap, period)

  const myLeads = win.leads.filter((l) => l.assigneeUid === uid || l.createdBy === uid)
  const mySales = win.sales.filter((s) => s.ownerUid === uid)
  const mySaleIds = new Set(mySales.map((s) => s.id))
  const affiliateIds = new Set(
    snap.affiliates.filter((a) => a.employeeUid === uid).map((a) => a.id),
  )

  return {
    leads_created: myLeads.length,
    leads_converted: myLeads.filter((l) => l.stage === 'won').length,
    sales_count: mySales.length,
    sales_value: mySales.reduce((n, s) => n + s.value.baseMinor, 0),
    revenue_collected: win.transactions
      .filter(
        (tx) =>
          tx.status === 'paid' &&
          INCOME_TYPES.includes(tx.type) &&
          (tx.employeeUid === uid || (tx.saleId && mySaleIds.has(tx.saleId))),
      )
      .reduce((n, tx) => n + tx.amount.baseMinor, 0),
    new_clients: win.clients.filter((c) => c.responsibleUid === uid).length,
    projects_completed: snap.projects.filter(
      (p) => p.status === 'completed' && (p.ownerUid === uid || p.teamUids?.includes(uid)),
    ).length,
    commission_generated: win.commissions
      .filter((c) => affiliateIds.has(c.affiliateId))
      .reduce((n, c) => n + c.amountBaseMinor, 0),
    bonuses_earned: win.awards
      .filter((a) => a.employeeUid === uid && a.status !== 'rejected' && a.status !== 'cancelled')
      .reduce((n, a) => n + a.amountBaseMinor, 0),
  }
}

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

/** What a project earned and is owed, from the sales attached to it. */
export function projectFigures(projectId: string, snap: Snapshot) {
  const sales = snap.sales.filter((s) => s.projectId === projectId)
  const balances = sales.map((s) => balanceOf(s, snap.transactions))

  return {
    salesCount: sales.length,
    soldBaseMinor: sales.reduce((n, s) => n + s.value.baseMinor, 0),
    collectedBaseMinor: balances.reduce((n, b) => n + b.paidBaseMinor, 0),
    outstandingBaseMinor: balances.reduce((n, b) => n + b.remainingBaseMinor, 0),
    costBaseMinor: snap.transactions
      .filter(
        (tx) =>
          tx.projectId === projectId && tx.status === 'paid' && OUTGOING_TYPES.includes(tx.type),
      )
      .reduce((n, tx) => n + tx.amount.baseMinor, 0),
  }
}
