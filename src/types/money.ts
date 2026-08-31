/**
 * Money.
 *
 * TWO DECISIONS WORTH STATING, BECAUSE BOTH ARE EASY TO GET WRONG.
 *
 * 1. Amounts are stored as whole minor units — para, cents — never as
 *    decimals. 0.1 + 0.2 is not 0.3 in binary floating point, and a rounding
 *    error in an invoice total is the kind of bug that is noticed by a client
 *    rather than by a test. Integers cannot drift.
 *
 * 2. Every amount carries the exchange rate that applied ON ITS OWN DATE, and
 *    the converted value is stored alongside it. Converting at display time
 *    with today's rate would silently rewrite last year's revenue every
 *    morning. What something was worth when it happened does not change.
 */

export const CURRENCIES = ['RSD', 'EUR'] as const
export type CurrencyCode = (typeof CURRENCIES)[number]

/** What every total is expressed in. Company-wide. */
export const BASE_CURRENCY: CurrencyCode = 'RSD'

export const CURRENCY_INFO: Record<CurrencyCode, { symbol: string; minorUnits: number }> = {
  RSD: { symbol: 'RSD', minorUnits: 2 },
  EUR: { symbol: '€', minorUnits: 2 },
}

/**
 * An amount of money, frozen at the moment it was recorded.
 *
 * `baseMinor` is not redundant with `minor * rate` — it is the answer as it
 * stood on `rateDate`, kept so a report of last quarter reads the same next
 * year as it did then.
 */
export interface Money {
  /** Whole minor units: 1250 RSD is 125000. */
  minor: number
  currency: CurrencyCode
  /** Units of the base currency per one unit of `currency`, on rateDate. */
  rate: number
  /** `minor * rate`, rounded, in the base currency's minor units. */
  baseMinor: number
  /** ISO date the rate was taken for. */
  rateDate: string
}

export function toMinor(amount: number, currency: CurrencyCode = BASE_CURRENCY): number {
  const factor = 10 ** CURRENCY_INFO[currency].minorUnits
  return Math.round(amount * factor)
}

export function fromMinor(minor: number, currency: CurrencyCode = BASE_CURRENCY): number {
  const factor = 10 ** CURRENCY_INFO[currency].minorUnits
  return minor / factor
}


export function makeMoney(
  amount: number,
  currency: CurrencyCode,
  rate: number,
  rateDate: string,
): Money {
  const minor = toMinor(amount, currency)
  return {
    minor,
    currency,
    rate,
    baseMinor: Math.round(minor * rate),
    rateDate,
  }
}

export const ZERO_MONEY: Money = {
  minor: 0,
  currency: BASE_CURRENCY,
  rate: 1,
  baseMinor: 0,
  rateDate: '',
}


export function sumBase(entries: { amount: Money }[]): number {
  return entries.reduce((total, entry) => total + (entry.amount?.baseMinor ?? 0), 0)
}

export function formatMoney(
  minor: number,
  currency: CurrencyCode = BASE_CURRENCY,
  locale = 'sr',
): string {
  const value = fromMinor(minor, currency)
  return new Intl.NumberFormat(locale === 'sr' ? 'sr-Latn-RS' : 'en-GB', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'RSD' ? 0 : 2,
  }).format(value)
}


export function formatMoneyShort(
  minor: number,
  currency: CurrencyCode = BASE_CURRENCY,
  locale = 'sr',
): string {
  const value = fromMinor(minor, currency)
  return new Intl.NumberFormat(locale === 'sr' ? 'sr-Latn-RS' : 'en-GB', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}
