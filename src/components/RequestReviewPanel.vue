<script setup lang="ts">
/**
 * Reviewing one registration request.
 *
 * Everything the applicant submitted is shown before a decision is made, and
 * the role, position and department are set here rather than afterwards — the
 * specification asks for that order deliberately, so nobody is ever let in
 * first and configured later.
 *
 * An approval with no role would create an account that can sign in and reach
 * nothing, so that case is warned about explicitly.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AccountTypeSelect from '@/components/ui/AccountTypeSelect.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { approveRequest, rejectRequest, type ApprovalDecision } from '@/api/approval'
import { departmentName, positionName, positionsFor } from '@/api/organisation'
import { roleName } from '@/api/roles'
import { formatDate } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { LIMITS } from '@/lib/validation'
import {
  EMPLOYMENT_STATUSES,
  type Department,
  type Position,
  type RegistrationRequest,
  type Role,
} from '@/types/domain'

const props = defineProps<{
  request: RegistrationRequest
  roles: Role[]
  departments: Department[]
  positions: Position[]
  employeeCode: string
}>()

const emit = defineEmits<{ decided: []; close: [] }>()

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const decision = ref<ApprovalDecision>({
  accountType: 'employee',
  roleIds: [],
  positionId: null,
  departmentId: null,
  employmentStatus: 'full_time',
  startDate: null,
})

const rejectionReason = ref('')
const confirming = ref<'approve' | 'reject' | null>(null)
const busy = ref(false)

const name = computed(() => `${props.request.firstName} ${props.request.lastName}`.trim())

/**
 * The CEO role is offered only to a CEO, and carries a loud warning: it is the
 * mechanism for appointing a second administrator, which is also the only way
 * anybody can ever manage the first one.
 */
const assignableRoles = computed(() =>
  props.roles.filter((role) => role.status === 'active' && (!role.grantsAll || auth.isCeo)),
)

const grantingFullControl = computed(() =>
  decision.value.roleIds.some((id) => props.roles.find((r) => r.id === id)?.grantsAll),
)

const availablePositions = computed(() => {
  const forType = positionsFor(props.positions, decision.value.accountType)
  if (!decision.value.departmentId) return forType
  return forType.filter((p) => !p.departmentId || p.departmentId === decision.value.departmentId)
})

function onTypeChange(next: ApprovalDecision['accountType']): void {
  decision.value.accountType = next
  decision.value.positionId = null
  if (next === 'affiliate') decision.value.departmentId = null
}

function toggleRole(id: string): void {
  decision.value.roleIds = decision.value.roleIds.includes(id)
    ? decision.value.roleIds.filter((r) => r !== id)
    : [...decision.value.roleIds, id]
}

async function confirm(): Promise<void> {
  if (!auth.uid || busy.value) return
  busy.value = true

  try {
    if (confirming.value === 'approve') {
      await approveRequest(props.request, decision.value, props.roles, auth.uid, props.employeeCode)
      ui.notify('ok', t('approval.approved'))
    } else {
      await rejectRequest(props.request, rejectionReason.value, auth.uid)
      ui.notify('ok', t('approval.rejected'))
    }
    confirming.value = null
    emit('decided')
  } catch {
    ui.notify('danger', t('approval.failed'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="card review">
    <div class="card-header">
      <h2 class="card-title">{{ t('approval.review') }}</h2>
      <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="emit('close')">
        <AppIcon name="close" :size="18" />
      </button>
    </div>

    <!-- What they submitted ------------------------------------------- -->
    <div class="card-body applicant">
      <UserAvatar :name="name" :photo-url="request.photoUrl" :size="88" />

      <div class="applicant-body">
        <h3 class="applicant-name">{{ name }}</h3>
        <p class="muted">{{ request.desiredPosition }}</p>

        <dl class="facts">
          <div class="fact">
            <dt>{{ t('auth.email') }}</dt>
            <dd>{{ request.email }}</dd>
          </div>
          <div class="fact">
            <dt>{{ t('register.phone') }}</dt>
            <dd>{{ request.phone }}</dd>
          </div>
          <div class="fact">
            <dt>{{ t('table.location') }}</dt>
            <dd>{{ request.city }}, {{ request.country }}</dd>
          </div>
          <div class="fact">
            <dt>{{ t('table.submitted') }}</dt>
            <dd>{{ formatDate(request.submittedAt, true) }}</dd>
          </div>
        </dl>

        <div v-if="request.personalDescription" class="block">
          <p class="eyebrow">{{ t('approval.aboutApplicant') }}</p>
          <p class="prose">{{ request.personalDescription }}</p>
        </div>

        <div v-if="request.additionalInfo" class="block">
          <p class="eyebrow">{{ t('register.additionalInfo') }}</p>
          <p class="prose">{{ request.additionalInfo }}</p>
        </div>
      </div>
    </div>

    <!-- Decide before letting them in ---------------------------------- -->
    <template v-if="request.status === 'pending'">
      <div class="card-body decision">
        <p class="eyebrow">{{ t('approval.beforeApproving') }}</p>

        <AccountTypeSelect :model-value="decision.accountType" @update:model-value="onTypeChange" />

        <div class="field">
          <span class="field-label">{{ t('approval.assignRole') }}<span class="req">*</span></span>
          <ul class="roles">
            <li v-for="role in assignableRoles" :key="role.id">
              <label class="check role-row">
                <input
                  type="checkbox"
                  :checked="decision.roleIds.includes(role.id)"
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

          <p v-if="decision.roleIds.length === 0" class="field-error">
            {{ t('approval.noRoleWarning') }}
          </p>
        </div>

        <div v-if="grantingFullControl" class="alert alert-warn">
          <AppIcon name="alert" :size="16" />
          <span>
            <strong>{{ t('coAdmin.warningTitle') }}</strong><br />
            {{ t('coAdmin.warningText') }}
          </span>
        </div>

        <div class="field-grid">
          <div v-if="decision.accountType === 'employee'" class="field">
            <label class="field-label" for="a-dep">{{ t('approval.assignDepartment') }}</label>
            <select id="a-dep" v-model="decision.departmentId" class="select">
              <option :value="null">{{ t('manage.noneSelected') }}</option>
              <option v-for="d in departments" :key="d.id" :value="d.id">
                {{ departmentName(d) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="a-pos">{{ t('approval.assignPosition') }}</label>
            <select id="a-pos" v-model="decision.positionId" class="select">
              <option :value="null">{{ t('manage.noneSelected') }}</option>
              <option v-for="p in availablePositions" :key="p.id" :value="p.id">
                {{ positionName(p) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="a-emp">{{ t('approval.assignEmployment') }}</label>
            <select id="a-emp" v-model="decision.employmentStatus" class="select">
              <option v-for="s in EMPLOYMENT_STATUSES" :key="s" :value="s">
                {{ t(`employmentStatus.${s}`) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="a-start">{{ t('approval.assignStartDate') }}</label>
            <input id="a-start" v-model="decision.startDate" class="input" type="date" />
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="a-reason">{{ t('approval.reason') }}</label>
          <input
            id="a-reason"
            v-model="rejectionReason"
            class="input"
            :maxlength="LIMITS.shortText"
          />
          <p class="field-hint">{{ t('approval.reasonOptional') }}</p>
        </div>
      </div>

      <div class="card-footer">
        <button class="btn btn-danger-soft" @click="confirming = 'reject'">
          {{ t('approval.reject') }}
        </button>
        <button class="btn btn-primary" @click="confirming = 'approve'">
          <AppIcon name="check" :size="15" />
          {{ t('approval.approve') }}
        </button>
      </div>
    </template>

    <!-- Already decided ------------------------------------------------ -->
    <div v-else class="card-footer decided">
      <span class="badge" :class="request.status === 'approved' ? 'badge-active' : 'badge-rejected'">
        {{ request.status === 'approved' ? t('status.active') : t('status.rejected') }}
      </span>
      <span v-if="request.rejectionReason" class="muted">
        {{ t('table.reason') }}: {{ request.rejectionReason }}
      </span>
      <span class="tertiary">{{ formatDate(request.reviewedAt, true) }}</span>
    </div>

    <ConfirmDialog
      :open="confirming !== null"
      :title="confirming === 'approve' ? t('approval.approveTitle') : t('approval.rejectTitle')"
      :message="confirming === 'approve' ? t('approval.approveText') : t('approval.rejectText')"
      :confirm-label="confirming === 'approve' ? t('approval.approve') : t('approval.reject')"
      :danger="confirming === 'reject'"
      :busy="busy"
      @confirm="confirm"
      @cancel="confirming = null"
    />
  </section>
</template>

<style scoped>
.review {
  border-color: var(--accent-soft-border);
}

.applicant {
  display: flex;
  gap: var(--space-6);
  flex-wrap: wrap;
}

.applicant-body {
  flex: 1;
  min-width: 240px;
}

.applicant-name {
  font-size: var(--text-lg);
  font-weight: 650;
}

.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: var(--space-4);
  margin-top: var(--space-5);
}

.facts dt {
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: var(--space-1);
}

.facts dd {
  margin: 0;
  font-size: var(--text-base);
  overflow-wrap: anywhere;
}

.block {
  margin-top: var(--space-5);
}

.prose {
  margin-top: var(--space-2);
  font-size: var(--text-base);
  line-height: var(--leading-relaxed);
  color: var(--text-secondary);
  white-space: pre-wrap;
}

.decision {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-surface-2);
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

.decided {
  justify-content: flex-start;
  gap: var(--space-3);
  flex-wrap: wrap;
  font-size: var(--text-sm);
}
</style>
