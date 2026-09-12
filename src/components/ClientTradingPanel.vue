<script setup lang="ts">
/**
 * What this client trades, and how much of it is ours.
 *
 * On the client, because that is what the figures are about. They were briefly
 * a page of their own and that was wrong: nobody wants a list of everybody's
 * turnover, they want to open a hotel and see how that hotel is doing.
 *
 * THREE FIGURES, KEPT APART.
 *
 *   Their turnover    everything they took, through every channel
 *   We brought        the part that came from our work
 *   Our share         our commission on that part
 *
 * The middle one is the whole point, and it is the one the RMS cannot tell us:
 * it records reservations, not which of them came from our marketing. So it is
 * recorded here, month by month, with how it was arrived at — reported,
 * measured, or estimated — because a counted figure and an estimate are both
 * useful and are not the same kind of fact.
 *
 * Collapsing the first two would credit us with bookings that would have
 * happened anyway, and a company measuring itself that way cannot tell whether
 * it is working.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import { fetchAttributionFor, saveAttribution } from '@/api/attribution'
import { saveClient } from '@/api/clients'
import { fetchIntake } from '@/api/intake'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { moneyOf } from '@/api/sales'
import { BASE_CURRENCY, formatMoney, fromMinor } from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import {
  ATTRIBUTION_BASES,
  blankAttribution,
  totalsOf,
  type Attribution,
} from '@/types/attribution'
import { tradingFor, type IntakeRow } from '@/types/intake'
import type { Client } from '@/types/business'

const props = defineProps<{ client: Client }>()

const auth = useAuthStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const loading = ref(true)
const saving = ref(false)

const rows = ref<Attribution[]>([])
const reported = ref<IntakeRow[]>([])

const draft = ref<Attribution | null>(null)
const draftTurnover = ref(0)
const draftAttributed = ref(0)

/**
 * Our rate, as agreed with this client.
 *
 * Editable here because this is the screen somebody is on when they notice it
 * is wrong, and saved on the client rather than on the month — it is a term of
 * the agreement, not a fact about September.
 */
const ratePercent = ref(0)
const rateSaving = ref(false)

/**
 * Our share, computed rather than typed.
 *
 * Three numbers that can disagree become two facts and a rule. Somebody typing
 * this in would eventually type it wrong, and nothing would catch it.
 */
const draftShare = computed(() =>
  Math.round(draftAttributed.value * ratePercent.value) / 100,
)

const money = (minor: number) => formatMoney(minor, BASE_CURRENCY, locale.value)

const canEdit = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_CREATE))

const totals = computed(() => totalsOf(rows.value))

/** What the RMS has reported for this client, for comparison. */
const fromRms = computed(() => tradingFor(props.client.id, reported.value))

/** Whether this client is linked to the RMS at all. */
const linked = computed(() =>
  (props.client.externalRefs ?? []).some((ref) => ref.system === 'rms' && ref.reference),
)

async function load(): Promise<void> {
  loading.value = true
  try {
    const [records, intake] = await Promise.all([
      fetchAttributionFor(props.client.id),
      fetchIntake().catch(() => []),
    ])
    rows.value = records
    reported.value = intake
    ratePercent.value = props.client.msEeSharePercent ?? 0
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

function start(): void {
  draft.value = blankAttribution(props.client.id, props.client.name)
  draftTurnover.value = 0
  draftAttributed.value = 0

  /*
   * Prefill the total from what the RMS reported for this month, when it has.
   * The other two stay empty: those are the numbers somebody has to decide, and
   * a prefilled guess would get saved as a measurement.
   */
  const thisMonth = draft.value.period
  const reportedThisMonth = reported.value.filter(
    (r) => r.clientId === props.client.id && r.date.startsWith(thisMonth),
  )
  if (reportedThisMonth.length) {
    const sum = reportedThisMonth.reduce((n, r) => n + (r.turnover?.baseMinor ?? 0), 0)
    draftTurnover.value = fromMinor(sum, BASE_CURRENCY)
    draft.value.basis = 'reported'
  }
}

function edit(row: Attribution): void {
  draft.value = { ...row }
  draftTurnover.value = fromMinor(row.turnover.baseMinor, BASE_CURRENCY)
  draftAttributed.value = fromMinor(row.attributed.baseMinor, BASE_CURRENCY)
}

/** Save the rate on the client, where it belongs. */
async function saveRate(): Promise<void> {
  if (rateSaving.value) return

  rateSaving.value = true
  try {
    await saveClient({ ...props.client, msEeSharePercent: ratePercent.value })
    ui.notify('ok', t('attribution.rateSaved'))
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    rateSaving.value = false
  }
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return

  if (draftAttributed.value > draftTurnover.value) {
    ui.notify('danger', t('attribution.moreThanTotal'))
    return
  }

  saving.value = true
  try {
    await saveAttribution({
      ...d,
      turnover: moneyOf(draftTurnover.value, BASE_CURRENCY),
      attributed: moneyOf(draftAttributed.value, BASE_CURRENCY),
      ourShare: moneyOf(draftShare.value, BASE_CURRENCY),
      note: d.note.trim(),
    })
    ui.notify('ok', t('attribution.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    saving.value = false
  }
}

/** What share of a month we brought, for the row. */
function shareOf(row: Attribution): number | null {
  if (row.turnover.baseMinor <= 0) return null
  return Math.round((row.attributed.baseMinor / row.turnover.baseMinor) * 100)
}

onMounted(load)
</script>

<template>
  <section class="card">
    <div class="card-header">
      <div>
        <h2 class="card-title">{{ t('attribution.title') }}</h2>
        <p class="field-hint">{{ t('attribution.subtitle') }}</p>
      </div>
      <button v-if="canEdit && !draft" class="btn btn-secondary btn-sm" @click="start">
        <AppIcon name="plus" :size="14" />
        {{ t('attribution.addMonth') }}
      </button>
    </div>

    <div v-if="loading" class="card-body stack">
      <div v-for="n in 2" :key="n" class="skeleton" style="height: 44px" />
    </div>

    <template v-else>
      <!--
        Our rate, as agreed with this client.

        Here rather than in the RMS, and that is a deliberate line: the RMS
        manages their property and knows what was booked. What it is worth to
        us is a term in our agreement, and changing our commission should not
        mean editing their booking software.
      -->
      <div v-if="canEdit" class="card-body rate">
        <label class="field-label" for="a-rate">{{ t('attribution.rate') }}</label>
        <div class="rate-row">
          <input
            id="a-rate"
            v-model.number="ratePercent"
            class="input rate-input"
            type="number"
            step="0.1"
            min="0"
            max="100"
          />
          <span class="tertiary">%</span>
          <button class="btn btn-secondary btn-sm" :disabled="rateSaving" @click="saveRate">
            {{ t('common.save') }}
          </button>
        </div>
        <p class="field-hint">{{ t('attribution.rateHint') }}</p>
      </div>

      <!-- The three figures, kept apart on purpose. -->
      <div class="card-body figures">
        <div>
          <span class="figure-label">{{ t('attribution.theirTurnover') }}</span>
          <span class="figure-value">{{ money(totals.turnoverBaseMinor) }}</span>
          <span class="figure-hint">{{ t('attribution.theirTurnoverHint') }}</span>
        </div>

        <div class="lead">
          <span class="figure-label">{{ t('attribution.weBrought') }}</span>
          <span class="figure-value brand">{{ money(totals.attributedBaseMinor) }}</span>
          <span v-if="totals.sharePercent !== null" class="figure-hint">
            {{ t('attribution.ofTheirTrade', { n: totals.sharePercent }) }}
          </span>
        </div>

        <div>
          <span class="figure-label">{{ t('attribution.ourShare') }}</span>
          <span class="figure-value">{{ money(totals.ourShareBaseMinor) }}</span>
          <span class="figure-hint">{{ t('attribution.ourShareHint') }}</span>
        </div>
      </div>

      <!--
        What the RMS reported, when it has. Shown beside our own record rather
        than merged into it: one is what they took, the other is what we claim,
        and seeing them apart is how somebody notices a disagreement.
      -->
      <div v-if="fromRms.days" class="card-body rms">
        <AppIcon name="layers" :size="15" />
        <span>
          {{ t('attribution.rmsReports', {
            turnover: money(fromRms.turnoverBaseMinor),
            reservations: fromRms.reservations,
            nights: fromRms.nights,
          }) }}
          <span class="tertiary">· {{ t('attribution.through', { date: formatDate(fromRms.through) }) }}</span>
        </span>
      </div>

      <div v-else-if="!linked" class="card-body">
        <p class="field-hint">{{ t('attribution.notLinked') }}</p>
      </div>

      <!-- Recording a month -->
      <div v-if="draft" class="card-body stack editor">
        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="a-period">{{ t('attribution.period') }}</label>
            <input id="a-period" v-model="draft.period" class="input" type="month" />
          </div>

          <div class="field">
            <label class="field-label" for="a-total">{{ t('attribution.theirTurnover') }}</label>
            <input
              id="a-total"
              v-model.number="draftTurnover"
              class="input"
              type="number"
              step="0.01"
              min="0"
            />
          </div>

          <div class="field">
            <label class="field-label" for="a-ours">{{ t('attribution.weBrought') }}</label>
            <input
              id="a-ours"
              v-model.number="draftAttributed"
              class="input"
              type="number"
              step="0.01"
              min="0"
            />
            <p class="field-hint">{{ t('attribution.weBroughtHint') }}</p>
          </div>

          <div class="field">
            <span class="field-label">{{ t('attribution.ourShare') }}</span>
            <!--
              Computed, not typed: the rate times what we brought. A field
              somebody fills in is a third number that can disagree with the
              two it is supposed to follow from.
            -->
            <p class="computed">{{ draftShare.toFixed(2) }}</p>
            <p class="field-hint">
              {{ t('attribution.shareFormula', { rate: ratePercent }) }}
            </p>
          </div>

          <div class="field">
            <label class="field-label" for="a-basis">{{ t('attribution.basis') }}</label>
            <select id="a-basis" v-model="draft.basis" class="select">
              <option v-for="b in ATTRIBUTION_BASES" :key="b" :value="b">
                {{ t(`attributionBasis.${b}`) }}
              </option>
            </select>
            <p class="field-hint">{{ t(`attributionBasisHint.${draft.basis}`) }}</p>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="a-note">{{ t('attribution.note') }}</label>
          <input
            id="a-note"
            v-model="draft.note"
            class="input"
            :maxlength="LIMITS.shortText"
            :placeholder="t('attribution.notePlaceholder')"
          />
          <p class="field-hint">{{ t('attribution.noteHint') }}</p>
        </div>

        <div class="row editor-actions">
          <button class="btn btn-secondary" @click="draft = null">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="saving" @click="commit">
            <span v-if="saving" class="spinner" />
            {{ t('common.save') }}
          </button>
        </div>
      </div>

      <!-- Month by month -->
      <div v-if="rows.length === 0" class="empty">
        <span class="empty-icon"><AppIcon name="trending" :size="20" /></span>
        <p class="empty-title">{{ t('attribution.empty') }}</p>
        <p class="empty-text">{{ t('attribution.emptyHint') }}</p>
      </div>

      <div v-else class="table-wrap">
        <table class="table table-cards">
          <thead>
            <tr>
              <th>{{ t('attribution.period') }}</th>
              <th class="num">{{ t('attribution.theirTurnover') }}</th>
              <th class="num">{{ t('attribution.weBrought') }}</th>
              <th class="num hide-sm">{{ t('attribution.share') }}</th>
              <th class="num hide-sm">{{ t('attribution.ourShare') }}</th>
              <th class="hide-sm">{{ t('attribution.basis') }}</th>
              <th class="col-actions" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td class="nowrap strong">{{ row.period }}</td>

              <td class="num" :data-label="t('attribution.theirTurnover')">
                {{ money(row.turnover.baseMinor) }}
              </td>

              <td class="num strong brand" :data-label="t('attribution.weBrought')">
                {{ money(row.attributed.baseMinor) }}
              </td>

              <td class="num hide-sm" :data-label="t('attribution.share')">
                {{ shareOf(row) !== null ? `${shareOf(row)}%` : '—' }}
              </td>

              <td class="num hide-sm" :data-label="t('attribution.ourShare')">
                {{ money(row.ourShare.baseMinor) }}
              </td>

              <td class="hide-sm" :data-label="t('attribution.basis')">
                <span class="badge badge-plain" :class="`basis-${row.basis}`">
                  {{ t(`attributionBasis.${row.basis}`) }}
                </span>
              </td>

              <td class="col-actions">
                <button v-if="canEdit" class="btn btn-ghost btn-sm" @click="edit(row)">
                  {{ t('common.edit') }}
                </button>
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
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
}

.figures > div { display: flex; flex-direction: column; gap: 2px; }

/* What we brought is the figure the page exists for. */
.figures > .lead {
  padding: var(--space-3);
  margin: calc(var(--space-3) * -1);
  border-radius: var(--radius-md);
  background: var(--accent-soft-bg);
}

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

.figure-value.brand { color: var(--text-brand); }
.figure-hint { font-size: var(--text-xs); color: var(--text-tertiary); }

.rms {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-subtle);
}

.rate { border-bottom: 1px solid var(--border-subtle); }
.rate-row { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
.rate-input { max-width: 110px; }

.computed {
  font-size: var(--text-lg);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  padding: var(--space-2) 0;
}

.editor { background: var(--bg-surface-2); border-bottom: 1px solid var(--border-subtle); }
.editor-actions { justify-content: flex-end; }

.brand { color: var(--text-brand); }

/* An estimate should not look like a count. */
.basis-estimated { color: var(--warn-500); border-color: var(--warn-border); background: var(--warn-bg); }
.basis-reported { color: var(--ok-500); border-color: var(--ok-border); background: var(--ok-bg); }
</style>
