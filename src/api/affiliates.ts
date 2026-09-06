/**
 * The affiliate programme.
 *
 * Two things are deliberately kept apart here: an affiliate's *activity* and
 * an affiliate's *earnings*. Clicks and referred leads are interest; only a
 * payment that arrived produces a commission, and only a person can approve
 * one for payout. Anything else lets a busy referral link invoice the company.
 *
 * Commissions themselves are created in `revenue.ts`, where the payment that
 * earns them is recorded — this module maintains the affiliates and reports on
 * what they produced.
 */

import { logAudit } from './audit'
import { readAll, readOne, readWhere, where, write } from './store'
import type { Lead } from '@/types/business'
import type { Affiliate, Commission, Sale } from '@/types/revenue'

export const fetchAffiliates = () => readAll<Affiliate>('affiliates')

export const fetchAffiliate = (id: string) => readOne<Affiliate>('affiliates', id)

/** The affiliate record belonging to an employee, if they have one. */
export const fetchMyAffiliate = (uid: string) =>
  readWhere<Affiliate>('affiliates', where('employeeUid', '==', uid)).then((rows) => rows[0] ?? null)

/**
 * A referral code from a name.
 *
 * Lowercase, hyphenated, and checked against the codes already in use, because
 * the code appears in a public link and two affiliates sharing one would make
 * attribution impossible to settle.
 */
export function makeCode(name: string, existing: Affiliate[]): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'partner'

  const taken = new Set(existing.map((a) => a.code))
  if (!taken.has(base)) return base

  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

/** The link an affiliate shares. Service-specific when one is given. */
export function referralLink(affiliate: Affiliate, serviceSlug = ''): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/ref/${affiliate.code}${serviceSlug ? `/${serviceSlug}` : ''}`
}

export async function saveAffiliate(input: Affiliate): Promise<string> {
  const isNew = !input.id
  const id = await write('affiliates', input)

  await logAudit({
    action: isNew ? 'affiliate.created' : 'affiliate.updated',
    targetType: 'affiliate',
    targetId: id,
    targetLabel: input.name,
    metadata: { code: input.code, type: input.type, rules: input.rules?.length ?? 0 },
  })

  return id
}

/**
 * What one affiliate actually produced.
 *
 * Every figure is counted from records that exist elsewhere — leads, sales,
 * commissions — so nothing here can drift from the rest of the system. Clicks
 * are the exception: they are a counter with nothing behind them, which is
 * precisely why they earn nothing.
 */
export interface AffiliateResult {
  affiliateId: string
  clicks: number
  leads: number
  sales: number
  wonSales: number
  salesValueBaseMinor: number
  earnedBaseMinor: number
  approvedBaseMinor: number
  paidBaseMinor: number
  pendingBaseMinor: number
}

export function resultFor(
  affiliate: Affiliate,
  leads: Lead[],
  sales: Sale[],
  commissions: Commission[],
): AffiliateResult {
  const mySales = sales.filter((s) => s.affiliateId === affiliate.id)
  const won = mySales.filter((s) => s.stage === 'won')
  const mine = commissions.filter((c) => c.affiliateId === affiliate.id)

  const sum = (rows: Commission[]) => rows.reduce((n, c) => n + c.amountBaseMinor, 0)

  return {
    affiliateId: affiliate.id,
    clicks: affiliate.clicks ?? 0,
    leads: leads.filter((l) => l.sourceDetail === affiliate.code).length,
    sales: mySales.length,
    wonSales: won.length,
    salesValueBaseMinor: won.reduce((n, s) => n + s.value.baseMinor, 0),
    earnedBaseMinor: sum(mine),
    approvedBaseMinor: sum(mine.filter((c) => c.status === 'approved')),
    paidBaseMinor: sum(mine.filter((c) => c.status === 'paid')),
    pendingBaseMinor: sum(mine.filter((c) => c.status === 'pending')),
  }
}

/**
 * Record a click on a referral link.
 *
 * Deliberately the only thing the public entry point may do, and deliberately
 * the only number in this module with no record behind it.
 */
export async function recordClick(affiliate: Affiliate): Promise<void> {
  await write('affiliates', { ...affiliate, clicks: (affiliate.clicks ?? 0) + 1 })
}
