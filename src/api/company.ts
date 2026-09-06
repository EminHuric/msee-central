/**
 * Goals, role KPIs and the calendar.
 *
 * What these share: they describe the company rather than record its work.
 * None of them holds a figure of its own — a goal knows what to count, not
 * what the count is, and the calendar merges dates that already live on tasks,
 * contracts and invoices instead of copying them.
 *
 * The copying is the point. A deadline stored twice is a deadline that will be
 * moved in one place and not the other, and then nobody trusts either.
 */

import { logAudit } from './audit'
import { readAll, readOne, remove, write } from './store'
import { getDb } from '@/lib/firebase'
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import type { Task } from '@/types/business'
import {
  DEFAULT_KPIS,
  type CalendarEvent,
  type CalendarItem,
  type Goal,
  type KpiMetric,
  type RoleKpiSet,
} from '@/types/company'
import type { Contract, Invoice } from '@/types/revenue'

/* ------------------------------------------------------------------ *
 * Goals
 * ------------------------------------------------------------------ */

export const fetchGoals = () => readAll<Goal>('goals')

export const fetchGoal = (id: string) => readOne<Goal>('goals', id)

export async function saveGoal(input: Goal): Promise<string> {
  const isNew = !input.id
  const id = await write('goals', input)

  await logAudit({
    action: isNew ? 'goal.created' : 'goal.updated',
    targetType: 'goal',
    targetId: id,
    targetLabel: input.title,
    metadata: { metric: input.metric, target: input.target, scope: input.scope },
  })

  return id
}

export async function deleteGoal(goal: Goal): Promise<void> {
  await remove('goals', goal.id)
  await logAudit({
    action: 'goal.deleted',
    targetType: 'goal',
    targetId: goal.id,
    targetLabel: goal.title,
  })
}

/* ------------------------------------------------------------------ *
 * Role KPIs
 *
 * Which numbers a job is judged on, stored per role rather than per person.
 * A developer and a salesperson are not comparable on one score, and the way
 * to avoid inventing one is to never store one.
 * ------------------------------------------------------------------ */

export async function fetchRoleKpis(): Promise<Record<string, KpiMetric[]>> {
  try {
    const snap = await getDocs(collection(getDb(), 'roleKpis'))
    const out: Record<string, KpiMetric[]> = {}
    for (const d of snap.docs) out[d.id] = (d.data() as RoleKpiSet).metrics ?? []
    return out
  } catch {
    return {}
  }
}

export async function fetchRoleKpi(roleId: string): Promise<KpiMetric[]> {
  try {
    const snap = await getDoc(doc(getDb(), 'roleKpis', roleId))
    return snap.exists() ? ((snap.data() as RoleKpiSet).metrics ?? []) : [...DEFAULT_KPIS]
  } catch {
    return [...DEFAULT_KPIS]
  }
}

export async function saveRoleKpi(roleId: string, metrics: KpiMetric[]): Promise<void> {
  await setDoc(doc(getDb(), 'roleKpis', roleId), {
    roleId,
    metrics,
    updatedAt: new Date().toISOString(),
  } satisfies RoleKpiSet)
}

/* ------------------------------------------------------------------ *
 * Calendar
 * ------------------------------------------------------------------ */

export const fetchEvents = () => readAll<CalendarEvent>('calendarEvents', 'date', 'asc')

export async function saveEvent(input: CalendarEvent): Promise<string> {
  const isNew = !input.id
  const id = await write('calendarEvents', input)

  if (isNew) {
    await logAudit({
      action: 'event.created',
      targetType: 'event',
      targetId: id,
      targetLabel: input.title,
      metadata: { date: input.date, kind: input.kind },
    })
  }

  return id
}

export async function deleteEvent(event: CalendarEvent): Promise<void> {
  await remove('calendarEvents', event.id)
  await logAudit({
    action: 'event.deleted',
    targetType: 'event',
    targetId: event.id,
    targetLabel: event.title,
  })
}

export interface CalendarSources {
  events: CalendarEvent[]
  tasks: Task[]
  contracts: Contract[]
  invoices: Invoice[]
  /** Unpaid work with a due date: {id, clientId, label, dueDate}. */
  dueWork: { id: string; clientId: string; label: string; dueDate: string }[]
  /** Whose calendar it is. An event with attendees is only theirs. */
  uid: string
}

/**
 * Everything with a date, in one list.
 *
 * Four of the five sources are derived: a task deadline belongs to the task, a
 * renewal belongs to the contract. They appear here, they link back to where
 * they live, and editing them means editing the record — which is the only way
 * a calendar and the rest of a system stay in agreement.
 */
export function buildCalendar(sources: CalendarSources): CalendarItem[] {
  const out: CalendarItem[] = []

  for (const event of sources.events) {
    const attendees = event.attendeeUids ?? []
    if (attendees.length > 0 && !attendees.includes(sources.uid)) continue

    out.push({
      id: `event-${event.id}`,
      date: event.date,
      title: event.title,
      kind: event.kind,
      link: null,
      detail: event.startTime ? `${event.startTime}${event.endTime ? `–${event.endTime}` : ''}` : '',
      derived: false,
      done: false,
    })
  }

  for (const task of sources.tasks) {
    if (!task.dueDate) continue
    out.push({
      id: `task-${task.id}`,
      date: task.dueDate,
      title: task.title,
      kind: 'task',
      link: '/tasks',
      detail: task.assigneeName ?? '',
      derived: true,
      done: task.status === 'done' || task.status === 'cancelled',
    })
  }

  for (const contract of sources.contracts) {
    const when = contract.renewalDate ?? contract.endDate
    if (!when) continue
    out.push({
      id: `contract-${contract.id}`,
      date: when,
      title: `${contract.number} · ${contract.clientName}`,
      kind: 'contract',
      link: '/contracts',
      detail: contract.serviceName ?? '',
      derived: true,
      done: contract.status === 'cancelled' || contract.status === 'expired',
    })
  }

  for (const invoice of sources.invoices) {
    if (!invoice.dueDate) continue
    out.push({
      id: `invoice-${invoice.id}`,
      date: invoice.dueDate,
      title: `${invoice.number} · ${invoice.clientName}`,
      kind: 'payment',
      link: '/finance',
      detail: '',
      derived: true,
      done: invoice.status === 'paid' || invoice.status === 'cancelled',
    })
  }

  for (const item of sources.dueWork) {
    out.push({
      id: `work-${item.id}`,
      date: item.dueDate,
      title: item.label,
      kind: 'payment',
      link: `/clients/${item.clientId}`,
      detail: '',
      derived: true,
      done: false,
    })
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))
}

/** The grid a month view draws: whole weeks, Monday first, with padding. */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(Date.UTC(year, month, 1))
  /* JavaScript starts the week on Sunday; this calendar starts on Monday. */
  const lead = (first.getUTCDay() + 6) % 7
  const start = new Date(first.getTime() - lead * 86_400_000)

  return Array.from({ length: 42 }, (_, i) =>
    new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10),
  )
}
