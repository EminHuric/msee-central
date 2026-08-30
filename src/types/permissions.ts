/**
 * MsEe Central — permission catalogue.
 *
 * This is the single source of truth for what can be authorised in the system.
 * Every permission is `resource.action`. Adding a future module (CRM, finance,
 * projects) means adding its keys here and nothing else changes structurally.
 *
 * IMPORTANT: these keys are mirrored in firebase/firestore.rules. If you add a
 * permission that guards stored data, add the matching rule there too — the
 * rules are the real security boundary, this file only drives the UI.
 */

export const PERMISSIONS = {
  // --- Employees ------------------------------------------------------
  EMPLOYEES_VIEW: 'employees.view',
  EMPLOYEES_VIEW_ALL: 'employees.view_all',
  EMPLOYEES_EDIT_PROFESSIONAL: 'employees.edit_professional',
  EMPLOYEES_MANAGE_STATUS: 'employees.manage_status',
  EMPLOYEES_EXPORT: 'employees.export',

  /**
   * Read contact details an employee marked "visible to management".
   * This is the line between a coworker and a manager.
   */
  EMPLOYEES_VIEW_PRIVATE_INFO: 'employees.view_private_info',

  // --- Registration requests ------------------------------------------
  REQUESTS_VIEW: 'registration_requests.view',
  REQUESTS_APPROVE: 'registration_requests.approve',
  REQUESTS_REJECT: 'registration_requests.reject',

  // --- Roles & permissions --------------------------------------------
  ROLES_VIEW: 'roles.view',
  ROLES_CREATE: 'roles.create',
  ROLES_EDIT: 'roles.edit',
  ROLES_DEACTIVATE: 'roles.deactivate',

  /**
   * Assign roles to people. Whoever holds this can grant themselves anything,
   * so it belongs to the CEO and to nobody else by default.
   */
  ROLES_ASSIGN: 'roles.assign',

  // --- Organisation ----------------------------------------------------
  DEPARTMENTS_MANAGE: 'departments.manage',
  POSITIONS_MANAGE: 'positions.manage',

  // --- CEO private notes -----------------------------------------------
  NOTES_VIEW: 'employee_notes.view',
  NOTES_CREATE: 'employee_notes.create',
  NOTES_EDIT: 'employee_notes.edit',
  NOTES_DELETE: 'employee_notes.delete',

  // --- Audit -----------------------------------------------------------
  AUDIT_VIEW: 'audit_log.view',
  AUDIT_EXPORT: 'audit_log.export',

  // --- Company ---------------------------------------------------------
  SETTINGS_VIEW: 'company_settings.view',
  SETTINGS_EDIT: 'company_settings.edit',
} as const

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS]

/** Every permission key, for iteration in the role editor. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS)

/**
 * Grouping used to render the role editor. Purely presentational — security
 * never depends on this shape.
 */
export const PERMISSION_GROUPS = [
  {
    key: 'employees',
    permissions: [
      PERMISSIONS.EMPLOYEES_VIEW,
      PERMISSIONS.EMPLOYEES_VIEW_ALL,
      PERMISSIONS.EMPLOYEES_VIEW_PRIVATE_INFO,
      PERMISSIONS.EMPLOYEES_EDIT_PROFESSIONAL,
      PERMISSIONS.EMPLOYEES_MANAGE_STATUS,
      PERMISSIONS.EMPLOYEES_EXPORT,
    ],
  },
  {
    key: 'requests',
    permissions: [
      PERMISSIONS.REQUESTS_VIEW,
      PERMISSIONS.REQUESTS_APPROVE,
      PERMISSIONS.REQUESTS_REJECT,
    ],
  },
  {
    key: 'roles',
    permissions: [
      PERMISSIONS.ROLES_VIEW,
      PERMISSIONS.ROLES_CREATE,
      PERMISSIONS.ROLES_EDIT,
      PERMISSIONS.ROLES_DEACTIVATE,
      PERMISSIONS.ROLES_ASSIGN,
    ],
  },
  {
    key: 'organisation',
    permissions: [PERMISSIONS.DEPARTMENTS_MANAGE, PERMISSIONS.POSITIONS_MANAGE],
  },
  {
    key: 'notes',
    permissions: [
      PERMISSIONS.NOTES_VIEW,
      PERMISSIONS.NOTES_CREATE,
      PERMISSIONS.NOTES_EDIT,
      PERMISSIONS.NOTES_DELETE,
    ],
  },
  {
    key: 'audit',
    permissions: [PERMISSIONS.AUDIT_VIEW, PERMISSIONS.AUDIT_EXPORT],
  },
  {
    key: 'settings',
    permissions: [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_EDIT],
  },
] as const satisfies readonly { key: string; permissions: readonly Permission[] }[]

/**
 * Permissions that let the holder expand their own authority. Shown with a
 * warning in the role editor so nobody hands them out by accident.
 */
export const SENSITIVE_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.ROLES_ASSIGN,
  PERMISSIONS.ROLES_CREATE,
  PERMISSIONS.ROLES_EDIT,
  PERMISSIONS.NOTES_VIEW,
  PERMISSIONS.NOTES_DELETE,
  PERMISSIONS.EMPLOYEES_VIEW_PRIVATE_INFO,
  PERMISSIONS.SETTINGS_EDIT,
]

/** Sensible starting point for a plain employee with no management duties. */
export const DEFAULT_EMPLOYEE_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.EMPLOYEES_VIEW,
]
