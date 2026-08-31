/**
 * English message catalogue.
 *
 * This file is the reference: Serbian mirrors its shape exactly. Never write a
 * user-facing string inside a component — add it here and translate it in
 * sr.ts, otherwise the language switch leaves holes.
 */

export default {
  app: {
    name: 'MsEe Central',
    tagline: 'Internal company platform',
  },

  common: {
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    close: 'Close',
    confirm: 'Confirm',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    search: 'Search',
    filter: 'Filter',
    clear: 'Clear',
    back: 'Back',
    next: 'Next',
    submit: 'Submit',
    submitting: 'Submitting…',
    loading: 'Loading…',
    retry: 'Try again',
    view: 'View',
    viewProfile: 'View profile',
    all: 'All',
    none: 'None',
    yes: 'Yes',
    no: 'No',
    optional: 'optional',
    required: 'required',
    notSet: 'Not set',
    hidden: 'Hidden',
    hiddenByPrivacy: 'Hidden by privacy settings',
    unknown: 'Unknown',
    actions: 'Actions',
    results: 'No results | {n} result | {n} results',
    selectPlaceholder: 'Select…',
    searchPlaceholder: 'Search…',
    copy: 'Copy',
    copied: 'Copied',
    export: 'Export',
    refresh: 'Refresh',
  },

  auth: {
    signIn: 'Sign in',
    signInTitle: 'Sign in to MsEe Central',
    signInSubtitle: 'Internal access only.',
    register: 'Request access',
    registerTitle: 'Request access to MsEe Central',
    registerSubtitle:
      'Fill in your details. The CEO reviews every request before an account is activated.',
    email: 'Email',
    password: 'Password',
    confirmPassword: 'Confirm password',
    forgotPassword: 'Forgot your password?',
    noAccount: 'Do not have an account yet?',
    haveAccount: 'Already have an account?',
    signingIn: 'Signing in…',
    invalidCredentials: 'Incorrect email or password.',
    tooManyAttempts: 'Too many failed attempts. Try again later.',
    resetSent: 'If that address belongs to an account, a reset link has been sent.',
    pendingTitle: 'Waiting for approval',
    pendingMessage:
      'Your registration request has been submitted. Your account will be reviewed by the CEO.',
    pendingHint: 'You will be able to sign in as soon as your account is approved.',
    blockedTitle: 'Access unavailable',
    suspendedMessage: 'Your account is suspended. Contact the CEO for more information.',
    deactivatedMessage: 'Your account has been deactivated.',
    rejectedMessage: 'Your registration request was not approved.',
    rejectionReason: 'Reason given',
  },

  register: {
    sectionAccount: 'Account',
    sectionPersonal: 'Personal details',
    sectionProfessional: 'Professional details',
    firstName: 'First name',
    lastName: 'Last name',
    phone: 'Phone number',
    country: 'Country',
    city: 'City',
    photo: 'Profile photo',
    photoHint: 'JPG, PNG or WebP. Resized to 256px before it is stored.',
    photoChoose: 'Choose photo',
    photoChange: 'Change photo',
    photoRemove: 'Remove',
    photoProcessing: 'Processing...',
    personalDescription: 'Short personal description',
    personalDescriptionHint: 'A few sentences about you.',
    desiredPosition: 'Desired position',
    desiredPositionHint: 'The role you are applying for.',
    additionalInfo: 'Additional information',
    additionalInfoHint: 'Anything else the CEO should know.',
    passwordHint: 'At least {min} characters.',
    terms: 'Internal system terms',
    termsText:
      'I confirm the information above is accurate, and I accept that MsEe Central is an internal company system whose use is recorded.',
    submit: 'Submit request',
    emailInUse: 'An account with that email address already exists.',
    weakPassword: 'That password is too weak. Use at least {min} characters.',
  },

  profile: {
    title: 'My Profile',
    subtitle: 'What your colleagues see, and what stays with you.',
    completeness: 'Profile completeness',
    complete: 'Your profile is complete.',
    missingOne: 'One required field is still empty.',
    missingMany: '{n} required fields are still empty.',
    requiredMark: 'Required',

    sectionIdentity: 'Identity',
    sectionAbout: 'About you',
    sectionPersonal: 'Personal details',
    sectionWork: 'Work information',
    sectionPrivacy: 'Privacy',

    visibleToAll: 'Visible to every colleague',
    visibleToAllHint: 'Professional information. This describes the job, so it cannot be hidden.',
    youControl: 'You control who sees these',
    youControlHint: 'Fill them in — then choose who they are shown to below.',

    bio: 'Professional summary',
    bioHint: 'A few lines about what you do here.',
    skills: 'Skills',
    skillsHint: 'Press Enter after each one.',
    expertise: 'Areas of expertise',
    languages: 'Languages',
    interests: 'Professional interests',

    position: 'Position',
    department: 'Department',
    role: 'Role',
    startDate: 'Start date',
    dateJoined: 'Joined',
    employmentStatus: 'Employment status',
    manager: 'Manager',
    employeeCode: 'Employee ID',
    responsibilities: 'Responsibilities',

    managedByCeo: 'Set by the CEO',
    manageYourOwnHint: 'You have permission to set these yourself.',
    managedByCeoHint:
      'Your role, position, department and account status are managed by the CEO and cannot be edited here.',

    photoRequired: 'A profile photo is required.',
    saved: 'Profile saved.',
    saveFailed: 'Your profile could not be saved.',

    tagAdd: 'Add',
    tagPlaceholder: 'Type and press Enter',
    tagRemove: 'Remove {item}',
    emptyList: 'Nothing added yet.',
  },

  employees: {
    title: 'Employees',
    subtitle: 'Everyone at MsEe.',
    searchPlaceholder: 'Search by name, position or skill',
    filterStatus: 'Status',
    filterDepartment: 'Department',
    allStatuses: 'All statuses',
    allDepartments: 'All departments',
    empty: 'No employees match',
    emptyHint: 'Try a different search term or clear the filters.',
    emptyAll: 'No employees yet',
    emptyAllHint: 'Approved registration requests appear here.',
    noPosition: 'Position not set',
    contact: 'Contact',
    about: 'About',
    work: 'Work',
    skills: 'Skills',
    hiddenNotice: 'Some details are hidden by this person’s privacy settings.',
    backToList: 'Back to employees',
    joined: 'Joined {date}',
    you: 'You',
  },

  manage: {
    title: 'Manage employee',
    open: 'Manage',
    workInfo: 'Work information',
    account: 'Account and access',
    position: 'Position',
    department: 'Department',
    employmentStatus: 'Employment status',
    startDate: 'Start date',
    manager: 'Manager',
    responsibilities: 'Responsibilities',
    roles: 'Roles',
    accountStatus: 'Account status',
    noneSelected: 'None',
    noPositions: 'No positions defined yet.',
    noDepartments: 'No departments defined yet.',
    createInSettings: 'Create them in Settings.',
    saved: 'Changes saved.',
    saveFailed: 'Changes could not be saved.',
    founderProtected:
      'This is the founder account — the owner of the company. It cannot be altered by anybody, including other owners. That is what makes it impossible to remove them from their own company.',
    founderOnly:
      'Only the founder may appoint or remove a co-owner. Co-owners have full authority over everything else, but cannot widen the circle of owners themselves.',
    deletePermanently: 'Delete permanently',
    deleteTitle: 'Delete this person and all their data?',
    deleteText:
      'This cannot be undone. Their profile, contact details and CEO notes are erased. Deactivate instead if you only want to remove their access — that keeps the record and can be reversed.',
    deleteConfirmLabel: 'Type {name} to confirm',
    deleteDone: '{name} has been deleted.',
    deleteFailed: 'The person could not be deleted.',
    deleteLoginNote:
      'Their sign-in still exists but now reaches nothing. Run npm run purge-logins to remove it.',
    reversible: 'Reversible — you can bring them back',
    irreversible: 'Permanent — there is no way back',
    profileSection: 'Profile',
    profileHint: 'Photo, name and description. Editing these on somebody else is for corrections — they maintain their own.',
    contactSection: 'Contact details',
    contactHint: 'What each field shows to colleagues is the person’s own choice. Changing a value here does not change who sees it.',
    profileSaved: 'Profile saved.',
    founderBadge: 'Founder',
    selfDemotion:
      'You cannot remove your own CEO role. Appoint a second CEO first, and they can then change yours — that way the company can never be left with nobody able to administer it.',
    selfCeoNotice:
      'As CEO you can change your own roles. Two things stay locked: you cannot remove your own CEO role and cannot suspend your own account, so you can never lock yourself out.',
    selfNotice:
      'You cannot change your own role or account status. Nobody may edit their own permissions — that is the rule which stops an employee promoting themselves, and it applies to the CEO too.',
    rolePermissionCount: '{n} permissions',
    confirmSuspendTitle: 'Suspend this account?',
    confirmSuspendText:
      'They will be signed out and cannot use MsEe Central until reactivated. Their record is kept.',
    confirmDeactivateTitle: 'Deactivate this account?',
    confirmDeactivateText:
      'Use this when somebody leaves the company. Their record and history are kept.',
    confirmActivateTitle: 'Reactivate this account?',
    confirmActivateText: 'They will regain access with their existing role.',
  },

  organisation: {
    title: 'Organisation',
    departments: 'Departments',
    positions: 'Positions',
    addDepartment: 'Add department',
    addPosition: 'Add position',
    editDepartment: 'Edit department',
    editPosition: 'Edit position',
    nameEn: 'Name (English)',
    nameSr: 'Name (Serbian)',
    titleEn: 'Title (English)',
    titleSr: 'Title (Serbian)',
    description: 'Description',
    parentDepartment: 'Department',
    statusActive: 'Active',
    statusInactive: 'Inactive',
    emptyDepartments: 'No departments yet',
    emptyDepartmentsHint: 'Departments group employees and appear on every profile.',
    emptyPositions: 'No positions yet',
    emptyPositionsHint: 'A position is the job somebody does. It is separate from their role.',
    saved: 'Saved.',
    saveFailed: 'Could not be saved.',
    inUse: 'In use by {n}',
    positionVsRole:
      'A position is the job (Marketing Manager). A role is what they may do inside this system (Manager). They are kept separate on purpose.',
  },

  tabs: {
    employees: 'Employees',
    pending: 'Pending',
    suspended: 'Suspended',
    rejected: 'Rejected',
  },

  table: {
    name: 'Name',
    role: 'Role',
    position: 'Position',
    department: 'Department',
    status: 'Status',
    joined: 'Joined',
    submitted: 'Submitted',
    requestedPosition: 'Requested position',
    location: 'Location',
    reviewedBy: 'Decided by',
    reason: 'Reason',
  },

  approval: {
    review: 'Review',
    approve: 'Approve',
    reject: 'Reject',
    approveTitle: 'Approve this employee?',
    approveText: 'They will be able to sign in immediately with the role you assign below.',
    rejectTitle: 'Reject this request?',
    rejectText: 'They will not gain access. The request is kept, with your reason.',
    reason: 'Reason for rejection',
    reasonOptional: 'Optional. Shown to the applicant.',
    assignRole: 'Role',
    assignPosition: 'Position',
    assignDepartment: 'Department',
    assignEmployment: 'Employment status',
    assignStartDate: 'Start date',
    beforeApproving: 'Set before approving',
    noRoleWarning: 'Assign at least one role, or they will sign in with no access at all.',
    approved: 'Employee approved.',
    rejected: 'Request rejected.',
    failed: 'The decision could not be saved.',
    emptyPending: 'No requests waiting',
    emptyPendingHint: 'New registration requests appear here for your decision.',
    emptyRejected: 'No rejected requests',
    emptyRejectedHint: 'Requests you turn down are kept here.',
    emptySuspended: 'Nobody suspended',
    emptySuspendedHint: 'Suspended and deactivated accounts are listed here. Records are never deleted.',
    contactDetails: 'Contact',
    aboutApplicant: 'About',
  },

  coAdmin: {
    warningTitle: 'This grants full control',
    warningText:
      'A second CEO can manage every employee, read every private note, and change your own role and status. Give it only to someone you would trust with the company.',
    whyNotSelf:
      'You cannot change your own role or status. Appoint a second administrator and they can do it for you — that is what keeps a single compromised account from taking over.',
  },

  newEmployee: {
    open: 'Add employee',
    title: 'Create an employee account',
    subtitle:
      'Creates the login yourself, so nobody has to register and wait. They can sign in the moment you are done.',
    tempPassword: 'Temporary password',
    generate: 'Generate',
    passwordHint: 'Give this to them directly. They should change it after signing in.',
    sendReset: 'Email them a link to set their own password',
    sendResetHint: 'Recommended. Then you never have to handle their password at all.',
    create: 'Create account',
    creating: 'Creating…',
    created: 'Account created for {name}.',
    exists: 'An account with that email already exists.',
    failed: 'The account could not be created.',
    noRole: 'Choose at least one role, or they will sign in with no access.',
    credentialsTitle: 'Account ready',
    credentialsText: 'Pass these on now — the password is not stored anywhere and will not be shown again.',
    copied: 'Copied.',
  },

  roles: {
    title: 'Roles & Permissions',
    subtitle: 'You decide what each role can reach. Create as many as the company needs.',
    newRole: 'New role',
    editRole: 'Edit role',
    name: 'Role name',
    nameHint: 'What this role is called, for example Marketing Manager.',
    description: 'Description',
    descriptionHint: 'What this role is for. Optional, but future you will be glad of it.',
    permissions: 'What this role can do',
    permissionsHint: 'Tick only what the role genuinely needs. Everything else stays closed.',
    selectedCount: 'nothing selected | {n} selected | {n} selected',
    selectGroup: 'All',
    clearGroup: 'None',
    peopleCount: 'no one | {n} person | {n} people',
    ownerRole: 'Owner',
    ownerRoleHint:
      'Owner roles hold every permission, present and future, and cannot be edited here. Only the founder may assign them.',
    lockedRole: 'Locked',
    empty: 'No roles yet',
    emptyHint: 'Create a role, tick what it may do, then assign it to people.',
    saved: 'Role saved.',
    saveFailed: 'The role could not be saved.',
    nameRequired: 'Give the role a name.',
    noPermissions: 'This role can do nothing at all. Somebody holding it will sign in to an empty application.',
    sensitive: 'Sensitive',
    sensitiveHint:
      'These let the holder read private information or widen their own authority. Give them out sparingly.',
    inUseWarning: 'Assigned to {n}. Changes apply to them immediately.',
    statusActive: 'Active',
    statusInactive: 'Inactive',
    statusHint: 'An inactive role cannot be assigned, but people who already hold it keep it.',
  },

  accountType: {
    label: 'Account type',
    employee: 'Employee',
    affiliate: 'Affiliate Partner',
    employeeHint: 'Staff. What they reach depends on the role you give them.',
    affiliateHint:
      'An outside partner who brings business and earns commission. Sees only their own figures — never colleagues, company data or internal lists.',
    filterAll: 'Everyone',
    isolationNotice:
      'Affiliates are isolated by the security rules, not by their role. Even one holding every permission still sees only their own record.',
  },

  settings: {
    personal: 'Your preferences',
    languageHint: 'Applies to you only. Colleagues keep their own choice.',
    themeHint: 'Applies to you only, on this device.',
  },

  dashboard: {
    greeting: 'Hello, {name}',
    subtitleOwner: 'How the company stands today.',
    subtitleEmployee: 'Your corner of MsEe Central.',
    subtitleAffiliate: 'Your sales and commission.',

    totalEmployees: 'Employees',
    activeEmployees: 'Active',
    pendingRequests: 'Waiting for you',
    suspended: 'Suspended',
    affiliates: 'Affiliate partners',

    pendingTitle: 'Registration requests',
    pendingNone: 'Nothing waiting.',
    pendingSome: 'no one waiting | {n} person is waiting for a decision | {n} people are waiting for a decision',
    review: 'Review them',

    recentActivity: 'Recent activity',
    activityNone: 'Nothing recorded yet.',
    seeAll: 'See all',

    recentlyJoined: 'Recently joined',

    yourProfile: 'Your profile',
    profileIncomplete: 'Your profile is {percent}% complete.',
    profileComplete: 'Your profile is complete.',
    completeProfile: 'Finish it',

    comingSoon: 'Coming soon',
    earningsSoon:
      'Your earnings, bonuses and tasks will appear here once those parts of the system are built.',
    commissionSoon:
      'Your sales, commission and payouts will appear here once that part of the system is built.',
  },

  auditAction: {
    'registration.submitted': 'Registration submitted',
    'account.approved': 'Account approved',
    'account.rejected': 'Request rejected',
    'account.suspended': 'Account suspended',
    'account.activated': 'Account activated',
    'account.deactivated': 'Account deactivated',
    'role.created': 'Role created',
    'role.updated': 'Role changed',
    'role.deactivated': 'Role retired',
    'role.assigned': 'Roles assigned',
    'permissions.changed': 'Permissions changed',
    'position.changed': 'Work details changed',
    'department.changed': 'Department changed',
    'profile.updated': 'Profile updated',
    'privacy.changed': 'Privacy changed',
    'note.created': 'Note written',
    'note.updated': 'Note changed',
    'note.deleted': 'Note deleted',
    'auth.login': 'Signed in',
    'auth.login_failed': 'Failed sign-in',
    'client.created': 'Client added',
    'client.updated': 'Client changed',
    'project.created': 'Project added',
    'project.updated': 'Project changed',
    'income.recorded': 'Income recorded',
    'expense.recorded': 'Expense recorded',
    'settings.updated': 'Settings changed',
    'data.exported': 'Data exported',
  },

  nav2: {
    sectionCompany: 'Company',
    sectionBusiness: 'Business',
    sectionPeople: 'People',
    sectionAdmin: 'Administration',
    sectionWorkspace: 'My Workspace',

    clients: 'Clients',
    leads: 'Leads',
    goals: 'Goals & KPIs',
    performance: 'Performance',
    organization: 'Organization',
    tasks: 'My Tasks',
    earnings: 'My Earnings',

    soon: 'Soon',
    soonTitle: 'Not built yet',
  },

  search: {
    placeholder: 'Search people, roles, pages',
    open: 'Search',
    shortcut: 'Ctrl K',
    noResults: 'Nothing found for {term}',
    people: 'People',
    pages: 'Pages',
    hint: 'Type a name, a position or a page.',
  },

  modules: {
    workspace: 'My Workspace',
    leads: 'Leads',
    subscriptions: 'Subscriptions',
    income: 'Income',
    expenses: 'Expenses',
    commissions: 'Commissions',
    offers: 'Offers & Documents',
    clientAccess: 'Client Access',
    timeTracking: 'Time Tracking',
    timeOff: 'Time Off',
    announcements: 'Announcements',
    support: 'Support',
    groupClients: 'Clients & Work',
    groupMoney: 'Money',
    tasks: 'Tasks',
    sales: 'Sales',
    affiliateProgram: 'Affiliate Program',
    clients: 'Clients',
    projects: 'Projects',
    services: 'Services',
    contracts: 'Contracts',
    finance: 'Finance',
    employees: 'Employees',
    goals: 'Goals & KPIs',
    performance: 'Performance',
    calendar: 'Calendar',
    analytics: 'Analytics',

    groupMain: 'Overview',
    groupBusiness: 'Business',
    groupTeam: 'Team',
    groupTools: 'Tools',
    groupSystem: 'System',
  },

  workspace: {
    title: 'My Workspace',
    subtitle: 'Everything that is yours.',
    profileCard: 'Your profile',
    tasksCard: 'Your tasks',
    earningsCard: 'Your earnings',
    notificationsCard: 'Notifications',
    tasksSoon: 'Tasks assigned to you will appear here.',
    earningsSoon: 'Your salary, bonuses and rewards will appear here.',
    notificationsSoon: 'Messages and reminders for you will appear here.',
    openProfile: 'Open profile',
  },

  settingsHub: {
    administration: 'Administration',
    administrationHint: 'Company-wide settings. Each opens as its own page, under its own permission.',
    requestsDesc: 'Approve or turn away people asking for an account.',
    rolesDesc: 'Decide what each role may reach.',
    organizationDesc: 'Departments and job titles.',
    auditDesc: 'Who did what, and when.',
  },

  audit: {
    title: 'Audit Log',
    subtitle: 'Who did what, and when. Nobody can change or remove an entry.',
    filterAction: 'Action',
    allActions: 'All actions',
    filterActor: 'Person',
    allActors: 'Everyone',
    searchPlaceholder: 'Search by person or target',
    actor: 'Who',
    action: 'What',
    target: 'On whom',
    when: 'When',
    details: 'Details',
    empty: 'Nothing recorded yet',
    emptyHint: 'Approvals, role changes and suspensions appear here as they happen.',
    noMatch: 'No entries match',
    noMatchHint: 'Try a different search or clear the filters.',
    immutable: 'Append-only',
    immutableHint:
      'Entries can be created but never edited or deleted — not by anybody, including the owner. That is what makes this worth reading.',
    loadMore: 'Load more',
    showing: 'Showing {n}',
  },

  clientStatus: {
    prospect: 'Prospect',
    active: 'Active',
    paused: 'Paused',
    former: 'Former',
  },

  clients: {
    title: 'Clients',
    subtitle: 'Everyone the company works for.',
    newClient: 'New client',
    editClient: 'Edit client',
    name: 'Client name',
    nameHint: 'The company, or the person if they trade under their own name.',
    contactName: 'Contact person',
    contactHint: 'Who you actually talk to.',
    website: 'Website',
    notes: 'Notes',
    notesHint: 'Anything worth remembering. Visible to everyone who can see clients.',
    searchPlaceholder: 'Search by name, contact or city',
    filterStatus: 'Status',
    allStatuses: 'All statuses',
    empty: 'No clients yet',
    emptyHint: 'Add the first one, then projects and money attach to it.',
    noMatch: 'No clients match',
    noMatchHint: 'Try a different search or clear the filters.',
    saved: 'Client saved.',
    saveFailed: 'The client could not be saved.',
    nameRequired: 'Give the client a name.',
    since: 'Client since {date}',
    statusHint: 'Clients are never deleted — move them to Former instead, and their history stays.',
    contact: 'Contact',
    location: 'Location',
  },

  nav: {
    dashboard: 'Dashboard',
    employees: 'Employees',
    directory: 'Directory',
    requests: 'Registration Requests',
    roles: 'Roles & Permissions',
    audit: 'Audit Log',
    profile: 'My Profile',
    settings: 'Settings',
    sectionMain: 'Overview',
    sectionPeople: 'People',
    sectionAdmin: 'Administration',
    sectionAccount: 'Account',
    signOut: 'Sign out',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    futureModules: 'Coming later',
  },

  theme: {
    label: 'Theme',
    dark: 'Dark',
    light: 'Light',
    toggle: 'Switch theme',
  },

  language: {
    label: 'Language',
    serbian: 'Srpski',
    english: 'English',
    switch: 'Change language',
  },

  status: {
    pending: 'Pending',
    active: 'Active',
    suspended: 'Suspended',
    rejected: 'Rejected',
    deactivated: 'Deactivated',
  },

  employmentStatus: {
    full_time: 'Full-time',
    part_time: 'Part-time',
    contractor: 'Contractor',
    intern: 'Intern',
    former: 'Former employee',
  },

  visibility: {
    label: 'Visibility',
    everyone: 'Everyone',
    management: 'Management only',
    private: 'Private',
    everyoneHint: 'Every employee who can view the directory',
    managementHint: 'You, the CEO and authorised management',
    privateHint: 'Only you and the CEO',
    ceoNotice:
      'The CEO always retains access to information required for company administration. Privacy settings control what coworkers see.',
  },

  noteCategory: {
    performance: 'Performance',
    strength: 'Strength',
    improvement: 'Improvement',
    warning: 'Warning',
    disciplinary: 'Disciplinary',
    recognition: 'Recognition',
    general: 'General',
  },

  permissionGroup: {
    employees: 'Employees',
    requests: 'Registration requests',
    roles: 'Roles & permissions',
    organisation: 'Departments & positions',
    business: 'Clients & projects',
    finance: 'Money',
    notes: 'CEO notes',
    audit: 'Audit log',
    settings: 'Company settings',
  },

  permission: {
    employees: {
      view: {
        label: 'View the directory',
        description:
          'See the list of colleagues: photo, name, position and department. Nothing private.',
      },
      view_all: {
        label: 'See everyone',
        description:
          'Include people outside their own department in that list.',
      },
      view_private_info: {
        label: 'See management contact details',
        description:
          'Read the phone and email of people who set those to management only. This crosses into private information.',
      },
      edit_professional: {
        label: 'Edit job details',
        description:
          'Change a person position, department, duties and start date. Not their role or account status.',
      },
      manage_status: {
        label: 'Suspend and reactivate',
        description:
          'Cut off or restore access to the system. The record is kept either way.',
      },
      export: {
        label: 'Export employee data',
        description:
          'Download the employee list as a file that leaves the system.',
      },
    },
    registration_requests: {
      view: {
        label: 'See who applied',
        description:
          'Open the Pending tab and read what applicants submitted.',
      },
      approve: {
        label: 'Let people in',
        description:
          'Turn an applicant into an active account with a role you choose.',
      },
      reject: {
        label: 'Turn applicants away',
        description:
          'Refuse a request, with a reason kept on record.',
      },
    },
    roles: {
      view: {
        label: 'See the roles',
        description:
          'Open this page and read which role holds what.',
      },
      create: {
        label: 'Create roles',
        description:
          'Add new roles to the company.',
      },
      edit: {
        label: 'Change what roles may do',
        description:
          'Tick and untick permissions. This changes what every holder can reach, immediately.',
      },
      deactivate: {
        label: 'Retire a role',
        description:
          'Stop a role being assigned to anybody new.',
      },
      assign: {
        label: 'Give people roles',
        description:
          'Decide who holds which role. Whoever has this decides what others may do.',
      },
    },
    departments: {
      manage: {
        label: 'Manage departments',
        description:
          'Create, rename and retire departments.',
      },
    },
    positions: {
      manage: {
        label: 'Manage positions',
        description:
          'Create, rename and retire job titles.',
      },
    },
    employee_notes: {
      view: {
        label: 'Read private notes',
        description:
          'Open the CEO notes on people: performance, warnings, disciplinary records. Never visible to the person themselves.',
      },
      create: {
        label: 'Write private notes',
        description:
          'Add a note to somebody file.',
      },
      edit: {
        label: 'Change notes',
        description:
          'Edit a note after it was written.',
      },
      delete: {
        label: 'Delete notes',
        description:
          'Remove a note permanently. There is no undo.',
      },
    },
    audit_log: {
      view: {
        label: 'Read the history',
        description:
          'See who did what and when: role changes, approvals, suspensions.',
      },
      export: {
        label: 'Export the history',
        description:
          'Download the log as a file.',
      },
    },
    company_settings: {
      view: {
        label: 'See company settings',
        description:
          'Read the company name, language and registration settings.',
      },
      edit: {
        label: 'Change company settings',
        description:
          'Change those settings, including whether people may register at all.',
      },
    },
  },

  errors: {
    generic: 'Something went wrong. Please try again.',
    network: 'Cannot reach the server. Check your connection.',
    forbidden: 'You do not have permission to do that.',
    notFound: 'Not found.',
    sessionExpired: 'Your session expired. Please sign in again.',
    required: 'This field is required.',
    invalidEmail: 'Enter a valid email address.',
    passwordTooShort: 'Password must be at least {min} characters.',
    passwordsDoNotMatch: 'Passwords do not match.',
    invalidPhone: 'Enter a valid phone number.',
    fileTooLarge: 'File is too large. Maximum {max}.',
    fileWrongType: 'Unsupported file type. Use JPG, PNG or WebP.',
    mustAcceptTerms: 'You must accept the terms to continue.',
  },

  soon: {
    title: 'Not built yet',
    text: 'This screen arrives in a later stage of version 1.',
  },

  setup: {
    title: 'Firebase is not configured',
    text: 'Copy .env.example to .env and fill in the values from your Firebase project, then restart the dev server.',
    missing: 'Missing values',
    docs: 'Firebase Console → Project settings → General → Your apps',
  },

  a11y: {
    mainNavigation: 'Main navigation',
    userMenu: 'User menu',
    breadcrumb: 'Breadcrumb',
    loading: 'Loading content',
  },

  notFound: {
    title: 'Page not found',
    text: 'The page you are looking for does not exist or you no longer have access to it.',
    action: 'Back to dashboard',
  },

  forbidden: {
    title: 'Access denied',
    text: 'You do not have permission to view this page. If you believe this is a mistake, contact the CEO.',
    action: 'Back to dashboard',
  },
}
