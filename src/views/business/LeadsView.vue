<script setup lang="ts">
/**
 * Leads.
 *
 * A table first, a pipeline second. The questions somebody opens this page
 * with are "who is this, what do they want, how do I reach them, and has
 * anybody called them" — and a board of cards answers none of them without
 * clicking. The board is there for seeing where things are stuck.
 *
 * `lastContactedAt` is its own column and its own button, separate from any
 * other edit. Correcting a phone number is not contact, and a pipeline that
 * treats it as contact will tell you a cold lead is warm.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import CustomFields from '@/components/CustomFields.vue'
import { fetchAffiliates } from '@/api/affiliates'
import { fetchEmployees } from '@/api/employees'
import { fieldsFor, fetchFieldDefs } from '@/api/records'
import {
  blankLead,
  convertLead,
  deleteLead,
  fetchLeads,
  fetchServices,
  markContacted,
  saveLead,
  setLeadStage,
} from '@/api/operations'
import { moneyOf } from '@/api/sales'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import {
  CLIENT_SOURCES,
  LEAD_STAGES,
  OPEN_STAGES,
  PRIORITIES,
  type Lead,
  type LeadStage,
  type Service,
} from '@/types/business'
import { BASE_CURRENCY, CURRENCIES, formatMoney, fromMinor, type CurrencyCode } from '@/types/money'
import type { Affiliate } from '@/types/revenue'
import type { CustomFieldDef } from '@/types/records'
import { PERMISSIONS } from '@/types/permissions'
import type { EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { t, locale } = useI18n()

const loading = ref(true)
const saving = ref(false)

const leads = ref<Lead[]>([])
const people = ref<EmployeePublic[]>([])
const services = ref<Service[]>([])
const affiliates = ref<Affiliate[]>([])
const fieldDefs = ref<CustomFieldDef[]>([])

const view = ref<'table' | 'pipeline'>('table')
const search = ref('')
const stageFilter = ref<LeadStage | ''>('')
const assigneeFilter = ref('')
const onlyMine = ref(false)

const draft = ref<Lead | null>(null)
const draftValue = ref(0)
const draftCurrency = ref<CurrencyCode>(BASE_CURRENCY)

const pendingDelete = ref<Lead | null>(null)
const converting = ref<Lead | null>(null)
const convertValue = ref(0)
const convertCurrency = ref<CurrencyCode>(BASE_CURRENCY)

const today = new Date().toISOString().slice(0, 10)

const canCreate = computed(() => auth.hasPermission(PERMISSIONS.LEADS_CREATE))
const canEdit = computed(() => auth.hasPermission(PERMISSIONS.LEADS_EDIT))
const canDelete = computed(() => auth.hasPermission(PERMISSIONS.LEADS_DELETE))
const canAssign = computed(() => auth.hasPermission(PERMISSIONS.LEADS_ASSIGN))
const canSeeAll = computed(() => auth.hasPermission(PERMISSIONS.LEADS_VIEW_ALL))
const canConvert = computed(() => auth.hasPermission(PERMISSIONS.CLIENTS_CREATE))

const leadFields = computed(() => fieldsFor(fieldDefs.value, 'lead'))

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()

  return leads.value.filter((l) => {
    if (onlyMine.value && l.assigneeUid !== auth.uid) return false
    if (stageFilter.value && l.stage !== stageFilter.value) return false
    if (assigneeFilter.value && l.assigneeUid !== assigneeFilter.value) return false
    if (!term) return true

    return [l.name, l.company, l.description, l.email, l.phone, l.serviceInterest]
      .join(' ')
      .toLowerCase()
      .includes(term)
  })
})

const columns = computed(() =>
  OPEN_STAGES.map((stage) => ({
    stage,
    items: visible.value.filter((l) => l.stage === stage),
  })),
)

const pipelineValue = computed(() =>
  visible.value
    .filter((l) => OPEN_STAGES.includes(l.stage))
    .reduce((n, l) => n + (l.estimatedValue?.baseMinor ?? 0), 0),
)

/** Days since anybody actually spoke to them. Null when nobody ever has. */
function daysSinceContact(lead: Lead): number | null {
  if (!lead.lastContactedAt) return null
  return Math.floor((Date.parse(today) - Date.parse(lead.lastContactedAt)) / 86_400_000)
}

function contactTone(lead: Lead): string {
  if (!OPEN_STAGES.includes(lead.stage)) return ''
  const days = daysSinceContact(lead)
  if (days === null) return 'neg'
  return days > 14 ? 'warn' : ''
}

async function load(): Promise<void> {
  loading.value = true
  const [l, p, s, a, f] = await Promise.all([
    fetchLeads(),
    fetchEmployees().catch(() => []),
    fetchServices().catch(() => []),
    fetchAffiliates().catch(() => []),
    fetchFieldDefs().catch(() => []),
  ])
  leads.value = l
  people.value = p
  services.value = s
  affiliates.value = a
  fieldDefs.value = f
  loading.value = false
}

function startNew(): void {
  draft.value = blankLead(auth.uid, auth.displayName ?? '')
  draftValue.value = 0
  draftCurrency.value = BASE_CURRENCY
}

function startEdit(lead: Lead): void {
  draft.value = { ...lead }
  draftValue.value = lead.estimatedValue
    ? fromMinor(lead.estimatedValue.minor, lead.estimatedValue.currency)
    : 0
  draftCurrency.value = lead.estimatedValue?.currency ?? BASE_CURRENCY
}

function onAssigneeChange(uid: string): void {
  if (!draft.value) return
  const person = people.value.find((p) => p.uid === uid)
  draft.value.assigneeUid = uid || null
  draft.value.assigneeName = person ? `${person.firstName} ${person.lastName}` : ''
}

function onServiceChange(id: string): void {
  if (!draft.value) return
  draft.value.serviceId = id || null
  const service = services.value.find((s) => s.id === id)
  if (service) draft.value.serviceInterest = service.name
}

function onAffiliateChange(id: string): void {
  if (!draft.value) return
  draft.value.affiliateId = id || null
  const affiliate = affiliates.value.find((a) => a.id === id)
  draft.value.affiliateName = affiliate?.name ?? ''
  if (affiliate) draft.value.source = 'affiliate'
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.name.trim() && !d.company.trim()) {
    ui.notify('danger', t('leads.nameRequired'))
    return
  }

  const previous = leads.value.find((l) => l.id === d.id)?.assigneeUid ?? null

  saving.value = true
  try {
    await saveLead(
      {
        ...d,
        estimatedValue: draftValue.value
          ? moneyOf(draftValue.value, draftCurrency.value, 1, today)
          : null,
      },
      previous,
    )
    ui.notify('ok', t('leads.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('leads.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function moveTo(lead: Lead, stage: LeadStage): Promise<void> {
  await setLeadStage(lead, stage)
  await load()
}

async function contacted(lead: Lead): Promise<void> {
  await markContacted(lead)
  await load()
}

function startConvert(lead: Lead): void {
  converting.value = lead
  convertValue.value = lead.estimatedValue
    ? fromMinor(lead.estimatedValue.minor, lead.estimatedValue.currency)
    : 0
  convertCurrency.value = lead.estimatedValue?.currency ?? BASE_CURRENCY
}

/**
 * Convert to a client, optionally recording the sale at the same time.
 *
 * The lead stays. It is marked won and stamped with the ids it produced —
 * deleting it would erase where the client came from, which is the one thing
 * a pipeline exists to remember.
 */
async function convert(withSale: boolean): Promise<void> {
  const lead = converting.value
  if (!lead || saving.value) return

  saving.value = true
  try {
    const service = services.value.find((s) => s.id === lead.serviceId) ?? null
    const { clientId } = await convertLead(lead, {
      service,
      saleValue: withSale ? convertValue.value : 0,
      saleCurrency: convertCurrency.value,
    })

    ui.notify('ok', t('leads.converted'))
    converting.value = null
    await router.push(`/clients/${clientId}`)
  } catch {
    ui.notify('danger', t('leads.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value) return
  await deleteLead(pendingDelete.value)
  ui.notify('ok', t('recycle.movedToBin'))
  pendingDelete.value = null
  await load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('leads.title') }}</h1>
        <p class="page-subtitle">{{ t('leads.subtitle') }}</p>
      </div>
      <button v-if="canCreate && !draft" class="btn btn-primary" @click="startNew">
        <AppIcon name="plus" :size="16" /> {{ t('leads.newLead') }}
      </button>
    </header>

    <!-- Editor --------------------------------------------------------- -->
    <section v-if="draft" class="card editor">
      <div class="card-header">
        <h2 class="card-title">{{ draft.id ? t('leads.editLead') : t('leads.newLead') }}</h2>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="draft = null">
          <AppIcon name="close" :size="18" />
        </button>
      </div>

      <div class="card-body stack">
        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="l-company">{{ t('leads.company') }}</label>
            <input id="l-company" v-model="draft.company" class="input" :maxlength="LIMITS.name" />
          </div>
          <div class="field">
            <label class="field-label" for="l-name">{{ t('leads.name') }}</label>
            <input id="l-name" v-model="draft.name" class="input" :maxlength="LIMITS.name" />
          </div>
          <div class="field">
            <label class="field-label" for="l-desc">{{ t('leads.description') }}</label>
            <input id="l-desc" v-model="draft.description" class="input" :maxlength="LIMITS.shortText" />
            <p class="field-hint">{{ t('leads.descriptionHint') }}</p>
          </div>
          <div class="field">
            <label class="field-label" for="l-email">{{ t('clients.email') }}</label>
            <input id="l-email" v-model="draft.email" class="input" type="email" />
          </div>
          <div class="field">
            <label class="field-label" for="l-phone">{{ t('clients.phone') }}</label>
            <input id="l-phone" v-model="draft.phone" class="input" />
          </div>
          <div class="field">
            <label class="field-label" for="l-service">{{ t('leads.serviceInterest') }}</label>
            <select
              id="l-service"
              :value="draft.serviceId ?? ''"
              class="select"
              @change="onServiceChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="">—</option>
              <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="l-stage">{{ t('leads.stage') }}</label>
            <select id="l-stage" v-model="draft.stage" class="select">
              <option v-for="s in LEAD_STAGES" :key="s" :value="s">{{ t(`leadStage.${s}`) }}</option>
            </select>
          </div>
          <div v-if="canAssign" class="field">
            <label class="field-label" for="l-owner">{{ t('table.assignee') }}</label>
            <select
              id="l-owner"
              :value="draft.assigneeUid ?? ''"
              class="select"
              @change="onAssigneeChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ t('leads.unassigned') }}</option>
              <option v-for="p in people" :key="p.uid" :value="p.uid">
                {{ p.firstName }} {{ p.lastName }}
              </option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="l-value">{{ t('leads.estimatedValue') }}</label>
            <input id="l-value" v-model.number="draftValue" class="input" type="number" step="0.01" />
          </div>
          <div class="field">
            <label class="field-label" for="l-cur">{{ t('finance.currency') }}</label>
            <select id="l-cur" v-model="draftCurrency" class="select">
              <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="l-prio">{{ t('table.priority') }}</label>
            <select id="l-prio" v-model="draft.priority" class="select">
              <option v-for="p in PRIORITIES" :key="p" :value="p">{{ t(`priority.${p}`) }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="l-next">{{ t('leads.nextStep') }}</label>
            <input id="l-next" v-model="draft.nextStep" class="input" :maxlength="LIMITS.position" />
          </div>
          <div class="field">
            <label class="field-label" for="l-nextd">{{ t('leads.nextContact') }}</label>
            <input id="l-nextd" v-model="draft.nextContactDate" class="input" type="date" />
          </div>
          <div class="field">
            <label class="field-label" for="l-last">{{ t('leads.lastContacted') }}</label>
            <input id="l-last" v-model="draft.lastContactedAt" class="input" type="date" />
          </div>
        </div>

        <details class="more">
          <summary>{{ t('common.moreDetails') }}</summary>
          <div class="field-grid">
            <div class="field">
              <label class="field-label" for="l-source">{{ t('leads.source') }}</label>
              <select id="l-source" v-model="draft.source" class="select">
                <option v-for="s in CLIENT_SOURCES" :key="s" :value="s">{{ t(`source.${s}`) }}</option>
              </select>
            </div>
            <div v-if="affiliates.length" class="field">
              <label class="field-label" for="l-aff">{{ t('leads.affiliate') }}</label>
              <select
                id="l-aff"
                :value="draft.affiliateId ?? ''"
                class="select"
                @change="onAffiliateChange(($event.target as HTMLSelectElement).value)"
              >
                <option value="">—</option>
                <option v-for="a in affiliates" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="l-city">{{ t('clients.city') }}</label>
              <input id="l-city" v-model="draft.city" class="input" :maxlength="LIMITS.name" />
            </div>
            <div v-if="draft.stage === 'lost'" class="field">
              <label class="field-label" for="l-lost">{{ t('leads.lostReason') }}</label>
              <input id="l-lost" v-model="draft.lostReason" class="input" :maxlength="LIMITS.shortText" />
            </div>
          </div>

          <div class="field">
            <label class="field-label" for="l-notes">{{ t('clients.notes') }}</label>
            <textarea id="l-notes" v-model="draft.notes" class="textarea" :maxlength="LIMITS.longText" />
          </div>
        </details>

        <CustomFields v-model="draft.custom" :fields="leadFields" can-see-management />
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
          :placeholder="t('leads.searchPlaceholder')"
          :aria-label="t('common.search')"
        />
      </div>

      <select v-model="stageFilter" class="select compact" :aria-label="t('leads.stage')">
        <option value="">{{ t('leads.allStages') }}</option>
        <option v-for="s in LEAD_STAGES" :key="s" :value="s">{{ t(`leadStage.${s}`) }}</option>
      </select>

      <select
        v-if="canSeeAll"
        v-model="assigneeFilter"
        class="select compact"
        :aria-label="t('table.assignee')"
      >
        <option value="">{{ t('leads.allAssignees') }}</option>
        <option v-for="p in people" :key="p.uid" :value="p.uid">
          {{ p.firstName }} {{ p.lastName }}
        </option>
      </select>

      <div v-if="canSeeAll" class="segmented">
        <button type="button" :class="{ 'is-on': !onlyMine }" @click="onlyMine = false">
          {{ t('leads.everyone') }}
        </button>
        <button type="button" :class="{ 'is-on': onlyMine }" @click="onlyMine = true">
          {{ t('leads.mine') }}
        </button>
      </div>

      <div class="segmented">
        <button type="button" :class="{ 'is-on': view === 'table' }" @click="view = 'table'">
          {{ t('leads.tableView') }}
        </button>
        <button type="button" :class="{ 'is-on': view === 'pipeline' }" @click="view = 'pipeline'">
          {{ t('leads.pipelineView') }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 4" :key="n" class="skeleton" style="height: 44px" />
      </div>
    </div>

    <div v-else-if="visible.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="target" :size="20" /></span>
        <p class="empty-title">{{ leads.length === 0 ? t('leads.empty') : t('leads.noMatch') }}</p>
        <p class="empty-text">{{ t('leads.emptyHint') }}</p>
        <button v-if="canCreate && leads.length === 0" class="btn btn-primary" @click="startNew">
          {{ t('leads.newLead') }}
        </button>
      </div>
    </div>

    <!-- Table ---------------------------------------------------------- -->
    <section v-else-if="view === 'table'" class="card">
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('leads.name') }}</th>
              <th class="hide-sm">{{ t('clients.contact') }}</th>
              <th class="hide-md">{{ t('leads.serviceInterest') }}</th>
              <th>{{ t('leads.stage') }}</th>
              <th class="hide-md">{{ t('table.assignee') }}</th>
              <th>{{ t('leads.lastContacted') }}</th>
              <th class="num hide-sm">{{ t('table.value') }}</th>
              <th class="col-actions" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="lead in visible" :key="lead.id">
              <td>
                <button type="button" class="name-cell" @click="startEdit(lead)">
                  <span class="name">{{ lead.company || lead.name }}</span>
                  <span class="tertiary truncate">{{ lead.description || lead.name }}</span>
                </button>
              </td>

              <td class="hide-sm">
                <span class="stack-tight">
                  <a v-if="lead.phone" :href="`tel:${lead.phone}`" class="link-quiet">{{ lead.phone }}</a>
                  <a v-if="lead.email" :href="`mailto:${lead.email}`" class="link-quiet">
                    {{ lead.email }}
                  </a>
                  <span v-if="!lead.phone && !lead.email" class="tertiary">—</span>
                </span>
              </td>

              <td class="hide-md muted">{{ lead.serviceInterest || '—' }}</td>

              <td>
                <select
                  class="select tiny"
                  :value="lead.stage"
                  :aria-label="t('leads.stage')"
                  :disabled="!canEdit"
                  @change="moveTo(lead, ($event.target as HTMLSelectElement).value as LeadStage)"
                >
                  <option v-for="s in LEAD_STAGES" :key="s" :value="s">{{ t(`leadStage.${s}`) }}</option>
                </select>
              </td>

              <td class="hide-md muted">{{ lead.assigneeName || t('leads.unassigned') }}</td>

              <td :class="contactTone(lead)">
                <template v-if="lead.lastContactedAt">
                  {{ formatDate(lead.lastContactedAt) }}
                  <span class="tertiary small">· {{ daysSinceContact(lead) }}d</span>
                </template>
                <template v-else>{{ t('leads.neverContacted') }}</template>
              </td>

              <td class="num hide-sm">
                {{ lead.estimatedValue ? money(lead.estimatedValue.baseMinor) : '—' }}
              </td>

              <td class="col-actions">
                <button
                  v-if="canEdit"
                  class="btn btn-ghost btn-sm"
                  :aria-label="t('leads.markContacted')"
                  :title="t('leads.markContacted')"
                  @click="contacted(lead)"
                >
                  <AppIcon name="check" :size="15" />
                </button>
                <button
                  v-if="canEdit"
                  class="btn btn-ghost btn-sm"
                  :aria-label="t('common.edit')"
                  @click="startEdit(lead)"
                >
                  <AppIcon name="edit" :size="15" />
                </button>
                <button
                  v-if="canConvert && !lead.clientId"
                  class="btn btn-secondary btn-sm"
                  @click="startConvert(lead)"
                >
                  {{ t('leads.convert') }}
                </button>
                <button
                  v-else-if="lead.clientId"
                  class="btn btn-ghost btn-sm"
                  :aria-label="t('clients.openClient')"
                  @click="router.push(`/clients/${lead.clientId}`)"
                >
                  <AppIcon name="arrowRight" :size="15" />
                </button>
                <button
                  v-if="canDelete"
                  class="btn btn-ghost btn-sm danger"
                  :aria-label="t('common.delete')"
                  @click="pendingDelete = lead"
                >
                  <AppIcon name="trash" :size="15" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p class="card-body tertiary small">
        {{ visible.length }} / {{ leads.length }} · {{ t('leads.pipelineValue') }}
        {{ money(pipelineValue) }}
      </p>
    </section>

    <!-- Pipeline ------------------------------------------------------- -->
    <div v-else class="board">
      <section v-for="column in columns" :key="column.stage" class="column">
        <header class="column-head">
          <span class="column-title">{{ t(`leadStage.${column.stage}`) }}</span>
          <span class="badge badge-plain">{{ column.items.length }}</span>
        </header>

        <article v-for="lead in column.items" :key="lead.id" class="card lead">
          <button type="button" class="lead-head" @click="startEdit(lead)">
            <span class="lead-name">{{ lead.company || lead.name }}</span>
            <span v-if="lead.description" class="tertiary lead-line">{{ lead.description }}</span>
          </button>

          <p v-if="lead.estimatedValue" class="lead-value">
            {{ money(lead.estimatedValue.baseMinor) }}
          </p>
          <p v-if="lead.assigneeName" class="tertiary lead-line">{{ lead.assigneeName }}</p>
          <p v-if="lead.nextStep" class="lead-next">
            <AppIcon name="arrowRight" :size="12" /> {{ lead.nextStep }}
          </p>
          <p class="lead-line" :class="contactTone(lead)">
            {{
              lead.lastContactedAt
                ? `${t('leads.lastContacted')}: ${formatDate(lead.lastContactedAt)}`
                : t('leads.neverContacted')
            }}
          </p>

          <div class="lead-foot">
            <select
              class="select tiny"
              :value="lead.stage"
              :aria-label="t('leads.stage')"
              :disabled="!canEdit"
              @change="moveTo(lead, ($event.target as HTMLSelectElement).value as LeadStage)"
            >
              <option v-for="s in LEAD_STAGES" :key="s" :value="s">{{ t(`leadStage.${s}`) }}</option>
            </select>
          </div>
        </article>

        <p v-if="column.items.length === 0" class="column-empty">—</p>
      </section>
    </div>

    <!-- Convert -------------------------------------------------------- -->
    <div v-if="converting" class="modal-backdrop" @click.self="converting = null">
      <section class="card modal">
        <div class="card-header">
          <h2 class="card-title">{{ t('leads.convert') }}</h2>
          <button
            class="btn btn-ghost btn-icon"
            :aria-label="t('common.close')"
            @click="converting = null"
          >
            <AppIcon name="close" :size="18" />
          </button>
        </div>

        <div class="card-body stack">
          <p class="field-hint">{{ t('leads.convertHint') }}</p>

          <div class="field-grid">
            <div class="field">
              <label class="field-label" for="cv-value">{{ t('sales.value') }}</label>
              <input id="cv-value" v-model.number="convertValue" class="input" type="number" step="0.01" />
            </div>
            <div class="field">
              <label class="field-label" for="cv-cur">{{ t('finance.currency') }}</label>
              <select id="cv-cur" v-model="convertCurrency" class="select">
                <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
          </div>
        </div>

        <div class="card-footer">
          <button class="btn btn-secondary" :disabled="saving" @click="convert(false)">
            {{ t('leads.convertClientOnly') }}
          </button>
          <button class="btn btn-primary" :disabled="saving" @click="convert(true)">
            <span v-if="saving" class="spinner" />{{ t('leads.convertWithSale') }}
          </button>
        </div>
      </section>
    </div>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('leads.deleteLead')"
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
.select.compact { max-width: 170px; }
.select.tiny { height: 28px; font-size: var(--text-xs); min-width: 118px; }

.segmented { display: inline-flex; padding: 2px; gap: 2px; background: var(--bg-inset); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
.segmented button { padding: 0 var(--space-3); height: 30px; border-radius: var(--radius-sm); font-size: var(--text-sm); font-weight: 550; color: var(--text-tertiary); }
.segmented button.is-on { background: var(--bg-surface-3); color: var(--text-primary); box-shadow: var(--shadow-sm); }

.more { border-top: 1px solid var(--border-subtle); padding-top: var(--space-3); }
.more > summary { cursor: pointer; font-size: var(--text-sm); font-weight: 600; color: var(--text-secondary); margin-bottom: var(--space-3); }

.name-cell { display: flex; flex-direction: column; text-align: left; min-width: 0; }
.name { font-weight: 600; }
.name-cell:hover .name { color: var(--text-brand); }
.name-cell .tertiary { font-size: var(--text-xs); }
.stack-tight { display: flex; flex-direction: column; font-size: var(--text-xs); }
.link-quiet { color: var(--text-secondary); }
.link-quiet:hover { color: var(--text-brand); }

.board { display: grid; grid-template-columns: repeat(5, minmax(190px, 1fr)); gap: var(--space-3); overflow-x: auto; padding-bottom: var(--space-2); }
@media (max-width: 900px) { .board { grid-template-columns: repeat(5, 220px); } }
.column { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.column-head { display: flex; align-items: center; justify-content: space-between; padding: 0 var(--space-1) var(--space-1); }
.column-title { font-size: var(--text-xs); font-weight: 650; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.column-empty { text-align: center; color: var(--text-tertiary); font-size: var(--text-xs); padding: var(--space-4) 0; }

.lead { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); }
.lead-head { display: flex; flex-direction: column; gap: 1px; text-align: left; }
.lead-name { font-size: var(--text-base); font-weight: 600; }
.lead-head:hover .lead-name { color: var(--text-brand); }
.lead-line { font-size: var(--text-xs); }
.lead-value { font-size: var(--text-sm); font-weight: 650; color: var(--text-brand); font-variant-numeric: tabular-nums; }
.lead-next { display: flex; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--text-secondary); }
.lead-foot { margin-top: auto; }

.modal-backdrop {
  position: fixed; inset: 0; z-index: 80;
  display: grid; place-items: center; padding: var(--space-4);
  background: rgb(0 0 0 / 45%);
}
.modal { width: min(460px, 100%); box-shadow: var(--shadow-lg); }

.num { text-align: right; font-variant-numeric: tabular-nums; }
.warn { color: var(--warn-500); }
.neg { color: var(--danger-500); }
.small { font-size: var(--text-xs); }
.danger:hover { color: var(--danger-500); }

@media (max-width: 900px) { .hide-md { display: none; } }
@media (max-width: 640px) { .hide-sm { display: none; } }
</style>
