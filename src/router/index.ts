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
