/**
 * The relay that carries notifications from MsEe Central to Telegram.
 *
 * WHY ANYTHING SITS HERE AT ALL. A Telegram bot token is a credential: whoever
 * holds it can post as the bot and read what is sent to it. MsEe Central is a
 * static site, so anything it holds is readable by anybody who opens the browser
 * console — and its repository is public. The token therefore cannot live in the
 * app. It lives here, in a Cloudflare Worker's secrets, and the app only ever
 * says "send this sentence".
 *
 * WHY THAT IS NOT AN OPEN DOOR. A URL anybody can POST to is a URL anybody can
 * spam, and this one rings a phone. So every request must carry a Firebase ID
 * token issued by this company's own project, and this verifies it properly:
 * Google's signing certificate, the RSA signature, the issuer, the audience and
 * the expiry. A request without one is refused before Telegram is ever called.
 *
 * That is real verification and not a shared password. A shared password would
 * have to be in the app to be sent, which puts it back in the browser and back in
 * the public repository — the exact problem this exists to avoid.
 *
 * WHAT IT COSTS. Nothing. Cloudflare's free tier is a hundred thousand requests a
 * day; this company will send a few dozen. No card, no plan, no billing account.
 *
 * ---------------------------------------------------------------------------
 * SETUP — see worker/README.md for the click-by-click version.
 *
 *   Secrets this Worker needs:
 *     TELEGRAM_TOKEN   from @BotFather when you create the bot
 *     TELEGRAM_CHAT    your own chat id, from @userinfobot
 *     FIREBASE_PROJECT the Firebase project id, e.g. msee-central
 * ---------------------------------------------------------------------------
 */

const GOOGLE_CERTS =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'

/* Certificates change rarely and are fetched on every cold start at most. */
let certCache = { at: 0, certs: null }

async function signingCerts() {
  const hour = 60 * 60 * 1000
  if (certCache.certs && Date.now() - certCache.at < hour) return certCache.certs

  const response = await fetch(GOOGLE_CERTS)
  if (!response.ok) throw new Error('certs unavailable')

  certCache = { at: Date.now(), certs: await response.json() }
  return certCache.certs
}

const base64url = (value) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/** The public key out of a PEM certificate, ready for WebCrypto. */
async function keyFromCert(pem) {
  const body = pem
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s+/g, '')

  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))

  /*
   * The certificate is X.509 and WebCrypto imports SPKI, so the public key is
   * taken out of it. Locating it by its OID is the reliable way — the offsets
   * differ between certificates and a fixed one works until it suddenly does not.
   */
  const oid = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]
  let at = -1
  for (let i = 0; i < der.length - oid.length; i += 1) {
    if (oid.every((byte, n) => der[i + n] === byte)) {
      at = i
      break
    }
  }
  if (at < 0) throw new Error('key not found in certificate')

  /* Walk back to the SEQUENCE that opens the SubjectPublicKeyInfo. */
  let start = at - 4
  while (start > 0 && der[start] !== 0x30) start -= 1

  const spki = der.slice(start)

  return crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
}

/**
 * Is this a genuine, current ID token from our own Firebase project?
 *
 * Everything here is checked because each omission is a way in: an unverified
 * signature accepts a forged token, a missing audience check accepts a real token
 * from somebody else's project, and a missing expiry check accepts one that
 * should have died an hour ago.
 */
async function isOurUser(token, projectId) {
  const [head, body, signature] = String(token).split('.')
  if (!head || !body || !signature) return false

  const header = JSON.parse(new TextDecoder().decode(base64url(head)))
  const claims = JSON.parse(new TextDecoder().decode(base64url(body)))

  if (header.alg !== 'RS256' || !header.kid) return false
  if (claims.aud !== projectId) return false
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) return false

  const now = Math.floor(Date.now() / 1000)
  if (!claims.exp || claims.exp < now) return false
  if (claims.auth_time && claims.auth_time > now + 60) return false
  if (!claims.sub) return false

  const certs = await signingCerts()
  const pem = certs[header.kid]
  if (!pem) return false

  const key = await keyFromCert(pem)

  return crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64url(signature),
    new TextEncoder().encode(`${head}.${body}`),
  )
}

const reply = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      /* The app is served from another origin, so the browser asks first. */
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
    },
  })

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return reply(204, {})
    if (request.method !== 'POST') return reply(405, { error: 'POST only' })

    if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT || !env.FIREBASE_PROJECT) {
      return reply(500, { error: 'relay not configured' })
    }

    const auth = request.headers.get('authorization') || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return reply(401, { error: 'no token' })

    let allowed = false
    try {
      allowed = await isOurUser(token, env.FIREBASE_PROJECT)
    } catch {
      allowed = false
    }
    if (!allowed) return reply(403, { error: 'not your project' })

    let text = ''
    try {
      const body = await request.json()
      text = String(body.text ?? '').slice(0, 3500)
    } catch {
      return reply(400, { error: 'expected json' })
    }
    if (!text.trim()) return reply(400, { error: 'nothing to send' })

    const sent = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT,
          text,
          disable_web_page_preview: true,
        }),
      },
    )

    if (!sent.ok) {
      /* Telegram's own words, so a misconfigured bot says which part is wrong. */
      return reply(502, { error: await sent.text() })
    }

    return reply(200, { ok: true })
  },
}
