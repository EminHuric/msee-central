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
  | 'walletEntries'
  | 'intake'
  | 'attribution'
  | 'reservations'
  | 'staybrainListings'
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
/**
 * Say why a read came back with nothing.
 *
 * Every reader here returns `[]` when the query fails, which keeps a broken
 * screen from being a blank screen — but it also makes two completely different
 * situations look identical: "this client has no bookings" and "that query
 * cannot run". A missing composite index is the common cause and the worst one,
 * because Firestore does not create those on demand: the query throws, the
 * catch swallows it, and a panel that works perfectly shows an empty list for
 * ever. It happened here to the monthly attribution list.
 *
 * So failures are named. `failed-precondition` is the index case and gets the
 * sentence that tells somebody what to do about it.
 */
function reportQueryFailure(name: string, error: unknown): void {
  const code = (error as { code?: string }).code ?? ''
  const detail = (error as { message?: string }).message ?? String(error)

  if (code === 'permission-denied') {
    console.warn(`[store] ${name}: refused by the security rules.`)
    return
  }

  if (code === 'failed-precondition') {
    console.error(
      `[store] ${name}: this query needs a composite index and does not have one. ` +
        `Either add it to firebase/firestore.indexes.json and deploy, or drop the ` +
        `orderBy and sort the rows in memory. Until then this list is always empty.\n` +
        detail,
    )
    return
  }

  console.error(`[store] ${name}: ${detail}`)
}

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
  } catch (error) {
    reportQueryFailure(`readAll(${name})`, error)
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
  } catch (error) {
    reportQueryFailure(`readDeleted(${name})`, error)
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
  } catch (error) {
    reportQueryFailure(`readWhere(${name})`, error)
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
  /*
   * "New" means the record is being created now — not that no id was supplied.
   *
   * Those were treated as the same thing, and they are not. A caller that
   * picks the id itself — a readable slug for a client, `newId()` for an award
   * — was handing this function an id, so it concluded the record already
   * existed and skipped the creation stamps entirely.
   *
   * The result was a client saved with `createdBy: ''`. Firestore's rules
   * decide who may read a record they do not own by comparing `createdBy` to
   * the signed-in user, so the person who had just created it was refused it.
   * From their side the record was saved and then was not there: which reads
   * exactly like a save that failed.
   *
   * `createdAt` is the honest signal. Every blank-record factory leaves it
   * empty and every stored record has one, so a missing value means this write
   * is the first.
   */
  const isNew = !input.id || !input.createdAt
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
 * Change named fields on a record that already exists.
 *
 * Separate from `write` because `write` has to decide whether a record is new,
 * and it decides by looking for `createdAt`. A partial object has no
 * `createdAt`, so `write` would conclude this is a creation and stamp the
 * record as created now — moving its birthday every time a field changed.
 *
 * Nothing here invents a document: a patch to an id that does not exist would
 * create a record with only these fields, so callers pass an id they have read.
 */
export async function patch(
  name: CollectionName,
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await setDoc(doc(getDb(), name, id), { ...fields, updatedAt: now() }, { merge: true })
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
