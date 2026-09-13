# Telegram notifications

Notifications from MsEe Central arriving on your phone, free, with no card and no
billing account.

## Why there is a relay at all

A Telegram bot token is a credential — whoever has it can post as your bot. MsEe
Central is a static site, so anything it holds can be read by anyone who opens the
browser console, and this repository is public. The token lives in the relay
instead; the app only ever says "send this sentence".

The relay refuses anybody else: every request must carry a Firebase ID token from
this company's own project, and the signature, issuer, audience and expiry are all
verified before Telegram is touched.

## Setting it up — about ten minutes, once

### 1. Make the bot

In Telegram, message **@BotFather**:

```
/newbot
```

Give it a name. It replies with a token like `7123456789:AAF…`. Keep it.

### 2. Find your chat id

Message **@userinfobot**. It replies with your id, a number like `512345678`.

Then **send your new bot any message** (`/start`). Telegram will not let a bot
write to somebody who has never written to it.

### 3. Create the Worker

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com) — free, no card.
2. **Workers & Pages** → **Create** → **Start with Hello World** → **Deploy**.
3. **Edit code**, delete what is there, paste all of `telegram-relay.js`, **Deploy**.

### 4. Give it the three secrets

On the Worker: **Settings** → **Variables and Secrets** → **Add**, type *Secret*:

| Name | Value |
|---|---|
| `TELEGRAM_TOKEN` | the token from BotFather |
| `TELEGRAM_CHAT` | your chat id |
| `FIREBASE_PROJECT` | `msee-central` |

Deploy again so the secrets take effect.

### 5. Tell MsEe Central where it is

Copy the Worker's address — `https://something.workers.dev` — and paste it into
**Settings → Notifications → Telegram**, then press **Test**. A message should
arrive on your phone within a second.

## What gets sent

The same events the bell shows: a sale, a payment received, a cost recorded, a new
client, bookings collected from the reservation system, and a debt that has gone
unpaid too long. If it is worth a notification it is worth a message.

## If nothing arrives

The test button reports what the relay said, which is usually enough:

- **not your project** — `FIREBASE_PROJECT` does not match; it is `msee-central`.
- **relay not configured** — a secret is missing, or it was added but not
  redeployed.
- **chat not found** — you have not messaged the bot yet. Send it `/start`.
- **not configured** in MsEe Central — the address has not been saved.

## What it costs

Nothing. Cloudflare's free tier allows a hundred thousand requests a day and this
sends a few dozen. There is no card on the account and no plan to cancel.
