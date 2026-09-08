<script setup lang="ts">
/**
 * Finance.
 *
 * One ledger with a type on every row. Income, other income, expense, refund
 * and transfer are the same kind of fact pointing in different directions, and
 * keeping them in separate tables meant assembling every total twice and
 * getting a slightly different answer each time.
 *
 * The rule the page exists to enforce: **an arriving amount is not
 * automatically revenue.** A refund leaves, a transfer moves between our own
 * accounts, and only `income` and `other_income` count towards what the
 * company earned. Choosing the type is required, not inferred.
 *
 * Nothing here is marked paid on your behalf either. A pending row is money
 * expected; folding it into income is how a business talks itself into
 * spending what it has not been given.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import RankChart from '@/components/ui/RankChart.vue'
import TimeChart from '@/components/ui/TimeChart.vue'
import PeriodPicker from '@/components/PeriodPicker.vue'
import { fetchAffiliates } from '@/api/affiliates'
import { fetchClients } from '@/api/clients'
import { fetchEmployees } from '@/api/employees'
import { fetchProjects, fetchServices } from '@/api/operations'
import { fetchSales, moneyOf } from '@/api/sales'
import {
  blankTransaction,
  deleteTransaction,
  fetchTransactions,
  saveTransaction,
  totalsOf,
} from '@/api/finance'
import {
  EMPTY_SNAPSHOT,
  incomeByClient,
  incomeByService,
  periodOf,
  previousPeriod,
  seriesOver,
  slice,
  soldByChannel,
  trend,
  type Period,
  type Snapshot,
} from '@/api/metrics'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import type { Client, Project, Service } from '@/types/business'
import {
  INCOME_TYPES,
  PAYMENT_STATES,
  TRANSACTION_CATEGORIES,
  TRANSACTION_TYPES,
  type Affiliate,
  type Sale,
  type Transaction,
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

type Tab = 'overview' | 'ledger'

const tab = ref<Tab>('overview')
const period = ref<Period>(periodOf('month'))

const loading = ref(true)
const saving = ref(false)

const transactions = ref<Transaction[]>([])
const sales = ref<Sale[]>([])
const clients = ref<Client[]>([])
const services = ref<Service[]>([])
const projects = ref<Project[]>([])
const people = ref<EmployeePublic[]>([])
const affiliates = ref<Affiliate[]>([])

const search = ref('')
const typeFilter = ref<TransactionType | ''>('')
const statusFilter = ref('')
const clientFilter = ref('')

const draft = ref<Transaction | null>(null)
const draftAmount = ref(0)
const draftCurrency = ref<CurrencyCode>(BASE_CURRENCY)
const pendingDelete = ref<Transaction | null>(null)

const canCreate = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_CREATE))
const canEdit = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_EDIT))
const canDelete = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_DELETE))

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}
function short(minor: number): string {
  return formatMoneyShort(minor, BASE_CURRENCY, locale.value)
}

/* ---- Derived --------------------------------------------------------- */

const snapshot = computed<Snapshot>(() => ({
  ...EMPTY_SNAPSHOT,
  clients: clients.value,
  services: services.value,
  sales: sales.value,
  transactions: transactions.value,
}))

const current = computed(() => slice(snapshot.value, period.value))
const earlier = computed(() => slice(snapshot.value, previousPeriod(period.value)))

const totals = computed(() => totalsOf(current.value.transactions))
const before = computed(() => totalsOf(earlier.value.transactions))

const series = computed(() => {
  const points = seriesOver(current.value, period.value)
  return {
    labels: points.map((p) => p.label),
    money: [
      { key: 'income', label: t('finance.income'), values: points.map((p) => p.income) },
      { key: 'expense', label: t('finance.expenses'), values: points.map((p) => p.expense) },
      { key: 'profit', label: t('finance.profit'), values: points.map((p) => p.profit) },
    ],
  }
})

const byService = computed(() => incomeByService(current.value))
const byClient = computed(() => incomeByClient(current.value))
const byChannel = computed(() =>
  soldByChannel(current.value).map((r) => ({ ...r, label: t(`saleChannel.${r.key}`) })),
)

const headline = computed(() => [
  {
    key: 'income',
    label: t('finance.income'),
    value: money(totals.value.incomeBaseMinor),
    delta: trend(totals.value.incomeBaseMinor, before.value.incomeBaseMinor),
  },
  {
    key: 'expense',
    label: t('finance.expenses'),
    value: money(totals.value.expenseBaseMinor),
    delta: trend(totals.value.expenseBaseMinor, before.value.expenseBaseMinor),
  },
  {
    key: 'profit',
    label: t('finance.profit'),
    value: money(totals.value.profitBaseMinor),
    delta: trend(totals.value.profitBaseMinor, before.value.profitBaseMinor),
    accent: true,
  },
  {
    key: 'pending',
    label: t('finance.expected'),
    value: money(totals.value.pendingInBaseMinor),
    delta: null,
    hint: t('finance.expectedHint'),
  },
])

const ledger = computed(() => {
  const term = search.value.trim().toLowerCase()

  return current.value.transactions
    .filter((tx) => {
      if (typeFilter.value && tx.type !== typeFilter.value) return false
      if (statusFilter.value && tx.status !== statusFilter.value) return false
      if (clientFilter.value && tx.clientId !== clientFilter.value) return false
      if (!term) return true
      return `${tx.description} ${tx.clientName} ${tx.serviceName} ${tx.method}`
        .toLowerCase()
        .includes(term)
    })
    .sort((a, b) => b.date.localeCompare(a.date))
})

/* ---- Editor ---------------------------------------------------------- */

async function load(): Promise<void> {
  loading.value = true
  const [tx, sl, c, sv, pr, p, a] = await Promise.all([
    fetchTransactions(),
    fetchSales().catch(() => []),
    fetchClients().catch(() => []),
    fetchServices().catch(() => []),
    fetchProjects().catch(() => []),
    fetchEmployees().catch(() => []),
    fetchAffiliates().catch(() => []),
  ])
  transactions.value = tx
  sales.value = sl
  clients.value = c
  services.value = sv
  projects.value = pr
  people.value = p
  affiliates.value = a
  loading.value = false
}

function startNew(type: TransactionType = 'income'): void {
  draft.value = blankTransaction(type)
  draftAmount.value = 0
  draftCurrency.value = BASE_CURRENCY
  tab.value = 'ledger'
}

function startEdit(tx: Transaction): void {
  draft.value = { ...tx }
  draftAmount.value = fromMinor(tx.amount.minor, tx.amount.currency)
  draftCurrency.value = tx.amount.currency
}

function onClientChange(id: string): void {
  if (!draft.value) return
  draft.value.clientId = id || null
  draft.value.clientName = clients.value.find((c) => c.id === id)?.name ?? ''
}

function onServiceChange(id: string): void {
  if (!draft.value) return
  draft.value.serviceId = id || null
  draft.value.serviceName = services.value.find((s) => s.id === id)?.name ?? ''
}

function onEmployeeChange(uid: string): void {
  if (!draft.value) return
  const person = people.value.find((p) => p.uid === uid)
  draft.value.employeeUid = uid || null
  draft.value.employeeName = person ? `${person.firstName} ${person.lastName}` : ''
}

/** Choosing a sale fills the client, service and a sensible description. */
function onSaleChange(id: string): void {
  const d = draft.value
  if (!d) return

  d.saleId = id || null
  const sale = sales.value.find((s) => s.id === id)
  if (!sale) return

  d.clientId = sale.clientId
  d.clientName = sale.clientName
  d.serviceId = sale.serviceId
  d.serviceName = sale.serviceName
  d.projectId = sale.projectId
  d.affiliateId = sale.affiliateId
  d.employeeUid = sale.ownerUid
  d.employeeName = sale.ownerName
  if (!d.description) d.description = sale.title
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.description.trim()) {
    ui.notify('danger', t('finance.descriptionRequired'))
    return
  }

  const sale = sales.value.find((s) => s.id === d.saleId) ?? null
  const affiliate = affiliates.value.find((a) => a.id === d.affiliateId) ?? null

  saving.value = true
  try {
    await saveTransaction(
      {
        ...d,
        description: d.description.trim(),
        amount: moneyOf(draftAmount.value, draftCurrency.value, 1, d.date),
      },
      { sale, affiliate, existing: transactions.value },
    )
    ui.notify('ok', t('finance.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('finance.saveFailed'))
  } finally {
    saving.value = false
  }
}

/** Marking something paid is the act that turns expected money into income. */
async function markPaid(tx: Transaction): Promise<void> {
  const sale = sales.value.find((s) => s.id === tx.saleId) ?? null
  const affiliate = affiliates.value.find((a) => a.id === tx.affiliateId) ?? null

  await saveTransaction({ ...tx, status: 'paid' }, { sale, affiliate, existing: transactions.value })
  await load()
}

async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value) return
  await deleteTransaction(pendingDelete.value)
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
        <h1 class="page-title">{{ t('finance.title') }}</h1>
        <p class="page-subtitle">{{ t('finance.subtitle') }}</p>
      </div>
      <div v-if="canCreate" class="head-actions">
        <button class="btn btn-secondary" @click="startNew('expense')">
          <AppIcon name="minus" :size="15" /> {{ t('finance.newExpense') }}
        </button>
        <button class="btn btn-primary" @click="startNew('income')">
          <AppIcon name="plus" :size="16" /> {{ t('finance.newIncome') }}
        </button>
      </div>
    </header>

    <div class="tabs" role="tablist">
      <button
        v-for="key in (['overview', 'ledger'] as Tab[])"
        :key="key"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'is-active': tab === key }"
        :aria-selected="tab === key"
        @click="tab = key"
      >
        {{ key === 'overview' ? t('finance.tabOverview') : t('finance.tabLedger') }}
      </button>
    </div>

    <PeriodPicker v-model="period" />

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
          <span class="figure-label">{{ t('finance.overdue') }}</span>
          <span class="figure-value" :class="{ neg: totals.overdueBaseMinor > 0 }">
            {{ money(totals.overdueBaseMinor) }}
          </span>
        </article>
        <article class="card figure">
          <span class="figure-label">{{ t('finance.pendingOut') }}</span>
          <span class="figure-value">{{ money(totals.pendingOutBaseMinor) }}</span>
        </article>
      </div>

      <!-- Overview ---------------------------------------------------- -->
      <template v-if="tab === 'overview'">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('finance.overTime') }}</h2>
          </div>
          <div class="card-body">
            <TimeChart
              :labels="series.labels"
              :series="series.money"
              :format="money"
              :height="220"
              :area="false"
            />
          </div>
        </section>

        <div class="pair">
          <section class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('finance.byService') }}</h2>
            </div>
            <div class="card-body">
              <RankChart
                v-if="byService.length"
                :rows="byService"
                :format="short"
                :other-label="t('analytics.unattributed')"
              />
              <p v-else class="tertiary small">{{ t('finance.empty') }}</p>
            </div>
          </section>

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
              <h2 class="card-title">{{ t('finance.bySource') }}</h2>
            </div>
            <div class="card-body">
              <RankChart v-if="byChannel.length" :rows="byChannel" :format="short" />
              <p v-else class="tertiary small">{{ t('finance.empty') }}</p>
            </div>
          </section>
        </div>
      </template>

      <!-- Ledger ------------------------------------------------------ -->
      <template v-else>
        <section v-if="draft" class="card editor">
          <div class="card-header">
            <h2 class="card-title">
              {{ draft.id ? t('finance.editRecord') : t('finance.newRecord') }}
            </h2>
            <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="draft = null">
              <AppIcon name="close" :size="18" />
            </button>
          </div>

          <div class="card-body stack">
            <div class="field-grid">
              <div class="field">
                <label class="field-label" for="f-type">{{ t('finance.type') }}</label>
                <select id="f-type" v-model="draft.type" class="select">
                  <option v-for="ty in TRANSACTION_TYPES" :key="ty" :value="ty">
                    {{ t(`transactionType.${ty}`) }}
                  </option>
                </select>
                <p class="field-hint">{{ t('finance.typeHint') }}</p>
              </div>

              <div class="field">
                <label class="field-label" for="f-desc">
                  {{ t('finance.description') }}<span class="req">*</span>
                </label>
                <input id="f-desc" v-model="draft.description" class="input" :maxlength="LIMITS.position" />
              </div>

              <div class="field">
                <label class="field-label" for="f-amount">{{ t('finance.amount') }}</label>
                <input id="f-amount" v-model.number="draftAmount" class="input" type="number" step="0.01" />
              </div>

              <div class="field">
                <label class="field-label" for="f-cur">{{ t('finance.currency') }}</label>
                <select id="f-cur" v-model="draftCurrency" class="select">
                  <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
                </select>
              </div>

              <div class="field">
                <label class="field-label" for="f-cat">{{ t('finance.category') }}</label>
                <select id="f-cat" v-model="draft.category" class="select">
                  <option v-for="c in TRANSACTION_CATEGORIES" :key="c" :value="c">
                    {{ t(`transactionCategory.${c}`) }}
                  </option>
                </select>
              </div>

              <div class="field">
                <label class="field-label" for="f-date">{{ t('finance.date') }}</label>
                <input id="f-date" v-model="draft.date" class="input" type="date" />
              </div>

              <div class="field">
                <label class="field-label" for="f-status">{{ t('finance.paymentStatus') }}</label>
                <select id="f-status" v-model="draft.status" class="select">
                  <option v-for="s in PAYMENT_STATES" :key="s" :value="s">
                    {{ t(`payState.${s}`) }}
                  </option>
                </select>
              </div>

              <div v-if="draft.status !== 'paid'" class="field">
                <label class="field-label" for="f-due">{{ t('finance.dueDate') }}</label>
                <input id="f-due" v-model="draft.dueDate" class="input" type="date" />
              </div>

              <div v-if="sales.length" class="field">
                <label class="field-label" for="f-sale">{{ t('finance.sale') }}</label>
                <select
                  id="f-sale"
                  :value="draft.saleId ?? ''"
                  class="select"
                  @change="onSaleChange(($event.target as HTMLSelectElement).value)"
                >
                  <option value="">—</option>
                  <option v-for="s in sales" :key="s.id" :value="s.id">
                    {{ s.title }} · {{ s.clientName }}
                  </option>
                </select>
              </div>

              <div class="field">
                <label class="field-label" for="f-client">{{ t('table.client') }}</label>
                <select
                  id="f-client"
                  :value="draft.clientId ?? ''"
                  class="select"
                  @change="onClientChange(($event.target as HTMLSelectElement).value)"
                >
                  <option value="">—</option>
                  <option v-for="c in clients" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
              </div>

              <div class="field">
                <label class="field-label" for="f-service">{{ t('table.service') }}</label>
                <select
                  id="f-service"
                  :value="draft.serviceId ?? ''"
                  class="select"
                  @change="onServiceChange(($event.target as HTMLSelectElement).value)"
                >
                  <option value="">—</option>
                  <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
                </select>
              </div>

              <div v-if="projects.length" class="field">
                <label class="field-label" for="f-project">{{ t('table.project') }}</label>
                <select id="f-project" v-model="draft.projectId" class="select">
                  <option :value="null">—</option>
                  <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </div>

              <div class="field">
                <label class="field-label" for="f-emp">{{ t('table.employee') }}</label>
                <select
                  id="f-emp"
                  :value="draft.employeeUid ?? ''"
                  class="select"
                  @change="onEmployeeChange(($event.target as HTMLSelectElement).value)"
                >
                  <option value="">—</option>
                  <option v-for="p in people" :key="p.uid" :value="p.uid">
                    {{ p.firstName }} {{ p.lastName }}
                  </option>
                </select>
              </div>

              <div class="field">
                <label class="field-label" for="f-method">{{ t('finance.method') }}</label>
                <input id="f-method" v-model="draft.method" class="input" :maxlength="LIMITS.name" />
              </div>
            </div>

            <div class="field">
              <label class="field-label" for="f-notes">{{ t('clients.notes') }}</label>
              <textarea id="f-notes" v-model="draft.notes" class="textarea" :maxlength="LIMITS.longText" />
            </div>

            <p v-if="draft.saleId && draft.affiliateId" class="field-hint warn">
              {{ t('sales.commissionHint') }}
            </p>
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

          <select v-model="typeFilter" class="select compact" :aria-label="t('finance.type')">
            <option value="">{{ t('finance.allTypes') }}</option>
            <option v-for="ty in TRANSACTION_TYPES" :key="ty" :value="ty">
              {{ t(`transactionType.${ty}`) }}
            </option>
          </select>

          <select v-model="statusFilter" class="select compact" :aria-label="t('table.status')">
            <option value="">{{ t('clients.allStatuses') }}</option>
            <option v-for="s in PAYMENT_STATES" :key="s" :value="s">{{ t(`payState.${s}`) }}</option>
          </select>

          <select v-model="clientFilter" class="select compact" :aria-label="t('table.client')">
            <option value="">{{ t('finance.allClients') }}</option>
            <option v-for="c in clients" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>

        <div v-if="ledger.length === 0" class="card">
          <div class="empty">
            <span class="empty-icon"><AppIcon name="wallet" :size="20" /></span>
            <p class="empty-title">{{ t('finance.empty') }}</p>
            <p class="empty-text">{{ t('finance.emptyHint') }}</p>
            <button v-if="canCreate" class="btn btn-primary" @click="startNew('income')">
              {{ t('finance.newIncome') }}
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
                  <th class="hide-sm">{{ t('finance.type') }}</th>
                  <th class="hide-md">{{ t('finance.category') }}</th>
                  <th class="hide-md">{{ t('table.client') }}</th>
                  <th>{{ t('table.status') }}</th>
                  <th class="num">{{ t('table.amount') }}</th>
                  <th class="col-actions" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="tx in ledger" :key="tx.id">
                  <td class="muted nowrap">{{ formatDate(tx.date) }}</td>
                  <td>{{ tx.description }}</td>
                  <td class="hide-sm">
                    <span class="badge badge-plain">{{ t(`transactionType.${tx.type}`) }}</span>
                  </td>
                  <td class="hide-md muted">{{ t(`transactionCategory.${tx.category}`) }}</td>
                  <td class="hide-md">
                    <button
                      v-if="tx.clientId"
                      type="button"
                      class="link-quiet"
                      @click="router.push(`/clients/${tx.clientId}`)"
                    >
                      {{ tx.clientName }}
                    </button>
                    <span v-else class="tertiary">—</span>
                  </td>
                  <td>
                    <span class="badge" :class="`ps-${tx.status}`">
                      {{ t(`payState.${tx.status}`) }}
                    </span>
                    <span v-if="tx.dueDate && tx.status !== 'paid'" class="tertiary small block">
                      {{ formatDate(tx.dueDate) }}
                    </span>
                  </td>
                  <td class="num strong" :class="INCOME_TYPES.includes(tx.type) ? 'pos' : 'neg'">
                    {{ money(tx.amount.baseMinor) }}
                  </td>
                  <td class="col-actions">
                    <button
                      v-if="canEdit && tx.status !== 'paid'"
                      class="btn btn-secondary btn-sm"
                      @click="markPaid(tx)"
                    >
                      {{ t('finance.markPaid') }}
                    </button>
                    <button
                      v-if="canEdit"
                      class="btn btn-ghost btn-sm"
                      :aria-label="t('common.edit')"
                      @click="startEdit(tx)"
                    >
                      <AppIcon name="edit" :size="15" />
                    </button>
                    <button
                      v-if="canDelete"
                      class="btn btn-ghost btn-sm danger"
                      :aria-label="t('common.delete')"
                      @click="pendingDelete = tx"
                    >
                      <AppIcon name="trash" :size="15" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p class="card-body tertiary small">{{ ledger.length }}</p>
        </section>
      </template>
    </template>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('finance.deleteRecord')"
      :message="t('recycle.deleteExplain')"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>

<style scoped>
.head-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.tabs { display: flex; gap: var(--space-1); border-bottom: 1px solid var(--border-subtle); }
.tab { padding: var(--space-3) var(--space-4); border-bottom: 2px solid transparent; font-size: var(--text-base); font-weight: 550; color: var(--text-secondary); }
.tab:hover { color: var(--text-primary); }
.tab.is-active { color: var(--text-brand); border-bottom-color: var(--accent); }

.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-3); }
.figure { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4); }
.figure.is-accent { border-color: var(--accent-soft-border); background: var(--accent-soft-bg); }
.figure-label { font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.figure-value { font-size: var(--text-lg); font-weight: 700; font-variant-numeric: tabular-nums; }
.figure-hint { font-size: var(--text-xs); color: var(--text-tertiary); line-height: var(--leading-relaxed); }
.delta { display: inline-flex; align-items: center; gap: 3px; font-size: var(--text-xs); font-weight: 600; }

.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: var(--space-4); }
.editor { border-color: var(--accent-soft-border); }

.search { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: var(--space-3); color: var(--text-tertiary); pointer-events: none; }
.search-input { padding-left: calc(var(--space-3) * 2 + 16px); }
.select.compact { max-width: 170px; }

.link-quiet { color: var(--text-secondary); }
.link-quiet:hover { color: var(--text-brand); text-decoration: underline; }
.block { display: block; }

.num { text-align: right; font-variant-numeric: tabular-nums; }
.strong { font-weight: 650; }
.pos { color: var(--ok-500); }
.neg { color: var(--danger-500); }
.warn { color: var(--warn-500); }
.nowrap { white-space: nowrap; }
.small { font-size: var(--text-xs); }
.danger:hover { color: var(--danger-500); }

.ps-paid { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.ps-pending { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.ps-overdue { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-500); }

@media (max-width: 900px) { .hide-md { display: none; } }
@media (max-width: 640px) { .hide-sm { display: none; } }
</style>
