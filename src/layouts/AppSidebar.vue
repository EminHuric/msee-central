<script setup lang="ts">
/**
 * Primary navigation.
 *
 * The full map of the system, grouped by what somebody is doing rather than
 * by which module built it.
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

/**
 * A menu entry.
 *
 * `to` is required. There used to be an optional `soon` flag that rendered an
 * entry flat and unclickable, and every module it marked is now built — so the
 * flag is gone rather than left available. A menu that can contain a dead
 * entry will eventually contain one.
 */
interface NavItem {
  to: string
  labelKey: string
  icon: string
  permission?: Permission
  /** Hidden from affiliates, who are outside the company. */
  internalOnly?: boolean
}

interface NavSection {
  titleKey: string
  items: NavItem[]
}

const isAffiliate = computed(() => auth.access?.accountType === 'affiliate')

const sections = computed<NavSection[]>(() => {
  /*
   * The final shape. Administration is deliberately absent: roles, the
   * organisation chart, registration requests and the audit log live under
   * Settings, because they are configured once and then left alone. Beside
   * the daily work they only made this list longer.
   */
  const raw: NavSection[] = [
    {
      titleKey: 'modules.groupMain',
      items: [
        { to: '/', labelKey: 'nav.dashboard', icon: 'dashboard' },
        { to: '/workspace', labelKey: 'workspace.title', icon: 'briefcase' },
      ],
    },
    {
      titleKey: 'modules.groupBusiness',
      items: [
        {
          to: '/clients',
          labelKey: 'modules.clients',
          icon: 'building',
          permission: PERMISSIONS.CLIENTS_VIEW,
          internalOnly: true,
        },
        {
          to: '/leads',
          labelKey: 'modules.leads',
          icon: 'target',
          permission: PERMISSIONS.LEADS_VIEW,
        },
        {
          to: '/projects',
          labelKey: 'modules.projects',
          icon: 'layers',
          permission: PERMISSIONS.PROJECTS_VIEW,
          internalOnly: true,
        },
        {
          to: '/sales',
          labelKey: 'modules.sales',
          icon: 'trending',
          permission: PERMISSIONS.SALES_VIEW,
          internalOnly: true,
        },
        {
          to: '/services',
          labelKey: 'modules.services',
          icon: 'spark',
          permission: PERMISSIONS.SERVICES_VIEW,
          internalOnly: true,
        },
        { to: '/affiliates', labelKey: 'modules.affiliateProgram', icon: 'gift' },
        {
          to: '/finance',
          labelKey: 'modules.finance',
          icon: 'wallet',
          permission: PERMISSIONS.FINANCE_VIEW,
          internalOnly: true,
        },
      ],
    },
    {
      titleKey: 'modules.groupTeam',
      items: [
        {
          to: '/employees',
          labelKey: 'modules.employees',
          icon: 'users',
          permission: PERMISSIONS.EMPLOYEES_VIEW,
          internalOnly: true,
        },
        {
          to: '/goals',
          labelKey: 'modules.goals',
          icon: 'flag',
          permission: PERMISSIONS.GOALS_VIEW,
          internalOnly: true,
        },
        {
          to: '/bonuses',
          labelKey: 'modules.bonuses',
          icon: 'gift',
          permission: PERMISSIONS.BONUSES_VIEW,
          internalOnly: true,
        },
        {
          to: '/earnings',
          labelKey: 'wallet.title',
          icon: 'wallet',
          permission: PERMISSIONS.WALLET_VIEW_OWN,
        },
        {
          to: '/performance',
          labelKey: 'modules.performance',
          icon: 'gauge',
          permission: PERMISSIONS.PERFORMANCE_VIEW,
          internalOnly: true,
        },
      ],
    },
    {
      titleKey: 'modules.groupTools',
      items: [
        {
          to: '/calendar',
          labelKey: 'modules.calendar',
          icon: 'calendar',
          permission: PERMISSIONS.CALENDAR_VIEW,
          internalOnly: true,
        },
        {
          to: '/trading',
          labelKey: 'trading.title',
          icon: 'layers',
          permission: PERMISSIONS.FINANCE_VIEW,
        },
        {
          to: '/analytics',
          labelKey: 'modules.analytics',
          icon: 'chart',
          permission: PERMISSIONS.ANALYTICS_VIEW,
          internalOnly: true,
        },
      ],
    },
    {
      titleKey: 'modules.groupSystem',
      items: [{ to: '/settings', labelKey: 'nav.settings', icon: 'settings' }],
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
            :to="item.to"
            class="nav-item"
            active-class="is-active"
            @click="ui.closeSidebar()"
          >
            <AppIcon :name="item.icon" :size="17" />
            <span class="nav-label">{{ t(item.labelKey) }}</span>
          </RouterLink>
        </template>
      </div>
    </nav>

    <div class="sidebar-foot">
      <RouterLink
        to="/settings"
        class="nav-item"
        active-class="is-active"
        @click="ui.closeSidebar()"
      >
        <AppIcon name="settings" :size="17" />
        <span class="nav-label">{{ t('nav.settings') }}</span>
      </RouterLink>
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


.nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-foot {
  padding: var(--space-3);
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
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
