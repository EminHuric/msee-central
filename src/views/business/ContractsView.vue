<script setup lang="ts">
/**
 * Contracts — what was agreed.
 *
 * The whole reason this is not part of Finance: a contract says what was
 * promised, an invoice says what was asked for, and a payment says what
 * arrived. The three are shown side by side on every row here, because the
 * gap between them is the number that actually matters and no single figure
 * can express it.
 *
 * Contracts are never deleted. One that fell through is cancelled and stays,
 * because "we had this and lost it" is information.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import { fetchAllWork } from '@/api/clientDossier'
import { fetchClients } from '@/api/clients'
import { fetchEmployees } from '@/api/employees'
import { fetchProjects, fetchServiceCatalogue } from '@/api/operations'
import {
  contractTotal,
  expiringSoon,
  fetchContracts,
  fetchInvoices,
  fetchPayments,
  moneyOf,
  nextContractNumber,
  saveContract,
  setContractStatus,
} from '@/api/revenue'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import type { Client, Project, Service, WorkItem } from '@/types/business'
import {
  BILLING_FREQUENCIES,
  CONTRACT_STATUSES,
  INCOME_TYPES,
  type BillingFrequency,
  type Contract,
  type ContractStatus,
  type Invoice,
  type Payment,
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

const contracts = ref<Contract[]>([])
const clients = ref<Client[]>([])
const services = ref<Service[]>([])
const projects = ref<Project[]>([])
const people = ref<EmployeePublic[]>([])
const invoices = ref<Invoice[]>([])
const payments = ref<Payment[]>([])
const work = ref<WorkItem[]>([])

const search = ref('')
const statusFilter = ref<ContractStatus | ''>('')

const canManage = computed(() => auth.hasPermission(PERMISSIONS.CONTRACTS_MANAGE))
const today = new Date().toISOString().slice(0, 10)

interface Draft {
  id: string
  number: string
  clientId: string
  serviceId: string | null
  projectId: string | null
  amount: number
  currency: CurrencyCode
  billingFrequency: BillingFrequency
  paymentTermDays: number
  startDate: string
  endDate: string
  status: ContractStatus
  renewalDate: string
  responsibleUid: string
  documentUrl: string
  notes: string
}

const draft = ref<Draft | null>(null)

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()

  return contracts.value.filter((c) => {
    if (statusFilter.value && c.status !== statusFilter.value) return false
    if (!term) return true
    return `${c.number} ${c.clientName} ${c.serviceName}`.toLowerCase().includes(term)
  })
})

const expiring = computed(() => expiringSoon(contracts.value))

/**
 * Agreed, invoiced and paid for one contract.
 *
 * Invoiced counts the work billed against the contract's client and project;
 * paid counts the money that arrived against it. Both are read from their own
 * records rather than stored on the contract, so neither can drift.
 */
function figuresFor(contract: Contract): {
  agreed: number | null
  invoiced: number
  paid: number
} {
  const invoiced = [
    ...invoices.value.filter((i) => i.contractId === contract.id).map((i) => i.amount.baseMinor),
    ...work.value
      .filter((w) => w.clientId === contract.clientId && w.projectId && w.projectId === contract.projectId)
      .map((w) => w.revenue.baseMinor),
  ].reduce((a, b) => a + b, 0)

  const paid = payments.value
    .filter((p) => p.contractId === contract.id && INCOME_TYPES.includes(p.type))
    .reduce((n, p) => n + p.amount.baseMinor, 0)

  return { agreed: contractTotal(contract), invoiced, paid }
}

async function load(): Promise<void> {
  loading.value = true
  const [c, cl, sv, pr, e, inv, pay, w] = await Promise.all([
    fetchContracts(),
    fetchClients().catch(() => []),
    fetchServiceCatalogue().catch(() => []),
    fetchProjects().catch(() => []),
    fetchEmployees().catch(() => []),
    fetchInvoices().catch(() => []),
    fetchPayments().catch(() => []),
    fetchAllWork().catch(() => []),
  ])
  contracts.value = c
  clients.value = cl
  services.value = sv
  projects.value = pr
  people.value = e
  invoices.value = inv
  payments.value = pay
  work.value = w
  loading.value = false
}

function startNew(): void {
  draft.value = {
    id: '',
    number: nextContractNumber(contracts.value),
    clientId: clients.value[0]?.id ?? '',
    serviceId: null,
    projectId: null,
    amount: 0,
    currency: BASE_CURRENCY,
    billingFrequency: 'monthly',
    paymentTermDays: 15,
    startDate: today,
    endDate: '',
    status: 'draft',
    renewalDate: '',
    responsibleUid: auth.uid ?? '',
    documentUrl: '',
    notes: '',
  }
}

function startEdit(contract: Contract): void {
  draft.value = {
    id: contract.id,
    number: contract.number,
    clientId: contract.clientId,
    serviceId: contract.serviceId,
    projectId: contract.projectId,
    amount: fromMinor(contract.value.minor, contract.value.currency),
    currency: contract.value.currency,
    billingFrequency: contract.billingFrequency ?? 'monthly',
    paymentTermDays: contract.paymentTermDays ?? 15,
    startDate: contract.startDate,
    endDate: contract.endDate ?? '',
    status: contract.status,
    renewalDate: contract.renewalDate ?? '',
    responsibleUid: contract.responsibleUid ?? '',
    documentUrl: contract.documentUrl ?? '',
    notes: contract.notes ?? '',
  }
}

const availableProjects = computed(() =>
  projects.value.filter((p) => !draft.value?.clientId || p.clientId === draft.value.clientId),
)

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.clientId) {
    ui.notify('danger', t('contracts.clientRequired'))
    return
  }

  const person = people.value.find((p) => p.uid === d.responsibleUid)

  saving.value = true
  try {
    await saveContract({
      id: d.id,
      number: d.number.trim(),
      clientId: d.clientId,
      clientName: clients.value.find((c) => c.id === d.clientId)?.name ?? '',
      serviceId: d.serviceId,
      serviceName: services.value.find((s) => s.id === d.serviceId)?.name ?? '',
      projectId: d.projectId,
      saleId: null,
      value: moneyOf(d.amount, d.currency, 1, d.startDate),
      billingFrequency: d.billingFrequency,
      paymentTermDays: d.paymentTermDays,
      startDate: d.startDate,
      endDate: d.endDate || null,
      status: d.status,
      renewalDate: d.renewalDate || null,
      responsibleUid: d.responsibleUid || null,
      responsibleName: person ? `${person.firstName} ${person.lastName}` : '',
      notes: d.notes.trim(),
      documentUrl: d.documentUrl.trim(),
    } as Contract)

    ui.notify('ok', t('contracts.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('contracts.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function changeStatus(contract: Contract, status: ContractStatus): Promise<void> {
  await setContractStatus(contract, status)
  await load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('contracts.title') }}</h1>
        <p class="page-subtitle">{{ t('contracts.subtitle') }}</p>
      </div>
      <button v-if="canManage && !draft" class="btn btn-primary" @click="startNew">
        <AppIcon name="plus" :size="16" /> {{ t('contracts.newContract') }}
      </button>
    </header>

    <!-- Expiring ------------------------------------------------------- -->
    <section v-if="!loading && expiring.length" class="card warn-card">
      <div class="card-header">
        <h2 class="card-title">
          <AppIcon name="alert" :size="16" /> {{ t('contracts.expiring') }}
        </h2>
        <span class="badge badge-plain">{{ expiring.length }}</span>
      </div>
      <ul class="expiring">
        <li v-for="c in expiring" :key="c.id">
          <button type="button" class="link" @click="startEdit(c)">
            {{ c.number }} · {{ c.clientName }}
          </button>
          <span class="tertiary">{{ formatDate(c.renewalDate ?? c.endDate ?? '') }}</span>
        </li>
      </ul>
      <p class="card-body tertiary small">{{ t('contracts.expiringHint') }}</p>
    </section>

    <!-- Editor --------------------------------------------------------- -->
    <section v-if="draft" class="card editor">
      <div class="card-header">
        <h2 class="card-title">
          {{ draft.id ? t('contracts.editContract') : t('contracts.newContract') }}
        </h2>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="draft = null">
          <AppIcon name="close" :size="18" />
        </button>
      </div>

      <div class="card-body stack">
        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="c-number">{{ t('contracts.number') }}</label>
            <input id="c-number" v-model="draft.number" class="input" :maxlength="LIMITS.name" />
          </div>

          <div class="field">
            <label class="field-label" for="c-client">
              {{ t('contracts.client') }}<span class="req">*</span>
            </label>
            <select id="c-client" v-model="draft.clientId" class="select">
              <option value="">—</option>
              <option v-for="c in clients" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="c-service">{{ t('contracts.service') }}</label>
            <select id="c-service" v-model="draft.serviceId" class="select">
              <option :value="null">—</option>
              <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="c-project">{{ t('contracts.project') }}</label>
            <select id="c-project" v-model="draft.projectId" class="select">
              <option :value="null">—</option>
              <option v-for="p in availableProjects" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="c-value">{{ t('contracts.value') }}</label>
            <input id="c-value" v-model.number="draft.amount" class="input" type="number" step="0.01" />
            <p class="field-hint">{{ t('contracts.valueHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="c-cur">{{ t('table.type') }}</label>
            <select id="c-cur" v-model="draft.currency" class="select">
              <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="c-freq">{{ t('contracts.frequency') }}</label>
            <select id="c-freq" v-model="draft.billingFrequency" class="select">
              <option v-for="f in BILLING_FREQUENCIES" :key="f" :value="f">
                {{ t(`billingFrequency.${f}`) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="c-term">{{ t('contracts.paymentTerm') }}</label>
            <input id="c-term" v-model.number="draft.paymentTermDays" class="input" type="number" min="0" />
            <p class="field-hint">{{ t('contracts.paymentTermHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="c-start">{{ t('contracts.startDate') }}</label>
            <input id="c-start" v-model="draft.startDate" class="input" type="date" />
          </div>

          <div class="field">
            <label class="field-label" for="c-end">{{ t('contracts.endDate') }}</label>
            <input id="c-end" v-model="draft.endDate" class="input" type="date" />
          </div>

          <div class="field">
            <label class="field-label" for="c-renew">{{ t('contracts.renewalDate') }}</label>
            <input id="c-renew" v-model="draft.renewalDate" class="input" type="date" />
          </div>

          <div class="field">
            <label class="field-label" for="c-status">{{ t('table.status') }}</label>
            <select id="c-status" v-model="draft.status" class="select">
              <option v-for="s in CONTRACT_STATUSES" :key="s" :value="s">
                {{ t(`contractStatus.${s}`) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="c-resp">{{ t('contracts.responsible') }}</label>
            <select id="c-resp" v-model="draft.responsibleUid" class="select">
              <option value="">—</option>
              <option v-for="p in people" :key="p.uid" :value="p.uid">
                {{ p.firstName }} {{ p.lastName }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="c-doc">{{ t('contracts.document') }}</label>
            <input id="c-doc" v-model="draft.documentUrl" class="input" type="url" />
            <p class="field-hint">{{ t('contracts.documentHint') }}</p>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="c-notes">{{ t('contracts.notes') }}</label>
          <textarea id="c-notes" v-model="draft.notes" class="textarea" :maxlength="LIMITS.longText" />
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
      <select v-model="statusFilter" class="select compact" :aria-label="t('table.status')">
        <option value="">{{ t('clients.allStatuses') }}</option>
        <option v-for="s in CONTRACT_STATUSES" :key="s" :value="s">
          {{ t(`contractStatus.${s}`) }}
        </option>
      </select>
    </div>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 52px" />
      </div>
    </div>

    <div v-else-if="visible.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="contract" :size="20" /></span>
        <p class="empty-title">
          {{ contracts.length === 0 ? t('contracts.empty') : t('contracts.noMatch') }}
        </p>
        <p class="empty-text">{{ t('contracts.emptyHint') }}</p>
        <button v-if="canManage && contracts.length === 0" class="btn btn-primary" @click="startNew">
          {{ t('contracts.newContract') }}
        </button>
      </div>
    </div>

    <section v-else class="card">
      <div class="card-header">
        <h2 class="card-title">{{ t('contracts.versus') }}</h2>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('contracts.number') }}</th>
              <th>{{ t('table.client') }}</th>
              <th>{{ t('contracts.frequency') }}</th>
              <th class="num">{{ t('contracts.agreed') }}</th>
              <th class="num">{{ t('contracts.invoiced') }}</th>
              <th class="num">{{ t('contracts.paid') }}</th>
              <th>{{ t('contracts.endDate') }}</th>
              <th>{{ t('table.status') }}</th>
              <th class="col-actions" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in visible" :key="c.id">
              <td>
                <button type="button" class="link" @click="startEdit(c)">{{ c.number || '—' }}</button>
                <div v-if="c.serviceName" class="tertiary small">{{ c.serviceName }}</div>
              </td>
              <td>
                <button type="button" class="link-quiet" @click="router.push(`/clients/${c.clientId}`)">
                  {{ c.clientName }}
                </button>
              </td>
              <td class="muted">{{ t(`billingFrequency.${c.billingFrequency}`) }}</td>
              <td class="num strong">
                {{ figuresFor(c).agreed === null ? t('contracts.openEnded') : money(figuresFor(c).agreed!) }}
              </td>
              <td class="num">{{ money(figuresFor(c).invoiced) }}</td>
              <td class="num pos">{{ money(figuresFor(c).paid) }}</td>
              <td
                class="muted nowrap"
                :class="{ late: (c.renewalDate ?? c.endDate ?? '9999') < today && c.status === 'active' }"
              >
                {{ c.endDate ? formatDate(c.endDate) : '—' }}
              </td>
              <td>
                <select
                  class="select tiny"
                  :value="c.status"
                  :aria-label="t('table.status')"
                  :disabled="!canManage"
                  @change="changeStatus(c, ($event.target as HTMLSelectElement).value as ContractStatus)"
                >
                  <option v-for="s in CONTRACT_STATUSES" :key="s" :value="s">
                    {{ t(`contractStatus.${s}`) }}
                  </option>
                </select>
              </td>
              <td class="col-actions">
                <a
                  v-if="c.documentUrl"
                  class="btn btn-ghost btn-sm"
                  :href="c.documentUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <AppIcon name="contract" :size="14" />
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.editor { border-color: var(--accent-soft-border); }
.warn-card { border-color: var(--warn-border); background: var(--warn-bg); }
.warn-card .card-title { display: flex; align-items: center; gap: var(--space-2); color: var(--warn-500); }
.expiring { list-style: none; margin: 0; padding: 0; }
.expiring li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) var(--space-5); font-size: var(--text-sm); }

.search { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: var(--space-3); color: var(--text-tertiary); pointer-events: none; }
.search-input { padding-left: calc(var(--space-3) * 2 + 16px); }
.select.compact { max-width: 200px; }
.select.tiny { height: 28px; font-size: var(--text-xs); min-width: 130px; }

.link-quiet { color: var(--text-secondary); }
.link-quiet:hover { color: var(--text-brand); text-decoration: underline; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.strong { font-weight: 650; }
.pos { color: var(--ok-500); }
.late { color: var(--danger-500); font-weight: 600; }
.nowrap { white-space: nowrap; }
.small { font-size: var(--text-xs); }
</style>
