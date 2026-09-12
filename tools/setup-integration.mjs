/**
 * Create the account the RMS writes with, and print the contract.
 *
 * WHY THIS DIRECTION. MsEe Central cannot reach out to the RMS from a browser:
 * the connection needs a key, and a key in a browser is a published key. The
 * RMS reaching in has none of that problem — it already has a server, the key
 * lives there, and it writes here as itself.
 *
 * WHAT THIS ACCOUNT CAN DO. One thing: write rows into `intake` — the turnover
 * the RMS reports. It reads nothing at all, writes nowhere else, and holds no
 * permissions. If its password leaks, what leaks is the ability to send us
 * numbers — not the ability to read the company.
 *
 * NOTE THE OTHER DIRECTION IS NOT THIS ACCOUNT. Bookings go from MsEe Central
 * into the RMS, written by an agency account that lives in the RMS and is
 * configured there. Nothing in this file is involved in that, and nothing in the
 * RMS needs this account's password to receive a booking.
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
  ---- what changed, and why there is no "collect" step any more ----

  This account used to also hand out reservations for the RMS to collect. That
  is gone, and it is worth knowing why before looking for it.

  It was written when the RMS was a black box to us: we could not write into it,
  so it had to come and take what we had. Reading the RMS showed otherwise — it
  is a Firestore project with accounts and rules — so MsEe Central now creates
  the booking there itself, as an agency account, and gets the confirmation back
  in the same call. That is strictly better: a booking is either in the property's
  calendar or it is not, and MsEe Central never claims a sale the RMS did not
  accept.

  RUNNING BOTH WOULD DOUBLE-BOOK GUESTS. If anything still polled MsEe Central
  for reservations to create, each booking would be made twice — once by us
  pushing, once by the poller. So the read was removed from the rules rather than
  left switched off, and a test proves this account can no longer see that
  collection at all.

  So this account has ONE job now: sending turnover in.

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
      // MsEe Central counts that itself now, from the bookings above.
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

  ---- how the two halves fit ----

  THREE FIGURES, NOT TWO.

    Their turnover   everything the client took, through every channel.
                     The RMS knows this and nothing else does. Send it.
    We brought       the part that came from our work. COUNTED from the
                     reservations you collect above — one of them is one we
                     brought, because entering it here is the only way it
                     exists. Send 'attributed' as null.
    Our share        our commission on what we brought. MsEe Central holds the
                     rate per client and works it out. Send 'ourShare' as null.

  Collapsing the first two would credit us with bookings that would have
  happened anyway, and a company measuring itself that way cannot tell whether
  its own work pays.

  WHAT THE RESERVATION PULL REPLACED. The previous plan was a channel field on
  every reservation in the RMS, so the RMS could total up the bookings that came
  from our campaigns. Entering the booking here is better and that is why it
  changed: it makes attribution a count rather than a measurement, it needs no
  change to the RMS's data model, and it records the guest we brought by name.

  A channel field is still worth having for a different question — which of the
  property's OWN bookings arrived through the site or campaigns we built, with no
  guest we booked ourselves. Nothing here depends on it.

  WHAT DOES NOT GO IN THE RMS: our percentage. That is a term in our agreement
  with the client, not a fact about their property, and changing our commission
  should not mean editing their booking software.

  HOW A ROW FINDS ITS CLIENT. By the reference you already recorded on that
  client in MsEe Central — Clients, edit, "Other systems", system "RMS". A row
  whose reference matches nothing stays unmatched and visible rather than being
  attached to a guess. Reservations need no matching: they already name the
  client, because they were entered against one.

  MONEY IS INTEGER MINOR UNITS. €4,200.00 is minor: 420000. Never a decimal:
  this system has no floating-point money anywhere and will not start here.
  'rate' is dinars per one unit of the currency on 'rateDate', and 'baseMinor'
  is minor * rate — send both, so a rate changed later cannot rewrite history.
`)

process.exit(0)
