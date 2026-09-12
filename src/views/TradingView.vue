<script setup lang="ts">
/**
 * What we are producing for each client, from the systems that actually run it.
 *
 * The figures here are not MsEe Central's. They are what the RMS reports, day
 * by day, and the totals are summed from those days rather than stored — so a
 * corrected day changes the total and there is no second copy to disagree.
 *
 * Three things are on the page, in the order somebody needs them:
 *
 *   what each client is turning over, and what we earn from it;
 *   rows that arrived and match no client, which is a question for a person;
 *   earnings reported for our own people, waiting to go to their ledger.
 *
 * If nothing has been sent, the page says so plainly rather than showing
 * zeroes that look like a business with no trade.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import { applyEarning, fetchIntake, ignoreRow, matchRows } from '@/api/intake'
import { fetchClients } from '@/api/clients'
import { fetchEmployees } from '@/api/employees'
import { formatDate } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { BASE_CURRENCY, formatMoney } from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import type { IntakeRow } from '@/types/intake'
import type { Client } from '@/types/business'
import type { EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const loading = ref(true)
const busy = ref(false)

const rows = ref<IntakeRow[]>([])
const clients = ref<Client[]>([])
const people = ref<EmployeePublic[]>([])

const money = (minor: number) => formatMoney(minor, BASE_CURRENCY, locale.value)

const canApply = computed(() => auth.hasPermission(PERMISSIONS.WALLET_ADJUST))
const canEdit = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_EDIT))

/** Arrived, and belongs to nobody we know. A question, not an error. */
const unmatched = computed(() =>
  rows.value.filter((r) => r.kind === 'client_day' && !r.clientId && r.status !== 'ignored'),
)

/** Earnings the RMS reported that have not reached a ledger yet. */
const pendingEarnings = computed(() =>
  rows.value.filter((r) => r.kind === 'employee_earning' && r.status !== 'applied' && r.status !== 'ignored'),
)

const hasAnything = computed(() => rows.value.length > 0)

/**
 * Who an earning is about.
 *
 * Matched on the reference recorded against the person, falling back to an
 * exact name. The fallback is deliberately strict — a near match would put
 * money in the wrong ledger, which is the one mistake here that costs real
 * money.
 */
function personFor(row: IntakeRow): EmployeePublic | undefined {
  const ref = row.externalEmployeeRef.trim().toLowerCase()
  const name = row.externalEmployeeName.trim().toLowerCase()

  return people.value.find((p) => {
    const full = `${p.firstName} ${p.lastName}`.trim().toLowerCase()
    return (ref && p.employeeCode?.toLowerCase() === ref) || (name && full === name)
  })
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const [intake, c, e] = await Promise.all([
      fetchIntake(),
      fetchClients().catch(() => []),
      fetchEmployees().catch(() => []),
    ])
    rows.value = intake
    clients.value = c
    people.value = e
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function runMatch(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const matched = await matchRows(rows.value, clients.value)
    ui.notify(matched ? 'ok' : 'info', t('trading.matched', { n: matched }))
    if (matched) await load()
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    busy.value = false
  }
}

async function apply(row: IntakeRow): Promise<void> {
  const person = personFor(row)
  if (!person) {
    ui.notify('danger', t('trading.noPerson'))
    return
  }

  busy.value = true
  try {
    await applyEarning(row, {
      uid: person.uid,
      name: `${person.firstName} ${person.lastName}`.trim(),
    })
    ui.notify('ok', t('trading.applied'))
    await load()
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    busy.value = false
  }
}

async function setAside(row: IntakeRow): Promise<void> {
  busy.value = true
  try {
    await ignoreRow(row, row.note)
    await load()
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('trading.title') }}</h1>
        <p class="page-subtitle">{{ t('trading.subtitle') }}</p>
      </div>
      <button v-if="canEdit && hasAnything" class="btn btn-secondary" :disabled="busy" @click="runMatch">
        <AppIcon name="check" :size="15" />
        {{ t('trading.match') }}
      </button>
    </header>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 52px" />
      </div>
    </div>

    <!--
      Nothing has been sent. Said plainly, with what to do about it, rather
      than drawn as a set of zeroes that look like a business with no trade.
    -->
    <div v-else-if="!hasAnything" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="layers" :size="20" /></span>
        <p class="empty-title">{{ t('trading.empty') }}</p>
        <p class="empty-text">{{ t('trading.emptyHint') }}</p>
      </div>
    </div>

    <template v-else>
      <!-- Earnings waiting to reach a ledger -->
      <section v-if="pendingEarnings.length" class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('trading.earnings') }}</h2>
          <span class="tertiary small">{{ t('trading.earningsHint') }}</span>
        </div>

        <div class="table-wrap">
          <table class="table table-cards">
            <thead>
              <tr>
                <th>{{ t('table.date') }}</th>
                <th>{{ t('trading.person') }}</th>
                <th class="num">{{ t('table.amount') }}</th>
                <th class="col-actions" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in pendingEarnings" :key="row.id">
                <td class="nowrap muted">{{ formatDate(row.date) }}</td>
                <td :data-label="t('trading.person')">
                  <span class="stack-tight">
                    <span>{{ row.externalEmployeeName || row.externalEmployeeRef }}</span>
                    <span v-if="!personFor(row)" class="danger small">
                      {{ t('trading.noPerson') }}
                    </span>
                  </span>
                </td>
                <td class="num strong" :data-label="t('table.amount')">
                  {{ money(row.earning?.baseMinor ?? 0) }}
                </td>
                <td class="col-actions">
                  <button
                    v-if="canApply && personFor(row)"
                    class="btn btn-secondary btn-sm"
                    :disabled="busy"
                    @click="apply(row)"
                  >
                    {{ t('trading.apply') }}
                  </button>
                  <button v-if="canEdit" class="btn btn-ghost btn-sm" :disabled="busy" @click="setAside(row)">
                    {{ t('trading.setAside') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Rows that belong to nobody we know -->
      <section v-if="unmatched.length" class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('trading.unmatched') }}</h2>
          <span class="tertiary small">{{ t('trading.unmatchedHint') }}</span>
        </div>

        <div class="table-wrap">
          <table class="table table-cards">
            <thead>
              <tr>
                <th>{{ t('table.date') }}</th>
                <th>{{ t('trading.theirReference') }}</th>
                <th class="num hide-sm">{{ t('trading.turnover') }}</th>
                <th class="col-actions" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in unmatched" :key="row.id">
                <td class="nowrap muted">{{ formatDate(row.date) }}</td>
                <td :data-label="t('trading.theirReference')">
                  <span class="stack-tight">
                    <span class="strong">{{ row.externalClientName || '—' }}</span>
                    <span class="mono tertiary small">{{ row.externalClientRef }}</span>
                  </span>
                </td>
                <td class="num hide-sm" :data-label="t('trading.turnover')">
                  {{ money(row.turnover?.baseMinor ?? 0) }}
                </td>
                <td class="col-actions">
                  <button v-if="canEdit" class="btn btn-ghost btn-sm" :disabled="busy" @click="setAside(row)">
                    {{ t('trading.setAside') }}
                  </button>
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

.figure { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4) var(--space-5); }

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

.brand { color: var(--text-brand); }
.danger { color: var(--danger-500); }
</style>
