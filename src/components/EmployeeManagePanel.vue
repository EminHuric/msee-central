<script setup lang="ts">
/**
 * The management side of an employee profile.
 *
 * Three separately-gated groups, because they are three different amounts of
 * power and the security rules treat them separately too:
 *
 *   employees.edit_professional  the job    — position, department, duties
 *   roles.assign                 authority  — what they may do in the system
 *   employees.manage_status      access     — whether they may sign in at all
 *
 * A manager cannot use the last two on themselves. That is not a courtesy
 * check: `userPermissions` rejects the write outright, so the attempt would
 * fail at the database anyway. The controls are disabled here so the refusal
 * is explained rather than merely experienced.
 *
 * The CEO is exempt for roles, having nothing left to escalate to, but still
 * cannot suspend their own account or drop their own CEO role — both would
 * leave the company with nobody able to administer it.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import {
  assignRoles,
  fetchUserAccess,
  setAccountStatus,
  updateWorkInformation,
  FounderOnlyError,
  FounderProtectedError,
  SelfActionError,
  SelfDemotionError,
  type WorkInformation,
} from '@/api/administration'
import { fetchEmployees } from '@/api/employees'
import { departmentName, positionName } from '@/api/organisation'
import { fetchRoles, roleName } from '@/api/roles'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { LIMITS } from '@/lib/validation'
import {
  EMPLOYMENT_STATUSES,
  type AccountStatus,
  type Department,
  type EmployeePublic,
  type Position,
  type Role,
} from '@/types/domain'
import { PERMISSIONS } from '@/types/permissions'

const props = defineProps<{
  employee: EmployeePublic
  departments: Department[]
  positions: Position[]
}>()

const emit = defineEmits<{ updated: [] }>()

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const isSelf = computed(() => props.employee.uid === auth.uid)
const label = computed(() => `${props.employee.firstName} ${props.employee.lastName}`.trim())

const canEditWork = computed(() => auth.hasPermission(PERMISSIONS.EMPLOYEES_EDIT_PROFESSIONAL))
/**
 * The CEO may edit their own roles — they already hold every permission, so
 * there is nothing to escalate to. A manager holding roles.assign may not,
 * which is what stops self-promotion.
 */
const canAssignRoles = computed(
  () =>
    auth.hasPermission(PERMISSIONS.ROLES_ASSIGN) &&
    (!isSelf.value || auth.isCeo) &&
    // The founder's account is nobody's to reconfigure but their own.
    (isSelf.value || !targetIsFounder.value),
)
const canManageStatus = computed(
  () =>
    auth.hasPermission(PERMISSIONS.EMPLOYEES_MANAGE_STATUS) &&
    !isSelf.value &&
    !targetIsFounder.value,
)

const work = ref<WorkInformation>({
  positionId: props.employee.positionId,
  departmentId: props.employee.departmentId,
  employmentStatus: props.employee.employmentStatus,
  startDate: props.employee.startDate,
  managerUid: props.employee.managerUid,
  responsibilities: props.employee.responsibilities ?? '',
})

const roles = ref<Role[]>([])
const colleagues = ref<EmployeePublic[]>([])
const selectedRoleIds = ref<string[]>([...(props.employee.roleIds ?? [])])
const accountStatus = ref<AccountStatus>(props.employee.status)

/** Whether the person being viewed owns the company. Read from userPermissions. */
const targetIsFounder = ref(false)

const savingWork = ref(false)
const savingRoles = ref(false)
const statusBusy = ref(false)

/** Only the positions belonging to the chosen department, when one is set. */
const availablePositions = computed(() => {
  const active = props.positions.filter((p) => p.status === 'active')
  if (!work.value.departmentId) return active
  return active.filter((p) => !p.departmentId || p.departmentId === work.value.departmentId)
})

const assignableRoles = computed(() =>
  /*
   * Owner roles (CEO, CTO) appear only for the founder. Appointing a co-owner
   * is the founder's decision alone — an existing co-owner cannot create
   * another, which keeps the circle from widening on its own.
   */
  roles.value.filter(
    (role) => role.status === 'active' && (!role.grantsAll || auth.isFounder),
  ),
)

const pendingStatus = ref<AccountStatus | null>(null)

const confirmCopy = computed(() => {
  switch (pendingStatus.value) {
    case 'suspended':
      return { title: t('manage.confirmSuspendTitle'), message: t('manage.confirmSuspendText'), danger: true }
    case 'deactivated':
      return { title: t('manage.confirmDeactivateTitle'), message: t('manage.confirmDeactivateText'), danger: true }
    default:
      return { title: t('manage.confirmActivateTitle'), message: t('manage.confirmActivateText'), danger: false }
  }
})

async function load(): Promise<void> {
  const [allRoles, people, access] = await Promise.all([
    fetchRoles().catch(() => []),
    fetchEmployees().catch(() => []),
    fetchUserAccess(props.employee.uid).catch(() => null),
  ])

  roles.value = allRoles
  colleagues.value = people.filter((p) => p.uid !== props.employee.uid)

  // userPermissions is the authority on access; the employee document only
  // mirrors it for display.
  if (access) {
    selectedRoleIds.value = [...access.roleIds]
    accountStatus.value = access.status
    targetIsFounder.value = access.isFounder
  }
}

async function saveWork(): Promise<void> {
  if (savingWork.value) return
  savingWork.value = true
  try {
    await updateWorkInformation(props.employee.uid, label.value, work.value)
    ui.notify('ok', t('manage.saved'))
    emit('updated')
  } catch {
    ui.notify('danger', t('manage.saveFailed'))
  } finally {
    savingWork.value = false
  }
}

async function saveRoles(): Promise<void> {
  if (savingRoles.value || !auth.uid) return
  savingRoles.value = true
  try {
    await assignRoles(
      props.employee.uid,
      label.value,
      selectedRoleIds.value,
      roles.value,
      auth.uid,
      { isOwner: auth.isCeo, isFounder: auth.isFounder },
      targetIsFounder.value,
    )
    ui.notify('ok', t('manage.saved'))
    emit('updated')
  } catch (error) {
    if (error instanceof SelfDemotionError) ui.notify('danger', t('manage.selfDemotion'))
    else if (error instanceof FounderProtectedError) ui.notify('danger', t('manage.founderProtected'))
    else if (error instanceof FounderOnlyError) ui.notify('danger', t('manage.founderOnly'))
    else if (error instanceof SelfActionError) ui.notify('danger', t('manage.selfNotice'))
    else ui.notify('danger', t('manage.saveFailed'))
  } finally {
    savingRoles.value = false
  }
}

function requestStatus(status: AccountStatus): void {
  pendingStatus.value = status
}

async function confirmStatus(): Promise<void> {
  if (!pendingStatus.value || !auth.uid) return
  statusBusy.value = true
  try {
    await setAccountStatus(
      props.employee.uid,
      label.value,
      pendingStatus.value,
      auth.uid,
      targetIsFounder.value,
    )
    accountStatus.value = pendingStatus.value
    ui.notify('ok', t('manage.saved'))
    emit('updated')
    pendingStatus.value = null
  } catch (error) {
    if (error instanceof FounderProtectedError) ui.notify('danger', t('manage.founderProtected'))
    else if (error instanceof SelfActionError) ui.notify('danger', t('manage.selfNotice'))
    else ui.notify('danger', t('manage.saveFailed'))
  } finally {
    statusBusy.value = false
  }
}

function toggleRole(id: string): void {
  selectedRoleIds.value = selectedRoleIds.value.includes(id)
    ? selectedRoleIds.value.filter((r) => r !== id)
    : [...selectedRoleIds.value, id]
}

onMounted(load)
</script>

<template>
  <div class="stack">
    <!-- Work information --------------------------------------------- -->
    <section v-if="canEditWork" class="card">
      <div class="card-header">
        <h2 class="card-title">{{ t('manage.workInfo') }}</h2>
        <button class="btn btn-primary btn-sm" :disabled="savingWork" @click="saveWork">
          <span v-if="savingWork" class="spinner" />
          {{ savingWork ? t('common.saving') : t('common.save') }}
        </button>
      </div>

      <div class="card-body stack">
        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="m-dep">{{ t('manage.department') }}</label>
            <select id="m-dep" v-model="work.departmentId" class="select">
              <option :value="null">{{ t('manage.noneSelected') }}</option>
              <option v-for="d in departments" :key="d.id" :value="d.id">
                {{ departmentName(d) }}
              </option>
            </select>
            <p v-if="departments.length === 0" class="field-hint">
              {{ t('manage.noDepartments') }} {{ t('manage.createInSettings') }}
            </p>
          </div>

          <div class="field">
            <label class="field-label" for="m-pos">{{ t('manage.position') }}</label>
            <select id="m-pos" v-model="work.positionId" class="select">
              <option :value="null">{{ t('manage.noneSelected') }}</option>
              <option v-for="p in availablePositions" :key="p.id" :value="p.id">
                {{ positionName(p) }}
              </option>
            </select>
            <p v-if="positions.length === 0" class="field-hint">
              {{ t('manage.noPositions') }} {{ t('manage.createInSettings') }}
            </p>
          </div>

          <div class="field">
            <label class="field-label" for="m-emp">{{ t('manage.employmentStatus') }}</label>
            <select id="m-emp" v-model="work.employmentStatus" class="select">
              <option v-for="s in EMPLOYMENT_STATUSES" :key="s" :value="s">
                {{ t(`employmentStatus.${s}`) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="m-start">{{ t('manage.startDate') }}</label>
            <input id="m-start" v-model="work.startDate" class="input" type="date" />
          </div>

          <div class="field">
            <label class="field-label" for="m-mgr">{{ t('manage.manager') }}</label>
            <select id="m-mgr" v-model="work.managerUid" class="select">
              <option :value="null">{{ t('manage.noneSelected') }}</option>
              <option v-for="c in colleagues" :key="c.uid" :value="c.uid">
                {{ c.firstName }} {{ c.lastName }}
              </option>
            </select>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="m-resp">{{ t('manage.responsibilities') }}</label>
          <textarea
            id="m-resp"
            v-model="work.responsibilities"
            class="textarea"
            :maxlength="LIMITS.longText"
          />
        </div>
      </div>
    </section>

    <!-- Account and access -------------------------------------------- -->
    <section v-if="auth.hasAny(PERMISSIONS.ROLES_ASSIGN, PERMISSIONS.EMPLOYEES_MANAGE_STATUS)" class="card">
      <div class="card-header">
        <h2 class="card-title">{{ t('manage.account') }}</h2>
      </div>

      <div class="card-body stack">
        <div v-if="targetIsFounder && !isSelf" class="alert alert-info">
          <AppIcon name="shield" :size="16" />
          <span>{{ t('manage.founderProtected') }}</span>
        </div>

        <div v-else-if="isSelf" class="alert" :class="auth.isCeo ? 'alert-info' : 'alert-warn'">
          <AppIcon :name="auth.isCeo ? 'shield' : 'lock'" :size="16" />
          <span>{{ auth.isCeo ? t('manage.selfCeoNotice') : t('manage.selfNotice') }}</span>
        </div>

        <!-- Roles -->
        <div class="field">
          <div class="spread">
            <span class="field-label">{{ t('manage.roles') }}</span>
            <button
              v-if="canAssignRoles"
              class="btn btn-secondary btn-sm"
              :disabled="savingRoles"
              @click="saveRoles"
            >
              <span v-if="savingRoles" class="spinner" />
              {{ t('common.save') }}
            </button>
          </div>

          <ul class="roles">
            <li v-for="role in assignableRoles" :key="role.id">
              <label class="check role-row" :class="{ 'is-disabled': !canAssignRoles }">
                <input
                  type="checkbox"
                  :checked="selectedRoleIds.includes(role.id)"
                  :disabled="!canAssignRoles"
                  @change="toggleRole(role.id)"
                />
                <span>
                  <span class="role-name">{{ roleName(role) }}</span>
                  <span class="role-count tertiary">
                    {{ t('manage.rolePermissionCount', { n: role.permissions.length }) }}
                  </span>
                </span>
              </label>
            </li>
          </ul>

          <p v-if="selectedRoleIds.some((id) => roles.find((r) => r.id === id)?.grantsAll)" class="field-hint">
            <AppIcon name="shield" :size="13" /> CEO
          </p>
        </div>

        <!-- Status -->
        <div v-if="canManageStatus" class="field">
          <span class="field-label">{{ t('manage.accountStatus') }}</span>
          <div class="row">
            <button
              v-if="accountStatus !== 'active'"
              class="btn btn-secondary btn-sm"
              @click="requestStatus('active')"
            >
              <AppIcon name="check" :size="15" />
              {{ t('status.active') }}
            </button>
            <button
              v-if="accountStatus !== 'suspended'"
              class="btn btn-danger-soft btn-sm"
              @click="requestStatus('suspended')"
            >
              <AppIcon name="alert" :size="15" />
              {{ t('status.suspended') }}
            </button>
            <button
              v-if="accountStatus !== 'deactivated'"
              class="btn btn-danger-soft btn-sm"
              @click="requestStatus('deactivated')"
            >
              <AppIcon name="logout" :size="15" />
              {{ t('status.deactivated') }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <ConfirmDialog
      :open="pendingStatus !== null"
      :title="confirmCopy.title"
      :message="confirmCopy.message"
      :danger="confirmCopy.danger"
      :busy="statusBusy"
      @confirm="confirmStatus"
      @cancel="pendingStatus = null"
    />
  </div>
</template>

<style scoped>
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

.role-row:hover:not(.is-disabled) {
  background: var(--bg-hover);
}

.role-row.is-disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.role-name {
  font-size: var(--text-base);
  color: var(--text-primary);
  font-weight: 550;
}

.role-count {
  font-size: var(--text-xs);
  margin-left: var(--space-2);
}
</style>
