<script setup lang="ts">
/**
 * One service, and everyone who buys it.
 *
 * The catalogue card answers "what do we sell and how much of it". This answers
 * the question that follows and used to need a spreadsheet: WHO. Who is on
 * StayBrain, what has each of them brought in, which of them still owes, and
 * when they last bought anything.
 *
 * The client list is derived from the sales, not from a field on the client
 * record. A maintained list is a list that is wrong within a month; a client
 * appears here because they bought the thing, which cannot drift.
 *
 * Nothing on this page is stored. Every figure is summed from the same sales
 * and transactions the rest of the application reads, so this page and the
 * client's own page can never disagree about what they owe.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import { fetchServices } from '@/api/operations'
import { fetchSales } from '@/api/sales'
import { fetchTransactions } from '@/api/finance'
import { formatDate } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { BASE_CURRENCY, formatMoney } from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import { balanceOf, type Sale, type Transaction } from '@/types/revenue'
import type { Service } from '@/types/business'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const { t, locale } = useI18n()

const serviceId = computed(() => String(route.params.id ?? ''))

const loading = ref(true)
const notFound = ref(false)
const service = ref<Service | null>(null)
const sales = ref<Sale[]>([])
const transactions = ref<Transaction[]>([])

const canMoney = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_VIEW))
const canClients = computed(() => auth.hasPermission(PERMISSIONS.CLIENTS_VIEW))

const money = (minor: number) => formatMoney(minor, BASE_CURRENCY, locale.value)

/** Only this service's sales, newest first. */
const rows = computed(() =>
  sales.value
    .filter((s) => s.serviceId === serviceId.value)
    .sort((a, b) => b.saleDate.localeCompare(a.saleDate)),
)

const balances = computed(
  () => new Map(rows.value.map((s) => [s.id, balanceOf(s, transactions.value)])),
)

const totals = computed(() => {
  const list = [...balances.value.values()]

  return {
    count: list.length,
    sold: list.reduce((n, b) => n + b.valueBaseMinor, 0),
    collected: list.reduce((n, b) => n + b.paidBaseMinor, 0),
    owed: list.reduce((n, b) => n + b.remainingBaseMinor, 0),
    /* Their money, where this service is a share of somebody else's deal. */
    madeFor: rows.value.reduce((n, s) => n + (s.basisValue?.baseMinor ?? 0), 0),
  }
})

/**
 * One row per client, biggest first.
 *
 * Biggest rather than alphabetical: the list is read to find out who matters to
 * this service, and an alphabet answers a different question.
 */
const clients = computed(() => {
  const map = new Map<
    string,
    { id: string; name: string; count: number; sold: number; owed: number; madeFor: number; last: string }
  >()

  for (const sale of rows.value) {
    const key = sale.clientId || sale.clientName
    const row = map.get(key) ?? {
      id: sale.clientId,
      name: sale.clientName || t('finance.noClient'),
      count: 0,
      sold: 0,
      owed: 0,
      madeFor: 0,
      last: '',
    }

    row.count += 1
    row.sold += sale.value.baseMinor
    row.owed += balances.value.get(sale.id)?.remainingBaseMinor ?? 0
    row.madeFor += sale.basisValue?.baseMinor ?? 0
    if (sale.saleDate > row.last) row.last = sale.saleDate
    map.set(key, row)
  }

  return [...map.values()].sort((a, b) => b.sold - a.sold)
})

const anyMadeFor = computed(() => totals.value.madeFor > 0)

async function load(): Promise<void> {
  loading.value = true
  notFound.value = false

  try {
    const [allServices, allSales, allTransactions] = await Promise.all([
      fetchServices(),
      fetchSales(),
      canMoney.value ? fetchTransactions() : Promise.resolve([] as Transaction[]),
    ])

    const found = allServices.find((s) => s.id === serviceId.value)
    if (!found) {
      notFound.value = true
      return
    }

    service.value = found
    sales.value = allSales
    transactions.value = allTransactions
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

watch(serviceId, load)
onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <button class="btn btn-ghost btn-sm back" @click="router.push('/services')">
          <AppIcon name="arrowLeft" :size="14" />
          {{ t('services.title') }}
        </button>
        <h1 class="page-title">{{ service?.name ?? '—' }}</h1>
        <p v-if="service?.description" class="page-subtitle">{{ service.description }}</p>
      </div>
      <span v-if="service" class="badge badge-plain">{{ service.category || '—' }}</span>
    </header>

    <div v-if="loading" class="stack">
      <div class="skeleton" style="height: 120px" />
      <div class="skeleton" style="height: 220px" />
    </div>

    <div v-else-if="notFound" class="card empty">
      <p class="empty-title">{{ t('services.notFound') }}</p>
      <button class="btn btn-primary" @click="router.push('/services')">
        {{ t('services.title') }}
      </button>
    </div>

    <template v-else>
      <div class="figures">
        <article class="card figure">
          <span class="figure-label">{{ t('sales.count') }}</span>
          <span class="figure-value">{{ totals.count }}</span>
        </article>
        <article v-if="canMoney" class="card figure">
          <span class="figure-label">{{ t('sales.sold') }}</span>
          <span class="figure-value">{{ money(totals.sold) }}</span>
        </article>
        <article v-if="canMoney" class="card figure">
          <span class="figure-label">{{ t('finance.collected') }}</span>
          <span class="figure-value pos">{{ money(totals.collected) }}</span>
        </article>
        <article v-if="canMoney" class="card figure">
          <span class="figure-label">{{ t('finance.outstanding') }}</span>
          <span class="figure-value" :class="{ neg: totals.owed > 0 }">{{ money(totals.owed) }}</span>
        </article>
        <!-- Only where this service takes a cut of somebody else's money. -->
        <article v-if="canMoney && anyMadeFor" class="card figure">
          <span class="figure-label">{{ t('dashboard.madeForClients') }}</span>
          <span class="figure-value">{{ money(totals.madeFor) }}</span>
          <span class="figure-hint">{{ t('report.theirMoney') }}</span>
        </article>
      </div>

      <!-- Who uses it ---------------------------------------------------- -->
      <section v-if="canClients" class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('services.clientsUsing') }}</h2>
          <span class="tertiary small">{{ clients.length }}</span>
        </div>

        <p v-if="!clients.length" class="card-body tertiary small">{{ t('services.noClients') }}</p>

        <div v-else class="table-wrap">
          <table class="table table-cards">
            <thead>
              <tr>
                <th>{{ t('clients.title') }}</th>
                <th class="num">{{ t('sales.count') }}</th>
                <th v-if="canMoney" class="num">{{ t('sales.sold') }}</th>
                <th v-if="canMoney && anyMadeFor" class="num hide-md">
                  {{ t('dashboard.madeForClients') }}
                </th>
                <th v-if="canMoney" class="num">{{ t('finance.outstanding') }}</th>
                <th class="hide-sm">{{ t('services.lastSale') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in clients" :key="row.name">
                <td>
                  <button
                    v-if="row.id"
                    type="button"
                    class="link-quiet"
                    @click="router.push(`/clients/${row.id}`)"
                  >
                    {{ row.name }}
                  </button>
                  <span v-else>{{ row.name }}</span>
                </td>
                <td :data-label="t('sales.count')" class="num">{{ row.count }}</td>
                <td v-if="canMoney" :data-label="t('sales.sold')" class="num strong">
                  {{ money(row.sold) }}
                </td>
                <td
                  v-if="canMoney && anyMadeFor"
                  :data-label="t('dashboard.madeForClients')"
                  class="num hide-md muted"
                >
                  {{ row.madeFor ? money(row.madeFor) : '—' }}
                </td>
                <td :data-label="t('finance.outstanding')" class="num" :class="{ neg: row.owed > 0 }">
                  {{ row.owed ? money(row.owed) : '—' }}
                </td>
                <td :data-label="t('services.lastSale')" class="hide-sm muted nowrap">
                  {{ formatDate(row.last) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Every sale of it ----------------------------------------------- -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('sales.title') }}</h2>
        </div>

        <p v-if="!rows.length" class="card-body tertiary small">{{ t('sales.empty') }}</p>

        <div v-else class="table-wrap">
          <table class="table table-cards">
            <thead>
              <tr>
                <th>{{ t('sales.saleDate') }}</th>
                <th>{{ t('sales.dealTitle') }}</th>
                <th class="hide-sm">{{ t('table.client') }}</th>
                <th v-if="canMoney" class="num">{{ t('sales.value') }}</th>
                <th v-if="canMoney" class="num">{{ t('finance.outstanding') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="sale in rows" :key="sale.id">
                <td class="muted nowrap">{{ formatDate(sale.saleDate) }}</td>
                <td :data-label="t('sales.dealTitle')">{{ sale.title }}</td>
                <td :data-label="t('table.client')" class="hide-sm">{{ sale.clientName }}</td>
                <td v-if="canMoney" :data-label="t('sales.value')" class="num strong">
                  {{ money(sale.value.baseMinor) }}
                </td>
                <td
                  v-if="canMoney"
                  :data-label="t('finance.outstanding')"
                  class="num"
                  :class="{ neg: (balances.get(sale.id)?.remainingBaseMinor ?? 0) > 0 }"
                >
                  {{
                    balances.get(sale.id)?.remainingBaseMinor
                      ? money(balances.get(sale.id)!.remainingBaseMinor)
                      : t('saleBalance.paid')
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.page-head {
  align-items: flex-start;
  display: flex;
  gap: var(--space-4);
  justify-content: space-between;
  margin-bottom: var(--space-4);
}

.back {
  margin-bottom: var(--space-2);
  padding-left: 0;
}

.empty {
  padding: var(--space-6);
  text-align: center;
}
</style>
