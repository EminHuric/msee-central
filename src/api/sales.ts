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
import type { Service } from '@/types/business'
import { toMinor, type CurrencyCode, type Money } from '@/types/money'
import {
  EMPTY_ANALYSIS,
  NO_STRUCTURE,
  balanceOf,
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
export function structureFromService(service: Service | null | undefined, valueBaseMinor: number) {
  const base = service?.payment ?? NO_STRUCTURE

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
