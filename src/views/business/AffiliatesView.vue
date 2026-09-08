<script setup lang="ts">
/**
 * The affiliate programme.
 *
 * Two completely different pages behind one route, because two completely
 * different people open it.
 *
 * A PARTNER sees their own panel: submit a lead, watch what happened to the
 * ones they submitted, and see what they have earned. Nothing else — and that
 * is enforced by the rules, not by this file choosing what to render.
 *
 * The COMPANY sees the programme: who the partners are, the commission rules
 * that decide what they get, and the commissions waiting for a decision.
 *
 * The sequence that matters, printed at the top of both: a submitted lead
 * earns nothing. Commission follows a payment that actually arrived, and then
 * only after somebody approves it — and never the person it belongs to.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import {
  blankAffiliate,
  deleteAffiliate,
  fetchAffiliates,
  fetchMyAffiliate,
  resultFor,
  saveAffiliate,
} from '@/api/affiliates'
import { fetchCommissions, setCommissionStatus } from '@/api/finance'
import { fetchEmployees } from '@/api/employees'
import { blankLead, fetchLeads, fetchLeadsBy, fetchServices, saveLead } from '@/api/operations'
import { fetchSales } from '@/api/sales'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import type { Lead, Service } from '@/types/business'
import {
  AFFILIATE_TYPES,
  COMMISSION_MODELS,
  COMMISSION_STATUSES,
  type Affiliate,
  type Commission,
  type CommissionRule,
  type Sale,
} from '@/types/revenue'
import { BASE_CURRENCY, formatMoney, fromMinor, toMinor } from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import type { EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const loading = ref(true)
const saving = ref(false)

const affiliates = ref<Affiliate[]>([])
const commissions = ref<Commission[]>([])
const leads = ref<Lead[]>([])
const sales = ref<Sale[]>([])
const services = ref<Service[]>([])
const people = ref<EmployeePublic[]>([])
const mine = ref<Affiliate | null>(null)

type Tab = 'partners' | 'commissions'
const tab = ref<Tab>('partners')
const search = ref('')
const statusFilter = ref<Commission['status'] | ''>('')

const draft = ref<Affiliate | null>(null)
const ruleAmounts = ref<Record<string, number>>({})
const pendingDelete = ref<Affiliate | null>(null)

/* The partner's own lead form. */
const leadDraft = ref<Lead | null>(null)

const canView = computed(() => auth.hasPermission(PERMISSIONS.AFFILIATES_VIEW))
const canManage = computed(() => auth.hasPermission(PERMISSIONS.AFFILIATES_MANAGE))
const canApprove = computed(() => auth.hasPermission(PERMISSIONS.COMMISSIONS_APPROVE))
const isPartner = computed(() => !canView.value && mine.value !== null)

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

/* ---- Company view ---------------------------------------------------- */

const results = computed(
  () =>
    new Map(
      affiliates.value.map((a) => [a.id, resultFor(a, leads.value, sales.value, commissions.value)]),
    ),
)

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return affiliates.value
  return affiliates.value.filter((a) => `${a.name} ${a.email}`.toLowerCase().includes(term))
})

const visibleCommissions = computed(() =>
  commissions.value.filter((c) => !statusFilter.value || c.status === statusFilter.value),
)

const totals = computed(() => {
  const sum = (status: Commission['status']) =>
    commissions.value.filter((c) => c.status === status).reduce((n, c) => n + c.amountBaseMinor, 0)

  return { pending: sum('pending'), approved: sum('approved'), paid: sum('paid') }
})

/** Nobody approves their own. Checked here and refused by the rules as well. */
function isOwn(commission: Commission): boolean {
  return !!commission.affiliateEmployeeUid && commission.affiliateEmployeeUid === auth.uid
}

/* ---- Partner view ---------------------------------------------------- */

const myResult = computed(() =>
  mine.value ? resultFor(mine.value, leads.value, sales.value, commissions.value) : null,
)

const myLeads = computed(() =>
  leads.value.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
)

const myCommissions = computed(() =>
  commissions.value.filter((c) => c.affiliateId === mine.value?.id),
)

async function load(): Promise<void> {
  loading.value = true
  try {

    const affiliate = auth.uid ? await fetchMyAffiliate(auth.uid).catch(() => null) : null
    mine.value = affiliate

    /*
     * A partner reads only what is theirs. The narrower query is not a security
     * measure — the rules already refuse the rest — it is simply the one that
     * returns anything for them.
     */
    const partnerOnly = !auth.hasPermission(PERMISSIONS.LEADS_VIEW_ALL)

    const [a, c, l, s, sv, p] = await Promise.all([
      fetchAffiliates().catch(() => []),
      fetchCommissions().catch(() => []),
      (partnerOnly && auth.uid ? fetchLeadsBy(auth.uid) : fetchLeads()).catch(() => []),
      fetchSales().catch(() => []),
      fetchServices().catch(() => []),
      fetchEmployees().catch(() => []),
    ])

    affiliates.value = a
    commissions.value = c
    leads.value = l
    sales.value = s
    services.value = sv
    people.value = p
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

/* ---- Affiliate editor ------------------------------------------------ */

function startNew(): void {
  draft.value = blankAffiliate()
  ruleAmounts.value = {}
}

function startEdit(affiliate: Affiliate): void {
  draft.value = { ...affiliate, rules: (affiliate.rules ?? []).map((r) => ({ ...r })) }
  ruleAmounts.value = Object.fromEntries(
    (affiliate.rules ?? []).map((r) => [r.id, fromMinor(r.fixedBaseMinor ?? 0, BASE_CURRENCY)]),
  )
}

function blankRule(): CommissionRule {
  return {
    id: Math.random().toString(36).slice(2, 10),
    serviceId: null,
    serviceName: '',
    model: 'percentage',
    percent: 10,
    fixedBaseMinor: 0,
    recurring: true,
    requiresFullPayment: false,
    note: '',
  }
}

function addRule(): void {
  const rule = blankRule()
  draft.value?.rules.push(rule)
  ruleAmounts.value[rule.id] = 0
}

function onEmployeeChange(uid: string): void {
  const d = draft.value
  if (!d) return
  d.employeeUid = uid || null
  const person = people.value.find((p) => p.uid === uid)
  if (person && !d.name) d.name = `${person.firstName} ${person.lastName}`
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.name.trim()) {
    ui.notify('danger', t('affiliates.nameRequired'))
    return
  }

  saving.value = true
  try {
    await saveAffiliate({
      ...d,
      name: d.name.trim(),
      employeeUid: d.employeeUid || null,
      rules: d.rules.map((r) => ({
        ...r,
        serviceName: services.value.find((s) => s.id === r.serviceId)?.name ?? '',
        fixedBaseMinor: toMinor(ruleAmounts.value[r.id] ?? 0, BASE_CURRENCY),
      })),
    })
    ui.notify('ok', t('affiliates.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('affiliates.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function decide(commission: Commission, status: Commission['status']): Promise<void> {
  if (isOwn(commission)) {
    ui.notify('danger', t('affiliates.approveOwn'))
    return
  }

  try {
    await setCommissionStatus(commission, status)
    ui.notify('ok', t('affiliates.statusChanged'))
    await load()
  } catch {
    ui.notify('danger', t('affiliates.saveFailed'))
  }
}

async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value) return
  await deleteAffiliate(pendingDelete.value)
  ui.notify('ok', t('recycle.movedToBin'))
  pendingDelete.value = null
  await load()
}

/* ---- Partner submits a lead ------------------------------------------ */

function startLead(): void {
  const affiliate = mine.value
  leadDraft.value = {
    ...blankLead(null, ''),
    source: 'affiliate',
    affiliateId: affiliate?.id ?? null,
    affiliateName: affiliate?.name ?? '',
  }
}

async function commitLead(): Promise<void> {
  const d = leadDraft.value
  if (!d || saving.value) return
  if (!d.name.trim() && !d.company.trim()) {
    ui.notify('danger', t('leads.nameRequired'))
    return
  }

  saving.value = true
  try {
    await saveLead(d)
    ui.notify('ok', t('affiliates.leadSubmitted'))
    leadDraft.value = null
    await load()
  } catch {
    ui.notify('danger', t('leads.saveFailed'))
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('affiliates.title') }}</h1>
        <p class="page-subtitle">
          {{ isPartner ? t('affiliates.partnerSubtitle') : t('affiliates.subtitle') }}
        </p>
      </div>

      <button v-if="isPartner && !leadDraft" class="btn btn-primary" @click="startLead">
        <AppIcon name="plus" :size="16" /> {{ t('affiliates.submitLead') }}
      </button>
      <button v-else-if="canManage && !draft" class="btn btn-primary" @click="startNew">
        <AppIcon name="plus" :size="16" /> {{ t('affiliates.newAffiliate') }}
      </button>
    </header>

    <div class="flow">
      <AppIcon name="gift" :size="16" />
      <div>
        <p class="flow-line">{{ t('affiliates.flow') }}</p>
        <p class="flow-hint">{{ t('affiliates.flowHint') }}</p>
      </div>
    </div>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 60px" />
      </div>
    </div>

    <!-- ============================ PARTNER ============================ -->
    <template v-else-if="isPartner">
      <section v-if="leadDraft" class="card editor">
        <div class="card-header">
          <h2 class="card-title">{{ t('affiliates.submitLead') }}</h2>
          <button
            class="btn btn-ghost btn-icon"
            :aria-label="t('common.close')"
            @click="leadDraft = null"
          >
            <AppIcon name="close" :size="18" />
          </button>
        </div>

        <div class="card-body stack">
          <p class="field-hint">{{ t('affiliates.submitHint') }}</p>

          <div class="field-grid">
            <div class="field">
              <label class="field-label" for="al-company">{{ t('leads.company') }}</label>
              <input id="al-company" v-model="leadDraft.company" class="input" :maxlength="LIMITS.name" />
            </div>
            <div class="field">
              <label class="field-label" for="al-name">{{ t('leads.name') }}</label>
              <input id="al-name" v-model="leadDraft.name" class="input" :maxlength="LIMITS.name" />
            </div>
            <div class="field">
              <label class="field-label" for="al-phone">{{ t('clients.phone') }}</label>
              <input id="al-phone" v-model="leadDraft.phone" class="input" />
            </div>
            <div class="field">
              <label class="field-label" for="al-email">{{ t('clients.email') }}</label>
              <input id="al-email" v-model="leadDraft.email" class="input" type="email" />
            </div>
            <div class="field">
              <label class="field-label" for="al-service">{{ t('leads.serviceInterest') }}</label>
              <select id="al-service" v-model="leadDraft.serviceId" class="select">
                <option :value="null">—</option>
                <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="al-city">{{ t('clients.city') }}</label>
              <input id="al-city" v-model="leadDraft.city" class="input" :maxlength="LIMITS.name" />
            </div>
          </div>

          <div class="field">
            <label class="field-label" for="al-desc">{{ t('leads.description') }}</label>
            <textarea id="al-desc" v-model="leadDraft.notes" class="textarea" :maxlength="LIMITS.longText" />
          </div>
        </div>

        <div class="card-footer">
          <button class="btn btn-secondary" @click="leadDraft = null">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="saving" @click="commitLead">
            <span v-if="saving" class="spinner" />{{ t('affiliates.submitLead') }}
          </button>
        </div>
      </section>

      <div class="figures">
        <article class="card figure">
          <span class="figure-label">{{ t('affiliates.leads') }}</span>
          <span class="figure-value">{{ myResult?.leads ?? 0 }}</span>
        </article>
        <article class="card figure">
          <span class="figure-label">{{ t('affiliates.wonLeads') }}</span>
          <span class="figure-value pos">{{ myResult?.wonLeads ?? 0 }}</span>
        </article>
        <article class="card figure">
          <span class="figure-label">{{ t('affiliates.pending') }}</span>
          <span class="figure-value warn">{{ money(myResult?.pendingBaseMinor ?? 0) }}</span>
        </article>
        <article class="card figure">
          <span class="figure-label">{{ t('affiliates.paid') }}</span>
          <span class="figure-value pos">{{ money(myResult?.paidBaseMinor ?? 0) }}</span>
        </article>
      </div>

      <section class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('affiliates.myLeads') }}</h2>
        </div>

        <div v-if="myLeads.length === 0" class="empty">
          <span class="empty-icon"><AppIcon name="target" :size="20" /></span>
          <p class="empty-title">{{ t('affiliates.noLeads') }}</p>
          <p class="empty-text">{{ t('affiliates.noLeadsHint') }}</p>
          <button class="btn btn-primary" @click="startLead">{{ t('affiliates.submitLead') }}</button>
        </div>

        <div v-else class="table-wrap">
          <table class="table table-cards">
            <thead>
              <tr>
                <th>{{ t('leads.name') }}</th>
                <th class="hide-sm">{{ t('leads.serviceInterest') }}</th>
                <th>{{ t('leads.stage') }}</th>
                <th class="hide-sm">{{ t('table.date') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="lead in myLeads" :key="lead.id">
                <td class="strong">{{ lead.company || lead.name }}</td>
                <td :data-label="t('leads.serviceInterest')" class="hide-sm muted">{{ lead.serviceInterest || '—' }}</td>
                <td :data-label="t('leads.stage')">
                  <span class="badge" :class="`ls-${lead.stage}`">
                    {{ t(`leadStage.${lead.stage}`) }}
                  </span>
                </td>
                <td :data-label="t('table.date')" class="hide-sm muted nowrap">
                  {{ lead.createdAt ? formatDate(lead.createdAt.slice(0, 10)) : '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('affiliates.commissions') }}</h2>
        </div>

        <p v-if="myCommissions.length === 0" class="card-body tertiary small">
          {{ t('affiliates.noCommissions') }}
        </p>

        <div v-else class="table-wrap">
          <table class="table table-cards">
            <thead>
              <tr>
                <th>{{ t('sales.dealTitle') }}</th>
                <th class="hide-sm">{{ t('table.date') }}</th>
                <th>{{ t('table.status') }}</th>
                <th class="num">{{ t('table.amount') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in myCommissions" :key="c.id">
                <td>{{ c.saleTitle }}</td>
                <td :data-label="t('table.date')" class="hide-sm muted nowrap">{{ formatDate(c.earnedDate) }}</td>
                <td :data-label="t('table.status')">
                  <span class="badge" :class="`cs-${c.status}`">
                    {{ t(`commissionStatus.${c.status}`) }}
                  </span>
                </td>
                <td :data-label="t('table.amount')" class="num strong">{{ money(c.amountBaseMinor) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!-- ============================ COMPANY ============================ -->
    <template v-else-if="canView">
      <div class="tabs" role="tablist">
        <button
          v-for="key in (['partners', 'commissions'] as Tab[])"
          :key="key"
          type="button"
          role="tab"
          class="tab"
          :class="{ 'is-active': tab === key }"
          :aria-selected="tab === key"
          @click="tab = key"
        >
          {{ key === 'partners' ? t('affiliates.partners') : t('affiliates.commissions') }}
        </button>
      </div>

      <!-- Editor ----------------------------------------------------- -->
      <section v-if="draft" class="card editor">
        <div class="card-header">
          <h2 class="card-title">
            {{ draft.id ? t('affiliates.editAffiliate') : t('affiliates.newAffiliate') }}
          </h2>
          <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="draft = null">
            <AppIcon name="close" :size="18" />
          </button>
        </div>

        <div class="card-body stack">
          <div class="field-grid">
            <div class="field">
              <label class="field-label" for="a-type">{{ t('affiliates.type') }}</label>
              <select id="a-type" v-model="draft.type" class="select">
                <option v-for="ty in AFFILIATE_TYPES" :key="ty" :value="ty">
                  {{ t(`affiliateType.${ty}`) }}
                </option>
              </select>
            </div>

            <div class="field">
              <label class="field-label" for="a-name">
                {{ t('affiliates.name') }}<span class="req">*</span>
              </label>
              <input id="a-name" v-model="draft.name" class="input" :maxlength="LIMITS.name" />
            </div>

            <div class="field">
              <label class="field-label" for="a-emp">{{ t('affiliates.account') }}</label>
              <select
                id="a-emp"
                :value="draft.employeeUid ?? ''"
                class="select"
                @change="onEmployeeChange(($event.target as HTMLSelectElement).value)"
              >
                <option value="">—</option>
                <option v-for="p in people" :key="p.uid" :value="p.uid">
                  {{ p.firstName }} {{ p.lastName }}
                </option>
              </select>
              <p class="field-hint">{{ t('affiliates.accountHint') }}</p>
            </div>

            <div class="field">
              <label class="field-label" for="a-email">{{ t('clients.email') }}</label>
              <input id="a-email" v-model="draft.email" class="input" type="email" />
            </div>

            <div class="field">
              <label class="field-label" for="a-phone">{{ t('clients.phone') }}</label>
              <input id="a-phone" v-model="draft.phone" class="input" />
            </div>

            <div class="field">
              <label class="field-label" for="a-status">{{ t('table.status') }}</label>
              <select id="a-status" v-model="draft.status" class="select">
                <option value="active">{{ t('organisation.statusActive') }}</option>
                <option value="paused">{{ t('clientStatus.paused') }}</option>
                <option value="ended">{{ t('organisation.statusInactive') }}</option>
              </select>
            </div>
          </div>

          <!-- Commission rules ---------------------------------------- -->
          <div class="rules">
            <div class="rules-head">
              <h3 class="rules-title">{{ t('affiliates.rules') }}</h3>
              <button class="btn btn-secondary btn-sm" @click="addRule">
                <AppIcon name="plus" :size="14" /> {{ t('affiliates.addRule') }}
              </button>
            </div>
            <p class="field-hint">{{ t('affiliates.rulesHint') }}</p>

            <div v-for="(rule, i) in draft.rules" :key="rule.id" class="rule card">
              <div class="field-grid">
                <div class="field">
                  <label class="field-label" :for="`r-svc-${i}`">{{ t('affiliates.ruleService') }}</label>
                  <select :id="`r-svc-${i}`" v-model="rule.serviceId" class="select">
                    <option :value="null">{{ t('affiliates.ruleAnyService') }}</option>
                    <option v-for="s in services" :key="s.id" :value="s.id">{{ s.name }}</option>
                  </select>
                </div>

                <div class="field">
                  <label class="field-label" :for="`r-model-${i}`">{{ t('affiliates.ruleModel') }}</label>
                  <select :id="`r-model-${i}`" v-model="rule.model" class="select">
                    <option v-for="m in COMMISSION_MODELS" :key="m" :value="m">
                      {{ t(`commissionModel.${m}`) }}
                    </option>
                  </select>
                </div>

                <div v-if="rule.model === 'percentage'" class="field">
                  <label class="field-label" :for="`r-pct-${i}`">{{ t('affiliates.rulePercent') }}</label>
                  <input :id="`r-pct-${i}`" v-model.number="rule.percent" class="input" type="number" min="0" max="100" />
                </div>

                <div v-else class="field">
                  <label class="field-label" :for="`r-fix-${i}`">{{ t('affiliates.ruleFixed') }}</label>
                  <input :id="`r-fix-${i}`" v-model.number="ruleAmounts[rule.id]" class="input" type="number" step="0.01" />
                </div>

                <div class="field">
                  <label class="field-label" :for="`r-note-${i}`">{{ t('affiliates.ruleNote') }}</label>
                  <input :id="`r-note-${i}`" v-model="rule.note" class="input" :maxlength="LIMITS.name" />
                </div>
              </div>

              <div class="rule-foot">
                <label class="check">
                  <input v-model="rule.recurring" type="checkbox" />
                  <span class="check-text">{{ t('affiliates.ruleRecurring') }}</span>
                </label>
                <label class="check">
                  <input v-model="rule.requiresFullPayment" type="checkbox" />
                  <span class="check-text">{{ t('affiliates.ruleFullPayment') }}</span>
                </label>
                <span class="spacer" />
                <button
                  class="btn btn-ghost btn-sm danger"
                  :aria-label="t('common.delete')"
                  @click="draft.rules.splice(i, 1)"
                >
                  <AppIcon name="trash" :size="14" />
                </button>
              </div>
            </div>
          </div>

          <div class="field">
            <label class="field-label" for="a-notes">{{ t('clients.notes') }}</label>
            <textarea id="a-notes" v-model="draft.notes" class="textarea" :maxlength="LIMITS.longText" />
          </div>
        </div>

        <div class="card-footer">
          <button class="btn btn-secondary" @click="draft = null">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="saving" @click="commit">
            <span v-if="saving" class="spinner" />{{ t('common.save') }}
          </button>
        </div>
      </section>

      <!-- Partners ---------------------------------------------------- -->
      <template v-if="tab === 'partners'">
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
        </div>

        <div v-if="visible.length === 0" class="card">
          <div class="empty">
            <span class="empty-icon"><AppIcon name="gift" :size="20" /></span>
            <p class="empty-title">{{ t('affiliates.empty') }}</p>
            <p class="empty-text">{{ t('affiliates.emptyHint') }}</p>
            <button v-if="canManage" class="btn btn-primary" @click="startNew">
              {{ t('affiliates.newAffiliate') }}
            </button>
          </div>
        </div>

        <div v-else class="grid">
          <article v-for="a in visible" :key="a.id" class="card partner">
            <div class="partner-head">
              <UserAvatar :name="a.name" :size="36" />
              <div class="partner-id">
                <h2 class="partner-name">{{ a.name }}</h2>
                <span class="tertiary">{{ t(`affiliateType.${a.type}`) }}</span>
              </div>
              <span class="badge" :class="a.status === 'active' ? 'st-on' : 'st-off'">
                {{ a.status === 'active' ? t('organisation.statusActive') : t('organisation.statusInactive') }}
              </span>
            </div>

            <dl class="activity">
              <div>
                <dt>{{ t('affiliates.leads') }}</dt>
                <dd>{{ results.get(a.id)?.leads ?? 0 }}</dd>
              </div>
              <div>
                <dt>{{ t('affiliates.wonLeads') }}</dt>
                <dd>{{ results.get(a.id)?.wonLeads ?? 0 }}</dd>
              </div>
              <div>
                <dt>{{ t('affiliates.sales') }}</dt>
                <dd>{{ results.get(a.id)?.sales ?? 0 }}</dd>
              </div>
              <div>
                <dt>{{ t('sales.sold') }}</dt>
                <dd>{{ money(results.get(a.id)?.salesValueBaseMinor ?? 0) }}</dd>
              </div>
            </dl>

            <dl class="earnings">
              <div>
                <dt>{{ t('affiliates.pending') }}</dt>
                <dd class="warn">{{ money(results.get(a.id)?.pendingBaseMinor ?? 0) }}</dd>
              </div>
              <div>
                <dt>{{ t('affiliates.approved') }}</dt>
                <dd>{{ money(results.get(a.id)?.approvedBaseMinor ?? 0) }}</dd>
              </div>
              <div>
                <dt>{{ t('affiliates.paid') }}</dt>
                <dd class="pos">{{ money(results.get(a.id)?.paidBaseMinor ?? 0) }}</dd>
              </div>
            </dl>

            <div class="partner-foot">
              <span class="tertiary small">
                {{ (a.rules ?? []).length }} · {{ t('affiliates.rules') }}
              </span>
              <span class="spacer" />
              <button v-if="canManage" class="btn btn-ghost btn-sm" @click="startEdit(a)">
                {{ t('common.edit') }}
              </button>
              <button
                v-if="canManage"
                class="btn btn-ghost btn-sm danger"
                :aria-label="t('common.delete')"
                @click="pendingDelete = a"
              >
                <AppIcon name="trash" :size="14" />
              </button>
            </div>
          </article>
        </div>
      </template>

      <!-- Commissions ------------------------------------------------- -->
      <template v-else>
        <div class="figures">
          <article class="card figure">
            <span class="figure-label">{{ t('affiliates.pending') }}</span>
            <span class="figure-value warn">{{ money(totals.pending) }}</span>
          </article>
          <article class="card figure">
            <span class="figure-label">{{ t('affiliates.approved') }}</span>
            <span class="figure-value">{{ money(totals.approved) }}</span>
          </article>
          <article class="card figure">
            <span class="figure-label">{{ t('affiliates.paid') }}</span>
            <span class="figure-value pos">{{ money(totals.paid) }}</span>
          </article>
        </div>

        <div class="toolbar">
          <select v-model="statusFilter" class="select compact" :aria-label="t('table.status')">
            <option value="">{{ t('clients.allStatuses') }}</option>
            <option v-for="s in COMMISSION_STATUSES" :key="s" :value="s">
              {{ t(`commissionStatus.${s}`) }}
            </option>
          </select>
        </div>

        <div v-if="visibleCommissions.length === 0" class="card">
          <div class="empty">
            <span class="empty-icon"><AppIcon name="wallet" :size="20" /></span>
            <p class="empty-title">{{ t('affiliates.noCommissions') }}</p>
            <p class="empty-text">{{ t('affiliates.noCommissionsHint') }}</p>
          </div>
        </div>

        <section v-else class="card">
          <div class="table-wrap">
            <table class="table table-cards">
              <thead>
                <tr>
                  <th>{{ t('affiliates.name') }}</th>
                  <th class="hide-sm">{{ t('sales.dealTitle') }}</th>
                  <th class="hide-md">{{ t('affiliates.ruleModel') }}</th>
                  <th class="num">{{ t('table.amount') }}</th>
                  <th class="hide-sm">{{ t('table.date') }}</th>
                  <th>{{ t('table.status') }}</th>
                  <th class="col-actions" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in visibleCommissions" :key="c.id">
                  <td class="strong">{{ c.affiliateName }}</td>
                  <td :data-label="t('sales.dealTitle')" class="hide-sm muted">{{ c.saleTitle }}</td>
                  <td :data-label="t('affiliates.ruleModel')" class="hide-md muted">
                    {{ c.ruleDescription }}
                    <span class="tertiary small">· {{ money(c.baseAmountBaseMinor) }}</span>
                  </td>
                  <td :data-label="t('table.amount')" class="num strong">{{ money(c.amountBaseMinor) }}</td>
                  <td :data-label="t('table.date')" class="hide-sm muted nowrap">{{ formatDate(c.earnedDate) }}</td>
                  <td :data-label="t('table.status')">
                    <span class="badge" :class="`cs-${c.status}`">
                      {{ t(`commissionStatus.${c.status}`) }}
                    </span>
                  </td>
                  <td class="col-actions">
                    <template v-if="canApprove && !isOwn(c)">
                      <button
                        v-if="c.status === 'pending'"
                        class="btn btn-primary btn-sm"
                        @click="decide(c, 'approved')"
                      >
                        {{ t('affiliates.approve') }}
                      </button>
                      <button
                        v-if="c.status === 'approved'"
                        class="btn btn-secondary btn-sm"
                        @click="decide(c, 'paid')"
                      >
                        {{ t('affiliates.markPaid') }}
                      </button>
                      <button
                        v-if="c.status === 'pending'"
                        class="btn btn-ghost btn-sm danger"
                        @click="decide(c, 'rejected')"
                      >
                        {{ t('affiliates.reject') }}
                      </button>
                    </template>
                    <span v-else-if="isOwn(c)" class="tertiary small">
                      {{ t('affiliates.approveOwn') }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </template>

    <!-- Neither a partner nor allowed to see the programme ------------- -->
    <div v-else class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="lock" :size="20" /></span>
        <p class="empty-title">{{ t('affiliates.noAccess') }}</p>
        <p class="empty-text">{{ t('affiliates.noAccessHint') }}</p>
      </div>
    </div>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('affiliates.deleteAffiliate')"
      :message="t('recycle.deleteExplain')"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>

<style scoped>
.flow {
  display: flex; align-items: flex-start; gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--accent-soft-border); border-radius: var(--radius-md);
  background: var(--accent-soft-bg); color: var(--text-brand);
}
.flow-line { font-size: var(--text-sm); font-weight: 600; }
.flow-hint { font-size: var(--text-xs); color: var(--text-secondary); margin-top: 2px; }

.tabs { display: flex; gap: var(--space-1); border-bottom: 1px solid var(--border-subtle); }
.tab { padding: var(--space-3) var(--space-4); border-bottom: 2px solid transparent; font-size: var(--text-base); font-weight: 550; color: var(--text-secondary); }
.tab:hover { color: var(--text-primary); }
.tab.is-active { color: var(--text-brand); border-bottom-color: var(--accent); }

.editor { border-color: var(--accent-soft-border); }
.search { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: var(--space-3); color: var(--text-tertiary); pointer-events: none; }
.search-input { padding-left: calc(var(--space-3) * 2 + 16px); }
.select.compact { max-width: 200px; }

.rules { display: flex; flex-direction: column; gap: var(--space-2); }
.rules-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.rules-title { font-size: var(--text-base); font-weight: 650; }
.rule { padding: var(--space-4); background: var(--bg-inset); }
.rule-foot { display: flex; align-items: center; gap: var(--space-4); margin-top: var(--space-3); flex-wrap: wrap; }
.spacer { flex: 1; }

.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--space-3); }
.figure { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4); }
.figure-label { font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.figure-value { font-size: var(--text-lg); font-weight: 700; font-variant-numeric: tabular-nums; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--space-4); }
.partner { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5); }
.partner-head { display: flex; align-items: center; gap: var(--space-3); }
.partner-id { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.partner-name { font-size: var(--text-md); font-weight: 650; }
.partner-id .tertiary { font-size: var(--text-xs); }

.activity, .earnings { display: grid; gap: var(--space-3); margin: 0; }
.activity { grid-template-columns: repeat(4, 1fr); }
.earnings { grid-template-columns: repeat(3, 1fr); padding-top: var(--space-3); border-top: 1px solid var(--border-subtle); }
.activity dt, .earnings dt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); margin-bottom: 2px; }
.activity dd, .earnings dd { margin: 0; font-size: var(--text-sm); font-weight: 650; font-variant-numeric: tabular-nums; }

.partner-foot { display: flex; align-items: center; gap: var(--space-1); margin-top: auto; }

.st-on, .cs-paid, .ls-won { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.st-off, .cs-rejected, .ls-lost { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }
.cs-pending { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.cs-approved, .ls-new, .ls-contacted, .ls-qualified, .ls-proposal, .ls-negotiation {
  background: var(--accent-soft-bg); border-color: var(--accent-soft-border); color: var(--text-brand);
}

.num { text-align: right; font-variant-numeric: tabular-nums; }
.strong { font-weight: 650; }
.pos { color: var(--ok-500); }
.warn { color: var(--warn-500); }
.nowrap { white-space: nowrap; }
.small { font-size: var(--text-xs); }
.danger:hover { color: var(--danger-500); }

</style>
