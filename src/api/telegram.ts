/**
 * Sending a notification on to Telegram.
 *
 * WHY THROUGH A RELAY. A bot token is a credential and this application is a
 * static site in a public repository — anything it holds is readable by anybody
 * who opens the console. So the token lives in a Cloudflare Worker and this only
 * ever says "send this sentence". See `worker/README.md`.
 *
 * WHAT IS SENT WITH IT. The signed-in person's Firebase ID token, which the relay
 * verifies against this project before it touches Telegram. That is what stops
 * the relay being a public address anybody can ring somebody's phone from.
 *
 * WHY NOTHING HERE EVER THROWS. A message that fails to send is an
 * inconvenience; a sale that fails to save because its message did not send is a
 * fault. Every path returns quietly, and the one place that wants to know — the
 * test button in settings — asks for the answer explicitly.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore'

import { getDb, getFirebaseAuth } from '@/lib/firebase'

const SETTINGS_PATH = ['companySettings', 'telegram'] as const

export interface TelegramSettings {
  /** The Worker's address. Not a secret — it refuses anybody without a token. */
  relayUrl: string
  enabled: boolean
}

const BLANK: TelegramSettings = { relayUrl: '', enabled: false }

export async function fetchTelegramSettings(): Promise<TelegramSettings> {
  try {
    const snap = await getDoc(doc(getDb(), ...SETTINGS_PATH))
    if (!snap.exists()) return { ...BLANK }

    const data = snap.data()
    return {
      relayUrl: String(data.relayUrl ?? ''),
      enabled: data.enabled === true,
    }
  } catch {
    /* Unreadable settings mean the feature is simply off. */
    return { ...BLANK }
  }
}

export async function saveTelegramSettings(input: TelegramSettings): Promise<void> {
  await setDoc(
    doc(getDb(), ...SETTINGS_PATH),
    {
      relayUrl: input.relayUrl.trim(),
      enabled: input.enabled,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  )
}

/**
 * Cached for the session.
 *
 * Every notification would otherwise read the same settings document again, and
 * a notification is already a side effect of something more important — it should
 * not add a database read to it.
 */
let cached: TelegramSettings | null = null

export const forgetTelegramCache = (): void => {
  cached = null
}

/**
 * Send one line to Telegram, if it is switched on.
 *
 * Returns what happened only so the test button can report it. Every caller in
 * the ordinary flow ignores the answer, which is correct: nothing in this
 * application should behave differently because a phone did or did not buzz.
 */
export async function sendToTelegram(
  text: string,
  settings?: TelegramSettings,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const config = settings ?? cached ?? (cached = await fetchTelegramSettings())
    if (!config.enabled || !config.relayUrl) return { ok: false, error: 'off' }

    const user = getFirebaseAuth().currentUser
    if (!user) return { ok: false, error: 'not signed in' }

    const response = await fetch(config.relayUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        /* Proof of who is asking. The relay verifies it against this project. */
        authorization: `Bearer ${await user.getIdToken()}`,
      },
      body: JSON.stringify({ text }),
    })

    if (response.ok) return { ok: true }

    /*
     * The relay's own words, passed through untouched. "chat not found" and
     * "not your project" each point at a different setting, and turning both
     * into "could not send" would leave somebody guessing which.
     */
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    return { ok: false, error: body.error || `HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
