<script setup lang="ts">
/**
 * The general settings page.
 *
 * What genuinely belongs to the person using the application — appearance,
 * language — plus two things worth stating in the open: which automations run,
 * and where security is actually enforced.
 *
 * The automations are listed rather than configurable, and that is the point.
 * Each is a direct consequence of an action or a date, with nothing to switch
 * on and nothing that can silently stop working. A rules engine nobody has set
 * up is worse than no rules engine at all.
 */

import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher.vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { RETENTION_DAYS } from '@/types/records'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const automations = [
  'settingsHub.autoLeadAssigned',
  'settingsHub.autoSaleRecorded',
  'settingsHub.autoPayment',
  'settingsHub.autoCommission',
  'settingsHub.autoOverdue',
  'settingsHub.autoAdvance',
  'settingsHub.autoProjectDeadline',
  'settingsHub.autoBonus',
  'settingsHub.autoWork',
  'settingsHub.autoGoals',
]
</script>

<template>
  <div class="stack">
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">{{ t('settingsHub.appearance') }}</h2>
      </div>

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
            <p class="field-label">{{ t('auth.email') }}</p>
            <p class="field-hint mono">{{ auth.email }}</p>
          </div>
          <RouterLink to="/profile" class="btn btn-secondary btn-sm">
            {{ t('common.edit') }}
          </RouterLink>
        </div>
      </div>
    </section>

    <!-- Automations -------------------------------------------------- -->
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">{{ t('settingsHub.automationsTitle') }}</h2>
          <p class="field-hint">{{ t('settingsHub.automationsHint') }}</p>
        </div>
      </div>

      <ul class="automations">
        <li v-for="key in automations" :key="key">
          <AppIcon name="check" :size="14" />
          {{ t(key) }}
        </li>
      </ul>
    </section>

    <!-- Data --------------------------------------------------------- -->
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">{{ t('settingsHub.dataTitle') }}</h2>
      </div>
      <div class="card-body stack">
        <p class="text">{{ t('settingsHub.retentionText', { days: RETENTION_DAYS }) }}</p>
        <RouterLink to="/settings/recycle" class="btn btn-secondary btn-sm">
          <AppIcon name="trash" :size="15" /> {{ t('recycle.title') }}
        </RouterLink>
      </div>
    </section>

    <!-- Security ----------------------------------------------------- -->
    <section class="card security">
      <div class="card-body">
        <p class="sec-title">
          <AppIcon name="shield" :size="16" /> {{ t('settingsHub.security') }}
        </p>
        <p class="sec-text">{{ t('settingsHub.securityHint') }}</p>
        <p class="sec-text tertiary">{{ t('settingsHub.rulesVerified') }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.prefs { display: flex; flex-direction: column; gap: var(--space-6); }
.pref { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.mono { font-family: var(--font-mono); }
.text { font-size: var(--text-sm); line-height: var(--leading-relaxed); color: var(--text-secondary); }

.automations { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--border-subtle); }
.automations li {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  font-size: var(--text-sm); color: var(--text-secondary);
  border-bottom: 1px solid var(--border-subtle);
}
.automations li:last-child { border-bottom: none; }
.automations svg { color: var(--ok-500); flex-shrink: 0; }

.security { border-color: var(--accent-soft-border); background: var(--accent-soft-bg); }
.sec-title { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-base); font-weight: 650; color: var(--text-brand); }
.sec-text { font-size: var(--text-sm); line-height: var(--leading-relaxed); margin-top: var(--space-2); }
</style>
