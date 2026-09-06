<script setup lang="ts">
/**
 * Leads — the pipeline.
 *
 * Kept out of the client list on purpose. A lead is a conversation that may go
 * nowhere; mixing the two makes every figure about "our clients" quietly wrong.
 *
 * The board is arranged by stage because the useful question is where things
 * are stuck, not who was added last. Winning a lead does not move the record —
 * it creates a client from it and leaves the lead standing as history, so the
 * pipeline still knows what it converted.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { saveClient } from '@/api/clients'
import { fetchEmployees } from '@/api/employees'
import { deleteLead, fetchLeads, saveLead, setLeadStage } from '@/api/operations'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import {
  CLIENT_SOURCES,
  LEAD_STAGES,
  OPEN_STAGES,
  TASK_PRIORITIES,
  type ClientSource,
  type Lead,
  type LeadStage,
  type TaskPriority,
} from '@/types/business'
import {
  BASE_CURRENCY,
  CURRENCIES,
  formatMoney,
  fromMinor,
  makeMoney,
  type CurrencyCode,
} from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import type { EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { t, locale } = useI18n()

const loading = ref(true)
const saving = ref(false)
const leads = ref<Lead[]>([])
const people = ref<EmployeePublic[]>([])
const search = ref('')
const pendingDelete = ref<Lead | null>(null)
const converting = ref<Lead | null>(null)

const canManage = computed(() => auth.hasPermission(PERMISSIONS.LEADS_MANAGE))
const canSeeAll = computed(() => auth.hasPermission(PERMISSIONS.LEADS_VIEW_ALL))
const today = new Date().toISOString().slice(0, 10)

interface Draft {
  id: string
  name: string
  company: string
  email: string
  phone: string
  city: string
  country: string
  source: ClientSource
  sourceDetail: string
  assigneeUid: string
  priority: TaskPriority
  amount: number
  currency: CurrencyCode
  serviceInterest: string
  stage: LeadStage
  nextStep: string
  nextContactDate: string
  notes: string
  lostReason: string
}

const draft = ref<Draft | null>(null)

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

const onlyMine = ref(false)

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()

  return leads.value.filter((l) => {
    if (onlyMine.value && l.assigneeUid !== auth.uid) return false
    if (!term) return true
    return `${l.name} ${l.company} ${l.email} ${l.phone} ${l.serviceInterest}`
      .toLowerCase()
      .includes(term)
  })
})

/** One column per stage, closed stages last and collapsed into a summary. */
const columns = computed(() =>
  OPEN_STAGES.map((stage) => ({
    stage,
    items: visible.value.filter((l) => l.stage === stage),
  })),
)

const closed = computed(() => ({
  won: visible.value.filter((l) => l.stage === 'won'),
  lost: visible.value.filter((l) => l.stage === 'lost'),
}))

/** Only open stages count: a won lead's money is the client's now. */
const pipelineValue = computed(() =>
  visible.value
    .filter((l) => OPEN_STAGES.includes(l.stage))
    .reduce((sum, l) => sum + (l.estimatedValue?.baseMinor ?? 0), 0),
)

/** Days since anything was written on the lead — the "going cold" signal. */
function staleDays(lead: Lead): number {
  const last = lead.updatedAt?.slice(0, 10) ?? lead.createdAt?.slice(0, 10)
  if (!last) return 0
  return Math.floor((Date.parse(today) - Date.parse(last)) / 86_400_000)
}

function nameOf(uid: string): string {
  const person = people.value.find((p) => p.uid === uid)
  return person ? `${person.firstName} ${person.lastName}` : ''
}

async function load(): Promise<void> {
  loading.value = true
  const [rows, staff] = await Promise.all([fetchLeads(), fetchEmployees().catch(() => [])])
  leads.value = rows
  people.value = staff
  loading.value = false
}

function startNew(): void {
  draft.value = {
    id: '',
    name: '',
    company: '',
    email: '',
    phone: '',
    city: '',
    country: '',
    source: 'direct',
    sourceDetail: '',
    assigneeUid: auth.uid ?? '',
    priority: 'normal',
    amount: 0,
    currency: BASE_CURRENCY,
    serviceInterest: '',
    stage: 'new',
    nextStep: '',
    nextContactDate: '',
    notes: '',
    lostReason: '',
  }
}

function startEdit(lead: Lead): void {
  draft.value = {
    id: lead.id,
    name: lead.name,
    company: lead.company ?? '',
    email: lead.email ?? '',
    phone: lead.phone ?? '',
    city: lead.city ?? '',
    country: lead.country ?? '',
    source: lead.source ?? 'direct',
    sourceDetail: lead.sourceDetail ?? '',
    assigneeUid: lead.assigneeUid ?? '',
    priority: lead.priority ?? 'normal',
    amount: fromMinor(lead.estimatedValue?.minor ?? 0, lead.estimatedValue?.currency),
    currency: lead.estimatedValue?.currency ?? BASE_CURRENCY,
    serviceInterest: lead.serviceInterest ?? '',
    stage: lead.stage,
    nextStep: lead.nextStep ?? '',
    nextContactDate: lead.nextContactDate ?? '',
    notes: lead.notes ?? '',
    lostReason: lead.lostReason ?? '',
  }
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.name.trim() && !d.company.trim()) {
    ui.notify('danger', t('clients.nameRequired'))
    return
  }

  saving.value = true
  try {
    await saveLead({
      id: d.id,
      name: d.name.trim(),
      company: d.company.trim(),
      email: d.email.trim(),
      phone: d.phone.trim(),
      city: d.city.trim(),
      country: d.country.trim(),
      source: d.source,
      sourceDetail: d.sourceDetail.trim(),
      assigneeUid: d.assigneeUid || null,
      assigneeName: nameOf(d.assigneeUid),
      priority: d.priority,
      estimatedValue: d.amount ? makeMoney(d.amount, d.currency, 1, today) : null,
      serviceInterest: d.serviceInterest.trim(),
      stage: d.stage,
      nextStep: d.nextStep.trim(),
      nextContactDate: d.nextContactDate || null,
      notes: d.notes.trim(),
      lostReason: d.lostReason.trim(),
      clientId: null,
      /* Preserved so an edit never rewrites who first entered the lead. */
      createdAt: leads.value.find((l) => l.id === d.id)?.createdAt ?? '',
    } as Lead, leads.value.find((l) => l.id === d.id)?.assigneeUid ?? null)
    ui.notify('ok', t('leads.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('leads.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function moveTo(lead: Lead, stage: LeadStage): Promise<void> {
  await setLeadStage(lead, stage)
  await load()
}

/**
 * Convert to a client.
 *
 * The lead is not moved or deleted: it is stamped with the new client's id and
 * left in place. Deleting it would erase where the client came from, which is
 * the one thing a pipeline exists to remember.
 */
async function convert(): Promise<void> {
  const lead = converting.value
  if (!lead || saving.value) return

  saving.value = true
  try {
    const clientId = await saveClient(
      {
        id: '',
        name: lead.company || lead.name,
        contactName: lead.company ? lead.name : '',
        email: lead.email ?? '',
        phone: lead.phone ?? '',
        city: lead.city ?? '',
        country: lead.country ?? '',
        website: '',
        status: 'active',
        notes: [lead.serviceInterest, lead.notes].filter(Boolean).join('\n\n'),
      },
      true,
    )

    await saveLead({ ...lead, stage: 'won', clientId })
    ui.notify('ok', t('leads.converted'))
    converting.value = null
    await router.push(`/clients/${clientId}`)
  } catch {
    ui.notify('danger', t('leads.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value) return
  await deleteLead(pendingDelete.value.id)
  pendingDelete.value = null
  await load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('leads.title') }}</h1>
        <p class="page-subtitle">{{ t('leads.subtitle') }}</p>
      </div>
      <button v-if="canManage && !draft" class="btn btn-primary" @click="startNew">
        <AppIcon name="plus" :size="16" /> {{ t('leads.newLead') }}
      </button>
    </header>

    <!-- Editor --------------------------------------------------------- -->
    <section v-if="draft" class="card editor">
      <div class="card-header">
        <h2 class="card-title">{{ draft.id ? t('leads.editLead') : t('leads.newLead') }}</h2>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="draft = null">
          <AppIcon name="close" :size="18" />
        </button>
      </div>

      <div class="card-body stack">
        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="l-company">{{ t('leads.company') }}</label>
            <input id="l-company" v-model="draft.company" class="input" :maxlength="LIMITS.name" />
          </div>
          <div class="field">
            <label class="field-label" for="l-name">{{ t('leads.name') }}</label>
            <input id="l-name" v-model="draft.name" class="input" :maxlength="LIMITS.name" />
          </div>
          <div class="field">
            <label class="field-label" for="l-email">{{ t('clients.email') }}</label>
            <input id="l-email" v-model="draft.email" class="input" type="email" />
          </div>
          <div class="field">
            <label class="field-label" for="l-phone">{{ t('clients.phone') }}</label>
            <input id="l-phone" v-model="draft.phone" class="input" />
          </div>
          <div class="field">
            <label class="field-label" for="l-city">{{ t('clients.city') }}</label>
            <input id="l-city" v-model="draft.city" class="input" :maxlength="LIMITS.name" />
          </div>
          <div class="field">
            <label class="field-label" for="l-country">{{ t('clients.country') }}</label>
            <input id="l-country" v-model="draft.country" class="input" :maxlength="LIMITS.name" />
          </div>
        </div>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="l-stage">{{ t('leads.stage') }}</label>
            <select id="l-stage" v-model="draft.stage" class="select">
              <option v-for="s in LEAD_STAGES" :key="s" :value="s">{{ t(`leadStage.${s}`) }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="l-value">{{ t('leads.estimatedValue') }}</label>
            <input id="l-value" v-model.number="draft.amount" class="input" type="number" step="0.01" />
          </div>
          <div class="field">
            <label class="field-label" for="l-cur">{{ t('finance.amount') }}</label>
            <select id="l-cur" v-model="draft.currency" class="select">
              <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="l-service">{{ t('leads.serviceInterest') }}</label>
            <input id="l-service" v-model="draft.serviceInterest" class="input" :maxlength="LIMITS.position" />
          </div>
          <div class="field">
            <label class="field-label" for="l-source">{{ t('leads.source') }}</label>
            <select id="l-source" v-model="draft.source" class="select">
              <option v-for="s in CLIENT_SOURCES" :key="s" :value="s">{{ t(`source.${s}`) }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="l-sourced">{{ t('leads.sourceDetail') }}</label>
            <input id="l-sourced" v-model="draft.sourceDetail" class="input" :maxlength="LIMITS.name" />
          </div>
          <div class="field">
            <label class="field-label" for="l-owner">{{ t('table.assignee') }}</label>
            <select id="l-owner" v-model="draft.assigneeUid" class="select">
              <option value="">{{ t('tasks.unassigned') }}</option>
              <option v-for="p in people" :key="p.uid" :value="p.uid">
                {{ p.firstName }} {{ p.lastName }}
              </option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="l-prio">{{ t('table.priority') }}</label>
            <select id="l-prio" v-model="draft.priority" class="select">
              <option v-for="p in TASK_PRIORITIES" :key="p" :value="p">
                {{ t(`taskPriority.${p}`) }}
              </option>
            </select>
          </div>
        </div>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="l-next">{{ t('leads.nextStep') }}</label>
            <input id="l-next" v-model="draft.nextStep" class="input" :maxlength="LIMITS.position" />
            <p class="field-hint">{{ t('leads.nextStepHint') }}</p>
          </div>
          <div class="field">
            <label class="field-label" for="l-nextd">{{ t('leads.nextContact') }}</label>
            <input id="l-nextd" v-model="draft.nextContactDate" class="input" type="date" />
          </div>
          <div v-if="draft.stage === 'lost'" class="field">
            <label class="field-label" for="l-lost">{{ t('leads.lostReason') }}</label>
            <input id="l-lost" v-model="draft.lostReason" class="input" :maxlength="LIMITS.shortText" />
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="l-notes">{{ t('dossier.notes') }}</label>
          <textarea id="l-notes" v-model="draft.notes" class="textarea" :maxlength="LIMITS.longText" />
        </div>
      </div>

      <div class="card-footer">
        <button class="btn btn-secondary" @click="draft = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="commit">
          <span v-if="saving" class="spinner" />{{ t('common.save') }}
        </button>
      </div>
    </section>

    <!-- Summary + search ----------------------------------------------- -->
    <div class="toolbar">
      <div class="search toolbar-grow">
        <AppIcon name="search" :size="16" class="search-icon" />
        <input
          v-model="search"
          class="input search-input"
          type="search"
          :placeholder="t('common.searchPlaceholder')"
          :aria-label="t('common.search')"
        />
      </div>
      <div v-if="canSeeAll" class="segmented">
        <button type="button" :class="{ 'is-on': !onlyMine }" @click="onlyMine = false">
          {{ t('tasks.everyone') }}
        </button>
        <button type="button" :class="{ 'is-on': onlyMine }" @click="onlyMine = true">
          {{ t('tasks.mine') }}
        </button>
      </div>

      <span class="pipeline-total">
        {{ t('leads.pipelineValue') }}: <strong>{{ money(pipelineValue) }}</strong>
      </span>
    </div>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 60px" />
      </div>
    </div>

    <div v-else-if="visible.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="target" :size="20" /></span>
        <p class="empty-title">{{ leads.length === 0 ? t('leads.empty') : t('leads.noMatch') }}</p>
        <p class="empty-text">{{ t('leads.emptyHint') }}</p>
        <button v-if="canManage && leads.length === 0" class="btn btn-primary" @click="startNew">
          {{ t('leads.newLead') }}
        </button>
      </div>
    </div>

    <!-- Pipeline ------------------------------------------------------- -->
    <div v-else class="board">
      <section v-for="column in columns" :key="column.stage" class="column">
        <header class="column-head">
          <span class="column-title">{{ t(`leadStage.${column.stage}`) }}</span>
          <span class="badge badge-plain">{{ column.items.length }}</span>
        </header>

        <div v-if="column.items.length === 0" class="column-empty" />

        <article v-for="lead in column.items" :key="lead.id" class="card lead">
          <button type="button" class="lead-head" @click="startEdit(lead)">
            <span class="lead-name">{{ lead.company || lead.name }}</span>
            <span v-if="lead.company && lead.name" class="tertiary lead-person">{{ lead.name }}</span>
          </button>

          <p v-if="lead.serviceInterest" class="muted lead-line">{{ lead.serviceInterest }}</p>
          <p v-if="lead.assigneeName" class="tertiary lead-line">{{ lead.assigneeName }}</p>

          <p v-if="lead.estimatedValue" class="lead-value">
            {{ money(lead.estimatedValue.baseMinor) }}
          </p>

          <p v-if="lead.nextStep" class="lead-next">
            <AppIcon name="arrowRight" :size="12" />
            {{ lead.nextStep }}
            <span v-if="lead.nextContactDate" class="tertiary">
              · {{ formatDate(lead.nextContactDate) }}
            </span>
          </p>

          <p v-if="staleDays(lead) >= 7" class="lead-stale">
            <AppIcon name="alert" :size="12" /> {{ t('leads.stale', { n: staleDays(lead) }) }}
          </p>

          <div class="lead-foot">
            <select
              class="select tiny"
              :value="lead.stage"
              :aria-label="t('leads.stage')"
              :disabled="!canManage"
              @change="moveTo(lead, ($event.target as HTMLSelectElement).value as LeadStage)"
            >
              <option v-for="s in LEAD_STAGES" :key="s" :value="s">{{ t(`leadStage.${s}`) }}</option>
            </select>
            <button
              v-if="canManage"
              class="btn btn-ghost btn-sm"
              :aria-label="t('common.delete')"
              @click="pendingDelete = lead"
            >
              <AppIcon name="close" :size="13" />
            </button>
          </div>
        </article>
      </section>
    </div>

    <!-- Closed --------------------------------------------------------- -->
    <section v-if="!loading && (closed.won.length || closed.lost.length)" class="card">
      <div class="card-header">
        <h2 class="card-title">{{ t('leadStage.won') }} / {{ t('leadStage.lost') }}</h2>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('leads.company') }}</th>
              <th>{{ t('leads.stage') }}</th>
              <th>{{ t('leads.estimatedValue') }}</th>
              <th>{{ t('leads.lostReason') }}</th>
              <th class="col-actions" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="lead in [...closed.won, ...closed.lost]" :key="lead.id">
              <td>
                <button type="button" class="link" @click="startEdit(lead)">
                  {{ lead.company || lead.name }}
                </button>
              </td>
              <td>
                <span class="badge" :class="lead.stage === 'won' ? 'st-won' : 'st-lost'">
                  {{ t(`leadStage.${lead.stage}`) }}
                </span>
              </td>
              <td class="num">{{ money(lead.estimatedValue?.baseMinor ?? 0) }}</td>
              <td class="muted truncate">{{ lead.lostReason || '—' }}</td>
              <td class="col-actions">
                <button
                  v-if="lead.stage === 'won' && !lead.clientId && canManage"
                  class="btn btn-secondary btn-sm"
                  @click="converting = lead"
                >
                  {{ t('leads.convert') }}
                </button>
                <button
                  v-else-if="lead.clientId"
                  class="btn btn-ghost btn-sm"
                  @click="router.push(`/clients/${lead.clientId}`)"
                >
                  {{ t('leads.alreadyClient') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('common.delete')"
      :message="t('leads.title')"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />

    <ConfirmDialog
      :open="converting !== null"
      :title="t('leads.convert')"
      :message="t('leads.convertHint')"
      @confirm="convert"
      @cancel="converting = null"
    />
  </div>
</template>

<style scoped>
.editor { border-color: var(--accent-soft-border); }
.search { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: var(--space-3); color: var(--text-tertiary); pointer-events: none; }
.search-input { padding-left: calc(var(--space-3) * 2 + 16px); }
.pipeline-total { font-size: var(--text-sm); color: var(--text-secondary); white-space: nowrap; }
.segmented { display: inline-flex; padding: 2px; gap: 2px; background: var(--bg-inset); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); }
.segmented button { padding: 0 var(--space-3); height: 30px; border-radius: var(--radius-sm); font-size: var(--text-sm); font-weight: 550; color: var(--text-tertiary); }
.segmented button.is-on { background: var(--bg-surface-3); color: var(--text-primary); box-shadow: var(--shadow-sm); }
.pipeline-total strong { color: var(--text-brand); font-variant-numeric: tabular-nums; }

.board {
  display: grid;
  grid-template-columns: repeat(5, minmax(200px, 1fr));
  gap: var(--space-3);
  overflow-x: auto;
  padding-bottom: var(--space-2);
}
@media (max-width: 900px) {
  .board { grid-template-columns: repeat(5, 220px); }
}

.column { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.column-head {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-2);
  padding: 0 var(--space-1) var(--space-1);
}
.column-title { font-size: var(--text-xs); font-weight: 650; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.column-empty { height: 2px; border-radius: var(--radius-full); background: var(--border-subtle); }

.lead { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); }
.lead-head { display: flex; flex-direction: column; gap: 1px; text-align: left; }
.lead-name { font-size: var(--text-base); font-weight: 600; }
.lead-head:hover .lead-name { color: var(--text-brand); }
.lead-person, .lead-line { font-size: var(--text-xs); }
.lead-value { font-size: var(--text-sm); font-weight: 650; color: var(--text-brand); font-variant-numeric: tabular-nums; }
.lead-next { display: flex; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--text-secondary); }
.lead-stale { display: flex; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--warn-500); }
.lead-foot { display: flex; align-items: center; gap: var(--space-2); margin-top: auto; }
.select.tiny { height: 28px; font-size: var(--text-xs); flex: 1; min-width: 0; }

.st-won { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.st-lost { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
</style>
