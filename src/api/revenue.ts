/**
 * Sales, contracts, invoices, payments — and the commissions that follow.
 *
 * These four are one chain, so they live in one module: winning a sale offers
 * a contract, a contract is what an invoice bills against, and a payment is
 * what finally closes it. Splitting them across four files would hide the fact
 * that each step reads the one before it.
 *
 * The rule that keeps the figures honest: nothing here recomputes a total from
 * a number somebody typed. An invoice's amount comes from the work items it
 * bills; what a client has paid comes from the payments recorded against it;
 * a commission comes from a payment that actually arrived, never from a click
 * and never from a promise.
 */

import { logAudit } from './audit'
import { fetchAllWork } from './clientDossier'
import {
  actor,
  newId,
  readAll,
  readOne,
  readWhere,
  remove,
  today,
  where,
  write,
} from './store'
import type { WorkItem } from '@/types/business'
import { toMinor, type Money } from '@/types/money'
import {
  INCOME_TYPES,
  OPEN_SALE_STAGES,
  PERIOD_MONTHS,
  commissionFromRules,
  type Affiliate,
  type Commission,
  type Contract,
  type ContractStatus,
  type Invoice,
  type Payment,
  type Sale,
  type SaleStage,
} from '@/types/revenue'

/* ------------------------------------------------------------------ *
 * Sales
 * ------------------------------------------------------------------ */

export const fetchSales = () => readAll<Sale>('sales')

export const fetchSale = (id: string) => readOne<Sale>('sales', id)

export const fetchSalesFor = (clientId: string) =>
  readWhere<Sale>('sales', where('clientId', '==', clientId))

export async function saveSale(input: Sale): Promise<string> {
  const isNew = !input.id
  const id = await write('sales', input)

  await logAudit({
    action: isNew ? 'sale.created' : 'sale.updated',
    targetType: 'sale',
    targetId: id,
    targetLabel: input.title,
    metadata: { stage: input.stage, value: input.value.baseMinor, clientId: input.clientId },
  })

  return id
}

/**
 * Move a deal to another stage.
 *
 * Closing it stamps the date here rather than trusting one to be typed, so
 * "how long does a deal take" is answerable later.
 */
export async function setSaleStage(sale: Sale, stage: SaleStage): Promise<void> {
  const closing = stage === 'won' || stage === 'lost'

  await write('sales', {
    ...sale,
    stage,
    closedDate: closing ? (sale.closedDate ?? today()) : null,
  })

  await logAudit({
    action: stage === 'won' ? 'sale.won' : stage === 'lost' ? 'sale.lost' : 'sale.updated',
    targetType: 'sale',
    targetId: sale.id,
    targetLabel: sale.title,
    metadata: { stage, value: sale.value.baseMinor },
  })
}

export const deleteSale = (id: string) => remove('sales', id)

/** Weighted pipeline: value × probability, over deals still in play. */
export function weightedPipeline(sales: Sale[]): number {
  return sales
    .filter((s) => OPEN_SALE_STAGES.includes(s.stage))
    .reduce((sum, s) => sum + Math.round((s.value.baseMinor * (s.probability ?? 0)) / 100), 0)
}

/** Won ÷ closed. Deals still open are not failures yet, so they are excluded. */
export function conversionRate(sales: Sale[]): number {
  const closed = sales.filter((s) => s.stage === 'won' || s.stage === 'lost')
  if (closed.length === 0) return 0
  return Math.round((closed.filter((s) => s.stage === 'won').length / closed.length) * 100)
}

/* ------------------------------------------------------------------ *
 * Contracts
 * ------------------------------------------------------------------ */

export const fetchContracts = () => readAll<Contract>('contracts')

export const fetchContract = (id: string) => readOne<Contract>('contracts', id)

export const fetchContractsFor = (clientId: string) =>
  readWhere<Contract>('contracts', where('clientId', '==', clientId))

export async function saveContract(input: Contract): Promise<string> {
  const isNew = !input.id
  const id = await write('contracts', input)

  await logAudit({
    action: isNew ? 'contract.created' : 'contract.updated',
    targetType: 'contract',
    targetId: id,
    targetLabel: input.number || input.clientName,
    metadata: { clientId: input.clientId, status: input.status, value: input.value.baseMinor },
  })

  return id
}

export async function setContractStatus(
  contract: Contract,
  status: ContractStatus,
): Promise<void> {
  await write('contracts', { ...contract, status })
  await logAudit({
    action: 'contract.status_changed',
    targetType: 'contract',
    targetId: contract.id,
    targetLabel: contract.number || contract.clientName,
    metadata: { from: contract.status, to: status },
  })
}

/**
 * Next contract number, as MSE-YYYY-NNN.
 *
 * Counted from the numbers already issued this year rather than from a stored
 * counter, so two people creating a contract at once produce a duplicate
 * rather than a gap. A duplicate is visible and fixable; a lost counter is not.
 */
export function nextContractNumber(contracts: Contract[], year = new Date().getFullYear()): string {
  const prefix = `MSE-${year}-`
  const used = contracts
    .map((c) => c.number)
    .filter((n) => n?.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isFinite(n))

  return `${prefix}${String(Math.max(0, ...used) + 1).padStart(3, '0')}`
}

/**
 * What a contract is worth in total.
 *
 * A one-off is its face value. A recurring contract is the period value times
 * the number of periods between its dates — an open-ended one has no total,
 * which is reported as null rather than as a made-up figure.
 */
export function contractTotal(contract: Contract): number | null {
  const months = PERIOD_MONTHS[contract.billingFrequency]
  if (months === 0) return contract.value.baseMinor
  if (!contract.endDate) return null

  const start = new Date(contract.startDate)
  const end = new Date(contract.endDate)
  const spanMonths =
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())

  return contract.value.baseMinor * Math.max(1, Math.ceil(spanMonths / months))
}

/** Contracts running out within `days`, soonest first. */
export function expiringSoon(contracts: Contract[], days = 45): Contract[] {
  const limit = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
  const now = today()

  return contracts
    .filter(
      (c) =>
        (c.status === 'active' || c.status === 'renewal') &&
        !!(c.renewalDate ?? c.endDate) &&
        (c.renewalDate ?? c.endDate)! <= limit &&
        (c.renewalDate ?? c.endDate)! >= now,
    )
    .sort((a, b) =>
      (a.renewalDate ?? a.endDate ?? '').localeCompare(b.renewalDate ?? b.endDate ?? ''),
    )
}

/* ------------------------------------------------------------------ *
 * Invoices
 *
 * An invoice bills work items that already exist. Its amount is the sum of
 * those items at the moment it is issued, and it is stored — an invoice is a
 * document that was sent, so it must not change when somebody later edits a
 * line it was based on. That is the one place a stored total is correct.
 * ------------------------------------------------------------------ */

export const fetchInvoices = () => readAll<Invoice>('invoices')

export const fetchInvoicesFor = (clientId: string) =>
  readWhere<Invoice>('invoices', where('clientId', '==', clientId))

export function nextInvoiceNumber(invoices: Invoice[], year = new Date().getFullYear()): string {
  const prefix = `${year}-`
  const used = invoices
    .map((i) => i.number)
    .filter((n) => n?.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isFinite(n))

  return `${prefix}${String(Math.max(0, ...used) + 1).padStart(4, '0')}`
}

export async function saveInvoice(input: Invoice): Promise<string> {
  const isNew = !input.id
  const id = await write('invoices', input)

  if (isNew) {
    await logAudit({
      action: 'invoice.issued',
      targetType: 'invoice',
      targetId: id,
      targetLabel: input.number,
      metadata: { clientId: input.clientId, amount: input.amount.baseMinor },
    })
  }

  return id
}

/** What an invoice still owes, after the payments recorded against it. */
export function invoiceOutstanding(invoice: Invoice): number {
  return Math.max(0, invoice.amount.baseMinor - (invoice.paidBaseMinor ?? 0))
}

/* ------------------------------------------------------------------ *
 * Payments — money that actually moved
 * ------------------------------------------------------------------ */

export const fetchPayments = () => readAll<Payment>('payments', 'date')

export const fetchPaymentsFor = (clientId: string) =>
  readWhere<Payment>('payments', where('clientId', '==', clientId))

/**
 * Record a payment, and everything that follows from it.
 *
 * Three things happen in order, and the order matters: the payment is stored,
 * its invoice is credited, and only then is commission earned. Commission
 * built on anything earlier would be commission on money that had not arrived.
 */
export async function savePayment(
  input: Payment,
  options: { invoice?: Invoice | null; affiliate?: Affiliate | null } = {},
): Promise<string> {
  const id = await write('payments', input)

  await logAudit({
    action: 'payment.recorded',
    targetType: 'payment',
    targetId: id,
    targetLabel: input.description || input.clientName,
    metadata: { type: input.type, amount: input.amount.baseMinor, clientId: input.clientId },
  })

  const invoice = options.invoice
  if (invoice && INCOME_TYPES.includes(input.type)) {
    const paid = (invoice.paidBaseMinor ?? 0) + input.amount.baseMinor
    await write('invoices', {
      ...invoice,
      paidBaseMinor: paid,
      status: paid >= invoice.amount.baseMinor ? 'paid' : 'part_paid',
    })
  }

  const affiliate = options.affiliate
  if (affiliate && INCOME_TYPES.includes(input.type)) {
    await earnCommission(affiliate, { ...input, id })
  }

  return id
}

export async function deletePayment(payment: Payment): Promise<void> {
  await remove('payments', payment.id)
  await logAudit({
    action: 'payment.deleted',
    targetType: 'payment',
    targetId: payment.id,
    targetLabel: payment.description || payment.clientName,
    metadata: { amount: payment.amount.baseMinor },
  })
}

/* ------------------------------------------------------------------ *
 * Commissions
 * ------------------------------------------------------------------ */

export const fetchCommissions = () => readAll<Commission>('commissions')

/**
 * Turn a received payment into a pending commission.
 *
 * Pending, never approved: whether somebody is actually paid is a decision a
 * person makes, and the rules require a different permission for it. A click,
 * a lead, even a signed contract earn nothing here — only money that arrived.
 */
export async function earnCommission(affiliate: Affiliate, payment: Payment): Promise<void> {
  const computed = commissionFromRules(affiliate, payment.serviceId, payment.amount.baseMinor)
  if (!computed || computed.amountBaseMinor <= 0) return

  const id = newId()
  await write('commissions', {
    id,
    affiliateId: affiliate.id,
    affiliateName: affiliate.name,
    /* Denormalised so an affiliate can read their own row without a join. */
    affiliateEmployeeUid: affiliate.employeeUid ?? '',
    paymentId: payment.id,
    clientId: payment.clientId,
    clientName: payment.clientName,
    serviceId: payment.serviceId,
    saleId: payment.saleId,
    baseAmountBaseMinor: payment.amount.baseMinor,
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
    metadata: { amount: computed.amountBaseMinor, rule: computed.description },
  })
}

export async function setCommissionStatus(
  commission: Commission,
  status: Commission['status'],
): Promise<void> {
  const me = actor()
  const now = new Date().toISOString()

  await write('commissions', {
    ...commission,
    status,
    approvedBy: status === 'approved' ? me.uid : commission.approvedBy,
    approvedAt: status === 'approved' ? now : commission.approvedAt,
    paidAt: status === 'paid' ? now : commission.paidAt,
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
 * Figures read across the whole chain
 * ------------------------------------------------------------------ */

export interface ClientBalance {
  /** Everything billed on the work ledger. */
  invoicedBaseMinor: number
  /** Everything actually received. */
  paidBaseMinor: number
  outstandingBaseMinor: number
  overdueBaseMinor: number
}

/**
 * What a client owes.
 *
 * Read from the work ledger, not from a stored balance. A balance that is
 * written down is a balance that can be wrong; this one is recomputed from the
 * rows it came from every time it is asked for.
 */
export function balanceOf(work: WorkItem[], payments: Payment[]): ClientBalance {
  const invoiced = work.reduce((s, w) => s + w.revenue.baseMinor, 0)
  const paid = payments
    .filter((p) => INCOME_TYPES.includes(p.type))
    .reduce((s, p) => s + p.amount.baseMinor, 0)

  const now = today()
  const overdue = work
    .filter((w) => w.paymentStatus !== 'paid' && w.dueDate && w.dueDate < now)
    .reduce((s, w) => s + w.revenue.baseMinor, 0)

  return {
    invoicedBaseMinor: invoiced,
    paidBaseMinor: paid,
    outstandingBaseMinor: work
      .filter((w) => w.paymentStatus !== 'paid')
      .reduce((s, w) => s + w.revenue.baseMinor, 0),
    overdueBaseMinor: overdue,
  }
}

/** Unbilled work for a client — the candidates for the next invoice. */
export async function billableWork(clientId: string): Promise<WorkItem[]> {
  const all = await fetchAllWork(1000)
  return all.filter(
    (w) => w.clientId === clientId && w.paymentStatus !== 'paid' && !(w as { invoiceId?: string }).invoiceId,
  )
}

/** Build an invoice from selected work items. The amount is their sum. */
export function invoiceFromWork(
  items: WorkItem[],
  base: Pick<Invoice, 'clientId' | 'clientName' | 'number' | 'issueDate' | 'dueDate'>,
): Invoice {
  const totalMinor = items.reduce((s, w) => s + w.revenue.baseMinor, 0)

  const amount: Money = {
    minor: totalMinor,
    currency: 'RSD',
    rate: 1,
    baseMinor: totalMinor,
    rateDate: base.issueDate,
  }

  return {
    id: '',
    number: base.number,
    clientId: base.clientId,
    clientName: base.clientName,
    contractId: null,
    projectId: items[0]?.projectId ?? null,
    serviceId: items[0]?.serviceId ?? null,
    saleId: null,
    description: items.map((w) => w.title).join(', '),
    amount,
    paidBaseMinor: 0,
    issueDate: base.issueDate,
    dueDate: base.dueDate,
    status: 'sent',
    notes: '',
    createdAt: '',
    createdBy: '',
    updatedAt: '',
  }
}

/** Convenience for forms that collect a decimal and a currency. */
export function moneyOf(amount: number, currency: Money['currency'], rate = 1, date = today()): Money {
  const minor = toMinor(amount, currency)
  return { minor, currency, rate, baseMinor: Math.round(minor * rate), rateDate: date }
}
