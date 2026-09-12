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

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore'

import { logAudit } from './audit'
import { getDb } from '@/lib/firebase'
import type { AccountStatus, AccountType, EmploymentStatus, Role } from '@/types/domain'
import type { Permission } from '@/types/permissions'
import { effectivePermissions, type AccessOverrides } from '@/types/access'

export class SelfActionError extends Error {
  constructor() {
    super('An administrator cannot perform this action on their own account.')
    this.name = 'SelfActionError'
  }
}

/**
 * Raised when an action targets the founder's account.
 *
 * The rules refuse it independently. This exists so the refusal arrives as an
 * explanation rather than a bare permission error.
 */
export class FounderProtectedError extends Error {
  constructor() {
    super('The founder account cannot be modified by anybody.')
    this.name = 'FounderProtectedError'
  }
}

/**
 * Raised when only the founder may do this — appointing or removing a
 * co-owner.
 */
export class FounderOnlyError extends Error {
  constructor() {
    super('Only the founder may appoint or remove a co-owner.')
    this.name = 'FounderOnlyError'
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
  targetIsFounder = false,
): Promise<void> {
  if (uid === actorUid) throw new SelfActionError()
  if (targetIsFounder) throw new FounderProtectedError()

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
  actor: { isOwner: boolean; isFounder: boolean },
  targetIsFounder = false,
): Promise<void> {
  const editingSelf = uid === actorUid

  // A manager may never touch their own roles; an owner may.
  if (editingSelf && !actor.isOwner) throw new SelfActionError()

  // The founder's account is nobody's to change but their own.
  if (!editingSelf && targetIsFounder) throw new FounderProtectedError()

  const chosen = allRoles.filter((role) => roleIds.includes(role.id))
  const grantsAll = chosen.some((role) => role.grantsAll)

  // Only the founder hands out or takes back owner status.
  if (!editingSelf && grantsAll && !actor.isFounder) throw new FounderOnlyError()

  // Refuse the one self-edit that cannot be undone from inside the app.
  if (editingSelf && !grantsAll) throw new SelfDemotionError()

  /*
   * Individual decisions survive a change of role.
   *
   * The roles supply the baseline; whatever the CEO has granted or revoked for
   * this person alone sits on top of it. Recomputing from the roles only —
   * which is what happened before — silently threw those away every time
   * somebody's role was changed.
   */
  const existing = await getDoc(doc(getDb(), 'userPermissions', uid))
  const overrides: AccessOverrides = {
    granted: (existing.data()?.granted ?? []) as Permission[],
    revoked: (existing.data()?.revoked ?? []) as Permission[],
    scopes: existing.data()?.scopes ?? {},
  }

  const rolePermissions = [
    ...new Set(chosen.flatMap((role) => role.permissions)),
  ] as Permission[]

  const permissions = effectivePermissions(rolePermissions, overrides)

  const db = getDb()
  const now = new Date().toISOString()
  const batch = writeBatch(db)

  batch.update(doc(db, 'employees', uid), { roleIds, updatedAt: now })
  batch.update(doc(db, 'userPermissions', uid), {
    roleIds,
    permissions,
    /* Written back unchanged, so the next recomputation can see them. */
    granted: overrides.granted,
    revoked: overrides.revoked,
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
export async function fetchUserAccess(uid: string): Promise<{
  roleIds: string[]
  isCeo: boolean
  isFounder: boolean
  status: AccountStatus
  /* The individual decisions standing on top of the roles. */
  granted: string[]
  revoked: string[]
  scopes: Record<string, string>
} | null> {
  const snap = await getDoc(doc(getDb(), 'userPermissions', uid))
  if (!snap.exists()) return null
  const data = snap.data()
  return {
    roleIds: (data.roleIds ?? []) as string[],
    isCeo: data.isCeo === true,
    isFounder: data.isFounder === true,
    status: data.status as AccountStatus,
    granted: (data.granted ?? []) as string[],
    revoked: (data.revoked ?? []) as string[],
    scopes: (data.scopes ?? {}) as Record<string, string>,
  }
}

/* ------------------------------------------------------------------ *
 * Permanent erasure
 * ------------------------------------------------------------------ */

/**
 * Delete a person and everything stored about them. There is no undo.
 *
 * Deactivation is the normal way to remove somebody from the company: it keeps
 * the record, keeps the history legible, and can be reversed the next morning.
 * This is for the other case — data that has to be gone.
 *
 * Firestore does not cascade deletes, so every tier and every note is removed
 * explicitly. Missing one would leave a private phone number behind after the
 * profile that explained whose it was had gone.
 *
 * The audit trail survives: entries carry a snapshot of the name they acted
 * on, so what this person did stays readable after the person does not.
 *
 * Their sign-in credentials are not removed here — the browser has no
 * authority to delete a Firebase Auth account. They are left owning a login
 * that reaches nothing at all. `npm run purge-logins` clears those.
 */
export async function deleteEmployeePermanently(
  uid: string,
  label: string,
  actorUid: string,
  targetIsFounder = false,
): Promise<void> {
  if (uid === actorUid) throw new SelfActionError()
  if (targetIsFounder) throw new FounderProtectedError()

  const db = getDb()

  // Logged BEFORE the deletion: afterwards there is nothing left to describe.
  await logAudit({
    action: 'account.deactivated',
    targetType: 'user',
    targetId: uid,
    targetLabel: label,
    metadata: { permanentDeletion: true },
  })

  const notes = await getDocs(collection(db, 'employees', uid, 'notes'))
  const batch = writeBatch(db)
  for (const note of notes.docs) batch.delete(note.ref)
  for (const tier of ['everyone', 'management', 'private']) {
    batch.delete(doc(db, 'employees', uid, 'visibility', tier))
  }
  await batch.commit()

  // The two root documents last, so a failure part-way leaves the person
  // findable rather than orphaning their subdocuments.
  await deleteDoc(doc(db, 'employees', uid))
  await deleteDoc(doc(db, 'userPermissions', uid))
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

/* ------------------------------------------------------------------ *
 * Individual access
 * ------------------------------------------------------------------ */

/**
 * Change what ONE person may do, without touching their role.
 *
 * This is the function the whole feature exists for. A role is a template; the
 * verdict is per person, and two people holding the same role can end up with
 * completely different access because the decisions live here rather than in
 * the role.
 *
 * The effective list is recomputed from the roles plus these overrides, so it
 * stays correct when either side changes — and it is written to
 * `permissions`, the field every security rule already reads. No rule changed
 * to make this work.
 */
export async function saveOverrides(
  uid: string,
  label: string,
  overrides: AccessOverrides,
  allRoles: Role[],
  actorUid: string,
  targetIsFounder = false,
): Promise<Permission[]> {
  /* The founder's access is theirs alone. */
  if (targetIsFounder && uid !== actorUid) throw new FounderProtectedError()

  const db = getDb()
  const snap = await getDoc(doc(db, 'userPermissions', uid))
  const roleIds: string[] = snap.data()?.roleIds ?? []

  const rolePermissions = [
    ...new Set(
      allRoles.filter((r) => roleIds.includes(r.id)).flatMap((r) => r.permissions),
    ),
  ] as Permission[]

  const permissions = effectivePermissions(rolePermissions, overrides)
  const now = new Date().toISOString()

  await setDoc(
    doc(db, 'userPermissions', uid),
    {
      uid,
      permissions,
      granted: overrides.granted,
      revoked: overrides.revoked,
      scopes: overrides.scopes,
      updatedAt: now,
      updatedBy: actorUid,
    },
    { merge: true },
  )

  /*
   * Logged with both lists, not just the total.
   *
   * "Permissions changed" tells nobody anything six months later. What was
   * given and what was taken is the part somebody will need to read back.
   */
  await logAudit({
    action: 'permissions.changed',
    targetType: 'user',
    targetId: uid,
    targetLabel: label,
    metadata: {
      granted: overrides.granted,
      revoked: overrides.revoked,
      scopes: overrides.scopes,
      effectiveCount: permissions.length,
    },
  })

  return permissions
}

/**
 * Change whether somebody is staff or an outside partner.
 *
 * Far more consequential than it looks, and worth spelling out: every internal
 * rule in the database begins with `isInternal()`, which is false for a
 * partner. So an account marked `affiliate` reads NOTHING internal — no
 * clients, no leads, no services — however many permissions it holds.
 *
 * That had happened here: a member of staff was created as a partner and could
 * sign in, hold seventeen permissions, and see nothing at all. Nothing in the
 * application could change it afterwards, which is why this exists.
 */
export async function setAccountType(
  uid: string,
  label: string,
  accountType: AccountType,
  actorUid: string,
  targetIsFounder = false,
): Promise<void> {
  if (uid === actorUid) throw new SelfActionError()
  if (targetIsFounder) throw new FounderProtectedError()

  const db = getDb()
  const now = new Date().toISOString()
  const batch = writeBatch(db)

  /* Both copies, or the directory and the rules disagree about who somebody is. */
  batch.update(doc(db, 'employees', uid), { accountType, updatedAt: now })
  batch.update(doc(db, 'userPermissions', uid), {
    accountType,
    updatedAt: now,
    updatedBy: actorUid,
  })

  await batch.commit()

  await logAudit({
    action: 'account.type_changed',
    targetType: 'user',
    targetId: uid,
    targetLabel: label,
    metadata: { accountType },
  })
}
