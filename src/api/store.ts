/**
 * The shared read/write layer every module sits on.
 *
 * Firestore access here follows one shape: read a collection in order, or
 * write a document that stamps who touched it and when. Writing that out per
 * module produced files differing only in a collection name.
 *
 * Four conventions worth knowing before using it:
 *
 *   1. A blank `id` means create. The id comes back either way, so a caller
 *      never has to know which happened.
 *   2. Reads return `[]` when the rules refuse them. A screen somebody may
 *      only partly see should render the part they may see, not an error.
 *      Permission is enforced by the rules; this decides how a refusal looks.
 *   3. `createdAt` and `createdBy` are written once and never again, so an
 *      edit cannot rewrite who first entered a record.
 *   4. Deleting sets `deletedAt`. Every read filters it out, the recycle bin
 *      selects on it, and restoring clears it. Destroying a document for good
 *      is `purge`, which is a different permission and a different function.
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
  where,
  type QueryConstraint,
} from 'firebase/firestore'

import { getDb } from '@/lib/firebase'
import { useAuthStore } from '@/stores/auth'

/** Every top-level collection the application writes. */
export type CollectionName =
  | 'clients'
  | 'leads'
  | 'projects'
  | 'sales'
  | 'services'
  | 'transactions'
  | 'affiliates'
  | 'commissions'
  | 'goals'
  | 'roleKpis'
  | 'bonusPrograms'
  | 'bonusAwards'
  | 'incentiveWork'
  | 'calendarEvents'
  | 'notes'
  | 'activity'
  | 'customFields'

export interface Stamped {
  id: string
  createdAt?: string
  createdBy?: string
  updatedAt?: string
}

export interface Deletable extends Stamped {
  deletedAt?: string | null
}

/** A Firestore-generated id, obtained without writing anything. */
export function newId(): string {
  return doc(collection(getDb(), '_')).id
}

export function actor(): { uid: string; name: string } {
  const auth = useAuthStore()
  return {
    uid: auth.uid ?? 'unknown',
    name: auth.displayName ?? auth.email ?? 'unknown',
  }
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function now(): string {
  return new Date().toISOString()
}

/**
 * Read a collection, ordered, with deleted records left out.
 *
 * Filtered here in memory rather than with a `where` clause: Firestore cannot
 * combine an inequality on one field with an order on another without a
 * composite index per pairing, and a collection this size does not need one.
 * The rules still decide what comes back at all.
 */
export async function readAll<T extends Deletable>(
  name: CollectionName,
  field = 'updatedAt',
  dir: 'asc' | 'desc' = 'desc',
  max = 1000,
): Promise<T[]> {
  try {
    const snap = await getDocs(query(collection(getDb(), name), orderBy(field, dir), limitTo(max)))
    return snap.docs
      .map((d) => ({ ...(d.data() as T), id: d.id }))
      .filter((row) => !row.deletedAt)
  } catch {
    return []
  }
}

/** Everything in the recycle bin for one collection. */
export async function readDeleted<T extends Deletable>(
  name: CollectionName,
  max = 500,
): Promise<T[]> {
  try {
    const snap = await getDocs(query(collection(getDb(), name), limitTo(max)))
    return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id })).filter((row) => row.deletedAt)
  } catch {
    return []
  }
}

/** Read with extra constraints — the "records that are mine" case. */
export async function readWhere<T extends Deletable>(
  name: CollectionName,
  ...constraints: QueryConstraint[]
): Promise<T[]> {
  try {
    const snap = await getDocs(query(collection(getDb(), name), ...constraints))
    return snap.docs
      .map((d) => ({ ...(d.data() as T), id: d.id }))
      .filter((row) => !row.deletedAt)
  } catch {
    return []
  }
}

export async function readOne<T>(name: CollectionName, id: string): Promise<T | null> {
  try {
    const snap = await getDoc(doc(getDb(), name, id))
    return snap.exists() ? ({ ...(snap.data() as T), id: snap.id } as T) : null
  } catch {
    return null
  }
}

/** Create or update one document. */
export async function write<T extends Stamped>(
  name: CollectionName,
  input: T,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const isNew = !input.id
  const id = input.id || newId()
  const me = actor()
  const stamp = now()

  await setDoc(
    doc(getDb(), name, id),
    {
      ...input,
      ...extra,
      id,
      ...(isNew ? { createdAt: stamp, createdBy: me.uid, deletedAt: null } : {}),
      updatedAt: stamp,
    },
    { merge: true },
  )

  return id
}

/**
 * Move a record to the recycle bin.
 *
 * The rules accept this as an update touching only the bin fields, which is
 * how `delete` and `edit` can be held by different people: somebody may
 * correct a phone number without being able to make the record disappear.
 */
export async function softDelete(name: CollectionName, id: string): Promise<void> {
  const me = actor()
  await setDoc(
    doc(getDb(), name, id),
    { deletedAt: now(), deletedBy: me.uid, deletedByName: me.name, updatedAt: now() },
    { merge: true },
  )
}

export async function restore(name: CollectionName, id: string): Promise<void> {
  await setDoc(
    doc(getDb(), name, id),
    { deletedAt: null, deletedBy: null, deletedByName: '', updatedAt: now() },
    { merge: true },
  )
}

/** Destroy a document. Guarded by `recycle_bin.purge` in the rules. */
export function purge(name: CollectionName, id: string): Promise<void> {
  return deleteDoc(doc(getDb(), name, id))
}

/** Re-exported so modules do not each import from firebase directly. */
export { where, orderBy, limitTo }
