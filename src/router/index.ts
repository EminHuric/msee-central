/**
 * MsEe Central — routing and the client-side access gate.
 *
 * The `permission` meta below hides pages a user may not use. Treat it as
 * convenience only: it stops a wrong link, not an attacker. Every one of these
 * screens reads data that Firestore Security Rules guard independently, and
 * those rules are the real boundary.
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
    path: '/register',
    name: 'register',
    component: () => import('@/views/auth/RegisterView.vue'),
    meta: { guestOnly: true, titleKey: 'auth.register' },
  },
  {
    path: '/pending',
    name: 'pending',
    component: () => import('@/views/auth/PendingView.vue'),
    meta: { titleKey: 'auth.pendingTitle' },
  },
  {
    path: '/blocked',
    name: 'blocked',
    component: () => import('@/views/auth/BlockedView.vue'),
    meta: { titleKey: 'auth.blockedTitle' },
  },

  {
    path: '/',
    component: () => import('@/layouts/AppLayout.vue'),
    meta: { requiresAuth: true },
    children: [
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
        meta: { titleKey: 'modules.workspace' },
      },
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
        path: 'leads',
        name: 'leads',
        component: () => import('@/views/business/LeadsView.vue'),
        meta: { permission: PERMISSIONS.LEADS_VIEW, titleKey: 'leads.title' },
      },
      {
        path: 'sales',
        name: 'sales',
        component: () => import('@/views/business/SalesView.vue'),
        meta: { permission: PERMISSIONS.SALES_VIEW, titleKey: 'sales.title' },
      },
      {
        path: 'projects',
        name: 'projects',
        component: () => import('@/views/business/ProjectsView.vue'),
        meta: { permission: PERMISSIONS.PROJECTS_VIEW, titleKey: 'projects.title' },
      },
      {
        /* No permission: everybody has tasks. The rules narrow what is shown. */
        path: 'tasks',
        name: 'tasks',
        component: () => import('@/views/business/TasksView.vue'),
        meta: { titleKey: 'tasks.title' },
      },
      {
        path: 'services',
        name: 'services',
        component: () => import('@/views/business/ServicesView.vue'),
        meta: { permission: PERMISSIONS.SERVICES_VIEW, titleKey: 'services.title' },
      },
      {
        path: 'contracts',
        name: 'contracts',
        component: () => import('@/views/business/ContractsView.vue'),
        meta: { permission: PERMISSIONS.CONTRACTS_VIEW, titleKey: 'contracts.title' },
      },
      {
        path: 'affiliates',
        name: 'affiliates',
        component: () => import('@/views/business/AffiliatesView.vue'),
        meta: { permission: PERMISSIONS.AFFILIATES_VIEW, titleKey: 'affiliates.title' },
      },
      {
        path: 'finance',
        name: 'finance',
        component: () => import('@/views/business/FinanceView.vue'),
        meta: { permission: PERMISSIONS.FINANCE_VIEW, titleKey: 'finance.title' },
      },
      {
        path: 'goals',
        name: 'goals',
        component: () => import('@/views/business/GoalsView.vue'),
        meta: { permission: PERMISSIONS.GOALS_VIEW, titleKey: 'goals.title' },
      },
      {
        path: 'performance',
        name: 'performance',
        component: () => import('@/views/business/PerformanceView.vue'),
        meta: { permission: PERMISSIONS.PERFORMANCE_VIEW, titleKey: 'performance.title' },
      },
      {
        path: 'calendar',
        name: 'calendar',
        component: () => import('@/views/CalendarView.vue'),
        meta: { permission: PERMISSIONS.CALENDAR_VIEW, titleKey: 'calendar.title' },
      },
      {
        path: 'chat',
        name: 'chat',
        component: () => import('@/views/ChatView.vue'),
        meta: { permission: PERMISSIONS.CHAT_USE, titleKey: 'chat.title' },
      },
      {
        path: 'analytics',
        name: 'analytics',
        component: () => import('@/views/AnalyticsView.vue'),
        meta: { permission: PERMISSIONS.ANALYTICS_VIEW, titleKey: 'analytics.title' },
      },
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
        path: 'requests',
        name: 'requests',
        component: () => import('@/views/admin/RequestsView.vue'),
        meta: { permission: PERMISSIONS.REQUESTS_VIEW, titleKey: 'nav.requests' },
      },
      {
        path: 'roles',
        name: 'roles',
        component: () => import('@/views/admin/RolesView.vue'),
        meta: { permission: PERMISSIONS.ROLES_VIEW, titleKey: 'nav.roles' },
      },
      {
        path: 'organization',
        name: 'organization',
        component: () => import('@/views/admin/OrganizationView.vue'),
        meta: { permission: PERMISSIONS.DEPARTMENTS_MANAGE, titleKey: 'nav2.organization' },
      },
      {
        path: 'audit',
        name: 'audit',
        component: () => import('@/views/admin/AuditLogView.vue'),
        meta: { permission: PERMISSIONS.AUDIT_VIEW, titleKey: 'nav.audit' },
      },
      {
        path: 'profile',
        name: 'profile',
        component: () => import('@/views/MyProfileView.vue'),
        meta: { titleKey: 'nav.profile' },
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@/views/SettingsView.vue'),
        meta: { titleKey: 'nav.settings' },
      },
      {
        path: 'forbidden',
        name: 'forbidden',
        component: () => import('@/views/ForbiddenView.vue'),
        meta: { titleKey: 'forbidden.title' },
      },
    ],
  },

  /*
   * The public end of a referral link. No account, no layout, and no reads —
   * see ReferralView for why that constraint shapes the whole page.
   */
  {
    path: '/ref/:code/:service?',
    name: 'referral',
    component: () => import('@/views/ReferralView.vue'),
    meta: { titleKey: 'referral.title' },
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
  scrollBehavior(_to, _from, saved) {
    return saved ?? { top: 0 }
  },
})

export default router
