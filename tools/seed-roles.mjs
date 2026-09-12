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
 * role somebody has customised unless it is told to:
 *
 *   npm run roles:seed -- --dry         say what would change, write nothing
 *   npm run roles:seed                  fill in roles nobody has configured
 *   npm run roles:seed -- --force       also merge the template into tailored
 *                                       roles, keeping what is already there
 *   npm run roles:seed -- --replace     overwrite tailored roles entirely.
 *                                       This DELETES hand-made permissions;
 *                                       the run names every one it drops.
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
const replace = process.argv.includes('--replace')

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
  /*
   * Bookings are everybody's job, so entering one is in the base.
   *
   * Without `reservations.view_all` it means their own and no more: a person
   * records what they brought, corrects their own typo, and sees nobody
   * else's. Widening it is the manager's line below.
   */
  'reservations.view',
  'reservations.create',
  'reservations.edit',
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
      'reservations.view_all',
      'reservations.delete',
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
   * A role somebody has already tailored is theirs.
   *
   * Three behaviours, and the middle one is the one that matters:
   *
   *   default      a tailored role is left completely alone.
   *   --force      the template is MERGED IN. Everything the template lists is
   *                added; everything already there stays. This is what adding
   *                a new module needs, and it cannot cost anybody a grant.
   *   --replace    the stored list is thrown away for the template's.
   *
   * --force used to mean --replace, and that is how four hand-made permissions
   * were lost from the Employee role: the run reported "17 -> 16" and the four
   * it dropped existed nowhere else. A tool that can silently delete a
   * configuration should have to be told to, in those words.
   */
  const tailored = existing.exists && current.length > 1

  if (tailored && !force && !replace) {
    console.log(`  ${id.padEnd(12)} left alone — ${current.length} permission(s) already set`)
    continue
  }

  const wanted = replace || !existing.exists
    ? role.permissions
    : [...new Set([...current, ...role.permissions])]

  const added = wanted.filter((p) => !current.includes(p))
  const dropped = current.filter((p) => !wanted.includes(p))

  if (!added.length && !dropped.length) {
    console.log(`  ${id.padEnd(12)} already correct — ${current.length} permission(s)`)
    continue
  }

  console.log(
    `  ${id.padEnd(12)} ${existing.exists ? 'updated' : 'created'} — ` +
      `${current.length} → ${wanted.length} permission(s)`,
  )
  if (added.length) console.log(`               + ${added.join(' ')}`)
  /* Named, always. A dropped permission is somebody's access disappearing. */
  if (dropped.length) console.log(`               - ${dropped.join(' ')}   (REMOVED)`)

  if (dry) continue

  await db.collection('roles').doc(id).set(
    {
      id,
      key: id,
      name: role.name,
      nameSr: role.name,
      description: role.description,
      descriptionSr: role.description,
      permissions: wanted,
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
