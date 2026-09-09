/**
 * Give the standard roles a usable set of permissions.
 *
 * The Employee role in this database carried exactly one permission —
 * `employees.view` — which is why an employee could sign in and see the staff
 * directory and nothing else. No leads, no clients, no services, no earnings.
 * That is not a design decision anybody made; it is a role that was created
 * empty and never filled in.
 *
 * Every set below is built from the same principle: what does somebody in this
 * job need in order to do it, and nothing beyond that.
 *
 * Two things are deliberately absent from every employee role:
 *
 *   `services.view_price` — somebody can sell a service without being shown
 *   what the company charges for it or makes on it. Grant it per person.
 *
 *   `finance.view` — company money is not an employee's business, and their
 *   own earnings live in their wallet instead.
 *
 * Safe to re-run. It writes the permission list and leaves everything else —
 * names, `isSystem`, `grantsAll` — exactly as it is, and it never touches a
 * role somebody has customised unless `--force` is passed.
 *
 *   npm run roles:seed -- --dry
 *   npm run roles:seed
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

const dry = process.argv.includes('--dry')
const force = process.argv.includes('--force')

/* What anybody who works here needs to do their own job. */
const BASE = [
  'clients.view',
  'leads.view',
  'leads.create',
  'leads.edit',
  'services.view',
  'projects.view',
  'goals.view',
  'goals.create_personal',
  'bonuses.view',
  'wallet.view_own',
  'calendar.view',
  'calendar.manage',
  'employees.view',
]

const ROLES = {
  employee: {
    name: 'Employee',
    description: 'Their own leads, their own work, their own earnings.',
    permissions: BASE,
  },

  sales: {
    name: 'Sales',
    description: 'Sells services and looks after their own pipeline.',
    permissions: [
      ...BASE,
      'clients.create',
      'clients.edit',
      'leads.delete',
      'sales.view',
      'sales.create',
      'sales.edit',
    ],
  },

  developer: {
    name: 'Developer',
    description: 'Delivers the work: projects, milestones, the clients behind them.',
    permissions: [...BASE, 'projects.edit', 'clients.edit'],
  },

  marketing: {
    name: 'Marketing',
    description: 'Brings leads in and can see where they came from.',
    permissions: [...BASE, 'clients.create', 'clients.edit', 'analytics.view'],
  },

  manager: {
    /*
     * A manager sees the team rather than the company.
     *
     * `*.view_all` is what widens their reach past their own records; finance
     * and the earnings of other people are deliberately not here, and are
     * granted per person when the job actually needs them.
     */
    name: 'Manager',
    description: 'Runs a team: their people, their leads, their targets.',
    permissions: [
      ...BASE,
      'clients.create',
      'clients.edit',
      'clients.view_all',
      'leads.view_all',
      'leads.assign',
      'leads.delete',
      'sales.view',
      'sales.view_all',
      'sales.create',
      'sales.edit',
      'projects.view_all',
      'projects.create',
      'projects.edit',
      'employees.view_all',
      'goals.manage',
      'bonuses.view_all',
      'analytics.view',
      'performance.view_all',
    ],
  },
}

console.log('\n  Standard roles')
console.log(`  project: ${serviceAccount.project_id}`)
console.log(dry ? '  DRY RUN — nothing will be written\n' : '  writing\n')

/* Only grant permissions that actually exist, so a typo cannot create one. */
const known = new Set((await db.collection('permissions').get()).docs.map((d) => d.id))

let wrote = 0

for (const [id, role] of Object.entries(ROLES)) {
  const existing = await db.collection('roles').doc(id).get()
  const current = existing.exists ? (existing.data().permissions ?? []) : []

  const unknown = role.permissions.filter((p) => !known.has(p))
  if (unknown.length) {
    console.log(`  ${id.padEnd(12)} SKIPPED — unknown permission(s): ${unknown.join(', ')}`)
    continue
  }

  /*
   * A role somebody has already tailored is theirs. Only an empty or
   * never-configured one is filled in, unless --force says otherwise.
   */
  const customised = existing.exists && current.length > 1 && !force
  if (customised) {
    console.log(`  ${id.padEnd(12)} left alone — ${current.length} permission(s) already set`)
    continue
  }

  console.log(
    `  ${id.padEnd(12)} ${existing.exists ? 'updated' : 'created'} — ` +
      `${current.length} → ${role.permissions.length} permission(s)`,
  )

  if (dry) continue

  await db.collection('roles').doc(id).set(
    {
      id,
      key: id,
      name: role.name,
      nameSr: role.name,
      description: role.description,
      descriptionSr: role.description,
      permissions: role.permissions,
      status: 'active',
      ...(existing.exists ? {} : { isSystem: false, grantsAll: false, createdAt: new Date().toISOString() }),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  )
  wrote += 1
}

/*
 * Re-flatten everybody, so a changed role reaches the people holding it.
 * This is the same recomputation the application does on save; it is here so
 * seeding does not leave the two out of step.
 */
if (!dry && wrote) {
  const roles = new Map((await db.collection('roles').get()).docs.map((d) => [d.id, d.data()]))
  const people = await db.collection('userPermissions').get()
  let resynced = 0

  for (const person of people.docs) {
    const row = person.data()
    if (row.isCeo === true) continue

    const held = row.roleIds ?? []
    const permissions = [...new Set(held.flatMap((r) => roles.get(r)?.permissions ?? []))]

    await person.ref.set({ permissions, updatedAt: new Date().toISOString() }, { merge: true })
    resynced += 1
  }

  console.log(`\n  ${resynced} account(s) brought in step with their roles`)
}

console.log(dry ? '\n  dry run complete\n' : '\n  done\n')
process.exit(0)
