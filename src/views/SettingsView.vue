<script setup lang="ts">
/**
 * Settings — what belongs to the person using the application.
 *
 * Deliberately small. Company-wide configuration lives where the permission
 * that guards it lives: departments and positions under Organization, access
 * under Roles & Permissions. This page is reachable by everybody, so anything
 * placed here is something everybody may change about themselves.
 */

import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher.vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()
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
</style>
