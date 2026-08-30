/**
 * Shared input rules.
 *
 * Client-side validation is for telling somebody they made a typo before they
 * wait on a round trip. It is not a security control — the Firestore rules
 * decide what may actually be written.
 */

/** Minimum password length for an employee account. */
export const PASSWORD_MIN_LENGTH = 10

/** Field length caps, so one long paste cannot bloat a document. */
export const LIMITS = {
  name: 60,
  email: 254,
  phone: 32,
  city: 80,
  country: 80,
  position: 100,
  shortText: 600,
  longText: 2000,
  note: 4000,
} as const

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
}

/**
 * Deliberately permissive: digits, spaces and the usual separators, 6 to 20
 * digits. Employees are in several countries and a strict national format
 * would reject valid numbers.
 */
export function isPhone(value: string): boolean {
  const trimmed = value.trim()
  if (!/^[+\d][\d\s\-().]*$/.test(trimmed)) return false
  const digits = trimmed.replace(/\D/g, '')
  return digits.length >= 6 && digits.length <= 20
}

export function isNotBlank(value: string): boolean {
  return value.trim().length > 0
}

export function withinLimit(value: string, limit: number): boolean {
  return value.trim().length <= limit
}
