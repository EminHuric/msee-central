<script setup lang="ts">
/**
 * Registration request.
 *
 * Creates a Firebase Auth account and files a request for the CEO to review.
 * The account can sign in immediately but reaches only the "waiting for
 * approval" screen, because no userPermissions document exists for it yet and
 * the security rules refuse everything without one.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import AuthShell from '@/layouts/AuthShell.vue'
import { PhotoError, processProfilePhoto } from '@/api/photos'
import { submitRegistration } from '@/api/registration'
import { isEmail, isNotBlank, isPhone, LIMITS, PASSWORD_MIN_LENGTH } from '@/lib/validation'

const router = useRouter()
const { t } = useI18n()

const form = ref({
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  confirmPassword: '',
  phone: '',
  country: '',
  city: '',
  personalDescription: '',
  desiredPosition: '',
  additionalInfo: '',
})

const photo = ref<string | null>(null)
const photoBusy = ref(false)
const photoInput = ref<HTMLInputElement | null>(null)
const termsAccepted = ref(false)

const busy = ref(false)
const formError = ref('')
const submitted = ref(false)

type FieldName = keyof typeof form.value

/** Errors are only shown once a field has been left, or once submit is tried. */
const touched = ref(new Set<FieldName | 'terms'>())

function touch(field: FieldName | 'terms'): void {
  touched.value = new Set(touched.value).add(field)
}

const errors = computed<Partial<Record<FieldName | 'terms', string>>>(() => {
  const f = form.value
  const out: Partial<Record<FieldName | 'terms', string>> = {}

  if (!isNotBlank(f.firstName)) out.firstName = t('errors.required')
  if (!isNotBlank(f.lastName)) out.lastName = t('errors.required')

  if (!isNotBlank(f.email)) out.email = t('errors.required')
  else if (!isEmail(f.email)) out.email = t('errors.invalidEmail')

  if (!f.password) out.password = t('errors.required')
  else if (f.password.length < PASSWORD_MIN_LENGTH) {
    out.password = t('errors.passwordTooShort', { min: PASSWORD_MIN_LENGTH })
  }

  if (f.confirmPassword !== f.password) out.confirmPassword = t('errors.passwordsDoNotMatch')

  if (!isNotBlank(f.phone)) out.phone = t('errors.required')
  else if (!isPhone(f.phone)) out.phone = t('errors.invalidPhone')

  if (!isNotBlank(f.country)) out.country = t('errors.required')
  if (!isNotBlank(f.city)) out.city = t('errors.required')
  if (!isNotBlank(f.personalDescription)) out.personalDescription = t('errors.required')
  if (!isNotBlank(f.desiredPosition)) out.desiredPosition = t('errors.required')

  if (!termsAccepted.value) out.terms = t('errors.mustAcceptTerms')

  return out
})

const isValid = computed(() => Object.keys(errors.value).length === 0)

function errorFor(field: FieldName | 'terms'): string | undefined {
  if (!submitted.value && !touched.value.has(field)) return undefined
  return errors.value[field]
}

const fullName = computed(() => `${form.value.firstName} ${form.value.lastName}`.trim())

async function onPhotoPicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  formError.value = ''
  photoBusy.value = true

  try {
    photo.value = await processProfilePhoto(file)
  } catch (error) {
    if (error instanceof PhotoError) {
      formError.value =
        error.reason === 'type'
          ? t('errors.fileWrongType')
          : t('errors.fileTooLarge', { max: '12 MB' })
    } else {
      formError.value = t('errors.generic')
    }
  } finally {
    photoBusy.value = false
    // Allow re-picking the same file after an error.
    input.value = ''
  }
}

function removePhoto(): void {
  photo.value = null
}

function describeError(code: string): string {
  switch (code) {
    case 'auth/email-already-in-use':
      return t('register.emailInUse')
    case 'auth/weak-password':
      return t('register.weakPassword', { min: PASSWORD_MIN_LENGTH })
    case 'auth/invalid-email':
      return t('errors.invalidEmail')
    case 'auth/network-request-failed':
      return t('errors.network')
    case 'permission-denied':
      return t('errors.forbidden')
    default:
      return t('errors.generic')
  }
}

async function submit(): Promise<void> {
  submitted.value = true
  formError.value = ''

  if (!isValid.value || busy.value) return

  busy.value = true
  try {
    // confirmPassword is a form-only field and is deliberately left behind.
    const { confirmPassword: _ignored, ...payload } = form.value
    await submitRegistration({ ...payload, photoUrl: photo.value })
    await router.replace('/pending')
  } catch (error) {
    formError.value = describeError((error as { code?: string }).code ?? '')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <AuthShell wide>
    <form class="reg" novalidate @submit.prevent="submit">
      <header>
        <h1 class="reg-title">{{ t('auth.registerTitle') }}</h1>
        <p class="muted reg-subtitle">{{ t('auth.registerSubtitle') }}</p>
      </header>

      <div v-if="formError" class="alert alert-danger" role="alert">{{ formError }}</div>

      <!-- Account ------------------------------------------------------ -->
      <section class="reg-section">
        <p class="eyebrow">{{ t('register.sectionAccount') }}</p>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="r-first">
              {{ t('register.firstName') }}<span class="req">*</span>
            </label>
            <input
              id="r-first"
              v-model="form.firstName"
              class="input"
              :maxlength="LIMITS.name"
              autocomplete="given-name"
              :aria-invalid="!!errorFor('firstName')"
              @blur="touch('firstName')"
            />
            <p v-if="errorFor('firstName')" class="field-error">{{ errorFor('firstName') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="r-last">
              {{ t('register.lastName') }}<span class="req">*</span>
            </label>
            <input
              id="r-last"
              v-model="form.lastName"
              class="input"
              :maxlength="LIMITS.name"
              autocomplete="family-name"
              :aria-invalid="!!errorFor('lastName')"
              @blur="touch('lastName')"
            />
            <p v-if="errorFor('lastName')" class="field-error">{{ errorFor('lastName') }}</p>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="r-email">
            {{ t('auth.email') }}<span class="req">*</span>
          </label>
          <input
            id="r-email"
            v-model="form.email"
            class="input"
            type="email"
            inputmode="email"
            :maxlength="LIMITS.email"
            autocomplete="username"
            :aria-invalid="!!errorFor('email')"
            @blur="touch('email')"
          />
          <p v-if="errorFor('email')" class="field-error">{{ errorFor('email') }}</p>
        </div>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="r-pass">
              {{ t('auth.password') }}<span class="req">*</span>
            </label>
            <input
              id="r-pass"
              v-model="form.password"
              class="input"
              type="password"
              autocomplete="new-password"
              :aria-invalid="!!errorFor('password')"
              @blur="touch('password')"
            />
            <p v-if="errorFor('password')" class="field-error">{{ errorFor('password') }}</p>
            <p v-else class="field-hint">
              {{ t('register.passwordHint', { min: PASSWORD_MIN_LENGTH }) }}
            </p>
          </div>

          <div class="field">
            <label class="field-label" for="r-pass2">
              {{ t('auth.confirmPassword') }}<span class="req">*</span>
            </label>
            <input
              id="r-pass2"
              v-model="form.confirmPassword"
              class="input"
              type="password"
              autocomplete="new-password"
              :aria-invalid="!!errorFor('confirmPassword')"
              @blur="touch('confirmPassword')"
            />
            <p v-if="errorFor('confirmPassword')" class="field-error">
              {{ errorFor('confirmPassword') }}
            </p>
          </div>
        </div>
      </section>

      <!-- Personal ----------------------------------------------------- -->
      <section class="reg-section">
        <p class="eyebrow">{{ t('register.sectionPersonal') }}</p>

        <div class="photo-row">
          <UserAvatar :name="fullName || '?'" :photo-url="photo" :size="72" />

          <div class="photo-actions">
            <p class="field-label">{{ t('register.photo') }}</p>
            <div class="row">
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                :disabled="photoBusy"
                @click="photoInput?.click()"
              >
                <span v-if="photoBusy" class="spinner" />
                <AppIcon v-else name="plus" :size="15" />
                {{
                  photoBusy
                    ? t('register.photoProcessing')
                    : photo
                      ? t('register.photoChange')
                      : t('register.photoChoose')
                }}
              </button>
              <button
                v-if="photo"
                type="button"
                class="btn btn-ghost btn-sm"
                @click="removePhoto"
              >
                {{ t('register.photoRemove') }}
              </button>
            </div>
            <p class="field-hint">{{ t('register.photoHint') }}</p>
          </div>

          <input
            ref="photoInput"
            class="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            @change="onPhotoPicked"
          />
        </div>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="r-phone">
              {{ t('register.phone') }}<span class="req">*</span>
            </label>
            <input
              id="r-phone"
              v-model="form.phone"
              class="input"
              type="tel"
              inputmode="tel"
              :maxlength="LIMITS.phone"
              autocomplete="tel"
              :aria-invalid="!!errorFor('phone')"
              @blur="touch('phone')"
            />
            <p v-if="errorFor('phone')" class="field-error">{{ errorFor('phone') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="r-country">
              {{ t('register.country') }}<span class="req">*</span>
            </label>
            <input
              id="r-country"
              v-model="form.country"
              class="input"
              :maxlength="LIMITS.country"
              autocomplete="country-name"
              :aria-invalid="!!errorFor('country')"
              @blur="touch('country')"
            />
            <p v-if="errorFor('country')" class="field-error">{{ errorFor('country') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="r-city">
              {{ t('register.city') }}<span class="req">*</span>
            </label>
            <input
              id="r-city"
              v-model="form.city"
              class="input"
              :maxlength="LIMITS.city"
              autocomplete="address-level2"
              :aria-invalid="!!errorFor('city')"
              @blur="touch('city')"
            />
            <p v-if="errorFor('city')" class="field-error">{{ errorFor('city') }}</p>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="r-desc">
            {{ t('register.personalDescription') }}<span class="req">*</span>
          </label>
          <textarea
            id="r-desc"
            v-model="form.personalDescription"
            class="textarea"
            :maxlength="LIMITS.shortText"
            :aria-invalid="!!errorFor('personalDescription')"
            @blur="touch('personalDescription')"
          />
          <p v-if="errorFor('personalDescription')" class="field-error">
            {{ errorFor('personalDescription') }}
          </p>
          <p v-else class="field-hint">{{ t('register.personalDescriptionHint') }}</p>
        </div>
      </section>

      <!-- Professional ------------------------------------------------- -->
      <section class="reg-section">
        <p class="eyebrow">{{ t('register.sectionProfessional') }}</p>

        <div class="field">
          <label class="field-label" for="r-position">
            {{ t('register.desiredPosition') }}<span class="req">*</span>
          </label>
          <input
            id="r-position"
            v-model="form.desiredPosition"
            class="input"
            :maxlength="LIMITS.position"
            :aria-invalid="!!errorFor('desiredPosition')"
            @blur="touch('desiredPosition')"
          />
          <p v-if="errorFor('desiredPosition')" class="field-error">
            {{ errorFor('desiredPosition') }}
          </p>
          <p v-else class="field-hint">{{ t('register.desiredPositionHint') }}</p>
        </div>

        <div class="field">
          <label class="field-label" for="r-extra">
            {{ t('register.additionalInfo') }}
            <span class="tertiary">({{ t('common.optional') }})</span>
          </label>
          <textarea
            id="r-extra"
            v-model="form.additionalInfo"
            class="textarea"
            :maxlength="LIMITS.longText"
          />
          <p class="field-hint">{{ t('register.additionalInfoHint') }}</p>
        </div>
      </section>

      <!-- Terms -------------------------------------------------------- -->
      <section class="reg-section">
        <p class="eyebrow">{{ t('register.terms') }}</p>
        <label class="check">
          <input v-model="termsAccepted" type="checkbox" @change="touch('terms')" />
          <span class="check-text">{{ t('register.termsText') }}</span>
        </label>
        <p v-if="errorFor('terms')" class="field-error">{{ errorFor('terms') }}</p>
      </section>

      <button type="submit" class="btn btn-primary btn-lg btn-block" :disabled="busy">
        <span v-if="busy" class="spinner" />
        {{ busy ? t('common.submitting') : t('register.submit') }}
      </button>
    </form>

    <template #below>
      <p class="muted auth-alt">
        {{ t('auth.haveAccount') }}
        <RouterLink to="/login">{{ t('auth.signIn') }}</RouterLink>
      </p>
    </template>
  </AuthShell>
</template>

<style scoped>
.reg {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.reg-title {
  font-size: var(--text-xl);
  font-weight: 650;
  letter-spacing: -0.02em;
}

.reg-subtitle {
  font-size: var(--text-sm);
  margin-top: var(--space-2);
  line-height: var(--leading-relaxed);
}

.reg-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.photo-row {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-4);
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.photo-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
}

.auth-alt {
  text-align: center;
  font-size: var(--text-sm);
}

@media (max-width: 540px) {
  .photo-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
