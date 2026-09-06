/**
 * The shared read/write layer every module sits on.
 *
 * Firestore access in this application follows one shape: read a collection in
 * order, or write a document that stamps who touched it and when. Writing that
 * out per module produced files differing only in a collection name, so it
 * lives here once.
 *
 * Two conventions worth knowing before using it:
 *
 *   1. A blank `id` means create. The id comes back either way, so a caller
 *      never has to know which happened.
 *   2. Reads return `[]` when the rules refuse them. That is deliberate —
 *      a screen a person may only partly see should render the part they may
 *      see, not an error. Permission is enforced by the rules; this only
 *      decides how a refusal looks.
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
  | 'leads'
  | 'sales'
  | 'contracts'
  | 'invoices'
  | 'payments'
  | 'projects'
  | 'tasks'
  | 'services'
  | 'expenses'
  | 'affiliates'
  | 'commissions'
  | 'goals'
  | 'roleKpis'
  | 'calendarEvents'
  | 'chatThreads'

export interface Stamped {
  id: string
  createdAt?: string
  createdBy?: string
  updatedAt?: string
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

/** Read a whole collection, ordered. Empty when the rules refuse it. */
export async function readAll<T>(
  name: CollectionName,
  field = 'updatedAt',
  dir: 'asc' | 'desc' = 'desc',
  max = 500,
): Promise<T[]> {
  try {
    const snap = await getDocs(
      query(collection(getDb(), name), orderBy(field, dir), limitTo(max)),
    )
    return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }))
  } catch {
    return []
  }
}

/** Read with extra constraints — the "records that are mine" case. */
export async function readWhere<T>(
  name: CollectionName,
  ...constraints: QueryConstraint[]
): Promise<T[]> {
  try {
    const snap = await getDocs(query(collection(getDb(), name), ...constraints))
    return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }))
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

/**
 * Create or update one document.
 *
 * `createdAt` and `createdBy` are written once and never again, so an edit can
 * never rewrite who first entered a record — which is exactly what somebody
 * covering their tracks would want to do.
 */
export async function write<T extends Stamped>(
  name: CollectionName,
  input: T,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const isNew = !input.id
  const id = input.id || newId()
  const now = new Date().toISOString()
  const me = actor()

  await setDoc(
    doc(getDb(), name, id),
    {
      ...input,
      ...extra,
      id,
      ...(isNew ? { createdAt: now, createdBy: me.uid } : {}),
      updatedAt: now,
    },
    { merge: true },
  )

  return id
}

export function remove(name: CollectionName, id: string): Promise<void> {
  return deleteDoc(doc(getDb(), name, id))
}

/** Re-exported so modules do not each import from firebase directly. */
export { where, orderBy, limitTo }
