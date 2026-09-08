<script setup lang="ts">
/**
 * Clients.
 *
 * Deliberately a plain table. The brief was "simple, fast, professional — not
 * an unnecessarily complicated CRM", and the way to honour that is to show the
 * ten things somebody scans for and put everything else one click away on the
 * client's own page.
 *
 * The editor opens as a panel rather than a separate route: adding a client is
 * something you do while looking at the list, and losing your place in it to
 * type a phone number is the small friction that stops people entering data.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import CustomFields from '@/components/CustomFields.vue'
import TagInput from '@/components/ui/TagInput.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { blankClient, deleteClient, fetchClients, saveClient, setArchived } from '@/api/clients'
import { fetchEmployees } from '@/api/employees'
import { fetchServices } from '@/api/operations'
import { fetchSales } from '@/api/sales'
import { fieldsFor, fetchFieldDefs } from '@/api/records'
import { formatDate, formatRelative } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { CLIENT_STATUSES, type Client, type ClientStatus, type Service } from '@/types/business'
import type { Sale } from '@/types/revenue'
import type { CustomFieldDef } from '@/types/records'
import { PERMISSIONS } from '@/types/permissions'
import type { EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { t } = useI18n()

const loading = ref(true)
const saving = ref(false)

const clients = ref<Client[]>([])
const services = ref<Service[]>([])
const people = ref<EmployeePublic[]>([])
const sales = ref<Sale[]>([])
const fieldDefs = ref<CustomFieldDef[]>([])

const search = ref('')
const statusFilter = ref<ClientStatus | ''>('')
const responsibleFilter = ref('')
const showArchived = ref(false)
const sortKey = ref<'name' | 'recent' | 'status'>('name')

const draft = ref<Client | null>(null)
const pendingDelete = ref<Client | null>(null)

const canCreate = computed(() => auth.hasPermission(PERMISSIONS.CLIENTS_CREATE))
const canEdit = computed(() => auth.hasPermission(PERMISSIONS.CLIENTS_EDIT))
const canDelete = computed(() => auth.hasPermission(PERMISSIONS.CLIENTS_DELETE))
const canSeeManagement = computed(() => auth.hasPermission(PERMISSIONS.EMPLOYEES_VIEW_PRIVATE_INFO))

const clientFields = computed(() => fieldsFor(fieldDefs.value, 'client'))
const serviceNames = computed(() => new Map(services.value.map((s) => [s.id, s.name])))

/** When somebody last did anything with this client, from their sales. */
const lastActivity = computed(() => {
  const map = new Map<string, string>()
  for (const sale of sales.value) {
    const current = map.get(sale.clientId) ?? ''
    if (sale.saleDate > current) map.set(sale.clientId, sale.saleDate)
  }
  return map
})

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()

  const rows = clients.value.filter((c) => {
    if (!showArchived.value && c.archived) return false
    if (statusFilter.value && c.status !== statusFilter.value) return false
    if (responsibleFilter.value && c.responsibleUid !== responsibleFilter.value) return false
    if (!term) return true

    return [c.name, c.description, c.contactName, c.email, c.phone, c.city, ...(c.tags ?? [])]
      .join(' ')
      .toLowerCase()
      .includes(term)
  })

  return rows.sort((a, b) => {
    if (sortKey.value === 'recent') {
      return (lastActivity.value.get(b.id) ?? b.updatedAt ?? '').localeCompare(
        lastActivity.value.get(a.id) ?? a.updatedAt ?? '',
      )
    }
    if (sortKey.value === 'status') return a.status.localeCompare(b.status)
    return a.name.localeCompare(b.name)
  })
})

async function load(): Promise<void> {
  loading.value = true
  const [c, s, p, sl, f] = await Promise.all([
    fetchClients(),
    fetchServices().catch(() => []),
    fetchEmployees().catch(() => []),
    fetchSales().catch(() => []),
    fetchFieldDefs().catch(() => []),
  ])
  clients.value = c
  services.value = s
  people.value = p
  sales.value = sl
  fieldDefs.value = f
  loading.value = false
}

function startNew(): void {
  const me = people.value.find((p) => p.uid === auth.uid)
  draft.value = {
    ...blankClient(),
    responsibleUid: auth.uid,
    responsibleName: me ? `${me.firstName} ${me.lastName}` : (auth.displayName ?? ''),
  }
}

function startEdit(client: Client): void {
  draft.value = { ...client, tags: [...(client.tags ?? [])], serviceIds: [...(client.serviceIds ?? [])] }
}

function toggleService(id: string): void {
  const list = draft.value?.serviceIds
  if (!list) return
  const i = list.indexOf(id)
  if (i >= 0) list.splice(i, 1)
  else list.push(id)
}

function onResponsibleChange(uid: string): void {
  if (!draft.value) return
  const person = people.value.find((p) => p.uid === uid)
  draft.value.responsibleUid = uid || null
  draft.value.responsibleName = person ? `${person.firstName} ${person.lastName}` : ''
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.name.trim()) {
    ui.notify('danger', t('clients.nameRequired'))
    return
  }

  saving.value = true
  try {
    await saveClient({ ...d, name: d.name.trim() })
    ui.notify('ok', t('clients.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('clients.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value) return
  await deleteClient(pendingDelete.value)
  ui.notify('ok', t('recycle.movedToBin'))
  pendingDelete.value = null
  await load()
}

async function toggleArchive(client: Client): Promise<void> {
  await setArchived(client, !client.archived)
  await load()
}

function clearFilters(): void {
  search.value = ''
  statusFilter.value = ''
  responsibleFilter.value = ''
  showArchived.value = false
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('clients.title') }}</h1>
        <p class="page-subtitle">{{ t('clients.subtitle') }}</p>
      </div>
      <button v-if="canCreate && !draft" class="btn btn-primary" @click="startNew">
        <AppIcon name="plus" :size="16" /> {{ t('clients.newClient') }}
      </button>
    </header>

    <!-- Editor --------------------------------------------------------- -->
    <section v-if="draft" class="card editor">
      <div class="card-header">
        <h2 class="card-title">
          {{ draft.id ? t('clients.editClient') : t('clients.newClient') }}
        </h2>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="draft = null">
          <AppIcon name="close" :size="18" />
        </button>
      </div>

      <div class="card-body stack">
        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="c-name">
              {{ t('clients.name') }}<span class="req">*</span>
            </label>
            <input id="c-name" v-model="draft.name" class="input" :maxlength="LIMITS.name" />
          </div>

          <div class="field">
            <label class="field-label" for="c-desc">{{ t('clients.description') }}</label>
            <input id="c-desc" v-model="draft.description" class="input" :maxlength="LIMITS.shortText" />
            <p class="field-hint">{{ t('clients.descriptionHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="c-contact">{{ t('clients.contactName') }}</label>
            <input id="c-contact" v-model="draft.contactName" class="input" :maxlength="LIMITS.name" />
          </div>

          <div class="field">
            <label class="field-label" for="c-email">{{ t('clients.email') }}</label>
            <input id="c-email" v-model="draft.email" class="input" type="email" />
          </div>

          <div class="field">
            <label class="field-label" for="c-phone">{{ t('clients.phone') }}</label>
            <input id="c-phone" v-model="draft.phone" class="input" />
          </div>

          <div class="field">
            <label class="field-label" for="c-resp">{{ t('clients.responsible') }}</label>
            <select
              id="c-resp"
              :value="draft.responsibleUid ?? ''"
              class="select"
              @change="onResponsibleChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="">—</option>
              <option v-for="p in people" :key="p.uid" :value="p.uid">
                {{ p.firstName }} {{ p.lastName }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="c-status">{{ t('table.status') }}</label>
            <select id="c-status" v-model="draft.status" class="select">
              <option v-for="s in CLIENT_STATUSES" :key="s" :value="s">
                {{ t(`clientStatus.${s}`) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="c-since">{{ t('clients.since') }}</label>
            <input id="c-since" v-model="draft.clientSince" class="input" type="date" />
          </div>
        </div>

        <!-- Advanced, folded away so the common case stays short --------- -->
        <details class="more">
          <summary>{{ t('common.moreDetails') }}</summary>

          <div class="field-grid">
            <div class="field">
              <label class="field-label" for="c-city">{{ t('clients.city') }}</label>
              <input id="c-city" v-model="draft.city" class="input" :maxlength="LIMITS.name" />
            </div>
            <div class="field">
              <label class="field-label" for="c-country">{{ t('clients.country') }}</label>
              <input id="c-country" v-model="draft.country" class="input" :maxlength="LIMITS.name" />
            </div>
            <div class="field">
              <label class="field-label" for="c-address">{{ t('clients.address') }}</label>
              <input id="c-address" v-model="draft.address" class="input" :maxlength="LIMITS.shortText" />
            </div>
            <div class="field">
              <label class="field-label" for="c-web">{{ t('clients.website') }}</label>
              <input id="c-web" v-model="draft.website" class="input" type="url" />
            </div>
            <div class="field">
              <label class="field-label" for="c-industry">{{ t('clients.industry') }}</label>
              <input id="c-industry" v-model="draft.industry" class="input" :maxlength="LIMITS.name" />
            </div>
            <div class="field">
              <label class="field-label" for="c-ig">{{ t('clients.instagram') }}</label>
              <input id="c-ig" v-model="draft.instagram" class="input" :maxlength="LIMITS.name" />
            </div>
            <div class="field">
              <label class="field-label" for="c-owner">{{ t('clients.ownerName') }}</label>
              <input id="c-owner" v-model="draft.ownerName" class="input" :maxlength="LIMITS.name" />
            </div>
            <div class="field">
              <label class="field-label" for="c-manager">{{ t('clients.managerName') }}</label>
              <input id="c-manager" v-model="draft.managerName" class="input" :maxlength="LIMITS.name" />
            </div>
          </div>

          <div class="field">
            <span class="field-label">{{ t('clients.tags') }}</span>
            <TagInput v-model="draft.tags" :placeholder="t('clients.tagsHint')" />
          </div>

          <div v-if="services.length" class="field">
            <span class="field-label">{{ t('clients.services') }}</span>
            <div class="options">
              <label v-for="s in services" :key="s.id" class="check">
                <input
                  type="checkbox"
                  :checked="draft.serviceIds.includes(s.id)"
                  @change="toggleService(s.id)"
                />
                <span class="check-text">{{ s.name }}</span>
              </label>
            </div>
          </div>

          <div class="field">
            <label class="field-label" for="c-notes">{{ t('clients.notes') }}</label>
            <textarea id="c-notes" v-model="draft.notes" class="textarea" :maxlength="LIMITS.longText" />
          </div>
        </details>

        <CustomFields
          v-model="draft.custom"
          :fields="clientFields"
          :can-see-management="canSeeManagement"
        />
      </div>

      <div class="card-footer">
        <button class="btn btn-secondary" @click="draft = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="commit">
          <span v-if="saving" class="spinner" />{{ t('common.save') }}
        </button>
      </div>
    </section>

    <!-- Filters -------------------------------------------------------- -->
    <div class="toolbar">
      <div class="search toolbar-grow">
        <AppIcon name="search" :size="16" class="search-icon" />
        <input
          v-model="search"
          class="input search-input"
          type="search"
          :placeholder="t('clients.searchPlaceholder')"
          :aria-label="t('common.search')"
        />
      </div>

      <select v-model="statusFilter" class="select compact" :aria-label="t('table.status')">
        <option value="">{{ t('clients.allStatuses') }}</option>
        <option v-for="s in CLIENT_STATUSES" :key="s" :value="s">{{ t(`clientStatus.${s}`) }}</option>
      </select>

      <select v-model="responsibleFilter" class="select compact" :aria-label="t('clients.responsible')">
        <option value="">{{ t('clients.allResponsible') }}</option>
        <option v-for="p in people" :key="p.uid" :value="p.uid">
          {{ p.firstName }} {{ p.lastName }}
        </option>
      </select>

      <select v-model="sortKey" class="select compact" :aria-label="t('common.sort')">
        <option value="name">{{ t('clients.sortName') }}</option>
        <option value="recent">{{ t('clients.sortRecent') }}</option>
        <option value="status">{{ t('clients.sortStatus') }}</option>
      </select>

      <label class="check inline">
        <input v-model="showArchived" type="checkbox" />
        <span class="check-text">{{ t('clients.showArchived') }}</span>
      </label>
    </div>

    <!-- List ----------------------------------------------------------- -->
    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 4" :key="n" class="skeleton" style="height: 44px" />
      </div>
    </div>

    <div v-else-if="visible.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="building" :size="20" /></span>
        <p class="empty-title">
          {{ clients.length === 0 ? t('clients.empty') : t('clients.noMatch') }}
        </p>
        <p class="empty-text">
          {{ clients.length === 0 ? t('clients.emptyHint') : t('clients.noMatchHint') }}
        </p>
        <button v-if="canCreate && clients.length === 0" class="btn btn-primary" @click="startNew">
          {{ t('clients.newClient') }}
        </button>
        <button v-else-if="clients.length > 0" class="btn btn-secondary" @click="clearFilters">
          {{ t('common.clear') }}
        </button>
      </div>
    </div>

    <section v-else class="card">
      <div class="table-wrap">
        <table class="table table-cards">
          <thead>
            <tr>
              <th>{{ t('clients.name') }}</th>
              <th class="hide-sm">{{ t('clients.contact') }}</th>
              <th class="hide-md">{{ t('clients.responsible') }}</th>
              <th class="hide-md">{{ t('clients.services') }}</th>
              <th>{{ t('table.status') }}</th>
              <th class="hide-sm">{{ t('clients.lastActivity') }}</th>
              <th class="col-actions" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="client in visible" :key="client.id" :class="{ 'is-archived': client.archived }">
              <td>
                <button type="button" class="name-cell" @click="router.push(`/clients/${client.id}`)">
                  <UserAvatar :name="client.name" :photo-url="client.logoUrl" :size="32" />
                  <span class="name-text">
                    <span class="name">{{ client.name }}</span>
                    <span class="tertiary truncate">{{ client.description || client.city }}</span>
                  </span>
                </button>
              </td>

              <td :data-label="t('clients.contact')" class="hide-sm">
                <span class="stack-tight">
                  <span v-if="client.contactName">{{ client.contactName }}</span>
                  <a v-if="client.email" :href="`mailto:${client.email}`" class="link-quiet">
                    {{ client.email }}
                  </a>
                  <a v-if="client.phone" :href="`tel:${client.phone}`" class="link-quiet">
                    {{ client.phone }}
                  </a>
                  <span v-if="!client.contactName && !client.email && !client.phone" class="tertiary">
                    —
                  </span>
                </span>
              </td>

              <td :data-label="t('clients.responsible')" class="hide-md muted">{{ client.responsibleName || '—' }}</td>

              <td :data-label="t('clients.services')" class="hide-md">
                <span v-if="(client.serviceIds ?? []).length === 0" class="tertiary">—</span>
                <span v-else class="chips">
                  <span v-for="id in client.serviceIds.slice(0, 2)" :key="id" class="badge badge-plain">
                    {{ serviceNames.get(id) ?? '—' }}
                  </span>
                  <span v-if="client.serviceIds.length > 2" class="tertiary">
                    +{{ client.serviceIds.length - 2 }}
                  </span>
                </span>
              </td>

              <td :data-label="t('table.status')">
                <span class="badge" :class="`cs-${client.status}`">
                  {{ t(`clientStatus.${client.status}`) }}
                </span>
              </td>

              <td :data-label="t('clients.lastActivity')" class="hide-sm muted nowrap">
                <template v-if="lastActivity.get(client.id)">
                  {{ formatDate(lastActivity.get(client.id)!) }}
                </template>
                <template v-else-if="client.updatedAt">
                  {{ formatRelative(client.updatedAt) }}
                </template>
                <template v-else>—</template>
              </td>

              <td class="col-actions">
                <button
                  class="btn btn-ghost btn-sm"
                  :aria-label="t('clients.openClient')"
                  @click="router.push(`/clients/${client.id}`)"
                >
                  <AppIcon name="arrowRight" :size="15" />
                </button>
                <button
                  v-if="canEdit"
                  class="btn btn-ghost btn-sm"
                  :aria-label="t('common.edit')"
                  @click="startEdit(client)"
                >
                  <AppIcon name="edit" :size="15" />
                </button>
                <button
                  v-if="canEdit"
                  class="btn btn-ghost btn-sm"
                  :aria-label="t('clients.archive')"
                  @click="toggleArchive(client)"
                >
                  <AppIcon name="inbox" :size="15" />
                </button>
                <button
                  v-if="canDelete"
                  class="btn btn-ghost btn-sm danger"
                  :aria-label="t('common.delete')"
                  @click="pendingDelete = client"
                >
                  <AppIcon name="trash" :size="15" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="card-body tertiary small">
        {{ visible.length }} / {{ clients.length }}
      </p>
    </section>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('clients.deleteClient')"
      :message="t('recycle.deleteExplain')"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>

<style scoped>
.editor { border-color: var(--accent-soft-border); }
.search { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: var(--space-3); color: var(--text-tertiary); pointer-events: none; }
.search-input { padding-left: calc(var(--space-3) * 2 + 16px); }
.select.compact { max-width: 180px; }
.check.inline { align-items: center; white-space: nowrap; }

.more { border-top: 1px solid var(--border-subtle); padding-top: var(--space-3); }
.more > summary { cursor: pointer; font-size: var(--text-sm); font-weight: 600; color: var(--text-secondary); margin-bottom: var(--space-3); }
.more > summary:hover { color: var(--text-brand); }
.options { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-2); }

.name-cell { display: flex; align-items: center; gap: var(--space-3); text-align: left; min-width: 0; }
.name-text { display: flex; flex-direction: column; min-width: 0; }
.name { font-weight: 600; }
.name-cell:hover .name { color: var(--text-brand); }
.name-text .tertiary { font-size: var(--text-xs); }

.stack-tight { display: flex; flex-direction: column; font-size: var(--text-xs); }
.link-quiet { color: var(--text-secondary); }
.link-quiet:hover { color: var(--text-brand); }
.chips { display: flex; align-items: center; gap: var(--space-1); flex-wrap: wrap; }

.is-archived { opacity: 0.55; }
.cs-active { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.cs-prospect { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); color: var(--text-brand); }
.cs-paused { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.cs-former { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }

.nowrap { white-space: nowrap; }
.small { font-size: var(--text-xs); }
.danger:hover { color: var(--danger-500); }

</style>
