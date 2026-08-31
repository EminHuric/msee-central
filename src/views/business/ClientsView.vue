<script setup lang="ts">
/**
 * Clients.
 *
 * The first business record, and the one everything else attaches to:
 * projects point at a client, income points at a project. Getting this shape
 * right is what makes "which client is actually worth keeping" answerable
 * later without restructuring anything.
 *
 * Nothing is deletable. A client that stops working with you becomes
 * `former`, which keeps their history readable — deleting one would leave
 * every invoice and project pointing at a name nobody can look up.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import {
  EMPTY_CLIENT,
  fetchClients,
  saveClient,
  type ClientInput,
} from '@/api/clients'
import { isEmail, LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { CLIENT_STATUSES, type Client, type ClientStatus } from '@/types/business'
import { PERMISSIONS } from '@/types/permissions'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const loading = ref(true)
const loadError = ref(false)
const saving = ref(false)
const clients = ref<Client[]>([])

const search = ref('')
const statusFilter = ref<ClientStatus | ''>('')

const draft = ref<ClientInput | null>(null)
const editingExisting = ref(false)

const canManage = computed(() => auth.hasPermission(PERMISSIONS.CLIENTS_MANAGE))

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()

  return clients.value.filter((client) => {
    if (statusFilter.value && client.status !== statusFilter.value) return false
    if (!term) return true

    return [client.name, client.contactName, client.email, client.city, client.country]
      .join(' ')
      .toLowerCase()
      .includes(term)
  })
})

const hasFilters = computed(() => search.value.trim() !== '' || statusFilter.value !== '')

/** How many sit in each status, so the tabs carry a count. */
const counts = computed(() => {
  const out = {} as Record<ClientStatus, number>
  for (const status of CLIENT_STATUSES) {
    out[status] = clients.value.filter((c) => c.status === status).length
  }
  return out
})

function clearFilters(): void {
  search.value = ''
  statusFilter.value = ''
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = false
  try {
    clients.value = await fetchClients()
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

/* ---- Editing ------------------------------------------------------ */

function startNew(): void {
  editingExisting.value = false
  draft.value = { ...EMPTY_CLIENT }
}

function startEdit(client: Client): void {
  editingExisting.value = true
  draft.value = {
    id: client.id,
    name: client.name,
    contactName: client.contactName ?? '',
    email: client.email ?? '',
    phone: client.phone ?? '',
    city: client.city ?? '',
    country: client.country ?? '',
    website: client.website ?? '',
    status: client.status,
    notes: client.notes ?? '',
  }
}

const emailInvalid = computed(
  () => !!draft.value?.email.trim() && !isEmail(draft.value.email),
)

async function commit(): Promise<void> {
  const client = draft.value
  if (!client || saving.value) return

  if (!client.name.trim()) {
    ui.notify('danger', t('clients.nameRequired'))
    return
  }
  if (emailInvalid.value) {
    ui.notify('danger', t('errors.invalidEmail'))
    return
  }

  saving.value = true
  try {
    await saveClient(client, !editingExisting.value)
    ui.notify('ok', t('clients.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('clients.saveFailed'))
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
        <h1 class="page-title">{{ t('clients.title') }}</h1>
        <p class="page-subtitle">{{ t('clients.subtitle') }}</p>
      </div>
      <button v-if="canManage && !draft" class="btn btn-primary" @click="startNew">
        <AppIcon name="plus" :size="16" />
        {{ t('clients.newClient') }}
      </button>
    </header>

    <!-- Editor --------------------------------------------------------- -->
    <section v-if="draft" class="card editor">
      <div class="card-header">
        <h2 class="card-title">
          {{ editingExisting ? t('clients.editClient') : t('clients.newClient') }}
        </h2>
        <button
          class="btn btn-ghost btn-icon"
          :aria-label="t('common.close')"
          @click="draft = null"
        >
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
            <p class="field-hint">{{ t('clients.nameHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="c-status">{{ t('clients.filterStatus') }}</label>
            <select id="c-status" v-model="draft.status" class="select">
              <option v-for="status in CLIENT_STATUSES" :key="status" :value="status">
                {{ t(`clientStatus.${status}`) }}
              </option>
            </select>
            <p class="field-hint">{{ t('clients.statusHint') }}</p>
          </div>
        </div>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="c-contact">{{ t('clients.contactName') }}</label>
            <input
              id="c-contact"
              v-model="draft.contactName"
              class="input"
              :maxlength="LIMITS.name"
            />
            <p class="field-hint">{{ t('clients.contactHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="c-email">{{ t('auth.email') }}</label>
            <input
              id="c-email"
              v-model="draft.email"
              class="input"
              type="email"
              :maxlength="LIMITS.email"
              :aria-invalid="emailInvalid"
            />
            <p v-if="emailInvalid" class="field-error">{{ t('errors.invalidEmail') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="c-phone">{{ t('register.phone') }}</label>
            <input id="c-phone" v-model="draft.phone" class="input" :maxlength="LIMITS.phone" />
          </div>
        </div>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="c-city">{{ t('register.city') }}</label>
            <input id="c-city" v-model="draft.city" class="input" :maxlength="LIMITS.city" />
          </div>

          <div class="field">
            <label class="field-label" for="c-country">{{ t('register.country') }}</label>
            <input
              id="c-country"
              v-model="draft.country"
              class="input"
              :maxlength="LIMITS.country"
            />
          </div>

          <div class="field">
            <label class="field-label" for="c-web">{{ t('clients.website') }}</label>
            <input
              id="c-web"
              v-model="draft.website"
              class="input"
              :maxlength="LIMITS.position"
              placeholder="example.com"
            />
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="c-notes">{{ t('clients.notes') }}</label>
          <textarea
            id="c-notes"
            v-model="draft.notes"
            class="textarea"
            :maxlength="LIMITS.longText"
          />
          <p class="field-hint">{{ t('clients.notesHint') }}</p>
        </div>
      </div>

      <div class="card-footer">
        <button class="btn btn-secondary" @click="draft = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="commit">
          <span v-if="saving" class="spinner" />
          {{ saving ? t('common.saving') : t('common.save') }}
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

      <select v-model="statusFilter" class="select" :aria-label="t('clients.filterStatus')">
        <option value="">{{ t('clients.allStatuses') }}</option>
        <option v-for="status in CLIENT_STATUSES" :key="status" :value="status">
          {{ t(`clientStatus.${status}`) }} ({{ counts[status] }})
        </option>
      </select>

      <button v-if="hasFilters" type="button" class="btn btn-ghost" @click="clearFilters">
        {{ t('common.clear') }}
      </button>
    </div>

    <!-- States --------------------------------------------------------- -->
    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 4" :key="n" class="skeleton" style="height: 44px" />
      </div>
    </div>

    <div v-else-if="loadError" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="alert" :size="20" /></span>
        <p class="empty-title">{{ t('errors.generic') }}</p>
        <button class="btn btn-secondary" @click="load">{{ t('common.retry') }}</button>
      </div>
    </div>

    <div v-else-if="filtered.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="building" :size="20" /></span>
        <p class="empty-title">
          {{ clients.length === 0 ? t('clients.empty') : t('clients.noMatch') }}
        </p>
        <p class="empty-text">
          {{ clients.length === 0 ? t('clients.emptyHint') : t('clients.noMatchHint') }}
        </p>
        <button v-if="hasFilters" class="btn btn-secondary" @click="clearFilters">
          {{ t('common.clear') }}
        </button>
        <button v-else-if="canManage" class="btn btn-primary" @click="startNew">
          {{ t('clients.newClient') }}
        </button>
      </div>
    </div>

    <!-- The list ------------------------------------------------------- -->
    <div v-else class="card">
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('clients.name') }}</th>
              <th>{{ t('clients.contact') }}</th>
              <th>{{ t('clients.location') }}</th>
              <th>{{ t('table.status') }}</th>
              <th class="col-actions" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="client in filtered" :key="client.id">
              <td>
                <div class="client-cell">
                  <span class="client-mark">{{ client.name.slice(0, 1).toUpperCase() }}</span>
                  <div class="client-text">
                    <span class="client-name">{{ client.name }}</span>
                    <span v-if="client.website" class="client-sub truncate">
                      {{ client.website }}
                    </span>
                  </div>
                </div>
              </td>
              <td>
                <div class="stacked">
                  <span v-if="client.contactName">{{ client.contactName }}</span>
                  <span v-if="client.email" class="tertiary small">{{ client.email }}</span>
                  <span v-if="!client.contactName && !client.email" class="tertiary">—</span>
                </div>
              </td>
              <td class="muted">
                {{ [client.city, client.country].filter(Boolean).join(', ') || '—' }}
              </td>
              <td>
                <span class="badge" :class="`badge-${client.status}`">
                  {{ t(`clientStatus.${client.status}`) }}
                </span>
              </td>
              <td class="col-actions">
                <button
                  v-if="canManage"
                  class="btn btn-secondary btn-sm"
                  @click="startEdit(client)"
                >
                  {{ t('common.edit') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <p v-if="!loading && clients.length > 0" class="tertiary foot-note">
      {{ t('common.results', filtered.length, { named: { n: filtered.length } }) }}
    </p>
  </div>
</template>

<style scoped>
.editor {
  border-color: var(--accent-soft-border);
}

.search {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: var(--space-3);
  color: var(--text-tertiary);
  pointer-events: none;
}

.search-input {
  padding-left: calc(var(--space-3) * 2 + 16px);
}

.client-cell {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}

/* Initial rather than a photo: a client is a company, not a face. */
.client-mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: var(--accent-soft-bg);
  border: 1px solid var(--accent-soft-border);
  color: var(--text-brand);
  font-weight: 650;
  flex-shrink: 0;
}

.client-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.client-name {
  font-weight: 550;
}

.client-sub {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.stacked {
  display: flex;
  flex-direction: column;
}

.small {
  font-size: var(--text-xs);
}

.foot-note {
  font-size: var(--text-xs);
}

/* Client statuses reuse the account badge palette. */
.badge-prospect {
  background: var(--info-bg);
  border-color: var(--info-border);
  color: var(--info-500);
}

.badge-paused {
  background: var(--warn-bg);
  border-color: var(--warn-border);
  color: var(--warn-500);
}

.badge-former {
  background: var(--neutral-bg);
  border-color: var(--neutral-border);
  color: var(--neutral-500);
}
</style>
