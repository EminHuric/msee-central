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
  /**
   * The bot's token and the chat to send to — the simple way.
   *
   * WHAT THIS COSTS IN SAFETY, SAID PLAINLY. These are stored in the company's
   * settings document, which means they are NOT in the public repository, but
   * they do reach the browser of every member of staff who can read settings. Any
   * of them could take the token out of the console and post as this bot, or read
   * what people send it.
   *
   * For a bot whose only job is to tell one owner that a booking arrived, that is
   * a proportionate risk: the worst somebody can do with it is send fake messages
   * to a phone. It is not proportionate for a bot that can do anything else, and
   * anyone adding one should use the relay below instead.
   */
  botToken: string
  chatId: string
  /**
   * A relay's address, for anybody who would rather the token never reach a
   * browser at all. When this is set it is used and the two fields above are
   * ignored. See `worker/README.md`.
   */
  relayUrl: string
  enabled: boolean
}

const BLANK: TelegramSettings = { botToken: '', chatId: '', relayUrl: '', enabled: false }

export async function fetchTelegramSettings(): Promise<TelegramSettings> {
  try {
    const snap = await getDoc(doc(getDb(), ...SETTINGS_PATH))
    if (!snap.exists()) return { ...BLANK }

    const data = snap.data()
    return {
      botToken: String(data.botToken ?? ''),
      chatId: String(data.chatId ?? ''),
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
      botToken: input.botToken.trim(),
      chatId: input.chatId.trim(),
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

/** Straight to Telegram. The browser can call it; the API allows it. */
async function viaTelegram(
  config: TelegramSettings,
  text: string,
): Promise<Response | null> {
  if (!config.botToken || !config.chatId) return null

  return fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: config.chatId,
      text,
      disable_web_page_preview: true,
    }),
  })
}

/** Through a relay, which holds the token and verifies who is asking. */
async function viaRelay(url: string, text: string): Promise<Response | null> {
  const user = getFirebaseAuth().currentUser
  if (!user) return null

  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await user.getIdToken()}`,
    },
    body: JSON.stringify({ text }),
  })
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
    if (!config.enabled) return { ok: false, error: 'off' }

    /*
     * Two ways to reach Telegram, and the relay wins when it is set up.
     *
     * Somebody who has gone to the trouble of standing one up has decided the
     * token should not be in a browser, and that decision should not be undone by
     * a token sitting in a settings field from an earlier attempt.
     */
    const response = config.relayUrl
      ? await viaRelay(config.relayUrl, text)
      : await viaTelegram(config, text)

    if (!response) return { ok: false, error: 'not configured' }

    if (response.ok) return { ok: true }

    /*
     * The relay's own words, passed through untouched. "chat not found" and
     * "not your project" each point at a different setting, and turning both
     * into "could not send" would leave somebody guessing which.
     */
    const body = (await response.json().catch(() => ({}))) as {
      error?: string
      description?: string
    }
    /* Telegram calls it `description`; the relay calls it `error`. Either way,
     * the words that come back are the ones that say which step is wrong. */
    return { ok: false, error: body.description || body.error || `HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
