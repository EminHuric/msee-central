/**
 * The affiliate programme.
 *
 * Redesigned away from referral links. A link that anybody can click produced
 * a number that meant nothing and a public write that had to be defended; what
 * a partner actually needs is somewhere to hand over a lead and somewhere to
 * watch what happened to it.
 *
 * So: an affiliate has an account and a panel. They submit a lead, the company
 * works it, and if it becomes a sale the commission rules on their record
 * decide what they are owed. They can see their own leads, their own sales and
 * their own commissions — and nothing else, which is enforced by `isInternal()`
 * on every other rule in firestore.rules rather than by what this file renders.
 *
 * Commission itself is created in `finance.ts`, at the moment a payment is
 * recorded. Nothing an affiliate does moves money.
 */

import { logAudit } from './audit'
import { remove } from './records'
import { readAll, readOne, readWhere, where, write } from './store'
import type { Lead } from '@/types/business'
import type { Affiliate, Commission, Sale } from '@/types/revenue'

export const fetchAffiliates = () => readAll<Affiliate>('affiliates')

export const fetchAffiliate = (id: string) => readOne<Affiliate>('affiliates', id)

/** The affiliate record belonging to a signed-in person, if they have one. */
export const fetchMyAffiliate = (uid: string) =>
  readWhere<Affiliate>('affiliates', where('employeeUid', '==', uid)).then((rows) => rows[0] ?? null)

export function blankAffiliate(): Affiliate {
  return {
    id: '',
    name: '',
    type: 'partner',
    employeeUid: null,
    email: '',
    phone: '',
    status: 'active',
    rules: [],
    notes: '',
    deletedAt: null,
    deletedBy: null,
    deletedByName: '',
    createdAt: '',
    createdBy: '',
    updatedAt: '',
  }
}

export async function saveAffiliate(input: Affiliate): Promise<string> {
  const isNew = !input.id
  const id = await write('affiliates', input)

  await logAudit({
    action: isNew ? 'affiliate.created' : 'affiliate.updated',
    targetType: 'affiliate',
    targetId: id,
    targetLabel: input.name,
    metadata: { type: input.type, rules: input.rules?.length ?? 0, status: input.status },
  })

  return id
}

export const deleteAffiliate = (a: Affiliate) => remove('affiliates', a.id, a.name)

/**
 * What one affiliate produced.
 *
 * Every figure is counted from records kept elsewhere — the leads they
 * submitted, the sales those became, the commissions those earned — so nothing
 * here can drift from the rest of the system.
 *
 * Leads are matched by `affiliateId` rather than by who typed them, because a
 * partner may phone a lead in and have somebody enter it.
 */
export interface AffiliateResult {
  affiliateId: string
  leads: number
  openLeads: number
  wonLeads: number
  sales: number
  salesValueBaseMinor: number
  earnedBaseMinor: number
  pendingBaseMinor: number
  approvedBaseMinor: number
  paidBaseMinor: number
}

export function resultFor(
  affiliate: Affiliate,
  leads: Lead[],
  sales: Sale[],
  commissions: Commission[],
): AffiliateResult {
  const myLeads = leads.filter((l) => l.affiliateId === affiliate.id)
  const mySales = sales.filter((s) => s.affiliateId === affiliate.id)
  const mine = commissions.filter((c) => c.affiliateId === affiliate.id)

  const sum = (rows: Commission[]) => rows.reduce((n, c) => n + c.amountBaseMinor, 0)

  return {
    affiliateId: affiliate.id,
    leads: myLeads.length,
    openLeads: myLeads.filter((l) => l.stage !== 'won' && l.stage !== 'lost').length,
    wonLeads: myLeads.filter((l) => l.stage === 'won').length,
    sales: mySales.length,
    salesValueBaseMinor: mySales.reduce((n, s) => n + s.value.baseMinor, 0),
    earnedBaseMinor: sum(mine),
    pendingBaseMinor: sum(mine.filter((c) => c.status === 'pending')),
    approvedBaseMinor: sum(mine.filter((c) => c.status === 'approved')),
    paidBaseMinor: sum(mine.filter((c) => c.status === 'paid')),
  }
}

/** affiliateId → the uid of the person behind it, for earnings lookups. */
export function affiliateOwners(affiliates: Affiliate[]): Map<string, string> {
  return new Map(
    affiliates.filter((a) => a.employeeUid).map((a) => [a.id, a.employeeUid as string]),
  )
}
