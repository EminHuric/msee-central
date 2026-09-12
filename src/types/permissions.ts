/**
 * MsEe Central — permission catalogue.
 *
 * The single source of truth for what can be authorised. Every permission is
 * `resource.action`, and the actions are deliberately granular: `view`,
 * `create`, `edit`, `delete`, `manage`, `approve`, `export`. "Can access
 * Finance" is not a permission anybody can reason about — "may see finance,
 * may record a payment, may not delete one" is.
 *
 * Two dimensions run through the list and are easy to miss:
 *
 *   `view` versus `view_all` — the difference between an employee and their
 *   manager. Without `view_all` you read only records you own, and that filter
 *   lives in firestore.rules, not in a query somebody could edit out.
 *
 *   `delete` versus `purge` — deleting moves a record to the recycle bin and
 *   is ordinary; destroying it for good is a separate authority.
 *
 * IMPORTANT: these keys are mirrored in firebase/firestore.rules. A permission
 * that guards stored data needs its rule there too — the rules are the real
 * boundary, this file only drives the interface.
 */

export const PERMISSIONS = {
  // --- Clients ---------------------------------------------------------
  CLIENTS_VIEW: 'clients.view',
  CLIENTS_VIEW_ALL: 'clients.view_all',
  CLIENTS_CREATE: 'clients.create',
  CLIENTS_EDIT: 'clients.edit',
  CLIENTS_DELETE: 'clients.delete',
  CLIENTS_EXPORT: 'clients.export',

  // --- Leads -----------------------------------------------------------
  LEADS_VIEW: 'leads.view',
  LEADS_VIEW_ALL: 'leads.view_all',
  LEADS_CREATE: 'leads.create',
  LEADS_EDIT: 'leads.edit',
  LEADS_DELETE: 'leads.delete',
  LEADS_ASSIGN: 'leads.assign',

  // --- Projects --------------------------------------------------------
  PROJECTS_VIEW: 'projects.view',
  PROJECTS_VIEW_ALL: 'projects.view_all',
  PROJECTS_CREATE: 'projects.create',
  PROJECTS_EDIT: 'projects.edit',
  PROJECTS_DELETE: 'projects.delete',

  // --- Sales -----------------------------------------------------------
  SALES_VIEW: 'sales.view',
  SALES_VIEW_ALL: 'sales.view_all',
  SALES_CREATE: 'sales.create',
  SALES_EDIT: 'sales.edit',
  SALES_DELETE: 'sales.delete',
  SALES_EXPORT: 'sales.export',

  // --- StayBrain --------------------------------------------------------
  /*
   * Selling stays for properties that live in somebody else's RMS.
   *
   * Four permissions because four different jobs touch this: seeing the
   * properties, placing a booking in one, seeing what the company earns on them,
   * and agreeing the terms. The third and fourth are the money ones, and they
   * are the reason this is not one `staybrain.access`: somebody can sell stays
   * all day without being shown the commission on them.
   */
  STAYBRAIN_VIEW: 'staybrain.view',
  STAYBRAIN_CREATE_RESERVATION: 'staybrain.create_reservation',
  STAYBRAIN_VIEW_REVENUE: 'staybrain.view_revenue',
  STAYBRAIN_MANAGE: 'staybrain.manage',

  // --- Reservations -----------------------------------------------------
  /*
   * Bookings we brought a client, and therefore our own contribution.
   *
   * Separate from `clients` because the two authorities are genuinely
   * different: somebody who books guests all day has no business editing the
   * client's contract, and whoever negotiates the contract does not need to
   * enter bookings. `view_all` is what separates an employee who sees the
   * bookings they brought from a manager who sees everybody's.
   */
  RESERVATIONS_VIEW: 'reservations.view',
  RESERVATIONS_VIEW_ALL: 'reservations.view_all',
  RESERVATIONS_CREATE: 'reservations.create',
  RESERVATIONS_EDIT: 'reservations.edit',
  RESERVATIONS_DELETE: 'reservations.delete',

  // --- Services --------------------------------------------------------
  SERVICES_VIEW: 'services.view',
  /*
   * Seeing a service and seeing its price are separate decisions.
   *
   * A salesperson needs the catalogue to sell from; they do not need the
   * margin, the internal cost, or the commission rule. Splitting these is what
   * lets somebody sell a service without being shown what the company makes
   * on it — and the split has to be real, which means the value never reaches
   * the browser rather than being hidden once it has.
   */
  SERVICES_VIEW_PRICE: 'services.view_price',
  SERVICES_MANAGE: 'services.manage',

  // --- Affiliate programme ----------------------------------------------
  AFFILIATES_VIEW: 'affiliates.view',
  AFFILIATES_MANAGE: 'affiliates.manage',
  /**
   * Turn an earned commission into one that will be paid. Separate from
   * managing affiliates because approving money is not the same job as
   * maintaining a record — and nobody may approve their own.
   */
  COMMISSIONS_APPROVE: 'commissions.approve',

  // --- Finance ----------------------------------------------------------
  /**
   * Seeing what the company earns and spends. Separate from managing clients
   * on purpose: an account manager runs the relationship without needing to
   * know the margin on it.
   */
  FINANCE_VIEW: 'finance.view',
  FINANCE_CREATE: 'finance.create',
  FINANCE_EDIT: 'finance.edit',
  FINANCE_DELETE: 'finance.delete',
  FINANCE_EXPORT: 'finance.export',

  // --- Employees --------------------------------------------------------
  EMPLOYEES_VIEW: 'employees.view',
  /*
   * Make somebody an account. Held with `roles.assign`, because creating a
   * person without deciding what they may do produces an account that cannot
   * be used, and the rules refuse the second write without it anyway.
   */
  EMPLOYEES_CREATE: 'employees.create',
  EMPLOYEES_VIEW_ALL: 'employees.view_all',
  EMPLOYEES_EDIT_PROFESSIONAL: 'employees.edit_professional',
  EMPLOYEES_MANAGE_STATUS: 'employees.manage_status',
  EMPLOYEES_EXPORT: 'employees.export',
  /**
   * Read contact details an employee marked "visible to management".
   * This is the line between a coworker and a manager.
   */
  EMPLOYEES_VIEW_PRIVATE_INFO: 'employees.view_private_info',

  // --- Earnings ---------------------------------------------------------
  /** Everybody sees their own earnings; this is the wider view. */
  EARNINGS_VIEW_ALL: 'earnings.view_all',

  // --- The employee earnings ledger -------------------------------------
  /** Read your own ledger. Everybody who earns anything needs this. */
  WALLET_VIEW_OWN: 'wallet.view_own',
  /** Read anybody's. What one person is paid is theirs until this is granted. */
  WALLET_VIEW_ALL: 'wallet.view_all',
  /** Add to somebody's ledger, approve an entry, record a payout. */
  WALLET_ADJUST: 'wallet.adjust',

  // --- Goals & performance ----------------------------------------------
  GOALS_VIEW: 'goals.view',
  GOALS_MANAGE: 'goals.manage',
  /*
   * Set yourself a target.
   *
   * Separate from `goals.manage` on purpose: a personal goal is somebody
   * deciding to call twenty people this week, and it must not become a company
   * KPI or move anybody's performance figures by being created.
   */
  GOALS_CREATE_PERSONAL: 'goals.create_personal',
  PERFORMANCE_VIEW: 'performance.view',
  /** See other people's numbers. Without it you see only your own. */
  PERFORMANCE_VIEW_ALL: 'performance.view_all',

  // --- Bonuses ----------------------------------------------------------
  BONUSES_VIEW: 'bonuses.view',
  BONUSES_VIEW_ALL: 'bonuses.view_all',
  BONUSES_MANAGE: 'bonuses.manage',
  /** The act that turns an earned bonus into one the company will pay. */
  BONUSES_APPROVE: 'bonuses.approve',

  // --- Analytics --------------------------------------------------------
  ANALYTICS_VIEW: 'analytics.view',

  // --- Calendar ---------------------------------------------------------
  CALENDAR_VIEW: 'calendar.view',
  CALENDAR_MANAGE: 'calendar.manage',

  // --- Announcements ----------------------------------------------------
  ANNOUNCEMENTS_SEND: 'announcements.send',


  // --- Roles & permissions ----------------------------------------------
  ROLES_VIEW: 'roles.view',
  ROLES_CREATE: 'roles.create',
  ROLES_EDIT: 'roles.edit',
  ROLES_DEACTIVATE: 'roles.deactivate',
  /**
   * Assign roles to people. Whoever holds this can grant themselves anything,
   * so it belongs to the CEO and to nobody else by default.
   */
  ROLES_ASSIGN: 'roles.assign',

  // --- Organisation ------------------------------------------------------
  DEPARTMENTS_MANAGE: 'departments.manage',
  POSITIONS_MANAGE: 'positions.manage',

  // --- Custom fields -----------------------------------------------------
  FIELDS_MANAGE: 'custom_fields.manage',

  // --- Recycle bin -------------------------------------------------------
  /** Restore something somebody deleted. */
  RECYCLE_VIEW: 'recycle_bin.view',
  RECYCLE_RESTORE: 'recycle_bin.restore',
  /** Destroy a record for good. Deliberately its own authority. */
  RECYCLE_PURGE: 'recycle_bin.purge',

  // --- CEO private notes --------------------------------------------------
  NOTES_VIEW: 'employee_notes.view',
  NOTES_CREATE: 'employee_notes.create',
  NOTES_EDIT: 'employee_notes.edit',
  NOTES_DELETE: 'employee_notes.delete',

  // --- Audit --------------------------------------------------------------
  AUDIT_VIEW: 'audit_log.view',
  AUDIT_EXPORT: 'audit_log.export',

  // --- Company ------------------------------------------------------------
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
    key: 'clients',
    permissions: [
      PERMISSIONS.CLIENTS_VIEW,
      PERMISSIONS.CLIENTS_VIEW_ALL,
      PERMISSIONS.CLIENTS_CREATE,
      PERMISSIONS.CLIENTS_EDIT,
      PERMISSIONS.CLIENTS_DELETE,
      PERMISSIONS.CLIENTS_EXPORT,
    ],
  },
  {
    key: 'leads',
    permissions: [
      PERMISSIONS.LEADS_VIEW,
      PERMISSIONS.LEADS_VIEW_ALL,
      PERMISSIONS.LEADS_CREATE,
      PERMISSIONS.LEADS_EDIT,
      PERMISSIONS.LEADS_DELETE,
      PERMISSIONS.LEADS_ASSIGN,
    ],
  },
  {
    key: 'projects',
    permissions: [
      PERMISSIONS.PROJECTS_VIEW,
      PERMISSIONS.PROJECTS_VIEW_ALL,
      PERMISSIONS.PROJECTS_CREATE,
      PERMISSIONS.PROJECTS_EDIT,
      PERMISSIONS.PROJECTS_DELETE,
    ],
  },
  {
    key: 'sales',
    permissions: [
      PERMISSIONS.SALES_VIEW,
      PERMISSIONS.SALES_VIEW_ALL,
      PERMISSIONS.SALES_CREATE,
      PERMISSIONS.SALES_EDIT,
      PERMISSIONS.SALES_DELETE,
      PERMISSIONS.SALES_EXPORT,
    ],
  },
  {
    key: 'staybrain',
    permissions: [
      PERMISSIONS.STAYBRAIN_VIEW,
      PERMISSIONS.STAYBRAIN_CREATE_RESERVATION,
      PERMISSIONS.STAYBRAIN_VIEW_REVENUE,
      PERMISSIONS.STAYBRAIN_MANAGE,
    ],
  },
  {
    key: 'reservations',
    permissions: [
      PERMISSIONS.RESERVATIONS_VIEW,
      PERMISSIONS.RESERVATIONS_VIEW_ALL,
      PERMISSIONS.RESERVATIONS_CREATE,
      PERMISSIONS.RESERVATIONS_EDIT,
      PERMISSIONS.RESERVATIONS_DELETE,
    ],
  },
  {
    key: 'services',
    permissions: [
      PERMISSIONS.SERVICES_VIEW,
      PERMISSIONS.SERVICES_VIEW_PRICE,
      PERMISSIONS.SERVICES_MANAGE,
    ],
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
    key: 'finance',
    permissions: [
      PERMISSIONS.FINANCE_VIEW,
      PERMISSIONS.FINANCE_CREATE,
      PERMISSIONS.FINANCE_EDIT,
      PERMISSIONS.FINANCE_DELETE,
      PERMISSIONS.FINANCE_EXPORT,
    ],
  },
  {
    key: 'wallet',
    permissions: [
      PERMISSIONS.WALLET_VIEW_OWN,
      PERMISSIONS.WALLET_VIEW_ALL,
      PERMISSIONS.WALLET_ADJUST,
    ],
  },
  {
    key: 'employees',
    permissions: [
      PERMISSIONS.EMPLOYEES_VIEW,
      PERMISSIONS.EMPLOYEES_VIEW_ALL,
      PERMISSIONS.EMPLOYEES_CREATE,
      PERMISSIONS.EMPLOYEES_VIEW_PRIVATE_INFO,
      PERMISSIONS.EMPLOYEES_EDIT_PROFESSIONAL,
      PERMISSIONS.EMPLOYEES_MANAGE_STATUS,
      PERMISSIONS.EMPLOYEES_EXPORT,
      PERMISSIONS.EARNINGS_VIEW_ALL,
    ],
  },
  {
    key: 'goals',
    permissions: [
      PERMISSIONS.GOALS_VIEW,
      PERMISSIONS.GOALS_CREATE_PERSONAL,
      PERMISSIONS.GOALS_MANAGE,
      PERMISSIONS.PERFORMANCE_VIEW,
      PERMISSIONS.PERFORMANCE_VIEW_ALL,
    ],
  },
  {
    key: 'bonuses',
    permissions: [
      PERMISSIONS.BONUSES_VIEW,
      PERMISSIONS.BONUSES_VIEW_ALL,
      PERMISSIONS.BONUSES_MANAGE,
      PERMISSIONS.BONUSES_APPROVE,
    ],
  },
  {
    key: 'tools',
    permissions: [
      PERMISSIONS.ANALYTICS_VIEW,
      PERMISSIONS.CALENDAR_VIEW,
      PERMISSIONS.CALENDAR_MANAGE,
      PERMISSIONS.ANNOUNCEMENTS_SEND,
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
    permissions: [
      PERMISSIONS.DEPARTMENTS_MANAGE,
      PERMISSIONS.POSITIONS_MANAGE,
      PERMISSIONS.FIELDS_MANAGE,
    ],
  },
  {
    key: 'recycle',
    permissions: [
      PERMISSIONS.RECYCLE_VIEW,
      PERMISSIONS.RECYCLE_RESTORE,
      PERMISSIONS.RECYCLE_PURGE,
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
 * Permissions that let the holder expand their own authority, reach money, or
 * read something private. Shown with a warning in the role editor so nobody
 * hands one out by accident.
 */
export const SENSITIVE_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.FINANCE_VIEW,
  PERMISSIONS.FINANCE_CREATE,
  PERMISSIONS.FINANCE_EDIT,
  PERMISSIONS.FINANCE_DELETE,
  PERMISSIONS.ROLES_ASSIGN,
  PERMISSIONS.ROLES_CREATE,
  PERMISSIONS.ROLES_EDIT,
  PERMISSIONS.NOTES_VIEW,
  PERMISSIONS.NOTES_DELETE,
  PERMISSIONS.EMPLOYEES_VIEW_PRIVATE_INFO,
  PERMISSIONS.EARNINGS_VIEW_ALL,
  PERMISSIONS.SETTINGS_EDIT,
  PERMISSIONS.COMMISSIONS_APPROVE,
  PERMISSIONS.BONUSES_APPROVE,
  PERMISSIONS.PERFORMANCE_VIEW_ALL,
  PERMISSIONS.ANNOUNCEMENTS_SEND,
  PERMISSIONS.RECYCLE_PURGE,
]

/**
 * Sensible starting point for a plain employee with no management duties.
 *
 * Enough to do a job on day one: see colleagues and the price list, work their
 * own leads and clients, keep a calendar, and watch their own numbers.
 */
export const DEFAULT_EMPLOYEE_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.EMPLOYEES_VIEW,
  PERMISSIONS.SERVICES_VIEW,
  PERMISSIONS.CLIENTS_VIEW,
  PERMISSIONS.LEADS_VIEW,
  PERMISSIONS.LEADS_CREATE,
  PERMISSIONS.LEADS_EDIT,
  PERMISSIONS.PROJECTS_VIEW,
  PERMISSIONS.SALES_VIEW,
  PERMISSIONS.CALENDAR_VIEW,
  PERMISSIONS.CALENDAR_MANAGE,
  PERMISSIONS.GOALS_VIEW,
  PERMISSIONS.PERFORMANCE_VIEW,
  PERMISSIONS.BONUSES_VIEW,
]

/**
 * What an outside affiliate partner gets.
 *
 * They submit leads and watch what happens to them. Everything else is refused
 * by `isInternal()` in the rules regardless of what is listed here — this only
 * decides which screens they are offered.
 */
export const DEFAULT_AFFILIATE_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.LEADS_VIEW,
  PERMISSIONS.LEADS_CREATE,
]
