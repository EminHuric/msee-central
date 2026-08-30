/**
 * MsEe Central — one-time bootstrap.
 *
 * Creates the first CEO account and seeds the reference data the application
 * expects to find: the permission catalogue, the CEO and Employee roles, and
 * the company settings document.
 *
 * WHY THIS SCRIPT EXISTS
 *
 * firestore.rules forbids anybody from writing their own userPermissions
 * document — that is the rule which stops an employee from promoting
 * themselves to CEO. It applies to the CEO too, which leaves a chicken and
 * egg problem for the very first account.
 *
 * This script solves it from outside: the Admin SDK talks to Firestore with a
 * service account and bypasses security rules entirely. That is the point.
 * There is no bootstrap exception inside the rules for an attacker to find.
 *
 * THE KEY FILE IS A REAL SECRET
 *
 * tools/serviceAccount.json grants unrestricted access to the whole project.
 * It is listed in .gitignore. Never commit it, never paste it into a chat,
 * never put it in the browser bundle. If it ever leaks, revoke it in the
 * Firebase console under Project settings -> Service accounts.
 *
 * USAGE
 *
 *   npm run setup:ceo
 *
 * Anything not supplied as a flag is asked for interactively, and the password
 * is never echoed. That is the recommended way to run this: npm on Windows
 * swallows arguments after `--`, and a password typed as a flag lingers in
 * shell history either way.
 *
 * Flags still work when driving this from another script:
 *
 *   node --experimental-strip-types tools/setup-ceo.mjs --email=you@msee.rs ...
 *
 * Safe to run more than once: existing documents are updated, not duplicated.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

import { cert, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

import { ALL_PERMISSIONS, DEFAULT_EMPLOYEE_PERMISSIONS } from '../src/types/permissions.ts'
import { DEFAULT_PRIVACY } from '../src/types/domain.ts'

const here = dirname(fileURLToPath(import.meta.url))
const KEY_PATH = resolve(here, 'serviceAccount.json')

const MIN_PASSWORD_LENGTH = 12

/* ------------------------------------------------------------------ *
 * Arguments
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

if (args.help) {
  console.log(
    [
      '',
      'Create the first CEO account for MsEe Central.',
      '',
      'Usage:',
      '  npm run setup:ceo            (asks for anything it needs)',
      '',
      'Options (all optional — you are prompted for whatever is missing):',
      '  --email      CEO sign-in address',
      `  --password   Initial password, at least ${MIN_PASSWORD_LENGTH} characters`,
      '  --first      First name',
      '  --last       Last name',
      '  --help       Show this message',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

function fail(message, hint) {
  console.error(`\n  x ${message}`)
  if (hint) console.error(`    ${hint}`)
  console.error('')
  process.exit(1)
}

/* ------------------------------------------------------------------ *
 * Prompts
 *
 * Typed answers beat flags here: npm on Windows drops everything after `--`,
 * and a password passed as an argument is left behind in shell history.
 * ------------------------------------------------------------------ */

/*
 * ONE readline interface for every question. Creating a fresh one per prompt
 * looks tidier but loses buffered input: the first interface reads ahead and
 * swallows what the next one was waiting for, and the script hangs forever.
 */
/*
 * One readline interface, read as an async stream of lines.
 *
 * Two traps this avoids. Creating a fresh interface per prompt loses buffered
 * input, because the first one reads ahead and swallows what the next was
 * waiting for. And rl.question() drops any line that arrives while no question
 * is pending — invisible when a human types one line at a time, fatal the
 * moment input is piped in. Pulling from the iterator buffers instead.
 */
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
    fail('Cancelled — no more input.')
  }
  return String(value)
}

async function ask(question) {
  stdout.write(question)
  return (await nextLine()).trim()
}

/** Same, but nothing the user types is echoed to the terminal. */
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

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/** Keep asking until the answer satisfies `check`. */
async function require_(current, question, check, complaint, secret = false) {
  let value = current
  while (!check(value)) {
    if (value) console.log(`  ! ${complaint}`)
    value = secret ? await askSecret(question) : await ask(question)
  }
  return value
}

/* ------------------------------------------------------------------ *
 * Preflight
 * ------------------------------------------------------------------ */

let serviceAccount
try {
  serviceAccount = JSON.parse(readFileSync(KEY_PATH, 'utf8'))
} catch {
  fail(
    'tools/serviceAccount.json not found.',
    'Firebase console -> Project settings -> Service accounts -> Generate new private key,\n' +
      '    then save the downloaded file as tools/serviceAccount.json',
  )
}

console.log('\n  MsEe Central — bootstrap')
console.log(`  project: ${serviceAccount.project_id}\n`)

const email = await require_(
  String(args.email ?? '').trim(),
  '  Email:      ',
  looksLikeEmail,
  'That does not look like an email address.',
)

const firstName = await require_(
  String(args.first ?? '').trim(),
  '  First name: ',
  (v) => v.length > 0,
  'First name cannot be empty.',
)

const lastName = await require_(
  String(args.last ?? '').trim(),
  '  Last name:  ',
  (v) => v.length > 0,
  'Last name cannot be empty.',
)

initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })

const auth = getAuth()
const db = getFirestore()
const now = new Date().toISOString()

/* ------------------------------------------------------------------ *
 * 1. The CEO's Firebase Auth account
 * ------------------------------------------------------------------ */

let user = null
try {
  user = await auth.getUserByEmail(email)
} catch (error) {
  if (error.code !== 'auth/user-not-found') throw error
}

/*
 * Twelve characters, not eight. This account can read every private note and
 * every employee record in the company. Three ordinary words joined by dashes
 * clears the bar and is easier to remember than a short scrambled password.
 */
let password = String(args.password ?? '')

if (!user || password) {
  const label = user ? '  New password (leave blank to keep current): ' : '  Password:   '
  password = await require_(
    password,
    label,
    (v) => (user && v === '') || v.length >= MIN_PASSWORD_LENGTH,
    `Password must be at least ${MIN_PASSWORD_LENGTH} characters. Try three words joined by dashes.`,
    true,
  )
}

// Every question has been asked; release the terminal.
rl.close()

console.log('')

if (user) {
  console.log(`  . account already exists  ${email}`)
  if (password) {
    await auth.updateUser(user.uid, { password })
    console.log('  . password updated')
  }
} else {
  user = await auth.createUser({
    email,
    password,
    displayName: `${firstName} ${lastName}`,
    emailVerified: true,
  })
  console.log(`  + account created         ${email}`)
}

const uid = user.uid

/* ------------------------------------------------------------------ *
 * 2. Permission catalogue
 *
 * Written so the role editor can list permissions without shipping the
 * catalogue in the bundle, and so a rule can be reasoned about from the
 * console alone.
 * ------------------------------------------------------------------ */

{
  const batch = db.batch()
  for (const key of ALL_PERMISSIONS) {
    const [resourceName, action] = key.split('.')
    batch.set(
      db.collection('permissions').doc(key),
      { key, resource: resourceName, action, updatedAt: now },
      { merge: true },
    )
  }
  await batch.commit()
  console.log(`  + permissions seeded      ${ALL_PERMISSIONS.length} entries`)
}

/* ------------------------------------------------------------------ *
 * 3. Roles
 *
 * `ceo` carries grantsAll, so it answers true for permissions that do not
 * exist yet — future modules need no migration here.
 * ------------------------------------------------------------------ */

await db
  .collection('roles')
  .doc('ceo')
  .set(
    {
      id: 'ceo',
      key: 'ceo',
      name: 'CEO',
      nameSr: 'CEO',
      description: 'Full authority over every part of MsEe Central.',
      descriptionSr: 'Puna nadleznost nad svim delovima MsEe Central-a.',
      permissions: [...ALL_PERMISSIONS],
      isSystem: true,
      grantsAll: true,
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: now,
    },
    { merge: true },
  )

await db
  .collection('roles')
  .doc('employee')
  .set(
    {
      id: 'employee',
      key: 'employee',
      name: 'Employee',
      nameSr: 'Zaposleni',
      description: 'Baseline access for staff with no management duties.',
      descriptionSr: 'Osnovni pristup za zaposlene bez rukovodecih duznosti.',
      permissions: [...DEFAULT_EMPLOYEE_PERMISSIONS],
      isSystem: true,
      grantsAll: false,
      status: 'active',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: now,
    },
    { merge: true },
  )

console.log('  + roles seeded            ceo, employee')

/* ------------------------------------------------------------------ *
 * 4. The CEO's access document
 *
 * The one document the rules will not let anybody write for themselves.
 * ------------------------------------------------------------------ */

await db
  .collection('userPermissions')
  .doc(uid)
  .set(
    {
      uid,
      status: 'active',
      isCeo: true,
      roleIds: ['ceo'],
      permissions: [...ALL_PERMISSIONS],
      updatedAt: now,
      updatedBy: 'system:setup-ceo',
    },
    { merge: true },
  )

console.log('  + access granted          isCeo = true')

/* ------------------------------------------------------------------ *
 * 5. Employee profile and its privacy tiers
 * ------------------------------------------------------------------ */

const employeeRef = db.collection('employees').doc(uid)

await employeeRef.set(
  {
    uid,
    employeeCode: 'MSEE-0001',
    firstName,
    lastName,
    photoUrl: null,
    positionId: null,
    departmentId: null,
    roleIds: ['ceo'],
    status: 'active',
    employmentStatus: 'full_time',
    managerUid: null,
    responsibilities: '',
    skills: [],
    expertise: [],
    bio: '',
    startDate: null,
    dateJoined: now,
    createdAt: now,
    updatedAt: now,
  },
  { merge: true },
)

await employeeRef.collection('visibility').doc('everyone').set({}, { merge: true })
await employeeRef.collection('visibility').doc('management').set({ email }, { merge: true })
await employeeRef
  .collection('visibility')
  .doc('private')
  .set({ email, privacy: DEFAULT_PRIVACY }, { merge: true })

console.log('  + profile created         MSEE-0001')

/* ------------------------------------------------------------------ *
 * 6. Company settings
 * ------------------------------------------------------------------ */

await db
  .collection('companySettings')
  .doc('general')
  .set(
    {
      companyName: 'MsEe',
      legalName: 'MsEe',
      defaultLocale: 'en',
      registrationOpen: true,
      allowedEmailDomains: [],
      updatedAt: now,
      updatedBy: 'system:setup-ceo',
    },
    { merge: true },
  )

console.log('  + company settings\n')

/* ------------------------------------------------------------------ *
 * Done
 * ------------------------------------------------------------------ */

console.log('  Sign in at http://localhost:5173 with:')
console.log(`    ${email}\n`)

process.exit(0)
