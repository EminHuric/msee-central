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
import { saveListing } from '@/api/staybrain'
import { moneyOf } from '@/api/sales'
import { rmsConnectAs } from '@/lib/rms'
import { remembersRmsLogin } from '@/lib/rmsAccounts'
import { LIMITS } from '@/lib/validation'
import { useUiStore } from '@/stores/ui'
import { CURRENCIES, fromMinor, type CurrencyCode } from '@/types/money'
import { EARNING_MODELS, blankListing, type StayBrainListing } from '@/types/staybrain'
import type { Client } from '@/types/business'

const props = defineProps<{ open: boolean; listing: StayBrainListing | null }>()
const emit = defineEmits<{ saved: []; close: [] }>()

const ui = useUiStore()
const { t } = useI18n()

const draft = ref<StayBrainListing>(blankListing())
const amount = ref(0)
const saving = ref(false)

const clients = ref<Client[]>([])

/*
 * The property's own login.
 *
 * WHY THIS REPLACED A LIST OF ACCOUNTS. Picking from a dropdown meant reading
 * every account on the reservation platform, which only an administrator there
 * can do. Signing in as the property's own account needs no such privilege and
 * answers the question better: the account's user id IS its workspace id over
 * there, so a successful sign-in tells us exactly which data this listing points
 * at — no typing an id, and no way to link a property to the wrong client's
 * calendar.
 *
 * The password is used and then remembered by the browser. It is never part of
 * the listing that gets saved.
 */
const rmsEmail = ref('')
const rmsPassword = ref('')
const checking = ref(false)
const linkProblem = ref('')

const linked = computed(() => Boolean(draft.value.rmsWorkspaceId))
const alreadyRemembered = computed(
  () => Boolean(draft.value.rmsAccountEmail) && remembersRmsLogin(draft.value.rmsAccountEmail),
)

watch(
  () => props.open,
  async (open) => {
    if (!open) return

    draft.value = props.listing ? { ...props.listing } : blankListing()
    amount.value = fromMinor(draft.value.earning.amount.minor, draft.value.currency)

    rmsEmail.value = draft.value.rmsAccountEmail
    rmsPassword.value = ''
    linkProblem.value = ''

    clients.value = await fetchClients().catch(() => [])
  },
)

/**
 * Sign in as the property's account, and take its id from the session.
 *
 * This is the whole of linking. Nothing is saved until the sign-in works, so a
 * listing can never end up pointing at an account that does not exist or a
 * password nobody has.
 */
async function linkAccount(): Promise<void> {
  if (checking.value) return

  const email = rmsEmail.value.trim()
  if (!email || !rmsPassword.value) {
    linkProblem.value = t('rms.needBoth')
    return
  }

  checking.value = true
  linkProblem.value = ''
  try {
    const result = await rmsConnectAs(email, rmsPassword.value)

    if (result.state === 'ready') {
      /* The account's own id is its workspace id over there. */
      draft.value.rmsWorkspaceId = result.session.uid
      draft.value.rmsAccountEmail = result.session.email || email
      rmsPassword.value = ''
      return
    }

    linkProblem.value =
      result.state === 'failed'
        ? t('rms.propertyRefused', { code: result.code })
        : t('rms.needBoth')
  } finally {
    checking.value = false
  }
}

/** Unlink, so a property can be pointed at a different account. */
function unlink(): void {
  draft.value.rmsWorkspaceId = ''
  draft.value.rmsAccountEmail = ''
  rmsEmail.value = ''
  rmsPassword.value = ''
  linkProblem.value = ''
}

/** Picking a client fills in the name we store beside the id. */
function onClient(id: string): void {
  const client = clients.value.find((c) => c.id === id)
  draft.value.clientId = id
  draft.value.clientName = client?.name ?? ''
  /* And suggests a listing name, only while the field is still empty. */
  if (!draft.value.name && client) draft.value.name = client.name
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

      <!-- The property's reservation-system login ------------------------- -->
      <div class="field">
        <span class="field-label">{{ t('staybrain.rmsAccount') }}</span>

        <!--
          Linked: say which account, and whether this browser can open it on its
          own. An account linked but not remembered is not broken — it asks for the
          password once on the property screen.
        -->
        <div v-if="linked" class="linked">
          <AppIcon name="check" :size="14" />
          <span class="linked-email">{{ draft.rmsAccountEmail }}</span>
          <span class="tertiary small">
            {{ alreadyRemembered ? t('staybrain.passwordRemembered') : t('staybrain.passwordNeeded') }}
          </span>
          <button type="button" class="btn btn-ghost btn-sm" @click="unlink">
            {{ t('staybrain.changeAccount') }}
          </button>
        </div>

        <template v-else>
          <div class="field-grid">
            <div class="field">
              <label class="field-label" for="sb-rms-email">{{ t('rms.email') }}</label>
              <input
                id="sb-rms-email"
                v-model="rmsEmail"
                class="input"
                type="email"
                autocomplete="off"
                :placeholder="t('staybrain.rmsEmailPlaceholder')"
              />
            </div>
            <div class="field">
              <label class="field-label" for="sb-rms-password">{{ t('rms.password') }}</label>
              <input
                id="sb-rms-password"
                v-model="rmsPassword"
                class="input"
                type="password"
                autocomplete="off"
              />
            </div>
          </div>

          <div class="row">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="checking"
              @click="linkAccount"
            >
              <span v-if="checking" class="spinner" />
              {{ t('staybrain.linkAccount') }}
            </button>
          </div>

          <p v-if="linkProblem" class="field-hint warn">
            <AppIcon name="alert" :size="13" />
            {{ linkProblem }}
          </p>
          <p v-else class="field-hint">{{ t('staybrain.linkHint') }}</p>
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

.linked {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.linked-email {
  font-size: var(--text-sm);
  font-weight: 600;
}

.small {
  font-size: var(--text-xs);
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
