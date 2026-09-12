/**
 * What another system sends in.
 *
 * THE DIRECTION MATTERS, and it is the whole reason this exists.
 *
 * MsEe Central *pulling* from the RMS cannot work from a browser: the
 * connection needs a key, and anything the browser holds is readable by anyone
 * who opens the console. A key in the frontend is a published key. Doing it
 * properly would need a server of our own, which on Firebase means Cloud
 * Functions and the Blaze plan.
 *
 * The RMS *pushing* into MsEe Central has none of that problem. The RMS already
 * has a server, the key lives on it, and it writes here with an account of its
 * own. So this is the direction that works today, with no new infrastructure
 * and nothing secret in the browser.
 *
 * WHAT COMES IN
 *
 * Two things, both daily figures rather than individual bookings:
 *
 *   a client's total turnover and reservations — every booking they took,
 *   through every channel, which is what the RMS actually knows;
 *
 *   an amount earned by one of our people, so it reaches their ledger without
 *   anybody copying a number across by hand.
 *
 * Individual bookings are deliberately not here. MsEe Central does not run the
 * property; duplicating the RMS's own records would create a second place for
 * them to be wrong, and the question this system answers is "how much", not
 * "which nights".
 *
 * NOTHING HERE IS TRUSTED BLINDLY. An intake row is a claim by another system.
 * It is matched to a client by the reference already recorded on that client —
 * see `externalRefs` — and a row that matches nothing stays unmatched and
 * visible rather than being attached to a guess.
 */

import type { Money } from './money'

/** Which of our systems a row came from. */
/*
 * Deliberately a subset of `EXTERNAL_SYSTEMS`: a row can only be matched to a
 * client through a reference recorded against that same system, so the two
 * vocabularies have to agree or nothing would ever match.
 */
export const INTAKE_SOURCES = ['rms', 'staybrain', 'other'] as const
export type IntakeSource = (typeof INTAKE_SOURCES)[number]

export const INTAKE_KINDS = [
  /** A client's trading for one day: turnover, reservations, nights. */
  'client_day',
  /** Something one of our people earned, to go to their ledger. */
  'employee_earning',
] as const
export type IntakeKind = (typeof INTAKE_KINDS)[number]

/**
 * How far a row has got.
 *
 * `matched` means we know which client or person it belongs to. `applied` means
 * it has been acted on — for an earning, that an entry exists in somebody's
 * ledger. The two are separate so applying can be a decision rather than a
 * side effect of receiving.
 */
export const INTAKE_STATUSES = ['received', 'matched', 'applied', 'ignored'] as const
export type IntakeStatus = (typeof INTAKE_STATUSES)[number]

export interface IntakeRow {
  id: string
  source: IntakeSource
  kind: IntakeKind
  status: IntakeStatus

  /**
   * The sending system's own id for this row.
   *
   * Used as the document id, so sending the same row twice overwrites rather
   * than duplicating. An integration that cannot be retried safely will be
   * retried unsafely.
   */
  externalId: string

  /** The day the figures belong to. */
  date: string

  /* ---- Who it is about, in the sender's terms ---------------------- */

  /** Their id for the client. Matched against `client.externalRefs`. */
  externalClientRef: string
  /** Their name for it, so an unmatched row is still readable. */
  externalClientName: string
  /** Their id for the person, when the row is about an earning. */
  externalEmployeeRef: string
  externalEmployeeName: string

  /* ---- Who it turned out to be, once matched ----------------------- */

  clientId: string | null
  employeeUid: string | null

  /* ---- The figures ------------------------------------------------- */

  /**
   * What the client took in total, through every channel.
   *
   * The RMS knows this because it sees every reservation. It is NOT what we
   * brought them — see `attributed` — and treating it as our achievement would
   * credit us with the bookings that would have happened anyway.
   */
  turnover: Money | null

  /**
   * The part of that turnover we brought them.
   *
   * Nullable because the RMS usually does not know it: it records reservations,
   * not which of them came from our marketing or our direct-booking work. When
   * it can tell, it sends it here; when it cannot, the figure is recorded in
   * MsEe Central instead — see `Attribution`.
   *
   * This is the number the whole exercise exists for. "Their turnover went up"
   * is their news; "we brought them this much of it" is ours.
   */
  attributed: Money | null

  /** Our share of what we brought. Commission, not turnover. */
  ourShare: Money | null
  /** What one of our people earned. */
  earning: Money | null
  reservations: number
  nights: number

  note: string

  /** When the sender wrote it. */
  receivedAt: string
  /** When somebody here acted on it. */
  appliedAt: string | null
  appliedBy: string | null
  walletEntryId: string | null
}

/**
 * Totals for one client over a set of rows.
 *
 * Derived, never stored — the same rule the rest of this system follows. Two
 * screens showing a client's turnover cannot disagree if neither of them keeps
 * its own copy.
 */
export interface ClientTrading {
  clientId: string
  /** Everything they took, through every channel. */
  turnoverBaseMinor: number
  /** The part we brought them. */
  attributedBaseMinor: number
  /** Our commission on that part. */
  ourShareBaseMinor: number
  reservations: number
  nights: number
  days: number
  /** The most recent day the sender has reported. */
  through: string
}

/**
 * What proportion of a client's trade we are responsible for.
 *
 * Returns null rather than zero when there is nothing to divide: a client with
 * no reported turnover has no share, and showing 0% would read as "we brought
 * them nothing" rather than "nothing has been reported yet".
 */
export function sharePercent(trading: ClientTrading): number | null {
  if (trading.turnoverBaseMinor <= 0) return null
  return Math.round((trading.attributedBaseMinor / trading.turnoverBaseMinor) * 100)
}

export function tradingFor(clientId: string, rows: IntakeRow[]): ClientTrading {
  const mine = rows.filter((r) => r.clientId === clientId && r.kind === 'client_day')

  return {
    clientId,
    turnoverBaseMinor: mine.reduce((n, r) => n + (r.turnover?.baseMinor ?? 0), 0),
    attributedBaseMinor: mine.reduce((n, r) => n + (r.attributed?.baseMinor ?? 0), 0),
    ourShareBaseMinor: mine.reduce((n, r) => n + (r.ourShare?.baseMinor ?? 0), 0),
    reservations: mine.reduce((n, r) => n + (r.reservations ?? 0), 0),
    nights: mine.reduce((n, r) => n + (r.nights ?? 0), 0),
    days: mine.length,
    through: mine.reduce((latest, r) => (r.date > latest ? r.date : latest), ''),
  }
}

/**
 * Match a row to a client, using the references already on our clients.
 *
 * Returns null rather than guessing. An unmatched row is a question for a
 * person — "who is `HOTEL-114`?" — and attaching it to the closest-looking
 * client would put somebody else's turnover on the wrong account.
 */
export function matchClient(
  row: IntakeRow,
  clients: { id: string; externalRefs?: { system: string; reference: string }[] }[],
): string | null {
  if (!row.externalClientRef) return null

  const found = clients.find((client) =>
    (client.externalRefs ?? []).some(
      (ref) => ref.reference === row.externalClientRef && ref.system === row.source,
    ),
  )

  return found?.id ?? null
}
