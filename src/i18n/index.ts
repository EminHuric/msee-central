/**
 * MsEe Central — internationalisation.
 *
 * English is the default. The chosen language persists in localStorage and is
 * mirrored onto <html lang> so screen readers and browser spell-checking use
 * the right language too.
 */

import { createI18n } from 'vue-i18n'

import en from './locales/en'
import sr from './locales/sr'

export const SUPPORTED_LOCALES = ['en', 'sr'] as const
export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: AppLocale = 'en'

const STORAGE_KEY = 'msee.locale'

function isSupported(value: string | null): value is AppLocale {
  return value !== null && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * A previous explicit choice, otherwise English.
 *
 * Browser language is deliberately NOT consulted. Most of the company browses
 * in Serbian, and the application is meant to open in English until somebody
 * chooses otherwise with the switch in the header.
 */
export function resolveInitialLocale(): AppLocale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isSupported(stored)) return stored
  } catch {
    // localStorage can throw in private browsing modes; fall through.
  }

  return DEFAULT_LOCALE
}

/**
 * Serbian plural selection.
 *
 * Serbian distinguishes one (1, 21, 31…), few (2–4, 22–24…) and many (5–20,
 * 25–30…). A leading "none" slot is added so catalogues can phrase zero
 * naturally ("Nema rezultata") instead of "0 rezultata".
 */
function serbianPluralRule(choice: number, choicesLength: number): number {
  if (choicesLength < 4) {
    // Catalogue did not supply a "none" slot; fall back to one/few/many.
    return serbianPluralRule(choice, 4) - 1
  }

  if (choice === 0) return 0

  const mod10 = choice % 10
  const mod100 = choice % 100

  if (mod10 === 1 && mod100 !== 11) return 1
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 2
  return 3
}

export const i18n = createI18n({
  legacy: false,
  locale: resolveInitialLocale(),
  fallbackLocale: DEFAULT_LOCALE,
  globalInjection: true,
  messages: { sr, en },
  pluralRules: {
    sr: serbianPluralRule,
  },
  // Serbian and English catalogues are intentionally complete; warn loudly in
  // development if a key is ever missed rather than silently showing the key.
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
})

/** Change language, persist it, and keep <html lang> in sync. */
export function setLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
  document.documentElement.setAttribute('lang', locale)
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Persistence is a convenience, not a requirement.
  }
}

export function currentLocale(): AppLocale {
  return i18n.global.locale.value as AppLocale
}

/** Locale-aware date formatting used across tables and profiles. */
export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  const locale = currentLocale() === 'sr' ? 'sr-Latn-RS' : 'en-GB'
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date)
}

/** "3 minutes ago" style, for the activity feed. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'

  const locale = currentLocale() === 'sr' ? 'sr-Latn-RS' : 'en-GB'
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const seconds = Math.round((date.getTime() - Date.now()) / 1000)

  const divisions: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.35, 'week'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ]

  let duration = seconds
  for (const [amount, unit] of divisions) {
    if (Math.abs(duration) < amount) {
      return rtf.format(Math.round(duration), unit)
    }
    duration /= amount
  }

  return formatDate(iso)
}
