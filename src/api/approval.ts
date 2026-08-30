/**
 * The CEO approval flow.
 *
 * Approving somebody is the moment an applicant becomes an employee, and it
 * touches four documents at once:
 *
 *   registrationRequests/{uid}   marked approved, with who decided and when
 *   employees/{uid}              the professional profile colleagues will see
 *   employees/{uid}/visibility/* their personal details, filed by privacy tier
 *   userPermissions/{uid}        the access document — created here, and only
 *                                here, by somebody holding roles.assign
 *
 * All of it goes in one batch. A half-approval is the dangerous outcome: an
 * account with permissions but no profile, or a profile with no way in. Either
 * every document lands or none does.
 */

import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  where,
  writeBatch,
} from 'firebase/firestore'

import { logAudit } from './audit'
import { getDb } from '@/lib/firebase'
import {
  DEFAULT_PRIVACY,
  type EmploymentStatus,
  type RegistrationRequest,
  type Role,
} from '@/types/domain'
import type { Permission } from '@/types/permissions'

/** Every request, newest first. Requires `registration_requests.view`. */
export async function fetchRequests(): Promise<RegistrationRequest[]> {
  const snap = await getDocs(
    query(collection(getDb(), 'registrationRequests'), orderBy('submittedAt', 'desc')),
  )
  return snap.docs.map((d) => ({ ...(d.data() as RegistrationRequest), id: d.id }))
}

export async function fetchPendingCount(): Promise<number> {
  const snap = await getDocs(
    query(collection(getDb(), 'registrationRequests'), where('status', '==', 'pending')),
  )
  return snap.size
}

export interface ApprovalDecision {
  roleIds: string[]
  positionId: string | null
  departmentId: string | null
  employmentStatus: EmploymentStatus
  startDate: string | null
}

/**
 * Approve an applicant and let them in.
 *
 * The personal details they submitted are filed straight into the privacy
 * tiers using the conservative defaults — contact details start closed, not
 * open. The new employee can widen them later from their own profile.
 */
export async function approveRequest(
  request: RegistrationRequest,
  decision: ApprovalDecision,
  allRoles: Role[],
  actorUid: string,
  employeeCode: string,
): Promise<void> {
  const db = getDb()
  const now = new Date().toISOString()
  const batch = writeBatch(db)

  const chosen = allRoles.filter((role) => decision.roleIds.includes(role.id))
  const grantsAll = chosen.some((role) => role.grantsAll)
  const permissions = [...new Set(chosen.flatMap((role) => role.permissions))] as Permission[]

  const name = `${request.firstName} ${request.lastName}`.trim()

  // 1. Professional profile.
  batch.set(doc(db, 'employees', request.uid), {
    uid: request.uid,
    employeeCode,
    firstName: request.firstName,
    lastName: request.lastName,
    photoUrl: request.photoUrl,
    positionId: decision.positionId,
    departmentId: decision.departmentId,
    roleIds: decision.roleIds,
    status: 'active',
    employmentStatus: decision.employmentStatus,
    managerUid: null,
    responsibilities: '',
    skills: [],
    expertise: [],
    bio: '',
    startDate: decision.startDate,
    dateJoined: now,
    createdAt: now,
    updatedAt: now,
  })

  // 2. Privacy tiers. Defaults keep email and phone away from coworkers.
  const personal = {
    email: request.email,
    phone: request.phone,
    city: request.city,
    country: request.country,
    personalDescription: request.personalDescription,
    languages: [] as string[],
    interests: [] as string[],
  }

  batch.set(doc(db, 'employees', request.uid, 'visibility', 'everyone'), {
    city: personal.city,
    country: personal.country,
    personalDescription: personal.personalDescription,
  })

  batch.set(doc(db, 'employees', request.uid, 'visibility', 'management'), {
    email: personal.email,
    phone: personal.phone,
  })

  batch.set(doc(db, 'employees', request.uid, 'visibility', 'private'), {
    ...personal,
    privacy: DEFAULT_PRIVACY,
    updatedAt: now,
  })

  // 3. Access. This document is what the security rules consult.
  batch.set(doc(db, 'userPermissions', request.uid), {
    uid: request.uid,
    status: 'active',
    isCeo: grantsAll,
    roleIds: decision.roleIds,
    permissions,
    updatedAt: now,
    updatedBy: actorUid,
  })

  // 4. Close the request. Never deleted — it is the record of the decision.
  batch.update(doc(db, 'registrationRequests', request.uid), {
    status: 'approved',
    reviewedBy: actorUid,
    reviewedAt: now,
    rejectionReason: null,
  })

  await batch.commit()

  await logAudit({
    action: 'account.approved',
    targetType: 'user',
    targetId: request.uid,
    targetLabel: name,
    metadata: {
      employeeCode,
      roleIds: decision.roleIds,
      positionId: decision.positionId,
      departmentId: decision.departmentId,
    },
  })
}

/**
 * Turn an applicant away.
 *
 * No employee profile and no permissions document are created, so the account
 * exists in Firebase Auth but reaches nothing. The request is kept, with the
 * reason, because "why was this person turned down" is a question that gets
 * asked months later.
 */
export async function rejectRequest(
  request: RegistrationRequest,
  reason: string,
  actorUid: string,
): Promise<void> {
  const db = getDb()
  const batch = writeBatch(db)

  batch.update(doc(db, 'registrationRequests', request.uid), {
    status: 'rejected',
    reviewedBy: actorUid,
    reviewedAt: new Date().toISOString(),
    rejectionReason: reason.trim() || null,
  })

  await batch.commit()

  await logAudit({
    action: 'account.rejected',
    targetType: 'registration_request',
    targetId: request.uid,
    targetLabel: `${request.firstName} ${request.lastName}`.trim(),
    metadata: { reason: reason.trim() || null },
  })
}

/**
 * Next employee number.
 *
 * Derived from how many employees already exist. Two approvals happening in
 * the same second could collide, which at this scale means the CEO clicking
 * twice in two browser tabs — the code is a label, not a key, so a duplicate
 * is a cosmetic fix rather than data loss. A counter document would be the
 * answer if that ever stops being true.
 */
export function nextEmployeeCode(existingCount: number): string {
  return `MSEE-${String(existingCount + 1).padStart(4, '0')}`
}
