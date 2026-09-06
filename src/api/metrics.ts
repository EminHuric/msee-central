/**
 * The derivation engine.
 *
 * Every figure the dashboard, analytics, goals and performance screens show is
 * computed here from one snapshot of the underlying records. Four screens
 * asking four different questions of the same data is a feature; four screens
 * each doing their own arithmetic is how a company ends up with two revenue
 * numbers and an argument about which one is right.
 *
 * Nothing in this file is stored. If a number here is wrong, the fix is in the
 * record it came from — there is no cached total to clear and no nightly job
 * to re-run.
 *
 * One snapshot serves a whole page: `loadSnapshot()` fetches once, every
 * function below reads from it, and a screen that only needs part of it pays
 * for the rest in one parallel round-trip rather than in five sequential ones.
 */

import { fetchAllWork } from './clientDossier'
import { fetchClients } from './clients'
import { fetchGoals } from './company'
import { fetchAffiliates, fetchAffiliate } from './affiliates'
import { fetchExpenses, fetchLeads, fetchProjects, fetchServiceCatalogue, fetchTasks } from './operations'
import {
  fetchCommissions,
  fetchContracts,
  fetchInvoices,
  fetchPayments,
  fetchSales,
} from './revenue'
import type {
  Client,
  ExpenseEntry,
  Lead,
  Project,
  Service,
  Task,
  WorkItem,
} from '@/types/business'
import { OPEN_STAGES } from '@/types/business'
import type { Goal, GoalMetric, KpiMetric } from '@/types/company'
import { MONEY_METRICS } from '@/types/company'
import {
  INCOME_TYPES,
  OPEN_SALE_STAGES,
  type Affiliate,
  type Commission,
  type Contract,
  type Invoice,
  type Payment,
  type Sale,
} from '@/types/revenue'

/* ------------------------------------------------------------------ *
 * The snapshot
 * ------------------------------------------------------------------ */

export interface Snapshot {
  clients: Client[]
  leads: Lead[]
  sales: Sale[]
  contracts: Contract[]
  invoices: Invoice[]
  payments: Payment[]
  work: WorkItem[]
  expenses: ExpenseEntry[]
  projects: Project[]
  tasks: Task[]
  services: Service[]
  affiliates: Affiliate[]
  commissions: Commission[]
  goals: Goal[]
}

export const EMPTY_SNAPSHOT: Snapshot = {
  clients: [],
  leads: [],
  sales: [],
  contracts: [],
  invoices: [],
  payments: [],
  work: [],
  expenses: [],
  projects: [],
  tasks: [],
  services: [],
  affiliates: [],
  commissions: [],
  goals: [],
}

/**
 * Load everything the derived screens need, in parallel.
 *
 * Each read already returns `[]` when the rules refuse it, so a person who may
 * not see finance gets a dashboard with the parts they may see rather than an
 * error page. Permission is decided by the rules; this only decides how a
 * refusal looks.
 */
export async function loadSnapshot(): Promise<Snapshot> {
  const [
    clients,
    leads,
    sales,
    contracts,
    invoices,
    payments,
    work,
    expenses,
    projects,
    tasks,
    services,
    affiliates,
    commissions,
    goals,
  ] = await Promise.all([
    fetchClients().catch(() => []),
    fetchLeads().catch(() => []),
    fetchSales().catch(() => []),
    fetchContracts().catch(() => []),
    fetchInvoices().catch(() => []),
    fetchPayments().catch(() => []),
    fetchAllWork(1000).catch(() => []),
    fetchExpenses().catch(() => []),
    fetchProjects().catch(() => []),
    fetchTasks().catch(() => []),
    fetchServiceCatalogue().catch(() => []),
    fetchAffiliates().catch(() => []),
    fetchCommissions().catch(() => []),
    fetchGoals().catch(() => []),
  ])

  return {
    clients,
    leads,
    sales,
    contracts,
    invoices,
    payments,
    work,
    expenses,
    projects,
    tasks,
    services,
    affiliates,
    commissions,
    goals,
  }
}

/* ------------------------------------------------------------------ *
 * Periods
 * ------------------------------------------------------------------ */

export type PeriodKey = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom'

export interface Period {
  from: string
  to: string
  key: PeriodKey
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** A named period as concrete dates, so every comparison uses the same rule. */
export function periodOf(key: PeriodKey, now = new Date()): Period {
  const to = iso(now)

  switch (key) {
    case 'today':
      return { from: to, to, key }

    case 'week': {
      /* Monday-based, matching the calendar. */
      const back = (now.getDay() + 6) % 7
      return { from: iso(new Date(now.getTime() - back * 86_400_000)), to, key }
    }

    case 'month':
      return { from: `${to.slice(0, 7)}-01`, to, key }

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
 * Measured in days rather than in calendar units so that "this month" on the
 * 3rd compares against the first three days of last month, not against a full
 * month that will always look bigger.
 */
export function previousPeriod(period: Period): Period {
  const from = Date.parse(period.from)
  const to = Date.parse(period.to)
  const span = Math.max(1, to - from)

  return {
    from: iso(new Date(from - span - 86_400_000)),
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
    sales: snap.sales.filter((s) => within(s.createdAt?.slice(0, 10), p)),
    payments: snap.payments.filter((x) => within(x.date, p)),
    work: snap.work.filter((w) => within(w.date, p)),
    expenses: snap.expenses.filter((e) => within(e.date, p)),
    invoices: snap.invoices.filter((i) => within(i.issueDate, p)),
    clients: snap.clients.filter((c) => within(c.createdAt?.slice(0, 10), p)),
    commissions: snap.commissions.filter((c) => within(c.earnedDate, p)),
  }
}

/* ------------------------------------------------------------------ *
 * Company figures
 * ------------------------------------------------------------------ */

export interface CompanyFigures {
  /** Billed on the work ledger — what the company earned by delivering. */
  revenueBaseMinor: number
  /** Cash that actually arrived, from typed payments. */
  collectedBaseMinor: number
  /** What delivering it cost. */
  deliveryCostBaseMinor: number
  /** Costs belonging to no client. */
  overheadsBaseMinor: number
  grossProfitBaseMinor: number
  netProfitBaseMinor: number
  outstandingBaseMinor: number
  overdueBaseMinor: number
  cashFlowBaseMinor: number

  activeClients: number
  newClients: number
  newLeads: number
  openLeads: number
  activeProjects: number
  openTasks: number
  overdueTasks: number
  wonSales: number
  pipelineBaseMinor: number
  activeContracts: number
  affiliateRevenueBaseMinor: number
  commissionsPendingBaseMinor: number
}

/**
 * The company at a glance.
 *
 * Revenue and collected are separate figures, and the gap between them is the
 * single most useful number an agency has: it is the money it has earned but
 * not been given.
 */
export function companyFigures(snap: Snapshot, all: Snapshot = snap): CompanyFigures {
  const today = iso(new Date())

  const revenue = snap.work.reduce((n, w) => n + w.revenue.baseMinor, 0)
  const deliveryCost = snap.work.reduce((n, w) => n + w.cost.baseMinor, 0)
  const overheads = snap.expenses.reduce((n, e) => n + e.amount.baseMinor, 0)

  const income = snap.payments.filter((p) => INCOME_TYPES.includes(p.type))
  const outgoing = snap.payments.filter((p) => p.type === 'expense' || p.type === 'refund')
  const collected = income.reduce((n, p) => n + p.amount.baseMinor, 0)

  /* Receivables ignore the period: money owed from last year is still owed. */
  const unpaid = all.work.filter((w) => w.paymentStatus !== 'paid')

  const affiliateSaleIds = new Set(
    all.sales.filter((s) => s.affiliateId).map((s) => s.id),
  )

  return {
    revenueBaseMinor: revenue,
    collectedBaseMinor: collected,
    deliveryCostBaseMinor: deliveryCost,
    overheadsBaseMinor: overheads,
    grossProfitBaseMinor: revenue - deliveryCost,
    netProfitBaseMinor: revenue - deliveryCost - overheads,
    outstandingBaseMinor: unpaid.reduce((n, w) => n + w.revenue.baseMinor, 0),
    overdueBaseMinor: unpaid
      .filter((w) => w.dueDate && w.dueDate < today)
      .reduce((n, w) => n + w.revenue.baseMinor, 0),
    cashFlowBaseMinor: collected - outgoing.reduce((n, p) => n + p.amount.baseMinor, 0),

    activeClients: all.clients.filter((c) => c.status === 'active' && !c.archived).length,
    newClients: snap.clients.length,
    newLeads: snap.leads.length,
    openLeads: all.leads.filter((l) => OPEN_STAGES.includes(l.stage)).length,
    activeProjects: all.projects.filter((p) => p.status === 'active').length,
    openTasks: all.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length,
    overdueTasks: all.tasks.filter(
      (t) => t.status !== 'done' && t.status !== 'cancelled' && t.dueDate && t.dueDate < today,
    ).length,
    wonSales: snap.sales.filter((s) => s.stage === 'won').length,
    pipelineBaseMinor: all.sales
      .filter((s) => OPEN_SALE_STAGES.includes(s.stage))
      .reduce((n, s) => n + s.value.baseMinor, 0),
    activeContracts: all.contracts.filter((c) => c.status === 'active').length,
    affiliateRevenueBaseMinor: snap.payments
      .filter((p) => p.affiliateId || (p.saleId && affiliateSaleIds.has(p.saleId)))
      .reduce((n, p) => n + p.amount.baseMinor, 0),
    commissionsPendingBaseMinor: all.commissions
      .filter((c) => c.status === 'pending' || c.status === 'approved')
      .reduce((n, c) => n + c.amountBaseMinor, 0),
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
  revenue: number
  cost: number
  overheads: number
  profit: number
  collected: number
}

/** Revenue, cost and profit by month, oldest first — the shape of the year. */
export function monthlySeries(snap: Snapshot, months = 12): SeriesPoint[] {
  const buckets = new Map<string, SeriesPoint>()

  const now = new Date()
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const key = d.toISOString().slice(0, 7)
    buckets.set(key, { label: key, revenue: 0, cost: 0, overheads: 0, profit: 0, collected: 0 })
  }

  const touch = (key: string) => buckets.get(key)

  for (const w of snap.work) {
    const row = touch(w.date.slice(0, 7))
    if (!row) continue
    row.revenue += w.revenue.baseMinor
    row.cost += w.cost.baseMinor
  }

  for (const e of snap.expenses) {
    const row = touch(e.date.slice(0, 7))
    if (row) row.overheads += e.amount.baseMinor
  }

  for (const p of snap.payments) {
    if (!INCOME_TYPES.includes(p.type)) continue
    const row = touch(p.date.slice(0, 7))
    if (row) row.collected += p.amount.baseMinor
  }

  for (const row of buckets.values()) row.profit = row.revenue - row.cost - row.overheads

  return [...buckets.values()]
}

export interface Breakdown {
  key: string
  label: string
  value: number
  count: number
}

const rank = (rows: Breakdown[]) => rows.sort((a, b) => b.value - a.value)

/** Revenue by client, biggest first. */
export function revenueByClient(snap: Snapshot): Breakdown[] {
  const names = new Map(snap.clients.map((c) => [c.id, c.name]))
  const map = new Map<string, Breakdown>()

  for (const w of snap.work) {
    const row = map.get(w.clientId) ?? {
      key: w.clientId,
      label: names.get(w.clientId) ?? w.clientId,
      value: 0,
      count: 0,
    }
    row.value += w.revenue.baseMinor
    row.count += 1
    map.set(w.clientId, row)
  }

  return rank([...map.values()])
}

/** Revenue by service, falling back to the item's own name when untagged. */
export function revenueByService(snap: Snapshot): Breakdown[] {
  const map = new Map<string, Breakdown>()

  for (const w of snap.work) {
    const key = w.serviceId ?? w.serviceName?.trim() ?? w.title
    const label = w.serviceName?.trim() || w.title
    const row = map.get(key) ?? { key, label, value: 0, count: 0 }
    row.value += w.revenue.baseMinor
    row.count += 1
    map.set(key, row)
  }

  return rank([...map.values()])
}

/**
 * Revenue by employee.
 *
 * Attributed through the sale that produced it, because a work item does not
 * know who sold it. Work with no sale behind it is grouped as unattributed
 * rather than spread around, since guessing would make the figure useless.
 */
export function revenueByEmployee(snap: Snapshot): Breakdown[] {
  const map = new Map<string, Breakdown>()

  for (const sale of snap.sales) {
    if (sale.stage !== 'won') continue
    const key = sale.ownerUid ?? 'unattributed'
    const row = map.get(key) ?? { key, label: sale.ownerName || '—', value: 0, count: 0 }
    row.value += sale.value.baseMinor
    row.count += 1
    map.set(key, row)
  }

  return rank([...map.values()])
}

/** How many leads reached each stage, in pipeline order. */
export function leadFunnel(snap: Snapshot): Breakdown[] {
  const map = new Map<string, number>()
  for (const lead of snap.leads) map.set(lead.stage, (map.get(lead.stage) ?? 0) + 1)
  return [...map.entries()].map(([key, count]) => ({ key, label: key, value: count, count }))
}

/** Won deals as a share of everything closed, for the period given. */
export function conversionOf(snap: Snapshot): number {
  const closed = snap.sales.filter((s) => s.stage === 'won' || s.stage === 'lost')
  if (closed.length === 0) return 0
  return Math.round((closed.filter((s) => s.stage === 'won').length / closed.length) * 100)
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
 * exception, and the only metric where a person types the number.
 *
 * "On track" compares progress against time elapsed rather than against the
 * deadline alone: a goal at 40% with 30% of the period gone is fine; the same
 * goal with 80% gone is not, and saying so before the deadline is the entire
 * value of tracking it.
 */
export function goalProgress(goal: Goal, snap: Snapshot): GoalProgress {
  const period: Period = { from: goal.startDate, to: goal.endDate, key: 'custom' }
  const inWindow = slice(snap, period)

  const mine = <T extends { ownerUid?: string | null; assigneeUid?: string | null }>(rows: T[]) =>
    goal.scope === 'individual' && goal.ownerUid
      ? rows.filter((r) => r.ownerUid === goal.ownerUid || r.assigneeUid === goal.ownerUid)
      : rows

  const serviceMatch = (serviceId: string | null | undefined) =>
    !goal.serviceId || serviceId === goal.serviceId

  const current = ((): number => {
    switch (goal.metric) {
      case 'revenue':
        return inWindow.work
          .filter((w) => serviceMatch(w.serviceId))
          .reduce((n, w) => n + w.revenue.baseMinor, 0)

      case 'profit':
        return (
          inWindow.work.reduce((n, w) => n + w.profitBaseMinor, 0) -
          inWindow.expenses.reduce((n, e) => n + e.amount.baseMinor, 0)
        )

      case 'new_clients':
        return inWindow.clients.length

      case 'new_leads':
        return mine(inWindow.leads).length

      case 'leads_converted':
        return mine(inWindow.leads).filter((l) => l.stage === 'won').length

      case 'sales_won':
        return mine(inWindow.sales).filter((s) => s.stage === 'won').length

      case 'sales_value':
        return mine(inWindow.sales)
          .filter((s) => s.stage === 'won' && serviceMatch(s.serviceId))
          .reduce((n, s) => n + s.value.baseMinor, 0)

      case 'projects_completed':
        return snap.projects.filter(
          (p) => p.status === 'completed' && within(p.endDate, period),
        ).length

      case 'tasks_completed':
        return snap.tasks.filter(
          (t) =>
            t.status === 'done' &&
            within(t.completedAt?.slice(0, 10), period) &&
            (goal.scope !== 'individual' || !goal.ownerUid || t.assigneeUid === goal.ownerUid),
        ).length

      case 'affiliate_revenue':
        return inWindow.commissions.reduce((n, c) => n + c.baseAmountBaseMinor, 0)

      default:
        return goal.manualValue ?? 0
    }
  })()

  const target = goal.target || 1
  const percent = Math.min(999, Math.round((current / target) * 100))

  const start = Date.parse(goal.startDate)
  const end = Date.parse(goal.endDate)
  const now = Date.now()
  const elapsed = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 1

  return {
    goal,
    current,
    percent,
    isMoney: MONEY_METRICS.includes(goal.metric),
    onTrack: current / target >= elapsed - 0.05,
    daysLeft: Math.ceil((end - now) / 86_400_000),
  }
}

/** Which metrics a goal type counts in money, for formatting. */
export const isMoneyMetric = (metric: GoalMetric) => MONEY_METRICS.includes(metric)

/* ------------------------------------------------------------------ *
 * Performance
 * ------------------------------------------------------------------ */

export type KpiValues = Record<KpiMetric, number>

/**
 * One person's numbers.
 *
 * No score and no ranking: a developer's task count and a salesperson's
 * revenue are not the same axis, and averaging them into one figure would
 * produce a number that is precise and meaningless. The role decides which of
 * these are shown; this function computes all of them.
 */
export function kpisFor(uid: string, snap: Snapshot, period: Period): KpiValues {
  const inWindow = slice(snap, period)
  const today = iso(new Date())

  const myLeads = inWindow.leads.filter((l) => l.assigneeUid === uid || l.createdBy === uid)
  const mySales = inWindow.sales.filter((s) => s.ownerUid === uid)
  const myTasks = snap.tasks.filter((t) => t.assigneeUid === uid)

  const wonSaleIds = new Set(mySales.filter((s) => s.stage === 'won').map((s) => s.id))

  return {
    leads_created: myLeads.length,
    leads_converted: myLeads.filter((l) => l.stage === 'won').length,
    sales_won: mySales.filter((s) => s.stage === 'won').length,
    sales_value: mySales
      .filter((s) => s.stage === 'won')
      .reduce((n, s) => n + s.value.baseMinor, 0),
    revenue_generated: inWindow.payments
      .filter(
        (p) =>
          INCOME_TYPES.includes(p.type) &&
          (p.employeeUid === uid || (p.saleId && wonSaleIds.has(p.saleId))),
      )
      .reduce((n, p) => n + p.amount.baseMinor, 0),
    tasks_completed: myTasks.filter(
      (t) => t.status === 'done' && within(t.completedAt?.slice(0, 10), period),
    ).length,
    tasks_overdue: myTasks.filter(
      (t) => t.status !== 'done' && t.status !== 'cancelled' && t.dueDate && t.dueDate < today,
    ).length,
    projects_completed: snap.projects.filter(
      (p) => p.status === 'completed' && (p.ownerUid === uid || p.teamUids?.includes(uid)),
    ).length,
    commission_generated: inWindow.commissions
      .filter((c) => snap.affiliates.find((a) => a.id === c.affiliateId)?.employeeUid === uid)
      .reduce((n, c) => n + c.amountBaseMinor, 0),
  }
}

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

/**
 * How far along a project is.
 *
 * Milestones first when it has them, otherwise tasks. A project with neither
 * reports null rather than zero: "no way to tell" and "nothing done" are
 * different answers, and showing an empty progress bar for the first one is a
 * lie the manager will act on.
 */
export function projectProgress(project: Project, tasks: Task[]): number | null {
  const milestones = project.milestones ?? []
  if (milestones.length > 0) {
    return Math.round((milestones.filter((m) => m.done).length / milestones.length) * 100)
  }

  const mine = tasks.filter((t) => t.projectId === project.id && t.status !== 'cancelled')
  if (mine.length === 0) return null

  return Math.round((mine.filter((t) => t.status === 'done').length / mine.length) * 100)
}

/** What a project earned, cost and is still owed, from the client ledger. */
export function projectFigures(projectId: string, work: WorkItem[]) {
  const mine = work.filter((w) => w.projectId === projectId)

  return {
    earnedBaseMinor: mine.reduce((n, w) => n + w.revenue.baseMinor, 0),
    spentBaseMinor: mine.reduce((n, w) => n + w.cost.baseMinor, 0),
    profitBaseMinor: mine.reduce((n, w) => n + w.profitBaseMinor, 0),
    unpaidBaseMinor: mine
      .filter((w) => w.paymentStatus !== 'paid')
      .reduce((n, w) => n + w.revenue.baseMinor, 0),
  }
}

/** The affiliate record for an employee, when they have one. */
export const affiliateOf = fetchAffiliate
