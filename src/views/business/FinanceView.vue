<script setup lang="ts">
/**
 * Finance.
 *
 * Four different questions, kept apart because conflating them is how a
 * company loses track of what it is owed:
 *
 *   Revenue      what the work was worth — read from the client ledger
 *   Invoiced     what we have actually asked to be paid
 *   Collected    what has arrived, from typed payments
 *   Overheads    what we spent on nothing in particular
 *
 * Only overheads, invoices and payments are entered here. Revenue is never
 * typed on this screen: it belongs to the work item that earned it, and a
 * second door into the same number is a second version of it.
 *
 * `type` on a payment exists because not every arriving amount is income. A
 * refund leaves, a transfer moves between our own accounts, and counting
 * either as revenue overstates what the company earned.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import RankChart from '@/components/ui/RankChart.vue'
import TimeChart from '@/components/ui/TimeChart.vue'
import { fetchAllWork, saveWorkItem } from '@/api/clientDossier'
import { fetchClients } from '@/api/clients'
import { fetchEmployees } from '@/api/employees'
import { deleteExpense, fetchExpenses, saveExpense, fetchServiceCatalogue } from '@/api/operations'
import { fetchAffiliates } from '@/api/affiliates'
import {
  deletePayment,
  fetchContracts,
  fetchInvoices,
  fetchPayments,
  fetchSales,
  invoiceFromWork,
  invoiceOutstanding,
  moneyOf,
  nextInvoiceNumber,
  saveInvoice,
  savePayment,
  setInvoiceStatus,
} from '@/api/revenue'
import {
  EMPTY_SNAPSHOT,
  companyFigures,
  monthlySeries,
  periodOf,
  previousPeriod,
  revenueByClient,
  revenueByService,
  slice,
  trend,
  type PeriodKey,
  type Snapshot,
} from '@/api/metrics'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import {
  EXPENSE_CATEGORIES,
  type Client,
  type ExpenseCategory,
  type ExpenseEntry,
  type Service,
  type WorkItem,
} from '@/types/business'
import {
  INCOME_TYPES,
  INVOICE_STATUSES,
  TRANSACTION_TYPES,
  type Affiliate,
  type Contract,
  type Invoice,
  type InvoiceStatus,
  type Payment,
  type Sale,
  type TransactionType,
} from '@/types/revenue'
import {
  BASE_CURRENCY,
  CURRENCIES,
  formatMoney,
  formatMoneyShort,
  fromMinor,
  type CurrencyCode,
} from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import type { EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { t, locale } = useI18n()

type Tab = 'overview' | 'receivables' | 'invoices' | 'payments' | 'expenses'

const tab = ref<Tab>('overview')
const periodKey = ref<PeriodKey>('year')
const loading = ref(true)
const saving = ref(false)

const work = ref<WorkItem[]>([])
const expenses = ref<ExpenseEntry[]>([])
const clients = ref<Client[]>([])
const services = ref<Service[]>([])
const invoices = ref<Invoice[]>([])
const payments = ref<Payment[]>([])
const contracts = ref<Contract[]>([])
const sales = ref<Sale[]>([])
const affiliates = ref<Affiliate[]>([])
const people = ref<EmployeePublic[]>([])

const pendingExpense = ref<ExpenseEntry | null>(null)
const pendingPayment = ref<Payment | null>(null)

const canManage = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_MANAGE))
const today = new Date().toISOString().slice(0, 10)

const clientNames = computed(() => new Map(clients.value.map((c) => [c.id, c.name])))

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}
function short(minor: number): string {
  return formatMoneyShort(minor, BASE_CURRENCY, locale.value)
}

/* ---- Derived figures ------------------------------------------------- */

const snapshot = computed<Snapshot>(() => ({
  ...EMPTY_SNAPSHOT,
  clients: clients.value,
  work: work.value,
  expenses: expenses.value,
  invoices: invoices.value,
  payments: payments.value,
  contracts: contracts.value,
  sales: sales.value,
  services: services.value,
  affiliates: affiliates.value,
}))

const period = computed(() => periodOf(periodKey.value))
const current = computed(() => slice(snapshot.value, period.value))
const before = computed(() => slice(snapshot.value, previousPeriod(period.value)))

const figures = computed(() => companyFigures(current.value, snapshot.value))
const priorFigures = computed(() => companyFigures(before.value, snapshot.value))

const months = computed(() => monthlySeries(snapshot.value, 12))

const moneyChart = computed(() => ({
  labels: months.value.map((m) => m.label.slice(5)),
  series: [
    { key: 'revenue', label: t('finance.revenue'), values: months.value.map((m) => m.revenue) },
    { key: 'collected', label: t('contracts.paid'), values: months.value.map((m) => m.collected) },
    { key: 'costs', label: t('finance.overheads'), values: months.value.map((m) => m.overheads + m.cost) },
  ],
}))

const byClient = computed(() => revenueByClient(current.value))
const byService = computed(() => revenueByService(current.value))

const receivables = computed(() =>
  work.value
    .filter((w) => w.paymentStatus !== 'paid')
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')),
)

const periodExpenses = computed(() => current.value.expenses)
const periodPayments = computed(() => current.value.payments)

const headline = computed(() => [
  {
    key: 'revenue',
    label: t('finance.revenue'),
    value: money(figures.value.revenueBaseMinor),
    delta: trend(figures.value.revenueBaseMinor, priorFigures.value.revenueBaseMinor),
  },
  {
    key: 'collected',
    label: t('contracts.paid'),
    value: money(figures.value.collectedBaseMinor),
    delta: trend(figures.value.collectedBaseMinor, priorFigures.value.collectedBaseMinor),
  },
  {
    key: 'overheads',
    label: t('finance.overheads'),
    value: money(figures.value.overheadsBaseMinor),
    delta: trend(figures.value.overheadsBaseMinor, priorFigures.value.overheadsBaseMinor),
  },
  {
    key: 'net',
    label: t('finance.netProfit'),
    value: money(figures.value.netProfitBaseMinor),
    delta: trend(figures.value.netProfitBaseMinor, priorFigures.value.netProfitBaseMinor),
    accent: true,
    hint: t('finance.netHint'),
  },
])

/* ---- Overheads editor ------------------------------------------------ */

interface ExpenseDraft {
  id: string
  description: string
  amount: number
  currency: CurrencyCode
  date: string
  category: ExpenseCategory
  recurring: boolean
}

const expenseDraft = ref<ExpenseDraft | null>(null)

function newExpense(): void {
  expenseDraft.value = {
    id: '',
    description: '',
    amount: 0,
    currency: BASE_CURRENCY,
    date: today,
    category: 'tools',
    recurring: false,
  }
}

function editExpense(entry: ExpenseEntry): void {
  expenseDraft.value = {
    id: entry.id,
    description: entry.description,
    amount: fromMinor(entry.amount.minor, entry.amount.currency),
    currency: entry.amount.currency,
    date: entry.date,
    category: entry.category,
    recurring: entry.recurring ?? false,
  }
}

async function commitExpense(): Promise<void> {
  const d = expenseDraft.value
  if (!d || saving.value) return
  if (!d.description.trim()) {
    ui.notify('danger', t('finance.description'))
    return
  }

  saving.value = true
  try {
    await saveExpense({
      id: d.id,
      projectId: null,
      clientId: null,
      description: d.description.trim(),
      amount: moneyOf(d.amount, d.currency, 1, d.date),
      date: d.date,
      category: d.category,
      recurring: d.recurring,
    } as ExpenseEntry)
    ui.notify('ok', t('finance.saved'))
    expenseDraft.value = null
    await load()
  } catch {
    ui.notify('danger', t('finance.saveFailed'))
  } finally {
    saving.value = false
  }
}

/* ---- Invoice composer ------------------------------------------------ */

interface InvoiceDraft {
  clientId: string
  number: string
  issueDate: string
  dueDate: string
  selected: string[]
  contractId: string | null
}

const invoiceDraft = ref<InvoiceDraft | null>(null)

function newInvoice(): void {
  invoiceDraft.value = {
    clientId: clients.value[0]?.id ?? '',
    number: nextInvoiceNumber(invoices.value),
    issueDate: today,
    dueDate: new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10),
    selected: [],
    contractId: null,
  }
}

/** Unpaid work for the chosen client that no invoice already covers. */
const billable = computed(() => {
  const d = invoiceDraft.value
  if (!d?.clientId) return []
  const billed = new Set(
    invoices.value.filter((i) => i.status !== 'cancelled').flatMap((i) => i.workItemIds ?? []),
  )
  return work.value.filter(
    (w) => w.clientId === d.clientId && w.paymentStatus !== 'paid' && !billed.has(w.id),
  )
})

const invoiceTotal = computed(() => {
  const d = invoiceDraft.value
  if (!d) return 0
  return billable.value
    .filter((w) => d.selected.includes(w.id))
    .reduce((n, w) => n + w.revenue.baseMinor, 0)
})

function toggleItem(id: string): void {
  const list = invoiceDraft.value?.selected
  if (!list) return
  const i = list.indexOf(id)
  if (i >= 0) list.splice(i, 1)
  else list.push(id)
}

async function commitInvoice(): Promise<void> {
  const d = invoiceDraft.value
  if (!d || saving.value) return
  if (!d.clientId) {
    ui.notify('danger', t('invoices.selectClient'))
    return
  }
  if (d.selected.length === 0) {
    ui.notify('danger', t('invoices.selectItems'))
    return
  }

  const items = billable.value.filter((w) => d.selected.includes(w.id))

  saving.value = true
  try {
    const invoice = invoiceFromWork(items, {
      clientId: d.clientId,
      clientName: clientNames.value.get(d.clientId) ?? '',
      number: d.number.trim(),
      issueDate: d.issueDate,
      dueDate: d.dueDate,
    })

    await saveInvoice({ ...invoice, contractId: d.contractId })

    /* The work items take the invoice's due date, so one date governs both. */
    for (const item of items) {
      await saveWorkItem(d.clientId, clientNames.value.get(d.clientId) ?? '', {
        id: item.id,
        date: item.date,
        title: item.title,
        serviceId: item.serviceId,
        serviceName: item.serviceName,
        projectId: item.projectId ?? null,
        cost: item.cost,
        revenue: item.revenue,
        dueDate: d.dueDate,
        paymentStatus: item.paymentStatus,
        paidDate: item.paidDate,
        note: item.note,
      })
    }

    ui.notify('ok', t('invoices.saved'))
    invoiceDraft.value = null
    await load()
  } catch {
    ui.notify('danger', t('invoices.saveFailed'))
  } finally {
    saving.value = false
  }
}

/* ---- Payment editor -------------------------------------------------- */

interface PaymentDraft {
  id: string
  type: TransactionType
  description: string
  amount: number
  currency: CurrencyCode
  date: string
  method: string
  clientId: string | null
  invoiceId: string | null
  saleId: string | null
  employeeUid: string | null
  affiliateId: string | null
  contractId: string | null
}

const paymentDraft = ref<PaymentDraft | null>(null)

function newPayment(invoice?: Invoice): void {
  paymentDraft.value = {
    id: '',
    type: 'revenue',
    description: invoice ? invoice.number : '',
    amount: invoice ? fromMinor(invoiceOutstanding(invoice), BASE_CURRENCY) : 0,
    currency: BASE_CURRENCY,
    date: today,
    method: '',
    clientId: invoice?.clientId ?? null,
    invoiceId: invoice?.id ?? null,
    saleId: null,
    employeeUid: null,
    affiliateId: null,
    contractId: invoice?.contractId ?? null,
  }
}

function editPayment(payment: Payment): void {
  paymentDraft.value = {
    id: payment.id,
    type: payment.type,
    description: payment.description,
    amount: fromMinor(payment.amount.minor, payment.amount.currency),
    currency: payment.amount.currency,
    date: payment.date,
    method: payment.method ?? '',
    clientId: payment.clientId,
    invoiceId: payment.invoiceId,
    saleId: payment.saleId,
    employeeUid: payment.employeeUid,
    affiliateId: payment.affiliateId,
    contractId: payment.contractId,
  }
}

/**
 * Record a payment.
 *
 * Saving credits the invoice and, when an affiliate is named, creates the
 * commission — pending, never approved, because whether somebody is paid is a
 * decision a person makes and a different permission guards it.
 */
async function commitPayment(): Promise<void> {
  const d = paymentDraft.value
  if (!d || saving.value) return
  if (!d.description.trim()) {
    ui.notify('danger', t('payments.description'))
    return
  }

  saving.value = true
  try {
    const invoice = invoices.value.find((i) => i.id === d.invoiceId) ?? null
    const affiliate = affiliates.value.find((a) => a.id === d.affiliateId) ?? null
    const sale = sales.value.find((s) => s.id === d.saleId) ?? null

    await savePayment(
      {
        id: d.id,
        invoiceId: d.invoiceId,
        clientId: d.clientId,
        clientName: clientNames.value.get(d.clientId ?? '') ?? '',
        contractId: d.contractId,
        projectId: null,
        serviceId: sale?.serviceId ?? invoice?.serviceId ?? null,
        saleId: d.saleId,
        employeeUid: d.employeeUid,
        affiliateId: d.affiliateId,
        type: d.type,
        description: d.description.trim(),
        amount: moneyOf(d.amount, d.currency, 1, d.date),
        date: d.date,
        method: d.method.trim(),
        notes: '',
      } as Payment,
      { invoice, affiliate },
    )

    ui.notify('ok', t('payments.saved'))
    paymentDraft.value = null
    await load()
  } catch {
    ui.notify('danger', t('payments.saveFailed'))
  } finally {
    saving.value = false
  }
}

/**
 * Change an invoice's status.
 *
 * Cancelling releases the work it billed: those items become billable again,
 * because the alternative is work that can never be invoiced by anybody.
 */
async function changeInvoiceStatus(invoice: Invoice, status: InvoiceStatus): Promise<void> {
  try {
    await setInvoiceStatus(invoice, status)
    ui.notify('ok', t('invoices.saved'))
    await load()
  } catch {
    ui.notify('danger', t('invoices.saveFailed'))
  }
}

/** Mark one ledger item settled, straight from the receivables list. */
async function markPaid(item: WorkItem): Promise<void> {
  const name = clientNames.value.get(item.clientId) ?? ''
  try {
    await saveWorkItem(item.clientId, name, {
      id: item.id,
      date: item.date,
      title: item.title,
      serviceId: item.serviceId,
      serviceName: item.serviceName,
      projectId: item.projectId ?? null,
      cost: item.cost,
      revenue: item.revenue,
      dueDate: item.dueDate,
      paymentStatus: 'paid',
      paidDate: today,
      note: item.note,
    })
    await load()
  } catch {
    ui.notify('danger', t('finance.saveFailed'))
  }
}

async function confirmDeleteExpense(): Promise<void> {
  if (!pendingExpense.value) return
  await deleteExpense(pendingExpense.value.id)
  pendingExpense.value = null
  await load()
}

async function confirmDeletePayment(): Promise<void> {
  if (!pendingPayment.value) return
  await deletePayment(pendingPayment.value)
  pendingPayment.value = null
  await load()
}

async function load(): Promise<void> {
  loading.value = true
  const [w, e, c, inv, pay, ct, sl, aff, sv, ppl] = await Promise.all([
    fetchAllWork(1000),
    fetchExpenses().catch(() => []),
    fetchClients().catch(() => []),
    fetchInvoices().catch(() => []),
    fetchPayments().catch(() => []),
    fetchContracts().catch(() => []),
    fetchSales().catch(() => []),
    fetchAffiliates().catch(() => []),
    fetchServiceCatalogue().catch(() => []),
    fetchEmployees().catch(() => []),
  ])
  work.value = w
  expenses.value = e
  clients.value = c
  invoices.value = inv
  payments.value = pay
  contracts.value = ct
  sales.value = sl
  affiliates.value = aff
  services.value = sv
  people.value = ppl
  loading.value = false
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('finance.title') }}</h1>
        <p class="page-subtitle">{{ t('finance.subtitle') }}</p>
      </div>
      <div v-if="canManage" class="head-actions">
        <button v-if="tab === 'expenses'" class="btn btn-primary" @click="newExpense">
          <AppIcon name="plus" :size="16" /> {{ t('finance.newExpense') }}
        </button>
        <button v-else-if="tab === 'invoices'" class="btn btn-primary" @click="newInvoice">
          <AppIcon name="plus" :size="16" /> {{ t('invoices.newInvoice') }}
        </button>
        <button v-else-if="tab === 'payments'" class="btn btn-primary" @click="newPayment()">
          <AppIcon name="plus" :size="16" /> {{ t('payments.newPayment') }}
        </button>
      </div>
    </header>

    <div class="tabs" role="tablist">
      <button
        v-for="key in (['overview', 'receivables', 'invoices', 'payments', 'expenses'] as Tab[])"
        :key="key"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'is-active': tab === key }"
        :aria-selected="tab === key"
        @click="tab = key"
      >
        {{
          key === 'overview'
            ? t('finance.tabOverview')
            : key === 'receivables'
              ? t('finance.outstanding')
              : key === 'invoices'
                ? t('invoices.title')
                : key === 'payments'
                  ? t('payments.title')
                  : t('finance.tabExpenses')
        }}
      </button>
    </div>

    <div class="toolbar">
      <div class="segmented">
        <button
          v-for="key in (['month', 'quarter', 'year', 'all'] as PeriodKey[])"
          :key="key"
          type="button"
          :class="{ 'is-on': periodKey === key }"
          @click="periodKey = key"
        >
          {{ t(`period.${key}`) }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 4" :key="n" class="skeleton" style="height: 56px" />
      </div>
    </div>

    <template v-else>
      <!-- Headline ---------------------------------------------------- -->
      <div class="figures">
        <article
          v-for="card in headline"
          :key="card.key"
          class="card figure"
          :class="{ 'is-accent': card.accent }"
        >
          <span class="figure-label">{{ card.label }}</span>
          <span class="figure-value">{{ card.value }}</span>
          <span v-if="card.delta !== null" class="delta" :class="card.delta >= 0 ? 'pos' : 'neg'">
            <AppIcon :name="card.delta >= 0 ? 'arrowUp' : 'arrowDown'" :size="12" />
            {{ Math.abs(card.delta) }}%
          </span>
          <span v-if="card.hint" class="figure-hint">{{ card.hint }}</span>
        </article>
      </div>

      <div class="figures two">
        <article class="card figure">
          <span class="figure-label">{{ t('finance.outstanding') }}</span>
          <span class="figure-value">{{ money(figures.outstandingBaseMinor) }}</span>
        </article>
        <article class="card figure">
          <span class="figure-label">{{ t('finance.overdue') }}</span>
          <span class="figure-value" :class="{ neg: figures.overdueBaseMinor > 0 }">
            {{ money(figures.overdueBaseMinor) }}
          </span>
        </article>
        <article class="card figure">
          <span class="figure-label">{{ t('dashboard.cashFlow') }}</span>
          <span class="figure-value" :class="figures.cashFlowBaseMinor >= 0 ? 'pos' : 'neg'">
            {{ money(figures.cashFlowBaseMinor) }}
          </span>
        </article>
      </div>

      <!-- Overview ------------------------------------------------------ -->
      <template v-if="tab === 'overview'">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('finance.byMonth') }}</h2>
          </div>
          <div class="card-body">
            <TimeChart
              :labels="moneyChart.labels"
              :series="moneyChart.series"
              :format="money"
              :height="210"
              :area="false"
            />
          </div>
        </section>

        <div class="pair">
          <section class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('finance.byClient') }}</h2>
            </div>
            <div class="card-body">
              <RankChart v-if="byClient.length" :rows="byClient" :format="short" />
              <p v-else class="tertiary small">{{ t('finance.empty') }}</p>
            </div>
          </section>

          <section class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('finance.byService') }}</h2>
            </div>
            <div class="card-body">
              <RankChart v-if="byService.length" :rows="byService" :format="short" />
              <p v-else class="tertiary small">{{ t('finance.emptyHint') }}</p>
            </div>
          </section>
        </div>
      </template>

      <!-- Receivables --------------------------------------------------- -->
      <template v-else-if="tab === 'receivables'">
        <div v-if="receivables.length === 0" class="card">
          <div class="empty">
            <span class="empty-icon"><AppIcon name="check" :size="20" /></span>
            <p class="empty-title">{{ t('finance.empty') }}</p>
            <p class="empty-text">{{ t('finance.emptyHint') }}</p>
          </div>
        </div>

        <section v-else class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('finance.outstanding') }}</h2>
            <span class="badge badge-plain">{{ receivables.length }}</span>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ t('dossier.itemTitle') }}</th>
                  <th>{{ t('table.client') }}</th>
                  <th>{{ t('table.dueDate') }}</th>
                  <th class="num">{{ t('table.amount') }}</th>
                  <th class="col-actions" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in receivables" :key="item.id">
                  <td>{{ item.title }}</td>
                  <td>
                    <button type="button" class="link" @click="router.push(`/clients/${item.clientId}`)">
                      {{ clientNames.get(item.clientId) ?? item.clientId }}
                    </button>
                  </td>
                  <td :class="{ late: item.dueDate && item.dueDate < today }">
                    {{ item.dueDate ? formatDate(item.dueDate) : '—' }}
                  </td>
                  <td class="num strong">{{ money(item.revenue.baseMinor) }}</td>
                  <td class="col-actions">
                    <button v-if="canManage" class="btn btn-secondary btn-sm" @click="markPaid(item)">
                      {{ t('contracts.paid') }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <!-- Invoices ------------------------------------------------------ -->
      <template v-else-if="tab === 'invoices'">
        <section v-if="invoiceDraft" class="card editor">
          <div class="card-header">
            <h2 class="card-title">{{ t('invoices.newInvoice') }}</h2>
            <button
              class="btn btn-ghost btn-icon"
              :aria-label="t('common.close')"
              @click="invoiceDraft = null"
            >
              <AppIcon name="close" :size="18" />
            </button>
          </div>

          <div class="card-body stack">
            <div class="field-grid">
              <div class="field">
                <label class="field-label" for="i-client">{{ t('table.client') }}</label>
                <select id="i-client" v-model="invoiceDraft.clientId" class="select">
                  <option value="">—</option>
                  <option v-for="c in clients" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </div>
              <div class="field">
                <label class="field-label" for="i-number">{{ t('invoices.number') }}</label>
                <input id="i-number" v-model="invoiceDraft.number" class="input" :maxlength="LIMITS.name" />
              </div>
              <div class="field">
                <label class="field-label" for="i-issue">{{ t('invoices.issueDate') }}</label>
                <input id="i-issue" v-model="invoiceDraft.issueDate" class="input" type="date" />
              </div>
              <div class="field">
                <label class="field-label" for="i-due">{{ t('invoices.dueDate') }}</label>
                <input id="i-due" v-model="invoiceDraft.dueDate" class="input" type="date" />
              </div>
              <div v-if="contracts.length" class="field">
                <label class="field-label" for="i-contract">{{ t('contracts.title') }}</label>
                <select id="i-contract" v-model="invoiceDraft.contractId" class="select">
                  <option :value="null">—</option>
                  <option
                    v-for="c in contracts.filter((x) => x.clientId === invoiceDraft!.clientId)"
                    :key="c.id"
                    :value="c.id"
                  >
                    {{ c.number }}
                  </option>
                </select>
              </div>
            </div>

            <div class="field">
              <span class="field-label">{{ t('invoices.billable') }}</span>
              <p class="field-hint">{{ t('invoices.billableHint') }}</p>

              <p v-if="billable.length === 0" class="tertiary small pad">
                {{ t('invoices.nothingBillable') }}
              </p>

              <ul v-else class="billable">
                <li v-for="item in billable" :key="item.id">
                  <label class="check">
                    <input
                      type="checkbox"
                      :checked="invoiceDraft.selected.includes(item.id)"
                      @change="toggleItem(item.id)"
                    />
                    <span class="check-text">
                      {{ item.title }}
                      <span class="tertiary">· {{ formatDate(item.date) }}</span>
                    </span>
                  </label>
                  <span class="num strong">{{ money(item.revenue.baseMinor) }}</span>
                </li>
              </ul>
            </div>
          </div>

          <div class="card-footer">
            <span class="total">{{ t('invoices.amount') }}: <strong>{{ money(invoiceTotal) }}</strong></span>
            <span class="spacer" />
            <button class="btn btn-secondary" @click="invoiceDraft = null">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary" :disabled="saving" @click="commitInvoice">
              <span v-if="saving" class="spinner" />{{ t('common.save') }}
            </button>
          </div>
        </section>

        <div v-if="invoices.length === 0" class="card">
          <div class="empty">
            <span class="empty-icon"><AppIcon name="contract" :size="20" /></span>
            <p class="empty-title">{{ t('invoices.empty') }}</p>
            <p class="empty-text">{{ t('invoices.emptyHint') }}</p>
            <button v-if="canManage" class="btn btn-primary" @click="newInvoice">
              {{ t('invoices.newInvoice') }}
            </button>
          </div>
        </div>

        <section v-else class="card">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ t('invoices.number') }}</th>
                  <th>{{ t('table.client') }}</th>
                  <th>{{ t('invoices.dueDate') }}</th>
                  <th class="num">{{ t('invoices.amount') }}</th>
                  <th class="num">{{ t('invoices.paid') }}</th>
                  <th class="num">{{ t('invoices.outstanding') }}</th>
                  <th>{{ t('table.status') }}</th>
                  <th class="col-actions" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="inv in invoices" :key="inv.id">
                  <td class="strong">{{ inv.number }}</td>
                  <td class="muted">{{ inv.clientName }}</td>
                  <td class="muted nowrap" :class="{ late: inv.dueDate < today && inv.status !== 'paid' }">
                    {{ formatDate(inv.dueDate) }}
                  </td>
                  <td class="num">{{ money(inv.amount.baseMinor) }}</td>
                  <td class="num pos">{{ money(inv.paidBaseMinor ?? 0) }}</td>
                  <td class="num" :class="{ neg: invoiceOutstanding(inv) > 0 }">
                    {{ money(invoiceOutstanding(inv)) }}
                  </td>
                  <td>
                    <select
                      v-if="canManage"
                      class="select tiny"
                      :class="`iv-${inv.status}`"
                      :value="inv.status"
                      :aria-label="t('table.status')"
                      @change="changeInvoiceStatus(inv, ($event.target as HTMLSelectElement).value as InvoiceStatus)"
                    >
                      <option v-for="st in INVOICE_STATUSES" :key="st" :value="st">
                        {{ t(`invoiceStatus.${st}`) }}
                      </option>
                    </select>
                    <span v-else class="badge" :class="`iv-${inv.status}`">
                      {{ t(`invoiceStatus.${inv.status}`) }}
                    </span>
                  </td>
                  <td class="col-actions">
                    <button
                      v-if="canManage && invoiceOutstanding(inv) > 0"
                      class="btn btn-secondary btn-sm"
                      @click="((tab = 'payments'), newPayment(inv))"
                    >
                      {{ t('invoices.recordPayment') }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <!-- Payments ------------------------------------------------------ -->
      <template v-else-if="tab === 'payments'">
        <section v-if="paymentDraft" class="card editor">
          <div class="card-header">
            <h2 class="card-title">
              {{ paymentDraft.id ? t('payments.editPayment') : t('payments.newPayment') }}
            </h2>
            <button
              class="btn btn-ghost btn-icon"
              :aria-label="t('common.close')"
              @click="paymentDraft = null"
            >
              <AppIcon name="close" :size="18" />
            </button>
          </div>

          <div class="card-body stack">
            <div class="field-grid">
              <div class="field">
                <label class="field-label" for="p-type">{{ t('payments.type') }}</label>
                <select id="p-type" v-model="paymentDraft.type" class="select">
                  <option v-for="ty in TRANSACTION_TYPES" :key="ty" :value="ty">
                    {{ t(`transactionType.${ty}`) }}
                  </option>
                </select>
                <p class="field-hint">{{ t('payments.typeHint') }}</p>
              </div>

              <div class="field">
                <label class="field-label" for="p-desc">
                  {{ t('payments.description') }}<span class="req">*</span>
                </label>
                <input id="p-desc" v-model="paymentDraft.description" class="input" :maxlength="LIMITS.position" />
              </div>

              <div class="field">
                <label class="field-label" for="p-amount">{{ t('payments.amount') }}</label>
                <input id="p-amount" v-model.number="paymentDraft.amount" class="input" type="number" step="0.01" />
              </div>

              <div class="field">
                <label class="field-label" for="p-cur">{{ t('table.type') }}</label>
                <select id="p-cur" v-model="paymentDraft.currency" class="select">
                  <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
                </select>
              </div>

              <div class="field">
                <label class="field-label" for="p-date">{{ t('payments.date') }}</label>
                <input id="p-date" v-model="paymentDraft.date" class="input" type="date" />
              </div>

              <div class="field">
                <label class="field-label" for="p-method">{{ t('payments.method') }}</label>
                <input id="p-method" v-model="paymentDraft.method" class="input" :maxlength="LIMITS.name" />
              </div>

              <div class="field">
                <label class="field-label" for="p-client">{{ t('payments.client') }}</label>
                <select id="p-client" v-model="paymentDraft.clientId" class="select">
                  <option :value="null">—</option>
                  <option v-for="c in clients" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </div>

              <div v-if="invoices.length" class="field">
                <label class="field-label" for="p-inv">{{ t('payments.invoice') }}</label>
                <select id="p-inv" v-model="paymentDraft.invoiceId" class="select">
                  <option :value="null">—</option>
                  <option v-for="i in invoices" :key="i.id" :value="i.id">
                    {{ i.number }} · {{ i.clientName }}
                  </option>
                </select>
              </div>

              <div v-if="sales.length" class="field">
                <label class="field-label" for="p-sale">{{ t('payments.sale') }}</label>
                <select id="p-sale" v-model="paymentDraft.saleId" class="select">
                  <option :value="null">—</option>
                  <option v-for="s in sales" :key="s.id" :value="s.id">{{ s.title }}</option>
                </select>
              </div>

              <div class="field">
                <label class="field-label" for="p-emp">{{ t('payments.employee') }}</label>
                <select id="p-emp" v-model="paymentDraft.employeeUid" class="select">
                  <option :value="null">—</option>
                  <option v-for="p in people" :key="p.uid" :value="p.uid">
                    {{ p.firstName }} {{ p.lastName }}
                  </option>
                </select>
              </div>

              <div v-if="affiliates.length" class="field">
                <label class="field-label" for="p-aff">{{ t('payments.affiliate') }}</label>
                <select id="p-aff" v-model="paymentDraft.affiliateId" class="select">
                  <option :value="null">—</option>
                  <option v-for="a in affiliates" :key="a.id" :value="a.id">{{ a.name }}</option>
                </select>
                <p class="field-hint">{{ t('payments.affiliateHint') }}</p>
              </div>
            </div>
          </div>

          <div class="card-footer">
            <button class="btn btn-secondary" @click="paymentDraft = null">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary" :disabled="saving" @click="commitPayment">
              <span v-if="saving" class="spinner" />{{ t('common.save') }}
            </button>
          </div>
        </section>

        <div v-if="periodPayments.length === 0" class="card">
          <div class="empty">
            <span class="empty-icon"><AppIcon name="wallet" :size="20" /></span>
            <p class="empty-title">{{ t('payments.empty') }}</p>
            <p class="empty-text">{{ t('payments.emptyHint') }}</p>
            <button v-if="canManage" class="btn btn-primary" @click="newPayment()">
              {{ t('payments.newPayment') }}
            </button>
          </div>
        </div>

        <section v-else class="card">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ t('payments.date') }}</th>
                  <th>{{ t('payments.description') }}</th>
                  <th>{{ t('payments.type') }}</th>
                  <th>{{ t('table.client') }}</th>
                  <th class="num">{{ t('table.amount') }}</th>
                  <th class="col-actions" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in periodPayments" :key="p.id">
                  <td class="muted nowrap">{{ formatDate(p.date) }}</td>
                  <td>{{ p.description }}</td>
                  <td>
                    <span class="badge badge-plain">{{ t(`transactionType.${p.type}`) }}</span>
                  </td>
                  <td class="muted">{{ p.clientName || '—' }}</td>
                  <td class="num strong" :class="INCOME_TYPES.includes(p.type) ? 'pos' : 'neg'">
                    {{ money(p.amount.baseMinor) }}
                  </td>
                  <td class="col-actions">
                    <button v-if="canManage" class="btn btn-ghost btn-sm" @click="editPayment(p)">
                      <AppIcon name="edit" :size="14" />
                    </button>
                    <button
                      v-if="canManage"
                      class="btn btn-ghost btn-sm danger"
                      :aria-label="t('common.delete')"
                      @click="pendingPayment = p"
                    >
                      <AppIcon name="trash" :size="14" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <!-- Overheads ----------------------------------------------------- -->
      <template v-else>
        <section v-if="expenseDraft" class="card editor">
          <div class="card-header">
            <h2 class="card-title">
              {{ expenseDraft.id ? t('finance.editExpense') : t('finance.newExpense') }}
            </h2>
            <button
              class="btn btn-ghost btn-icon"
              :aria-label="t('common.close')"
              @click="expenseDraft = null"
            >
              <AppIcon name="close" :size="18" />
            </button>
          </div>

          <div class="card-body stack">
            <p class="field-hint">{{ t('finance.expenseHint') }}</p>
            <div class="field-grid">
              <div class="field">
                <label class="field-label" for="e-desc">
                  {{ t('finance.description') }}<span class="req">*</span>
                </label>
                <input id="e-desc" v-model="expenseDraft.description" class="input" :maxlength="LIMITS.position" />
              </div>
              <div class="field">
                <label class="field-label" for="e-amount">{{ t('finance.amount') }}</label>
                <input id="e-amount" v-model.number="expenseDraft.amount" class="input" type="number" step="0.01" />
              </div>
              <div class="field">
                <label class="field-label" for="e-cur">{{ t('table.type') }}</label>
                <select id="e-cur" v-model="expenseDraft.currency" class="select">
                  <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
                </select>
              </div>
              <div class="field">
                <label class="field-label" for="e-date">{{ t('finance.date') }}</label>
                <input id="e-date" v-model="expenseDraft.date" class="input" type="date" />
              </div>
              <div class="field">
                <label class="field-label" for="e-cat">{{ t('finance.category') }}</label>
                <select id="e-cat" v-model="expenseDraft.category" class="select">
                  <option v-for="c in EXPENSE_CATEGORIES" :key="c" :value="c">
                    {{ t(`expenseCategory.${c}`) }}
                  </option>
                </select>
              </div>
            </div>
            <label class="check">
              <input v-model="expenseDraft.recurring" type="checkbox" />
              <span class="check-text">{{ t('finance.recurring') }}</span>
            </label>
          </div>

          <div class="card-footer">
            <button class="btn btn-secondary" @click="expenseDraft = null">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary" :disabled="saving" @click="commitExpense">
              <span v-if="saving" class="spinner" />{{ t('common.save') }}
            </button>
          </div>
        </section>

        <div v-if="periodExpenses.length === 0" class="card">
          <div class="empty">
            <span class="empty-icon"><AppIcon name="wallet" :size="20" /></span>
            <p class="empty-title">{{ t('finance.noExpenses') }}</p>
            <p class="empty-text">{{ t('finance.expenseHint') }}</p>
            <button v-if="canManage" class="btn btn-primary" @click="newExpense">
              {{ t('finance.newExpense') }}
            </button>
          </div>
        </div>

        <section v-else class="card">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ t('finance.date') }}</th>
                  <th>{{ t('finance.description') }}</th>
                  <th>{{ t('finance.category') }}</th>
                  <th class="num">{{ t('finance.amount') }}</th>
                  <th class="col-actions" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="entry in periodExpenses" :key="entry.id">
                  <td class="muted nowrap">{{ formatDate(entry.date) }}</td>
                  <td>
                    {{ entry.description }}
                    <span v-if="entry.recurring" class="badge badge-plain tiny">
                      {{ t('finance.recurring') }}
                    </span>
                  </td>
                  <td class="muted">{{ t(`expenseCategory.${entry.category}`) }}</td>
                  <td class="num strong">{{ money(entry.amount.baseMinor) }}</td>
                  <td class="col-actions">
                    <button v-if="canManage" class="btn btn-ghost btn-sm" @click="editExpense(entry)">
                      <AppIcon name="edit" :size="14" />
                    </button>
                    <button
                      v-if="canManage"
                      class="btn btn-ghost btn-sm danger"
                      :aria-label="t('common.delete')"
                      @click="pendingExpense = entry"
                    >
                      <AppIcon name="trash" :size="14" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>

    <ConfirmDialog
      :open="pendingExpense !== null"
      :title="t('finance.deleteExpense')"
      :message="pendingExpense?.description ?? ''"
      danger
      @confirm="confirmDeleteExpense"
      @cancel="pendingExpense = null"
    />

    <ConfirmDialog
      :open="pendingPayment !== null"
      :title="t('payments.deletePayment')"
      :message="t('payments.deleteText')"
      danger
      @confirm="confirmDeletePayment"
      @cancel="pendingPayment = null"
    />
  </div>
</template>

<style scoped>
.head-actions { display: flex; gap: var(--space-2); }
.tabs { display: flex; gap: var(--space-1); border-bottom: 1px solid var(--border-subtle); overflow-x: auto; }
.tab { padding: var(--space-3) var(--space-4); border-bottom: 2px solid transparent; font-size: var(--text-base); font-weight: 550; color: var(--text-secondary); white-space: nowrap; }
.tab:hover { color: var(--text-primary); }
.tab.is-active { color: var(--text-brand); border-bottom-color: var(--accent); }

.segmented { display: inline-flex; padding: 2px; gap: 2px; background: var(--bg-inset); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
.segmented button { padding: 0 var(--space-3); height: 30px; border-radius: var(--radius-sm); font-size: var(--text-sm); font-weight: 550; color: var(--text-tertiary); }
.segmented button.is-on { background: var(--bg-surface-3); color: var(--text-primary); box-shadow: var(--shadow-sm); }

.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: var(--space-3); }
.figure { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4) var(--space-5); }
.figure.is-accent { border-color: var(--accent-soft-border); background: var(--accent-soft-bg); }
.figure-label { font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.figure-value { font-size: var(--text-xl); font-weight: 700; font-variant-numeric: tabular-nums; }
.figure-hint { font-size: var(--text-xs); color: var(--text-tertiary); line-height: var(--leading-relaxed); }
.delta { display: inline-flex; align-items: center; gap: 3px; font-size: var(--text-xs); font-weight: 600; }

.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--space-4); }
.editor { border-color: var(--accent-soft-border); }
.spacer { flex: 1; }
.total { font-size: var(--text-sm); color: var(--text-secondary); }
.total strong { color: var(--text-brand); font-variant-numeric: tabular-nums; }
.pad { padding: var(--space-3) 0; }

.billable { list-style: none; margin: var(--space-2) 0 0; padding: 0; }
.billable li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-2) 0; border-bottom: 1px solid var(--border-subtle); }
.billable li:last-child { border-bottom: none; }

.num { text-align: right; font-variant-numeric: tabular-nums; }
.strong { font-weight: 650; }
.pos { color: var(--ok-500); }
.neg { color: var(--danger-500); }
.late { color: var(--danger-500); font-weight: 600; }
.nowrap { white-space: nowrap; }
.small { font-size: var(--text-xs); }
.badge.tiny { margin-left: var(--space-2); font-size: 10px; }
.danger:hover { color: var(--danger-500); }

.iv-draft { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }
.iv-sent { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); color: var(--text-brand); }
.iv-part_paid { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.iv-paid { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.iv-cancelled { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }
</style>
