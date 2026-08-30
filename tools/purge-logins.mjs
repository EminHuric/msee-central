/**
 * Remove sign-ins that no longer belong to anybody.
 *
 * The browser has no authority to delete a Firebase Auth account, so deleting
 * a person from the application erases everything stored about them and leaves
 * the login itself behind, reaching nothing. This clears those shells.
 *
 * It is also the only way to free an email address for reuse, since Firebase
 * refuses to create a second account on an address that already exists.
 *
 *   npm run purge-logins            list what would go
 *   npm run purge-logins -- --yes   actually delete them
 *
 * Safe by default: nothing is removed without --yes.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cert, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const here = dirname(fileURLToPath(import.meta.url))
const serviceAccount = JSON.parse(readFileSync(resolve(here, 'serviceAccount.json'), 'utf8'))

initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
const auth = getAuth()
const db = getFirestore()

const confirmed = process.argv.includes('--yes')

console.log('\n  Orphaned sign-ins')
console.log(`  project: ${serviceAccount.project_id}\n`)

/*
 * An account is orphaned when nothing in Firestore refers to it: no access
 * document, no employee record, and no registration request. A pending
 * applicant has a request, so they are never swept up by this.
 */
const orphans = []
let total = 0
let pageToken

do {
  const page = await auth.listUsers(1000, pageToken)
  pageToken = page.pageToken

  for (const user of page.users) {
    total++
    const [access, employee, request] = await Promise.all([
      db.collection('userPermissions').doc(user.uid).get(),
      db.collection('employees').doc(user.uid).get(),
      db.collection('registrationRequests').doc(user.uid).get(),
    ])

    if (!access.exists && !employee.exists && !request.exists) {
      orphans.push(user)
    }
  }
} while (pageToken)

console.log(`  ${total} sign-ins checked, ${orphans.length} orphaned\n`)

if (orphans.length === 0) {
  console.log('  nothing to do\n')
  process.exit(0)
}

for (const user of orphans) {
  console.log(`    ${user.email ?? user.uid}   created ${user.metadata.creationTime}`)
}

if (!confirmed) {
  console.log('\n  Nothing deleted. Re-run with --yes to remove them.\n')
  process.exit(0)
}

console.log('')
for (const user of orphans) {
  await auth.deleteUser(user.uid)
  console.log(`  + removed ${user.email ?? user.uid}`)
}

console.log('')
process.exit(0)
