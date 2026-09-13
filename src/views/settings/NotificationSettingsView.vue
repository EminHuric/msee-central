<script setup lang="ts">
/**
 * Notification preferences, and sending an announcement.
 *
 * The two belong on one page because they are the two halves of the same
 * question: what reaches people, and what you send them.
 *
 * An announcement is a notification with a chosen audience, not a chat thread.
 * There is deliberately no messaging in this system — the CEO telling people
 * something does not need a conversation model around it.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import { fetchEmployees } from '@/api/employees'
import { fetchDepartments } from '@/api/organisation'
import { fetchPreferences, notifyMany, savePreferences } from '@/api/notifications'
import { logAudit } from '@/api/audit'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { ANNOUNCEMENT_AUDIENCES, NOTIFICATION_KINDS, type NotificationKind } from '@/types/company'
import { PERMISSIONS } from '@/types/permissions'
import type { Department, EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const loading = ref(true)
const saving = ref(false)

const muted = ref<NotificationKind[]>([])
const people = ref<EmployeePublic[]>([])
const departments = ref<Department[]>([])

const audience = ref<'everyone' | 'department' | 'selected'>('everyone')
const departmentId = ref('')
const chosen = ref<string[]>([])
const title = ref('')
const body = ref('')

const canAnnounce = computed(() => auth.hasPermission(PERMISSIONS.ANNOUNCEMENTS_SEND))

const recipients = computed(() => {
  if (audience.value === 'everyone') return people.value
  if (audience.value === 'department') {
    return people.value.filter((p) => p.departmentId === departmentId.value)
  }
  return people.value.filter((p) => chosen.value.includes(p.uid))
})

async function load(): Promise<void> {
  loading.value = true
  try {
    const [prefs, e, d] = await Promise.all([
      auth.uid ? fetchPreferences(auth.uid) : Promise.resolve({ uid: '', muted: [], updatedAt: '' }),
      fetchEmployees().catch(() => []),
      fetchDepartments().catch(() => []),
    ])
    muted.value = prefs.muted ?? []
    people.value = e
    departments.value = d
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function toggleKind(kind: NotificationKind): Promise<void> {
  const i = muted.value.indexOf(kind)
  if (i >= 0) muted.value.splice(i, 1)
  else muted.value.push(kind)

  if (!auth.uid) return
  try {
    await savePreferences({ uid: auth.uid, muted: muted.value, updatedAt: '' })
    ui.notify('ok', t('notifications.saved'))
  } catch {
    ui.notify('danger', t('errors.generic'))
  }
}

function togglePerson(uid: string): void {
  const i = chosen.value.indexOf(uid)
  if (i >= 0) chosen.value.splice(i, 1)
  else chosen.value.push(uid)
}

/**
 * Send an announcement.
 *
 * It reaches people as a notification each, and is written to the audit log —
 * "the CEO told everybody X on this date" is exactly the kind of thing worth
 * being able to look up later.
 */
async function send(): Promise<void> {
  if (saving.value || !title.value.trim() || recipients.value.length === 0) {
    ui.notify('danger', t('announce.needTitle'))
    return
  }

  saving.value = true
  try {
    await notifyMany(
      recipients.value.map((p) => p.uid),
      {
        kind: 'announcement',
        priority: 'important',
        title: title.value.trim(),
        body: body.value.trim().slice(0, 200),
        link: null,
      },
    )

    await logAudit({
      action: 'announcement.sent',
      targetType: 'settings',
      targetId: 'announcement',
      targetLabel: title.value.trim(),
      metadata: { recipients: recipients.value.length, audience: audience.value },
    })

    ui.notify('ok', t('announce.sent'))
    title.value = ''
    body.value = ''
    chosen.value = []
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="stack">
    <!-- Preferences ---------------------------------------------------- -->
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">{{ t('notifications.preferences') }}</h2>
          <p class="field-hint">{{ t('notifications.preferencesHint') }}</p>
        </div>
      </div>

      <div v-if="loading" class="card-body stack">
        <div class="skeleton" style="height: 80px" />
      </div>

      <div v-else class="card-body kinds">
        <label v-for="kind in NOTIFICATION_KINDS" :key="kind" class="check">
          <input type="checkbox" :checked="!muted.includes(kind)" @change="toggleKind(kind)" />
          <span class="check-text">{{ t(`notificationKind.${kind}`) }}</span>
        </label>
      </div>
    </section>

    <!-- Announcements -------------------------------------------------- -->
    <section v-if="canAnnounce" class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">{{ t('announce.title') }}</h2>
          <p class="field-hint">{{ t('announce.hint') }}</p>
        </div>
      </div>

      <div class="card-body stack">
        <div class="field">
          <label class="field-label" for="an-title">
            {{ t('announce.subject') }}<span class="req">*</span>
          </label>
          <input id="an-title" v-model="title" class="input" :maxlength="LIMITS.position" />
        </div>

        <div class="field">
          <label class="field-label" for="an-body">{{ t('announce.message') }}</label>
          <textarea id="an-body" v-model="body" class="textarea" rows="3" :maxlength="LIMITS.longText" />
        </div>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="an-aud">{{ t('announce.audience') }}</label>
            <select id="an-aud" v-model="audience" class="select">
              <option v-for="a in ANNOUNCEMENT_AUDIENCES" :key="a" :value="a">
                {{ t(`announceAudience.${a}`) }}
              </option>
            </select>
          </div>

          <div v-if="audience === 'department'" class="field">
            <label class="field-label" for="an-dept">{{ t('table.department') }}</label>
            <select id="an-dept" v-model="departmentId" class="select">
              <option value="">—</option>
              <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </div>
        </div>

        <div v-if="audience === 'selected'" class="field">
          <span class="field-label">{{ t('announce.people') }}</span>
          <div class="picker">
            <label v-for="p in people" :key="p.uid" class="check">
              <input
                type="checkbox"
                :checked="chosen.includes(p.uid)"
                @change="togglePerson(p.uid)"
              />
              <span class="check-text">{{ p.firstName }} {{ p.lastName }}</span>
            </label>
          </div>
        </div>
      </div>

      <div class="card-footer">
        <span class="tertiary small">
          {{ t('announce.willReach', { n: recipients.length }) }}
        </span>
        <span class="spacer" />
        <button class="btn btn-primary" :disabled="saving || !title.trim()" @click="send">
          <AppIcon name="send" :size="15" />
          <span v-if="saving" class="spinner" />{{ t('announce.send') }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.kinds { display: flex; flex-wrap: wrap; gap: var(--space-3) var(--space-5); }
.picker { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-2); max-height: 200px; overflow-y: auto; }
.spacer { flex: 1; }
.small { font-size: var(--text-xs); }
</style>
