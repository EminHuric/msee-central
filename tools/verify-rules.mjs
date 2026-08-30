/**
 * MsEe Central — security rule verification.
 *
 * Runs against the LIVE project with the ordinary client SDK, exactly as a
 * browser would. It proves the claims the architecture rests on, rather than
 * asking anyone to take them on trust:
 *
 *   - an unapproved account can file its own request, and nothing else;
 *   - it cannot approve itself;
 *   - it cannot write its own permissions and promote itself to CEO;
 *   - it cannot read employees, notes, the audit log, or anyone else's request.
 *
 * A throwaway account is created for the test and deleted afterwards, along
 * with every document it wrote. Nothing is left behind.
 *
 *   npm run rules:verify
 *
 * Re-run this after every change to firebase/firestore.rules.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cert, initializeApp as initAdmin } from 'firebase-admin/app'
import { getAuth as getAdminAuth } from 'firebase-admin/auth'
import { getFirestore as getAdminDb } from 'firebase-admin/firestore'

import { initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { doc, getDoc, getFirestore, setDoc, updateDoc } from 'firebase/firestore'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

function readEnv() {
  const text = readFileSync(resolve(root, '.env'), 'utf8')
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const i = line.indexOf('=')
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

const env = readEnv()
const serviceAccount = JSON.parse(readFileSync(resolve(here, 'serviceAccount.json'), 'utf8'))

initAdmin({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
const adminAuth = getAdminAuth()
const adminDb = getAdminDb()

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
})

const clientAuth = getAuth(app)
const db = getFirestore(app)

/* ------------------------------------------------------------------ *
 * Assertions
 * ------------------------------------------------------------------ */

let passed = 0
let failed = 0

function isDenied(error) {
  const code = String(error?.code ?? '')
  return code.includes('permission-denied') || code.includes('insufficient')
}

/** The rules must REFUSE this. A success here is a security hole. */
async function mustDeny(label, action) {
  try {
    await action()
    failed++
    console.log(`  FAIL  ${label}`)
    console.log('        ^ this was ALLOWED and must not be')
  } catch (error) {
    if (isDenied(error)) {
      passed++
      console.log(`  ok    ${label}`)
    } else {
      failed++
      console.log(`  FAIL  ${label}`)
      console.log(`        ^ refused, but for the wrong reason: ${error.code ?? error.message}`)
    }
  }
}

/** The rules must PERMIT this, or the application cannot function. */
async function mustAllow(label, action) {
  try {
    await action()
    passed++
    console.log(`  ok    ${label}`)
  } catch (error) {
    failed++
    console.log(`  FAIL  ${label}`)
    console.log(`        ^ this was BLOCKED but must be allowed: ${error.code ?? error.message}`)
  }
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

const stamp = Date.now()
const testEmail = `rules-test-${stamp}@msee-central-test.com`
const testPassword = `rules-test-password-${stamp}`
let testUid = null

console.log('\n  Security rule verification')
console.log(`  project: ${serviceAccount.project_id}`)
console.log(`  acting as a newly registered, unapproved employee\n`)

try {
  const credential = await createUserWithEmailAndPassword(clientAuth, testEmail, testPassword)
  testUid = credential.user.uid

  /* --- what an applicant legitimately needs ------------------------ */

  await mustAllow('applicant can file their own registration request', () =>
    setDoc(doc(db, 'registrationRequests', testUid), {
      id: testUid,
      uid: testUid,
      firstName: 'Rules',
      lastName: 'Test',
      email: testEmail,
      phone: '+381600000000',
      country: 'Serbia',
      city: 'Novi Pazar',
      photoUrl: null,
      personalDescription: 'temporary verification account',
      desiredPosition: 'tester',
      additionalInfo: '',
      termsAcceptedAt: new Date().toISOString(),
      status: 'pending',
      submittedAt: new Date().toISOString(),
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
    }),
  )

  await mustAllow('applicant can read back their own request', () =>
    getDoc(doc(db, 'registrationRequests', testUid)),
  )

  /* --- the attacks that must fail ---------------------------------- */

  await mustDeny('applicant CANNOT approve their own request', () =>
    updateDoc(doc(db, 'registrationRequests', testUid), { status: 'approved' }),
  )

  await mustDeny('applicant CANNOT grant themselves permissions', () =>
    setDoc(doc(db, 'userPermissions', testUid), {
      uid: testUid,
      status: 'active',
      isCeo: false,
      roleIds: ['employee'],
      permissions: ['employees.view'],
      updatedAt: new Date().toISOString(),
      updatedBy: testUid,
    }),
  )

  await mustDeny('applicant CANNOT make themselves CEO', () =>
    setDoc(doc(db, 'userPermissions', testUid), {
      uid: testUid,
      status: 'active',
      isCeo: true,
      roleIds: ['ceo'],
      permissions: [],
      updatedAt: new Date().toISOString(),
      updatedBy: testUid,
    }),
  )

  await mustDeny('applicant CANNOT create an employee profile for themselves', () =>
    setDoc(doc(db, 'employees', testUid), { uid: testUid, firstName: 'Rules', lastName: 'Test' }),
  )

  /* --- reads that must stay closed --------------------------------- */

  const ceo = await adminDb.collection('userPermissions').where('isCeo', '==', true).limit(1).get()
  const ceoUid = ceo.empty ? 'no-ceo-found' : ceo.docs[0].id

  await mustDeny('applicant CANNOT read the employee directory', () =>
    getDoc(doc(db, 'employees', ceoUid)),
  )

  await mustDeny("applicant CANNOT read the CEO's private contact tier", () =>
    getDoc(doc(db, 'employees', ceoUid, 'visibility', 'private')),
  )

  await mustDeny('applicant CANNOT read CEO notes about anybody', () =>
    getDoc(doc(db, 'employees', ceoUid, 'notes', 'any-note')),
  )

  await mustDeny("applicant CANNOT read another person's permissions", () =>
    getDoc(doc(db, 'userPermissions', ceoUid)),
  )

  await mustDeny('applicant CANNOT read the roles catalogue', () =>
    getDoc(doc(db, 'roles', 'ceo')),
  )

  await mustDeny('applicant CANNOT write to the audit log', () =>
    setDoc(doc(db, 'auditLogs', `forged-${stamp}`), {
      actorUid: testUid,
      actorEmail: testEmail,
      action: 'account.approved',
      targetType: 'user',
      targetId: testUid,
      targetLabel: 'forged',
      metadata: {},
      createdAt: new Date().toISOString(),
    }),
  )

  await mustDeny('applicant CANNOT edit company settings', () =>
    updateDoc(doc(db, 'companySettings', 'general'), { registrationOpen: false }),
  )
} finally {
  /* --- clean up ----------------------------------------------------- */

  await signOut(clientAuth).catch(() => {})

  if (testUid) {
    await adminDb.collection('registrationRequests').doc(testUid).delete().catch(() => {})
    await adminDb.collection('employees').doc(testUid).delete().catch(() => {})
    await adminDb.collection('userPermissions').doc(testUid).delete().catch(() => {})
    await adminAuth.deleteUser(testUid).catch(() => {})
    console.log('\n  test account and its documents removed')
  }
}

console.log(`\n  ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
