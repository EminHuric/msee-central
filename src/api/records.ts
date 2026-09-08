/**
 * The four things that cut across every module: activity, notes, custom
 * fields, and the recycle bin.
 *
 * They share a file because they share a shape — none of them belongs to one
 * kind of record, all of them attach to any kind — and because a screen that
 * shows a client usually wants three of the four at once.
 */

import { collection, getDocs, limit as limitTo, orderBy, query, where } from 'firebase/firestore'

import { getDb } from '@/lib/firebase'
import {
  actor,
  newId,
  now,
  purge,
  readAll,
  readDeleted,
  restore as restoreDoc,
  softDelete,
  write,
  type CollectionName,
} from './store'
import { logAudit } from './audit'
import type { Note, NoteEntity } from '@/types/business'
import {
  RECOVERABLE,
  RETENTION_DAYS,
  type ActivityEntry,
  type ActivityKind,
  type CustomFieldDef,
  type DeletedRecord,
  type FieldEntity,
  type RecoverableCollection,
} from '@/types/records'

/* ------------------------------------------------------------------ *
 * Activity
 * ------------------------------------------------------------------ */

/**
 * Record what just happened to something.
 *
 * Never throws. A failed activity write must not roll back the thing the user
 * was actually doing — losing one line of history is bad, leaving the record
 * half-saved because the history failed is worse.
 */
export async function logActivity(input: {
  entity: string
  entityId: string
  entityLabel: string
  kind: ActivityKind
  summary: string
  detail?: string
}): Promise<void> {
  const me = actor()

  try {
    const id = newId()
    await write('activity', {
      id,
      entity: input.entity,
      entityId: input.entityId,
      entityLabel: input.entityLabel,
      kind: input.kind,
      summary: input.summary,
      detail: input.detail ?? '',
      actorUid: me.uid,
      actorName: me.name,
      createdAt: now(),
    } as unknown as ActivityEntry & { id: string })
  } catch {
    /* Deliberately swallowed — see the note above. */
  }
}

/** Everything that happened to one record, newest first. */
export async function fetchActivityFor(entity: string, entityId: string): Promise<ActivityEntry[]> {
  try {
    const snap = await getDocs(
      query(
        collection(getDb(), 'activity'),
        where('entity', '==', entity),
        where('entityId', '==', entityId),
        limitTo(100),
      ),
    )
    return snap.docs
      .map((d) => ({ ...(d.data() as ActivityEntry), id: d.id }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

/** The company's recent activity, for the dashboard. */
export async function fetchRecentActivity(max = 40): Promise<ActivityEntry[]> {
  try {
    const snap = await getDocs(
      query(collection(getDb(), 'activity'), orderBy('createdAt', 'desc'), limitTo(max)),
    )
    return snap.docs.map((d) => ({ ...(d.data() as ActivityEntry), id: d.id }))
  } catch {
    return []
  }
}

/** One person's activity, for their profile and workspace. */
export async function fetchActivityBy(uid: string, max = 30): Promise<ActivityEntry[]> {
  try {
    const snap = await getDocs(
      query(collection(getDb(), 'activity'), where('actorUid', '==', uid), limitTo(max)),
    )
    return snap.docs
      .map((d) => ({ ...(d.data() as ActivityEntry), id: d.id }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

/* ------------------------------------------------------------------ *
 * Notes
 *
 * What replaced the task module. A note with a date is as close to a task as
 * this system goes, and it lives where somebody would actually look for it —
 * on the client, not in a separate list to keep up to date.
 * ------------------------------------------------------------------ */

export async function fetchNotes(entity: NoteEntity, entityId: string): Promise<Note[]> {
  try {
    const snap = await getDocs(
      query(
        collection(getDb(), 'notes'),
        where('entity', '==', entity),
        where('entityId', '==', entityId),
        limitTo(200),
      ),
    )
    return snap.docs
      .map((d) => ({ ...(d.data() as Note), id: d.id }))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return b.createdAt.localeCompare(a.createdAt)
      })
  } catch {
    return []
  }
}

/** Every note with a reminder date, for the calendar and the workspace. */
export async function fetchDatedNotes(): Promise<Note[]> {
  try {
    const snap = await getDocs(query(collection(getDb(), 'notes'), limitTo(500)))
    return snap.docs
      .map((d) => ({ ...(d.data() as Note), id: d.id }))
      .filter((n) => !!n.dueDate)
  } catch {
    return []
  }
}

export async function saveNote(input: Note): Promise<string> {
  const me = actor()
  return write('notes', {
    ...input,
    authorUid: input.authorUid || me.uid,
    authorName: input.authorName || me.name,
  })
}

export const deleteNote = (id: string) => purge('notes', id)

/* ------------------------------------------------------------------ *
 * Custom fields
 * ------------------------------------------------------------------ */

export const fetchFieldDefs = () => readAll<CustomFieldDef>('customFields', 'order', 'asc')

/** The active fields for one kind of record, in the order the CEO set. */
export function fieldsFor(defs: CustomFieldDef[], entity: FieldEntity): CustomFieldDef[] {
  return defs
    .filter((f) => f.entity === entity && f.active)
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
}

export async function saveFieldDef(input: CustomFieldDef): Promise<string> {
  const isNew = !input.id
  const id = await write('customFields', input)

  await logAudit({
    action: 'settings.updated',
    targetType: 'settings',
    targetId: id,
    targetLabel: input.label,
    metadata: { entity: input.entity, type: input.type, new: isNew },
  })

  return id
}

export const deleteFieldDef = (id: string) => purge('customFields', id)

/* ------------------------------------------------------------------ *
 * The recycle bin
 * ------------------------------------------------------------------ */

/** How a deleted record of each kind is labelled in the bin. */
const LABELS: Record<RecoverableCollection, (row: Record<string, unknown>) => [string, string]> = {
  clients: (r) => [String(r.name ?? ''), String(r.contactName ?? '')],
  leads: (r) => [String(r.company || r.name || ''), String(r.serviceInterest ?? '')],
  projects: (r) => [String(r.name ?? ''), String(r.objective ?? '')],
  sales: (r) => [String(r.title ?? ''), String(r.clientName ?? '')],
  services: (r) => [String(r.name ?? ''), String(r.category ?? '')],
  transactions: (r) => [String(r.description ?? ''), String(r.type ?? '')],
  goals: (r) => [String(r.title ?? ''), String(r.metric ?? '')],
  affiliates: (r) => [String(r.name ?? ''), String(r.type ?? '')],
  calendarEvents: (r) => [String(r.title ?? ''), String(r.date ?? '')],
  bonusPrograms: (r) => [String(r.name ?? ''), String(r.metric ?? '')],
  incentiveWork: (r) => [String(r.title ?? ''), String(r.assigneeName ?? '')],
}

/**
 * Everything currently in the bin, across every collection.
 *
 * Read collection by collection rather than through one query, because
 * Firestore has no cross-collection read and inventing a mirror collection
 * would mean two copies of every deleted record to keep in step.
 */
export async function fetchBin(retentionDays = RETENTION_DAYS): Promise<DeletedRecord[]> {
  const results = await Promise.all(
    RECOVERABLE.map(async (name) => {
      const rows = await readDeleted<Record<string, unknown> & { id: string }>(
        name as CollectionName,
      )

      return rows.map((row) => {
        const [label, detail] = LABELS[name](row)
        const deletedAt = String(row.deletedAt ?? '')
        const age = (Date.now() - Date.parse(deletedAt)) / 86_400_000

        return {
          id: row.id,
          collection: name,
          label: label || row.id,
          detail,
          deletedAt,
          deletedByName: String(row.deletedByName ?? ''),
          daysLeft: Math.ceil(retentionDays - age),
        } satisfies DeletedRecord
      })
    }),
  )

  return results.flat().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
}

/**
 * Delete a record: move it to the bin, and say so in both histories.
 *
 * The audit log records that somebody deleted something; the activity feed
 * records it against the record itself, so whoever looks at the client later
 * can see where the missing sale went.
 */
export async function remove(
  name: RecoverableCollection,
  id: string,
  label: string,
): Promise<void> {
  await softDelete(name as CollectionName, id)

  await logAudit({
    action: 'record.deleted',
    targetType: 'settings',
    targetId: id,
    targetLabel: label,
    metadata: { collection: name },
  })

  await logActivity({
    entity: name,
    entityId: id,
    entityLabel: label,
    kind: 'deleted',
    summary: label,
  })
}

export async function restoreRecord(record: DeletedRecord): Promise<void> {
  await restoreDoc(record.collection as CollectionName, record.id)

  await logAudit({
    action: 'record.restored',
    targetType: 'settings',
    targetId: record.id,
    targetLabel: record.label,
    metadata: { collection: record.collection },
  })

  await logActivity({
    entity: record.collection,
    entityId: record.id,
    entityLabel: record.label,
    kind: 'restored',
    summary: record.label,
  })
}

/**
 * Destroy a record for good.
 *
 * Guarded by its own permission, and logged before the document goes — after
 * it is gone there is nothing left to name in the entry.
 */
export async function purgeRecord(record: DeletedRecord): Promise<void> {
  await logAudit({
    action: 'record.purged',
    targetType: 'settings',
    targetId: record.id,
    targetLabel: record.label,
    metadata: { collection: record.collection, deletedAt: record.deletedAt },
  })

  await purge(record.collection as CollectionName, record.id)
}

/** Records past the retention window, which is what "empty the bin" means. */
export const expired = (rows: DeletedRecord[]) => rows.filter((r) => r.daysLeft <= 0)
