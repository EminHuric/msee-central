/**
 * Sales — the historical record of everything MsEe has sold.
 *
 * The point of this module is not the pipeline; it is the archive. In two
 * years the amount on a sale will matter less than the answer to "how did we
 * get this one, and what worked", which is why the analysis travels with it
 * and why nothing here deletes a sale outright.
 *
 * Recording a sale is also the moment three other things become true: the
 * client's history gains an entry, the affiliate who brought it may be owed
 * something, and the money is now expected. The first two happen here. The
 * third happens when a payment is actually recorded, in `finance.ts`, because
 * an expectation is not income.
 */

import { logAudit } from './audit'
import { logActivity, remove } from './records'
import { notify } from './notifications'
import { actor, readAll, readOne, readWhere, today, where, write } from './store'
import { addEntry } from './wallet'

import { toMinor, type CurrencyCode, type Money } from '@/types/money'
import {
  EMPTY_ANALYSIS,
  NO_STRUCTURE,
  balanceOf,
  type PaymentStructure,
  type Sale,
  type SaleBalance,
  type Transaction,
} from '@/types/revenue'

export const fetchSales = () => readAll<Sale>('sales', 'saleDate')

export const fetchSale = (id: string) => readOne<Sale>('sales', id)

export const fetchSalesFor = (clientId: string) =>
  readWhere<Sale>('sales', where('clientId', '==', clientId))

export const fetchSalesForProject = (projectId: string) =>
  readWhere<Sale>('sales', where('projectId', '==', projectId))

/** Convenience for forms that collect a decimal and a currency. */
export function moneyOf(amount: number, currency: CurrencyCode, rate = 1, date = today()): Money {
  const minor = toMinor(amount, currency)
  return { minor, currency, rate, baseMinor: Math.round(minor * rate), rateDate: date }
}

/**
 * A blank sale, with every field present.
 *
 * Exists so no screen has to cast a half-built object into a Sale: a missing
 * field is not a type error somebody catches, it is a document written without
 * it and an `undefined` three screens away.
 */
export function blankSale(ownerUid: string | null, ownerName: string): Sale {
  return {
    id: '',
    title: '',
    clientId: '',
    clientName: '',
    serviceId: null,
    serviceName: '',
    projectId: null,
    leadId: null,
    ownerUid,
    ownerName,
    affiliateId: null,
    affiliateName: '',
    value: moneyOf(0, 'RSD'),
    payment: { ...NO_STRUCTURE },
    saleDate: today(),
    channel: 'inbound',
    contactChannel: 'phone',
    analysis: { ...EMPTY_ANALYSIS },
    notes: '',
    custom: {},
    deletedAt: null,
    deletedBy: null,
    deletedByName: '',
    createdAt: '',
    createdBy: '',
    updatedAt: '',
  }
}

/**
 * The payment structure a sale starts with.
 *
 * Copied from the service rather than referenced, so that raising a price next
 * year cannot rewrite what last year's customer agreed to. An advance defined
 * as a share of the price is resolved to an amount here, for the same reason.
 */
export function structureFromTerms(
  terms: { payment: PaymentStructure } | null | undefined,
  valueBaseMinor: number,
) {
  /*
   * No terms means the reader may not see prices — see `ServiceTerms`. The
   * sale still gets a structure; it just gets the plain one, and whoever can
   * see the figures sets the rest.
   */
  const base = terms?.payment ?? NO_STRUCTURE

  return {
    ...base,
    advanceBaseMinor:
      base.model === 'advance_remainder' && base.advanceBaseMinor === 0
        ? Math.round(valueBaseMinor / 2)
        : base.advanceBaseMinor,
  }
}

export async function saveSale(input: Sale): Promise<string> {
  const isNew = !input.id
  const id = await write('sales', input)

  await logAudit({
    action: isNew ? 'sale.created' : 'sale.updated',
    targetType: 'sale',
    targetId: id,
    targetLabel: input.title,
    metadata: {
      clientId: input.clientId,
      value: input.value.baseMinor,
      service: input.serviceName,
      channel: input.channel,
    },
  })

  await logActivity({
    entity: 'sales',
    entityId: id,
    entityLabel: input.title,
    kind: isNew ? 'created' : 'updated',
    summary: input.clientName,
    detail: input.serviceName,
  })

  /* The client's own history gains the sale too, where somebody will look. */
  if (input.clientId) {
    await logActivity({
      entity: 'clients',
      entityId: input.clientId,
      entityLabel: input.clientName,
      kind: isNew ? 'created' : 'updated',
      summary: input.title,
      detail: input.serviceName,
    })
  }

  if (isNew) {
    const me = actor()
    /* The person credited with it, when that is not the person entering it. */
    if (input.ownerUid && input.ownerUid !== me.uid) {
      await notify(input.ownerUid, {
        kind: 'sale_new',
        priority: 'normal',
        title: input.title,
        body: input.clientName,
        link: '/sales',
      })
    }
  }

  return id
}

export const deleteSale = (sale: Sale) => remove('sales', sale.id, sale.title)

/* ------------------------------------------------------------------ *
 * Figures
 * ------------------------------------------------------------------ */

export { balanceOf }

/** Every sale's balance in one map, so a list does not recompute per row. */
export function balances(sales: Sale[], transactions: Transaction[]): Map<string, SaleBalance> {
  return new Map(sales.map((sale) => [sale.id, balanceOf(sale, transactions)]))
}

export interface SalesTotals {
  count: number
  valueBaseMinor: number
  paidBaseMinor: number
  outstandingBaseMinor: number
  advanceDueCount: number
}

export function totalsOf(sales: Sale[], transactions: Transaction[]): SalesTotals {
  const rows = sales.map((sale) => balanceOf(sale, transactions))

  return {
    count: sales.length,
    valueBaseMinor: rows.reduce((n, b) => n + b.valueBaseMinor, 0),
    paidBaseMinor: rows.reduce((n, b) => n + b.paidBaseMinor, 0),
    outstandingBaseMinor: rows.reduce((n, b) => n + b.remainingBaseMinor, 0),
    advanceDueCount: rows.filter((b) => b.advanceDue).length,
  }
}

/* ------------------------------------------------------------------ *
 * What a sale earns the person who made it
 * ------------------------------------------------------------------ */

/**
 * Write the seller's commission into their ledger.
 *
 * Deliberately a separate, explicit act rather than something `saveSale` does
 * on its own, and the reason is the permission split: the rate lives in the
 * service's commercial terms, which a salesperson without
 * `services.view_price` cannot read. If this ran inside the save it would
 * succeed for some people and silently do nothing for others — the same button
 * behaving differently depending on who pressed it, which is worse than a
 * button that has to be pressed.
 *
 * So whoever can see the figures records the commission, and can see that they
 * did.
 *
 * Written as `pending`, never `paid`. What somebody earned is arithmetic; that
 * the company has approved paying it is a decision, and the ledger keeps those
 * apart.
 *
 * Returns null when there is nothing to record: no seller, no rate, or an
 * entry already exists for this sale.
 */
export async function recordCommissionFor(
  sale: Sale,
  seller: { uid: string; name: string },
  commissionPercent: number,
): Promise<string | null> {
  if (!commissionPercent || commissionPercent <= 0) return null
  if (!seller.uid) return null

  /* One entry per sale. Pressing twice must not pay twice. */
  const existing = await readWhere<{ id: string; saleId: string | null }>(
    'walletEntries',
    where('saleId', '==', sale.id),
  )
  if (existing.length > 0) return null

  const amount = Math.round((sale.value.baseMinor * commissionPercent) / 100)
  if (amount <= 0) return null

  return addEntry({
    employeeUid: seller.uid,
    employeeName: seller.name,
    kind: 'commission',
    amountBaseMinor: amount,
    status: 'pending',
    reason: `${commissionPercent}% · ${sale.title}`,
    saleId: sale.id,
    saleLabel: sale.title,
    bonusAwardId: null,
    goalId: null,
    date: sale.saleDate,
    approvedBy: null,
    approvedAt: null,
    paidAt: null,
    createdAt: '',
    createdBy: '',
    createdByName: '',
    updatedAt: '',
  })
}

/**
 * Reverse a commission when the sale behind it goes away.
 *
 * A correcting entry, never a deletion. "You earned €150 in March" was true
 * when it was written; what changed is that the sale was cancelled, and both
 * facts belong in the ledger. Deleting the first would leave somebody's history
 * saying something that did not happen.
 */
export async function reverseCommissionFor(sale: Sale, reason: string): Promise<number> {
  const entries = await readWhere<{
    id: string
    employeeUid: string
    employeeName: string
    amountBaseMinor: number
    saleId: string | null
    kind: string
  }>('walletEntries', where('saleId', '==', sale.id))

  let reversed = 0

  for (const entry of entries) {
    if (entry.kind !== 'commission' || entry.amountBaseMinor <= 0) continue

    await addEntry({
      employeeUid: entry.employeeUid,
      employeeName: entry.employeeName,
      kind: 'adjustment',
      amountBaseMinor: -entry.amountBaseMinor,
      status: 'approved',
      reason,
      saleId: sale.id,
      saleLabel: sale.title,
      bonusAwardId: null,
      goalId: null,
      date: today(),
      approvedBy: null,
      approvedAt: null,
      paidAt: null,
      createdAt: '',
      createdBy: '',
      createdByName: '',
      updatedAt: '',
    })
    reversed += 1
  }

  return reversed
}
