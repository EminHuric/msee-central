<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { t } = useI18n()

const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)

const name = computed(() => auth.displayName ?? auth.email ?? '')

function onDocumentPointerDown(event: PointerEvent): void {
  if (!menuOpen.value) return
  if (menuRoot.value && !menuRoot.value.contains(event.target as Node)) {
    menuOpen.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') menuOpen.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onKeydown)
})

async function handleSignOut(): Promise<void> {
  menuOpen.value = false
  await auth.signOut()
  await router.push('/login')
}
</script>

<template>
  <header class="topbar">
    <button
      type="button"
      class="btn btn-ghost btn-icon topbar-burger"
      :aria-label="t('nav.openMenu')"
      @click="ui.toggleSidebar()"
    >
      <AppIcon name="menu" :size="20" />
    </button>

    <div class="topbar-spacer" />

    <div class="topbar-actions">
      <LanguageSwitcher />

      <button
        type="button"
        class="btn btn-ghost btn-icon"
        :aria-label="t('theme.toggle')"
        :title="t('theme.toggle')"
        @click="ui.toggleTheme()"
      >
        <AppIcon :name="ui.theme === 'dark' ? 'sun' : 'moon'" :size="18" />
      </button>

      <div ref="menuRoot" class="user-menu">
        <button
          type="button"
          class="user-trigger"
          :aria-label="t('a11y.userMenu')"
          :aria-expanded="menuOpen"
          aria-haspopup="menu"
          @click="menuOpen = !menuOpen"
        >
          <UserAvatar :name="name" :size="30" />
          <span class="user-name truncate">{{ name }}</span>
          <AppIcon name="chevronDown" :size="15" class="tertiary" />
        </button>

        <Transition name="menu">
          <div v-if="menuOpen" class="menu card" role="menu">
            <div class="menu-head">
              <p class="menu-name truncate">{{ name }}</p>
              <p class="menu-email truncate tertiary">{{ auth.email }}</p>
              <span v-if="auth.isCeo" class="badge badge-accent badge-plain menu-role">CEO</span>
            </div>

            <RouterLink to="/profile" class="menu-item" role="menuitem" @click="menuOpen = false">
              <AppIcon name="user" :size="16" />
              {{ t('nav.profile') }}
            </RouterLink>

            <RouterLink to="/settings" class="menu-item" role="menuitem" @click="menuOpen = false">
              <AppIcon name="settings" :size="16" />
              {{ t('nav.settings') }}
            </RouterLink>

            <hr class="menu-divider" />

            <button type="button" class="menu-item menu-item-danger" role="menuitem" @click="handleSignOut">
              <AppIcon name="logout" :size="16" />
              {{ t('nav.signOut') }}
            </button>
          </div>
        </Transition>
      </div>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--topbar-height);
  padding-inline: var(--space-5);
  background: color-mix(in srgb, var(--bg-base) 82%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border-subtle);
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
}

.topbar-spacer {
  flex: 1;
}

.topbar-burger {
  display: none;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.user-menu {
  position: relative;
}

.user-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2) var(--space-1) var(--space-1);
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.user-trigger:hover {
  background: var(--bg-hover);
  border-color: var(--border-subtle);
}

.user-name {
  font-size: var(--text-sm);
  font-weight: 550;
  max-width: 140px;
}

.menu {
  position: absolute;
  top: calc(100% + var(--space-2));
  right: 0;
  min-width: 232px;
  padding: var(--space-2);
  background: var(--bg-surface-2);
  box-shadow: var(--shadow-lg);
  z-index: var(--z-dropdown);
}

.menu-head {
  padding: var(--space-2) var(--space-3) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: var(--space-2);
}

.menu-name {
  font-size: var(--text-sm);
  font-weight: 600;
}

.menu-email {
  font-size: var(--text-xs);
}

.menu-role {
  margin-top: var(--space-2);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: 0 var(--space-3);
  height: 34px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  text-decoration: none;
  text-align: left;
}

.menu-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
  text-decoration: none;
}

.menu-item-danger:hover {
  color: var(--danger-500);
  background: var(--danger-bg);
}

.menu-divider {
  margin: var(--space-2) var(--space-1);
}

.menu-enter-active,
.menu-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
  transform-origin: top right;
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(-4px);
}

@media (max-width: 900px) {
  .topbar-burger {
    display: inline-flex;
  }

  .user-name {
    display: none;
  }

  .topbar {
    padding-inline: var(--space-4);
  }
}
</style>
