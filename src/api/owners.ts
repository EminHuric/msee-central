/**
 * Telling the owners what happened.
 *
 * WHY EVERY EVENT GOES TO THE SAME SMALL AUDIENCE. A notification is only worth
 * sending to somebody who can act on it or is answerable for it. A sale, a
 * payment, a cost, a new client — all four are the owner's business and none of
 * them is an employee's, so all four arrive in one place and nobody else's bell
 * rings for work they cannot do anything about. A bell that rings for everybody
 * about everything is a bell people turn off.
 *
 * WHY IT NEVER THROWS. These are announcements about something that has already
 * happened and already been written. If the announcement fails the sale still
 * happened; refusing to save a sale because its notification did not send would
 * be the tail wagging the dog. Every failure here is swallowed on purpose, which
 * is the same decision `notify` itself already makes.
 *
 * WHY IT SKIPS THE PERSON WHO CAUSED IT. They pressed the button. Telling them
 * what they just did is noise, and noise is what teaches people to stop reading.
 */

import { collection, getDocs, query, where } from 'firebase/firestore'

import { notify } from './notifications'
import { actor } from './store'
import { getDb } from '@/lib/firebase'
import type { NotificationKind, NotificationPriority } from '@/types/company'

/**
 * The owners, minus whoever is acting.
 *
 * Read from `userPermissions`, the same documents the security rules consult, so
 * this cannot drift from who actually is an owner. A failed read means nobody is
 * told, which is the right way to fail: silence, not a broken save.
 */
async function owners(): Promise<string[]> {
  const me = actor()

  try {
    const snap = await getDocs(
      query(collection(getDb(), 'userPermissions'), where('isCeo', '==', true)),
    )
    return snap.docs.map((d) => d.id).filter((uid) => uid && uid !== me.uid)
  } catch {
    return []
  }
}

export interface OwnerNews {
  kind: NotificationKind
  /** The thing itself: a client's name, a sale's title. Data, not a sentence. */
  title: string
  /** Usually an amount, already formatted with its currency. */
  body?: string
  link?: string
  priority?: NotificationPriority
}

/**
 * Tell the owners, and never let it break the thing that caused it.
 *
 * The text is deliberately data rather than a phrase: the bell prints the title
 * as written and translates the KIND beside it, so one message reads correctly in
 * both languages without this having to know which one anybody is using.
 */
export async function tellOwners(news: OwnerNews): Promise<void> {
  try {
    const uids = await owners()

    for (const uid of uids) {
      await notify(uid, {
        kind: news.kind,
        priority: news.priority ?? 'normal',
        title: news.title,
        body: news.body ?? '',
        link: news.link ?? null,
      })
    }
  } catch {
    /* Announcements never break the thing they are announcing. */
  }
}
