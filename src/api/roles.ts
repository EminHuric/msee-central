/**
 * Roles.
 *
 * A role decides what somebody may do inside MsEe Central. It is not the same
 * thing as a position, which describes the job they are paid to do. Keeping
 * them apart is what lets a "Marketing Manager" and a "Sales Manager" share
 * one "Manager" role without inventing a permission set per job title.
 */

import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'

import { logAudit } from './audit'
import { getDb } from '@/lib/firebase'
import { currentLocale } from '@/i18n'
import type { Role } from '@/types/domain'
import type { Permission } from '@/types/permissions'

export async function fetchRoles(): Promise<Role[]> {
  const snap = await getDocs(query(collection(getDb(), 'roles'), orderBy('name')))
  return snap.docs.map((d) => ({ ...(d.data() as Role), id: d.id }))
}

export function roleName(role: Role | undefined): string {
  if (!role) return ''
  return (currentLocale() === 'sr' ? role.nameSr : role.name) || role.name
}

export function roleDescription(role: Role | undefined): string {
  if (!role) return ''
  return (currentLocale() === 'sr' ? role.descriptionSr : role.description) || role.description
}

/**
 * Sort key that keeps the owners at the top of any list of people.
 *
 * CEO first, then CTO, then everybody else alphabetically. Who runs the
 * company is the first thing somebody scanning the directory looks for, so it
 * should not depend on where the alphabet happens to put them.
 */
export function ownerRank(roleIds: string[] | undefined): number {
  if (!roleIds) return 9
  if (roleIds.includes('ceo')) return 0
  if (roleIds.includes('cto')) return 1
  return 9
}

export interface RoleInput {
  id: string
  name: string
  description: string
  permissions: Permission[]
  status: 'active' | 'inactive'
}

/**
 * Create or update a custom role.
 *
 * `isSystem` and `grantsAll` are written as false and never accepted from the
 * caller: the CEO role is created once by the setup script and must not be
 * reproducible from this screen. The security rules refuse it too.
 */
export async function saveRole(input: RoleInput, isNew: boolean): Promise<Resync> {
  const name = input.name.trim()
  const description = input.description.trim()

  await setDoc(
    doc(getDb(), 'roles', input.id),
    {
      id: input.id,
      key: input.id,
      /*
       * One name, stored in both language fields.
       *
       * A role is usually called the same thing in both languages here
       * ("Marketing Manager"), and demanding two spellings for every role is
       * friction with nothing behind it. The pair of fields stays in the model
       * so a translation can be added later without a migration.
       */
      name,
      nameSr: name,
      description,
      descriptionSr: description,
      permissions: input.permissions,
      status: input.status,
      ...(isNew ? { isSystem: false, grantsAll: false, createdAt: serverTimestamp() } : {}),
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  )

  const resynced = isNew ? { updated: 0, skipped: 0 } : await resyncHolders(input.id)

  await logAudit({
    action: isNew ? 'role.created' : 'role.updated',
    targetType: 'role',
    targetId: input.id,
    targetLabel: input.name,
    metadata: {
      permissionCount: input.permissions.length,
      status: input.status,
      holdersUpdated: resynced.updated,
      holdersSkipped: resynced.skipped,
    },
  })

  return resynced
}

/**
 * Push a changed role out to everybody who holds it.
 *
 * `userPermissions.permissions` is a flattened union of every role a person
 * has, and the rules read that rather than the role documents — one field
 * instead of a document read per role on every single check.
 *
 * That flattening is a cache, and nothing was invalidating it. Editing a role
 * rewrote the role and stopped; anybody already holding it kept the permission
 * list they were given the day it was assigned. On this database that had
 * already drifted: an account holding a role carrying 31 permissions had 24.
 *
 * So the recomputation happens here, when a role changes — which is rare —
 * rather than on every permission check, which is constant. Reading the role
 * documents from inside the rules would be the other way round, and would cost
 * a lookup per role on every read the application makes.
 *
 * Returns how many people were updated and how many could not be, so the
 * screen can report both rather than implying a clean sweep.
 */
export interface Resync {
  updated: number
  /**
   * Holders the rules refused.
   *
   * The founder's access is theirs alone: nobody else may write it, not even a
   * co-owner. So a CTO editing the CEO role updates everybody except the
   * founder, and that has to be said out loud rather than swallowed — the
   * alternative is a role that looks fully applied and is not.
   */
  skipped: number
}

export async function resyncHolders(roleId: string): Promise<Resync> {
  const db = getDb()

  const [roles, holders] = await Promise.all([
    fetchRoles(),
    getDocs(query(collection(db, 'userPermissions'), where('roleIds', 'array-contains', roleId))),
  ])

  const byId = new Map(roles.map((r) => [r.id, r]))
  const stamp = new Date().toISOString()

  let updated = 0
  let skipped = 0

  for (const holder of holders.docs) {
    const roleIds: string[] = holder.data().roleIds ?? []
    const mine = roleIds.map((id) => byId.get(id)).filter((r): r is Role => !!r)

    const permissions = [...new Set(mine.flatMap((r) => r.permissions))] as Permission[]
    const grantsAll = mine.some((r) => r.grantsAll)

    try {
      await setDoc(
        doc(db, 'userPermissions', holder.id),
        { uid: holder.id, permissions, isCeo: grantsAll, updatedAt: stamp },
        { merge: true },
      )
      updated += 1
    } catch {
      /* Refused by the rules — see the note on `skipped`. */
      skipped += 1
    }
  }

  return { updated, skipped }
}
