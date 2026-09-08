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
 * Phase three, as an AFFILIATE holding every permission there is:
 *   - sees their own record and nothing else;
 *   - cannot read colleagues, roles, departments or company settings.
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
import { deleteDoc, doc, getDoc, getFirestore, setDoc, updateDoc } from 'firebase/firestore'

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
let affiliateUid = null

/**
 * Collections these tests write into, and the shape of the ids they use.
 *
 * Cleanup used to name each document by hand and missed the leads written by
 * the affiliate phase — three of them were still sitting in the real database
 * days later, in a collection the company actually uses. A test that leaves
 * rubbish in live data is worse than no test.
 *
 * So cleanup sweeps by pattern instead of by list. Every id these tests create
 * begins with one of these prefixes, which means a check added later is swept
 * up without anybody remembering to add a line to the cleanup, and leftovers
 * from earlier runs go too.
 */
const TEST_COLLECTIONS = [
  'leads',
  'clients',
  'commissions',
  'bonusAwards',
  'auditLogs',
  'userPermissions',
  'registrationRequests',
  'employees',
]

const TEST_ID = /^(rules-|forged-|would-be-owner-)/

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

  await mustDeny('applicant CANNOT read clients', () => getDoc(doc(db, 'clients', 'any-client')))

  /*
   * The modules added after the first release. An account with no permission
   * document reaches none of them — the absence of that document is the whole
   * check, and it has to keep holding as collections are added.
   */
  for (const [label, path] of [
    ['sales', 'sales'],
    ['transactions', 'transactions'],
    ['affiliates', 'affiliates'],
    ['commissions', 'commissions'],
    ['goals', 'goals'],
    ['leads', 'leads'],
    ['projects', 'projects'],
    ['services', 'services'],
    ['bonus programmes', 'bonusPrograms'],
    ['bonus awards', 'bonusAwards'],
    ['incentive work', 'incentiveWork'],
    ['notes', 'notes'],
    ['activity', 'activity'],
    ['custom fields', 'customFields'],
    ['calendar entries', 'calendarEvents'],
  ]) {
    await mustDeny(`applicant CANNOT read ${label}`, () => getDoc(doc(db, path, 'any-record')))
  }

  await mustDeny("applicant CANNOT read somebody else's notifications", () =>
    getDoc(doc(db, 'notifications', 'someone-else', 'items', 'any-item')),
  )

  await mustDeny('applicant CANNOT create a client', () =>
    setDoc(doc(db, 'clients', `forged-${stamp}`), { id: 'forged', name: 'Forged', status: 'active' }),
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

    /*
   * Commission is money owed to a person, so the rules are stricter here than
   * anywhere else in the business side. A commission may only be created in
   * the pending state: creating one already approved would let whoever records
   * a payment also sign off the payout on it.
   */
  await mustDeny('co-owner CANNOT create a pre-approved commission', () =>
    setDoc(doc(db, 'commissions', `rules-commission-${stamp}`), {
      id: `rules-commission-${stamp}`,
      affiliateId: 'nobody',
      affiliateName: 'Nobody',
      affiliateEmployeeUid: '',
      paymentId: 'none',
      clientId: null,
      clientName: '',
      serviceId: null,
      saleId: null,
      baseAmountBaseMinor: 100000,
      ruleDescription: 'forged',
      amountBaseMinor: 100000,
      status: 'approved',
      earnedDate: '2026-01-01',
      approvedBy: null,
      approvedAt: null,
      paidAt: null,
      note: '',
      createdAt: new Date().toISOString(),
      createdBy: ownerUid,
      updatedAt: new Date().toISOString(),
    }),
  )

  /*
   * Deleting is soft. Destroying a record for good is `recycle_bin.purge`,
   * which this account holds — so the interesting proof is the one below:
   * an award may not be created for yourself, whatever else you can do.
   */
  await mustDeny('co-owner CANNOT award themselves a bonus', () =>
    setDoc(doc(db, 'bonusAwards', `rules-award-${stamp}`), {
      id: `rules-award-${stamp}`,
      employeeUid: ownerUid,
      employeeName: 'Rules Owner',
      source: 'manual',
      sourceId: '',
      sourceLabel: '',
      milestoneId: '',
      reason: 'forged',
      amountBaseMinor: 500000,
      rewardLabel: '',
      status: 'earned',
      earnedDate: '2026-01-01',
      approvedBy: null,
      approvedAt: null,
      paidAt: null,
      note: '',
      createdAt: new Date().toISOString(),
      createdBy: ownerUid,
      updatedAt: new Date().toISOString(),
    }),
  )

  /*
   * An award may only be created in a state that has not been approved.
   * Creating one already `paid` would be writing yourself a cheque in one
   * step, which is precisely what the ladder exists to prevent.
   */
  await mustDeny('co-owner CANNOT create an already-paid award', () =>
    setDoc(doc(db, 'bonusAwards', `rules-award-paid-${stamp}`), {
      id: `rules-award-paid-${stamp}`,
      employeeUid: 'somebody-else',
      employeeName: 'Somebody Else',
      source: 'manual',
      sourceId: '',
      sourceLabel: '',
      milestoneId: '',
      reason: 'forged',
      amountBaseMinor: 500000,
      rewardLabel: '',
      status: 'paid',
      earnedDate: '2026-01-01',
      approvedBy: null,
      approvedAt: null,
      paidAt: null,
      note: '',
      createdAt: new Date().toISOString(),
      createdBy: ownerUid,
      updatedAt: new Date().toISOString(),
    }),
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

  /* ------------------------------------------------------------------ *
   * Phase three — an affiliate, isolated by rule rather than by role
   *
   * Given every permission the system has, deliberately. If isolation
   * depended on withholding permissions it would be one bad checkbox away
   * from failing; it has to hold even when the permissions say yes.
   * ------------------------------------------------------------------ */

  console.log()
  console.log('  now acting as an affiliate holding every permission')
  console.log()

  await signOut(clientAuth).catch(() => {})

  const affiliateEmail = `rules-affiliate-${stamp}@msee-central-test.com`
  const affiliatePassword = `rules-affiliate-password-${stamp}`
  const affiliateCredential = await createUserWithEmailAndPassword(
    clientAuth,
    affiliateEmail,
    affiliatePassword,
  )
  affiliateUid = affiliateCredential.user.uid

  const allPermissionDocs = await adminDb.collection('permissions').get()
  const allPermissions = allPermissionDocs.docs.map((d) => d.id)

  await adminDb.collection('userPermissions').doc(affiliateUid).set({
    uid: affiliateUid,
    status: 'active',
    accountType: 'affiliate',
    isCeo: false,
    isFounder: false,
    roleIds: [],
    permissions: allPermissions,
    updatedAt: new Date().toISOString(),
    updatedBy: 'system:verify-rules',
  })

  await adminDb.collection('employees').doc(affiliateUid).set({
    uid: affiliateUid,
    accountType: 'affiliate',
    employeeCode: 'TEST',
    firstName: 'Rules',
    lastName: 'Affiliate',
    status: 'active',
    roleIds: [],
    photoUrl: null,
    positionId: null,
    departmentId: null,
    employmentStatus: 'contractor',
    managerUid: null,
    responsibilities: '',
    skills: [],
    expertise: [],
    bio: '',
    startDate: null,
    dateJoined: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })

  await signInWithEmailAndPassword(clientAuth, affiliateEmail, affiliatePassword)

  await mustAllow('affiliate CAN read their own record', () =>
    getDoc(doc(db, 'employees', affiliateUid)),
  )

  if (!founderSnapshot) {
    console.log('  SKIP  no founder to test isolation against')
  } else {
    await mustDeny('affiliate CANNOT read a colleague', () =>
      getDoc(doc(db, 'employees', founderSnapshot.uid)),
    )

    await mustDeny("affiliate CANNOT read a colleague's contact tier", () =>
      getDoc(doc(db, 'employees', founderSnapshot.uid, 'visibility', 'everyone')),
    )
  }

  await mustDeny('affiliate CANNOT read the roles catalogue', () =>
    getDoc(doc(db, 'roles', 'ceo')),
  )

  await mustDeny('affiliate CANNOT read positions', () => getDoc(doc(db, 'positions', 'ceo')))

  await mustDeny('affiliate CANNOT read company settings', () =>
    getDoc(doc(db, 'companySettings', 'general')),
  )

  /* The business side is internal too, whatever permissions they hold. */
  await mustDeny('affiliate CANNOT read clients', () => getDoc(doc(db, 'clients', 'any-client')))

  await mustDeny('affiliate CANNOT read projects', () => getDoc(doc(db, 'projects', 'any-project')))

  await mustDeny('affiliate CANNOT read transactions', () =>
    getDoc(doc(db, 'transactions', 'any-entry')),
  )

  /*
   * The one thing an outside partner may do: submit a lead that names them.
   * Everything else in the business half is refused by isInternal(), which is
   * what this whole phase exists to prove — this account holds every
   * permission in the system.
   */
  await mustAllow('affiliate CAN submit a lead', () =>
    setDoc(doc(db, 'leads', `rules-lead-${stamp}`), {
      id: `rules-lead-${stamp}`,
      name: 'Rules Test',
      company: 'Rules Test Co',
      description: '',
      email: '',
      phone: '',
      city: '',
      country: '',
      source: 'affiliate',
      sourceDetail: '',
      affiliateId: null,
      affiliateName: '',
      estimatedValue: null,
      serviceId: null,
      serviceInterest: '',
      stage: 'new',
      assigneeUid: null,
      assigneeName: '',
      priority: 'normal',
      lastContactedAt: null,
      nextStep: '',
      nextContactDate: null,
      notes: '',
      lostReason: '',
      custom: {},
      clientId: null,
      saleId: null,
      deletedAt: null,
      deletedBy: null,
      deletedByName: '',
      createdAt: new Date().toISOString(),
      createdBy: affiliateUid,
      updatedAt: new Date().toISOString(),
    }),
  )

  await mustAllow('affiliate CAN read the lead they submitted', () =>
    getDoc(doc(db, 'leads', `rules-lead-${stamp}`)),
  )

  /* Submitting one does not make them a salesperson. */
  await mustDeny('affiliate CANNOT read a lead somebody else submitted', () =>
    getDoc(doc(db, 'leads', 'a-lead-they-did-not-submit')),
  )

  await mustDeny('affiliate CANNOT assign a lead to an employee', () =>
    setDoc(
      doc(db, 'leads', `rules-lead-assigned-${stamp}`),
      { id: 'x', assigneeUid: 'somebody', createdBy: affiliateUid, stage: 'new' },
    ),
  )

  /*
   * The whole business side is internal, whatever permissions an affiliate
   * happens to hold. This account holds every one of them and still reaches
   * none of it — which is the claim worth proving, because a permission can be
   * granted by mistake and this line should not be crossable by mistake.
   */
  for (const [label, path] of [
    ['sales', 'sales'],
    ['transactions', 'transactions'],
    ['services', 'services'],
    ['goals', 'goals'],
    ['bonus programmes', 'bonusPrograms'],
    ['incentive work', 'incentiveWork'],
    ['notes', 'notes'],
    ['activity', 'activity'],
    ['calendar entries', 'calendarEvents'],
  ]) {
    await mustDeny(`affiliate CANNOT read ${label}`, () => getDoc(doc(db, path, 'any-record')))
  }

  await mustDeny("affiliate CANNOT read another person's notifications", () =>
    getDoc(doc(db, 'notifications', 'someone-else', 'items', 'any-item')),
  )

  await mustDeny('affiliate CANNOT read an affiliate record that is not theirs', () =>
    getDoc(doc(db, 'affiliates', 'somebody-elses-affiliate-record')),
  )

} finally {
  /* --- clean up ----------------------------------------------------- */

  await signOut(clientAuth).catch(() => {})

  for (const uid of [testUid, ownerUid, affiliateUid]) {
    if (!uid) continue
    await adminDb.collection('registrationRequests').doc(uid).delete().catch(() => {})
    await adminDb.collection('employees').doc(uid).delete().catch(() => {})
    await adminDb.collection('userPermissions').doc(uid).delete().catch(() => {})
    await adminAuth.deleteUser(uid).catch(() => {})
  }
  /* Sweep by pattern — see TEST_COLLECTIONS. Catches earlier runs too. */
  let swept = 0
  for (const name of TEST_COLLECTIONS) {
    const snap = await adminDb.collection(name).get().catch(() => null)
    if (!snap) continue
    for (const document of snap.docs) {
      if (!TEST_ID.test(document.id)) continue
      await document.ref.delete().catch(() => {})
      swept += 1
    }
  }
  if (swept) console.log(`\n  ${swept} test document(s) removed`)

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
