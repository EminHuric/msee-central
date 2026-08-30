/**
 * MsEe Central — domain model.
 *
 * These types describe the documents stored in Firestore. The layout is
 * deliberately split by sensitivity, because in Firestore a security rule
 * guards a whole document, never a single field. Separating an employee into
 * tiers is what makes "phone visible to management, city private, name public"
 * enforceable rather than merely respected by the UI.
 */

import type { Permission } from './permissions'

/* ------------------------------------------------------------------ *
 * Account status
 * ------------------------------------------------------------------ */

export const ACCOUNT_STATUSES = [
  'pending',
  'active',
  'suspended',
  'rejected',
  'deactivated',
] as const

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

/** Statuses that are allowed past the login gate into the application. */
export const ACCESS_GRANTING_STATUSES: readonly AccountStatus[] = ['active']

export function canAccessApplication(status: AccountStatus): boolean {
  return ACCESS_GRANTING_STATUSES.includes(status)
}

/* ------------------------------------------------------------------ *
 * Privacy
 * ------------------------------------------------------------------ */

/**
 * Where a personal field is stored, which decides who can read it.
 * These map one-to-one onto the visibility subdocuments in Firestore.
 */
export const VISIBILITY_LEVELS = ['everyone', 'management', 'private'] as const
export type Visibility = (typeof VISIBILITY_LEVELS)[number]

/** Personal fields an employee controls the visibility of. */
export const PRIVACY_CONTROLLED_FIELDS = [
  'email',
  'phone',
  'city',
  'country',
  'personalDescription',
  'languages',
  'interests',
] as const

export type PrivacyControlledField = (typeof PRIVACY_CONTROLLED_FIELDS)[number]

export type PrivacySettings = Record<PrivacyControlledField, Visibility>

/**
 * What a new employee gets before they touch the settings page.
 * Deliberately conservative: contact details start closed, not open.
 */
export const DEFAULT_PRIVACY: PrivacySettings = {
  email: 'management',
  phone: 'management',
  city: 'everyone',
  country: 'everyone',
  personalDescription: 'everyone',
  languages: 'everyone',
  interests: 'everyone',
}

/* ------------------------------------------------------------------ *
 * Employee
 * ------------------------------------------------------------------ */

/**
 * Tier 1 — `employees/{uid}`.
 *
 * Professional identity. Readable by any active employee holding
 * `employees.view`. Per the specification an employee cannot hide these from
 * coworkers; they describe the job, not the person.
 */
export interface EmployeePublic {
  uid: string
  employeeCode: string
  firstName: string
  lastName: string
  photoUrl: string | null
  positionId: string | null
  departmentId: string | null
  roleIds: string[]
  status: AccountStatus
  employmentStatus: EmploymentStatus
  managerUid: string | null
  responsibilities: string
  skills: string[]
  expertise: string[]
  bio: string
  startDate: string | null
  dateJoined: string
  createdAt: string
  updatedAt: string
}

/**
 * Tier 2 — `employees/{uid}/visibility/everyone`.
 * Personal fields the employee chose to share with all coworkers.
 */
export interface EmployeeVisibleToEveryone {
  email?: string
  phone?: string
  city?: string
  country?: string
  personalDescription?: string
  languages?: string[]
  interests?: string[]
}

/**
 * Tier 3 — `employees/{uid}/visibility/management`.
 * Readable by the employee, and by holders of `employees.view_private_info`.
 */
export type EmployeeVisibleToManagement = EmployeeVisibleToEveryone

/**
 * Tier 4 — `employees/{uid}/visibility/private`.
 *
 * Readable by the employee and by the CEO only. The CEO is included because
 * the specification requires that company administration is never blocked by
 * an employee's privacy choices.
 */
export interface EmployeePrivate extends EmployeeVisibleToEveryone {
  /** Authoritative copy of every personal field, whatever the tier. */
  privacy: PrivacySettings
}

/** An employee profile assembled from whichever tiers the viewer could read. */
export interface EmployeeView extends EmployeePublic {
  email: string | null
  phone: string | null
  city: string | null
  country: string | null
  personalDescription: string | null
  languages: string[]
  interests: string[]
  /** Fields the viewer was not allowed to read, for an honest "hidden" label. */
  hiddenFields: PrivacyControlledField[]
}

export const EMPLOYMENT_STATUSES = [
  'full_time',
  'part_time',
  'contractor',
  'intern',
  'former',
] as const

export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number]

/* ------------------------------------------------------------------ *
 * Access control
 * ------------------------------------------------------------------ */

/**
 * `userPermissions/{uid}` — the crown jewel.
 *
 * A flattened copy of everything the user is allowed to do, so a security rule
 * can answer "may they?" with one document read instead of walking roles.
 *
 * Writable ONLY by a holder of `roles.assign`, and never by the user
 * themselves — not even the CEO edits their own. That single rule is what
 * stops an employee from promoting themselves, so it is the most important
 * rule in the project.
 */
export interface UserPermissions {
  uid: string
  status: AccountStatus
  /** Owner: full authority over everything. CEO and any co-owner they appoint. */
  isCeo: boolean
  /**
   * The founder — the person who owns the company.
   *
   * Exactly one account carries this, set once by tools/setup-ceo.mjs and
   * never grantable from inside the application. It means two things:
   *
   *   - nobody, not even another owner, may alter this account;
   *   - only this account may appoint or remove co-owners.
   *
   * The cost is stated plainly: if this account is lost there is no recovery
   * from inside the app. tools/serviceAccount.json is the only way back, which
   * is why that file matters as much as the password.
   */
  isFounder: boolean
  roleIds: string[]
  /** Union of the permissions of every assigned role. */
  permissions: Permission[]
  updatedAt: string
  updatedBy: string
}

export interface Role {
  id: string
  /** Stable machine key, e.g. `ceo`. Never renamed once created. */
  key: string
  name: string
  nameSr: string
  description: string
  descriptionSr: string
  permissions: Permission[]
  /** System roles cannot be deleted or stripped of their permissions. */
  isSystem: boolean
  /** The CEO role: holds every permission, present and future. */
  grantsAll: boolean
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

export interface Department {
  id: string
  name: string
  nameSr: string
  description: string
  status: 'active' | 'inactive'
  createdAt: string
}

export interface Position {
  id: string
  title: string
  titleSr: string
  departmentId: string | null
  description: string
  status: 'active' | 'inactive'
  createdAt: string
}

/* ------------------------------------------------------------------ *
 * Registration
 * ------------------------------------------------------------------ */

export type RegistrationStatus = 'pending' | 'approved' | 'rejected'

export interface RegistrationRequest {
  id: string
  /** Firebase Auth uid — the account exists but is not yet allowed in. */
  uid: string
  firstName: string
  lastName: string
  email: string
  phone: string
  country: string
  city: string
  photoUrl: string | null
  personalDescription: string
  desiredPosition: string
  additionalInfo: string
  termsAcceptedAt: string
  status: RegistrationStatus
  submittedAt: string
  reviewedBy: string | null
  reviewedAt: string | null
  rejectionReason: string | null
}

/* ------------------------------------------------------------------ *
 * CEO notes
 * ------------------------------------------------------------------ */

export const NOTE_CATEGORIES = [
  'performance',
  'strength',
  'improvement',
  'warning',
  'disciplinary',
  'recognition',
  'general',
] as const

export type NoteCategory = (typeof NOTE_CATEGORIES)[number]

/** `employees/{uid}/notes/{noteId}` — never readable by the subject. */
export interface EmployeeNote {
  id: string
  employeeUid: string
  category: NoteCategory
  content: string
  authorUid: string
  authorName: string
  createdAt: string
  updatedAt: string
}

/* ------------------------------------------------------------------ *
 * Audit
 * ------------------------------------------------------------------ */

export const AUDIT_ACTIONS = [
  'registration.submitted',
  'account.approved',
  'account.rejected',
  'account.suspended',
  'account.activated',
  'account.deactivated',
  'role.created',
  'role.updated',
  'role.deactivated',
  'role.assigned',
  'permissions.changed',
  'position.changed',
  'department.changed',
  'profile.updated',
  'privacy.changed',
  'note.created',
  'note.updated',
  'note.deleted',
  'auth.login',
  'auth.login_failed',
  'settings.updated',
  'data.exported',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export type AuditTargetType =
  | 'user'
  | 'role'
  | 'note'
  | 'registration_request'
  | 'department'
  | 'position'
  | 'settings'

export interface AuditLogEntry {
  id: string
  actorUid: string
  /** Snapshot: the log must stay readable after an account is removed. */
  actorEmail: string
  actorName: string
  action: AuditAction
  targetType: AuditTargetType
  targetId: string
  targetLabel: string
  metadata: Record<string, unknown>
  createdAt: string
}

/* ------------------------------------------------------------------ *
 * Company & external systems
 * ------------------------------------------------------------------ */

export interface CompanySettings {
  companyName: string
  legalName: string
  defaultLocale: 'sr' | 'en'
  registrationOpen: boolean
  /** Domains allowed to register, empty means any. */
  allowedEmailDomains: string[]
  updatedAt: string
  updatedBy: string
}

/**
 * Prepared for future integrations (StayBrain first) and unused in v1.
 *
 * MsEe Central stays the internal company system; StayBrain stays the
 * client-facing one. They are joined by an identifier, never by sharing a
 * database.
 */
export interface ExternalReference {
  id: string
  system: 'staybrain'
  /** Stable public identifier for an MsEe client. */
  clientId: string
  localType: 'user' | 'department'
  localId: string
  externalId: string
  createdAt: string
}
