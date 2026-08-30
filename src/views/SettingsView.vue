<script setup lang="ts">
/**
 * Settings — what belongs to the person using the application.
 *
 * Deliberately small. Company-wide configuration lives where the permission
 * that guards it lives: departments and positions under Organization, access
 * under Roles & Permissions. This page is reachable by everybody, so anything
 * placed here is something everybody may change about themselves.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher.vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { PERMISSIONS, type Permission } from '@/types/permissions'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

/**
 * Signposts, not the settings themselves.
 *
 * Company-wide configuration stays on its own routes, each carrying one
 * permission checked in one place. Nesting it here would make this a single
 * page with five different access levels, which is the arrangement that let
 * the department list leak to everybody before it was split out.
 *
 * What belongs here is a way to find those pages, filtered to the ones the
 * viewer can actually open.
 */
const adminLinks = computed(() =>
  [
    {
      to: '/requests',
      labelKey: 'nav.requests',
      descKey: 'settingsHub.requestsDesc',
      icon: 'inbox',
      permission: PERMISSIONS.REQUESTS_VIEW,
    },
    {
      to: '/roles',
      labelKey: 'nav.roles',
      descKey: 'settingsHub.rolesDesc',
      icon: 'shield',
      permission: PERMISSIONS.ROLES_VIEW,
    },
    {
      to: '/organization',
      labelKey: 'nav2.organization',
      descKey: 'settingsHub.organizationDesc',
      icon: 'building',
      permission: PERMISSIONS.DEPARTMENTS_MANAGE,
    },
    {
      to: '/audit',
      labelKey: 'nav.audit',
      descKey: 'settingsHub.auditDesc',
      icon: 'scroll',
      permission: PERMISSIONS.AUDIT_VIEW,
    },
  ].filter((link) => auth.hasPermission(link.permission as Permission)),
)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('nav.settings') }}</h1>
        <p class="page-subtitle">{{ t('settings.personal') }}</p>
      </div>
    </header>

    <section class="card">
      <div class="card-body prefs">
        <div class="pref">
          <div>
            <p class="field-label">{{ t('language.label') }}</p>
            <p class="field-hint">{{ t('settings.languageHint') }}</p>
          </div>
          <LanguageSwitcher />
        </div>

        <div class="pref">
          <div>
            <p class="field-label">{{ t('theme.label') }}</p>
            <p class="field-hint">{{ t('settings.themeHint') }}</p>
          </div>
          <button class="btn btn-secondary btn-sm" @click="ui.toggleTheme()">
            <AppIcon :name="ui.theme === 'dark' ? 'sun' : 'moon'" :size="15" />
            {{ ui.theme === 'dark' ? t('theme.light') : t('theme.dark') }}
          </button>
        </div>

        <div class="pref">
          <div>
            <p class="field-label">{{ t('nav.profile') }}</p>
            <p class="field-hint">{{ t('visibility.ceoNotice') }}</p>
          </div>
          <RouterLink to="/profile" class="btn btn-secondary btn-sm">
            {{ t('common.edit') }}
          </RouterLink>
        </div>

        <div class="pref">
          <div>
            <p class="field-label">{{ t('auth.email') }}</p>
            <p class="field-hint mono">{{ auth.email }}</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Where the company-wide settings live --------------------------- -->
    <section v-if="adminLinks.length > 0" class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">{{ t('settingsHub.administration') }}</h2>
          <p class="field-hint">{{ t('settingsHub.administrationHint') }}</p>
        </div>
      </div>

      <div class="admin-grid">
        <RouterLink v-for="link in adminLinks" :key="link.to" :to="link.to" class="admin-link">
          <span class="admin-icon"><AppIcon :name="link.icon" :size="17" /></span>
          <span class="admin-text">
            <span class="admin-name">{{ t(link.labelKey) }}</span>
            <span class="admin-desc">{{ t(link.descKey) }}</span>
          </span>
          <AppIcon name="chevronRight" :size="15" class="tertiary" />
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.prefs {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.pref {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.mono {
  font-family: var(--font-mono);
}

.admin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1px;
  background: var(--border-subtle);
  border-top: 1px solid var(--border-subtle);
}

.admin-link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-6);
  background: var(--bg-surface);
  text-decoration: none;
  color: inherit;
  transition: background var(--dur-fast) var(--ease-out);
}

.admin-link:hover {
  background: var(--bg-hover);
  text-decoration: none;
}

.admin-icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--bg-surface-3);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.admin-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.admin-name {
  font-size: var(--text-base);
  font-weight: 550;
}

.admin-desc {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
</style>
