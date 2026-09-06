/**
 * Push the permission catalogue into Firestore.
 *
 * `permissions/{key}` is a mirror of `src/types/permissions.ts`, kept so the
 * catalogue can be read from the console and so tooling can enumerate every
 * permission without importing application code.
 *
 * It used to be written once, by the CEO bootstrap. That was fine until a
 * module was added: the code gained twenty-five permissions and the database
 * still listed the original thirty-one, so anything reading the collection was
 * quietly working from last year's list. This makes the sync repeatable.
 *
 * Adding is safe and removing is deliberate: a key that has disappeared from
 * the code is reported and left alone unless --prune is passed, because a
 * permission still held by somebody should not vanish without a decision.
 *
 *   npm run permissions:sync
 *   npm run permissions:sync -- --prune
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

import { ALL_PERMISSIONS } from '../src/types/permissions.ts'

const here = dirname(fileURLToPath(import.meta.url))
const keyPath = resolve(here, 'serviceAccount.json')

let serviceAccount
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))
} catch {
  console.error('\n  tools/serviceAccount.json not found.')
  console.error('  It is the key that bypasses every security rule — never commit it.\n')
  process.exit(1)
}

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const prune = process.argv.includes('--prune')
const now = new Date().toISOString()

console.log('\n  Permission catalogue')
console.log(`  project: ${serviceAccount.project_id}`)
console.log(`  in code: ${ALL_PERMISSIONS.length} permissions\n`)

const existing = await db.collection('permissions').get()
const stored = new Set(existing.docs.map((d) => d.id))
const wanted = new Set(ALL_PERMISSIONS)

const added = ALL_PERMISSIONS.filter((key) => !stored.has(key))
const orphaned = [...stored].filter((key) => !wanted.has(key))

const batch = db.batch()
for (const key of ALL_PERMISSIONS) {
  const [resource, action] = key.split('.')
  batch.set(
    db.collection('permissions').doc(key),
    { key, resource, action, updatedAt: now },
    { merge: true },
  )
}

if (prune) {
  for (const key of orphaned) batch.delete(db.collection('permissions').doc(key))
}

await batch.commit()

console.log(`  + written     ${ALL_PERMISSIONS.length}`)
if (added.length) {
  console.log(`  + new         ${added.length}`)
  for (const key of added) console.log(`      ${key}`)
}

if (orphaned.length) {
  console.log(`\n  ${prune ? '- removed' : '! no longer in code'}   ${orphaned.length}`)
  for (const key of orphaned) console.log(`      ${key}`)
  if (!prune) {
    console.log('\n  Left in place. Re-run with --prune once nobody holds them.')
  }
}

console.log('\n  done\n')
process.exit(0)
