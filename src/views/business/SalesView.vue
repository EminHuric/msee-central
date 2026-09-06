<script setup lang="ts">
/**
 * Sales — the deal pipeline.
 *
 * A deal is what the company expects to win. It sits between a lead (a
 * conversation) and a contract (an agreement), and it is the only place a
 * probability lives: nothing else in the system is allowed to be a guess.
 *
 * Winning a deal does not silently create anything. It offers to raise the
 * contract, because "we agreed" is a decision a person makes, not a side
 * effect of dragging a card.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { fetchClients } from '@/api/clients'
import { fetchEmployees } from '@/api/employees'
import { fetchAffiliates } from '@/api/affiliates'
import { fetchLeads, fetchServiceCatalogue } from '@/api/operations'
import {
  conversionRate,
  deleteSale,
  fetchContracts,
  fetchSales,
  moneyOf,
  nextContractNumber,
  saveContract,
  saveSale,
  setSaleStage,
  weightedPipeline,
} from '@/api/revenue'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import type { Client, Lead, Service } from '@/types/business'
import {
  OPEN_SALE_STAGES,
  SALE_STAGES,
  STAGE_PROBABILITY,
  type Affiliate,
  type Contract,
  type Sale,
  type SaleStage,
} from '@/types/revenue'
import {
  BASE_CURRENCY,
  CURRENCIES,
  formatMoney,
  fromMinor,
  type CurrencyCode,
} from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import type { EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { t, locale } = useI18n()

const loading = ref(true)
const saving = ref(false)

const sales = ref<Sale[]>([])
const clients = ref<Client[]>([])
const leads = ref<Lead[]>([])
const services = ref<Service[]>([])
const people = ref<EmployeePublic[]>([])
const affiliates = ref<Affiliate[]>([])
const contracts = ref<Contract[]>([])

const search = ref('')
const pendingDelete = ref<Sale | null>(null)
const converting = ref<Sale | null>(null)

const canManage = computed(() => auth.hasPermission(PERMISSIONS.SALES_MANAGE))
const canContract = computed(() => auth.hasPermission(PERMISSIONS.CONTRACTS_MANAGE))
const today = new Date().toISOString().slice(0, 10)

interface Draft {
  id: string
  title: string
  leadId: string | null
  clientId: string | null
  serviceId: string | null
  ownerUid: string
  affiliateId: string | null
  amount: number
  currency: CurrencyCode
  probability: number
  stage: SaleStage
  expectedCloseDate: string
  lostReason: string
  notes: string
}

const draft = ref<Draft | null>(null)

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return sales.value
  return sales.value.filter((s) =>
    `${s.title} ${s.clientName} ${s.serviceName} ${s.ownerName}`.toLowerCase().includes(term),
  )
})

const columns = computed(() =>
  OPEN_SALE_STAGES.map((stage) => ({
    stage,
    items: visible.value.filter((s) => s.stage === stage),
    total: visible.value
      .filter((s) => s.stage === stage)
      .reduce((n, s) => n + s.value.baseMinor, 0),
  })),
)

const closed = computed(() =>
  visible.value
    .filter((s) => s.stage === 'won' || s.stage === 'lost')
    .sort((a, b) => (b.closedDate ?? '').localeCompare(a.closedDate ?? '')),
)

const openValue = computed(() =>
  visible.value
    .filter((s) => OPEN_SALE_STAGES.includes(s.stage))
    .reduce((n, s) => n + s.value.baseMinor, 0),
)
const weighted = computed(() => weightedPipeline(visible.value))
const conversion = computed(() => conversionRate(sales.value))

const contractBySale = computed(() => new Map(contracts.value.map((c) => [c.saleId ?? '', c])))

async function load(): Promise<void> {
  loading.value = true
  const [s, c, l, sv, e, a, ct] = await Promise.all([
    fetchSales(),
    fetchClients().catch(() => []),
    fetchLeads().catch(() => []),
    fetchServiceCatalogue().catch(() => []),
    fetchEmployees().catch(() => []),
    fetchAffiliates().catch(() => []),
    fetchContracts().catch(() => []),
  ])
  sales.value = s
  clients.value = c
  leads.value = l
  services.value = sv
  people.value = e
  affiliates.value = a
  contracts.value = ct
  loading.value = false
}

function startNew(): void {
  draft.value = {
    id: '',
    title: '',
    leadId: null,
    clientId: null,
    serviceId: null,
    ownerUid: auth.uid ?? '',
    affiliateId: null,
    amount: 0,
    currency: BASE_CURRENCY,
    probability: STAGE_PROBABILITY.qualifying,
    stage: 'qualifying',
    expectedCloseDate: '',
    lostReason: '',
    notes: '',
  }
}

function startEdit(sale: Sale): void {
  draft.value = {
    id: sale.id,
    title: sale.title,
    leadId: sale.leadId,
    clientId: sale.clientId,
    serviceId: sale.serviceId,
    ownerUid: sale.ownerUid ?? '',
    affiliateId: sale.affiliateId,
    amount: fromMinor(sale.value.minor, sale.value.currency),
    currency: sale.value.currency,
    probability: sale.probability ?? 0,
    stage: sale.stage,
    expectedCloseDate: sale.expectedCloseDate ?? '',
    lostReason: sale.lostReason ?? '',
    notes: sale.notes ?? '',
  }
}

/** Changing the stage suggests its usual probability without forcing it. */
function onStageChange(stage: SaleStage): void {
  if (!draft.value) return
  draft.value.stage = stage
  draft.value.probability = STAGE_PROBABILITY[stage]
}

/** Picking a lead fills what the lead already knows. */
function onLeadChange(id: string): void {
  const d = draft.value
  if (!d) return
  d.leadId = id || null
  const lead = leads.value.find((l) => l.id === id)
  if (!lead) return

  if (!d.title) d.title = `${lead.company || lead.name}${lead.serviceInterest ? ` — ${lead.serviceInterest}` : ''}`
  if (lead.clientId) d.clientId = lead.clientId
  if (!d.amount && lead.estimatedValue) {
    d.amount = fromMinor(lead.estimatedValue.minor, lead.estimatedValue.currency)
    d.currency = lead.estimatedValue.currency
  }
}

function nameOf(list: { id: string; name: string }[], id: string | null): string {
  return list.find((x) => x.id === id)?.name ?? ''
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.title.trim()) {
    ui.notify('danger', t('sales.titleRequired'))
    return
  }

  const owner = people.value.find((p) => p.uid === d.ownerUid)

  saving.value = true
  try {
    await saveSale({
      id: d.id,
      title: d.title.trim(),
      leadId: d.leadId,
      clientId: d.clientId,
      clientName: nameOf(clients.value, d.clientId),
      serviceId: d.serviceId,
      serviceName: nameOf(services.value, d.serviceId),
      ownerUid: d.ownerUid || null,
      ownerName: owner ? `${owner.firstName} ${owner.lastName}` : '',
      affiliateId: d.affiliateId,
      value: moneyOf(d.amount, d.currency, 1, today),
      probability: Math.max(0, Math.min(100, d.probability)),
      stage: d.stage,
      expectedCloseDate: d.expectedCloseDate || null,
      closedDate: d.stage === 'won' || d.stage === 'lost' ? today : null,
      lostReason: d.lostReason.trim(),
      notes: d.notes.trim(),
      contractId: null,
    } as Sale)

    ui.notify('ok', t('sales.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('sales.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function moveTo(sale: Sale, stage: SaleStage): Promise<void> {
  await setSaleStage(sale, stage)
  await load()
}

/**
 * Turn a won deal into a contract.
 *
 * The contract carries the deal's id, so the two stay linked and the deal can
 * show "open contract" instead of offering to create a second one.
 */
async function makeContract(): Promise<void> {
  const sale = converting.value
  if (!sale || saving.value) return

  saving.value = true
  try {
    const id = await saveContract({
      id: '',
      number: nextContractNumber(contracts.value),
      clientId: sale.clientId ?? '',
      clientName: sale.clientName,
      serviceId: sale.serviceId,
      serviceName: sale.serviceName,
      projectId: null,
      saleId: sale.id,
      value: sale.value,
      billingFrequency: 'one_off',
      paymentTermDays: 15,
      startDate: today,
      endDate: null,
      status: 'draft',
      renewalDate: null,
      responsibleUid: sale.ownerUid,
      responsibleName: sale.ownerName,
      notes: sale.notes,
      documentUrl: '',
    } as Contract)

    await saveSale({ ...sale, contractId: id })
    ui.notify('ok', t('sales.contractMade'))
    converting.value = null
    await router.push('/contracts')
  } catch {
    ui.notify('danger', t('contracts.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value) return
  await deleteSale(pendingDelete.value.id)
  pendingDelete.value = null
  await load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('sales.title') }}</h1>
        <p class="page-subtitle">{{ t('sales.subtitle') }}</p>
      </div>
      <button v-if="canManage && !draft" class="btn btn-primary" @click="startNew">
        <AppIcon name="plus" :size="16" /> {{ t('sales.newSale') }}
      </button>
    </header>

    <!-- Headline figures ---------------------------------------------- -->
    <div class="figures">
      <article class="card figure">
        <span class="figure-label">{{ t('sales.pipeline') }}</span>
        <span class="figure-value">{{ money(openValue) }}</span>
      </article>
      <article class="card figure">
        <span class="figure-label">{{ t('sales.weighted') }}</span>
        <span class="figure-value">{{ money(weighted) }}</span>
        <span class="figure-hint">{{ t('sales.weightedHint') }}</span>
      </article>
      <article class="card figure">
        <span class="figure-label">{{ t('sales.conversion') }}</span>
        <span class="figure-value">{{ conversion }}%</span>
        <span class="figure-hint">{{ t('sales.conversionHint') }}</span>
      </article>
    </div>

    <!-- Editor --------------------------------------------------------- -->
    <section v-if="draft" class="card editor">
      <div class="card-header">
        <h2 class="card-title">{{ draft.id ? t('sales.editSale') : t('sales.newSale') }}</h2>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="draft = null">
          <AppIcon name="close" :size="18" />
        </button>
      </div>

      <div class="card-body stack">
        <div class="field">
          <label class="field-label" for="d-title">
            {{ t('sales.dealTitle') }}<span class="req">*</span>
          </label>
          <input id="d-title" v-model="draft.title" class="input" :maxlength="LIMITS.position" />
        </div>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="d-lead">{{ t('sales.lead') }}</label>
            <select
              id="d-lead"
              :value="draft.leadId ?? ''"
              class="select"
              @change="onLeadChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="">—</option>
              <option v-for="l in leads" :key="l.id" :value="l.id">
                {{ l.company || l.name }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="d-client">{{ t('sales.client') }}</label>
            <select id="d-client" v-model="draft.clientId" class="select">
              <option :value="null">—</option>
              <option v-for="c in clients" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="d-service">{{ t('sales.service') }}</label>
            <select id="d-service" v-model="draft.serviceId" class="select">
              <option :value="null">—</option>
              <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="d-owner">{{ t('sales.owner') }}</label>
            <select id="d-owner" v-model="draft.ownerUid" class="select">
              <option value="">—</option>
              <option v-for="p in people" :key="p.uid" :value="p.uid">
                {{ p.firstName }} {{ p.lastName }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="d-value">{{ t('sales.value') }}</label>
            <input id="d-value" v-model.number="draft.amount" class="input" type="number" step="0.01" />
          </div>

          <div class="field">
            <label class="field-label" for="d-cur">{{ t('table.type') }}</label>
            <select id="d-cur" v-model="draft.currency" class="select">
              <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="d-stage">{{ t('sales.stage') }}</label>
            <select
              id="d-stage"
              :value="draft.stage"
              class="select"
              @change="onStageChange(($event.target as HTMLSelectElement).value as SaleStage)"
            >
              <option v-for="s in SALE_STAGES" :key="s" :value="s">{{ t(`saleStage.${s}`) }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="d-prob">{{ t('sales.probability') }}</label>
            <input id="d-prob" v-model.number="draft.probability" class="input" type="number" min="0" max="100" />
            <p class="field-hint">{{ t('sales.probabilityHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="d-close">{{ t('sales.expectedClose') }}</label>
            <input id="d-close" v-model="draft.expectedCloseDate" class="input" type="date" />
          </div>

          <div v-if="affiliates.length" class="field">
            <label class="field-label" for="d-aff">{{ t('sales.affiliate') }}</label>
            <select id="d-aff" v-model="draft.affiliateId" class="select">
              <option :value="null">—</option>
              <option v-for="a in affiliates" :key="a.id" :value="a.id">{{ a.name }}</option>
            </select>
          </div>

          <div v-if="draft.stage === 'lost'" class="field">
            <label class="field-label" for="d-lost">{{ t('sales.lostReason') }}</label>
            <input id="d-lost" v-model="draft.lostReason" class="input" :maxlength="LIMITS.shortText" />
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="d-notes">{{ t('sales.notes') }}</label>
          <textarea id="d-notes" v-model="draft.notes" class="textarea" :maxlength="LIMITS.longText" />
        </div>
      </div>

      <div class="card-footer">
        <button class="btn btn-secondary" @click="draft = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="commit">
          <span v-if="saving" class="spinner" />{{ t('common.save') }}
        </button>
      </div>
    </section>

    <div class="toolbar">
      <div class="search toolbar-grow">
        <AppIcon name="search" :size="16" class="search-icon" />
        <input
          v-model="search"
          class="input search-input"
          type="search"
          :placeholder="t('common.searchPlaceholder')"
          :aria-label="t('common.search')"
        />
      </div>
    </div>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 60px" />
      </div>
    </div>

    <div v-else-if="visible.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="trending" :size="20" /></span>
        <p class="empty-title">{{ sales.length === 0 ? t('sales.empty') : t('sales.noMatch') }}</p>
        <p class="empty-text">{{ t('sales.emptyHint') }}</p>
        <button v-if="canManage && sales.length === 0" class="btn btn-primary" @click="startNew">
          {{ t('sales.newSale') }}
        </button>
      </div>
    </div>

    <!-- Pipeline ------------------------------------------------------- -->
    <div v-else class="board">
      <section v-for="column in columns" :key="column.stage" class="column">
        <header class="column-head">
          <span class="column-title">{{ t(`saleStage.${column.stage}`) }}</span>
          <span class="column-total">{{ money(column.total) }}</span>
        </header>

        <article v-for="sale in column.items" :key="sale.id" class="card deal">
          <button type="button" class="deal-head" @click="startEdit(sale)">
            <span class="deal-title">{{ sale.title }}</span>
            <span v-if="sale.clientName" class="tertiary deal-client">{{ sale.clientName }}</span>
          </button>

          <p class="deal-value">
            {{ money(sale.value.baseMinor) }}
            <span class="tertiary deal-prob">· {{ sale.probability }}%</span>
          </p>

          <p v-if="sale.expectedCloseDate" class="deal-meta">
            <AppIcon name="calendar" :size="12" />
            {{ formatDate(sale.expectedCloseDate) }}
          </p>
          <p v-if="sale.ownerName" class="deal-meta tertiary">{{ sale.ownerName }}</p>

          <div class="deal-foot">
            <select
              class="select tiny"
              :value="sale.stage"
              :aria-label="t('sales.stage')"
              :disabled="!canManage"
              @change="moveTo(sale, ($event.target as HTMLSelectElement).value as SaleStage)"
            >
              <option v-for="s in SALE_STAGES" :key="s" :value="s">{{ t(`saleStage.${s}`) }}</option>
            </select>
            <button
              v-if="canManage"
              class="btn btn-ghost btn-sm"
              :aria-label="t('common.delete')"
              @click="pendingDelete = sale"
            >
              <AppIcon name="trash" :size="13" />
            </button>
          </div>
        </article>

        <p v-if="column.items.length === 0" class="column-empty">—</p>
      </section>
    </div>

    <!-- Closed --------------------------------------------------------- -->
    <section v-if="!loading && closed.length" class="card">
      <div class="card-header">
        <h2 class="card-title">{{ t('sales.won') }} / {{ t('sales.lost') }}</h2>
        <span class="badge badge-plain">{{ closed.length }}</span>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('sales.dealTitle') }}</th>
              <th>{{ t('table.client') }}</th>
              <th>{{ t('table.status') }}</th>
              <th class="num">{{ t('table.value') }}</th>
              <th>{{ t('sales.closedDate') }}</th>
              <th class="col-actions" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="sale in closed" :key="sale.id">
              <td>
                <button type="button" class="link" @click="startEdit(sale)">{{ sale.title }}</button>
              </td>
              <td class="muted">{{ sale.clientName || '—' }}</td>
              <td>
                <span class="badge" :class="sale.stage === 'won' ? 'st-won' : 'st-lost'">
                  {{ t(`saleStage.${sale.stage}`) }}
                </span>
              </td>
              <td class="num strong">{{ money(sale.value.baseMinor) }}</td>
              <td class="muted nowrap">{{ sale.closedDate ? formatDate(sale.closedDate) : '—' }}</td>
              <td class="col-actions">
                <button
                  v-if="sale.stage === 'won' && !contractBySale.get(sale.id) && canContract"
                  class="btn btn-secondary btn-sm"
                  @click="converting = sale"
                >
                  {{ t('sales.makeContract') }}
                </button>
                <button
                  v-else-if="contractBySale.get(sale.id)"
                  class="btn btn-ghost btn-sm"
                  @click="router.push('/contracts')"
                >
                  {{ t('sales.hasContract') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('sales.deleteSale')"
      :message="t('sales.deleteText')"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />

    <ConfirmDialog
      :open="converting !== null"
      :title="t('sales.makeContract')"
      :message="t('contracts.emptyHint')"
      @confirm="makeContract"
      @cancel="converting = null"
    />
  </div>
</template>

<style scoped>
.editor { border-color: var(--accent-soft-border); }
.search { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: var(--space-3); color: var(--text-tertiary); pointer-events: none; }
.search-input { padding-left: calc(var(--space-3) * 2 + 16px); }

.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-3); }
.figure { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4) var(--space-5); }
.figure-label { font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.figure-value { font-size: var(--text-xl); font-weight: 700; font-variant-numeric: tabular-nums; }
.figure-hint { font-size: var(--text-xs); color: var(--text-tertiary); }

.board { display: grid; grid-template-columns: repeat(3, minmax(240px, 1fr)); gap: var(--space-3); overflow-x: auto; }
@media (max-width: 820px) { .board { grid-template-columns: repeat(3, 250px); } }

.column { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.column-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); padding: 0 var(--space-1) var(--space-1); }
.column-title { font-size: var(--text-xs); font-weight: 650; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.column-total { font-size: var(--text-xs); font-weight: 650; font-variant-numeric: tabular-nums; color: var(--text-secondary); }
.column-empty { text-align: center; color: var(--text-tertiary); font-size: var(--text-xs); padding: var(--space-4) 0; }

.deal { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); }
.deal-head { display: flex; flex-direction: column; gap: 1px; text-align: left; }
.deal-title { font-size: var(--text-base); font-weight: 600; }
.deal-head:hover .deal-title { color: var(--text-brand); }
.deal-client { font-size: var(--text-xs); }
.deal-value { font-size: var(--text-sm); font-weight: 650; color: var(--text-brand); font-variant-numeric: tabular-nums; }
.deal-prob { font-weight: 500; }
.deal-meta { display: flex; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--text-secondary); }
.deal-foot { display: flex; align-items: center; gap: var(--space-2); margin-top: auto; }
.select.tiny { height: 28px; font-size: var(--text-xs); flex: 1; min-width: 0; }

.st-won { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.st-lost { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.strong { font-weight: 650; }
.nowrap { white-space: nowrap; }
</style>
