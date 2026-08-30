/**
 * Roles.
 *
 * A role decides what somebody may do inside MsEe Central. It is not the same
 * thing as a position, which describes the job they are paid to do. Keeping
 * them apart is what lets a "Marketing Manager" and a "Sales Manager" share
 * one "Manager" role without inventing a permission set per job title.
 */

import { collection, doc, getDocs, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore'

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
export async function saveRole(input: RoleInput, isNew: boolean): Promise<void> {
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

  await logAudit({
    action: isNew ? 'role.created' : 'role.updated',
    targetType: 'role',
    targetId: input.id,
    targetLabel: input.name,
    metadata: { permissionCount: input.permissions.length, status: input.status },
  })
}
