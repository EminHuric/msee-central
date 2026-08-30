/**
 * Creating an employee account directly, without them registering first.
 *
 * THE PROBLEM THIS SOLVES
 *
 * `createUserWithEmailAndPassword` signs the browser in as the account it just
 * made. Called normally, the CEO would create an employee and immediately find
 * themselves logged in as that employee — their own session gone.
 *
 * So the account is created through a SECOND, short-lived Firebase app
 * instance. Firebase keys its stored session by app name, and this one is told
 * to keep its session in memory only, so it never touches the CEO's login. The
 * instance is destroyed as soon as the work is finished.
 *
 * The profile and permission documents are then written from the CEO's own
 * session, so the security rules see the CEO doing it — which is the whole
 * point, since only somebody holding roles.assign may create an access
 * document for another person.
 */

import { deleteApp, initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  inMemoryPersistence,
  sendPasswordResetEmail,
  setPersistence,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { doc, writeBatch } from 'firebase/firestore'

import { logAudit } from './audit'
import { firebaseConfig, getDb } from '@/lib/firebase'
import {
  DEFAULT_PRIVACY,
  type AccountType,
  type EmploymentStatus,
  type Role,
} from '@/types/domain'
import type { Permission } from '@/types/permissions'

export interface NewEmployeeInput {
  /** Staff, or an outside partner who only ever sees their own figures. */
  accountType: AccountType
  firstName: string
  lastName: string
  email: string
  password: string
  phone: string
  city: string
  country: string
  roleIds: string[]
  positionId: string | null
  departmentId: string | null
  employmentStatus: EmploymentStatus
  startDate: string | null
  /** Email the person a link so they choose their own password immediately. */
  sendPasswordReset: boolean
}

export class AccountExistsError extends Error {
  constructor() {
    super('An account with that email already exists.')
    this.name = 'AccountExistsError'
  }
}

/**
 * Create the account, the profile and the access document.
 *
 * If any of the document writes fail, the freshly created login is removed
 * again. Without that, a failure would leave credentials that work but reach
 * nothing, and no request for anybody to act on — the worst of both states.
 */
export async function createEmployeeAccount(
  input: NewEmployeeInput,
  allRoles: Role[],
  actorUid: string,
  employeeCode: string,
): Promise<string> {
  const fullName = `${input.firstName} ${input.lastName}`.trim()

  const secondary = initializeApp(firebaseConfig, `provision-${Date.now()}`)
  const secondaryAuth = getAuth(secondary)

  // Never persist this session: it must not survive a refresh, and it must not
  // collide with the CEO's own stored login.
  await setPersistence(secondaryAuth, inMemoryPersistence)

  let created
  try {
    created = await createUserWithEmailAndPassword(
      secondaryAuth,
      input.email.trim(),
      input.password,
    )
  } catch (error) {
    await deleteApp(secondary)
    if ((error as { code?: string }).code === 'auth/email-already-in-use') {
      throw new AccountExistsError()
    }
    throw error
  }

  const uid = created.user.uid

  try {
    await updateProfile(created.user, { displayName: fullName })
    await writeEmployeeDocuments(input, allRoles, actorUid, employeeCode, uid)

    if (input.sendPasswordReset) {
      // Sent from the secondary instance so the CEO's session is untouched.
      await sendPasswordResetEmail(secondaryAuth, input.email.trim())
    }
  } catch (error) {
    // Roll the login back so no orphaned credentials are left behind.
    try {
      await deleteUser(created.user)
    } catch {
      // Deleting can fail if the token has already expired. The account then
      // exists with no access at all, which the Employees screen reports.
    }
    throw error
  } finally {
    await signOut(secondaryAuth).catch(() => {})
    await deleteApp(secondary)
  }

  await logAudit({
    action: 'account.approved',
    targetType: 'user',
    targetId: uid,
    targetLabel: fullName,
    metadata: {
      employeeCode,
      createdDirectly: true,
      roleIds: input.roleIds,
      passwordResetSent: input.sendPasswordReset,
    },
  })

  return uid
}

/**
 * Everything except the login, written from the CEO's session in one batch.
 *
 * Contact details go straight to the management tier rather than the public
 * one: the employee has not chosen their privacy settings yet, and defaulting
 * to open would publish a phone number nobody agreed to share.
 */
async function writeEmployeeDocuments(
  input: NewEmployeeInput,
  allRoles: Role[],
  actorUid: string,
  employeeCode: string,
  uid: string,
): Promise<void> {
  const db = getDb()
  const now = new Date().toISOString()
  const batch = writeBatch(db)

  const chosen = allRoles.filter((role) => input.roleIds.includes(role.id))
  const grantsAll = chosen.some((role) => role.grantsAll)
  const permissions = [...new Set(chosen.flatMap((role) => role.permissions))] as Permission[]

  batch.set(doc(db, 'employees', uid), {
    uid,
    accountType: input.accountType,
    employeeCode,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    photoUrl: null,
    positionId: input.positionId,
    departmentId: input.departmentId,
    roleIds: input.roleIds,
    status: 'active',
    employmentStatus: input.employmentStatus,
    managerUid: null,
    responsibilities: '',
    skills: [],
    expertise: [],
    bio: '',
    startDate: input.startDate,
    dateJoined: now,
    createdAt: now,
    updatedAt: now,
  })

  const personal = {
    email: input.email.trim(),
    phone: input.phone.trim(),
    city: input.city.trim(),
    country: input.country.trim(),
    personalDescription: '',
    languages: [] as string[],
    interests: [] as string[],
  }

  batch.set(doc(db, 'employees', uid, 'visibility', 'everyone'), {
    city: personal.city,
    country: personal.country,
  })

  batch.set(doc(db, 'employees', uid, 'visibility', 'management'), {
    email: personal.email,
    phone: personal.phone,
  })

  batch.set(doc(db, 'employees', uid, 'visibility', 'private'), {
    ...personal,
    privacy: DEFAULT_PRIVACY,
    updatedAt: now,
  })

  batch.set(doc(db, 'userPermissions', uid), {
    uid,
    status: 'active',
    accountType: input.accountType,
    isCeo: grantsAll,
    roleIds: input.roleIds,
    permissions,
    updatedAt: now,
    updatedBy: actorUid,
  })

  await batch.commit()
}

/**
 * A readable temporary password.
 *
 * Deliberately not a random character soup: this gets read aloud or typed from
 * a note, and an unreadable password just gets written on a sticker. Length
 * carries the strength instead, and the person is told to change it.
 */
export function suggestPassword(): string {
  const words = [
    'orange', 'harbor', 'signal', 'meadow', 'cobalt', 'lantern',
    'summit', 'copper', 'falcon', 'velvet', 'quartz', 'ember',
  ]
  const pick = () => {
    const index = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
    return words[index % words.length] ?? 'msee'
  }
  const digits = (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 100
  return `${pick()}-${pick()}-${pick()}-${String(digits).padStart(2, '0')}`
}
