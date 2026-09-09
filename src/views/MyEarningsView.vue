<script setup lang="ts">
/**
 * What I have earned.
 *
 * Every figure here is a sum of the ledger below it, so a person can always
 * answer "why is it that number?" by reading down the page. That is the whole
 * reason the balance is not stored anywhere: a compensation figure nobody can
 * check is a compensation figure people stop trusting.
 *
 * Earned and paid are separate columns because they are separate facts. A
 * commission earned in March and paid in May was a debt for two months, and
 * flattening them into one number loses the only part somebody cares about
 * while they are waiting.
 *
 * Deliberately plain. This is the page where somebody finds out what they are
 * owed, and it should read like a statement rather than a game.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import { fetchWallet } from '@/api/wallet'
import { formatDate } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { BASE_CURRENCY, formatMoney } from '@/types/money'
import { balanceFrom, type WalletEntry } from '@/types/wallet'

const auth = useAuthStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const loading = ref(true)
const entries = ref<WalletEntry[]>([])

const money = (minor: number) => formatMoney(minor, BASE_CURRENCY, locale.value)

const balance = computed(() => balanceFrom(entries.value))

/** Newest first: what changed most recently is what somebody is looking for. */
const rows = computed(() =>
  [...entries.value].sort((a, b) => b.date.localeCompare(a.date)),
)

const thisMonth = computed(() => {
  const prefix = new Date().toISOString().slice(0, 7)
  return balanceFrom(entries.value.filter((e) => e.date.startsWith(prefix)))
})

const thisYear = computed(() => {
  const prefix = new Date().toISOString().slice(0, 4)
  return balanceFrom(entries.value.filter((e) => e.date.startsWith(prefix)))
})

async function load(): Promise<void> {
  loading.value = true
  try {
    entries.value = auth.uid ? await fetchWallet(auth.uid) : []
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('wallet.title') }}</h1>
        <p class="page-subtitle">{{ t('wallet.subtitle') }}</p>
      </div>
    </header>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 56px" />
      </div>
    </div>

    <template v-else>
      <!-- The headline: what is owed today, and what has been paid. -->
      <div class="cards">
        <article class="card figure figure-lead">
          <span class="figure-label">{{ t('wallet.available') }}</span>
          <span class="figure-value">{{ money(balance.availableBaseMinor) }}</span>
          <span class="figure-hint">{{ t('wallet.availableHint') }}</span>
        </article>

        <article class="card figure">
          <span class="figure-label">{{ t('wallet.pending') }}</span>
          <span class="figure-value">{{ money(balance.pendingBaseMinor) }}</span>
          <span class="figure-hint">{{ t('wallet.pendingHint') }}</span>
        </article>

        <article class="card figure">
          <span class="figure-label">{{ t('wallet.paid') }}</span>
          <span class="figure-value">{{ money(balance.paidBaseMinor) }}</span>
        </article>

        <article class="card figure">
          <span class="figure-label">{{ t('wallet.earnedTotal') }}</span>
          <span class="figure-value">{{ money(balance.earnedBaseMinor) }}</span>
        </article>

        <article class="card figure">
          <span class="figure-label">{{ t('wallet.thisMonth') }}</span>
          <span class="figure-value">{{ money(thisMonth.earnedBaseMinor) }}</span>
        </article>

        <article class="card figure">
          <span class="figure-label">{{ t('wallet.thisYear') }}</span>
          <span class="figure-value">{{ money(thisYear.earnedBaseMinor) }}</span>
        </article>
      </div>

      <!-- The ledger the figures above are made of. -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('wallet.history') }}</h2>
          <span class="tertiary small">{{ t('wallet.historyHint') }}</span>
        </div>

        <div v-if="rows.length === 0" class="empty">
          <span class="empty-icon"><AppIcon name="wallet" :size="20" /></span>
          <p class="empty-title">{{ t('wallet.empty') }}</p>
          <p class="empty-text">{{ t('wallet.emptyHint') }}</p>
        </div>

        <div v-else class="table-wrap">
          <table class="table table-cards">
            <thead>
              <tr>
                <th>{{ t('table.date') }}</th>
                <th>{{ t('wallet.kind') }}</th>
                <th class="hide-sm">{{ t('wallet.reason') }}</th>
                <th class="num">{{ t('table.amount') }}</th>
                <th>{{ t('table.status') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in rows" :key="entry.id" :class="{ 'is-void': entry.status === 'cancelled' }">
                <td class="nowrap muted">{{ formatDate(entry.date) }}</td>

                <td :data-label="t('wallet.kind')">
                  {{ t(`walletKind.${entry.kind}`) }}
                </td>

                <td class="hide-sm" :data-label="t('wallet.reason')">
                  <span class="stack-tight">
                    <span>{{ entry.reason || '—' }}</span>
                    <span v-if="entry.saleLabel" class="tertiary small">{{ entry.saleLabel }}</span>
                  </span>
                </td>

                <td
                  class="num strong"
                  :class="entry.amountBaseMinor < 0 ? 'neg' : 'pos'"
                  :data-label="t('table.amount')"
                >
                  {{ entry.amountBaseMinor > 0 ? '+' : '' }}{{ money(entry.amountBaseMinor) }}
                </td>

                <td :data-label="t('table.status')">
                  <span class="badge" :class="`ws-${entry.status}`">
                    {{ t(`walletStatus.${entry.status}`) }}
                  </span>
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
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--space-3); }

.figure {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-4) var(--space-5);
}

/* What the company owes today, given the most room. */
.figure-lead { border-color: var(--accent-soft-border); background: var(--accent-soft-bg); }
.figure-lead .figure-value { color: var(--text-brand); }

.figure-label {
  font-size: var(--text-xs);
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
}

.figure-value {
  font-size: var(--text-xl);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.figure-hint { font-size: var(--text-xs); color: var(--text-tertiary); }

.pos { color: var(--ok-500); }
.neg { color: var(--text-secondary); }

.is-void { opacity: 0.5; }
.is-void .num { text-decoration: line-through; }

.ws-pending { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.ws-approved { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); color: var(--text-brand); }
.ws-paid { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.ws-cancelled { background: var(--neutral-bg); border-color: var(--neutral-border); color: var(--neutral-500); }
</style>
