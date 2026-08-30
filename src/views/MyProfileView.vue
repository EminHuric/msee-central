<script setup lang="ts">
/**
 * My Profile.
 *
 * Two kinds of information sit on this page and the split is deliberate:
 *
 *   Professional  — always visible to colleagues. It describes the job, so an
 *                   employee cannot hide it.
 *   Personal      — mandatory to fill in, but each field carries its own
 *                   visibility. Choosing "Private" physically moves the value
 *                   into a document only the owner and the CEO can open.
 *
 * Role, position, department and account status are the CEO's to set and are
 * shown read-only here. The security rules enforce that independently: they
 * accept only photoUrl, bio, skills and expertise from the subject.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import StatusBadge from '@/components/ui/StatusBadge.vue'
import TagInput from '@/components/ui/TagInput.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import VisibilitySelect from '@/components/ui/VisibilitySelect.vue'
import { PhotoError, processProfilePhoto } from '@/api/photos'
import {
  completeness,
  fetchEmployee,
  missingFields,
  saveOwnProfile,
  EMPTY_PERSONAL,
  type EmployeeDetail,
  type MissingField,
  type PersonalRecord,
} from '@/api/employees'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { DEFAULT_PRIVACY, type PrivacySettings } from '@/types/domain'
import { PERMISSIONS } from '@/types/permissions'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const loading = ref(true)
const saving = ref(false)
const loadError = ref(false)
const detail = ref<EmployeeDetail | null>(null)

/* Editable copies, so an abandoned edit never touches the stored profile. */
const photo = ref<string | null>(null)
const photoBusy = ref(false)
const photoInput = ref<HTMLInputElement | null>(null)
const bio = ref('')
const skills = ref<string[]>([])
const expertise = ref<string[]>([])
const personal = ref<PersonalRecord>({ ...EMPTY_PERSONAL })
const privacy = ref<PrivacySettings>({ ...DEFAULT_PRIVACY })

/**
 * Whether this person can set their own work information through the
 * management panel. Telling the CEO their fields are "managed by the CEO" and
 * offering no way through would be nonsense.
 */
const canManageOwnWork = computed(() => auth.hasPermission(PERMISSIONS.EMPLOYEES_EDIT_PROFESSIONAL))

const fullName = computed(() =>
  detail.value ? `${detail.value.profile.firstName} ${detail.value.profile.lastName}`.trim() : '',
)

/** Live preview of completeness, using what is on screen rather than on disk. */
const draft = computed<EmployeeDetail | null>(() => {
  if (!detail.value) return null
  return {
    ...detail.value,
    profile: { ...detail.value.profile, photoUrl: photo.value, bio: bio.value, skills: skills.value },
    personal: personal.value,
  }
})

const percent = computed(() => (draft.value ? completeness(draft.value) : 0))
const missing = computed<MissingField[]>(() => (draft.value ? missingFields(draft.value) : []))

async function load(): Promise<void> {
  if (!auth.uid) return
  loading.value = true
  loadError.value = false

  try {
    const found = await fetchEmployee(auth.uid)
    if (!found) {
      loadError.value = true
      return
    }

    detail.value = found
    photo.value = found.profile.photoUrl
    bio.value = found.profile.bio ?? ''
    skills.value = [...(found.profile.skills ?? [])]
    expertise.value = [...(found.profile.expertise ?? [])]
    personal.value = { ...found.personal }
    privacy.value = { ...DEFAULT_PRIVACY, ...(found.privacy ?? {}) }

    // The sign-in address is the authority for email; never let a stale copy win.
    if (auth.email) personal.value.email = auth.email
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function onPhotoPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  photoBusy.value = true
  try {
    photo.value = await processProfilePhoto(file)
  } catch (error) {
    ui.notify(
      'danger',
      error instanceof PhotoError && error.reason === 'type'
        ? t('errors.fileWrongType')
        : t('errors.fileTooLarge', { max: '12 MB' }),
    )
  } finally {
    photoBusy.value = false
    input.value = ''
  }
}

async function save(): Promise<void> {
  if (!auth.uid || saving.value) return
  saving.value = true

  try {
    await saveOwnProfile(auth.uid, {
      photoUrl: photo.value,
      bio: bio.value,
      skills: skills.value,
      expertise: expertise.value,
      personal: personal.value,
      privacy: privacy.value,
    })
    ui.notify('ok', t('profile.saved'))
    await load()
  } catch {
    ui.notify('danger', t('profile.saveFailed'))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('profile.title') }}</h1>
        <p class="page-subtitle">{{ t('profile.subtitle') }}</p>
      </div>
      <button class="btn btn-primary" :disabled="saving || loading" @click="save">
        <span v-if="saving" class="spinner" />
        {{ saving ? t('common.saving') : t('common.save') }}
      </button>
    </header>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div class="skeleton" style="height: 72px" />
        <div class="skeleton" style="height: 140px" />
      </div>
    </div>

    <div v-else-if="loadError" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="alert" :size="20" /></span>
        <p class="empty-title">{{ t('errors.generic') }}</p>
        <button class="btn btn-secondary" @click="load">{{ t('common.retry') }}</button>
      </div>
    </div>

    <template v-else-if="detail">
      <!-- Completeness ------------------------------------------------- -->
      <div class="card">
        <div class="card-body meter-body">
          <div class="spread">
            <span class="field-label">{{ t('profile.completeness') }}</span>
            <span class="meter-value">{{ percent }}%</span>
          </div>
          <div class="meter" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
            <div class="meter-fill" :style="{ width: `${percent}%` }" />
          </div>
          <p v-if="missing.length === 0" class="field-hint ok-text">
            <AppIcon name="check" :size="14" /> {{ t('profile.complete') }}
          </p>
          <p v-else class="field-hint">
            {{ missing.length === 1 ? t('profile.missingOne') : t('profile.missingMany', { n: missing.length }) }}
          </p>
        </div>
      </div>

      <!-- Identity ----------------------------------------------------- -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('profile.sectionIdentity') }}</h2>
          <span class="badge badge-plain badge-accent">{{ t('profile.visibleToAll') }}</span>
        </div>

        <div class="card-body identity">
          <div class="identity-photo">
            <UserAvatar :name="fullName" :photo-url="photo" :size="96" />
            <div class="row">
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="photoBusy"
                @click="photoInput?.click()"
              >
                <span v-if="photoBusy" class="spinner" />
                {{ photo ? t('register.photoChange') : t('register.photoChoose') }}
              </button>
            </div>
            <p v-if="!photo" class="field-error">{{ t('profile.photoRequired') }}</p>
            <input
              ref="photoInput"
              class="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              @change="onPhotoPicked"
            />
          </div>

          <dl class="facts">
            <div class="fact">
              <dt>{{ t('register.firstName') }} / {{ t('register.lastName') }}</dt>
              <dd>{{ fullName || '—' }}</dd>
            </div>
            <div class="fact">
              <dt>{{ t('profile.employeeCode') }}</dt>
              <dd class="mono">{{ detail.profile.employeeCode || '—' }}</dd>
            </div>
            <div class="fact">
              <dt>{{ t('profile.position') }}</dt>
              <dd>{{ detail.profile.positionId || t('common.notSet') }}</dd>
            </div>
            <div class="fact">
              <dt>{{ t('profile.department') }}</dt>
              <dd>{{ detail.profile.departmentId || t('common.notSet') }}</dd>
            </div>
            <div class="fact">
              <dt>{{ t('common.actions') }}</dt>
              <dd><StatusBadge :status="detail.profile.status" /></dd>
            </div>
            <div class="fact">
              <dt>{{ t('profile.dateJoined') }}</dt>
              <dd>{{ formatDate(detail.profile.dateJoined) }}</dd>
            </div>
          </dl>
        </div>

        <div class="card-footer footer-note">
          <template v-if="canManageOwnWork">
            <AppIcon name="settings" :size="14" />
            <span>{{ t('profile.manageYourOwnHint') }}</span>
            <RouterLink :to="`/employees/${auth.uid}`" class="footer-link">
              {{ t('manage.open') }}
            </RouterLink>
          </template>
          <template v-else>
            <AppIcon name="lock" :size="14" />
            <span>{{ t('profile.managedByCeoHint') }}</span>
          </template>
        </div>
      </section>

      <!-- About -------------------------------------------------------- -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('profile.sectionAbout') }}</h2>
          <span class="badge badge-plain badge-accent">{{ t('profile.visibleToAll') }}</span>
        </div>

        <div class="card-body stack">
          <p class="field-hint">{{ t('profile.visibleToAllHint') }}</p>

          <div class="field">
            <label class="field-label" for="p-bio">
              {{ t('profile.bio') }}<span class="req">*</span>
            </label>
            <textarea id="p-bio" v-model="bio" class="textarea" :maxlength="LIMITS.shortText" />
            <p class="field-hint">{{ t('profile.bioHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="p-skills">
              {{ t('profile.skills') }}<span class="req">*</span>
            </label>
            <TagInput id="p-skills" v-model="skills" />
            <p class="field-hint">{{ t('profile.skillsHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="p-expertise">{{ t('profile.expertise') }}</label>
            <TagInput id="p-expertise" v-model="expertise" />
          </div>
        </div>
      </section>

      <!-- Personal ----------------------------------------------------- -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('profile.sectionPersonal') }}</h2>
          <span class="badge badge-plain">{{ t('profile.youControl') }}</span>
        </div>

        <div class="card-body stack">
          <p class="field-hint">{{ t('profile.youControlHint') }}</p>
          <div class="alert alert-info">
            <AppIcon name="shield" :size="16" />
            <span>{{ t('visibility.ceoNotice') }}</span>
          </div>

          <div class="private-field">
            <div class="field">
              <label class="field-label">{{ t('auth.email') }}</label>
              <input class="input" :value="personal.email" type="email" disabled />
            </div>
            <VisibilitySelect v-model="privacy.email" />
          </div>

          <div class="private-field">
            <div class="field">
              <label class="field-label" for="p-phone">
                {{ t('register.phone') }}<span class="req">*</span>
              </label>
              <input id="p-phone" v-model="personal.phone" class="input" type="tel" :maxlength="LIMITS.phone" />
            </div>
            <VisibilitySelect v-model="privacy.phone" />
          </div>

          <div class="private-field">
            <div class="field">
              <label class="field-label" for="p-city">
                {{ t('register.city') }}<span class="req">*</span>
              </label>
              <input id="p-city" v-model="personal.city" class="input" :maxlength="LIMITS.city" />
            </div>
            <VisibilitySelect v-model="privacy.city" />
          </div>

          <div class="private-field">
            <div class="field">
              <label class="field-label" for="p-country">
                {{ t('register.country') }}<span class="req">*</span>
              </label>
              <input id="p-country" v-model="personal.country" class="input" :maxlength="LIMITS.country" />
            </div>
            <VisibilitySelect v-model="privacy.country" />
          </div>

          <div class="private-field">
            <div class="field">
              <label class="field-label" for="p-desc">
                {{ t('register.personalDescription') }}<span class="req">*</span>
              </label>
              <textarea
                id="p-desc"
                v-model="personal.personalDescription"
                class="textarea"
                :maxlength="LIMITS.shortText"
              />
            </div>
            <VisibilitySelect v-model="privacy.personalDescription" />
          </div>

          <div class="private-field">
            <div class="field">
              <label class="field-label" for="p-lang">
                {{ t('profile.languages') }}<span class="req">*</span>
              </label>
              <TagInput id="p-lang" v-model="personal.languages" />
            </div>
            <VisibilitySelect v-model="privacy.languages" />
          </div>

          <div class="private-field">
            <div class="field">
              <label class="field-label" for="p-interests">{{ t('profile.interests') }}</label>
              <TagInput id="p-interests" v-model="personal.interests" />
            </div>
            <VisibilitySelect v-model="privacy.interests" />
          </div>
        </div>
      </section>

      <!-- Work --------------------------------------------------------- -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('profile.sectionWork') }}</h2>
          <RouterLink
            v-if="canManageOwnWork"
            :to="`/employees/${auth.uid}`"
            class="btn btn-secondary btn-sm"
          >
            {{ t('common.edit') }}
          </RouterLink>
          <span v-else class="badge badge-plain">{{ t('profile.managedByCeo') }}</span>
        </div>

        <div class="card-body">
          <dl class="facts">
            <div class="fact">
              <dt>{{ t('profile.employmentStatus') }}</dt>
              <dd>{{ t(`employmentStatus.${detail.profile.employmentStatus}`) }}</dd>
            </div>
            <div class="fact">
              <dt>{{ t('profile.startDate') }}</dt>
              <dd>{{ formatDate(detail.profile.startDate) }}</dd>
            </div>
            <div class="fact">
              <dt>{{ t('profile.role') }}</dt>
              <dd>{{ detail.profile.roleIds.join(', ') || t('common.notSet') }}</dd>
            </div>
            <div class="fact fact-wide">
              <dt>{{ t('profile.responsibilities') }}</dt>
              <dd>{{ detail.profile.responsibilities || t('common.notSet') }}</dd>
            </div>
          </dl>
        </div>
      </section>

      <div class="save-row">
        <button class="btn btn-primary btn-lg" :disabled="saving" @click="save">
          <span v-if="saving" class="spinner" />
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.meter-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.meter-value {
  font-size: var(--text-md);
  font-weight: 650;
  color: var(--text-brand);
}

.meter {
  height: 6px;
  background: var(--bg-inset);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.meter-fill {
  height: 100%;
  background: var(--accent);
  border-radius: var(--radius-full);
  transition: width var(--dur-slow) var(--ease-out);
}

.ok-text {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--ok-500);
}

.identity {
  display: flex;
  gap: var(--space-8);
  flex-wrap: wrap;
}

.identity-photo {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}

.facts {
  flex: 1;
  min-width: 260px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-5);
}

.fact-wide {
  grid-column: 1 / -1;
}

.facts dt {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: var(--space-2);
}

.facts dd {
  font-size: var(--text-base);
  margin: 0;
}

.mono {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.footer-note {
  justify-content: flex-start;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  flex-wrap: wrap;
}

.footer-link {
  font-size: var(--text-xs);
  font-weight: 600;
}

.private-field {
  display: flex;
  align-items: flex-end;
  gap: var(--space-4);
  flex-wrap: wrap;
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.private-field:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.private-field .field {
  flex: 1;
  min-width: 240px;
}

.save-row {
  display: flex;
  justify-content: flex-end;
}
</style>
