/**
 * MsEe Central — security rule verification.
 *
 * Runs against the LIVE project with the ordinary client SDK, exactly as a
 * browser would. It proves the claims the architecture rests on, rather than
 * asking anyone to take them on trust:
 *
 * Phase one, as a newly registered applicant:
 *   - can file its own request, and nothing else;
 *   - cannot approve itself;
 *   - cannot write its own permissions and promote itself;
 *   - cannot read employees, notes, the audit log, or anyone else's request.
 *
 * Phase two, as a genuine CO-OWNER holding every permission:
 *   - cannot alter the founder's access in any way;
 *   - cannot suspend the founder;
 *   - cannot make itself the founder;
 *   - cannot appoint another owner, which only the founder may do.
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
let ownerUid = null
let founderSnapshot = null

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

  /* ------------------------------------------------------------------ *
   * Phase two — a real co-owner, and what they still cannot do
   *
   * The account below is given owner status directly through the Admin SDK,
   * bypassing the rules, so this is not a weakened stand-in: it holds every
   * permission the system has. What it cannot do, it cannot do because of the
   * founder protection alone.
   * ------------------------------------------------------------------ */

  console.log()
  console.log('  now acting as a genuine co-owner, holding every permission')
  console.log()

  await signOut(clientAuth).catch(() => {})

  const ownerEmail = `rules-owner-${stamp}@msee-central-test.com`
  const ownerPassword = `rules-owner-password-${stamp}`
  const ownerCredential = await createUserWithEmailAndPassword(
    clientAuth,
    ownerEmail,
    ownerPassword,
  )
  ownerUid = ownerCredential.user.uid

  const permissionDocs = await adminDb.collection('permissions').get()
  const everyPermission = permissionDocs.docs.map((d) => d.id)

  await adminDb.collection('userPermissions').doc(ownerUid).set({
    uid: ownerUid,
    status: 'active',
    isCeo: true,
    isFounder: false,
    roleIds: ['cto'],
    permissions: everyPermission,
    updatedAt: new Date().toISOString(),
    updatedBy: 'system:verify-rules',
  })

  await signInWithEmailAndPassword(clientAuth, ownerEmail, ownerPassword)

  const founder = await adminDb
    .collection('userPermissions')
    .where('isFounder', '==', true)
    .limit(1)
    .get()

  /*
   * Snapshot the founder before attacking it.
   *
   * A mustDeny that FAILS means the write went through — the test found a hole
   * by actually exploiting it. Without restoring afterwards the test leaves
   * real damage behind, which is exactly what happened the first time this
   * phase ran: the founder was left showing as suspended in the directory.
   */
  if (!founder.empty) {
    const uid = founder.docs[0].id
    const employeeDoc = await adminDb.collection('employees').doc(uid).get()
    founderSnapshot = {
      uid,
      access: founder.docs[0].data(),
      employee: employeeDoc.exists ? employeeDoc.data() : null,
    }
  }

  if (founder.empty) {
    console.log('  SKIP  no founder account found — run npm run setup:ceo first')
  } else {
    const founderUid = founder.docs[0].id
    const founderData = founder.docs[0].data()

    await mustAllow('co-owner CAN read the employee directory', () =>
      getDoc(doc(db, 'employees', founderUid)),
    )

    await mustDeny('co-owner CANNOT suspend the founder', () =>
      updateDoc(doc(db, 'userPermissions', founderUid), { status: 'suspended' }),
    )

    await mustDeny("co-owner CANNOT strip the founder's owner status", () =>
      updateDoc(doc(db, 'userPermissions', founderUid), { isCeo: false }),
    )

    await mustDeny("co-owner CANNOT rewrite the founder's roles", () =>
      setDoc(doc(db, 'userPermissions', founderUid), {
        ...founderData,
        roleIds: ['employee'],
        permissions: [],
      }),
    )

    await mustDeny("co-owner CANNOT suspend the founder's profile", () =>
      updateDoc(doc(db, 'employees', founderUid), {
        status: 'suspended',
        updatedAt: new Date().toISOString(),
      }),
    )

    await mustDeny('co-owner CANNOT make itself the founder', () =>
      updateDoc(doc(db, 'userPermissions', ownerUid), { isFounder: true }),
    )

    await mustDeny('co-owner CANNOT appoint another owner', () =>
      setDoc(doc(db, 'userPermissions', `would-be-owner-${stamp}`), {
        uid: `would-be-owner-${stamp}`,
        status: 'active',
        isCeo: true,
        isFounder: false,
        roleIds: ['cto'],
        permissions: everyPermission,
        updatedAt: new Date().toISOString(),
        updatedBy: ownerUid,
      }),
    )
  }
} finally {
  /* --- clean up ----------------------------------------------------- */

  await signOut(clientAuth).catch(() => {})

  for (const uid of [testUid, ownerUid]) {
    if (!uid) continue
    await adminDb.collection('registrationRequests').doc(uid).delete().catch(() => {})
    await adminDb.collection('employees').doc(uid).delete().catch(() => {})
    await adminDb.collection('userPermissions').doc(uid).delete().catch(() => {})
    await adminAuth.deleteUser(uid).catch(() => {})
  }
  await adminDb.collection('userPermissions').doc(`would-be-owner-${stamp}`).delete().catch(() => {})

  /* Put the founder back exactly as it was, whatever the tests managed to do. */
  if (founderSnapshot) {
    await adminDb
      .collection('userPermissions')
      .doc(founderSnapshot.uid)
      .set(founderSnapshot.access)
      .catch(() => {})

    if (founderSnapshot.employee) {
      await adminDb
        .collection('employees')
        .doc(founderSnapshot.uid)
        .set(founderSnapshot.employee)
        .catch(() => {})
    }
    console.log('  founder account restored to its exact prior state')
  }

  console.log()
  console.log('  test accounts and their documents removed')
}

console.log()
console.log(`  ${passed} passed, ${failed} failed`)
console.log()
process.exit(failed === 0 ? 0 : 1)
