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

  // --- Clients & projects ----------------------------------------------
  CLIENTS_VIEW: 'clients.view',
  CLIENTS_MANAGE: 'clients.manage',
  PROJECTS_VIEW: 'projects.view',
  PROJECTS_MANAGE: 'projects.manage',
  SERVICES_VIEW: 'services.view',
  SERVICES_MANAGE: 'services.manage',

  // --- Money -----------------------------------------------------------
  /**
   * Seeing what the company earns and spends. Separate from managing clients
   * on purpose: an account manager runs the relationship without needing to
   * know the margin on it.
   */
  FINANCE_VIEW: 'finance.view',
  FINANCE_MANAGE: 'finance.manage',
  FINANCE_EXPORT: 'finance.export',

  // --- Sales pipeline ---------------------------------------------------
  LEADS_VIEW: 'leads.view',
  /** Read every lead, not only the ones assigned to you. */
  LEADS_VIEW_ALL: 'leads.view_all',
  LEADS_MANAGE: 'leads.manage',

  SALES_VIEW: 'sales.view',
  SALES_VIEW_ALL: 'sales.view_all',
  SALES_MANAGE: 'sales.manage',

  // --- Contracts --------------------------------------------------------
  CONTRACTS_VIEW: 'contracts.view',
  CONTRACTS_MANAGE: 'contracts.manage',

  // --- Tasks ------------------------------------------------------------
  /** Everybody sees their own; this is the manager's wider view. */
  TASKS_VIEW_ALL: 'tasks.view_all',
  TASKS_MANAGE: 'tasks.manage',

  // --- Affiliate programme ----------------------------------------------
  AFFILIATES_VIEW: 'affiliates.view',
  AFFILIATES_MANAGE: 'affiliates.manage',
  /**
   * Turn an earned commission into one that will be paid. Kept apart from
   * managing affiliates because approving money is not the same job as
   * maintaining a record.
   */
  COMMISSIONS_APPROVE: 'commissions.approve',

  // --- Goals & performance ----------------------------------------------
  GOALS_VIEW: 'goals.view',
  GOALS_MANAGE: 'goals.manage',
  PERFORMANCE_VIEW: 'performance.view',
  /** See other people's numbers. Without it you see only your own. */
  PERFORMANCE_VIEW_ALL: 'performance.view_all',

  // --- Analytics ---------------------------------------------------------
  ANALYTICS_VIEW: 'analytics.view',

  // --- Calendar ----------------------------------------------------------
  CALENDAR_VIEW: 'calendar.view',
  CALENDAR_MANAGE: 'calendar.manage',

  // --- Internal communication --------------------------------------------
  CHAT_USE: 'chat.use',
  CHAT_MANAGE_GROUPS: 'chat.manage_groups',
  ANNOUNCEMENTS_SEND: 'announcements.send',

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
    key: 'business',
    permissions: [
      PERMISSIONS.CLIENTS_VIEW,
      PERMISSIONS.CLIENTS_MANAGE,
      PERMISSIONS.PROJECTS_VIEW,
      PERMISSIONS.PROJECTS_MANAGE,
      PERMISSIONS.SERVICES_VIEW,
      PERMISSIONS.SERVICES_MANAGE,
    ],
  },
  {
    key: 'pipeline',
    permissions: [
      PERMISSIONS.LEADS_VIEW,
      PERMISSIONS.LEADS_VIEW_ALL,
      PERMISSIONS.LEADS_MANAGE,
      PERMISSIONS.SALES_VIEW,
      PERMISSIONS.SALES_VIEW_ALL,
      PERMISSIONS.SALES_MANAGE,
    ],
  },
  {
    key: 'contracts',
    permissions: [PERMISSIONS.CONTRACTS_VIEW, PERMISSIONS.CONTRACTS_MANAGE],
  },
  {
    key: 'tasks',
    permissions: [PERMISSIONS.TASKS_VIEW_ALL, PERMISSIONS.TASKS_MANAGE],
  },
  {
    key: 'affiliates',
    permissions: [
      PERMISSIONS.AFFILIATES_VIEW,
      PERMISSIONS.AFFILIATES_MANAGE,
      PERMISSIONS.COMMISSIONS_APPROVE,
    ],
  },
  {
    key: 'goals',
    permissions: [
      PERMISSIONS.GOALS_VIEW,
      PERMISSIONS.GOALS_MANAGE,
      PERMISSIONS.PERFORMANCE_VIEW,
      PERMISSIONS.PERFORMANCE_VIEW_ALL,
    ],
  },
  {
    key: 'tools',
    permissions: [
      PERMISSIONS.ANALYTICS_VIEW,
      PERMISSIONS.CALENDAR_VIEW,
      PERMISSIONS.CALENDAR_MANAGE,
      PERMISSIONS.CHAT_USE,
      PERMISSIONS.CHAT_MANAGE_GROUPS,
      PERMISSIONS.ANNOUNCEMENTS_SEND,
    ],
  },
  {
    key: 'finance',
    permissions: [
      PERMISSIONS.FINANCE_VIEW,
      PERMISSIONS.FINANCE_MANAGE,
      PERMISSIONS.FINANCE_EXPORT,
    ],
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
  PERMISSIONS.FINANCE_VIEW,
  PERMISSIONS.FINANCE_MANAGE,
  PERMISSIONS.ROLES_ASSIGN,
  PERMISSIONS.ROLES_CREATE,
  PERMISSIONS.ROLES_EDIT,
  PERMISSIONS.NOTES_VIEW,
  PERMISSIONS.NOTES_DELETE,
  PERMISSIONS.EMPLOYEES_VIEW_PRIVATE_INFO,
  PERMISSIONS.SETTINGS_EDIT,
  PERMISSIONS.COMMISSIONS_APPROVE,
  PERMISSIONS.PERFORMANCE_VIEW_ALL,
  PERMISSIONS.ANNOUNCEMENTS_SEND,
]

/** Sensible starting point for a plain employee with no management duties. */
export const DEFAULT_EMPLOYEE_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.EMPLOYEES_VIEW,
  PERMISSIONS.SERVICES_VIEW,
  PERMISSIONS.CALENDAR_VIEW,
  PERMISSIONS.CHAT_USE,
  PERMISSIONS.PERFORMANCE_VIEW,
  PERMISSIONS.GOALS_VIEW,
]
