<script setup lang="ts">
/**
 * Primary navigation.
 *
 * Grouped by what somebody is doing rather than by which module built it:
 * running the company, doing business, managing people, administering the
 * system, and their own work.
 *
 * Modules that are planned but not built appear greyed with a "Soon" tag
 * rather than being hidden. That is a deliberate choice: the shape of the
 * system is easier to hold in your head when you can see where things will
 * go, and an item that visibly does nothing is more honest than one that
 * looks ready and disappoints.
 *
 * Items are filtered by permission so nobody is shown a door they cannot
 * open. That is ergonomics, not security — the route guard and the Firestore
 * rules both re-check independently.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { PERMISSIONS, type Permission } from '@/types/permissions'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

interface NavItem {
  to?: string
  labelKey: string
  icon: string
  permission?: Permission
  /** Planned, not built. Rendered flat and unclickable. */
  soon?: boolean
  /** Hidden from affiliates, who are outside the company. */
  internalOnly?: boolean
}

interface NavSection {
  titleKey: string
  items: NavItem[]
}

const isAffiliate = computed(() => auth.access?.accountType === 'affiliate')

const sections = computed<NavSection[]>(() => {
  const raw: NavSection[] = [
    {
      titleKey: 'nav2.sectionCompany',
      items: [{ to: '/', labelKey: 'nav.dashboard', icon: 'dashboard' }],
    },
    {
      titleKey: 'nav2.sectionBusiness',
      items: [
        { labelKey: 'nav2.clients', icon: 'building', soon: true, internalOnly: true },
        { labelKey: 'nav2.leads', icon: 'inbox', soon: true, internalOnly: true },
        { labelKey: 'nav2.goals', icon: 'dashboard', soon: true, internalOnly: true },
        { labelKey: 'nav2.performance', icon: 'history', soon: true, internalOnly: true },
      ],
    },
    {
      titleKey: 'nav2.sectionPeople',
      items: [
        {
          to: '/employees',
          labelKey: 'nav.employees',
          icon: 'users',
          permission: PERMISSIONS.EMPLOYEES_VIEW,
          internalOnly: true,
        },
        {
          to: '/requests',
          labelKey: 'nav.requests',
          icon: 'inbox',
          permission: PERMISSIONS.REQUESTS_VIEW,
          internalOnly: true,
        },
      ],
    },
    {
      titleKey: 'nav2.sectionAdmin',
      items: [
        {
          to: '/roles',
          labelKey: 'nav.roles',
          icon: 'shield',
          permission: PERMISSIONS.ROLES_VIEW,
          internalOnly: true,
        },
        {
          to: '/organization',
          labelKey: 'nav2.organization',
          icon: 'building',
          permission: PERMISSIONS.DEPARTMENTS_MANAGE,
          internalOnly: true,
        },
        {
          to: '/audit',
          labelKey: 'nav.audit',
          icon: 'scroll',
          permission: PERMISSIONS.AUDIT_VIEW,
          internalOnly: true,
        },
      ],
    },
    {
      titleKey: 'nav2.sectionWorkspace',
      items: [
        { to: '/profile', labelKey: 'nav.profile', icon: 'user' },
        { labelKey: 'nav2.tasks', icon: 'check', soon: true },
        { labelKey: 'nav2.earnings', icon: 'dashboard', soon: true },
        { to: '/settings', labelKey: 'nav.settings', icon: 'settings' },
      ],
    },
  ]

  return raw
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.internalOnly && isAffiliate.value) return false
        if (item.permission && !auth.hasPermission(item.permission)) return false
        return true
      }),
    }))
    .filter((section) => section.items.length > 0)
})
</script>

<template>
  <aside class="sidebar" :class="{ 'is-open': ui.sidebarOpen }">
    <div class="sidebar-head">
      <RouterLink to="/" class="sidebar-brand" @click="ui.closeSidebar()">
        <BrandLogo :size="30" with-name />
      </RouterLink>
      <button
        type="button"
        class="btn btn-ghost btn-icon sidebar-dismiss"
        :aria-label="t('nav.closeMenu')"
        @click="ui.closeSidebar()"
      >
        <AppIcon name="close" :size="18" />
      </button>
    </div>

    <nav class="sidebar-nav" :aria-label="t('a11y.mainNavigation')">
      <div v-for="section in sections" :key="section.titleKey" class="nav-section">
        <p class="eyebrow nav-section-title">{{ t(section.titleKey) }}</p>

        <template v-for="item in section.items" :key="item.labelKey">
          <RouterLink
            v-if="item.to"
            :to="item.to"
            class="nav-item"
            active-class="is-active"
            @click="ui.closeSidebar()"
          >
            <AppIcon :name="item.icon" :size="17" />
            <span class="nav-label">{{ t(item.labelKey) }}</span>
          </RouterLink>

          <span v-else class="nav-item is-soon" :title="t('nav2.soonTitle')">
            <AppIcon :name="item.icon" :size="17" />
            <span class="nav-label">{{ t(item.labelKey) }}</span>
            <span class="soon-tag">{{ t('nav2.soon') }}</span>
          </span>
        </template>
      </div>
    </nav>

    <div class="sidebar-foot">
      <p class="tertiary sidebar-version">{{ t('app.tagline') }}</p>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: var(--sidebar-width);
  height: 100dvh;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
  position: sticky;
  top: 0;
  flex-shrink: 0;
}

.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--topbar-height);
  padding-inline: var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  text-decoration: none;
  border-radius: var(--radius-sm);
}

.sidebar-brand:hover {
  text-decoration: none;
}

.sidebar-dismiss {
  display: none;
}

.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-4) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.nav-section {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-section-title {
  padding: 0 var(--space-3);
  margin-bottom: var(--space-2);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 0 var(--space-3);
  height: 34px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--text-base);
  font-weight: 500;
  text-decoration: none;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

a.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  text-decoration: none;
}

.nav-item.is-active {
  background: var(--accent-soft-bg);
  color: var(--text-brand);
  font-weight: 600;
}

/* Planned, not built. Visible so the shape of the system is legible. */
.nav-item.is-soon {
  color: var(--text-tertiary);
  cursor: default;
  opacity: 0.75;
}

.soon-tag {
  margin-left: auto;
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--bg-surface-3);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-tertiary);
}

.nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-foot {
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.sidebar-version {
  font-size: var(--text-xs);
}

@media (max-width: 900px) {
  .sidebar {
    position: fixed;
    inset-block: 0;
    inset-inline-start: 0;
    z-index: var(--z-overlay);
    transform: translateX(-100%);
    transition: transform var(--dur-slow) var(--ease-out);
    box-shadow: var(--shadow-lg);
  }

  .sidebar.is-open {
    transform: translateX(0);
  }

  .sidebar-dismiss {
    display: inline-flex;
  }
}
</style>
