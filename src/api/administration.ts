/**
 * Actions the CEO and authorised management perform on other people.
 *
 * Everything here writes an audit entry. Everything here is also refused by
 * the security rules unless the caller genuinely holds the permission — the
 * checks in the UI only decide whether a button is shown.
 *
 * ONE RULE SHAPES THIS WHOLE FILE: a manager holding roles.assign may not
 * write their OWN `userPermissions` document. That is what stops an employee
 * promoting themselves.
 *
 * The CEO is exempt, because the CEO already holds every permission and so has
 * nothing to escalate to. Two limits still apply to them, and both exist to
 * prevent a company locking itself out: the CEO cannot drop their own CEO role
 * and cannot suspend their own account.
 */

import { doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore'

import { logAudit } from './audit'
import { getDb } from '@/lib/firebase'
import type { AccountStatus, EmploymentStatus, Role } from '@/types/domain'
import type { Permission } from '@/types/permissions'

export class SelfActionError extends Error {
  constructor() {
    super('An administrator cannot perform this action on their own account.')
    this.name = 'SelfActionError'
  }
}

/**
 * Raised when the CEO tries to remove their own CEO role.
 *
 * The rules refuse it too. Stepping down is done by appointing a second CEO,
 * who can then demote the first — that way the company can never end up with
 * nobody able to administer it.
 */
export class SelfDemotionError extends Error {
  constructor() {
    super('The CEO cannot remove their own CEO role. Appoint another CEO first.')
    this.name = 'SelfDemotionError'
  }
}

/* ------------------------------------------------------------------ *
 * Work information
 * ------------------------------------------------------------------ */

export interface WorkInformation {
  positionId: string | null
  departmentId: string | null
  employmentStatus: EmploymentStatus
  startDate: string | null
  managerUid: string | null
  responsibilities: string
}

/**
 * Set the job: position, department, engagement, manager, responsibilities.
 *
 * Requires `employees.edit_professional`. Deliberately does NOT touch status or
 * roleIds — the rules reject those from this permission alone, and bundling
 * them would let a job-title edit quietly become a promotion.
 */
export async function updateWorkInformation(
  uid: string,
  label: string,
  work: WorkInformation,
): Promise<void> {
  const db = getDb()
  const batch = writeBatch(db)

  batch.update(doc(db, 'employees', uid), {
    positionId: work.positionId,
    departmentId: work.departmentId,
    employmentStatus: work.employmentStatus,
    startDate: work.startDate,
    managerUid: work.managerUid,
    responsibilities: work.responsibilities.trim(),
    updatedAt: new Date().toISOString(),
  })

  await batch.commit()

  await logAudit({
    action: 'position.changed',
    targetType: 'user',
    targetId: uid,
    targetLabel: label,
    metadata: {
      positionId: work.positionId,
      departmentId: work.departmentId,
      employmentStatus: work.employmentStatus,
    },
  })
}

/* ------------------------------------------------------------------ *
 * Account status
 * ------------------------------------------------------------------ */

const STATUS_AUDIT_ACTION = {
  active: 'account.activated',
  suspended: 'account.suspended',
  deactivated: 'account.deactivated',
  rejected: 'account.rejected',
  pending: 'account.approved',
} as const

/**
 * Suspend, reactivate or deactivate somebody.
 *
 * Both documents move together in one batch. `userPermissions.status` is what
 * the security rules actually consult; `employees.status` is the copy the
 * directory renders. Writing only one would leave a person who looks suspended
 * on screen but still holds live access, which is the worse of the two
 * failures — so they are atomic.
 *
 * The employee record is never deleted, whatever the status.
 */
export async function setAccountStatus(
  uid: string,
  label: string,
  status: AccountStatus,
  actorUid: string,
): Promise<void> {
  if (uid === actorUid) throw new SelfActionError()

  const db = getDb()
  const now = new Date().toISOString()
  const batch = writeBatch(db)

  batch.update(doc(db, 'employees', uid), { status, updatedAt: now })
  batch.update(doc(db, 'userPermissions', uid), {
    status,
    updatedAt: now,
    updatedBy: actorUid,
  })

  await batch.commit()

  await logAudit({
    action: STATUS_AUDIT_ACTION[status],
    targetType: 'user',
    targetId: uid,
    targetLabel: label,
    metadata: { status },
  })
}

/* ------------------------------------------------------------------ *
 * Roles
 * ------------------------------------------------------------------ */

/**
 * Replace somebody's roles and recompute the permissions the rules read.
 *
 * `userPermissions.permissions` is a flattened union of every assigned role,
 * stored so a security rule can answer "may they?" with one document read
 * instead of walking the role graph. It is a cache, and this is the only
 * function allowed to rebuild it.
 *
 * A role marked `grantsAll` (the CEO role) confers every permission, including
 * ones that do not exist yet, so future modules need no migration.
 */
export async function assignRoles(
  uid: string,
  label: string,
  roleIds: string[],
  allRoles: Role[],
  actorUid: string,
  actorIsCeo = false,
): Promise<void> {
  const editingSelf = uid === actorUid

  // A manager may never touch their own roles; the CEO may.
  if (editingSelf && !actorIsCeo) throw new SelfActionError()

  const chosen = allRoles.filter((role) => roleIds.includes(role.id))
  const grantsAll = chosen.some((role) => role.grantsAll)

  // Refuse the one self-edit that cannot be undone from inside the app.
  if (editingSelf && !grantsAll) throw new SelfDemotionError()

  const permissions = [
    ...new Set(chosen.flatMap((role) => role.permissions)),
  ] as Permission[]

  const db = getDb()
  const now = new Date().toISOString()
  const batch = writeBatch(db)

  batch.update(doc(db, 'employees', uid), { roleIds, updatedAt: now })
  batch.update(doc(db, 'userPermissions', uid), {
    roleIds,
    permissions,
    isCeo: grantsAll,
    updatedAt: now,
    updatedBy: actorUid,
  })

  await batch.commit()

  await logAudit({
    action: 'role.assigned',
    targetType: 'user',
    targetId: uid,
    targetLabel: label,
    metadata: { roleIds, permissionCount: permissions.length, isCeo: grantsAll },
  })
}

/** Read one person's effective access, for the management panel. */
export async function fetchUserAccess(
  uid: string,
): Promise<{ roleIds: string[]; isCeo: boolean; status: AccountStatus } | null> {
  const snap = await getDoc(doc(getDb(), 'userPermissions', uid))
  if (!snap.exists()) return null
  const data = snap.data()
  return {
    roleIds: (data.roleIds ?? []) as string[],
    isCeo: data.isCeo === true,
    status: data.status as AccountStatus,
  }
}

/* ------------------------------------------------------------------ *
 * Departments and positions
 * ------------------------------------------------------------------ */

export interface DepartmentInput {
  id: string
  name: string
  nameSr: string
  description: string
  status: 'active' | 'inactive'
}

export async function saveDepartment(input: DepartmentInput, isNew: boolean): Promise<void> {
  const db = getDb()
  const batch = writeBatch(db)

  batch.set(
    doc(db, 'departments', input.id),
    {
      id: input.id,
      name: input.name.trim(),
      nameSr: input.nameSr.trim() || input.name.trim(),
      description: input.description.trim(),
      status: input.status,
      ...(isNew ? { createdAt: serverTimestamp() } : {}),
    },
    { merge: true },
  )

  await batch.commit()

  await logAudit({
    action: 'department.changed',
    targetType: 'department',
    targetId: input.id,
    targetLabel: input.name,
    metadata: { created: isNew, status: input.status },
  })
}

export interface PositionInput {
  id: string
  title: string
  titleSr: string
  departmentId: string | null
  description: string
  status: 'active' | 'inactive'
}

export async function savePosition(input: PositionInput, isNew: boolean): Promise<void> {
  const db = getDb()
  const batch = writeBatch(db)

  batch.set(
    doc(db, 'positions', input.id),
    {
      id: input.id,
      title: input.title.trim(),
      titleSr: input.titleSr.trim() || input.title.trim(),
      departmentId: input.departmentId,
      description: input.description.trim(),
      status: input.status,
      ...(isNew ? { createdAt: serverTimestamp() } : {}),
    },
    { merge: true },
  )

  await batch.commit()

  await logAudit({
    action: 'position.changed',
    targetType: 'position',
    targetId: input.id,
    targetLabel: input.title,
    metadata: { created: isNew, status: input.status },
  })
}

/**
 * Turn a name into a stable document id.
 *
 * Ids never change once created, so renaming a department later does not break
 * the employees pointing at it.
 */
export function slugify(value: string): string {
  const map: Record<string, string> = {
    č: 'c', ć: 'c', đ: 'd', š: 's', ž: 'z',
    Č: 'c', Ć: 'c', Đ: 'd', Š: 's', Ž: 'z',
  }
  return value
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}
