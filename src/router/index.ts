/**
 * MsEe Central — routing and the client-side access gate.
 *
 * The `permission` meta below hides pages a user may not use. Treat it as
 * convenience only: it stops a wrong link, not an attacker. Every one of these
 * screens reads data that Firestore Security Rules guard independently, and
 * those rules are the real boundary.
 *
 * Administration lives under `/settings/*` rather than at the top level.
 * Roles, the organisation chart, registration requests and the audit log are
 * configured once and then left alone; beside the daily work they only made
 * the menu longer.
 */

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import { PERMISSIONS, type Permission } from '@/types/permissions'

declare module 'vue-router' {
  interface RouteMeta {
    /** Route is only reachable by a signed-in, active account. */
    requiresAuth?: boolean
    /** Route is only for signed-out visitors (login, register). */
    guestOnly?: boolean
    /** Permission required to open the page. */
    permission?: Permission
    /** i18n key for the browser tab title. */
    titleKey?: string
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/auth/LoginView.vue'),
    meta: { guestOnly: true, titleKey: 'auth.signIn' },
  },
  {
    path: '/blocked',
    name: 'blocked',
    component: () => import('@/views/auth/BlockedView.vue'),
    meta: { titleKey: 'blocked.title' },
  },

  {
    path: '/',
    component: () => import('@/layouts/AppLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      /* ---- Overview ------------------------------------------------- */
      {
        path: '',
        name: 'dashboard',
        component: () => import('@/views/DashboardView.vue'),
        meta: { titleKey: 'nav.dashboard' },
      },
      {
        path: 'workspace',
        name: 'workspace',
        component: () => import('@/views/MyWorkspaceView.vue'),
        meta: { titleKey: 'workspace.title' },
      },

      /* ---- Business -------------------------------------------------- */
      {
        path: 'clients',
        name: 'clients',
        component: () => import('@/views/business/ClientsView.vue'),
        meta: { permission: PERMISSIONS.CLIENTS_VIEW, titleKey: 'clients.title' },
      },
      {
        path: 'clients/:id',
        name: 'client-profile',
        component: () => import('@/views/business/ClientProfileView.vue'),
        meta: { permission: PERMISSIONS.CLIENTS_VIEW, titleKey: 'clients.title' },
      },
      {
        path: 'staybrain',
        name: 'staybrain',
        component: () => import('@/views/business/StayBrainView.vue'),
        meta: { permission: PERMISSIONS.STAYBRAIN_VIEW, titleKey: 'staybrain.title' },
      },
      {
        path: 'staybrain/:id',
        name: 'staybrain-property',
        component: () => import('@/views/business/StayBrainPropertyView.vue'),
        meta: { permission: PERMISSIONS.STAYBRAIN_VIEW, titleKey: 'staybrain.title' },
      },
      {
        path: 'leads',
        name: 'leads',
        component: () => import('@/views/business/LeadsView.vue'),
        meta: { permission: PERMISSIONS.LEADS_VIEW, titleKey: 'leads.title' },
      },
      {
        path: 'projects',
        name: 'projects',
        component: () => import('@/views/business/ProjectsView.vue'),
        meta: { permission: PERMISSIONS.PROJECTS_VIEW, titleKey: 'projects.title' },
      },
      {
        path: 'projects/:id',
        name: 'project-detail',
        component: () => import('@/views/business/ProjectDetailView.vue'),
        meta: { permission: PERMISSIONS.PROJECTS_VIEW, titleKey: 'projects.title' },
      },
      {
        path: 'sales',
        name: 'sales',
        component: () => import('@/views/business/SalesView.vue'),
        meta: { permission: PERMISSIONS.SALES_VIEW, titleKey: 'sales.title' },
      },
      {
        path: 'services',
        name: 'services',
        component: () => import('@/views/business/ServicesView.vue'),
        meta: { permission: PERMISSIONS.SERVICES_VIEW, titleKey: 'services.title' },
      },
      {
        /*
         * No permission gate: an outside partner reaches this page with no
         * internal permissions at all and sees their own panel. What they may
         * read is decided by the rules, not by this line.
         */
        path: 'affiliates',
        name: 'affiliates',
        component: () => import('@/views/business/AffiliatesView.vue'),
        meta: { titleKey: 'affiliates.title' },
      },
      {
        path: 'finance',
        name: 'finance',
        component: () => import('@/views/business/FinanceView.vue'),
        meta: { permission: PERMISSIONS.FINANCE_VIEW, titleKey: 'finance.title' },
      },

      /* ---- Team ------------------------------------------------------ */
      {
        path: 'employees',
        name: 'employees',
        component: () => import('@/views/EmployeesView.vue'),
        meta: { permission: PERMISSIONS.EMPLOYEES_VIEW, titleKey: 'nav.employees' },
      },
      {
        path: 'employees/:uid',
        name: 'employee-profile',
        component: () => import('@/views/EmployeeProfileView.vue'),
        meta: { permission: PERMISSIONS.EMPLOYEES_VIEW, titleKey: 'nav.employees' },
      },
      {
        path: 'goals',
        name: 'goals',
        component: () => import('@/views/business/GoalsView.vue'),
        meta: { permission: PERMISSIONS.GOALS_VIEW, titleKey: 'goals.title' },
      },
      {
        /*
         * Everybody who earns anything can see their own ledger. The rules
         * scope it to them;  is what opens somebody else's.
         */
        path: 'earnings',
        name: 'earnings',
        component: () => import('@/views/MyEarningsView.vue'),
        meta: { permission: PERMISSIONS.WALLET_VIEW_OWN, titleKey: 'wallet.title' },
      },
      {
        path: 'bonuses',
        name: 'bonuses',
        component: () => import('@/views/business/BonusesView.vue'),
        meta: { permission: PERMISSIONS.BONUSES_VIEW, titleKey: 'bonuses.title' },
      },
      {
        path: 'performance',
        name: 'performance',
        component: () => import('@/views/business/PerformanceView.vue'),
        meta: { permission: PERMISSIONS.PERFORMANCE_VIEW, titleKey: 'performance.title' },
      },

      /* ---- Tools ----------------------------------------------------- */
      {
        path: 'calendar',
        name: 'calendar',
        component: () => import('@/views/CalendarView.vue'),
        meta: { permission: PERMISSIONS.CALENDAR_VIEW, titleKey: 'calendar.title' },
      },
      {
        path: 'analytics',
        name: 'analytics',
        component: () => import('@/views/AnalyticsView.vue'),
        meta: { permission: PERMISSIONS.ANALYTICS_VIEW, titleKey: 'analytics.title' },
      },
      {
        path: 'notifications',
        name: 'notifications',
        component: () => import('@/views/NotificationsView.vue'),
        meta: { titleKey: 'notifications.title' },
      },

      /* ---- Personal --------------------------------------------------- */
      {
        path: 'profile',
        name: 'profile',
        component: () => import('@/views/MyProfileView.vue'),
        meta: { titleKey: 'nav.profile' },
      },

      /* ---- Settings, and everything administrative under it ----------- */
      {
        path: 'settings',
        component: () => import('@/views/SettingsView.vue'),
        meta: { titleKey: 'nav.settings' },
        children: [
          {
            path: '',
            name: 'settings',
            component: () => import('@/views/settings/GeneralSettingsView.vue'),
            meta: { titleKey: 'nav.settings' },
          },
          {
            path: 'notifications',
            name: 'settings-notifications',
            component: () => import('@/views/settings/NotificationSettingsView.vue'),
            meta: { titleKey: 'notifications.title' },
          },
          {
            path: 'organization',
            name: 'settings-organization',
            component: () => import('@/views/admin/OrganizationView.vue'),
            meta: { permission: PERMISSIONS.DEPARTMENTS_MANAGE, titleKey: 'nav2.organization' },
          },
          {
            path: 'roles',
            name: 'settings-roles',
            component: () => import('@/views/admin/RolesView.vue'),
            meta: { permission: PERMISSIONS.ROLES_VIEW, titleKey: 'nav.roles' },
          },
          {
            /* Rows another system sent that still need a person to look. */
            path: 'intake',
            name: 'settings-intake',
            component: () => import('@/views/TradingView.vue'),
            meta: { permission: PERMISSIONS.FINANCE_VIEW, titleKey: 'trading.title' },
          },
          {
            path: 'fields',
            name: 'settings-fields',
            component: () => import('@/views/settings/CustomFieldsView.vue'),
            meta: { permission: PERMISSIONS.FIELDS_MANAGE, titleKey: 'fields.title' },
          },
          {
            path: 'recycle',
            name: 'settings-recycle',
            component: () => import('@/views/settings/RecycleBinView.vue'),
            meta: { permission: PERMISSIONS.RECYCLE_VIEW, titleKey: 'recycle.title' },
          },
          {
            path: 'audit',
            name: 'settings-audit',
            component: () => import('@/views/admin/AuditLogView.vue'),
            meta: { permission: PERMISSIONS.AUDIT_VIEW, titleKey: 'nav.audit' },
          },
        ],
      },

      {
        path: 'forbidden',
        name: 'forbidden',
        component: () => import('@/views/ForbiddenView.vue'),
        meta: { titleKey: 'forbidden.title' },
      },
    ],
  },

  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { titleKey: 'notFound.title' },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})
