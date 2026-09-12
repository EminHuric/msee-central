/**
 * Data integrity check, against the real database.
 *
 * Every other check in this repo reads the source. This one reads what is
 * actually stored, because the two can disagree and the disagreement is
 * invisible from either side alone.
 *
 * It exists because of a bug that nothing else would have caught. `write()`
 * decided a record was new by asking whether an id had been supplied — but a
 * client's id is a readable slug chosen before the write, so every client
 * created was treated as an update and saved with `createdBy: ''`. The rules
 * use `createdBy` to decide who may read a record they do not own, so the
 * person who created it was then refused it. Saved, and then not there.
 *
 * A type-check cannot see that. A build cannot see it. Only the stored data
 * can, which is why this reads the stored data.
 *
 *   npm run data:check
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const here = dirname(fileURLToPath(import.meta.url))

let serviceAccount
try {
  serviceAccount = JSON.parse(readFileSync(resolve(here, 'serviceAccount.json'), 'utf8'))
} catch {
  console.error('\n  tools/serviceAccount.json not found.\n')
  process.exit(1)
}

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

/**
 * Collections holding business records, and what each one must carry.
 *
 * `soft` marks the ones that live in the recycle bin: those need `deletedAt`
 * to be present and explicitly null rather than absent, because a query
 * filtering on it cannot see a field that was never written.
 */
const EXPECTED = [
  { name: 'clients', soft: true, owner: 'responsibleUid' },
  { name: 'leads', soft: true, owner: 'assigneeUid' },
  { name: 'projects', soft: true, owner: 'ownerUid' },
  { name: 'sales', soft: true, owner: 'ownerUid' },
  { name: 'services', soft: true },
  { name: 'transactions', soft: true },
  { name: 'goals', soft: true },
  { name: 'affiliates', soft: true },
  { name: 'calendarEvents', soft: true },
  { name: 'bonusPrograms', soft: true },
  { name: 'bonusAwards' },
  { name: 'incentiveWork', soft: true },
  { name: 'commissions' },
  { name: 'notes' },
  { name: 'reservations', soft: true, owner: 'ownerUid' },
  { name: 'attribution' },
]

/** References that must point at something that exists. */
const LINKS = [
  { from: 'sales', field: 'clientId', to: 'clients' },
  { from: 'sales', field: 'serviceId', to: 'services' },
  { from: 'sales', field: 'projectId', to: 'projects' },
  { from: 'transactions', field: 'saleId', to: 'sales' },
  { from: 'transactions', field: 'clientId', to: 'clients' },
  { from: 'leads', field: 'clientId', to: 'clients' },
  { from: 'bonusAwards', field: 'sourceId', to: 'bonusPrograms', when: 'programme' },
  { from: 'reservations', field: 'clientId', to: 'clients' },
  { from: 'attribution', field: 'clientId', to: 'clients' },
]

const problems = []
const note = (kind, detail) => problems.push({ kind, detail })

console.log('\n  Data integrity')
console.log(`  project: ${serviceAccount.project_id}\n`)

/* ---- Stamps ----------------------------------------------------------- */

const ids = new Map()

for (const { name, soft, owner } of EXPECTED) {
  const snap = await db.collection(name).get()
  ids.set(name, new Set(snap.docs.map((d) => d.id)))

  let noCreatedAt = 0
  let noCreatedBy = 0
  let noDeletedAt = 0
  let orphanOwner = 0

  for (const document of snap.docs) {
    const row = document.data()

    if (!row.createdAt) noCreatedAt += 1
    if (!row.createdBy) noCreatedBy += 1
    if (soft && row.deletedAt === undefined) noDeletedAt += 1
    if (owner && row[owner] === '') orphanOwner += 1
  }

  const bad = noCreatedAt + noCreatedBy + noDeletedAt + orphanOwner
  console.log(
    `  ${name.padEnd(16)} ${String(snap.size).padStart(4)} record(s)` +
      (bad ? `   ${bad} problem(s)` : ''),
  )

  if (noCreatedAt) note(name, `${noCreatedAt} with no createdAt — they cannot be dated`)
  if (noCreatedBy) {
    note(name, `${noCreatedBy} with no createdBy — the rules cannot tell who owns them`)
  }
  if (noDeletedAt) note(name, `${noDeletedAt} with no deletedAt — invisible to the recycle bin`)
  if (orphanOwner) note(name, `${orphanOwner} with an empty ${owner}`)
}

/* ---- References -------------------------------------------------------- */

console.log('')

for (const { from, field, to, when } of LINKS) {
  const snap = await db.collection(from).get()
  const targets = ids.get(to) ?? new Set()
  const broken = []

  for (const document of snap.docs) {
    const row = document.data()
    if (when && row.source !== when) continue

    const value = row[field]
    if (!value) continue
    if (!targets.has(value)) broken.push(`${document.id}.${field} → ${value}`)
  }

  if (broken.length) {
    note(`${from}.${field}`, `${broken.length} pointing at a missing ${to}`)
    for (const row of broken.slice(0, 5)) console.log(`    ${row}`)
  }
}

/* ---- Access matches the roles behind it -------------------------------- *
 *
 * `userPermissions.permissions` is a flattened union of every role somebody
 * holds, and the security rules read that rather than the role documents. It
 * is a cache, and a cache that disagrees with its source is worse than no
 * cache: somebody is walking around with access their role no longer grants,
 * or without access it does.
 *
 * This is checked here because it is invisible from the source. Both halves
 * looked correct; only the stored pair disagreed. It had already drifted by
 * seven permissions on this database before anything noticed.
 */

{
  const roles = new Map((await db.collection('roles').get()).docs.map((d) => [d.id, d.data()]))
  const people = await db.collection('userPermissions').get()

  let drifted = 0

  for (const person of people.docs) {
    const row = person.data()
    const held = row.roleIds ?? []

    const expected = new Set(held.flatMap((id) => roles.get(id)?.permissions ?? []))
    const stored = new Set(row.permissions ?? [])

    const missingHere = [...expected].filter((p) => !stored.has(p))
    const extraHere = [...stored].filter((p) => !expected.has(p))

    /* An owner's list is not driven by their roles: `isCeo` answers first. */
    if (row.isCeo === true) continue
    if (missingHere.length === 0 && extraHere.length === 0) continue

    drifted += 1
    note(
      'access drift',
      `${person.id.slice(0, 10)} holds ${JSON.stringify(held)} — ` +
        `${missingHere.length} not granted, ${extraHere.length} left over`,
    )
  }

  console.log(
    `  ${'access'.padEnd(16)} ${String(people.size).padStart(4)} account(s)` +
      (drifted ? `   ${drifted} out of step with their roles` : ''),
  )
}

/* ---- Report ------------------------------------------------------------ */

if (problems.length === 0) {
  console.log('  ok — every record is stamped and every reference resolves\n')
  process.exit(0)
}

console.log('\n  problems')
for (const { kind, detail } of problems) console.log(`    ${kind.padEnd(22)} ${detail}`)
console.log(`\n  ${problems.length} problem(s)\n`)
process.exit(1)
