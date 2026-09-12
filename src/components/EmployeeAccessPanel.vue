<script setup lang="ts">
/**
 * What one person may do — the individual permission editor.
 *
 * A role is a template. This screen is where the verdict is made, and two
 * people holding the same role can leave it with completely different access
 * because every decision here is recorded against this person alone.
 *
 * Each permission shows where it came from, which is the part that makes the
 * screen usable rather than merely complete:
 *
 *   from the role     inherited; turning it off records a revocation
 *   added             granted to this person alone
 *   removed           revoked from this person alone, whatever the role says
 *   off               neither the role nor an override gives it
 *
 * Without that distinction "reset to the role" is a guess, and the CEO cannot
 * tell a deliberate exception from an accident.
 *
 * Scope is separate from the permission, because "may read clients" and "whose
 * clients" are two different questions. Folding them together is what produces
 * the `view_all` pattern, which has two settings and cannot express a team.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import { fetchRoles } from '@/api/roles'
import { fetchUserAccess, saveOverrides, setAccountType } from '@/api/administration'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import {
  NO_OVERRIDES,
  SCOPED_MODULES,
  SCOPES,
  effectivePermissions,
  permissionTree,
  resetToRole,
  sourceOf,
  toggle,
  type AccessOverrides,
  type Scope,
  type ScopedModule,
} from '@/types/access'
import type { EmployeePublic, Role } from '@/types/domain'
import { ALL_PERMISSIONS, PERMISSIONS, type Permission } from '@/types/permissions'

const props = defineProps<{ employee: EmployeePublic }>()
const emit = defineEmits<{ updated: [] }>()

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const loading = ref(true)
const saving = ref(false)

const roles = ref<Role[]>([])
const roleIds = ref<string[]>([])
const overrides = ref<AccessOverrides>({ ...NO_OVERRIDES })
const accountType = ref<'employee' | 'affiliate'>('employee')
const isFounder = ref(false)

const search = ref('')
const open = ref<Set<string>>(new Set(['clients', 'leads']))

const canManage = computed(() => auth.hasPermission(PERMISSIONS.ROLES_ASSIGN))

/** The baseline this person's roles provide, before any individual decision. */
const rolePermissions = computed<Permission[]>(() => [
  ...new Set(
    roles.value.filter((r) => roleIds.value.includes(r.id)).flatMap((r) => r.permissions),
  ),
])

/** What they actually end up with. The field the security rules read. */
const effective = computed(() => effectivePermissions(rolePermissions.value, overrides.value))
const effectiveSet = computed(() => new Set(effective.value))

const tree = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return permissionTree(ALL_PERMISSIONS)

  return permissionTree(ALL_PERMISSIONS)
    .map((group) => ({
      ...group,
      permissions: group.permissions.filter(
        (p) => p.includes(term) || t(`permission.${p.split('.').join('.')}.label`).toLowerCase().includes(term),
      ),
    }))
    .filter((group) => group.permissions.length > 0)
})

/** How many individual decisions stand against the role, for the summary line. */
const overrideCount = computed(
  () => overrides.value.granted.length + overrides.value.revoked.length,
)

async function load(): Promise<void> {
  loading.value = true
  try {
    const [allRoles, access] = await Promise.all([
      fetchRoles().catch(() => []),
      fetchUserAccess(props.employee.uid).catch(() => null),
    ])

    roles.value = allRoles
    roleIds.value = access?.roleIds ?? []
    isFounder.value = access?.isFounder ?? false
    accountType.value = (props.employee.accountType ?? 'employee') as 'employee' | 'affiliate'

    overrides.value = {
      granted: (access?.granted ?? []) as Permission[],
      revoked: (access?.revoked ?? []) as Permission[],
      scopes: (access?.scopes ?? {}) as AccessOverrides['scopes'],
    }
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

function flip(permission: Permission): void {
  overrides.value = toggle(
    permission,
    !effectiveSet.value.has(permission),
    rolePermissions.value,
    overrides.value,
  )
}

function setScope(module: ScopedModule, scope: Scope): void {
  overrides.value = {
    ...overrides.value,
    scopes: { ...overrides.value.scopes, [module]: scope },
  }
}

function scopeOf(module: ScopedModule): Scope {
  return overrides.value.scopes[module] ?? 'own'
}

function setGroup(permissions: Permission[], on: boolean): void {
  let next = overrides.value
  for (const permission of permissions) {
    next = toggle(permission, on, rolePermissions.value, next)
  }
  overrides.value = next
}

function backToRole(): void {
  overrides.value = resetToRole(overrides.value)
}

function toggleGroup(module: string): void {
  const next = new Set(open.value)
  if (next.has(module)) next.delete(module)
  else next.add(module)
  open.value = next
}

async function commit(): Promise<void> {
  if (saving.value || !auth.uid) return

  saving.value = true
  try {
    const applied = await saveOverrides(
      props.employee.uid,
      `${props.employee.firstName} ${props.employee.lastName}`.trim(),
      overrides.value,
      roles.value,
      auth.uid,
      isFounder.value,
    )
    ui.notify('ok', t('access.saved', { n: applied.length }))
    emit('updated')
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    saving.value = false
  }
}

/**
 * Staff, or an outside partner.
 *
 * Worth the warning beside it: every internal rule in the database begins by
 * asking whether the account is internal, so a partner reads nothing internal
 * at all — however many permissions they hold. A member of staff marked as a
 * partner can sign in and see nothing, which is exactly what had happened
 * here before this control existed.
 */
async function changeType(next: 'employee' | 'affiliate'): Promise<void> {
  if (!auth.uid || next === accountType.value) return

  saving.value = true
  try {
    await setAccountType(
      props.employee.uid,
      `${props.employee.firstName} ${props.employee.lastName}`.trim(),
      next,
      auth.uid,
      isFounder.value,
    )
    accountType.value = next
    ui.notify('ok', t('access.typeChanged'))
    emit('updated')
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="card">
    <div class="card-header">
      <div>
        <h2 class="card-title">{{ t('access.title') }}</h2>
        <p class="field-hint">{{ t('access.subtitle') }}</p>
      </div>
    </div>

    <div v-if="loading" class="card-body stack">
      <div v-for="n in 3" :key="n" class="skeleton" style="height: 40px" />
    </div>

    <template v-else>
      <!-- Staff or partner. The most consequential switch on the page. -->
      <div class="card-body stack type-block">
        <div class="field">
          <span class="field-label">{{ t('access.accountType') }}</span>
          <div class="seg" role="group">
            <button
              v-for="option in (['employee', 'affiliate'] as const)"
              :key="option"
              type="button"
              class="seg-option"
              :class="{ 'is-active': accountType === option }"
              :disabled="!canManage || saving"
              @click="changeType(option)"
            >
              {{ t(`accountType.${option}`) }}
            </button>
          </div>
        </div>

        <div v-if="accountType === 'affiliate'" class="alert alert-warn">
          <AppIcon name="alert" :size="16" />
          <span>{{ t('access.affiliateWarning') }}</span>
        </div>
      </div>

      <!-- What the role gives, and what has been changed on top of it. -->
      <div class="card-body summary">
        <p class="summary-line">
          <strong>{{ effective.length }}</strong> {{ t('access.effectiveCount') }}
          ·
          {{ t('access.fromRole', { n: rolePermissions.length }) }}
          <template v-if="overrideCount">
            · <span class="custom">{{ t('access.overrides', { n: overrideCount }) }}</span>
          </template>
        </p>

        <button
          v-if="overrideCount && canManage"
          class="btn btn-ghost btn-sm"
          @click="backToRole"
        >
          {{ t('access.resetToRole') }}
        </button>
      </div>

      <div class="card-body">
        <input
          v-model="search"
          class="input"
          type="search"
          :placeholder="t('access.searchPermissions')"
        />
      </div>

      <!-- The permissions themselves, by module. -->
      <div class="groups">
        <section v-for="group in tree" :key="group.module" class="group">
          <button type="button" class="group-head" @click="toggleGroup(group.module)">
            <AppIcon :name="open.has(group.module) ? 'chevronDown' : 'chevronRight'" :size="15" />
            <span class="group-name">{{ t(`permissionGroup.${group.module}`) }}</span>
            <span class="group-count tertiary">
              {{ group.permissions.filter((p) => effectiveSet.has(p)).length }}/{{
                group.permissions.length
              }}
            </span>
          </button>

          <div v-if="open.has(group.module) || search" class="group-body">
            <div v-if="canManage" class="group-actions">
              <button class="btn btn-ghost btn-sm" @click="setGroup(group.permissions, true)">
                {{ t('access.enableAll') }}
              </button>
              <button class="btn btn-ghost btn-sm" @click="setGroup(group.permissions, false)">
                {{ t('access.disableAll') }}
              </button>
            </div>

            <!-- Whose records, for the modules where that means something. -->
            <div
              v-if="group.scoped && SCOPED_MODULES.includes(group.module as ScopedModule)"
              class="field scope-field"
            >
              <span class="field-label">{{ t('access.scope') }}</span>
              <select
                class="select"
                :value="scopeOf(group.module as ScopedModule)"
                :disabled="!canManage"
                @change="setScope(group.module as ScopedModule, ($event.target as HTMLSelectElement).value as Scope)"
              >
                <option v-for="s in SCOPES" :key="s" :value="s">{{ t(`scope.${s}`) }}</option>
              </select>
              <p class="field-hint">{{ t(`scopeHint.${scopeOf(group.module as ScopedModule)}`) }}</p>
            </div>

            <ul class="permissions">
              <li v-for="permission in group.permissions" :key="permission" class="permission">
                <label class="check permission-check">
                  <input
                    type="checkbox"
                    :checked="effectiveSet.has(permission)"
                    :disabled="!canManage"
                    @change="flip(permission)"
                  />
                  <span class="check-text">
                    {{ t(`permission.${permission}.label`) }}
                    <span class="permission-key tertiary">{{ permission }}</span>
                  </span>
                </label>

                <!-- Where it came from, so an exception is visible as one. -->
                <span
                  class="source"
                  :class="`src-${sourceOf(permission, rolePermissions, overrides)}`"
                >
                  {{ t(`accessSource.${sourceOf(permission, rolePermissions, overrides)}`) }}
                </span>
              </li>
            </ul>
          </div>
        </section>
      </div>

      <div v-if="canManage" class="card-footer">
        <button class="btn btn-primary" :disabled="saving" @click="commit">
          <span v-if="saving" class="spinner" />
          {{ t('common.save') }}
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.type-block { border-bottom: 1px solid var(--border-subtle); }

.seg { display: inline-flex; padding: 2px; border-radius: var(--radius-md); background: var(--bg-inset); border: 1px solid var(--border-subtle); }
.seg-option { padding: var(--space-2) var(--space-4); border-radius: calc(var(--radius-md) - 2px); font-size: var(--text-sm); font-weight: 550; color: var(--text-secondary); }
.seg-option.is-active { background: var(--bg-surface); color: var(--text-primary); box-shadow: var(--shadow-sm); }
.seg-option:disabled { opacity: 0.5; cursor: not-allowed; }

.summary {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-3); flex-wrap: wrap;
  padding-top: var(--space-4); padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}
.summary-line { font-size: var(--text-sm); color: var(--text-secondary); }
.custom { color: var(--text-brand); font-weight: 600; }

.groups { display: flex; flex-direction: column; }
.group { border-top: 1px solid var(--border-subtle); }

.group-head {
  display: flex; align-items: center; gap: var(--space-3);
  width: 100%; padding: var(--space-3) var(--space-5);
  text-align: left; color: var(--text-primary);
}
.group-head:hover { background: var(--bg-hover); }
.group-name { flex: 1; font-weight: 600; font-size: var(--text-sm); }
.group-count { font-size: var(--text-xs); font-variant-numeric: tabular-nums; }

.group-body { padding: 0 var(--space-5) var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
.group-actions { display: flex; gap: var(--space-2); }
.scope-field { max-width: 260px; }

.permissions { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }

.permission {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--space-3); padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border-subtle);
}
.permission:last-child { border-bottom: 0; }
.permission-check { flex: 1; min-width: 0; }
.permission-key { display: block; font-size: var(--text-xs); font-family: var(--font-mono); }

.source {
  flex-shrink: 0;
  font-size: var(--text-xs); font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.03em;
}
.src-role { color: var(--text-tertiary); }
.src-granted { color: var(--ok-500); }
.src-revoked { color: var(--danger-500); }
.src-off { color: transparent; }

@media (max-width: 640px) {
  .permission { flex-direction: column; align-items: flex-start; gap: var(--space-1); }
  .scope-field { max-width: none; }
}
</style>
