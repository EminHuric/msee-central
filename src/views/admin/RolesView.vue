<script setup lang="ts">
/**
 * Roles & Permissions.
 *
 * A role is a named bundle of permissions, and the company defines as many as
 * it needs — Marketing Manager, Developer, Account Manager, whatever the work
 * requires. Nothing here is fixed except the owner roles, which hold
 * everything by definition and are the founder's to assign.
 *
 * Position and role stay separate on purpose. A position is the job somebody
 * is paid to do; a role is what they may reach inside this system. Two people
 * with different job titles often need the same access, and conflating the two
 * is what turns a permission system into a mess of near-duplicates.
 *
 * Ticking a box here changes what its holders can reach immediately, because
 * assigning a role rewrites the flattened permission list the security rules
 * actually read.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import { fetchEmployees } from '@/api/employees'
import { fetchRoles, roleDescription, roleName, saveRole, type RoleInput } from '@/api/roles'
import { slugify } from '@/api/administration'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { LIMITS } from '@/lib/validation'
import type { EmployeePublic, Role } from '@/types/domain'
import {
  PERMISSION_GROUPS,
  PERMISSIONS,
  SENSITIVE_PERMISSIONS,
  type Permission,
} from '@/types/permissions'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const loading = ref(true)
const saving = ref(false)
const roles = ref<Role[]>([])
const employees = ref<EmployeePublic[]>([])
const draft = ref<RoleInput | null>(null)
const editingExisting = ref(false)

const canCreate = computed(() => auth.hasPermission(PERMISSIONS.ROLES_CREATE))
const canEdit = computed(() => auth.hasPermission(PERMISSIONS.ROLES_EDIT))

/** How many people hold a role, so the weight of a change is visible. */
function holders(roleId: string): number {
  return employees.value.filter((e) => (e.roleIds ?? []).includes(roleId)).length
}

function isSensitive(permission: Permission): boolean {
  return SENSITIVE_PERMISSIONS.includes(permission)
}

async function load(): Promise<void> {
  loading.value = true
  const [allRoles, people] = await Promise.all([
    fetchRoles().catch(() => []),
    fetchEmployees().catch(() => []),
  ])
  // Owner roles first: they are the ones somebody scanning this page is
  // checking on.
  roles.value = allRoles.sort((a, b) => Number(b.grantsAll) - Number(a.grantsAll))
  employees.value = people
  loading.value = false
}

/* ---- Editing ------------------------------------------------------ */

function startNew(): void {
  editingExisting.value = false
  draft.value = { id: '', name: '', description: '', permissions: [], status: 'active' }
}

function startEdit(role: Role): void {
  editingExisting.value = true
  draft.value = {
    id: role.id,
    name: roleName(role),
    description: roleDescription(role),
    permissions: [...role.permissions],
    status: role.status,
  }
}

function cancel(): void {
  draft.value = null
}

function togglePermission(permission: Permission): void {
  if (!draft.value) return
  draft.value.permissions = draft.value.permissions.includes(permission)
    ? draft.value.permissions.filter((p) => p !== permission)
    : [...draft.value.permissions, permission]
}

function setGroup(permissions: readonly Permission[], on: boolean): void {
  if (!draft.value) return
  const current = new Set(draft.value.permissions)
  for (const permission of permissions) {
    if (on) current.add(permission)
    else current.delete(permission)
  }
  draft.value.permissions = [...current]
}

function groupSelected(permissions: readonly Permission[]): number {
  if (!draft.value) return 0
  return permissions.filter((p) => draft.value?.permissions.includes(p)).length
}

async function commit(): Promise<void> {
  const role = draft.value
  if (!role || saving.value) return

  if (!role.name.trim()) {
    ui.notify('danger', t('roles.nameRequired'))
    return
  }

  /*
   * The id is derived from the first name given and then frozen. Renaming a
   * role later must not orphan the people already holding it, and the id is
   * what they hold.
   */
  const isNew = !editingExisting.value
  const id = isNew ? slugify(role.name) : role.id
  if (!id) {
    ui.notify('danger', t('roles.nameRequired'))
    return
  }

  saving.value = true
  try {
    await saveRole({ ...role, id }, isNew)
    ui.notify('ok', t('roles.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('roles.saveFailed'))
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
        <h1 class="page-title">{{ t('roles.title') }}</h1>
        <p class="page-subtitle">{{ t('roles.subtitle') }}</p>
      </div>
      <button v-if="canCreate && !draft" class="btn btn-primary" @click="startNew">
        <AppIcon name="plus" :size="16" />
        {{ t('roles.newRole') }}
      </button>
    </header>

    <!-- Editor --------------------------------------------------------- -->
    <section v-if="draft" class="card editor">
      <div class="card-header">
        <h2 class="card-title">
          {{ editingExisting ? t('roles.editRole') : t('roles.newRole') }}
        </h2>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="cancel">
          <AppIcon name="close" :size="18" />
        </button>
      </div>

      <div class="card-body stack">
        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="r-name">
              {{ t('roles.name') }}<span class="req">*</span>
            </label>
            <input id="r-name" v-model="draft.name" class="input" :maxlength="LIMITS.name" />
            <p class="field-hint">{{ t('roles.nameHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="r-status">{{ t('table.status') }}</label>
            <select id="r-status" v-model="draft.status" class="select">
              <option value="active">{{ t('roles.statusActive') }}</option>
              <option value="inactive">{{ t('roles.statusInactive') }}</option>
            </select>
            <p class="field-hint">{{ t('roles.statusHint') }}</p>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="r-desc">{{ t('roles.description') }}</label>
          <input
            id="r-desc"
            v-model="draft.description"
            class="input"
            :maxlength="LIMITS.shortText"
          />
          <p class="field-hint">{{ t('roles.descriptionHint') }}</p>
        </div>

        <div
          v-if="editingExisting && holders(draft.id) > 0"
          class="alert alert-warn"
        >
          <AppIcon name="users" :size="16" />
          <span>{{ t('roles.inUseWarning', { n: holders(draft.id) }) }}</span>
        </div>

        <!-- Permissions -->
        <div>
          <div class="spread perm-head">
            <div>
              <span class="field-label">{{ t('roles.permissions') }}</span>
              <p class="field-hint">{{ t('roles.permissionsHint') }}</p>
            </div>
            <span class="badge badge-plain badge-accent">
              {{ t('roles.selectedCount', draft.permissions.length, { named: { n: draft.permissions.length } }) }}
            </span>
          </div>

          <p v-if="draft.permissions.length === 0" class="field-error perm-warning">
            {{ t('roles.noPermissions') }}
          </p>

          <div class="groups">
            <fieldset v-for="group in PERMISSION_GROUPS" :key="group.key" class="group">
              <legend class="group-legend">
                {{ t(`permissionGroup.${group.key}`) }}
                <span class="tertiary">
                  {{ groupSelected(group.permissions) }}/{{ group.permissions.length }}
                </span>
              </legend>

              <div class="group-actions">
                <button type="button" class="linkish" @click="setGroup(group.permissions, true)">
                  {{ t('roles.selectGroup') }}
                </button>
                <button type="button" class="linkish" @click="setGroup(group.permissions, false)">
                  {{ t('roles.clearGroup') }}
                </button>
              </div>

              <label
                v-for="permission in group.permissions"
                :key="permission"
                class="check perm"
              >
                <input
                  type="checkbox"
                  :checked="draft.permissions.includes(permission)"
                  @change="togglePermission(permission)"
                />
                <span class="perm-text">
                  <span class="perm-label">
                    {{ t(`permission.${permission}.label`) }}
                    <span v-if="isSensitive(permission)" class="perm-flag">
                      {{ t('roles.sensitive') }}
                    </span>
                  </span>
                  <span class="perm-desc">{{ t(`permission.${permission}.description`) }}</span>
                </span>
              </label>
            </fieldset>
          </div>

          <p class="field-hint sensitive-note">
            <AppIcon name="alert" :size="13" /> {{ t('roles.sensitiveHint') }}
          </p>
        </div>
      </div>

      <div class="card-footer">
        <button class="btn btn-secondary" @click="cancel">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="commit">
          <span v-if="saving" class="spinner" />
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </section>

    <!-- List ----------------------------------------------------------- -->
    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 56px" />
      </div>
    </div>

    <div v-else-if="roles.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="shield" :size="20" /></span>
        <p class="empty-title">{{ t('roles.empty') }}</p>
        <p class="empty-text">{{ t('roles.emptyHint') }}</p>
      </div>
    </div>

    <div v-else class="role-grid">
      <article v-for="role in roles" :key="role.id" class="card role" :class="{ 'is-owner': role.grantsAll }">
        <div class="role-head">
          <div class="role-title">
            <h2 class="role-name">{{ roleName(role) }}</h2>
            <span v-if="role.grantsAll" class="badge badge-plain badge-accent">
              {{ t('roles.ownerRole') }}
            </span>
            <span v-if="role.status === 'inactive'" class="badge badge-deactivated">
              {{ t('roles.statusInactive') }}
            </span>
          </div>

          <button
            v-if="canEdit && !role.grantsAll"
            class="btn btn-secondary btn-sm"
            @click="startEdit(role)"
          >
            {{ t('common.edit') }}
          </button>
          <span v-else-if="role.grantsAll" class="badge badge-plain lock-badge">
            <AppIcon name="lock" :size="12" /> {{ t('roles.lockedRole') }}
          </span>
        </div>

        <p v-if="roleDescription(role)" class="muted role-desc">{{ roleDescription(role) }}</p>
        <p v-if="role.grantsAll" class="tertiary role-desc">{{ t('roles.ownerRoleHint') }}</p>

        <div class="role-foot">
          <span class="badge badge-plain">
            {{ t('roles.selectedCount', role.permissions.length, { named: { n: role.permissions.length } }) }}
          </span>
          <span class="tertiary">
            {{ t('roles.peopleCount', holders(role.id), { named: { n: holders(role.id) } }) }}
          </span>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.editor {
  border-color: var(--accent-soft-border);
}

.perm-head {
  align-items: flex-start;
  margin-bottom: var(--space-3);
}

.perm-warning {
  margin-bottom: var(--space-3);
}

.groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-4);
}

.group {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  margin: 0;
  background: var(--bg-surface-2);
  position: relative;
}

.group-legend {
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-secondary);
  padding-inline: var(--space-2);
}

.group-actions {
  display: flex;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.linkish {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  text-decoration: underline;
}

.linkish:hover {
  color: var(--text-brand);
}

.perm {
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  align-items: flex-start;
}

.perm:hover {
  background: var(--bg-hover);
}

.perm-text {
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: var(--leading-normal);
}

.perm-flag {
  margin-left: var(--space-2);
  padding: 1px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--warn-bg);
  border: 1px solid var(--warn-border);
  color: var(--warn-500);
  font-size: var(--text-xs);
  font-weight: 600;
}

.perm-label {
  display: block;
  font-weight: 550;
}

/*
 * The description is the point of this screen. "employees.view_private_info"
 * tells somebody choosing permissions nothing at all about what they are
 * agreeing to, so the plain sentence carries equal weight to the name.
 */
.perm-desc {
  display: block;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  line-height: var(--leading-relaxed);
  margin-top: 2px;
}

.sensitive-note {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.role-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-4);
}

.role {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
}

.role.is-owner {
  border-color: var(--accent-soft-border);
}

.role-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.role-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  min-width: 0;
}

.role-name {
  font-size: var(--text-md);
  font-weight: 650;
}

.role-desc {
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
}

.role-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-top: auto;
  padding-top: var(--space-3);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--text-xs);
}

.lock-badge {
  gap: var(--space-1);
}
</style>
