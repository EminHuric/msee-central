/**
 * Goals, role KPIs and the calendar.
 *
 * What these share: they describe the company rather than record its work.
 * None holds a figure of its own — a goal knows what to count, not what the
 * count is, and the calendar merges dates that already live on payments,
 * projects and notes instead of copying them.
 *
 * The copying is the point. A deadline stored twice is a deadline that will be
 * moved in one place and not the other, and then nobody trusts either.
 */

import { logAudit } from './audit'
import { remove } from './records'
import { readAll, readOne, write } from './store'
import { getDb } from '@/lib/firebase'
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import type { Note, Project } from '@/types/business'
import {
  DEFAULT_KPIS,
  type CalendarEvent,
  type CalendarItem,
  type Goal,
  type KpiMetric,
  type RoleKpiSet,
} from '@/types/company'
import type { Transaction } from '@/types/revenue'

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

export const deleteGoal = (goal: Goal) => remove('goals', goal.id, goal.title)

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

export const deleteEvent = (event: CalendarEvent) =>
  remove('calendarEvents', event.id, event.title)

export interface CalendarSources {
  events: CalendarEvent[]
  /** Anything expected or overdue: dueDate on an unpaid transaction. */
  transactions: Transaction[]
  projects: Project[]
  /** Notes carrying a reminder date, which is as close to a task as this goes. */
  notes: Note[]
  goals: Goal[]
  /** Whose calendar it is. An event with attendees is only theirs. */
  uid: string
}

/**
 * Everything with a date, in one list.
 *
 * Only the first source is stored here. A payment date belongs to the
 * transaction, a deadline to the project, a reminder to the note — they appear
 * in this view, they link back to where they live, and editing one means
 * editing the record. That is the only way a calendar and the rest of a system
 * stay in agreement.
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
      detail: event.startTime
        ? `${event.startTime}${event.endTime ? `–${event.endTime}` : ''}`
        : event.location,
      derived: false,
      done: false,
    })
  }

  for (const tx of sources.transactions) {
    if (!tx.dueDate || tx.status === 'paid') continue
    out.push({
      id: `tx-${tx.id}`,
      date: tx.dueDate,
      title: tx.description || tx.clientName,
      kind: 'payment',
      link: '/finance',
      detail: tx.clientName,
      derived: true,
      done: false,
    })
  }

  for (const project of sources.projects) {
    if (!project.endDate) continue
    out.push({
      id: `project-${project.id}`,
      date: project.endDate,
      title: project.name,
      kind: 'deadline',
      link: `/projects/${project.id}`,
      detail: project.ownerName,
      derived: true,
      done: project.status === 'completed' || project.status === 'cancelled',
    })
  }

  for (const note of sources.notes) {
    if (!note.dueDate) continue
    out.push({
      id: `note-${note.id}`,
      date: note.dueDate,
      title: note.body.slice(0, 80),
      kind: 'reminder',
      link: null,
      detail: note.authorName,
      derived: true,
      done: note.done,
    })
  }

  for (const goal of sources.goals) {
    if (!goal.endDate || goal.status !== 'active') continue
    out.push({
      id: `goal-${goal.id}`,
      date: goal.endDate,
      title: goal.title,
      kind: 'goal',
      link: '/goals',
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
