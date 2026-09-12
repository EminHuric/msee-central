/**
 * The RMS logins this browser remembers, one per property.
 *
 * WHY PER PROPERTY. Every client has their own account in the RMS, and reading a
 * property as the account that owns it is the correct authorisation: MsEe Central
 * sees exactly what that owner sees, and nothing about any other client. The
 * alternative — one administrator login that can read the whole platform — works
 * with fewer steps and more reach than the job needs.
 *
 * WHY THE PASSWORD IS IN THE BROWSER AND NOT IN THE DATABASE, which is the only
 * decision here that matters.
 *
 * A client's RMS password is theirs. Putting it in Firestore would mean every
 * employee holding `staybrain.view` could read every client's password out of the
 * listing, and one breach of our database would be a breach of their booking
 * systems too. No rule can prevent the first of those, because the rules protect
 * documents and not fields.
 *
 * So it is kept where it does least harm: this browser, for this person. It is
 * therefore per device — on a second computer it is entered once more. That is
 * the cost, and it is a smaller cost than the alternative.
 *
 * The email is NOT kept here. It identifies the account rather than opening it,
 * so it lives on the listing where everybody can see which account a property is
 * linked to.
 *
 * OBFUSCATION IS NOT ENCRYPTION, and this does not pretend otherwise. Anything
 * the browser can read back without a key the person types is readable by anybody
 * at this machine. It stops a password being legible over a shoulder in devtools;
 * it stops nothing else. The RMS itself stores its account switcher the same way,
 * with the same caveat written in the same plain words.
 */

import { reactive } from 'vue'

const KEY = 'msee_rms_logins'

interface Stored {
  /** The account this password opens. Lower-cased for matching. */
  email: string
  secret: string
  savedAt: number
}

function read(): Stored[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? (list as Stored[]) : []
  } catch {
    /*
     * A private window, cleared site data, or a browser refusing storage. An
     * empty list is the right answer to all three: the person signs in again.
     */
    return []
  }
}

function write(list: Stored[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* Nothing to do and nothing to say: the session still works, it just will
     * not be remembered. */
  }
}

/** Reactive so a screen can show which properties will connect by themselves. */
const state = reactive<{ list: Stored[] }>({ list: read() })

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

function hide(password: string): string {
  try {
    return btoa(encodeURIComponent(password))
  } catch {
    return ''
  }
}

function show(secret: string): string {
  try {
    return decodeURIComponent(atob(secret))
  } catch {
    return ''
  }
}

/** Remember a login that has just worked. */
export function rememberRmsLogin(email: string, password: string): void {
  if (!email.trim() || !password) return

  const entry: Stored = { email: email.trim().toLowerCase(), secret: hide(password), savedAt: Date.now() }
  const list = state.list.filter((row) => !same(row.email, email))
  list.push(entry)
  state.list = list
  write(list)
}

/** The password for an account, if this browser has one. */
export function rmsLoginFor(email: string): string | null {
  if (!email.trim()) return null
  const row = state.list.find((entry) => same(entry.email, email))
  if (!row) return null
  const password = show(row.secret)
  return password || null
}

export const remembersRmsLogin = (email: string): boolean => rmsLoginFor(email) !== null

/**
 * Forget one.
 *
 * Called deliberately by a person, and also automatically when a remembered
 * password stops working — a password that has been changed at the other end is
 * not worth retrying on every visit, and keeping it would make the failure look
 * permanent rather than fixable.
 */
export function forgetRmsLogin(email: string): void {
  state.list = state.list.filter((row) => !same(row.email, email))
  write(state.list)
}

/** Every account remembered here, for a screen that offers to forget them. */
export const rememberedRmsLogins = (): string[] => state.list.map((row) => row.email)
