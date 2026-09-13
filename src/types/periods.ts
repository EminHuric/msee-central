/**
 * The periods every screen can be filtered by.
 *
 * ITS OWN FILE, WITH NO IMPORTS, ON PURPOSE. The list lives here rather than in
 * `api/metrics.ts` so that tooling can read it: the label check runs under Node's
 * type stripping, which cannot follow the chain of imports a module like metrics
 * pulls in. A constant nothing can import is a constant nothing can verify — and
 * four of these once shipped with no translation at all, printing `period.last7`
 * on the dashboard for anybody to read.
 */

export const PERIOD_KEYS = [
  'today',
  'yesterday',
  'last7',
  'last30',
  'month',
  'prev_month',
  'quarter',
  'year',
  'all',
  'custom',
] as const

export type PeriodKey = (typeof PERIOD_KEYS)[number]
