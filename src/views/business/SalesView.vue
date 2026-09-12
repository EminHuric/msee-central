<script setup lang="ts">
/**
 * Sales — the archive of everything MsEe has sold.
 *
 * Not a forecast. Every row here is something that happened: to whom, when,
 * for how much, through which channel, and who handled it. The pipeline lives
 * on the Leads page; this is the record you consult in two years.
 *
 * The analysis section is the part that will age best. "He only answers
 * WhatsApp after six" is worth more later than the amount is, and it is free
 * text precisely because nobody could have designed a field for it.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import CustomFields from '@/components/CustomFields.vue'
import { fetchAffiliates } from '@/api/affiliates'
import { fetchClients } from '@/api/clients'
import { fetchEmployees } from '@/api/employees'
import { fetchProjects, fetchServices } from '@/api/operations'
import { fieldsFor, fetchFieldDefs } from '@/api/records'
import {
  balances,
  blankSale,
  deleteSale,
  fetchSales,
  moneyOf,
  saveSale,
  recordCommissionFor,
  structureFromTerms,
  totalsOf,
} from '@/api/sales'
import { blankTransaction, fetchTransactions, saveTransaction } from '@/api/finance'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import type { Client, Project, Service, ServiceTerms } from '@/types/business'
import {
  CONTACT_CHANNELS,
  PAYMENT_MODELS,
  SALE_CHANNELS,
  type Affiliate,
  type Sale,
  type SaleChannel,
  type Transaction,
} from '@/types/revenue'
import {
  BASE_CURRENCY,
  CURRENCIES,
  formatMoney,
  fromMinor,
  toMinor,
  type CurrencyCode,
} from '@/types/money'
import type { CustomFieldDef } from '@/types/records'
import { PERMISSIONS } from '@/types/permissions'
import type { EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()

const loading = ref(true)
const saving = ref(false)

const sales = ref<Sale[]>([])
const transactions = ref<Transaction[]>([])
const clients = ref<Client[]>([])
const services = ref<Service[]>([])

/* Empty for anybody without `services.view_price`; see the note where it is used. */
const serviceTerms = ref<Map<string, ServiceTerms>>(new Map())
const projects = ref<Project[]>([])
const people = ref<EmployeePublic[]>([])
const affiliates = ref<Affiliate[]>([])
const fieldDefs = ref<CustomFieldDef[]>([])

const search = ref('')
const channelFilter = ref<SaleChannel | ''>('')
const serviceFilter = ref('')
const ownerFilter = ref('')
const sortKey = ref<'date' | 'value' | 'client'>('date')

const draft = ref<Sale | null>(null)
const draftValue = ref(0)
const draftCurrency = ref<CurrencyCode>(BASE_CURRENCY)
const draftAdvance = ref(0)

const pendingDelete = ref<Sale | null>(null)
const paying = ref<Sale | null>(null)
const payAmount = ref(0)

const today = new Date().toISOString().slice(0, 10)

const canCreate = computed(() => auth.hasPermission(PERMISSIONS.SALES_CREATE))
const canEdit = computed(() => auth.hasPermission(PERMISSIONS.SALES_EDIT))
const canDelete = computed(() => auth.hasPermission(PERMISSIONS.SALES_DELETE))
const canMoney = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_CREATE))

const saleFields = computed(() => fieldsFor(fieldDefs.value, 'sale'))

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

const balanceMap = computed(() => balances(sales.value, transactions.value))

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()

  const rows = sales.value.filter((s) => {
    if (channelFilter.value && s.channel !== channelFilter.value) return false
    if (serviceFilter.value && s.serviceId !== serviceFilter.value) return false
    if (ownerFilter.value && s.ownerUid !== ownerFilter.value) return false
    if (!term) return true

    return [s.title, s.clientName, s.serviceName, s.ownerName, s.analysis?.howAcquired]
      .join(' ')
      .toLowerCase()
      .includes(term)
  })

  return rows.sort((a, b) => {
    if (sortKey.value === 'value') return b.value.baseMinor - a.value.baseMinor
    if (sortKey.value === 'client') return a.clientName.localeCompare(b.clientName)
    return b.saleDate.localeCompare(a.saleDate)
  })
})

const totals = computed(() => totalsOf(visible.value, transactions.value))

async function load(): Promise<void> {
  loading.value = true
  try {
    const [s, tx, c, sv, pr, p, a, f] = await Promise.all([
      fetchSales(),
      fetchTransactions().catch(() => []),
      fetchClients().catch(() => []),
      fetchServices().catch(() => []),
      fetchProjects().catch(() => []),
      fetchEmployees().catch(() => []),
      fetchAffiliates().catch(() => []),
      fetchFieldDefs().catch(() => []),
    ])
    sales.value = s
    transactions.value = tx
    clients.value = c
    services.value = sv
    projects.value = pr
    people.value = p
    affiliates.value = a
    fieldDefs.value = f
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

function startNew(): void {
  draft.value = blankSale(auth.uid, auth.displayName ?? '')
  draftValue.value = 0
  draftCurrency.value = BASE_CURRENCY
  draftAdvance.value = 0
}

function startEdit(sale: Sale): void {
  draft.value = { ...sale, analysis: { ...sale.analysis }, payment: { ...sale.payment } }
  draftValue.value = fromMinor(sale.value.minor, sale.value.currency)
  draftCurrency.value = sale.value.currency
  draftAdvance.value = fromMinor(sale.payment?.advanceBaseMinor ?? 0, BASE_CURRENCY)
}

function onClientChange(id: string): void {
  if (!draft.value) return
  draft.value.clientId = id
  draft.value.clientName = clients.value.find((c) => c.id === id)?.name ?? ''
  if (!draft.value.title && draft.value.clientName) draft.value.title = draft.value.clientName
}

/**
 * Choosing a service brings its price and its payment structure across.
 *
 * Both are suggestions. The price is what it normally costs and the structure
 * is how it is normally paid for — a customer who agreed something else is the
 * ordinary case, not an exception.
 */
function onServiceChange(id: string): void {
  const d = draft.value
  if (!d) return

  d.serviceId = id || null
  const service = services.value.find((s) => s.id === id)
  if (!service) return

  d.serviceName = service.name

  /*
   * Prefill the value only if the terms could be read.
   *
   * Somebody without `services.view_price` gets an empty box and types what
   * was agreed; whoever can see prices sets the rest. The alternative would be
   * fetching the figure in order to hide it, which is not hiding it.
   */
  const terms = serviceTerms.value.get(id) ?? null

  if (!draftValue.value && terms) {
    draftValue.value = fromMinor(terms.defaultPrice.minor, terms.defaultPrice.currency)
    draftCurrency.value = terms.defaultPrice.currency
  }

  const structure = structureFromTerms(terms, toMinor(draftValue.value, draftCurrency.value))
  d.payment = { ...structure }
  draftAdvance.value = fromMinor(structure.advanceBaseMinor, BASE_CURRENCY)

  if (!d.title) {
    d.title = `${d.clientName || ''}${d.clientName ? ' — ' : ''}${service.name}`
  }
}

function onOwnerChange(uid: string): void {
  if (!draft.value) return
  const person = people.value.find((p) => p.uid === uid)
  draft.value.ownerUid = uid || null
  draft.value.ownerName = person ? `${person.firstName} ${person.lastName}` : ''
}

function onAffiliateChange(id: string): void {
  if (!draft.value) return
  draft.value.affiliateId = id || null
  draft.value.affiliateName = affiliates.value.find((a) => a.id === id)?.name ?? ''
  if (id) draft.value.channel = 'affiliate'
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.clientId) {
    ui.notify('danger', t('sales.clientRequired'))
    return
  }
  if (!d.title.trim()) {
    ui.notify('danger', t('sales.titleRequired'))
    return
  }

  saving.value = true
  try {
    await saveSale({
      ...d,
      title: d.title.trim(),
      value: moneyOf(draftValue.value, draftCurrency.value, 1, d.saleDate),
      payment: {
        ...d.payment,
        advanceBaseMinor: toMinor(draftAdvance.value, BASE_CURRENCY),
      },
    })
    ui.notify('ok', t('sales.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('sales.saveFailed'))
  } finally {
    saving.value = false
  }
}

/**
 * Record a payment against a sale, straight from the row.
 *
 * This is the moment money becomes real: the balance moves, the finance page
 * gains a row, and — if an affiliate brought the deal — a pending commission
 * appears for somebody else to approve.
 */
function startPayment(sale: Sale): void {
  paying.value = sale
  const balance = balanceMap.value.get(sale.id)
  const suggested = balance?.advanceDue
    ? balance.advanceBaseMinor - balance.paidBaseMinor
    : (balance?.remainingBaseMinor ?? 0)
  payAmount.value = fromMinor(Math.max(0, suggested), BASE_CURRENCY)
}

async function commitPayment(): Promise<void> {
  const sale = paying.value
  if (!sale || saving.value || payAmount.value <= 0) return

  const balance = balanceMap.value.get(sale.id)
  const affiliate = affiliates.value.find((a) => a.id === sale.affiliateId) ?? null

  saving.value = true
  try {
    await saveTransaction(
      {
        ...blankTransaction('income'),
        category: balance?.advanceDue ? 'advance' : 'service_payment',
        description: sale.title,
        amount: moneyOf(payAmount.value, BASE_CURRENCY, 1, today),
        date: today,
        status: 'paid',
        clientId: sale.clientId,
        clientName: sale.clientName,
        serviceId: sale.serviceId,
        serviceName: sale.serviceName,
        projectId: sale.projectId,
        saleId: sale.id,
        employeeUid: sale.ownerUid,
        employeeName: sale.ownerName,
        affiliateId: sale.affiliateId,
      },
      { sale, affiliate, existing: transactions.value },
    )

    ui.notify('ok', t('finance.saved'))
    paying.value = null
    await load()
  } catch {
    ui.notify('danger', t('finance.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function confirmDelete(): Promise<void> {
  try {
    if (!pendingDelete.value) return
    await deleteSale(pendingDelete.value)
    ui.notify('ok', t('recycle.movedToBin'))
    await load()
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    /* Always clears, so a refused delete cannot leave the
       confirmation on screen with nothing happening. */
    pendingDelete.value = null
  }
}


/**
 * Open the editor when arrived at with `?new=…`.
 *
 * The quick-add on a phone navigates here rather than carrying its own
 * copy of this form. The parameter is removed once acted on, so going
 * back or refreshing does not reopen a form that was just closed.
 */
function openFromQuery(): void {
  if (!route.query.new) return
  startNew()
  void router.replace({ query: {} })
}

/* ---- What a sale earns the person who made it ------------------------- */

const busyCommission = ref(false)

/**
 * Whether the commission can be recorded here and now.
 *
 * Needs the rate, which means the terms were readable, and needs somebody with
 * `wallet.adjust` — and never for your own sale, because the database refuses
 * a self-credit and offering the button would only produce an error.
 */
function canRecordCommission(sale: Sale): boolean {
  if (!auth.hasPermission(PERMISSIONS.WALLET_ADJUST)) return false
  if (!sale.ownerUid || sale.ownerUid === auth.uid) return false

  const percent = serviceTerms.value.get(sale.serviceId ?? '')?.commissionPercent ?? 0
  return percent > 0
}

async function recordCommission(sale: Sale): Promise<void> {
  const percent = serviceTerms.value.get(sale.serviceId ?? '')?.commissionPercent ?? 0
  const owner = people.value.find((p) => p.uid === sale.ownerUid)
  if (!owner || busyCommission.value) return

  busyCommission.value = true
  try {
    const id = await recordCommissionFor(
      sale,
      { uid: owner.uid, name: `${owner.firstName} ${owner.lastName}`.trim() },
      percent,
    )
    ui.notify(id ? 'ok' : 'info', id ? t('sales.commissionRecorded') : t('sales.commissionExists'))
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    busyCommission.value = false
  }
}

onMounted(async () => {
  await load()
  openFromQuery()
})
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('sales.title') }}</h1>
        <p class="page-subtitle">{{ t('sales.subtitle') }}</p>
      </div>
      <button v-if="canCreate && !draft" class="btn btn-primary" @click="startNew">
        <AppIcon name="plus" :size="16" /> {{ t('sales.newSale') }}
      </button>
    </header>

    <!-- Totals --------------------------------------------------------- -->
    <div class="figures">
      <article class="card figure">
        <span class="figure-label">{{ t('sales.count') }}</span>
        <span class="figure-value">{{ totals.count }}</span>
      </article>
      <article class="card figure">
        <span class="figure-label">{{ t('sales.sold') }}</span>
        <span class="figure-value">{{ money(totals.valueBaseMinor) }}</span>
      </article>
      <article class="card figure">
        <span class="figure-label">{{ t('finance.collected') }}</span>
        <span class="figure-value pos">{{ money(totals.paidBaseMinor) }}</span>
      </article>
      <article class="card figure">
        <span class="figure-label">{{ t('finance.outstanding') }}</span>
        <span class="figure-value" :class="{ neg: totals.outstandingBaseMinor > 0 }">
          {{ money(totals.outstandingBaseMinor) }}
        </span>
        <span v-if="totals.advanceDueCount" class="figure-hint warn">
          {{ t('sales.advanceDue') }}: {{ totals.advanceDueCount }}
        </span>
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
        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="s-client">
              {{ t('sales.client') }}<span class="req">*</span>
            </label>
            <select
              id="s-client"
              :value="draft.clientId"
              class="select"
              @change="onClientChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="">—</option>
              <option v-for="c in clients" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="s-service">{{ t('sales.service') }}</label>
            <select
              id="s-service"
              :value="draft.serviceId ?? ''"
              class="select"
              @change="onServiceChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="">—</option>
              <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="s-title">
              {{ t('sales.dealTitle') }}<span class="req">*</span>
            </label>
            <input id="s-title" v-model="draft.title" class="input" :maxlength="LIMITS.position" />
          </div>

          <div class="field">
            <label class="field-label" for="s-date">{{ t('sales.saleDate') }}</label>
            <input id="s-date" v-model="draft.saleDate" class="input" type="date" />
          </div>

          <div class="field">
            <label class="field-label" for="s-value">{{ t('sales.value') }}</label>
            <input id="s-value" v-model.number="draftValue" class="input" type="number" step="0.01" />
          </div>

          <div class="field">
            <label class="field-label" for="s-cur">{{ t('finance.currency') }}</label>
            <select id="s-cur" v-model="draftCurrency" class="select">
              <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="s-owner">{{ t('sales.owner') }}</label>
            <select
              id="s-owner"
              :value="draft.ownerUid ?? ''"
              class="select"
              @change="onOwnerChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="">—</option>
              <option v-for="p in people" :key="p.uid" :value="p.uid">
                {{ p.firstName }} {{ p.lastName }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="s-channel">{{ t('sales.channel') }}</label>
            <select id="s-channel" v-model="draft.channel" class="select">
              <option v-for="c in SALE_CHANNELS" :key="c" :value="c">
                {{ t(`saleChannel.${c}`) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="s-contact">{{ t('sales.contactChannel') }}</label>
            <select id="s-contact" v-model="draft.contactChannel" class="select">
              <option v-for="c in CONTACT_CHANNELS" :key="c" :value="c">
                {{ t(`contactChannel.${c}`) }}
              </option>
            </select>
          </div>
        </div>

        <!-- Payment structure ------------------------------------------ -->
        <fieldset class="block">
          <legend>{{ t('sales.paymentStructure') }}</legend>
          <p class="field-hint">{{ t('sales.paymentHint') }}</p>

          <div class="field-grid">
            <div class="field">
              <label class="field-label" for="s-model">{{ t('sales.paymentModel') }}</label>
              <select id="s-model" v-model="draft.payment.model" class="select">
                <option v-for="m in PAYMENT_MODELS" :key="m" :value="m">
                  {{ t(`paymentModel.${m}`) }}
                </option>
              </select>
            </div>

            <div v-if="draft.payment.model !== 'one_off'" class="field">
              <label class="field-label" for="s-advance">{{ t('sales.advance') }}</label>
              <input id="s-advance" v-model.number="draftAdvance" class="input" type="number" step="0.01" />
            </div>

            <div v-if="draft.payment.model === 'instalments'" class="field">
              <label class="field-label" for="s-count">{{ t('sales.instalmentCount') }}</label>
              <input
                id="s-count"
                v-model.number="draft.payment.instalmentCount"
                class="input"
                type="number"
                min="0"
              />
            </div>

            <div class="field">
              <label class="field-label" for="s-due">{{ t('sales.dueInDays') }}</label>
              <input id="s-due" v-model.number="draft.payment.dueInDays" class="input" type="number" min="0" />
            </div>
          </div>
        </fieldset>

        <!-- Analysis --------------------------------------------------- -->
        <fieldset class="block">
          <legend>{{ t('sales.analysis') }}</legend>
          <p class="field-hint">{{ t('sales.analysisHint') }}</p>

          <div class="field-grid">
            <div class="field">
              <label class="field-label" for="a-how">{{ t('sales.howAcquired') }}</label>
              <input id="a-how" v-model="draft.analysis.howAcquired" class="input" :maxlength="LIMITS.shortText" />
            </div>
            <div class="field">
              <label class="field-label" for="a-worked">{{ t('sales.whatWorked') }}</label>
              <input id="a-worked" v-model="draft.analysis.whatWorked" class="input" :maxlength="LIMITS.shortText" />
            </div>
            <div class="field">
              <label class="field-label" for="a-not">{{ t('sales.whatDidNot') }}</label>
              <input id="a-not" v-model="draft.analysis.whatDidNot" class="input" :maxlength="LIMITS.shortText" />
            </div>
            <div class="field">
              <label class="field-label" for="a-pref">{{ t('sales.clientPreferences') }}</label>
              <input id="a-pref" v-model="draft.analysis.clientPreferences" class="input" :maxlength="LIMITS.shortText" />
            </div>
          </div>

          <div class="field">
            <label class="field-label" for="a-notes">{{ t('sales.notes') }}</label>
            <textarea id="a-notes" v-model="draft.analysis.notes" class="textarea" :maxlength="LIMITS.longText" />
          </div>
        </fieldset>

        <details class="more">
          <summary>{{ t('common.moreDetails') }}</summary>
          <div class="field-grid">
            <div v-if="projects.length" class="field">
              <label class="field-label" for="s-project">{{ t('sales.project') }}</label>
              <select id="s-project" v-model="draft.projectId" class="select">
                <option :value="null">—</option>
                <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </div>
            <div v-if="affiliates.length" class="field">
              <label class="field-label" for="s-aff">{{ t('sales.affiliate') }}</label>
              <select
                id="s-aff"
                :value="draft.affiliateId ?? ''"
                class="select"
                @change="onAffiliateChange(($event.target as HTMLSelectElement).value)"
              >
                <option value="">—</option>
                <option v-for="a in affiliates" :key="a.id" :value="a.id">{{ a.name }}</option>
              </select>
            </div>
          </div>
        </details>

        <CustomFields v-model="draft.custom" :fields="saleFields" can-see-management />
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
          :placeholder="t('sales.searchPlaceholder')"
          :aria-label="t('common.search')"
        />
      </div>

      <select v-model="channelFilter" class="select compact" :aria-label="t('sales.channel')">
        <option value="">{{ t('sales.allChannels') }}</option>
        <option v-for="c in SALE_CHANNELS" :key="c" :value="c">{{ t(`saleChannel.${c}`) }}</option>
      </select>

      <select v-model="serviceFilter" class="select compact" :aria-label="t('table.service')">
        <option value="">{{ t('sales.allServices') }}</option>
        <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>

      <select v-model="ownerFilter" class="select compact" :aria-label="t('sales.owner')">
        <option value="">{{ t('sales.allOwners') }}</option>
        <option v-for="p in people" :key="p.uid" :value="p.uid">
          {{ p.firstName }} {{ p.lastName }}
        </option>
      </select>

      <select v-model="sortKey" class="select compact" :aria-label="t('common.sort')">
        <option value="date">{{ t('sales.sortDate') }}</option>
        <option value="value">{{ t('sales.sortValue') }}</option>
        <option value="client">{{ t('sales.sortClient') }}</option>
      </select>
    </div>

    <!-- List ----------------------------------------------------------- -->
    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 4" :key="n" class="skeleton" style="height: 44px" />
      </div>
    </div>

    <div v-else-if="visible.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="trending" :size="20" /></span>
        <p class="empty-title">{{ sales.length === 0 ? t('sales.empty') : t('sales.noMatch') }}</p>
        <p class="empty-text">{{ t('sales.emptyHint') }}</p>
        <button v-if="canCreate && sales.length === 0" class="btn btn-primary" @click="startNew">
          {{ t('sales.newSale') }}
        </button>
      </div>
    </div>

    <section v-else class="card">
      <div class="table-wrap">
        <table class="table table-cards">
          <thead>
            <tr>
              <th>{{ t('sales.dealTitle') }}</th>
              <th class="hide-sm">{{ t('table.client') }}</th>
              <th class="hide-md">{{ t('table.service') }}</th>
              <th class="hide-md">{{ t('sales.channel') }}</th>
              <th class="hide-sm">{{ t('sales.saleDate') }}</th>
              <th class="num">{{ t('table.value') }}</th>
              <th class="num hide-sm">{{ t('finance.outstanding') }}</th>
              <th>{{ t('table.status') }}</th>
              <th class="col-actions" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="sale in visible" :key="sale.id">
              <td>
                <button type="button" class="name-cell" @click="startEdit(sale)">
                  <span class="name">{{ sale.title }}</span>
                  <span v-if="sale.ownerName" class="tertiary">{{ sale.ownerName }}</span>
                </button>
              </td>
              <td :data-label="t('table.client')" class="hide-sm">
                <button
                  type="button"
                  class="link-quiet"
                  @click="router.push(`/clients/${sale.clientId}`)"
                >
                  {{ sale.clientName }}
                </button>
              </td>
              <td :data-label="t('table.service')" class="hide-md muted">{{ sale.serviceName || '—' }}</td>
              <td :data-label="t('sales.channel')" class="hide-md muted">{{ t(`saleChannel.${sale.channel}`) }}</td>
              <td :data-label="t('sales.saleDate')" class="hide-sm muted nowrap">{{ formatDate(sale.saleDate) }}</td>
              <td :data-label="t('table.value')" class="num strong">{{ money(sale.value.baseMinor) }}</td>
              <td :data-label="t('finance.outstanding')" class="num hide-sm" :class="{ neg: (balanceMap.get(sale.id)?.remainingBaseMinor ?? 0) > 0 }">
                {{ money(balanceMap.get(sale.id)?.remainingBaseMinor ?? 0) }}
              </td>
              <td :data-label="t('table.status')">
                <span class="badge" :class="`pay-${balanceMap.get(sale.id)?.status}`">
                  {{ t(`payStatus.${balanceMap.get(sale.id)?.status}`) }}
                </span>
              </td>
              <td class="col-actions">
                <!--
                  Record what the seller earned on this sale.
                  Only for somebody who can see the rate, which is why it is a
                  button rather than something the save does invisibly.
                -->
                <button
                  v-if="canRecordCommission(sale)"
                  class="btn btn-ghost btn-sm"
                  :disabled="busyCommission"
                  @click="recordCommission(sale)"
                >
                  {{ t('sales.recordCommission') }}
                </button>
                <button
                  v-if="canMoney && (balanceMap.get(sale.id)?.remainingBaseMinor ?? 0) > 0"
                  class="btn btn-secondary btn-sm"
                  @click="startPayment(sale)"
                >
                  {{ t('sales.recordPayment') }}
                </button>
                <button
                  v-if="canEdit"
                  class="btn btn-ghost btn-sm"
                  :aria-label="t('common.edit')"
                  @click="startEdit(sale)"
                >
                  <AppIcon name="edit" :size="15" />
                </button>
                <button
                  v-if="canDelete"
                  class="btn btn-ghost btn-sm danger"
                  :aria-label="t('common.delete')"
                  @click="pendingDelete = sale"
                >
                  <AppIcon name="trash" :size="15" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Payment -------------------------------------------------------- -->
    <div v-if="paying" class="modal-backdrop" @click.self="paying = null">
      <section class="card modal">
        <div class="card-header">
          <h2 class="card-title">{{ t('sales.recordPayment') }}</h2>
          <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="paying = null">
            <AppIcon name="close" :size="18" />
          </button>
        </div>

        <div class="card-body stack">
          <p class="field-hint">{{ paying.title }} · {{ paying.clientName }}</p>

          <dl class="mini">
            <div>
              <dt>{{ t('sales.value') }}</dt>
              <dd>{{ money(paying.value.baseMinor) }}</dd>
            </div>
            <div>
              <dt>{{ t('finance.collected') }}</dt>
              <dd class="pos">{{ money(balanceMap.get(paying.id)?.paidBaseMinor ?? 0) }}</dd>
            </div>
            <div>
              <dt>{{ t('finance.outstanding') }}</dt>
              <dd class="neg">{{ money(balanceMap.get(paying.id)?.remainingBaseMinor ?? 0) }}</dd>
            </div>
          </dl>

          <div class="field">
            <label class="field-label" for="pay-amount">{{ t('finance.amount') }}</label>
            <input id="pay-amount" v-model.number="payAmount" class="input" type="number" step="0.01" />
            <p v-if="balanceMap.get(paying.id)?.advanceDue" class="field-hint warn">
              {{ t('sales.advanceHint') }}
            </p>
            <p v-if="paying.affiliateId" class="field-hint">{{ t('sales.commissionHint') }}</p>
          </div>
        </div>

        <div class="card-footer">
          <button class="btn btn-secondary" @click="paying = null">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="saving || payAmount <= 0" @click="commitPayment">
            <span v-if="saving" class="spinner" />{{ t('common.save') }}
          </button>
        </div>
      </section>
    </div>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('sales.deleteSale')"
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
.select.compact { max-width: 165px; }

.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--space-3); }
.figure { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4); }
.figure-label { font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.figure-value { font-size: var(--text-lg); font-weight: 700; font-variant-numeric: tabular-nums; }
.figure-hint { font-size: var(--text-xs); }

.block { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
.block > legend { padding: 0 var(--space-2); font-size: var(--text-sm); font-weight: 650; }
.more { border-top: 1px solid var(--border-subtle); padding-top: var(--space-3); }
.more > summary { cursor: pointer; font-size: var(--text-sm); font-weight: 600; color: var(--text-secondary); margin-bottom: var(--space-3); }

.name-cell { display: flex; flex-direction: column; text-align: left; min-width: 0; }
.name { font-weight: 600; }
.name-cell:hover .name { color: var(--text-brand); }
.name-cell .tertiary { font-size: var(--text-xs); }
.link-quiet { color: var(--text-secondary); }
.link-quiet:hover { color: var(--text-brand); text-decoration: underline; }

.modal-backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: var(--space-4); background: rgb(0 0 0 / 45%); }
.modal { width: min(460px, 100%); box-shadow: var(--shadow-lg); }
.mini { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); margin: 0; }
.mini dt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.mini dd { margin: 0; font-size: var(--text-sm); font-weight: 650; font-variant-numeric: tabular-nums; }

.num { text-align: right; font-variant-numeric: tabular-nums; }
.strong { font-weight: 650; }
.pos { color: var(--ok-500); }
.neg { color: var(--danger-500); }
.warn { color: var(--warn-500); }
.nowrap { white-space: nowrap; }
.danger:hover { color: var(--danger-500); }

.pay-paid { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.pay-part_paid { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.pay-advance_due { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-500); }
.pay-unpaid { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }
.pay-overpaid { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); color: var(--text-brand); }

</style>
