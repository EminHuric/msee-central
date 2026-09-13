/**
 * Telling the owner what is about to need attention.
 *
 * EVERY OTHER NOTIFICATION IN THIS SYSTEM REPORTS THE PAST. A sale happened, a
 * payment arrived, a cost went out — useful, and all of it too late to change.
 * This is the one that looks forward: an instalment due in three days, an invoice
 * that has been unpaid for a month. It is the only kind that can still alter the
 * outcome.
 *
 * WHY IT RUNS IN THE BROWSER AND NOT ON A SCHEDULE. There is no server. A daily
 * job would need one, so instead this runs when somebody opens the dashboard,
 * which for this company is most days and always before anything is decided. The
 * cost of the compromise is honest: a week away from the screen is a week with no
 * reminders, and nothing here pretends otherwise.
 *
 * WHY IT REMEMBERS WHAT IT SAID, IN THIS BROWSER. Opening the dashboard four
 * times must not send four reminders about the same invoice; a reminder that
 * repeats is a reminder that gets ignored, and then the one that mattered is
 * ignored with it. What has already been said today is kept in local storage —
 * per device, which is the right grain, because it is the person at this screen
 * who is being told and it costs the database nothing.
 */

import { tellOwners } from './owners'
import { BASE_CURRENCY, formatMoney } from '@/types/money'
import { balanceOf } from '@/types/revenue'
import type { Snapshot } from './metrics'

const SAID_KEY = 'msee.reminded'

/** A debt is worth chasing once it has been ignored for this long. */
const CHASE_AFTER_DAYS = 30

/** A payment is worth mentioning this far before it is due. */
const WARN_BEFORE_DAYS = 3

const today = () => new Date().toISOString().slice(0, 10)

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

/**
 * Has this exact thing already been said today?
 *
 * Keyed by the subject AND the day, so the same invoice can be raised again
 * tomorrow — which is the point of chasing — but not four times this morning.
 */
function alreadySaid(key: string): boolean {
  try {
    const raw = localStorage.getItem(SAID_KEY)
    const said = raw ? (JSON.parse(raw) as Record<string, string>) : {}
    return said[key] === today()
  } catch {
    /*
     * Storage blocked or unreadable. Saying it again is the safer failure: a
     * repeated reminder is annoying, a missed one costs money.
     */
    return false
  }
}

function remember(key: string): void {
  try {
    const raw = localStorage.getItem(SAID_KEY)
    const said = raw ? (JSON.parse(raw) as Record<string, string>) : {}

    said[key] = today()

    /* Yesterday's notes are of no use to anybody; keep only what is current. */
    const current = Object.fromEntries(
      Object.entries(said).filter(([, day]) => day === today()),
    )
    localStorage.setItem(SAID_KEY, JSON.stringify(current))
  } catch {
    /* Not remembered means it may be said again. Acceptable; see above. */
  }
}

/**
 * Look over what is owed and what is coming, and say the parts worth saying.
 *
 * Reads the snapshot the dashboard has already loaded rather than fetching
 * anything, so a page that has drawn costs nothing more to check.
 */
export async function remindAboutMoney(snap: Snapshot): Promise<number> {
  const now = today()
  let sent = 0

  /* ---- Debts that have been ignored long enough --------------------- */

  for (const sale of snap.sales) {
    const balance = balanceOf(sale, snap.transactions)
    if (balance.remainingBaseMinor <= 0) continue

    const age = daysBetween(sale.saleDate, now)
    if (age < CHASE_AFTER_DAYS) continue

    const key = `overdue:${sale.id}`
    if (alreadySaid(key)) continue

    await tellOwners({
      kind: 'payment_overdue',
      priority: age >= 60 ? 'important' : 'normal',
      title: sale.clientName || sale.title,
      body: `${formatMoney(balance.remainingBaseMinor, BASE_CURRENCY, 'en')} · ${age}d`,
      link: '/sales',
    })

    remember(key)
    sent += 1
  }

  /* ---- Money expected in the next few days -------------------------- */

  for (const tx of snap.transactions) {
    if (tx.status === 'paid' || !tx.dueDate) continue

    const until = daysBetween(now, tx.dueDate)
    /* Past due is covered above by the sale it belongs to; this is the warning. */
    if (until < 0 || until > WARN_BEFORE_DAYS) continue

    const key = `due:${tx.id}:${tx.dueDate}`
    if (alreadySaid(key)) continue

    await tellOwners({
      kind: 'payment_overdue',
      priority: 'normal',
      title: tx.description || tx.clientName,
      body: `${formatMoney(tx.amount.baseMinor, BASE_CURRENCY, 'en')} · ${tx.dueDate}`,
      link: '/finance',
    })

    remember(key)
    sent += 1
  }

  return sent
}
