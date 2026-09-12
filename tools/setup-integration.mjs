/**
 * Create the account the RMS writes with, and print the contract.
 *
 * WHY THIS DIRECTION. MsEe Central cannot reach out to the RMS from a browser:
 * the connection needs a key, and a key in a browser is a published key. The
 * RMS reaching in has none of that problem — it already has a server, the key
 * lives there, and it writes here as itself.
 *
 * WHAT THIS ACCOUNT CAN DO. One thing: write rows into `intake`. It reads
 * nothing, writes nowhere else, and holds no permissions at all. If its
 * password leaks, what leaks is the ability to send us numbers — not the
 * ability to read the company. That is the entire point of giving it its own
 * account rather than reusing somebody's.
 *
 *   npm run setup:integration
 *   npm run setup:integration -- --reset   (new password for the existing one)
 */

import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cert, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

let serviceAccount
try {
  serviceAccount = JSON.parse(readFileSync(resolve(here, 'serviceAccount.json'), 'utf8'))
} catch {
  console.error('\n  tools/serviceAccount.json not found.\n')
  process.exit(1)
}

function readEnv() {
  const out = {}
  for (const line of readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const i = line.indexOf('=')
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

const env = readEnv()
initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
const auth = getAuth()
const db = getFirestore()

const reset = process.argv.includes('--reset')
const EMAIL = 'rms-integration@msee-central.internal'

/* Long and random: nobody types this, a server reads it from its own config. */
const password = randomBytes(24).toString('base64url')

console.log('\n  RMS integration account')
console.log(`  project: ${serviceAccount.project_id}\n`)

let user
try {
  user = await auth.getUserByEmail(EMAIL)
  if (reset) {
    await auth.updateUser(user.uid, { password })
    console.log('  password replaced')
  } else {
    console.log('  account already exists — use --reset for a new password')
  }
} catch {
  user = await auth.createUser({
    email: EMAIL,
    password,
    displayName: 'RMS integration',
    emailVerified: true,
  })
  console.log('  account created')
}

/*
 * Its access document. `accountType: 'integration'` is what the rules key off;
 * the empty permission list is deliberate and the rules never consult it.
 */
await db.collection('userPermissions').doc(user.uid).set(
  {
    uid: user.uid,
    status: 'active',
    accountType: 'integration',
    isCeo: false,
    isFounder: false,
    roleIds: [],
    permissions: [],
    granted: [],
    revoked: [],
    scopes: {},
    updatedAt: new Date().toISOString(),
    updatedBy: 'system:setup',
  },
  { merge: true },
)

console.log(`  uid: ${user.uid}`)

if (reset || password) {
  console.log('\n  ---- put these on the RMS server, not in any browser ----\n')
  console.log(`  FIREBASE_API_KEY   ${env.VITE_FIREBASE_API_KEY}`)
  console.log(`  FIREBASE_PROJECT   ${env.VITE_FIREBASE_PROJECT_ID}`)
  console.log(`  INTAKE_EMAIL       ${EMAIL}`)
  console.log(`  INTAKE_PASSWORD    ${password}`)
  console.log('\n  (shown once — it is not stored anywhere)')
}

console.log(`
  ---- what the RMS sends ----

  Sign in with the email and password above, then write one document per row to
  the 'intake' collection. Use the RMS's own id as the DOCUMENT ID, so sending
  the same row twice replaces it instead of duplicating it.

  A client's trading for one day:

    {
      source: 'rms',
      kind: 'client_day',
      status: 'received',
      externalId: '<your id>',
      date: '2026-09-12',
      externalClientRef: '<your client id>',
      externalClientName: 'Hotel ABC',
      // What the client took, every channel. This is what the RMS knows.
      turnover:   { minor: 420000, currency: 'EUR', rate: 117, baseMinor: 49140000, rateDate: '2026-09-12' },
      // The part WE brought them, if the RMS can tell. null when it cannot —
      // MsEe Central records that itself, on the client.
      attributed: null,
      // Our commission on that part. null for the same reason.
      ourShare:   null,
      reservations: 14,
      nights: 31,
      externalEmployeeRef: '', externalEmployeeName: '',
      clientId: null, employeeUid: null, earning: null,
      note: '', receivedAt: '<now>', appliedAt: null, appliedBy: null, walletEntryId: null
    }

  Something one of our people earned:

    {
      source: 'rms',
      kind: 'employee_earning',
      status: 'received',
      externalId: '<your id>',
      date: '2026-09-12',
      externalEmployeeRef: '<your staff id>',
      externalEmployeeName: 'Sadeta Sadikovic',
      earning: { minor: 5000, currency: 'EUR', rate: 117, baseMinor: 585000, rateDate: '2026-09-12' },
      externalClientRef: '', externalClientName: '',
      clientId: null, employeeUid: null, turnover: null, attributed: null, ourShare: null,
      reservations: 0, nights: 0,
      note: '', receivedAt: '<now>', appliedAt: null, appliedBy: null, walletEntryId: null
    }

  THREE FIGURES, NOT TWO. 'turnover' is everything the client took, through
  every channel — that is theirs. 'attributed' is the part MsEe brought them,
  which the RMS usually cannot tell and should send as null; it is recorded in
  MsEe Central on the client instead. 'ourShare' is our commission on that
  part. Collapsing the first two would credit us with bookings that would have
  happened anyway.

  HOW A ROW FINDS ITS CLIENT. By the reference you already recorded on that
  client in MsEe Central — Clients, edit, "Other systems", system "RMS". A row
  whose reference matches nothing stays unmatched and visible rather than being
  attached to a guess.

  MONEY IS INTEGER MINOR UNITS. €4,200.00 is minor: 420000. Never a decimal:
  this system has no floating-point money anywhere and will not start here.
  'rate' is dinars per one unit of the currency on 'rateDate', and 'baseMinor'
  is minor * rate — send both, so a rate changed later cannot rewrite history.
`)

process.exit(0)
