<script setup lang="ts">
/**
 * The affiliate programme.
 *
 * The screen is built around one sentence, printed at the top of it: a click
 * earns nothing. Commission follows money that arrived, and then only after a
 * person approves it. Everything here is arranged so that sequence is visible
 * rather than assumed.
 *
 * Clicks, referred leads and won deals are shown as activity — useful, and
 * deliberately kept in a different column from anything owed.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { fetchEmployees } from '@/api/employees'
import { fetchLeads, fetchServiceCatalogue } from '@/api/operations'
import {
  fetchAffiliates,
  fetchClickCounts,
  makeCode,
  referralLink,
  resultFor,
  saveAffiliate,
} from '@/api/affiliates'
import { fetchCommissions, fetchSales, setCommissionStatus } from '@/api/revenue'
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
  type AffiliateType,
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

type Tab = 'partners' | 'commissions'

const tab = ref<Tab>('partners')
const loading = ref(true)
const saving = ref(false)

const affiliates = ref<Affiliate[]>([])
const commissions = ref<Commission[]>([])
const leads = ref<Lead[]>([])
const sales = ref<Sale[]>([])
const services = ref<Service[]>([])
const people = ref<EmployeePublic[]>([])
const clicks = ref<Record<string, number>>({})

const search = ref('')
const statusFilter = ref<Commission['status'] | ''>('')

const canManage = computed(() => auth.hasPermission(PERMISSIONS.AFFILIATES_MANAGE))
const canApprove = computed(() => auth.hasPermission(PERMISSIONS.COMMISSIONS_APPROVE))

interface RuleDraft extends Omit<CommissionRule, 'fixedBaseMinor'> {
  fixedAmount: number
}

interface Draft {
  id: string
  name: string
  type: AffiliateType
  employeeUid: string
  email: string
  phone: string
  code: string
  status: Affiliate['status']
  rules: RuleDraft[]
  notes: string
}

const draft = ref<Draft | null>(null)

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return affiliates.value
  return affiliates.value.filter((a) => `${a.name} ${a.code} ${a.email}`.toLowerCase().includes(term))
})

const results = computed(
  () =>
    new Map(
      affiliates.value.map((a) => [
        a.id,
        resultFor(a, leads.value, sales.value, commissions.value, clicks.value),
      ]),
    ),
)

const visibleCommissions = computed(() => {
  const term = search.value.trim().toLowerCase()

  return commissions.value.filter((c) => {
    if (statusFilter.value && c.status !== statusFilter.value) return false
    if (!term) return true
    return `${c.affiliateName} ${c.clientName}`.toLowerCase().includes(term)
  })
})

const totals = computed(() => {
  const sum = (status: Commission['status']) =>
    commissions.value.filter((c) => c.status === status).reduce((n, c) => n + c.amountBaseMinor, 0)

  return {
    pending: sum('pending'),
    approved: sum('approved'),
    paid: sum('paid'),
  }
})

/** An affiliate linked to your own account cannot be approved by you. */
function isMine(commission: Commission): boolean {
  const affiliate = affiliates.value.find((a) => a.id === commission.affiliateId)
  return !!affiliate?.employeeUid && affiliate.employeeUid === auth.uid
}

async function load(): Promise<void> {
  loading.value = true
  const [a, c, l, s, sv, e, ck] = await Promise.all([
    fetchAffiliates(),
    fetchCommissions().catch(() => []),
    fetchLeads().catch(() => []),
    fetchSales().catch(() => []),
    fetchServiceCatalogue().catch(() => []),
    fetchEmployees().catch(() => []),
    fetchClickCounts().catch(() => ({})),
  ])
  affiliates.value = a
  commissions.value = c
  leads.value = l
  sales.value = s
  services.value = sv
  people.value = e
  clicks.value = ck
  loading.value = false
}

function blankRule(): RuleDraft {
  return {
    id: Math.random().toString(36).slice(2, 10),
    serviceId: null,
    serviceName: '',
    model: 'percentage',
    percent: 10,
    fixedAmount: 0,
    recurring: true,
    note: '',
  }
}

function startNew(): void {
  draft.value = {
    id: '',
    name: '',
    type: 'partner',
    employeeUid: '',
    email: '',
    phone: '',
    code: '',
    status: 'active',
    rules: [blankRule()],
    notes: '',
  }
}

function startEdit(affiliate: Affiliate): void {
  draft.value = {
    id: affiliate.id,
    name: affiliate.name,
    type: affiliate.type,
    employeeUid: affiliate.employeeUid ?? '',
    email: affiliate.email ?? '',
    phone: affiliate.phone ?? '',
    code: affiliate.code,
    status: affiliate.status,
    rules: (affiliate.rules ?? []).map((r) => ({
      ...r,
      fixedAmount: fromMinor(r.fixedBaseMinor ?? 0, BASE_CURRENCY),
    })),
    notes: affiliate.notes ?? '',
  }
}

/** Choosing an employee fills the name and the code, since both come from it. */
function onEmployeeChange(uid: string): void {
  const d = draft.value
  if (!d) return
  d.employeeUid = uid
  const person = people.value.find((p) => p.uid === uid)
  if (!person) return

  d.name = `${person.firstName} ${person.lastName}`
  if (!d.code) d.code = makeCode(d.name, affiliates.value)
}

function onNameBlur(): void {
  const d = draft.value
  if (d && !d.code && d.name.trim()) d.code = makeCode(d.name, affiliates.value)
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
      id: d.id,
      code: (d.code || makeCode(d.name, affiliates.value)).trim(),
      name: d.name.trim(),
      type: d.type,
      employeeUid: d.type === 'employee' ? d.employeeUid || null : null,
      email: d.email.trim(),
      phone: d.phone.trim(),
      status: d.status,
      rules: d.rules.map((r) => ({
        id: r.id,
        serviceId: r.serviceId,
        serviceName: services.value.find((s) => s.id === r.serviceId)?.name ?? '',
        model: r.model,
        percent: r.percent,
        fixedBaseMinor: toMinor(r.fixedAmount, BASE_CURRENCY),
        recurring: r.recurring,
        note: r.note.trim(),
      })),
      notes: d.notes.trim(),
    } as Affiliate)

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
  if (isMine(commission)) {
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

async function copyLink(affiliate: Affiliate): Promise<void> {
  try {
    await navigator.clipboard.writeText(referralLink(affiliate))
    ui.notify('ok', t('affiliates.linkCopied'))
  } catch {
    /* Clipboard refused; the link is on screen and can be copied by hand. */
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('affiliates.title') }}</h1>
        <p class="page-subtitle">{{ t('affiliates.subtitle') }}</p>
      </div>
      <button v-if="canManage && !draft" class="btn btn-primary" @click="startNew">
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
        {{ key === 'partners' ? t('affiliates.title') : t('affiliates.commissions') }}
      </button>
    </div>

    <!-- Editor --------------------------------------------------------- -->
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

          <div v-if="draft.type === 'employee'" class="field">
            <label class="field-label" for="a-emp">{{ t('affiliates.employee') }}</label>
            <select
              id="a-emp"
              :value="draft.employeeUid"
              class="select"
              @change="onEmployeeChange(($event.target as HTMLSelectElement).value)"
            >
              <option value="">—</option>
              <option v-for="p in people" :key="p.uid" :value="p.uid">
                {{ p.firstName }} {{ p.lastName }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="a-name">
              {{ t('affiliates.name') }}<span class="req">*</span>
            </label>
            <input
              id="a-name"
              v-model="draft.name"
              class="input"
              :maxlength="LIMITS.name"
              @blur="onNameBlur"
            />
          </div>

          <div class="field">
            <label class="field-label" for="a-code">{{ t('affiliates.code') }}</label>
            <input id="a-code" v-model="draft.code" class="input" :maxlength="LIMITS.name" />
            <p class="field-hint">{{ t('affiliates.codeHint') }}</p>
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
            <label class="field-label" for="a-status">{{ t('affiliates.status') }}</label>
            <select id="a-status" v-model="draft.status" class="select">
              <option value="active">{{ t('organisation.statusActive') }}</option>
              <option value="paused">{{ t('clientStatus.paused') }}</option>
              <option value="ended">{{ t('organisation.statusInactive') }}</option>
            </select>
          </div>
        </div>

        <!-- Commission rules ------------------------------------------ -->
        <div class="rules">
          <div class="rules-head">
            <h3 class="rules-title">{{ t('affiliates.rules') }}</h3>
            <button class="btn btn-secondary btn-sm" @click="draft.rules.push(blankRule())">
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
                <input
                  :id="`r-pct-${i}`"
                  v-model.number="rule.percent"
                  class="input"
                  type="number"
                  min="0"
                  max="100"
                />
              </div>

              <div v-else class="field">
                <label class="field-label" :for="`r-fix-${i}`">{{ t('affiliates.ruleFixed') }}</label>
                <input
                  :id="`r-fix-${i}`"
                  v-model.number="rule.fixedAmount"
                  class="input"
                  type="number"
                  step="0.01"
                />
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
          <label class="field-label" for="a-notes">{{ t('dossier.notes') }}</label>
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
      <select
        v-if="tab === 'commissions'"
        v-model="statusFilter"
        class="select compact"
        :aria-label="t('table.status')"
      >
        <option value="">{{ t('clients.allStatuses') }}</option>
        <option v-for="s in COMMISSION_STATUSES" :key="s" :value="s">
          {{ t(`commissionStatus.${s}`) }}
        </option>
      </select>
    </div>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 60px" />
      </div>
    </div>

    <!-- Partners ------------------------------------------------------- -->
    <template v-else-if="tab === 'partners'">
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

          <div class="link-row">
            <code class="ref-link">{{ referralLink(a) }}</code>
            <button class="btn btn-ghost btn-sm" :aria-label="t('affiliates.link')" @click="copyLink(a)">
              <AppIcon name="copy" :size="14" />
            </button>
          </div>

          <dl class="activity">
            <div>
              <dt>{{ t('affiliates.clicks') }}</dt>
              <dd>{{ results.get(a.id)?.clicks ?? 0 }}</dd>
            </div>
            <div>
              <dt>{{ t('affiliates.leads') }}</dt>
              <dd>{{ results.get(a.id)?.leads ?? 0 }}</dd>
            </div>
            <div>
              <dt>{{ t('affiliates.wonSales') }}</dt>
              <dd>{{ results.get(a.id)?.wonSales ?? 0 }}</dd>
            </div>
            <div>
              <dt>{{ t('affiliates.salesValue') }}</dt>
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
            <span class="tertiary small">{{ (a.rules ?? []).length }} · {{ t('affiliates.rules') }}</span>
            <button v-if="canManage" class="btn btn-ghost btn-sm" @click="startEdit(a)">
              {{ t('common.edit') }}
            </button>
          </div>
        </article>
      </div>
    </template>

    <!-- Commissions ---------------------------------------------------- -->
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

      <div v-if="visibleCommissions.length === 0" class="card">
        <div class="empty">
          <span class="empty-icon"><AppIcon name="wallet" :size="20" /></span>
          <p class="empty-title">{{ t('affiliates.noCommissions') }}</p>
          <p class="empty-text">{{ t('affiliates.noCommissionsHint') }}</p>
        </div>
      </div>

      <section v-else class="card">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>{{ t('affiliates.name') }}</th>
                <th>{{ t('table.client') }}</th>
                <th>{{ t('affiliates.ruleModel') }}</th>
                <th class="num">{{ t('table.amount') }}</th>
                <th>{{ t('table.date') }}</th>
                <th>{{ t('table.status') }}</th>
                <th class="col-actions" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in visibleCommissions" :key="c.id">
                <td class="strong">{{ c.affiliateName }}</td>
                <td class="muted">{{ c.clientName || '—' }}</td>
                <td class="muted">
                  {{ c.ruleDescription }}
                  <span class="tertiary small">· {{ money(c.baseAmountBaseMinor) }}</span>
                </td>
                <td class="num strong">{{ money(c.amountBaseMinor) }}</td>
                <td class="muted nowrap">{{ formatDate(c.earnedDate) }}</td>
                <td>
                  <span class="badge" :class="`cs-${c.status}`">
                    {{ t(`commissionStatus.${c.status}`) }}
                  </span>
                </td>
                <td class="col-actions">
                  <template v-if="canApprove && !isMine(c)">
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
                  <span v-else-if="isMine(c)" class="tertiary small">
                    {{ t('affiliates.approveOwn') }}
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
.rule-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-3); }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--space-4); }
.partner { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5); }
.partner-head { display: flex; align-items: center; gap: var(--space-3); }
.partner-id { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.partner-name { font-size: var(--text-md); font-weight: 650; }
.partner-id .tertiary { font-size: var(--text-xs); }

.link-row { display: flex; align-items: center; gap: var(--space-2); }
.ref-link {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm);
  background: var(--bg-inset); font-size: var(--text-xs); color: var(--text-secondary);
}

.activity, .earnings { display: grid; gap: var(--space-3); margin: 0; }
.activity { grid-template-columns: repeat(4, 1fr); }
.earnings { grid-template-columns: repeat(3, 1fr); padding-top: var(--space-3); border-top: 1px solid var(--border-subtle); }
.activity dt, .earnings dt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); margin-bottom: 2px; }
.activity dd, .earnings dd { margin: 0; font-size: var(--text-sm); font-weight: 650; font-variant-numeric: tabular-nums; }

.partner-foot { display: flex; align-items: center; justify-content: space-between; margin-top: auto; }

.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-3); }
.figure { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4) var(--space-5); }
.figure-label { font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.figure-value { font-size: var(--text-xl); font-weight: 700; font-variant-numeric: tabular-nums; }

.st-on { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.st-off { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }
.cs-pending { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.cs-approved { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); color: var(--text-brand); }
.cs-paid { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.cs-rejected { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }

.num { text-align: right; font-variant-numeric: tabular-nums; }
.strong { font-weight: 650; }
.pos { color: var(--ok-500); }
.warn { color: var(--warn-500); }
.danger:hover { color: var(--danger-500); }
.nowrap { white-space: nowrap; }
.small { font-size: var(--text-xs); }
</style>
