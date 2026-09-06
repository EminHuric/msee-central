<script setup lang="ts">
/**
 * Settings — the hub over everything you configure rather than use.
 *
 * Company-wide configuration keeps its own routes, each carrying one
 * permission checked in one place. This page is a signposted way in, filtered
 * to what the viewer can actually open; nesting the pages themselves here
 * would produce one screen with six different access levels, which is exactly
 * the arrangement that leaked the department list before it was split out.
 *
 * What genuinely lives here is what belongs to the person: appearance,
 * language, and which events reach their bell.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher.vue'
import { fetchPreferences, savePreferences } from '@/api/notifications'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { NOTIFICATION_KINDS, type NotificationKind } from '@/types/company'
import { PERMISSIONS, type Permission } from '@/types/permissions'

const auth = useAuthStore()
const ui = useUiStore()
const route = useRoute()
const { t } = useI18n()

const muted = ref<NotificationKind[]>([])
const savingPrefs = ref(false)
const prefsOpen = ref(false)

interface HubLink {
  to: string
  labelKey: string
  descKey: string
  icon: string
  permission?: Permission
}

/** Grouped by what a person is trying to do, not by which module owns it. */
const groups = computed(() => {
  const raw: { titleKey: string; links: HubLink[] }[] = [
    {
      titleKey: 'settingsHub.companyGroup',
      links: [
        {
          to: '/services',
          labelKey: 'modules.services',
          descKey: 'settingsHub.servicesDesc',
          icon: 'spark',
          permission: PERMISSIONS.SERVICES_VIEW,
        },
        {
          to: '/affiliates',
          labelKey: 'modules.affiliateProgram',
          descKey: 'settingsHub.affiliatesDesc',
          icon: 'gift',
          permission: PERMISSIONS.AFFILIATES_VIEW,
        },
        {
          to: '/goals',
          labelKey: 'modules.goals',
          descKey: 'settingsHub.goalsDesc',
          icon: 'flag',
          permission: PERMISSIONS.GOALS_VIEW,
        },
        {
          to: '/organization',
          labelKey: 'nav2.organization',
          descKey: 'settingsHub.organizationDesc',
          icon: 'building',
          permission: PERMISSIONS.DEPARTMENTS_MANAGE,
        },
      ],
    },
    {
      titleKey: 'settingsHub.administration',
      links: [
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
          to: '/employees',
          labelKey: 'modules.employees',
          descKey: 'settingsHub.dataHint',
          icon: 'users',
          permission: PERMISSIONS.EMPLOYEES_VIEW,
        },
        {
          to: '/audit',
          labelKey: 'nav.audit',
          descKey: 'settingsHub.auditDesc',
          icon: 'scroll',
          permission: PERMISSIONS.AUDIT_VIEW,
        },
      ],
    },
  ]

  return raw
    .map((group) => ({
      ...group,
      links: group.links.filter((link) => !link.permission || auth.hasPermission(link.permission)),
    }))
    .filter((group) => group.links.length > 0)
})

/**
 * The automations that actually run.
 *
 * Listed rather than configurable, and that is the point: each one is a direct
 * consequence of an action or a date, with nothing to switch on and nothing
 * that can silently stop working. A rules engine nobody has set up is worse
 * than no rules engine at all.
 */
const automations = [
  'settingsHub.autoTaskAssigned',
  'settingsHub.autoLeadAssigned',
  'settingsHub.autoOverdue',
  'settingsHub.autoContract',
  'settingsHub.autoCommission',
  'settingsHub.autoGoals',
  'settingsHub.autoAnnouncement',
]

function toggleKind(kind: NotificationKind): void {
  const i = muted.value.indexOf(kind)
  if (i >= 0) muted.value.splice(i, 1)
  else muted.value.push(kind)
  void persist()
}

async function persist(): Promise<void> {
  if (!auth.uid || savingPrefs.value) return
  savingPrefs.value = true
  try {
    await savePreferences({ uid: auth.uid, muted: muted.value, updatedAt: '' })
    ui.notify('ok', t('notifications.saved'))
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    savingPrefs.value = false
  }
}

onMounted(async () => {
  if (auth.uid) muted.value = (await fetchPreferences(auth.uid)).muted ?? []
  if (route.query.tab === 'notifications') prefsOpen.value = true
})

watch(
  () => route.query.tab,
  (tab) => {
    if (tab === 'notifications') prefsOpen.value = true
  },
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

    <!-- Your account ---------------------------------------------------- -->
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">{{ t('settingsHub.workspaceGroup') }}</h2>
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
            <p class="field-label">{{ t('nav.profile') }}</p>
            <p class="field-hint">{{ t('settingsHub.profileDesc') }}</p>
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

    <!-- Notification preferences ---------------------------------------- -->
    <section class="card">
      <button type="button" class="card-header disclosure" @click="prefsOpen = !prefsOpen">
        <div>
          <h2 class="card-title">{{ t('notifications.preferences') }}</h2>
          <p class="field-hint">{{ t('settingsHub.notificationsDesc') }}</p>
        </div>
        <AppIcon name="chevronDown" :size="16" :class="{ 'rot-180': prefsOpen }" />
      </button>

      <div v-if="prefsOpen" class="card-body">
        <p class="field-hint">{{ t('notifications.preferencesHint') }}</p>
        <div class="kinds">
          <label v-for="kind in NOTIFICATION_KINDS" :key="kind" class="check">
            <input
              type="checkbox"
              :checked="!muted.includes(kind)"
              @change="toggleKind(kind)"
            />
            <span class="check-text">{{ t(`notificationKind.${kind}`) }}</span>
          </label>
        </div>
      </div>
    </section>

    <!-- Configuration signposts ------------------------------------------ -->
    <section v-for="group in groups" :key="group.titleKey" class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">{{ t(group.titleKey) }}</h2>
          <p class="field-hint">{{ t('settingsHub.administrationHint') }}</p>
        </div>
      </div>

      <div class="admin-grid">
        <RouterLink v-for="link in group.links" :key="link.to" :to="link.to" class="admin-link">
          <span class="admin-icon"><AppIcon :name="link.icon" :size="17" /></span>
          <span class="admin-text">
            <span class="admin-name">{{ t(link.labelKey) }}</span>
            <span class="admin-desc">{{ t(link.descKey) }}</span>
          </span>
          <AppIcon name="chevronRight" :size="15" class="tertiary" />
        </RouterLink>
      </div>
    </section>

    <!-- Automations ------------------------------------------------------ -->
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

    <!-- Security --------------------------------------------------------- -->
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

.disclosure { width: 100%; text-align: left; cursor: pointer; }
.disclosure:hover { background: var(--bg-hover); }
.rot-180 { transform: rotate(180deg); }

.kinds { display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-5); margin-top: var(--space-3); }

.admin-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 1px;
  background: var(--border-subtle);
  border-top: 1px solid var(--border-subtle);
}

.admin-link {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-4) var(--space-6);
  background: var(--bg-surface); text-decoration: none; color: inherit;
  transition: background var(--dur-fast) var(--ease-out);
}
.admin-link:hover { background: var(--bg-hover); text-decoration: none; }

.admin-icon {
  display: grid; place-items: center; width: 32px; height: 32px;
  border-radius: var(--radius-md); background: var(--bg-surface-3);
  color: var(--text-secondary); flex-shrink: 0;
}
.admin-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.admin-name { font-size: var(--text-base); font-weight: 550; }
.admin-desc { font-size: var(--text-xs); color: var(--text-tertiary); }

.automations { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--border-subtle); }
.automations li {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-3) var(--space-6);
  font-size: var(--text-sm); color: var(--text-secondary);
  border-bottom: 1px solid var(--border-subtle);
}
.automations li:last-child { border-bottom: none; }
.automations svg { color: var(--ok-500); flex-shrink: 0; }

.security { border-color: var(--accent-soft-border); background: var(--accent-soft-bg); }
.sec-title { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-base); font-weight: 650; color: var(--text-brand); }
.sec-text { font-size: var(--text-sm); line-height: var(--leading-relaxed); margin-top: var(--space-2); }
</style>
