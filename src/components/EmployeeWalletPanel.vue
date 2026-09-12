<script setup lang="ts">
/**
 * One person's earnings, from the other side of the desk.
 *
 * The CEO can credit somebody who has earned nothing yet — a bonus for good
 * work is not a calculation, it is a decision — and can take money back with a
 * correction when there is a reason to.
 *
 * What the CEO cannot do is change a figure that has already been written. A
 * mistake is corrected by a second entry, because the record of what the
 * company believed it owed is worth keeping even when it was wrong, and because
 * an editable ledger cannot answer "why is it that number?".
 *
 * The balance below is a sum of the lines below it. There is no balance field
 * anywhere to disagree with them.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import { addEntry, fetchWallet, recordPayout, setEntryStatus } from '@/api/wallet'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { BASE_CURRENCY, formatMoney, toMinor } from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import {
  balanceFrom,
  blankEntry,
  type WalletEntry,
  type WalletKind,
} from '@/types/wallet'
import type { EmployeePublic } from '@/types/domain'

const props = defineProps<{ employee: EmployeePublic }>()

const auth = useAuthStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const loading = ref(true)
const saving = ref(false)
const entries = ref<WalletEntry[]>([])

const draft = ref<WalletEntry | null>(null)
const draftAmount = ref(0)
const payoutOpen = ref(false)
const payoutAmount = ref(0)
const payoutReason = ref('')

const money = (minor: number) => formatMoney(minor, BASE_CURRENCY, locale.value)

const canAdjust = computed(() => auth.hasPermission(PERMISSIONS.WALLET_ADJUST))
const isSelf = computed(() => props.employee.uid === auth.uid)

const balance = computed(() => balanceFrom(entries.value))
const rows = computed(() => [...entries.value].sort((a, b) => b.date.localeCompare(a.date)))

const name = computed(() => `${props.employee.firstName} ${props.employee.lastName}`.trim())

/**
 * The kinds the CEO picks from, in the order they are actually used.
 *
 * `payout` is absent: it has its own button, because recording one is a
 * different act from crediting somebody and its amount is signed the other way.
 */
const CREDITABLE: WalletKind[] = ['bonus', 'commission', 'adjustment', 'deduction']

async function load(): Promise<void> {
  loading.value = true
  try {
    entries.value = await fetchWallet(props.employee.uid)
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

function start(kind: WalletKind): void {
  draft.value = { ...blankEntry(props.employee.uid, name.value), kind }
  draftAmount.value = 0
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return

  if (!d.reason.trim()) {
    ui.notify('danger', t('wallet.reasonRequired'))
    return
  }
  if (draftAmount.value <= 0) {
    ui.notify('danger', t('wallet.amountRequired'))
    return
  }

  saving.value = true
  try {
    /*
     * A deduction is money coming off, so it is stored negative. Storing the
     * sign rather than a direction flag is what lets the balance be a plain
     * sum that cannot be got wrong by reading the flag backwards.
     */
    const magnitude = toMinor(draftAmount.value, BASE_CURRENCY)
    const signed = d.kind === 'deduction' ? -magnitude : magnitude

    await addEntry({ ...d, reason: d.reason.trim(), amountBaseMinor: signed })
    ui.notify('ok', t('wallet.entryAdded'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('wallet.noSelfCredit'))
  } finally {
    saving.value = false
  }
}

async function payOut(): Promise<void> {
  if (saving.value) return
  if (payoutAmount.value <= 0) {
    ui.notify('danger', t('wallet.amountRequired'))
    return
  }

  saving.value = true
  try {
    await recordPayout(
      { uid: props.employee.uid, name: name.value },
      toMinor(payoutAmount.value, BASE_CURRENCY),
      payoutReason.value.trim() || t('wallet.payoutDefault'),
    )
    ui.notify('ok', t('wallet.payoutRecorded'))
    payoutOpen.value = false
    payoutAmount.value = 0
    payoutReason.value = ''
    await load()
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    saving.value = false
  }
}

async function advance(entry: WalletEntry, to: 'approved' | 'paid' | 'cancelled'): Promise<void> {
  try {
    await setEntryStatus(entry, to)
    await load()
  } catch {
    ui.notify('danger', t('errors.generic'))
  }
}

/** What the whole approved balance would be, for the payout box. */
function payWholeBalance(): void {
  payoutAmount.value = balance.value.availableBaseMinor / 100
}

onMounted(load)
</script>

<template>
  <section class="card">
    <div class="card-header">
      <div>
        <h2 class="card-title">{{ t('wallet.titleFor', { name }) }}</h2>
        <p class="field-hint">{{ t('wallet.ceoHint') }}</p>
      </div>
    </div>

    <div v-if="loading" class="card-body stack">
      <div v-for="n in 2" :key="n" class="skeleton" style="height: 48px" />
    </div>

    <template v-else>
      <div class="card-body figures">
        <div>
          <span class="figure-label">{{ t('wallet.available') }}</span>
          <span class="figure-value brand">{{ money(balance.availableBaseMinor) }}</span>
        </div>
        <div>
          <span class="figure-label">{{ t('wallet.pending') }}</span>
          <span class="figure-value">{{ money(balance.pendingBaseMinor) }}</span>
        </div>
        <div>
          <span class="figure-label">{{ t('wallet.paid') }}</span>
          <span class="figure-value">{{ money(balance.paidBaseMinor) }}</span>
        </div>
        <div>
          <span class="figure-label">{{ t('wallet.earnedTotal') }}</span>
          <span class="figure-value">{{ money(balance.earnedBaseMinor) }}</span>
        </div>
      </div>

      <!--
        Nobody credits their own ledger. The database refuses it too; this is
        what turns that refusal into a sentence instead of an error.
      -->
      <div v-if="isSelf" class="card-body">
        <div class="alert alert-info">
          <AppIcon name="info" :size="16" />
          <span>{{ t('wallet.noSelfCredit') }}</span>
        </div>
      </div>

      <div v-else-if="canAdjust && !draft && !payoutOpen" class="card-body actions">
        <button v-for="kind in CREDITABLE" :key="kind" class="btn btn-secondary btn-sm" @click="start(kind)">
          <AppIcon name="plus" :size="14" />
          {{ t(`walletKind.${kind}`) }}
        </button>
        <button class="btn btn-secondary btn-sm" @click="payoutOpen = true">
          <AppIcon name="wallet" :size="14" />
          {{ t('wallet.recordPayout') }}
        </button>
      </div>

      <!-- Adding an entry -->
      <div v-if="draft" class="card-body stack editor">
        <p class="editor-title">{{ t(`walletKind.${draft.kind}`) }}</p>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="w-amount">{{ t('wallet.amountLabel') }}</label>
            <input
              id="w-amount"
              v-model.number="draftAmount"
              class="input"
              type="number"
              step="0.01"
              min="0"
            />
            <p v-if="draft.kind === 'deduction'" class="field-hint">
              {{ t('wallet.deductionHint') }}
            </p>
          </div>

          <div class="field">
            <label class="field-label" for="w-date">{{ t('table.date') }}</label>
            <input id="w-date" v-model="draft.date" class="input" type="date" />
          </div>

          <div class="field">
            <label class="field-label" for="w-status">{{ t('table.status') }}</label>
            <select id="w-status" v-model="draft.status" class="select">
              <option value="pending">{{ t('walletStatus.pending') }}</option>
              <option value="approved">{{ t('walletStatus.approved') }}</option>
              <option value="paid">{{ t('walletStatus.paid') }}</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="w-reason">{{ t('wallet.reason') }}</label>
          <input
            id="w-reason"
            v-model="draft.reason"
            class="input"
            :maxlength="LIMITS.shortText"
            :placeholder="t('wallet.reasonPlaceholder')"
          />
          <p class="field-hint">{{ t('wallet.reasonHint') }}</p>
        </div>

        <div class="row editor-actions">
          <button class="btn btn-secondary" @click="draft = null">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="saving" @click="commit">
            <span v-if="saving" class="spinner" />
            {{ t('common.save') }}
          </button>
        </div>
      </div>

      <!-- Recording a payout -->
      <div v-if="payoutOpen" class="card-body stack editor">
        <p class="editor-title">{{ t('wallet.recordPayout') }}</p>

        <div class="field">
          <label class="field-label" for="w-pay">{{ t('wallet.amountLabel') }}</label>
          <div class="inline-row">
            <input
              id="w-pay"
              v-model.number="payoutAmount"
              class="input"
              type="number"
              step="0.01"
              min="0"
            />
            <button class="btn btn-ghost btn-sm" @click="payWholeBalance">
              {{ t('wallet.payWhole') }}
            </button>
          </div>
          <p class="field-hint">{{ t('wallet.payoutHint') }}</p>
        </div>

        <div class="field">
          <label class="field-label" for="w-pay-reason">{{ t('wallet.reason') }}</label>
          <input
            id="w-pay-reason"
            v-model="payoutReason"
            class="input"
            :maxlength="LIMITS.shortText"
          />
        </div>

        <div class="row editor-actions">
          <button class="btn btn-secondary" @click="payoutOpen = false">
            {{ t('common.cancel') }}
          </button>
          <button class="btn btn-primary" :disabled="saving" @click="payOut">
            <span v-if="saving" class="spinner" />
            {{ t('wallet.recordPayout') }}
          </button>
        </div>
      </div>

      <!-- The ledger -->
      <div v-if="rows.length === 0" class="empty">
        <span class="empty-icon"><AppIcon name="wallet" :size="20" /></span>
        <p class="empty-title">{{ t('wallet.empty') }}</p>
        <p class="empty-text">{{ t('wallet.ceoEmptyHint') }}</p>
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
              <th class="col-actions" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in rows" :key="entry.id" :class="{ 'is-void': entry.status === 'cancelled' }">
              <td class="nowrap muted">{{ formatDate(entry.date) }}</td>

              <td :data-label="t('wallet.kind')">{{ t(`walletKind.${entry.kind}`) }}</td>

              <td class="hide-sm" :data-label="t('wallet.reason')">
                <span class="stack-tight">
                  <span>{{ entry.reason || '—' }}</span>
                  <span class="tertiary small">{{ entry.createdByName }}</span>
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

              <!--
                The ladder forward only. There is no button to change an
                amount, because there is no way to change one.
              -->
              <td class="col-actions">
                <template v-if="canAdjust && !isSelf && entry.status !== 'cancelled'">
                  <button
                    v-if="entry.status === 'pending'"
                    class="btn btn-ghost btn-sm"
                    @click="advance(entry, 'approved')"
                  >
                    {{ t('wallet.approve') }}
                  </button>
                  <button
                    v-if="entry.status === 'approved'"
                    class="btn btn-ghost btn-sm"
                    @click="advance(entry, 'paid')"
                  >
                    {{ t('wallet.markPaid') }}
                  </button>
                  <button
                    v-if="entry.status === 'pending'"
                    class="btn btn-ghost btn-sm danger"
                    @click="advance(entry, 'cancelled')"
                  >
                    {{ t('common.cancel') }}
                  </button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.figures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.figures > div { display: flex; flex-direction: column; gap: 2px; }

.figure-label {
  font-size: var(--text-xs);
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
}

.figure-value {
  font-size: var(--text-lg);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
.figure-value.brand { color: var(--text-brand); }

.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); border-bottom: 1px solid var(--border-subtle); }

.editor { border-bottom: 1px solid var(--border-subtle); background: var(--bg-surface-2); }
.editor-title { font-weight: 650; font-size: var(--text-sm); }
.editor-actions { justify-content: flex-end; }

.inline-row { display: flex; gap: var(--space-2); align-items: center; }

.pos { color: var(--ok-500); }
.neg { color: var(--danger-500); }

.is-void { opacity: 0.5; }
.is-void .num { text-decoration: line-through; }

.ws-pending { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.ws-approved { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); color: var(--text-brand); }
.ws-paid { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.ws-cancelled { background: var(--neutral-bg); border-color: var(--neutral-border); color: var(--neutral-500); }
</style>
