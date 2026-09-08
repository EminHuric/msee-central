/**
 * Money in and money out, and the commissions a payment triggers.
 *
 * One collection with a `type`, rather than separate income and expense
 * tables. A cost and a payment are the same kind of fact pointing in opposite
 * directions; keeping them apart meant assembling every total twice and
 * getting a slightly different answer each time.
 *
 * The rule this module exists to enforce: **an arriving amount is not
 * automatically revenue.** `income` is money against a sale, `other_income`
 * arrived for some other reason, `refund` leaves, and `transfer` moves between
 * our own accounts. Only the first two count towards what the company earned,
 * and the caller has to say which one it is.
 */

import { logAudit } from './audit'
import { logActivity, remove } from './records'
import { notify } from './notifications'
import {
  actor,
  newId,
  readAll,
  readOne,
  readWhere,
  today,
  where,
  write,
} from './store'
import type { Sale } from '@/types/revenue'
import {
  INCOME_TYPES,
  OUTGOING_TYPES,
  balanceOf,
  commissionFromRules,
  type Affiliate,
  type Commission,
  type Transaction,
  type TransactionType,
} from '@/types/revenue'
import { moneyOf } from './sales'

export const fetchTransactions = () => readAll<Transaction>('transactions', 'date')

export const fetchTransaction = (id: string) => readOne<Transaction>('transactions', id)

export const fetchTransactionsFor = (clientId: string) =>
  readWhere<Transaction>('transactions', where('clientId', '==', clientId))

export const fetchTransactionsForSale = (saleId: string) =>
  readWhere<Transaction>('transactions', where('saleId', '==', saleId))

/** A blank transaction with every field present. */
export function blankTransaction(type: TransactionType = 'income'): Transaction {
  return {
    id: '',
    type,
    category: type === 'income' ? 'service_payment' : 'other',
    description: '',
    amount: moneyOf(0, 'RSD'),
    date: today(),
    dueDate: null,
    status: 'paid',
    method: '',
    clientId: null,
    clientName: '',
    serviceId: null,
    serviceName: '',
    projectId: null,
    saleId: null,
    employeeUid: null,
    employeeName: '',
    affiliateId: null,
    notes: '',
    deletedAt: null,
    deletedBy: null,
    deletedByName: '',
    createdAt: '',
    createdBy: '',
    updatedAt: '',
  }
}

/**
 * Record a transaction, and everything that follows from it.
 *
 * The order matters: the money is stored first, and only then does anybody get
 * credited for it. Commission built on anything earlier would be commission on
 * money that had not arrived.
 */
export async function saveTransaction(
  input: Transaction,
  options: { sale?: Sale | null; affiliate?: Affiliate | null; existing?: Transaction[] } = {},
): Promise<string> {
  const isNew = !input.id
  const id = await write('transactions', input)

  await logAudit({
    action: isNew ? 'transaction.recorded' : 'transaction.updated',
    targetType: 'transaction',
    targetId: id,
    targetLabel: input.description,
    metadata: {
      type: input.type,
      amount: input.amount.baseMinor,
      status: input.status,
      clientId: input.clientId,
    },
  })

  if (input.clientId) {
    await logActivity({
      entity: 'clients',
      entityId: input.clientId,
      entityLabel: input.clientName,
      kind: 'payment',
      summary: input.description,
      detail: input.type,
    })
  }

  if (input.saleId) {
    await logActivity({
      entity: 'sales',
      entityId: input.saleId,
      entityLabel: options.sale?.title ?? input.description,
      kind: 'payment',
      summary: input.description,
      detail: input.type,
    })
  }

  /* Commission follows money that arrived, and nothing earlier. */
  const sale = options.sale
  const affiliate = options.affiliate
  const counts = INCOME_TYPES.includes(input.type) && input.status === 'paid'

  if (isNew && counts && sale && affiliate) {
    await earnCommission(affiliate, sale, { ...input, id }, options.existing ?? [])
  }

  return id
}

export const deleteTransaction = (tx: Transaction) =>
  remove('transactions', tx.id, tx.description || tx.type)

/* ------------------------------------------------------------------ *
 * Commission
 * ------------------------------------------------------------------ */

export const fetchCommissions = () => readAll<Commission>('commissions')

/**
 * Turn a received payment into a pending commission.
 *
 * Pending, never approved: whether somebody is paid is a decision a person
 * makes, and the rules require a different permission for it.
 *
 * Two conditions decide whether this fires at all. A rule marked
 * `requiresFullPayment` waits until the sale is settled — otherwise an advance
 * would earn a commission on a deal that later collapses. A rule that is not
 * `recurring` earns once, so instalments do not each pay out again.
 */
export async function earnCommission(
  affiliate: Affiliate,
  sale: Sale,
  payment: Transaction,
  existingTransactions: Transaction[],
): Promise<void> {
  const computed = commissionFromRules(affiliate, sale.serviceId, sale.value.baseMinor)
  if (!computed || computed.amountBaseMinor <= 0) return

  const balance = balanceOf(sale, [...existingTransactions, payment])

  if (computed.rule.requiresFullPayment && balance.remainingBaseMinor > 0) return

  if (!computed.rule.recurring) {
    /* Already earned once on this sale: nothing more to do. */
    const already = existingTransactions.some(
      (tx) => tx.saleId === sale.id && tx.id !== payment.id && INCOME_TYPES.includes(tx.type),
    )
    if (already) return
  }

  const id = newId()

  await write('commissions', {
    id,
    affiliateId: affiliate.id,
    affiliateName: affiliate.name,
    affiliateEmployeeUid: affiliate.employeeUid ?? '',
    saleId: sale.id,
    saleTitle: sale.title,
    clientId: sale.clientId,
    clientName: sale.clientName,
    serviceId: sale.serviceId,
    baseAmountBaseMinor: sale.value.baseMinor,
    ruleDescription: computed.description,
    amountBaseMinor: computed.amountBaseMinor,
    status: 'pending',
    earnedDate: payment.date,
    approvedBy: null,
    approvedAt: null,
    paidAt: null,
    note: '',
  } as unknown as Commission)

  await logAudit({
    action: 'commission.earned',
    targetType: 'commission',
    targetId: id,
    targetLabel: affiliate.name,
    metadata: { amount: computed.amountBaseMinor, rule: computed.description, saleId: sale.id },
  })

  if (affiliate.employeeUid) {
    await notify(affiliate.employeeUid, {
      kind: 'commission_earned',
      priority: 'normal',
      title: sale.title,
      body: computed.description,
      link: '/affiliates',
    })
  }
}

export async function setCommissionStatus(
  commission: Commission,
  status: Commission['status'],
): Promise<void> {
  const me = actor()
  const stamp = new Date().toISOString()

  await write('commissions', {
    ...commission,
    status,
    approvedBy: status === 'approved' ? me.uid : commission.approvedBy,
    approvedAt: status === 'approved' ? stamp : commission.approvedAt,
    paidAt: status === 'paid' ? stamp : commission.paidAt,
  })

  await logAudit({
    action:
      status === 'approved'
        ? 'commission.approved'
        : status === 'paid'
          ? 'commission.paid'
          : 'commission.rejected',
    targetType: 'commission',
    targetId: commission.id,
    targetLabel: commission.affiliateName,
    metadata: { amount: commission.amountBaseMinor, status },
  })
}

/* ------------------------------------------------------------------ *
 * Figures
 * ------------------------------------------------------------------ */

export interface FinanceTotals {
  incomeBaseMinor: number
  expenseBaseMinor: number
  profitBaseMinor: number
  /** Recorded but not yet paid, in either direction. */
  pendingInBaseMinor: number
  pendingOutBaseMinor: number
  overdueBaseMinor: number
}

/**
 * Income, expenses and profit over a set of transactions.
 *
 * Only rows marked paid count towards the first three. A pending payment is
 * something expected, not something earned, and folding the two together is
 * how a business talks itself into spending money it has not been given.
 */
export function totalsOf(rows: Transaction[]): FinanceTotals {
  const paid = rows.filter((tx) => tx.status === 'paid')
  const pending = rows.filter((tx) => tx.status !== 'paid')
  const now = today()

  const income = paid
    .filter((tx) => INCOME_TYPES.includes(tx.type))
    .reduce((n, tx) => n + tx.amount.baseMinor, 0)

  const expense = paid
    .filter((tx) => OUTGOING_TYPES.includes(tx.type))
    .reduce((n, tx) => n + tx.amount.baseMinor, 0)

  return {
    incomeBaseMinor: income,
    expenseBaseMinor: expense,
    profitBaseMinor: income - expense,
    pendingInBaseMinor: pending
      .filter((tx) => INCOME_TYPES.includes(tx.type))
      .reduce((n, tx) => n + tx.amount.baseMinor, 0),
    pendingOutBaseMinor: pending
      .filter((tx) => OUTGOING_TYPES.includes(tx.type))
      .reduce((n, tx) => n + tx.amount.baseMinor, 0),
    overdueBaseMinor: pending
      .filter((tx) => tx.dueDate && tx.dueDate < now)
      .reduce((n, tx) => n + tx.amount.baseMinor, 0),
  }
}

/**
 * Everything a client still owes.
 *
 * Read from their sales rather than from a stored balance: a balance written
 * down is a balance that can be wrong, and somebody will act on it.
 */
export function outstandingFor(sales: Sale[], transactions: Transaction[]): number {
  return sales.reduce((n, sale) => n + balanceOf(sale, transactions).remainingBaseMinor, 0)
}
