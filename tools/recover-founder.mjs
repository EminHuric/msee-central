/**
 * MsEe Central — founder account recovery.
 *
 * WHY THIS EXISTS
 *
 * The founder account cannot be altered from inside the application by
 * anybody, including co-owners. That is the point of it — but it means there
 * is no colleague who can help if the account itself becomes unreachable.
 *
 * A co-owner cannot be given that power, and no rule change would help. If
 * somebody could restore the founder they could also replace them, because it
 * is the same write. The protection and the recovery are one capability, and
 * it is deliberately kept outside the application, behind the service account
 * key.
 *
 * WHAT THIS CANNOT FIX
 *
 * A forgotten password does not need this script. Use the reset link on the
 * sign-in screen; it works normally and touches nothing here.
 *
 * This is for the worse cases: the founder's mailbox is gone, the address must
 * change, or the whole account has to move to a new one.
 *
 * USAGE
 *
 *   npm run recover -- --status
 *   npm run recover -- --reset-password
 *   npm run recover -- --change-email
 *   npm run recover -- --transfer
 *
 * Anything not given as a flag is asked for.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

import { cert, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const here = dirname(fileURLToPath(import.meta.url))
const KEY_PATH = resolve(here, 'serviceAccount.json')
const MIN_PASSWORD_LENGTH = 12

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const out = {}
  for (const arg of argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/s.exec(arg)
    if (match) out[match[1]] = match[2]
    else if (arg.startsWith('--')) out[arg.slice(2)] = true
  }
  return out
}

const args = parseArgs(process.argv)

function fail(message, hint) {
  console.error(`  x ${message}`)
  if (hint) console.error(`    ${hint}`)
  console.error('')
  process.exit(1)
}

const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY === true })
const lines = rl[Symbol.asyncIterator]()

let muted = false
const echo = rl._writeToOutput.bind(rl)
rl._writeToOutput = (chunk) => {
  if (!muted) echo(chunk)
}

async function nextLine() {
  const { value, done } = await lines.next()
  if (done) {
    console.log()
    fail('Cancelled.')
  }
  return String(value)
}

async function ask(question) {
  stdout.write(question)
  return (await nextLine()).trim()
}

async function askSecret(question) {
  stdout.write(question)
  muted = true
  try {
    return await nextLine()
  } finally {
    muted = false
    console.log()
  }
}

async function confirm(question) {
  const answer = await ask(`${question} (yes/no): `)
  return answer.toLowerCase() === 'yes'
}

/* ------------------------------------------------------------------ *
 * Setup
 * ------------------------------------------------------------------ */

let serviceAccount
try {
  serviceAccount = JSON.parse(readFileSync(KEY_PATH, 'utf8'))
} catch {
  fail(
    'tools/serviceAccount.json not found.',
    'This file IS the recovery key. Without it there is no way back into a lost\n' +
      '    founder account. Keep a copy somewhere safe and offline.',
  )
}

initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
const auth = getAuth()
const db = getFirestore()

console.log()
console.log('  MsEe Central — founder recovery')
console.log(`  project: ${serviceAccount.project_id}`)
console.log()

/** The single account carrying isFounder. */
async function findFounder() {
  const snap = await db.collection('userPermissions').where('isFounder', '==', true).limit(2).get()

  if (snap.empty) {
    fail('No founder account found.', 'Run: npm run setup:ceo')
  }
  if (snap.size > 1) {
    fail(
      'More than one founder account found.',
      'That should be impossible. Inspect userPermissions in the Firebase console.',
    )
  }

  const uid = snap.docs[0].id
  const user = await auth.getUser(uid).catch(() => null)
  const employee = await db.collection('employees').doc(uid).get()

  return { uid, user, employee: employee.exists ? employee.data() : null }
}

const founder = await findFounder()

console.log('  current founder')
console.log(`    uid    : ${founder.uid}`)
console.log(`    email  : ${founder.user?.email ?? '(no login — the account is gone)'}`)
console.log(
  `    name   : ${[founder.employee?.firstName, founder.employee?.lastName].filter(Boolean).join(' ') || '—'}`,
)
console.log()

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

if (args.status) {
  rl.close()
  process.exit(0)
}

async function resetPassword() {
  if (!founder.user) fail('The founder has no login left. Use --transfer instead.')

  const password = await askSecret(`  New password (min ${MIN_PASSWORD_LENGTH}): `)
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }

  await auth.updateUser(founder.uid, { password })
  console.log(`  + password changed for ${founder.user.email}`)
}

async function changeEmail() {
  if (!founder.user) fail('The founder has no login left. Use --transfer instead.')

  const email = await ask('  New email address: ')
  if (!email.includes('@')) fail('That is not an email address.')

  await auth.updateUser(founder.uid, { email, emailVerified: true })
  await db
    .collection('employees')
    .doc(founder.uid)
    .collection('visibility')
    .doc('private')
    .set({ email }, { merge: true })
  await db
    .collection('employees')
    .doc(founder.uid)
    .collection('visibility')
    .doc('management')
    .set({ email }, { merge: true })

  console.log(`  + email changed to ${email}`)
}

/**
 * Move founder status to a different existing account.
 *
 * The last resort, for when the original login is genuinely unreachable. The
 * old account keeps its employee record — history is never deleted — but loses
 * both founder and owner status, because there is only ever one founder.
 */
async function transfer() {
  const email = await ask('  Email of the account to make founder: ')
  const target = await auth.getUserByEmail(email).catch(() => null)
  if (!target) fail(`No account found for ${email}.`, 'The person must sign in at least once first.')

  if (target.uid === founder.uid) fail('That account is already the founder.')

  console.log()
  console.log('  This will:')
  console.log(`    - make ${email} the founder, with full ownership`)
  console.log(`    - remove founder AND owner status from ${founder.user?.email ?? founder.uid}`)
  console.log('    - leave both employee records intact')
  console.log()

  if (!(await confirm('  Proceed?'))) {
    console.log('  cancelled')
    return
  }

  const permissionDocs = await db.collection('permissions').get()
  const everyPermission = permissionDocs.docs.map((d) => d.id)
  const now = new Date().toISOString()

  const batch = db.batch()

  batch.set(
    db.collection('userPermissions').doc(target.uid),
    {
      uid: target.uid,
      status: 'active',
      isCeo: true,
      isFounder: true,
      roleIds: ['ceo'],
      permissions: everyPermission,
      updatedAt: now,
      updatedBy: 'system:recover-founder',
    },
    { merge: true },
  )

  batch.set(
    db.collection('userPermissions').doc(founder.uid),
    {
      isCeo: false,
      isFounder: false,
      roleIds: ['employee'],
      permissions: ['employees.view'],
      updatedAt: now,
      updatedBy: 'system:recover-founder',
    },
    { merge: true },
  )

  batch.set(
    db.collection('employees').doc(target.uid),
    { roleIds: ['ceo'], status: 'active', updatedAt: now },
    { merge: true },
  )

  batch.set(
    db.collection('employees').doc(founder.uid),
    { roleIds: ['employee'], updatedAt: now },
    { merge: true },
  )

  await batch.commit()
  console.log(`  + ${email} is now the founder`)
}

const action =
  (args['reset-password'] && 'reset-password') ||
  (args['change-email'] && 'change-email') ||
  (args.transfer && 'transfer') ||
  (await (async () => {
    console.log('  1  reset the password')
    console.log('  2  change the email address')
    console.log('  3  move founder status to another account')
    console.log()
    const choice = await ask('  Choose 1, 2 or 3: ')
    return { 1: 'reset-password', 2: 'change-email', 3: 'transfer' }[choice] ?? null
  })())

console.log()

if (action === 'reset-password') await resetPassword()
else if (action === 'change-email') await changeEmail()
else if (action === 'transfer') await transfer()
else fail('Nothing chosen.')

console.log()
rl.close()
process.exit(0)
