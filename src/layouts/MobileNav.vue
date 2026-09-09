<script setup lang="ts">
/**
 * Bottom navigation, on phones and small tablets only.
 *
 * A sidebar is a good way to show twenty destinations to somebody with a mouse
 * and a wide screen. On a phone it is a drawer you have to open before you can
 * do anything, which puts every journey one extra tap away.
 *
 * So the four things people actually do all day sit permanently at the bottom,
 * within thumb reach, and everything else is behind "More" — which opens the
 * same sidebar as before, so there is one menu, not two that can disagree.
 *
 * The middle button adds something. It is raised because it is the only
 * control here that creates rather than navigates, and because on a phone the
 * "+" in the corner of a page header is the hardest thing on the screen to
 * reach.
 *
 * WHAT IT IS NOT: a copy of a social app. The shapes are this application's —
 * same tokens, same icons, same weights — and the destinations are a business
 * system's. Only the principle is borrowed: what you use most should always be
 * one tap away.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { PERMISSIONS, type Permission } from '@/types/permissions'

const auth = useAuthStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const addOpen = ref(false)

interface Destination {
  to: string
  labelKey: string
  icon: string
  permission: Permission | null
}

/**
 * Four destinations, not five: the fifth would be a compromise, and every one
 * here has to earn a permanent place on a small screen.
 */
const DESTINATIONS: Destination[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: 'dashboard', permission: null },
  { to: '/clients', labelKey: 'nav.clients', icon: 'building', permission: PERMISSIONS.CLIENTS_VIEW },
  { to: '/leads', labelKey: 'nav.leads', icon: 'target', permission: PERMISSIONS.LEADS_VIEW },
  { to: '/workspace', labelKey: 'workspace.title', icon: 'briefcase', permission: null },
]

const visible = computed(() =>
  DESTINATIONS.filter((d) => d.permission === null || auth.hasPermission(d.permission)),
)

/** Highlighted when the current route is this destination or lives under it. */
function isCurrent(to: string): boolean {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}

/* ---- Quick add -------------------------------------------------------- */

interface QuickAdd {
  to: string
  labelKey: string
  icon: string
  permission: Permission
}

/**
 * Where "+" can take you.
 *
 * Each entry navigates to the list that owns the record, which is where its
 * editor lives — rather than a second creation form kept in step by hand.
 */
const ADDS: QuickAdd[] = [
  { to: '/clients?new=1', labelKey: 'clients.newClient', icon: 'building', permission: PERMISSIONS.CLIENTS_CREATE },
  { to: '/leads?new=1', labelKey: 'leads.newLead', icon: 'target', permission: PERMISSIONS.LEADS_CREATE },
  { to: '/sales?new=1', labelKey: 'sales.newSale', icon: 'trending', permission: PERMISSIONS.SALES_CREATE },
  { to: '/finance?new=income', labelKey: 'finance.addIncome', icon: 'wallet', permission: PERMISSIONS.FINANCE_CREATE },
  { to: '/finance?new=expense', labelKey: 'finance.addExpense', icon: 'wallet', permission: PERMISSIONS.FINANCE_CREATE },
  { to: '/projects?new=1', labelKey: 'projects.newProject', icon: 'layers', permission: PERMISSIONS.PROJECTS_CREATE },
]

const adds = computed(() => ADDS.filter((a) => auth.hasPermission(a.permission)))

async function go(to: string): Promise<void> {
  addOpen.value = false
  await router.push(to)
}
</script>

<template>
  <nav class="mobile-nav" :aria-label="t('nav.openMenu')">
    <RouterLink
      v-for="destination in visible"
      :key="destination.to"
      :to="destination.to"
      class="nav-item"
      :class="{ 'is-current': isCurrent(destination.to) }"
    >
      <AppIcon :name="destination.icon" :size="20" />
      <span class="nav-label">{{ t(destination.labelKey) }}</span>
    </RouterLink>

    <!-- Create. Raised, because it is the one control here that is not a
         destination, and the easiest place on a phone to reach. -->
    <button
      v-if="adds.length"
      type="button"
      class="nav-add"
      :aria-label="t('quickAdd.title')"
      :aria-expanded="addOpen"
      @click="addOpen = !addOpen"
    >
      <AppIcon name="plus" :size="22" />
    </button>

    <button
      type="button"
      class="nav-item"
      :aria-label="t('nav.openMenu')"
      @click="ui.toggleSidebar()"
    >
      <AppIcon name="menu" :size="20" />
      <span class="nav-label">{{ t('nav.more') }}</span>
    </button>
  </nav>

  <!-- The add sheet -->
  <Transition name="sheet">
    <div v-if="addOpen" class="sheet-scrim" @click="addOpen = false">
      <div class="sheet" role="dialog" :aria-label="t('quickAdd.title')" @click.stop>
        <p class="sheet-title">{{ t('quickAdd.title') }}</p>
        <button
          v-for="add in adds"
          :key="add.to"
          type="button"
          class="sheet-item"
          @click="go(add.to)"
        >
          <AppIcon :name="add.icon" :size="18" />
          {{ t(add.labelKey) }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Rendered only where there is no sidebar to use. */
@media (min-width: 901px) {
  .mobile-nav,
  .sheet-scrim { display: none; }
}

.mobile-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: var(--z-sticky);
  display: flex;
  align-items: stretch;
  justify-content: space-around;
  height: var(--bottom-nav-height);
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--bg-surface);
  border-top: 1px solid var(--border-default);
}

.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 0;
  color: var(--text-tertiary);
  /* Comfortably past the 44px anybody recommends for a thumb. */
  min-height: 48px;
}

.nav-item.is-current,
.nav-item.router-link-exact-active {
  color: var(--text-brand);
}

.nav-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.01em;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav-add {
  flex: 0 0 auto;
  align-self: center;
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  margin: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--accent);
  color: var(--accent-text);
  box-shadow: var(--shadow-md);
}

/* ---- The add sheet ---------------------------------------------------- */

.sheet-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--scrim);
  display: flex;
  align-items: flex-end;
}

.sheet {
  width: 100%;
  max-height: 80dvh;
  overflow-y: auto;
  padding: var(--space-4);
  padding-bottom: calc(var(--bottom-nav-height) + env(safe-area-inset-bottom) + var(--space-4));
  background: var(--bg-surface);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  border-top: 1px solid var(--border-default);
}

.sheet-title {
  font-size: var(--text-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
  padding: var(--space-2) var(--space-2) var(--space-3);
}

.sheet-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 48px;
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-md);
  text-align: left;
}

.sheet-item:hover,
.sheet-item:active {
  background: var(--bg-hover);
}

.sheet-enter-active,
.sheet-leave-active {
  transition: opacity var(--dur-base) var(--ease-out);
}

.sheet-enter-active .sheet,
.sheet-leave-active .sheet {
  transition: transform var(--dur-base) var(--ease-out);
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

.sheet-enter-from .sheet,
.sheet-leave-to .sheet {
  transform: translateY(100%);
}
</style>
