<script setup lang="ts">
/**
 * Give somebody their share of a booking they brought.
 *
 * THE AMOUNT IS YOURS TO DECIDE, and that is the design rather than a gap. A rule
 * — "always 30% of the commission" — would be wrong the first week somebody
 * brings a booking that took a month of chasing, and right only for the average
 * case that never happens. The commission is shown, a share of it is offered as a
 * starting point, and the number that gets written is the one you typed.
 *
 * It writes a `commission` entry into that person's ledger. The ledger is
 * append-only: this credits them, and a mistake is corrected by a second entry
 * rather than by editing this one, so what the company believed it owed is never
 * quietly rewritten.
 *
 * NOBODY CAN CREDIT THEMSELVES. The database refuses it — see `addEntry` — so the
 * rule holds even for whoever is holding the keyboard.
 */

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import { fetchEmployees } from '@/api/employees'
import { addEntry } from '@/api/wallet'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { LIMITS } from '@/lib/validation'
import { BASE_CURRENCY, formatMoney, fromMinor, toMinor } from '@/types/money'
import type { EmployeePublic } from '@/types/domain'

const props = defineProps<{
  open: boolean
  /** What this booking earned the company, in base-currency minor units. */
  commissionBaseMinor: number
  /** For the ledger entry, so the person can see what they were paid for. */
  label: string
  /** The sale this follows from, when there is one. */
  saleId?: string | null
}>()

const emit = defineEmits<{ done: []; close: [] }>()

const auth = useAuthStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const employees = ref<EmployeePublic[]>([])
const employeeUid = ref('')
const amount = ref(0)
const reason = ref('')
const saving = ref(false)

/** A starting point, not a rule: a third of what the company earned. */
const suggested = computed(() => Math.round(props.commissionBaseMinor / 3))

const money = (minor: number) => formatMoney(minor, BASE_CURRENCY, locale.value)

/** Everyone but the person filling this in — the database refuses self-credit. */
const others = computed(() => employees.value.filter((row) => row.uid !== auth.uid))

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    employeeUid.value = ''
    amount.value = fromMinor(suggested.value, BASE_CURRENCY)
    reason.value = props.label
    employees.value = await fetchEmployees().catch(() => [])
  },
)

async function commit(): Promise<void> {
  if (saving.value) return

  const person = others.value.find((row) => row.uid === employeeUid.value)
  if (!person) {
    ui.notify('danger', t('credit.needPerson'))
    return
  }
  if (amount.value <= 0) {
    ui.notify('danger', t('credit.needAmount'))
    return
  }

  saving.value = true
  try {
    await addEntry({
      employeeUid: person.uid,
      employeeName: `${person.firstName} ${person.lastName}`.trim(),
      kind: 'commission',
      amountBaseMinor: toMinor(amount.value, BASE_CURRENCY),
      /* Approved, because deciding the amount IS the approval. */
      status: 'approved',
      reason: reason.value.trim() || props.label,
      saleId: props.saleId ?? null,
      saleLabel: props.label,
      bonusAwardId: null,
      goalId: null,
      date: new Date().toISOString().slice(0, 10),
      approvedBy: null,
      approvedAt: null,
      paidAt: null,
      createdAt: '',
      createdBy: '',
      createdByName: '',
      updatedAt: '',
    })

    ui.notify('ok', t('credit.done', { name: person.firstName }))
    emit('done')
  } catch (error) {
    ui.notify('danger', (error as Error).message || t('errors.generic'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <dialog class="dialog" :open="props.open">
    <form class="body" @submit.prevent="commit">
      <header class="head">
        <h2 class="title">{{ t('credit.title') }}</h2>
        <button type="button" class="btn btn-ghost btn-sm" @click="emit('close')">
          <AppIcon name="close" :size="16" />
        </button>
      </header>

      <p class="context">
        {{ props.label }}
        <span class="tertiary">· {{ t('credit.weEarned', { amount: money(props.commissionBaseMinor) }) }}</span>
      </p>

      <div class="field">
        <label class="field-label" for="cr-person">{{ t('credit.who') }}</label>
        <select id="cr-person" v-model="employeeUid" class="select">
          <option value="">{{ t('credit.pickPerson') }}</option>
          <option v-for="p in others" :key="p.uid" :value="p.uid">
            {{ p.firstName }} {{ p.lastName }}
          </option>
        </select>
        <p class="field-hint">{{ t('credit.whoHint') }}</p>
      </div>

      <div class="field">
        <label class="field-label" for="cr-amount">{{ t('credit.amount') }}</label>
        <input id="cr-amount" v-model.number="amount" class="input" type="number" min="0" step="0.01" />
        <p class="field-hint">
          {{ t('credit.amountHint', { suggested: money(suggested) }) }}
        </p>
      </div>

      <div class="field">
        <label class="field-label" for="cr-reason">{{ t('credit.reason') }}</label>
        <input id="cr-reason" v-model="reason" class="input" :maxlength="LIMITS.shortText" />
      </div>

      <footer class="foot">
        <button type="button" class="btn btn-secondary" @click="emit('close')">
          {{ t('common.cancel') }}
        </button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          <span v-if="saving" class="spinner" />
          {{ t('credit.give') }}
        </button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.dialog[open] {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  display: block;
  max-width: 460px;
  padding: 0;
  width: calc(100vw - 2rem);
}

.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
}

.head {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.title {
  font-size: var(--text-lg);
  font-weight: 600;
  margin: 0;
}

.context {
  font-size: var(--text-sm);
  margin: 0;
}

.foot {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
</style>
