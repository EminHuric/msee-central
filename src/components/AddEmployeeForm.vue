<script setup lang="ts">
/**
 * Create an employee account directly.
 *
 * The alternative path — the employee registers and waits for approval — still
 * exists and suits people applying from outside. This one suits hiring
 * somebody you already know: the CEO makes the login and hands it over.
 *
 * The password is shown once, after creation, and never stored anywhere. If it
 * is lost the answer is a password reset, not a lookup.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import {
  AccountExistsError,
  createEmployeeAccount,
  suggestPassword,
  type NewEmployeeInput,
} from '@/api/provisioning'
import { departmentName, positionName } from '@/api/organisation'
import { roleName } from '@/api/roles'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { isEmail, isNotBlank, LIMITS, PASSWORD_MIN_LENGTH } from '@/lib/validation'
import {
  EMPLOYMENT_STATUSES,
  type Department,
  type Position,
  type Role,
} from '@/types/domain'

const props = defineProps<{
  roles: Role[]
  departments: Department[]
  positions: Position[]
  employeeCode: string
}>()

const emit = defineEmits<{ created: []; close: [] }>()

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const form = ref<NewEmployeeInput>({
  firstName: '',
  lastName: '',
  email: '',
  password: suggestPassword(),
  phone: '',
  city: '',
  country: '',
  roleIds: [],
  positionId: null,
  departmentId: null,
  employmentStatus: 'full_time',
  startDate: null,
  sendPasswordReset: true,
})

const busy = ref(false)
const submitted = ref(false)
/** Shown once after success, then gone for good. */
const credentials = ref<{ name: string; email: string; password: string } | null>(null)

const assignableRoles = computed(() =>
  props.roles.filter((role) => role.status === 'active' && (!role.grantsAll || auth.isCeo)),
)

const availablePositions = computed(() => {
  const active = props.positions.filter((p) => p.status === 'active')
  if (!form.value.departmentId) return active
  return active.filter((p) => !p.departmentId || p.departmentId === form.value.departmentId)
})

const errors = computed(() => {
  const f = form.value
  const out: Record<string, string> = {}
  if (!isNotBlank(f.firstName)) out.firstName = t('errors.required')
  if (!isNotBlank(f.lastName)) out.lastName = t('errors.required')
  if (!isEmail(f.email)) out.email = t('errors.invalidEmail')
  if (f.password.length < PASSWORD_MIN_LENGTH) {
    out.password = t('errors.passwordTooShort', { min: PASSWORD_MIN_LENGTH })
  }
  if (f.roleIds.length === 0) out.roles = t('newEmployee.noRole')
  return out
})

const isValid = computed(() => Object.keys(errors.value).length === 0)

function errorFor(field: string): string | undefined {
  return submitted.value ? errors.value[field] : undefined
}

function toggleRole(id: string): void {
  form.value.roleIds = form.value.roleIds.includes(id)
    ? form.value.roleIds.filter((r) => r !== id)
    : [...form.value.roleIds, id]
}

async function copyCredentials(): Promise<void> {
  if (!credentials.value) return
  const text = `${credentials.value.email}\n${credentials.value.password}`
  try {
    await navigator.clipboard.writeText(text)
    ui.notify('ok', t('newEmployee.copied'))
  } catch {
    // Clipboard access can be refused; the values are on screen regardless.
  }
}

async function submit(): Promise<void> {
  submitted.value = true
  if (!isValid.value || busy.value || !auth.uid) return

  busy.value = true
  const name = `${form.value.firstName} ${form.value.lastName}`.trim()

  try {
    await createEmployeeAccount(form.value, props.roles, auth.uid, props.employeeCode)

    credentials.value = { name, email: form.value.email.trim(), password: form.value.password }
    ui.notify('ok', t('newEmployee.created', { name }))
    emit('created')
  } catch (error) {
    ui.notify(
      'danger',
      error instanceof AccountExistsError ? t('newEmployee.exists') : t('newEmployee.failed'),
    )
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="card new-employee">
    <div class="card-header">
      <h2 class="card-title">{{ t('newEmployee.title') }}</h2>
      <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="emit('close')">
        <AppIcon name="close" :size="18" />
      </button>
    </div>

    <!-- Credentials, shown once ---------------------------------------- -->
    <div v-if="credentials" class="card-body stack">
      <div class="alert alert-ok">
        <AppIcon name="check" :size="16" />
        <span>
          <strong>{{ t('newEmployee.credentialsTitle') }}</strong><br />
          {{ t('newEmployee.credentialsText') }}
        </span>
      </div>

      <dl class="creds">
        <div>
          <dt>{{ t('auth.email') }}</dt>
          <dd class="mono">{{ credentials.email }}</dd>
        </div>
        <div>
          <dt>{{ t('newEmployee.tempPassword') }}</dt>
          <dd class="mono">{{ credentials.password }}</dd>
        </div>
      </dl>

      <div class="row creds-actions">
        <button class="btn btn-secondary btn-sm" @click="copyCredentials">
          <AppIcon name="plus" :size="15" />
          {{ t('common.copy') }}
        </button>
        <button class="btn btn-primary btn-sm" @click="emit('close')">
          {{ t('common.close') }}
        </button>
      </div>
    </div>

    <!-- The form -------------------------------------------------------- -->
    <template v-else>
      <div class="card-body stack">
        <p class="field-hint">{{ t('newEmployee.subtitle') }}</p>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="n-first">
              {{ t('register.firstName') }}<span class="req">*</span>
            </label>
            <input id="n-first" v-model="form.firstName" class="input" :maxlength="LIMITS.name" />
            <p v-if="errorFor('firstName')" class="field-error">{{ errorFor('firstName') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="n-last">
              {{ t('register.lastName') }}<span class="req">*</span>
            </label>
            <input id="n-last" v-model="form.lastName" class="input" :maxlength="LIMITS.name" />
            <p v-if="errorFor('lastName')" class="field-error">{{ errorFor('lastName') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="n-email">
              {{ t('auth.email') }}<span class="req">*</span>
            </label>
            <input id="n-email" v-model="form.email" class="input" type="email" :maxlength="LIMITS.email" />
            <p v-if="errorFor('email')" class="field-error">{{ errorFor('email') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="n-phone">{{ t('register.phone') }}</label>
            <input id="n-phone" v-model="form.phone" class="input" type="tel" :maxlength="LIMITS.phone" />
          </div>

          <div class="field">
            <label class="field-label" for="n-city">{{ t('register.city') }}</label>
            <input id="n-city" v-model="form.city" class="input" :maxlength="LIMITS.city" />
          </div>

          <div class="field">
            <label class="field-label" for="n-country">{{ t('register.country') }}</label>
            <input id="n-country" v-model="form.country" class="input" :maxlength="LIMITS.country" />
          </div>
        </div>

        <!-- Password -->
        <div class="field">
          <label class="field-label" for="n-pass">
            {{ t('newEmployee.tempPassword') }}<span class="req">*</span>
          </label>
          <div class="row">
            <input id="n-pass" v-model="form.password" class="input mono" type="text" />
            <button class="btn btn-secondary btn-sm" @click="form.password = suggestPassword()">
              {{ t('newEmployee.generate') }}
            </button>
          </div>
          <p v-if="errorFor('password')" class="field-error">{{ errorFor('password') }}</p>
          <p v-else class="field-hint">{{ t('newEmployee.passwordHint') }}</p>
        </div>

        <label class="check">
          <input v-model="form.sendPasswordReset" type="checkbox" />
          <span class="check-text">
            {{ t('newEmployee.sendReset') }}<br />
            <span class="tertiary">{{ t('newEmployee.sendResetHint') }}</span>
          </span>
        </label>

        <!-- Role and job -->
        <div class="field">
          <span class="field-label">{{ t('approval.assignRole') }}<span class="req">*</span></span>
          <ul class="roles">
            <li v-for="role in assignableRoles" :key="role.id">
              <label class="check role-row">
                <input
                  type="checkbox"
                  :checked="form.roleIds.includes(role.id)"
                  @change="toggleRole(role.id)"
                />
                <span>
                  <span class="role-name">{{ roleName(role) }}</span>
                  <span class="tertiary role-count">
                    {{ t('manage.rolePermissionCount', { n: role.permissions.length }) }}
                  </span>
                </span>
              </label>
            </li>
          </ul>
          <p v-if="errorFor('roles')" class="field-error">{{ errorFor('roles') }}</p>
        </div>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="n-dep">{{ t('approval.assignDepartment') }}</label>
            <select id="n-dep" v-model="form.departmentId" class="select">
              <option :value="null">{{ t('manage.noneSelected') }}</option>
              <option v-for="d in departments" :key="d.id" :value="d.id">{{ departmentName(d) }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="n-pos">{{ t('approval.assignPosition') }}</label>
            <select id="n-pos" v-model="form.positionId" class="select">
              <option :value="null">{{ t('manage.noneSelected') }}</option>
              <option v-for="p in availablePositions" :key="p.id" :value="p.id">
                {{ positionName(p) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="n-emp">{{ t('approval.assignEmployment') }}</label>
            <select id="n-emp" v-model="form.employmentStatus" class="select">
              <option v-for="s in EMPLOYMENT_STATUSES" :key="s" :value="s">
                {{ t(`employmentStatus.${s}`) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="n-start">{{ t('approval.assignStartDate') }}</label>
            <input id="n-start" v-model="form.startDate" class="input" type="date" />
          </div>
        </div>
      </div>

      <div class="card-footer">
        <button class="btn btn-secondary" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="busy" @click="submit">
          <span v-if="busy" class="spinner" />
          {{ busy ? t('newEmployee.creating') : t('newEmployee.create') }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.new-employee {
  border-color: var(--accent-soft-border);
}

.roles {
  list-style: none;
  padding: 0;
  margin-top: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.role-row {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
}

.role-row:hover {
  background: var(--bg-hover);
}

.role-name {
  font-weight: 550;
  color: var(--text-primary);
}

.role-count {
  font-size: var(--text-xs);
  margin-left: var(--space-2);
}

.creds {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.creds dt {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: var(--space-1);
}

.creds dd {
  margin: 0;
  font-size: var(--text-md);
  overflow-wrap: anywhere;
  user-select: all;
}

.creds-actions {
  justify-content: flex-end;
}

.mono {
  font-family: var(--font-mono);
}
</style>
