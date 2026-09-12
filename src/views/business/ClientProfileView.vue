<script setup lang="ts">
/**
 * One client, and everything MsEe has ever done with them.
 *
 * The page is the answer to "where do I look?" — sales, money, projects,
 * notes and history all read onto one screen rather than living on four. None
 * of it is stored here: each section reads its own records, so the client
 * document stays small and nothing on this page can disagree with the module
 * it came from.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import NotesPanel from '@/components/NotesPanel.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { fetchClient } from '@/api/clients'
import { fetchProjectsFor, fetchServices } from '@/api/operations'
import { fetchSalesFor } from '@/api/sales'
import { fetchTransactionsFor } from '@/api/finance'
import { fetchActivityFor, fetchFieldDefs, fieldsFor } from '@/api/records'
import { formatDate, formatRelative } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import type { Client, Project, Service } from '@/types/business'
import { INCOME_TYPES, OUTGOING_TYPES, balanceOf, type Sale, type Transaction } from '@/types/revenue'
import { BASE_CURRENCY, formatMoney } from '@/types/money'
import type { ActivityEntry, CustomFieldDef } from '@/types/records'
import { PERMISSIONS } from '@/types/permissions'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()

const clientId = computed(() => String(route.params.id ?? ''))

const loading = ref(true)
const notFound = ref(false)

const client = ref<Client | null>(null)
const sales = ref<Sale[]>([])
const transactions = ref<Transaction[]>([])
const projects = ref<Project[]>([])
const services = ref<Service[]>([])
const activity = ref<ActivityEntry[]>([])
const fieldDefs = ref<CustomFieldDef[]>([])

type Tab = 'overview' | 'sales' | 'finance' | 'projects' | 'activity'
const tab = ref<Tab>('overview')

const canMoney = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_VIEW))
const canEdit = computed(() => auth.hasPermission(PERMISSIONS.CLIENTS_EDIT))
const canSeeManagement = computed(() => auth.hasPermission(PERMISSIONS.EMPLOYEES_VIEW_PRIVATE_INFO))

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

const serviceNames = computed(() => new Map(services.value.map((s) => [s.id, s.name])))

const balances = computed(() => new Map(sales.value.map((s) => [s.id, balanceOf(s, transactions.value)])))

/**
 * Sold, collected and outstanding — three figures, not one.
 *
 * A single "balance" would hide which of them is the problem: work not sold,
 * or bills not paid.
 */
const totals = computed(() => {
  const rows = [...balances.value.values()]
  const paid = transactions.value.filter((tx) => tx.status === 'paid')

  return {
    sold: rows.reduce((n, b) => n + b.valueBaseMinor, 0),
    collected: paid
      .filter((tx) => INCOME_TYPES.includes(tx.type))
      .reduce((n, tx) => n + tx.amount.baseMinor, 0),
    outstanding: rows.reduce((n, b) => n + b.remainingBaseMinor, 0),
    spent: paid
      .filter((tx) => OUTGOING_TYPES.includes(tx.type))
      .reduce((n, tx) => n + tx.amount.baseMinor, 0),
    advanceDue: rows.filter((b) => b.advanceDue).length,
  }
})

const customValues = computed(() => {
  const defs = fieldsFor(fieldDefs.value, 'client')
  const values = client.value?.custom ?? {}

  return defs
    .filter((f) => f.visibility !== 'management' || canSeeManagement.value)
    .map((f) => ({ field: f, value: values[f.key] }))
    .filter((row) => row.value !== undefined && row.value !== null && row.value !== '')
})

function displayValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? t('common.yes') : t('common.no')
  return String(value)
}

async function load(): Promise<void> {
  if (!clientId.value) return
  loading.value = true
  notFound.value = false

  try {
    const [found, sl, tx, pr, sv, act, defs] = await Promise.all([
      fetchClient(clientId.value),
      fetchSalesFor(clientId.value).catch(() => []),
      fetchTransactionsFor(clientId.value).catch(() => []),
      fetchProjectsFor(clientId.value).catch(() => []),
      fetchServices().catch(() => []),
      fetchActivityFor('clients', clientId.value).catch(() => []),
      fetchFieldDefs().catch(() => []),
    ])

    if (!found || found.deletedAt) {
      notFound.value = true
      return
    }

    client.value = found
    sales.value = sl.sort((a, b) => b.saleDate.localeCompare(a.saleDate))
    transactions.value = tx.sort((a, b) => b.date.localeCompare(a.date))
    projects.value = pr
    services.value = sv
    activity.value = act
    fieldDefs.value = defs
  } catch {
    notFound.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(clientId, load)
</script>

<template>
  <div class="page">
    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 60px" />
      </div>
    </div>

    <div v-else-if="notFound || !client" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="alert" :size="20" /></span>
        <p class="empty-title">{{ t('clients.notFound') }}</p>
        <button class="btn btn-secondary" @click="router.push('/clients')">
          {{ t('clients.title') }}
        </button>
      </div>
    </div>

    <template v-else>
      <!-- Header ------------------------------------------------------- -->
      <header class="profile-head card">
        <UserAvatar :name="client.name" :photo-url="client.logoUrl" :size="56" />

        <div class="head-text">
          <h1 class="page-title">{{ client.name }}</h1>
          <p class="page-subtitle">{{ client.description || client.industry || '—' }}</p>
          <div class="head-meta">
            <span class="badge" :class="`cs-${client.status}`">
              {{ t(`clientStatus.${client.status}`) }}
            </span>
            <span v-if="client.archived" class="badge badge-plain">{{ t('clients.archived') }}</span>
            <span v-if="client.clientSince" class="tertiary">
              {{ t('clients.since') }}: {{ formatDate(client.clientSince) }}
            </span>
            <span v-if="client.responsibleName" class="tertiary">
              · {{ client.responsibleName }}
            </span>
          </div>
        </div>

        <div class="head-actions">
          <a v-if="client.phone" class="btn btn-secondary btn-sm" :href="`tel:${client.phone}`">
            <AppIcon name="clock" :size="15" /> {{ client.phone }}
          </a>
          <a v-if="client.email" class="btn btn-secondary btn-sm" :href="`mailto:${client.email}`">
            <AppIcon name="inbox" :size="15" /> {{ t('clients.email') }}
          </a>
          <button v-if="canEdit" class="btn btn-secondary btn-sm" @click="router.push('/clients')">
            <AppIcon name="edit" :size="15" /> {{ t('common.edit') }}
          </button>
        </div>
      </header>

      <!-- Money at a glance -------------------------------------------- -->
      <div v-if="canMoney" class="figures">
        <article class="card figure">
          <span class="figure-label">{{ t('sales.sold') }}</span>
          <span class="figure-value">{{ money(totals.sold) }}</span>
        </article>
        <article class="card figure">
          <span class="figure-label">{{ t('finance.collected') }}</span>
          <span class="figure-value pos">{{ money(totals.collected) }}</span>
        </article>
        <article class="card figure">
          <span class="figure-label">{{ t('finance.outstanding') }}</span>
          <span class="figure-value" :class="{ neg: totals.outstanding > 0 }">
            {{ money(totals.outstanding) }}
          </span>
        </article>
        <article class="card figure">
          <span class="figure-label">{{ t('sales.advanceDue') }}</span>
          <span class="figure-value" :class="{ warn: totals.advanceDue > 0 }">
            {{ totals.advanceDue }}
          </span>
        </article>
      </div>

      <!-- Tabs --------------------------------------------------------- -->
      <div class="tabs" role="tablist">
        <button
          v-for="key in (['overview', 'sales', 'finance', 'projects', 'activity'] as Tab[])"
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
          <section class="card">
            <div class="card-header">
              <h2 class="card-title">{{ t('dossier.basics') }}</h2>
            </div>
            <div class="card-body">
              <dl class="rows">
                <div v-if="client.contactName" class="row-item">
                  <dt>{{ t('clients.contactName') }}</dt>
                  <dd>{{ client.contactName }}</dd>
                </div>
                <div v-if="client.email" class="row-item">
                  <dt>{{ t('clients.email') }}</dt>
                  <dd><a :href="`mailto:${client.email}`" class="link">{{ client.email }}</a></dd>
                </div>
                <div v-if="client.phone" class="row-item">
                  <dt>{{ t('clients.phone') }}</dt>
                  <dd><a :href="`tel:${client.phone}`" class="link">{{ client.phone }}</a></dd>
                </div>
                <div v-if="client.website" class="row-item">
                  <dt>{{ t('clients.website') }}</dt>
                  <dd>
                    <a :href="client.website" target="_blank" rel="noopener noreferrer" class="link">
                      {{ client.website }}
                    </a>
                  </dd>
                </div>
                <div v-if="client.city || client.country" class="row-item">
                  <dt>{{ t('clients.location') }}</dt>
                  <dd>{{ [client.city, client.country].filter(Boolean).join(', ') }}</dd>
                </div>
                <div v-if="client.address" class="row-item">
                  <dt>{{ t('clients.address') }}</dt>
                  <dd>{{ client.address }}</dd>
                </div>
                <div v-if="client.ownerName" class="row-item">
                  <dt>{{ t('clients.ownerName') }}</dt>
                  <dd>{{ client.ownerName }}</dd>
                </div>
                <div v-if="client.instagram" class="row-item">
                  <dt>{{ t('clients.instagram') }}</dt>
                  <dd>{{ client.instagram }}</dd>
                </div>
                <div v-if="client.referral.source !== 'direct'" class="row-item">
                  <dt>{{ t('clients.referral') }}</dt>
                  <dd>
                    {{ t(`source.${client.referral.source}`) }}
                    <span v-if="client.referral.referrerName" class="tertiary">
                      · {{ client.referral.referrerName }}
                    </span>
                  </dd>
                </div>

                <div v-for="row in customValues" :key="row.field.id" class="row-item">
                  <dt>{{ row.field.label }}</dt>
                  <dd>{{ displayValue(row.value) }}</dd>
                </div>
              </dl>

              <div v-if="(client.tags ?? []).length" class="chips">
                <span v-for="tag in client.tags" :key="tag" class="badge badge-plain">{{ tag }}</span>
              </div>

              <p v-if="client.notes" class="prose">{{ client.notes }}</p>
            </div>
          </section>

          <div class="column">
            <section v-if="(client.serviceIds ?? []).length" class="card">
              <div class="card-header">
                <h2 class="card-title">{{ t('clients.services') }}</h2>
              </div>
              <ul class="linked">
                <li v-for="id in client.serviceIds" :key="id">
                  <span class="linked-main">{{ serviceNames.get(id) ?? id }}</span>
                </li>
              </ul>
            </section>

            <NotesPanel entity="client" :entity-id="client.id" />
          </div>
        </div>
      </template>

      <!-- Sales -------------------------------------------------------- -->
      <template v-else-if="tab === 'sales'">
        <div v-if="sales.length === 0" class="card">
          <div class="empty">
            <span class="empty-icon"><AppIcon name="trending" :size="20" /></span>
            <p class="empty-title">{{ t('sales.empty') }}</p>
            <p class="empty-text">{{ t('sales.emptyHint') }}</p>
            <button class="btn btn-primary" @click="router.push('/sales')">
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
                  <th class="hide-sm">{{ t('table.service') }}</th>
                  <th class="hide-sm">{{ t('sales.saleDate') }}</th>
                  <th class="num">{{ t('table.value') }}</th>
                  <th class="num hide-sm">{{ t('finance.collected') }}</th>
                  <th>{{ t('table.status') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="sale in sales" :key="sale.id">
                  <td>
                    <button type="button" class="link" @click="router.push('/sales')">
                      {{ sale.title }}
                    </button>
                  </td>
                  <td :data-label="t('table.service')" class="hide-sm muted">{{ sale.serviceName || '—' }}</td>
                  <td :data-label="t('sales.saleDate')" class="hide-sm muted nowrap">{{ formatDate(sale.saleDate) }}</td>
                  <td :data-label="t('table.value')" class="num strong">{{ money(sale.value.baseMinor) }}</td>
                  <td :data-label="t('finance.collected')" class="num hide-sm pos">
                    {{ money(balances.get(sale.id)?.paidBaseMinor ?? 0) }}
                  </td>
                  <td :data-label="t('table.status')">
                    <span class="badge" :class="`pay-${balances.get(sale.id)?.status}`">
                      {{ t(`payStatus.${balances.get(sale.id)?.status}`) }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <!-- Finance ------------------------------------------------------ -->
      <template v-else-if="tab === 'finance'">
        <!--
          What we brought this client, and what our share of it is. On the
          client because that is what the figures are about: nobody wants a
          list of everybody's turnover, they want to open one hotel.
        -->
        <ClientTradingPanel v-if="canMoney && client" :client="client" />

        <div v-if="!canMoney" class="card">
          <div class="empty">
            <span class="empty-icon"><AppIcon name="lock" :size="20" /></span>
            <p class="empty-title">{{ t('dossier.moneyHidden') }}</p>
            <p class="empty-text">{{ t('dossier.moneyHiddenHint') }}</p>
          </div>
        </div>

        <div v-else-if="transactions.length === 0" class="card">
          <div class="empty">
            <span class="empty-icon"><AppIcon name="wallet" :size="20" /></span>
            <p class="empty-title">{{ t('finance.empty') }}</p>
            <p class="empty-text">{{ t('finance.emptyHint') }}</p>
          </div>
        </div>

        <section v-else class="card">
          <div class="table-wrap">
            <table class="table table-cards">
              <thead>
                <tr>
                  <th>{{ t('finance.date') }}</th>
                  <th>{{ t('finance.description') }}</th>
                  <th class="hide-sm">{{ t('finance.type') }}</th>
                  <th>{{ t('table.status') }}</th>
                  <th class="num">{{ t('table.amount') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="tx in transactions" :key="tx.id">
                  <td class="muted nowrap">{{ formatDate(tx.date) }}</td>
                  <td :data-label="t('finance.description')">{{ tx.description }}</td>
                  <td :data-label="t('finance.type')" class="hide-sm">
                    <span class="badge badge-plain">{{ t(`transactionType.${tx.type}`) }}</span>
                  </td>
                  <td :data-label="t('table.status')">
                    <span class="badge" :class="`ps-${tx.status}`">
                      {{ t(`payState.${tx.status}`) }}
                    </span>
                  </td>
                  <td :data-label="t('table.amount')"
                    class="num strong"
                    :class="INCOME_TYPES.includes(tx.type) ? 'pos' : 'neg'"
                  >
                    {{ money(tx.amount.baseMinor) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <!-- Projects ----------------------------------------------------- -->
      <template v-else-if="tab === 'projects'">
        <div v-if="projects.length === 0" class="card">
          <div class="empty">
            <span class="empty-icon"><AppIcon name="layers" :size="20" /></span>
            <p class="empty-title">{{ t('projects.empty') }}</p>
            <p class="empty-text">{{ t('projects.emptyHint') }}</p>
          </div>
        </div>

        <div v-else class="grid">
          <button
            v-for="project in projects"
            :key="project.id"
            type="button"
            class="card project"
            @click="router.push(`/projects/${project.id}`)"
          >
            <span class="project-head">
              <span class="project-name">{{ project.name }}</span>
              <span class="badge" :class="`ps-${project.status}`">
                {{ t(`projectStatus.${project.status}`) }}
              </span>
            </span>
            <span v-if="project.objective" class="muted">{{ project.objective }}</span>
            <span class="tertiary small">
              <template v-if="project.endDate">{{ formatDate(project.endDate) }}</template>
              <template v-if="project.ownerName"> · {{ project.ownerName }}</template>
            </span>
          </button>
        </div>
      </template>

      <!-- Activity ----------------------------------------------------- -->
      <template v-else>
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('activity.title') }}</h2>
          </div>

          <p v-if="activity.length === 0" class="card-body tertiary small">
            {{ t('activity.empty') }}
          </p>

          <ul v-else class="feed">
            <li v-for="entry in activity" :key="entry.id">
              <UserAvatar :name="entry.actorName" :size="28" />
              <span class="feed-body">
                <span class="feed-text">
                  <strong>{{ entry.actorName }}</strong>
                  · {{ t(`activityKind.${entry.kind}`) }}
                  <span class="tertiary">{{ entry.summary }}</span>
                </span>
                <span class="feed-time tertiary">{{ formatRelative(entry.createdAt) }}</span>
              </span>
            </li>
          </ul>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.profile-head { display: flex; align-items: center; gap: var(--space-4); padding: var(--space-5); flex-wrap: wrap; }
.head-text { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: var(--space-1); }
.head-meta { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; font-size: var(--text-xs); }
.head-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }

.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--space-3); }
.figure { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4); }
.figure-label { font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.figure-value { font-size: var(--text-lg); font-weight: 700; font-variant-numeric: tabular-nums; }

.tabs { display: flex; gap: var(--space-1); border-bottom: 1px solid var(--border-subtle); overflow-x: auto; }
.tab { padding: var(--space-3) var(--space-4); border-bottom: 2px solid transparent; font-size: var(--text-base); font-weight: 550; color: var(--text-secondary); white-space: nowrap; }
.tab:hover { color: var(--text-primary); }
.tab.is-active { color: var(--text-brand); border-bottom-color: var(--accent); }

.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--space-4); align-items: start; }
.column { display: flex; flex-direction: column; gap: var(--space-4); }

.rows { margin: 0; display: flex; flex-direction: column; gap: var(--space-3); }
.row-item { display: grid; grid-template-columns: minmax(110px, 34%) 1fr; gap: var(--space-3); }
.row-item dt { font-size: var(--text-xs); color: var(--text-tertiary); }
.row-item dd { margin: 0; font-size: var(--text-sm); word-break: break-word; }
.prose { margin-top: var(--space-4); font-size: var(--text-sm); line-height: var(--leading-relaxed); white-space: pre-wrap; }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-3); }

.linked { list-style: none; margin: 0; padding: 0; }
.linked li { padding: var(--space-3) var(--space-5); border-top: 1px solid var(--border-subtle); font-size: var(--text-sm); }
.linked-main { font-weight: 550; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-4); }
.project { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); text-align: left; }
.project:hover { border-color: var(--border-strong); }
.project-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.project-name { font-size: var(--text-md); font-weight: 650; }

.feed { list-style: none; margin: 0; padding: 0; }
.feed li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-5); }
.feed-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.feed-text { font-size: var(--text-sm); }
.feed-time { font-size: 10px; }

.num { text-align: right; font-variant-numeric: tabular-nums; }
.strong { font-weight: 650; }
.pos { color: var(--ok-500); }
.neg { color: var(--danger-500); }
.warn { color: var(--warn-500); }
.nowrap { white-space: nowrap; }
.small { font-size: var(--text-xs); }

.cs-active, .ps-active, .pay-paid, .ps-paid { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.cs-prospect, .ps-planning { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); color: var(--text-brand); }
.cs-paused, .ps-on_hold, .pay-part_paid, .ps-pending { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.cs-former, .ps-cancelled, .ps-completed { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }
.pay-advance_due, .pay-unpaid, .ps-at_risk, .ps-overdue { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-500); }

</style>
