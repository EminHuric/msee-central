/**
 * Everything filed under one client.
 *
 * The point of the dossier is that opening a client answers every question
 * about them without going anywhere else, so this module reads the whole
 * subtree at once rather than making each tab fetch its own slice.
 *
 * Profit is never accepted from the caller. It is recomputed on every save
 * from revenue minus cost, because a stored figure somebody can type over is
 * a figure that will eventually disagree with the two it came from.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore'

import { logAudit } from './audit'
import { getDb } from '@/lib/firebase'
import { useAuthStore } from '@/stores/auth'
import type {
  ClientActivity,
  ClientNote,
  ClientService,
  Instalment,
  PaymentStatus,
  SpecialOffer,
  WorkItem,
} from '@/types/business'
import { type Money } from '@/types/money'

type Sub = 'work' | 'services' | 'instalments' | 'offers' | 'activities' | 'notes'

function path(clientId: string, sub: Sub) {
  return collection(getDb(), 'clients', clientId, sub)
}

function actor(): { uid: string; name: string } {
  const auth = useAuthStore()
  return {
    uid: auth.uid ?? 'unknown',
    name: auth.displayName ?? auth.email ?? 'unknown',
  }
}

function newId(): string {
  return doc(collection(getDb(), '_')).id
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export interface Dossier {
  work: WorkItem[]
  services: ClientService[]
  instalments: Instalment[]
  offers: SpecialOffer[]
  activities: ClientActivity[]
  notes: ClientNote[]
  /** Which parts the viewer was refused, so the tabs can say so honestly. */
  hiddenMoney: boolean
}

/**
 * Read the whole file on a client.
 *
 * A denied read is an answer, not a fault: somebody with clients.view but not
 * finance.view gets the relationship and an empty ledger, and the page tells
 * them the money is hidden rather than showing zeroes that look like facts.
 */
export async function fetchDossier(clientId: string): Promise<Dossier> {
  const readAll = async <T>(sub: Sub, field: string, dir: 'asc' | 'desc' = 'desc') => {
    try {
      const snap = await getDocs(query(path(clientId, sub), orderBy(field, dir)))
      return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }))
    } catch {
      return null
    }
  }

  const [work, services, instalments, offers, activities, notes] = await Promise.all([
    readAll<WorkItem>('work', 'date'),
    readAll<ClientService>('services', 'createdAt'),
    readAll<Instalment>('instalments', 'sequence', 'asc'),
    readAll<SpecialOffer>('offers', 'createdAt'),
    readAll<ClientActivity>('activities', 'date'),
    readAll<ClientNote>('notes', 'createdAt'),
  ])

  return {
    work: work ?? [],
    services: services ?? [],
    instalments: instalments ?? [],
    offers: offers ?? [],
    activities: activities ?? [],
    notes: notes ?? [],
    hiddenMoney: work === null,
  }
}

/* ------------------------------------------------------------------ *
 * Work items — the ledger
 * ------------------------------------------------------------------ */

export interface WorkItemInput {
  id: string
  date: string
  title: string
  serviceId: string | null
  serviceName: string
  cost: Money
  revenue: Money
  dueDate: string | null
  paymentStatus: PaymentStatus
  paidDate: string | null
  note: string
}

export async function saveWorkItem(
  clientId: string,
  clientName: string,
  input: WorkItemInput,
): Promise<void> {
  const isNew = !input.id
  const id = input.id || newId()
  const now = new Date().toISOString()
  const me = actor()

  await setDoc(
    doc(path(clientId, 'work'), id),
    {
      id,
      clientId,
      date: input.date,
      title: input.title.trim(),
      serviceId: input.serviceId,
      serviceName: input.serviceName.trim(),
      cost: input.cost,
      revenue: input.revenue,
      // Derived here and nowhere else, so it can never disagree with its parts.
      profitBaseMinor: input.revenue.baseMinor - input.cost.baseMinor,
      dueDate: input.dueDate,
      paymentStatus: input.paymentStatus,
      paidDate: input.paymentStatus === 'paid' ? (input.paidDate ?? now.slice(0, 10)) : null,
      note: input.note.trim(),
      ...(isNew ? { createdAt: now, createdBy: me.uid } : {}),
      updatedAt: now,
    },
    { merge: true },
  )

  await logAudit({
    action: 'income.recorded',
    targetType: 'client',
    targetId: clientId,
    targetLabel: clientName,
    metadata: { item: input.title, revenue: input.revenue.baseMinor, new: isNew },
  })
}

export async function deleteWorkItem(
  clientId: string,
  clientName: string,
  itemId: string,
  itemTitle: string,
): Promise<void> {
  await deleteDoc(doc(path(clientId, 'work'), itemId))
  await logAudit({
    action: 'expense.recorded',
    targetType: 'client',
    targetId: clientId,
    targetLabel: clientName,
    metadata: { deletedItem: itemTitle },
  })
}

/* ------------------------------------------------------------------ *
 * The rest of the file
 * ------------------------------------------------------------------ */

/** One writer for every subcollection, since they differ only in shape. */
async function saveSub<T extends { id: string }>(
  clientId: string,
  sub: Sub,
  input: T,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const isNew = !input.id
  const id = input.id || newId()
  const now = new Date().toISOString()

  await setDoc(
    doc(path(clientId, sub), id),
    {
      ...input,
      ...extra,
      id,
      clientId,
      ...(isNew ? { createdAt: now } : {}),
      updatedAt: now,
    },
    { merge: true },
  )

  return id
}

export async function saveService(
  clientId: string,
  input: Omit<ClientService, 'clientId' | 'createdAt' | 'updatedAt'>,
): Promise<void> {
  await saveSub(clientId, 'services', input)
}

export async function saveInstalment(
  clientId: string,
  input: Omit<Instalment, 'clientId' | 'createdAt' | 'updatedAt'>,
): Promise<void> {
  await saveSub(clientId, 'instalments', {
    ...input,
    paidDate: input.status === 'paid' ? (input.paidDate ?? new Date().toISOString().slice(0, 10)) : null,
  })
}

export async function saveOffer(
  clientId: string,
  input: Omit<SpecialOffer, 'clientId' | 'createdAt' | 'updatedAt' | 'discountBaseMinor'>,
): Promise<void> {
  await saveSub(clientId, 'offers', {
    ...input,
    discountBaseMinor: input.regularPrice.baseMinor - input.agreedPrice.baseMinor,
  })
}

export async function saveActivity(
  clientId: string,
  input: Omit<ClientActivity, 'clientId' | 'createdAt' | 'createdBy' | 'createdByName'>,
): Promise<void> {
  const me = actor()
  await saveSub(clientId, 'activities', input, {
    createdBy: me.uid,
    createdByName: me.name,
  })
}

export async function saveNote(
  clientId: string,
  input: Omit<ClientNote, 'clientId' | 'createdAt' | 'updatedAt' | 'createdBy' | 'createdByName'>,
): Promise<void> {
  const me = actor()
  await saveSub(clientId, 'notes', input, {
    createdBy: me.uid,
    createdByName: me.name,
  })
}

export async function removeFromClient(clientId: string, sub: Sub, id: string): Promise<void> {
  await deleteDoc(doc(path(clientId, sub), id))
}

/* ------------------------------------------------------------------ *
 * Figures
 * ------------------------------------------------------------------ */

export interface ClientTotals {
  revenueMinor: number
  costMinor: number
  profitMinor: number
  /** Recorded but not yet received. The number that matters for cash. */
  outstandingMinor: number
  itemCount: number
}

export function totalsFor(work: WorkItem[]): ClientTotals {
  return work.reduce<ClientTotals>(
    (sum, item) => ({
      revenueMinor: sum.revenueMinor + (item.revenue?.baseMinor ?? 0),
      costMinor: sum.costMinor + (item.cost?.baseMinor ?? 0),
      profitMinor: sum.profitMinor + (item.profitBaseMinor ?? 0),
      outstandingMinor:
        sum.outstandingMinor +
        (item.paymentStatus === 'paid' ? 0 : (item.revenue?.baseMinor ?? 0)),
      itemCount: sum.itemCount + 1,
    }),
    { revenueMinor: 0, costMinor: 0, profitMinor: 0, outstandingMinor: 0, itemCount: 0 },
  )
}

/**
 * What the referrer is owed.
 *
 * Computed from the work actually recorded rather than stored, so it cannot
 * drift from what was earned. A fixed amount wins over a percentage, because
 * some arrangements are simply a flat fee.
 */
export function commissionFor(
  work: WorkItem[],
  referral: { percent: number; fixedAmountMinor: number | null; basis: 'revenue' | 'profit' },
): number {
  if (referral.fixedAmountMinor !== null) return referral.fixedAmountMinor
  if (!referral.percent) return 0

  const totals = totalsFor(work)
  const base = referral.basis === 'profit' ? totals.profitMinor : totals.revenueMinor
  return Math.round((base * referral.percent) / 100)
}

/** How a due date reads today, for the badge on a row. */
export type DueState = 'paid' | 'overdue' | 'today' | 'soon' | 'later' | 'none'

export function dueStateOf(
  dueDate: string | null,
  status: PaymentStatus,
  today = new Date().toISOString().slice(0, 10),
): DueState {
  if (status === 'paid') return 'paid'
  if (!dueDate) return 'none'
  if (dueDate < today) return 'overdue'
  if (dueDate === today) return 'today'

  const days = (Date.parse(dueDate) - Date.parse(today)) / 86_400_000
  return days <= 7 ? 'soon' : 'later'
}

/** Years present in the ledger, newest first, for the history filter. */
export function yearsIn(work: WorkItem[]): number[] {
  const years = new Set(work.map((item) => Number(item.date.slice(0, 4))).filter(Boolean))
  return [...years].sort((a, b) => b - a)
}
