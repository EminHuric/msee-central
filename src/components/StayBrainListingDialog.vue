<script setup lang="ts">
/**
 * A StayBrain listing: which property, whose client, and what it earns us.
 *
 * THE RMS ACCOUNT IS CHOSEN FROM THE REAL LIST. The accounts are read live from
 * the RMS rather than typed, because a workspace id typed by hand is a link that
 * looks right and resolves to nothing — and the failure would only show up later
 * as a property with no units.
 *
 * WHAT THE EARNING IS. A flat amount per booking we bring: €50 a reservation,
 * ten reservations is €500. Not a percentage of the guest's money — that belongs
 * to the owner. The percentage model exists in the type so the day a client is
 * agreed differently it is a selection here and not a migration, but the default
 * and the intent are the fixed fee.
 */

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import { fetchClients } from '@/api/clients'
import { fetchRmsAccounts } from '@/api/rms'
import { saveListing } from '@/api/staybrain'
import { moneyOf } from '@/api/sales'
import { rmsUser } from '@/lib/rms'
import { LIMITS } from '@/lib/validation'
import { useUiStore } from '@/stores/ui'
import { CURRENCIES, fromMinor, type CurrencyCode } from '@/types/money'
import { EARNING_MODELS, blankListing, type StayBrainListing } from '@/types/staybrain'
import type { RmsAccount } from '@/types/staybrain'
import type { Client } from '@/types/business'

const props = defineProps<{ open: boolean; listing: StayBrainListing | null }>()
const emit = defineEmits<{ saved: []; close: [] }>()

const ui = useUiStore()
const { t } = useI18n()

const draft = ref<StayBrainListing>(blankListing())
const amount = ref(0)
const saving = ref(false)

const clients = ref<Client[]>([])
const accounts = ref<RmsAccount[]>([])
const loadingAccounts = ref(false)
const accountsError = ref('')

const connected = computed(() => rmsUser() !== null)

/** The account picked, so its unit count and consent can be shown. */
const chosen = computed(() =>
  accounts.value.find((a) => a.id === draft.value.rmsWorkspaceId) ?? null,
)

watch(
  () => props.open,
  async (open) => {
    if (!open) return

    draft.value = props.listing ? { ...props.listing } : blankListing()
    amount.value = fromMinor(draft.value.earning.amount.minor, draft.value.currency)

    clients.value = await fetchClients().catch(() => [])
    if (connected.value) await loadAccounts()
  },
)

async function loadAccounts(): Promise<void> {
  loadingAccounts.value = true
  accountsError.value = ''
  try {
    accounts.value = await fetchRmsAccounts()
  } catch (error) {
    accounts.value = []
    accountsError.value = (error as Error).message
  } finally {
    loadingAccounts.value = false
  }
}

/** Picking a client fills in the name we store beside the id. */
function onClient(id: string): void {
  const client = clients.value.find((c) => c.id === id)
  draft.value.clientId = id
  draft.value.clientName = client?.name ?? ''
  /* And suggests a listing name, only while the field is still empty. */
  if (!draft.value.name && client) draft.value.name = client.name
}

function onAccount(id: string): void {
  draft.value.rmsWorkspaceId = id
  const account = accounts.value.find((a) => a.id === id)
  draft.value.rmsAccountEmail = account?.email ?? ''
}

function onCurrency(currency: CurrencyCode): void {
  draft.value.currency = currency
}

async function commit(): Promise<void> {
  if (saving.value) return

  if (!draft.value.clientId) {
    ui.notify('danger', t('staybrain.needClient'))
    return
  }
  if (!draft.value.name.trim()) {
    ui.notify('danger', t('staybrain.needName'))
    return
  }
  if (draft.value.earning.model === 'fixed_per_reservation' && amount.value <= 0) {
    ui.notify('danger', t('staybrain.needAmount'))
    return
  }

  saving.value = true
  try {
    await saveListing({
      ...draft.value,
      name: draft.value.name.trim(),
      note: draft.value.note.trim(),
      earning: {
        ...draft.value.earning,
        amount: moneyOf(amount.value, draft.value.currency, draft.value.rate),
      },
    })
    ui.notify('ok', t('staybrain.listingSaved'))
    emit('saved')
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <dialog class="dialog" :open="props.open">
    <form class="dialog-body" @submit.prevent="commit">
      <header class="dialog-head">
        <h2 class="dialog-title">
          {{ props.listing ? t('staybrain.editListing') : t('staybrain.addListing') }}
        </h2>
        <button type="button" class="btn btn-ghost btn-sm" @click="emit('close')">
          <AppIcon name="close" :size="16" />
        </button>
      </header>

      <div class="field-grid">
        <div class="field">
          <label class="field-label" for="sb-client">{{ t('staybrain.client') }}</label>
          <select
            id="sb-client"
            class="select"
            :value="draft.clientId"
            @change="onClient(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('staybrain.pickClient') }}</option>
            <option v-for="c in clients" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <p class="field-hint">{{ t('staybrain.clientHint') }}</p>
        </div>

        <div class="field">
          <label class="field-label" for="sb-name">{{ t('staybrain.listingName') }}</label>
          <input id="sb-name" v-model="draft.name" class="input" :maxlength="LIMITS.name" />
        </div>
      </div>

      <!-- The RMS account ------------------------------------------------- -->
      <div class="field">
        <label class="field-label" for="sb-account">{{ t('staybrain.rmsAccount') }}</label>

        <p v-if="!connected" class="field-hint warn">
          <AppIcon name="alert" :size="13" />
          {{ t('staybrain.connectFirst') }}
        </p>

        <template v-else>
          <select
            id="sb-account"
            class="select"
            :disabled="loadingAccounts"
            :value="draft.rmsWorkspaceId"
            @change="onAccount(($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('staybrain.pickAccount') }}</option>
            <option v-for="a in accounts" :key="a.id" :value="a.id">
              {{ a.username || a.email }} — {{ t('staybrain.unitCount', { n: a.apartmentCount }) }}
            </option>
          </select>

          <p v-if="accountsError" class="field-hint warn">{{ accountsError }}</p>

          <!--
            The empty case, which is the first one anybody meets.

            The list only holds accounts that have switched agency access on in
            the RMS, so an empty picker is not a fault — it means nobody has
            invited us yet, and that is a thing to go and do rather than a thing
            to debug.
          -->
          <p v-else-if="!loadingAccounts && !accounts.length" class="field-hint warn">
            <AppIcon name="alert" :size="13" />
            {{ t('staybrain.noAccountsYet') }}
          </p>

          <!--
            Whether the account has let us write into it.

            Shown here because this is where somebody would otherwise find out
            the hard way: the listing saves, the units appear, and the first
            booking is refused. The switch lives in the RMS, on that account.
          -->
          <p v-else-if="chosen && !chosen.agencyAccess" class="field-hint warn">
            <AppIcon name="alert" :size="13" />
            {{ t('staybrain.noAgencyAccess') }}
          </p>
          <p v-else-if="chosen" class="field-hint ok">
            <AppIcon name="check" :size="13" />
            {{ t('staybrain.agencyAccessOn') }}
          </p>
          <p v-else class="field-hint">{{ t('staybrain.rmsAccountHint') }}</p>
        </template>
      </div>

      <!-- What it earns --------------------------------------------------- -->
      <fieldset class="terms">
        <legend class="field-label">{{ t('staybrain.earning') }}</legend>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="sb-model">{{ t('staybrain.earningModel') }}</label>
            <select id="sb-model" v-model="draft.earning.model" class="select">
              <option v-for="m in EARNING_MODELS" :key="m" :value="m">
                {{ t(`earningModel.${m}`) }}
              </option>
            </select>
            <p class="field-hint">{{ t(`earningModelHint.${draft.earning.model}`) }}</p>
          </div>

          <div v-if="draft.earning.model === 'fixed_per_reservation'" class="field">
            <label class="field-label" for="sb-amount">{{ t('staybrain.perReservation') }}</label>
            <div class="row">
              <input
                id="sb-amount"
                v-model.number="amount"
                class="input"
                type="number"
                min="0"
                step="0.01"
              />
              <select
                class="select narrow"
                :value="draft.currency"
                @change="onCurrency(($event.target as HTMLSelectElement).value as CurrencyCode)"
              >
                <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
              </select>
            </div>
            <p class="field-hint">{{ t('staybrain.perReservationHint', { amount }) }}</p>
          </div>

          <div v-else class="field">
            <label class="field-label" for="sb-percent">{{ t('staybrain.percent') }}</label>
            <input
              id="sb-percent"
              v-model.number="draft.earning.percent"
              class="input"
              type="number"
              min="0"
              max="100"
              step="0.1"
            />
          </div>

          <div class="field">
            <label class="field-label" for="sb-rate">{{ t('staybrain.rate') }}</label>
            <input
              id="sb-rate"
              v-model.number="draft.rate"
              class="input"
              type="number"
              min="0"
              step="0.0001"
            />
            <p class="field-hint">{{ t('staybrain.rateHint') }}</p>
          </div>
        </div>
      </fieldset>

      <div class="field">
        <label class="field-label" for="sb-note">{{ t('staybrain.note') }}</label>
        <input id="sb-note" v-model="draft.note" class="input" :maxlength="LIMITS.shortText" />
      </div>

      <label class="check">
        <input v-model="draft.active" type="checkbox" />
        <span>{{ t('staybrain.active') }}</span>
      </label>

      <footer class="dialog-foot">
        <button type="button" class="btn btn-secondary" @click="emit('close')">
          {{ t('common.cancel') }}
        </button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          <span v-if="saving" class="spinner" />
          {{ t('common.save') }}
        </button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
/*
 * `[open]` on the selector, not `.dialog`.
 *
 * A UA stylesheet hides `dialog:not([open])`, and an author rule setting
 * `display` beats it whatever the specificity — which is how a dialog ends up
 * permanently on screen with no way to close it.
 */
.dialog[open] {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  display: block;
  max-height: 90vh;
  max-width: 640px;
  overflow: auto;
  padding: 0;
  width: calc(100vw - 2rem);
}

.dialog-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
}

.dialog-head {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.dialog-title {
  font-size: var(--text-lg);
  font-weight: 600;
  margin: 0;
}

.field-grid {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
}

.terms {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-3);
}

.row {
  display: flex;
  gap: var(--space-2);
}

.narrow {
  max-width: 90px;
}

.check {
  align-items: center;
  display: flex;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.dialog-foot {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

.field-hint.warn {
  align-items: center;
  color: var(--warn-500);
  display: flex;
  gap: 4px;
}

.field-hint.ok {
  align-items: center;
  color: var(--ok-500);
  display: flex;
  gap: 4px;
}
</style>
