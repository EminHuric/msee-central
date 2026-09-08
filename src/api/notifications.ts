/**
 * The notification centre.
 *
 * Two sources feed the bell, and they behave differently on purpose:
 *
 *   STORED    something a person did that another person should know about —
 *             a task assigned, an announcement sent, a commission approved.
 *             Written to `notifications/{uid}/items` at the moment it happens,
 *             because nobody can reconstruct later that it happened.
 *
 *   DERIVED   something that became true because a date passed — a payment is
 *             overdue, a contract expires next week. These are NOT stored.
 *             They are computed from the records that already hold the date,
 *             so they appear the moment they are true, disappear the moment
 *             they are dealt with, and can never accumulate as stale rows
 *             announcing a deadline that was met weeks ago.
 *
 * The second half is what stops a notification centre becoming a graveyard.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit as limitTo,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from 'firebase/firestore'

import { getDb } from '@/lib/firebase'
import { actor, newId } from './store'
import type { Note, Project } from '@/types/business'
import type {
  AppNotification,
  NotificationKind,
  NotificationPreferences,
  NotificationPriority,
} from '@/types/company'
import type { Transaction } from '@/types/revenue'

/* ------------------------------------------------------------------ *
 * Stored notifications
 * ------------------------------------------------------------------ */

function itemsPath(uid: string) {
  return collection(getDb(), 'notifications', uid, 'items')
}

export async function fetchNotifications(uid: string, max = 60): Promise<AppNotification[]> {
  try {
    const snap = await getDocs(query(itemsPath(uid), orderBy('createdAt', 'desc'), limitTo(max)))
    return snap.docs.map((d) => ({ ...(d.data() as AppNotification), id: d.id }))
  } catch {
    return []
  }
}

export interface NotifyInput {
  kind: NotificationKind
  priority?: NotificationPriority
  title: string
  body?: string
  link?: string | null
}

/**
 * Tell one person something.
 *
 * Never throws and never blocks: a notification that fails to send must not
 * roll back the task that was just assigned. The same reasoning as the audit
 * log, and the same trade-off.
 */
export async function notify(uid: string, input: NotifyInput): Promise<void> {
  if (!uid) return
  const me = actor()

  try {
    const id = newId()
    await setDoc(doc(itemsPath(uid), id), {
      id,
      kind: input.kind,
      priority: input.priority ?? 'normal',
      title: input.title,
      body: input.body ?? '',
      link: input.link ?? null,
      read: false,
      createdAt: new Date().toISOString(),
      actorUid: me.uid,
      actorName: me.name,
    })
  } catch {
    /* Deliberately swallowed — see the note above. */
  }
}

/** Tell several people the same thing. Yourself is skipped. */
export async function notifyMany(uids: string[], input: NotifyInput): Promise<void> {
  const me = actor()
  await Promise.all(uids.filter((uid) => uid && uid !== me.uid).map((uid) => notify(uid, input)))
}

export async function markRead(uid: string, id: string): Promise<void> {
  await setDoc(doc(itemsPath(uid), id), { read: true }, { merge: true })
}

export async function markAllRead(uid: string, items: AppNotification[]): Promise<void> {
  const unread = items.filter((n) => !n.read)
  if (unread.length === 0) return

  const batch = writeBatch(getDb())
  for (const item of unread) batch.set(doc(itemsPath(uid), item.id), { read: true }, { merge: true })
  await batch.commit()
}

export const dismiss = (uid: string, id: string) => deleteDoc(doc(itemsPath(uid), id))

/* ------------------------------------------------------------------ *
 * Preferences
 * ------------------------------------------------------------------ */

export async function fetchPreferences(uid: string): Promise<NotificationPreferences> {
  try {
    const snap = await getDoc(doc(getDb(), 'notificationPrefs', uid))
    if (snap.exists()) return snap.data() as NotificationPreferences
  } catch {
    /* Nobody has set preferences yet, or the read was refused. */
  }
  return { uid, muted: [], updatedAt: '' }
}

export async function savePreferences(prefs: NotificationPreferences): Promise<void> {
  await setDoc(doc(getDb(), 'notificationPrefs', prefs.uid), {
    ...prefs,
    updatedAt: new Date().toISOString(),
  })
}

/* ------------------------------------------------------------------ *
 * Derived notifications
 * ------------------------------------------------------------------ */

export interface DerivedSource {
  /** Anything expected and not yet paid. */
  transactions: Transaction[]
  projects: Project[]
  /** Reminder notes belonging to the person this is for. */
  notes: Note[]
  /** Sales still waiting on the advance they were sold on. */
  advanceDue: { id: string; label: string; clientName: string }[]
  uid: string
}

/**
 * Everything that is true right now because of a date.
 *
 * Returned with ids that are stable for the same underlying record, so the
 * list does not reshuffle between renders, and with no read state — these
 * cannot be dismissed, because the only way to clear one is to deal with the
 * thing it is about. That is what stops a notification centre becoming a
 * graveyard of deadlines that were met weeks ago.
 */
export function deriveNotifications(source: DerivedSource): AppNotification[] {
  const now = new Date().toISOString().slice(0, 10)
  const soon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const out: AppNotification[] = []

  const add = (
    id: string,
    kind: NotificationKind,
    priority: NotificationPriority,
    title: string,
    body: string,
    link: string | null,
  ) =>
    out.push({ id, kind, priority, title, body, link, read: false, createdAt: now, actorName: '' })

  for (const tx of source.transactions) {
    if (tx.status === 'paid' || !tx.dueDate) continue

    if (tx.dueDate < now) {
      add(
        `tx-late-${tx.id}`,
        'payment_overdue',
        'critical',
        tx.description || tx.clientName,
        tx.dueDate,
        '/finance',
      )
    } else if (tx.dueDate <= soon) {
      add(
        `tx-soon-${tx.id}`,
        'payment_received',
        'normal',
        tx.description || tx.clientName,
        tx.dueDate,
        '/finance',
      )
    }
  }

  for (const sale of source.advanceDue) {
    add(`adv-${sale.id}`, 'payment_overdue', 'important', sale.label, sale.clientName, '/sales')
  }

  for (const project of source.projects) {
    if (!project.endDate) continue
    if (project.status === 'completed' || project.status === 'cancelled') continue
    if (project.ownerUid !== source.uid && !project.teamUids?.includes(source.uid)) continue

    if (project.endDate < now) {
      add(
        `proj-late-${project.id}`,
        'project_deadline',
        'important',
        project.name,
        project.endDate,
        `/projects/${project.id}`,
      )
    } else if (project.endDate <= soon) {
      add(
        `proj-soon-${project.id}`,
        'project_deadline',
        'normal',
        project.name,
        project.endDate,
        `/projects/${project.id}`,
      )
    }
  }

  for (const note of source.notes) {
    if (note.done || !note.dueDate || note.authorUid !== source.uid) continue
    if (note.dueDate > now) continue
    add(`note-${note.id}`, 'lead_stale', 'normal', note.body.slice(0, 80), note.dueDate, null)
  }

  const rank: Record<NotificationPriority, number> = {
    critical: 0,
    important: 1,
    normal: 2,
    info: 3,
  }
  return out.sort((a, b) => rank[a.priority] - rank[b.priority])
}
