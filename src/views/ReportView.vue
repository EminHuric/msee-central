<script setup lang="ts">
/**
 * A period on one page, made to be printed.
 *
 * WHY PRINT AND NOT A PDF LIBRARY. Every browser already writes PDFs, and it
 * writes better ones than a library bolted into this bundle would: real text that
 * can be searched and copied, the right paper size, the right margins, and
 * nothing extra to keep working as the app changes. "Print" with a stylesheet
 * that knows what a page is gets a finished document; a PDF library gets a
 * dependency, a bundle a hundred kilobytes heavier, and fonts that go wrong in
 * Serbian.
 *
 * WHAT IT SAYS. What the company earned and spent, what it made for the people it
 * works for, and then every client with their own figures — because "how did the
 * month go" is answered by one number and explained only by the list behind it.
 *
 * Everything is derived from the same snapshot the dashboard uses, so a report
 * and the screen it was opened from can never disagree.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import PeriodPicker from '@/components/PeriodPicker.vue'
import {
  EMPTY_SNAPSHOT,
  companyFigures,
  loadSnapshot,
  periodOf,
  slice,
  type Period,
  type Snapshot,
} from '@/api/metrics'
import { formatDate } from '@/i18n'
import { useUiStore } from '@/stores/ui'
import { BASE_CURRENCY, formatMoney } from '@/types/money'
import { balanceOf } from '@/types/revenue'

const ui = useUiStore()
const { t, locale } = useI18n()

const loading = ref(true)
const all = ref<Snapshot>(EMPTY_SNAPSHOT)
const period = ref<Period>(periodOf('month'))

const current = computed(() => slice(all.value, period.value))
const figures = computed(() => companyFigures(current.value, all.value))

const money = (minor: number) => formatMoney(minor, BASE_CURRENCY, locale.value)

/**
 * Every client that did something in the period, with their own figures.
 *
 * Clients with nothing are left out rather than listed as zeroes: a report is
 * read, and a page of zeroes is a page somebody skims past to find the three
 * lines that matter.
 */
const clients = computed(() => {
  const rows = new Map<
    string,
    { name: string; sales: number; sold: number; earnedFor: number; owed: number }
  >()

  current.value.sales.forEach((sale) => {
    const key = sale.clientId || sale.clientName || '—'
    const row = rows.get(key) ?? {
      name: sale.clientName || t('finance.noClient'),
      sales: 0,
      sold: 0,
      earnedFor: 0,
      owed: 0,
    }

    row.sales += 1
    row.sold += sale.value.baseMinor
    row.earnedFor += sale.basisValue?.baseMinor ?? 0
    row.owed += balanceOf(sale, all.value.transactions).remainingBaseMinor
    rows.set(key, row)
  })

  return [...rows.values()].sort((a, b) => b.sold - a.sold)
})

/** The same, by service, because that is the other question about a month. */
const services = computed(() => {
  const rows = new Map<string, { name: string; count: number; sold: number }>()

  current.value.sales.forEach((sale) => {
    const key = sale.serviceId ?? 'none'
    const row = rows.get(key) ?? {
      name: sale.serviceName || t('analytics.noService'),
      count: 0,
      sold: 0,
    }
    row.count += 1
    row.sold += sale.value.baseMinor
    rows.set(key, row)
  })

  return [...rows.values()].sort((a, b) => b.sold - a.sold)
})

const printedOn = new Date().toISOString().slice(0, 10)

async function load(): Promise<void> {
  loading.value = true
  try {
    all.value = await loadSnapshot()
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

/**
 * Hand it to the browser's own print dialog.
 *
 * Where the person chooses "Save as PDF" — or actual paper, which is still how
 * some conversations go.
 */
const print = (): void => window.print()

onMounted(load)
</script>

<template>
  <div class="page report">
    <!-- Controls. Not printed: they are for choosing, not for reading. -->
    <header class="page-head no-print">
      <div>
        <h1 class="page-title">{{ t('report.title') }}</h1>
        <p class="page-subtitle">{{ t('report.subtitle') }}</p>
      </div>
      <button class="btn btn-primary" :disabled="loading" @click="print">
        <AppIcon name="contract" :size="15" />
        {{ t('report.print') }}
      </button>
    </header>

    <div class="no-print">
      <PeriodPicker v-model="period" />
    </div>

    <div v-if="loading" class="stack no-print">
      <div class="skeleton" style="height: 120px" />
    </div>

    <template v-else>
      <!-- The document itself. -->
      <article class="sheet">
        <header class="sheet-head">
          <div>
            <h2 class="sheet-title">{{ t('report.heading') }}</h2>
            <p class="sheet-range">
              {{ formatDate(period.from) }} – {{ formatDate(period.to) }}
            </p>
          </div>
          <p class="sheet-printed">{{ t('report.printedOn', { date: formatDate(printedOn) }) }}</p>
        </header>

        <section class="totals">
          <div>
            <span class="t-label">{{ t('finance.income') }}</span>
            <span class="t-value">{{ money(figures.soldBaseMinor) }}</span>
            <span class="t-note">{{ t('dashboard.collectedOf', { amount: money(figures.incomeBaseMinor) }) }}</span>
          </div>
          <div>
            <span class="t-label">{{ t('finance.expenses') }}</span>
            <span class="t-value">{{ money(figures.expenseBaseMinor) }}</span>
          </div>
          <div>
            <span class="t-label">{{ t('finance.profit') }}</span>
            <span class="t-value">{{ money(figures.soldBaseMinor - figures.expenseBaseMinor) }}</span>
          </div>
          <div>
            <span class="t-label">{{ t('dashboard.madeForClients') }}</span>
            <span class="t-value">{{ money(figures.madeForClientsBaseMinor) }}</span>
            <span class="t-note">{{ t('report.theirMoney') }}</span>
          </div>
        </section>

        <section v-if="clients.length" class="block">
          <h3 class="block-title">{{ t('report.byClient') }}</h3>
          <table class="sheet-table">
            <thead>
              <tr>
                <th>{{ t('clients.title') }}</th>
                <th class="num">{{ t('sales.count') }}</th>
                <th class="num">{{ t('sales.sold') }}</th>
                <th class="num">{{ t('dashboard.madeForClients') }}</th>
                <th class="num">{{ t('finance.outstanding') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in clients" :key="row.name">
                <td>{{ row.name }}</td>
                <td class="num">{{ row.sales }}</td>
                <td class="num">{{ money(row.sold) }}</td>
                <td class="num">{{ row.earnedFor ? money(row.earnedFor) : '—' }}</td>
                <td class="num">{{ row.owed ? money(row.owed) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section v-if="services.length" class="block">
          <h3 class="block-title">{{ t('report.byService') }}</h3>
          <table class="sheet-table">
            <thead>
              <tr>
                <th>{{ t('analytics.service') }}</th>
                <th class="num">{{ t('sales.count') }}</th>
                <th class="num">{{ t('sales.sold') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in services" :key="row.name">
                <td>{{ row.name }}</td>
                <td class="num">{{ row.count }}</td>
                <td class="num">{{ money(row.sold) }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <p v-if="!clients.length" class="empty-text">{{ t('report.nothing') }}</p>
      </article>
    </template>
  </div>
</template>

<style scoped>
.sheet {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
}

.sheet-head {
  align-items: flex-start;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  justify-content: space-between;
  margin-bottom: var(--space-5);
  padding-bottom: var(--space-4);
}

.sheet-title {
  font-size: var(--text-xl);
  font-weight: 600;
  margin: 0;
}

.sheet-range,
.sheet-printed {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  margin: 2px 0 0;
}

.totals {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  margin-bottom: var(--space-5);
}

.totals > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.t-label {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.t-value {
  font-size: var(--text-xl);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.t-note {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.block {
  margin-top: var(--space-5);
}

.block-title {
  font-size: var(--text-base);
  font-weight: 600;
  margin: 0 0 var(--space-2);
}

.sheet-table {
  border-collapse: collapse;
  width: 100%;
}

.sheet-table th {
  border-bottom: 1px solid var(--border-default);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: 500;
  padding: 4px 6px;
  text-align: left;
}

.sheet-table td {
  border-bottom: 1px solid var(--border-subtle);
  padding: 5px 6px;
}

.sheet-table .num {
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/*
 * On paper.
 *
 * The application's dark theme would print as a black rectangle using most of a
 * cartridge, so the sheet is forced to ink on white — which is also what somebody
 * expects a document to look like when they open the PDF later.
 */
@media print {
  .no-print {
    display: none !important;
  }

  .sheet {
    background: #fff;
    border: 0;
    color: #000;
    padding: 0;
  }

  .sheet-title,
  .t-value,
  .block-title,
  .sheet-table td {
    color: #000;
  }

  .t-label,
  .t-note,
  .sheet-range,
  .sheet-printed,
  .sheet-table th {
    color: #444;
  }

  .sheet-table th,
  .sheet-table td {
    border-color: #bbb;
  }

  /* A table should not be split across a page break mid-row. */
  .sheet-table tr,
  .block {
    break-inside: avoid;
  }
}
</style>
