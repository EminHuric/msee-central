/**
 * How much of a client's trade we brought them.
 *
 * WHY THIS IS RECORDED HERE AND NOT SENT. The RMS sees every reservation, so it
 * knows what a client took. It does not know which of those bookings came from
 * our marketing, our direct-booking work or our campaigns — and you said as
 * much: the total is in there, the part you brought is not.
 *
 * That part is not a measurement the RMS can make. It is a judgement about what
 * our work produced, and judgements belong where somebody is accountable for
 * them. So MsEe Central is where it is recorded, month by month, against the
 * client it concerns.
 *
 * THE THREE FIGURES, and why they are three.
 *
 *   turnover      what the client took, every channel. Their news.
 *   attributed    the part we brought. Ours.
 *   ourShare      our commission on that part. What we actually earn.
 *
 * Collapsing the first two is the mistake worth avoiding: "their turnover rose
 * 20%" credits us with bookings that would have happened anyway, and a company
 * that measures itself that way cannot tell whether it is working.
 *
 * WRITING IT BACK TO THE RMS. Once it is here, sending it there is the other
 * direction — MsEe Central reaching out, which needs a server holding a key and
 * therefore the Blaze plan. The record is shaped so that when that exists it has
 * something complete to send; it is not waiting on anything else.
 */

import type { Money } from './money'

/**
 * How the figure was arrived at.
 *
 * Stored because it changes what the number is worth. A figure the RMS reported
 * and a figure somebody estimated are both useful and are not the same kind of
 * fact, and six months later nobody will remember which this was.
 */
export const ATTRIBUTION_BASES = [
  /** Counted from bookings the RMS could actually attribute to us. */
  'reported',
  /** Counted by hand from channel reports, booking sources, campaign data. */
  'measured',
  /** Somebody's considered estimate. Honest, and labelled as an estimate. */
  'estimated',
] as const
export type AttributionBasis = (typeof ATTRIBUTION_BASES)[number]

export interface Attribution {
  id: string
  clientId: string
  clientName: string

  /** The month it covers, as `YYYY-MM`. */
  period: string

  /**
   * What the client took in that month, through every channel.
   *
   * Copied from what the RMS reported when that is available, and typed in when
   * it is not — so the three figures always sit beside each other even before
   * the integration is sending anything.
   */
  turnover: Money
  /** The part we brought them. */
  attributed: Money
  /** Our commission on that part. */
  ourShare: Money

  basis: AttributionBasis
  /** Which of our services produced it, when it is one. */
  serviceId: string | null
  serviceName: string

  /** How the figure was arrived at, in words. */
  note: string

  /**
   * Whether this has been sent back to the RMS.
   *
   * False for everything today, because sending needs a server. Recorded rather
   * than omitted so that when the push exists it knows what it has not sent,
   * instead of sending everything again.
   */
  pushedToRms: boolean
  pushedAt: string | null

  createdAt: string
  createdBy: string
  updatedAt: string
}

export function blankAttribution(clientId: string, clientName: string): Attribution {
  const zero = { minor: 0, currency: 'RSD' as const, rate: 1, baseMinor: 0, rateDate: '' }

  return {
    id: '',
    clientId,
    clientName,
    period: new Date().toISOString().slice(0, 7),
    turnover: { ...zero },
    attributed: { ...zero },
    ourShare: { ...zero },
    basis: 'measured',
    serviceId: null,
    serviceName: '',
    note: '',
    pushedToRms: false,
    pushedAt: null,
    createdAt: '',
    createdBy: '',
    updatedAt: '',
  }
}

export interface AttributionTotals {
  turnoverBaseMinor: number
  attributedBaseMinor: number
  ourShareBaseMinor: number
  months: number
  /** What share of their trade we brought, or null when nothing is recorded. */
  sharePercent: number | null
}

/**
 * Totals over a set of records. Derived, never stored.
 *
 * The percentage is null rather than zero when there is no turnover to divide,
 * because 0% reads as "we brought them nothing" when the truth is "nothing has
 * been recorded yet".
 */
export function totalsOf(rows: Attribution[]): AttributionTotals {
  const turnover = rows.reduce((n, r) => n + r.turnover.baseMinor, 0)
  const attributed = rows.reduce((n, r) => n + r.attributed.baseMinor, 0)

  return {
    turnoverBaseMinor: turnover,
    attributedBaseMinor: attributed,
    ourShareBaseMinor: rows.reduce((n, r) => n + r.ourShare.baseMinor, 0),
    months: rows.length,
    sharePercent: turnover > 0 ? Math.round((attributed / turnover) * 100) : null,
  }
}
