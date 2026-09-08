<script setup lang="ts">
/**
 * Settings — the shell over everything you configure rather than use.
 *
 * Administration used to be five entries in the main menu. Roles, the
 * organisation chart, registration requests and the audit log are all things
 * you set up once and then leave alone; sitting beside the work somebody does
 * every day, they made the menu longer without making anything easier to find.
 *
 * They keep their own routes, each carrying one permission checked in one
 * place. This page is the way in, and it lists only the sections the viewer
 * can actually open.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import { useAuthStore } from '@/stores/auth'
import { PERMISSIONS, type Permission } from '@/types/permissions'

const auth = useAuthStore()
const route = useRoute()
const { t } = useI18n()

interface Section {
  to: string
  labelKey: string
  icon: string
  permission?: Permission
}

interface Group {
  titleKey: string
  sections: Section[]
}

const groups = computed<Group[]>(() =>
  ([
    {
      titleKey: 'settingsHub.workspaceGroup',
      sections: [
        { to: '/settings', labelKey: 'settingsHub.general', icon: 'settings' },
        { to: '/settings/notifications', labelKey: 'notifications.title', icon: 'bell' },
        { to: '/profile', labelKey: 'nav.profile', icon: 'user' },
      ],
    },
    {
      titleKey: 'settingsHub.companyGroup',
      sections: [
        {
          to: '/settings/organization',
          labelKey: 'nav2.organization',
          icon: 'building',
          permission: PERMISSIONS.DEPARTMENTS_MANAGE,
        },
        {
          to: '/employees',
          labelKey: 'modules.employees',
          icon: 'users',
          permission: PERMISSIONS.EMPLOYEES_VIEW,
        },
        {
          to: '/settings/requests',
          labelKey: 'nav.requests',
          icon: 'inbox',
          permission: PERMISSIONS.REQUESTS_VIEW,
        },
        {
          to: '/settings/roles',
          labelKey: 'nav.roles',
          icon: 'shield',
          permission: PERMISSIONS.ROLES_VIEW,
        },
      ],
    },
    {
      titleKey: 'settingsHub.dataGroup',
      sections: [
        {
          to: '/settings/fields',
          labelKey: 'fields.title',
          icon: 'edit',
          permission: PERMISSIONS.FIELDS_MANAGE,
        },
        {
          to: '/settings/recycle',
          labelKey: 'recycle.title',
          icon: 'trash',
          permission: PERMISSIONS.RECYCLE_VIEW,
        },
        {
          to: '/settings/audit',
          labelKey: 'nav.audit',
          icon: 'scroll',
          permission: PERMISSIONS.AUDIT_VIEW,
        },
      ],
    },
  ] as Group[])
    .map((group) => ({
      ...group,
      sections: group.sections.filter((s) => !s.permission || auth.hasPermission(s.permission)),
    }))
    .filter((group) => group.sections.length > 0),
)

/** The general page is the only exact match; the rest match by prefix. */
function isActive(to: string): boolean {
  return to === '/settings' ? route.path === '/settings' : route.path.startsWith(to)
}
</script>

<template>
  <div class="page settings">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('nav.settings') }}</h1>
        <p class="page-subtitle">{{ t('settingsHub.subtitle') }}</p>
      </div>
    </header>

    <div class="layout">
      <nav class="card nav" :aria-label="t('nav.settings')">
        <template v-for="group in groups" :key="group.titleKey">
          <p class="nav-title">{{ t(group.titleKey) }}</p>
          <RouterLink
            v-for="section in group.sections"
            :key="section.to"
            :to="section.to"
            class="nav-item"
            :class="{ 'is-active': isActive(section.to) }"
          >
            <AppIcon :name="section.icon" :size="16" />
            <span>{{ t(section.labelKey) }}</span>
          </RouterLink>
        </template>
      </nav>

      <div class="content">
        <RouterView />
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: minmax(190px, 230px) minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
}
@media (max-width: 820px) {
  .layout { grid-template-columns: 1fr; }
}

.nav { padding: var(--space-2); display: flex; flex-direction: column; gap: 2px; }
@media (max-width: 820px) {
  .nav { flex-direction: row; flex-wrap: wrap; }
  .nav-title { width: 100%; }
}

.nav-title {
  padding: var(--space-3) var(--space-3) var(--space-1);
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--text-tertiary);
}

.nav-item {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm); font-weight: 550;
  color: var(--text-secondary); text-decoration: none;
  transition: background var(--dur-fast) var(--ease-out);
}
.nav-item:hover { background: var(--bg-hover); color: var(--text-primary); text-decoration: none; }
.nav-item.is-active { background: var(--accent-soft-bg); color: var(--text-brand); }

.content { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
</style>
