<script setup lang="ts">
/**
 * One client, as a complete file.
 *
 * The whole point is that opening a client answers every question about them
 * without going anywhere else — what they use, what we did, what they owe,
 * what was said, what we noticed. So the dossier is read once as a subtree
 * and the tabs only decide what is shown, never fetch again.
 *
 * Profit and commission are computed from the ledger rather than stored as
 * separate figures somebody can edit. A number you can type over is a number
 * that will eventually disagree with the ones it came from.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { fetchClient } from '@/api/clients'
import {
  commissionFor,
  deleteWorkItem,
  dueStateOf,
  fetchDossier,
  removeFromClient,
  saveActivity,
  saveNote,
  saveWorkItem,
  totalsFor,
  yearsIn,
  type Dossier,
} from '@/api/clientDossier'
import { formatDate, formatRelative } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import {
  ACTIVITY_TYPES,
  PAYMENT_STATUSES,
  type ActivityType,
  type Client,
  type PaymentStatus,
  type WorkItem,
} from '@/types/business'
import {
  BASE_CURRENCY,
  CURRENCIES,
  formatMoney,
  fromMinor,
  makeMoney,
  type CurrencyCode,
} from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'

const route = useRoute()
const auth = useAuthStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const clientId = computed(() => String(route.params.id ?? ''))

const loading = ref(true)
const notFound = ref(false)
const client = ref<Client | null>(null)
const dossier = ref<Dossier | null>(null)

type Tab = 'overview' | 'work' | 'payments' | 'activity' | 'notes'
const tab = ref<Tab>('overview')

const canManage = computed(() => auth.hasPermission(PERMISSIONS.CLIENTS_MANAGE))
const canMoney = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_MANAGE))

/* ---- Figures -------------------------------------------------------- */

const yearFilter = ref<number | ''>('')

const visibleWork = computed(() => {
  const all = dossier.value?.work ?? []
  if (!yearFilter.value) return all
  return all.filter((item) => item.date.startsWith(String(yearFilter.value)))
})

const totals = computed(() => totalsFor(visibleWork.value))
const years = computed(() => yearsIn(dossier.value?.work ?? []))

const commission = computed(() => {
  const referral = client.value?.referral
  if (!referral || referral.source === 'direct') return 0
  return commissionFor(dossier.value?.work ?? [], referral)
})

/** The soonest unpaid instalment, which is what "next payment" means. */
const nextInstalment = computed(() =>
  (dossier.value?.instalments ?? [])
    .filter((i) => i.status !== 'paid')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0],
)

const pinnedNotes = computed(() => (dossier.value?.notes ?? []).filter((n) => n.pinned))

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

/* ---- Loading -------------------------------------------------------- */

async function load(): Promise<void> {
  if (!clientId.value) return
  loading.value = true
  notFound.value = false

  try {
    const [found, file] = await Promise.all([
      fetchClient(clientId.value),
      fetchDossier(clientId.value),
    ])
    if (!found) {
      notFound.value = true
      return
    }
    client.value = found
    dossier.value = file
  } catch {
    notFound.value = true
  } finally {
    loading.value = false
  }
}

/* ---- Work item editor ----------------------------------------------- */

interface WorkDraft {
  id: string
  date: string
  title: string
  serviceName: string
  costAmount: number
  revenueAmount: number
  currency: CurrencyCode
  rate: number
  dueDate: string
  paymentStatus: PaymentStatus
  note: string
}

const today = new Date().toISOString().slice(0, 10)
const workDraft = ref<WorkDraft | null>(null)
const savingWork = ref(false)
const pendingDelete = ref<WorkItem | null>(null)

function newWork(): void {
  workDraft.value = {
    id: '',
    date: today,
    title: '',
    serviceName: '',
    costAmount: 0,
    revenueAmount: 0,
    currency: BASE_CURRENCY,
    rate: 1,
    dueDate: '',
    paymentStatus: 'unpaid',
    note: '',
  }
}

function editWork(item: WorkItem): void {
  workDraft.value = {
    id: item.id,
    date: item.date,
    title: item.title,
    serviceName: item.serviceName ?? '',
    costAmount: fromMinor(item.cost.minor, item.cost.currency),
    revenueAmount: fromMinor(item.revenue.minor, item.revenue.currency),
    currency: item.revenue.currency,
    rate: item.revenue.rate,
    dueDate: item.dueDate ?? '',
    paymentStatus: item.paymentStatus,
    note: item.note ?? '',
  }
}

/** Shown live while typing, so the arithmetic is never a surprise on save. */
const draftProfit = computed(() => {
  const d = workDraft.value
  if (!d) return 0
  return Math.round((d.revenueAmount - d.costAmount) * 100 * d.rate)
})

async function commitWork(): Promise<void> {
  const d = workDraft.value
  if (!d || !client.value || savingWork.value) return
  if (!d.title.trim()) {
    ui.notify('danger', t('clients.nameRequired'))
    return
  }

  savingWork.value = true
  try {
    await saveWorkItem(client.value.id, client.value.name, {
      id: d.id,
      date: d.date,
      title: d.title,
      serviceId: null,
      serviceName: d.serviceName,
      cost: makeMoney(d.costAmount, d.currency, d.rate, d.date),
      revenue: makeMoney(d.revenueAmount, d.currency, d.rate, d.date),
      dueDate: d.dueDate || null,
      paymentStatus: d.paymentStatus,
      paidDate: null,
      note: d.note,
    })
    ui.notify('ok', t('dossier.saved'))
    workDraft.value = null
    await load()
  } catch {
    ui.notify('danger', t('dossier.saveFailed'))
  } finally {
    savingWork.value = false
  }
}

async function confirmDeleteWork(): Promise<void> {
  const item = pendingDelete.value
  if (!item || !client.value) return
  try {
    await deleteWorkItem(client.value.id, client.value.name, item.id, item.title)
    ui.notify('ok', t('dossier.deleted'))
    pendingDelete.value = null
    await load()
  } catch {
    ui.notify('danger', t('dossier.saveFailed'))
  }
}

/** One click from the row: mark an item settled without opening the editor. */
async function markPaid(item: WorkItem): Promise<void> {
  if (!client.value) return
  try {
    await saveWorkItem(client.value.id, client.value.name, {
      id: item.id,
      date: item.date,
      title: item.title,
      serviceId: item.serviceId,
      serviceName: item.serviceName,
      cost: item.cost,
      revenue: item.revenue,
      dueDate: item.dueDate,
      paymentStatus: 'paid',
      paidDate: today,
      note: item.note,
    })
    await load()
  } catch {
    ui.notify('danger', t('dossier.saveFailed'))
  }
}

/* ---- Activity and notes --------------------------------------------- */

const activityDraft = ref<{ date: string; type: ActivityType; title: string; detail: string } | null>(null)
const noteDraft = ref<{ content: string; pinned: boolean } | null>(null)

async function commitActivity(): Promise<void> {
  const d = activityDraft.value
  if (!d || !client.value || !d.title.trim()) return
  await saveActivity(client.value.id, { id: '', date: d.date, type: d.type, title: d.title, detail: d.detail })
  activityDraft.value = null
  await load()
}

async function commitNote(): Promise<void> {
  const d = noteDraft.value
  if (!d || !client.value || !d.content.trim()) return
  await saveNote(client.value.id, { id: '', content: d.content, pinned: d.pinned })
  noteDraft.value = null
  await load()
}

async function removeItem(sub: 'activities' | 'notes' | 'instalments' | 'services', id: string): Promise<void> {
  if (!client.value) return
  await removeFromClient(client.value.id, sub, id)
  await load()
}

onMounted(load)
watch(clientId, load)
</script>

<template>
  <div class="page">
    <RouterLink to="/clients" class="back">
      <AppIcon name="chevronRight" :size="15" class="back-icon" />
      {{ t('clients.title') }}
    </RouterLink>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div class="skeleton" style="height: 110px" />
        <div class="skeleton" style="height: 200px" />
      </div>
    </div>

    <div v-else-if="notFound || !client" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="search" :size="20" /></span>
        <p class="empty-title">{{ t('errors.notFound') }}</p>
        <RouterLink to="/clients" class="btn btn-secondary">{{ t('clients.title') }}</RouterLink>
      </div>
    </div>

    <template v-else>
      <!-- Header ------------------------------------------------------- -->
      <section class="card hero">
        <span class="hero-logo">
          <img v-if="client.logoUrl" :src="client.logoUrl" :alt="client.name" />
          <span v-else>{{ client.name.slice(0, 2).toUpperCase() }}</span>
        </span>

        <div class="hero-body">
          <h1 class="hero-name">{{ client.name }}</h1>
          <div class="hero-meta">
            <span class="badge" :class="`badge-${client.status}`">
              {{ t(`clientStatus.${client.status}`) }}
            </span>
            <span v-if="client.archived" class="badge badge-deactivated">
              {{ t('dossier.archived') }}
            </span>
            <span v-if="client.clientSince" class="tertiary">
              {{ t('dossier.clientSince', { date: formatDate(client.clientSince) }) }}
            </span>
          </div>

          <dl class="hero-facts">
            <div v-if="client.ownerName"><dt>{{ t('dossier.owner') }}</dt><dd>{{ client.ownerName }}</dd></div>
            <div v-if="client.managerName"><dt>{{ t('dossier.manager') }}</dt><dd>{{ client.managerName }}</dd></div>
            <div v-if="client.contactName"><dt>{{ t('clients.contactName') }}</dt><dd>{{ client.contactName }}</dd></div>
            <div v-if="client.phone"><dt>{{ t('register.phone') }}</dt><dd>{{ client.phone }}</dd></div>
            <div v-if="client.email"><dt>{{ t('auth.email') }}</dt><dd>{{ client.email }}</dd></div>
            <div v-if="client.website"><dt>{{ t('clients.website') }}</dt><dd>{{ client.website }}</dd></div>
          </dl>
        </div>

        <RouterLink v-if="canManage" :to="`/clients?edit=${client.id}`" class="btn btn-secondary hero-edit">
          {{ t('dossier.editInfo') }}
        </RouterLink>
      </section>

      <!-- Money summary ------------------------------------------------ -->
      <div v-if="dossier && !dossier.hiddenMoney" class="stat-row">
        <div class="card stat">
          <span class="stat-label">{{ t('dossier.totalRevenue') }}</span>
          <span class="stat-value">{{ money(totals.revenueMinor) }}</span>
        </div>
        <div class="card stat">
          <span class="stat-label">{{ t('dossier.totalCost') }}</span>
          <span class="stat-value">{{ money(totals.costMinor) }}</span>
        </div>
        <div class="card stat is-profit">
          <span class="stat-label">{{ t('dossier.totalProfit') }}</span>
          <span class="stat-value">{{ money(totals.profitMinor) }}</span>
        </div>
        <div class="card stat" :class="{ 'is-alert': totals.outstandingMinor > 0 }">
          <span class="stat-label">{{ t('dossier.outstanding') }}</span>
          <span class="stat-value">{{ money(totals.outstandingMinor) }}</span>
        </div>
      </div>

      <div v-else-if="dossier?.hiddenMoney" class="alert alert-info">
        <AppIcon name="lock" :size="16" />
        <span><strong>{{ t('dossier.moneyHidden') }}</strong> {{ t('dossier.moneyHiddenHint') }}</span>
      </div>

      <!-- Tabs --------------------------------------------------------- -->
      <div class="tabs" role="tablist">
        <button
          v-for="key in (['overview', 'work', 'payments', 'activity', 'notes'] as Tab[])"
          :key="key"
          type="button"
          role="tab"
          class="tab"
          :class="{ 'is-active': tab === key }"
          :aria-selected="tab === key"
          @click="tab = key"
        >
          {{ t(`dossier.tab${key.charAt(0).toUpperCase()}${key.slice(1)}`) }}
        </button>
      </div>

      <!-- Overview ----------------------------------------------------- -->
      <template v-if="tab === 'overview'">
        <div class="columns">
          <div class="column">
            <section v-if="client.referral && client.referral.source !== 'direct'" class="card">
              <div class="card-header"><h2 class="card-title">{{ t('dossier.referral') }}</h2></div>
              <div class="card-body">
                <dl class="rows">
                  <div><dt>{{ t('dossier.referrer') }}</dt><dd>{{ client.referral.referrerName || '—' }}</dd></div>
                  <div v-if="client.referral.percent">
                    <dt>{{ t('dossier.percent') }}</dt><dd>{{ client.referral.percent }}%</dd>
                  </div>
                  <div v-if="!dossier?.hiddenMoney">
                    <dt>{{ t('dossier.commissionOwed') }}</dt>
                    <dd class="strong">{{ money(commission) }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('table.status') }}</dt>
                    <dd>
                      <span class="badge" :class="client.referral.status === 'paid' ? 'badge-active' : 'badge-pending'">
                        {{ t(`paymentStatus.${client.referral.status}`) }}
                      </span>
                    </dd>
                  </div>
                </dl>
                <p class="field-hint commission-note">{{ t('dossier.commissionAuto') }}</p>
              </div>
            </section>

            <section v-if="client.notes" class="card">
              <div class="card-header"><h2 class="card-title">{{ t('clients.notes') }}</h2></div>
              <div class="card-body"><p class="prose">{{ client.notes }}</p></div>
            </section>

            <section v-if="pinnedNotes.length" class="card">
              <div class="card-header"><h2 class="card-title">{{ t('dossier.pinned') }}</h2></div>
              <ul class="plain">
                <li v-for="note in pinnedNotes" :key="note.id" class="line">
                  <AppIcon name="alert" :size="14" class="tertiary" />
                  <span>{{ note.content }}</span>
                </li>
              </ul>
            </section>
          </div>

          <div class="column column-side">
            <section v-if="nextInstalment" class="card">
              <div class="card-header"><h2 class="card-title">{{ t('dossier.nextPayment') }}</h2></div>
              <div class="card-body">
                <p class="next-amount">{{ money(nextInstalment.amount.baseMinor) }}</p>
                <p class="tertiary">{{ formatDate(nextInstalment.dueDate) }}</p>
              </div>
            </section>

            <section class="card">
              <div class="card-header"><h2 class="card-title">{{ t('dossier.activity') }}</h2></div>
              <ul v-if="dossier?.activities.length" class="plain">
                <li v-for="a in dossier.activities.slice(0, 5)" :key="a.id" class="line">
                  <span class="dot" />
                  <span class="line-body">
                    <span>{{ a.title }}</span>
                    <span class="tertiary small">
                      {{ t(`activityType.${a.type}`) }} · {{ formatRelative(a.date) }}
                    </span>
                  </span>
                </li>
              </ul>
              <div v-else class="card-body"><p class="muted">{{ t('dossier.noActivity') }}</p></div>
            </section>
          </div>
        </div>
      </template>

      <!-- Work ledger -------------------------------------------------- -->
      <template v-else-if="tab === 'work'">
        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">{{ t('dossier.work') }}</h2>
              <p class="field-hint">{{ t('dossier.workHint') }}</p>
            </div>
            <div class="row">
              <select v-if="years.length" v-model="yearFilter" class="select year-select">
                <option value="">{{ t('dossier.allYears') }}</option>
                <option v-for="year in years" :key="year" :value="year">{{ year }}</option>
              </select>
              <button v-if="canMoney && !workDraft" class="btn btn-primary btn-sm" @click="newWork">
                <AppIcon name="plus" :size="15" /> {{ t('dossier.addWork') }}
              </button>
            </div>
          </div>

          <!-- Editor -->
          <div v-if="workDraft" class="card-body draft">
            <div class="field-grid">
              <div class="field">
                <label class="field-label" for="w-date">{{ t('table.submitted') }}</label>
                <input id="w-date" v-model="workDraft.date" class="input" type="date" />
              </div>
              <div class="field">
                <label class="field-label" for="w-title">{{ t('dossier.itemTitle') }}<span class="req">*</span></label>
                <input id="w-title" v-model="workDraft.title" class="input" :maxlength="LIMITS.position" />
              </div>
              <div class="field">
                <label class="field-label" for="w-service">{{ t('dossier.serviceName') }}</label>
                <input id="w-service" v-model="workDraft.serviceName" class="input" :maxlength="LIMITS.position" />
              </div>
            </div>

            <div class="field-grid">
              <div class="field">
                <label class="field-label" for="w-cur">{{ t('accountType.label') }}</label>
                <select id="w-cur" v-model="workDraft.currency" class="select">
                  <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
                </select>
              </div>
              <div v-if="workDraft.currency !== BASE_CURRENCY" class="field">
                <label class="field-label" for="w-rate">Kurs</label>
                <input id="w-rate" v-model.number="workDraft.rate" class="input" type="number" step="0.0001" />
              </div>
              <div class="field">
                <label class="field-label" for="w-cost">{{ t('dossier.cost') }}</label>
                <input id="w-cost" v-model.number="workDraft.costAmount" class="input" type="number" step="0.01" />
              </div>
              <div class="field">
                <label class="field-label" for="w-rev">{{ t('dossier.revenue') }}</label>
                <input id="w-rev" v-model.number="workDraft.revenueAmount" class="input" type="number" step="0.01" />
              </div>
              <div class="field">
                <span class="field-label">{{ t('dossier.profit') }}</span>
                <p class="computed" :class="{ 'is-negative': draftProfit < 0 }">{{ money(draftProfit) }}</p>
              </div>
            </div>

            <div class="field-grid">
              <div class="field">
                <label class="field-label" for="w-due">{{ t('dossier.due') }}</label>
                <input id="w-due" v-model="workDraft.dueDate" class="input" type="date" />
              </div>
              <div class="field">
                <label class="field-label" for="w-status">{{ t('table.status') }}</label>
                <select id="w-status" v-model="workDraft.paymentStatus" class="select">
                  <option v-for="s in PAYMENT_STATUSES" :key="s" :value="s">{{ t(`paymentStatus.${s}`) }}</option>
                </select>
              </div>
              <div class="field">
                <label class="field-label" for="w-note">{{ t('clients.notes') }}</label>
                <input id="w-note" v-model="workDraft.note" class="input" :maxlength="LIMITS.shortText" />
              </div>
            </div>

            <div class="row draft-actions">
              <button class="btn btn-secondary btn-sm" @click="workDraft = null">{{ t('common.cancel') }}</button>
              <button class="btn btn-primary btn-sm" :disabled="savingWork" @click="commitWork">
                <span v-if="savingWork" class="spinner" />{{ t('common.save') }}
              </button>
            </div>
          </div>

          <div v-if="visibleWork.length === 0 && !workDraft" class="empty">
            <span class="empty-icon"><AppIcon name="trending" :size="20" /></span>
            <p class="empty-title">{{ t('dossier.noWork') }}</p>
            <p class="empty-text">{{ t('dossier.noWorkHint') }}</p>
          </div>

          <div v-else-if="visibleWork.length" class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ t('table.submitted') }}</th>
                  <th>{{ t('dossier.itemTitle') }}</th>
                  <th>{{ t('dossier.cost') }}</th>
                  <th>{{ t('dossier.revenue') }}</th>
                  <th>{{ t('dossier.profit') }}</th>
                  <th>{{ t('dossier.due') }}</th>
                  <th class="col-actions" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in visibleWork" :key="item.id">
                  <td class="muted nowrap">{{ formatDate(item.date) }}</td>
                  <td>
                    <div class="stacked">
                      <span class="strong">{{ item.title }}</span>
                      <span v-if="item.serviceName" class="tertiary small">{{ item.serviceName }}</span>
                      <span v-if="item.note" class="tertiary small">{{ item.note }}</span>
                    </div>
                  </td>
                  <td class="muted nowrap">{{ money(item.cost.baseMinor) }}</td>
                  <td class="nowrap">{{ money(item.revenue.baseMinor) }}</td>
                  <td class="nowrap strong" :class="{ 'is-negative': item.profitBaseMinor < 0 }">
                    {{ money(item.profitBaseMinor) }}
                  </td>
                  <td>
                    <span class="badge badge-plain" :class="`due-${dueStateOf(item.dueDate, item.paymentStatus)}`">
                      {{ t(`due.${dueStateOf(item.dueDate, item.paymentStatus)}`) }}
                    </span>
                    <div v-if="item.dueDate && item.paymentStatus !== 'paid'" class="tertiary small">
                      {{ formatDate(item.dueDate) }}
                    </div>
                  </td>
                  <td class="col-actions">
                    <button
                      v-if="canMoney && item.paymentStatus !== 'paid'"
                      class="btn btn-ghost btn-sm"
                      @click="markPaid(item)"
                    >
                      <AppIcon name="check" :size="14" />
                    </button>
                    <button v-if="canMoney" class="btn btn-ghost btn-sm" @click="editWork(item)">
                      {{ t('common.edit') }}
                    </button>
                    <button v-if="canMoney" class="btn btn-ghost btn-sm danger" @click="pendingDelete = item">
                      <AppIcon name="close" :size="14" />
                    </button>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr class="totals">
                  <td colspan="2">{{ t('common.results', totals.itemCount, { named: { n: totals.itemCount } }) }}</td>
                  <td class="nowrap">{{ money(totals.costMinor) }}</td>
                  <td class="nowrap">{{ money(totals.revenueMinor) }}</td>
                  <td class="nowrap strong">{{ money(totals.profitMinor) }}</td>
                  <td colspan="2" />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </template>

      <!-- Payments ----------------------------------------------------- -->
      <template v-else-if="tab === 'payments'">
        <section class="card">
          <div class="card-header"><h2 class="card-title">{{ t('dossier.terms') }}</h2></div>
          <div class="card-body">
            <dl class="rows">
              <div>
                <dt>{{ t('dossier.paymentTerm') }}</dt>
                <dd>{{ t(`paymentTerm.${client.paymentTerm ?? 'one_off'}`) }}</dd>
              </div>
              <div v-if="client.agreedAmount">
                <dt>{{ t('dossier.agreedAmount') }}</dt>
                <dd class="strong">{{ money(client.agreedAmount.baseMinor) }}</dd>
              </div>
              <div v-if="client.nextChargeDate">
                <dt>{{ t('dossier.nextCharge') }}</dt>
                <dd>{{ formatDate(client.nextChargeDate) }}</dd>
              </div>
              <div v-if="client.paymentNote">
                <dt>{{ t('dossier.paymentNote') }}</dt><dd>{{ client.paymentNote }}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section class="card">
          <div class="card-header"><h2 class="card-title">{{ t('dossier.instalments') }}</h2></div>

          <div v-if="!dossier?.instalments.length" class="empty">
            <span class="empty-icon"><AppIcon name="wallet" :size="20" /></span>
            <p class="empty-title">{{ t('dossier.noInstalments') }}</p>
            <p class="empty-text">{{ t('dossier.noInstalmentsHint') }}</p>
          </div>

          <div v-else class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ t('dossier.instalment') }}</th>
                  <th>{{ t('dossier.revenue') }}</th>
                  <th>{{ t('dossier.due') }}</th>
                  <th>{{ t('table.status') }}</th>
                  <th class="col-actions" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="i in dossier.instalments" :key="i.id">
                  <td class="nowrap">{{ t('dossier.ofTotal', { n: i.sequence, total: i.total }) }}</td>
                  <td class="nowrap">{{ money(i.amount.baseMinor) }}</td>
                  <td class="muted nowrap">{{ formatDate(i.dueDate) }}</td>
                  <td>
                    <span class="badge badge-plain" :class="`due-${dueStateOf(i.dueDate, i.status)}`">
                      {{ t(`paymentStatus.${i.status}`) }}
                    </span>
                  </td>
                  <td class="col-actions">
                    <button v-if="canMoney" class="btn btn-ghost btn-sm danger" @click="removeItem('instalments', i.id)">
                      <AppIcon name="close" :size="14" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <!-- Activity ----------------------------------------------------- -->
      <template v-else-if="tab === 'activity'">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('dossier.activity') }}</h2>
            <button
              v-if="canManage && !activityDraft"
              class="btn btn-primary btn-sm"
              @click="activityDraft = { date: today, type: 'call', title: '', detail: '' }"
            >
              <AppIcon name="plus" :size="15" /> {{ t('dossier.addActivity') }}
            </button>
          </div>

          <div v-if="activityDraft" class="card-body draft">
            <div class="field-grid">
              <div class="field">
                <label class="field-label" for="a-date">{{ t('table.submitted') }}</label>
                <input id="a-date" v-model="activityDraft.date" class="input" type="date" />
              </div>
              <div class="field">
                <label class="field-label" for="a-type">{{ t('audit.action') }}</label>
                <select id="a-type" v-model="activityDraft.type" class="select">
                  <option v-for="ty in ACTIVITY_TYPES" :key="ty" :value="ty">{{ t(`activityType.${ty}`) }}</option>
                </select>
              </div>
              <div class="field">
                <label class="field-label" for="a-title">{{ t('dossier.itemTitle') }}</label>
                <input id="a-title" v-model="activityDraft.title" class="input" :maxlength="LIMITS.position" />
              </div>
            </div>
            <div class="field">
              <label class="field-label" for="a-detail">{{ t('dossier.paymentNote') }}</label>
              <textarea id="a-detail" v-model="activityDraft.detail" class="textarea" :maxlength="LIMITS.longText" />
            </div>
            <div class="row draft-actions">
              <button class="btn btn-secondary btn-sm" @click="activityDraft = null">{{ t('common.cancel') }}</button>
              <button class="btn btn-primary btn-sm" @click="commitActivity">{{ t('common.save') }}</button>
            </div>
          </div>

          <div v-if="!dossier?.activities.length && !activityDraft" class="empty">
            <span class="empty-icon"><AppIcon name="history" :size="20" /></span>
            <p class="empty-title">{{ t('dossier.noActivity') }}</p>
            <p class="empty-text">{{ t('dossier.noActivityHint') }}</p>
          </div>

          <ul v-else-if="dossier?.activities.length" class="plain timeline">
            <li v-for="a in dossier.activities" :key="a.id" class="line">
              <span class="dot" />
              <span class="line-body">
                <span class="strong">{{ a.title }}</span>
                <span v-if="a.detail" class="tertiary">{{ a.detail }}</span>
                <span class="tertiary small">
                  {{ t(`activityType.${a.type}`) }} · {{ formatDate(a.date) }} · {{ a.createdByName }}
                </span>
              </span>
              <button v-if="canManage" class="btn btn-ghost btn-sm danger" @click="removeItem('activities', a.id)">
                <AppIcon name="close" :size="14" />
              </button>
            </li>
          </ul>
        </section>
      </template>

      <!-- Notes -------------------------------------------------------- -->
      <template v-else>
        <section class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">{{ t('dossier.notes') }}</h2>
              <p class="field-hint">{{ t('dossier.notesHint') }}</p>
            </div>
            <button
              v-if="canManage && !noteDraft"
              class="btn btn-primary btn-sm"
              @click="noteDraft = { content: '', pinned: false }"
            >
              <AppIcon name="plus" :size="15" /> {{ t('dossier.addNote') }}
            </button>
          </div>

          <div v-if="noteDraft" class="card-body draft">
            <div class="field">
              <textarea v-model="noteDraft.content" class="textarea" :maxlength="LIMITS.note" />
            </div>
            <label class="check">
              <input v-model="noteDraft.pinned" type="checkbox" />
              <span class="check-text">{{ t('dossier.pin') }}</span>
            </label>
            <div class="row draft-actions">
              <button class="btn btn-secondary btn-sm" @click="noteDraft = null">{{ t('common.cancel') }}</button>
              <button class="btn btn-primary btn-sm" @click="commitNote">{{ t('common.save') }}</button>
            </div>
          </div>

          <div v-if="!dossier?.notes.length && !noteDraft" class="empty">
            <span class="empty-icon"><AppIcon name="scroll" :size="20" /></span>
            <p class="empty-title">{{ t('dossier.noNotes') }}</p>
          </div>

          <ul v-else-if="dossier?.notes.length" class="plain">
            <li v-for="n in dossier.notes" :key="n.id" class="line">
              <AppIcon :name="n.pinned ? 'alert' : 'scroll'" :size="14" class="tertiary" />
              <span class="line-body">
                <span>{{ n.content }}</span>
                <span class="tertiary small">{{ n.createdByName }} · {{ formatRelative(n.createdAt) }}</span>
              </span>
              <button v-if="canManage" class="btn btn-ghost btn-sm danger" @click="removeItem('notes', n.id)">
                <AppIcon name="close" :size="14" />
              </button>
            </li>
          </ul>
        </section>
      </template>

      <ConfirmDialog
        :open="pendingDelete !== null"
        :title="t('dossier.deleteWork')"
        :message="t('dossier.deleteWorkText')"
        danger
        @confirm="confirmDeleteWork"
        @cancel="pendingDelete = null"
      />
    </template>
  </div>
</template>

<style scoped>
.back {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  align-self: flex-start;
}
.back:hover { color: var(--text-primary); text-decoration: none; }
.back-icon { transform: rotate(180deg); }

.hero {
  display: flex;
  gap: var(--space-6);
  padding: var(--space-6);
  flex-wrap: wrap;
  align-items: flex-start;
}

.hero-logo {
  display: grid;
  place-items: center;
  width: 88px;
  height: 88px;
  border-radius: var(--radius-lg);
  background: var(--accent-soft-bg);
  border: 1px solid var(--accent-soft-border);
  color: var(--text-brand);
  font-size: var(--text-2xl);
  font-weight: 700;
  overflow: hidden;
  flex-shrink: 0;
}
.hero-logo img { width: 100%; height: 100%; object-fit: contain; }

.hero-body { flex: 1; min-width: 240px; }
.hero-name { font-size: var(--text-2xl); font-weight: 650; letter-spacing: -0.02em; }
.hero-meta { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; margin-top: var(--space-2); font-size: var(--text-sm); }

.hero-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-4);
  margin-top: var(--space-5);
}
.hero-facts dt { font-size: var(--text-xs); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-tertiary); }
.hero-facts dd { margin: 2px 0 0; font-size: var(--text-base); overflow-wrap: anywhere; }
.hero-edit { align-self: flex-start; }

.stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--space-4); }
.stat { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-5); }
.stat-label { font-size: var(--text-xs); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-tertiary); }
.stat-value { font-size: var(--text-xl); font-weight: 650; letter-spacing: -0.02em; }
.stat.is-profit .stat-value { color: var(--ok-500); }
.stat.is-alert { border-color: var(--warn-border); background: var(--warn-bg); }
.stat.is-alert .stat-value { color: var(--warn-500); }

.tabs { display: flex; gap: var(--space-1); border-bottom: 1px solid var(--border-subtle); overflow-x: auto; }
.tab { padding: var(--space-3) var(--space-4); border-bottom: 2px solid transparent; font-size: var(--text-base); font-weight: 550; color: var(--text-secondary); white-space: nowrap; }
.tab:hover { color: var(--text-primary); }
.tab.is-active { color: var(--text-brand); border-bottom-color: var(--accent); }

.columns { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: var(--space-6); align-items: start; }
.column { display: flex; flex-direction: column; gap: var(--space-6); min-width: 0; }

.rows { display: flex; flex-direction: column; gap: var(--space-4); }
.rows dt { font-size: var(--text-xs); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-tertiary); }
.rows dd { margin: 2px 0 0; }

.plain { list-style: none; padding: 0; margin: 0; }
.line { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-3) var(--space-5); border-bottom: 1px solid var(--border-subtle); }
.line:last-child { border-bottom: none; }
.line-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dot { width: 7px; height: 7px; border-radius: var(--radius-full); background: var(--accent); flex-shrink: 0; margin-top: 6px; }

.draft { display: flex; flex-direction: column; gap: var(--space-4); background: var(--bg-surface-2); border-bottom: 1px solid var(--border-subtle); }
.draft-actions { justify-content: flex-end; }
.year-select { width: auto; }

.computed { height: 38px; display: flex; align-items: center; font-weight: 650; color: var(--ok-500); }
.computed.is-negative, .is-negative { color: var(--danger-500); }

.totals td { background: var(--bg-surface-2); font-weight: 600; border-top: 1px solid var(--border-default); }
.nowrap { white-space: nowrap; }
.strong { font-weight: 600; }
.stacked { display: flex; flex-direction: column; }
.small { font-size: var(--text-xs); }
.prose { line-height: var(--leading-relaxed); color: var(--text-secondary); white-space: pre-wrap; }
.next-amount { font-size: var(--text-xl); font-weight: 650; }
.commission-note { margin-top: var(--space-4); }
.danger:hover { color: var(--danger-500); }

.due-overdue { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-500); }
.due-today { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.due-soon { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.due-paid { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }

.badge-prospect { background: var(--info-bg); border-color: var(--info-border); color: var(--info-500); }
.badge-paused { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.badge-former { background: var(--neutral-bg); border-color: var(--neutral-border); color: var(--neutral-500); }

@media (max-width: 900px) {
  .columns { grid-template-columns: 1fr; }
}
</style>
