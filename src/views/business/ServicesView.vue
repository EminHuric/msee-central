<script setup lang="ts">
/**
 * The service catalogue — everything MsEe sells, and how it is paid for.
 *
 * The payment structure is what makes this more than a price list. A price
 * alone cannot express "half up front, the rest in three parts", and without
 * that the system can never answer whether an advance is outstanding. The
 * structure is copied onto a sale when one is made, so raising a price next
 * year cannot rewrite what last year's customer agreed to.
 *
 * Nothing is hardcoded. Marketing, StayBrain, apartment sales and whatever
 * comes next are all rows created here.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import CustomFields from '@/components/CustomFields.vue'
import { fetchSales } from '@/api/sales'
import { blankService, deleteService, fetchServices, saveService } from '@/api/operations'
import { fieldsFor, fetchFieldDefs } from '@/api/records'
import { moneyOf } from '@/api/sales'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { PRICING_MODELS, type Service } from '@/types/business'
import { PAYMENT_MODELS, type Sale } from '@/types/revenue'
import {
  BASE_CURRENCY,
  CURRENCIES,
  formatMoney,
  fromMinor,
  toMinor,
  type CurrencyCode,
} from '@/types/money'
import type { CustomFieldDef } from '@/types/records'
import { PERMISSIONS } from '@/types/permissions'

const auth = useAuthStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const loading = ref(true)
const saving = ref(false)

const services = ref<Service[]>([])
const sales = ref<Sale[]>([])
const fieldDefs = ref<CustomFieldDef[]>([])

const search = ref('')
const categoryFilter = ref('')
const showInactive = ref(false)

const draft = ref<Service | null>(null)
const draftPrice = ref(0)
const draftCurrency = ref<CurrencyCode>(BASE_CURRENCY)
const draftAdvance = ref(0)

const pendingDelete = ref<Service | null>(null)

const canManage = computed(() => auth.hasPermission(PERMISSIONS.SERVICES_MANAGE))
const canSeeMoney = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_VIEW))

const serviceFields = computed(() => fieldsFor(fieldDefs.value, 'service'))

function money(minor: number, currency: CurrencyCode = BASE_CURRENCY): string {
  return formatMoney(minor, currency, locale.value)
}

const categories = computed(() =>
  [...new Set(services.value.map((s) => s.category).filter(Boolean))].sort(),
)

/** What each service has actually sold, so the catalogue is not a wish list. */
const performance = computed(() => {
  const map = new Map<string, { count: number; value: number }>()
  for (const sale of sales.value) {
    if (!sale.serviceId) continue
    const row = map.get(sale.serviceId) ?? { count: 0, value: 0 }
    row.count += 1
    row.value += sale.value.baseMinor
    map.set(sale.serviceId, row)
  }
  return map
})

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()

  return services.value.filter((s) => {
    if (!showInactive.value && s.status === 'inactive') return false
    if (categoryFilter.value && s.category !== categoryFilter.value) return false
    if (!term) return true
    return `${s.name} ${s.description} ${s.category}`.toLowerCase().includes(term)
  })
})

async function load(): Promise<void> {
  loading.value = true
  try {
    const [sv, sl, f] = await Promise.all([
      fetchServices(),
      fetchSales().catch(() => []),
      fetchFieldDefs().catch(() => []),
    ])
    services.value = sv
    sales.value = sl
    fieldDefs.value = f
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

function startNew(): void {
  draft.value = blankService()
  draftPrice.value = 0
  draftCurrency.value = BASE_CURRENCY
  draftAdvance.value = 0
}

function startEdit(service: Service): void {
  draft.value = { ...service, payment: { ...service.payment } }
  draftPrice.value = fromMinor(service.defaultPrice.minor, service.defaultPrice.currency)
  draftCurrency.value = service.defaultPrice.currency
  draftAdvance.value = fromMinor(service.payment?.advanceBaseMinor ?? 0, BASE_CURRENCY)
}

/** Half the price, as a starting point for an advance nobody has set yet. */
function suggestHalf(): void {
  draftAdvance.value = Math.round((draftPrice.value / 2) * 100) / 100
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.name.trim()) {
    ui.notify('danger', t('services.nameRequired'))
    return
  }

  saving.value = true
  try {
    await saveService({
      ...d,
      name: d.name.trim(),
      category: d.category.trim(),
      defaultPrice: moneyOf(draftPrice.value, draftCurrency.value),
      payment: { ...d.payment, advanceBaseMinor: toMinor(draftAdvance.value, BASE_CURRENCY) },
    })
    ui.notify('ok', t('services.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('services.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function toggleStatus(service: Service): Promise<void> {
  await saveService({ ...service, status: service.status === 'active' ? 'inactive' : 'active' })
  await load()
}

async function confirmDelete(): Promise<void> {
  if (!pendingDelete.value) return
  await deleteService(pendingDelete.value)
  ui.notify('ok', t('recycle.movedToBin'))
  pendingDelete.value = null
  await load()
}

/** A one-line description of how a service is paid for. */
function structureLabel(service: Service): string {
  const p = service.payment
  if (!p || p.model === 'one_off') return t('paymentModel.one_off')

  if (p.model === 'advance_remainder') {
    return `${t('paymentModel.advance_remainder')} · ${money(p.advanceBaseMinor)}`
  }

  if (p.model === 'instalments') {
    return `${t('paymentModel.instalments')} · ${p.instalmentCount}`
  }

  return t('paymentModel.custom')
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('services.title') }}</h1>
        <p class="page-subtitle">{{ t('services.subtitle') }}</p>
      </div>
      <button v-if="canManage && !draft" class="btn btn-primary" @click="startNew">
        <AppIcon name="plus" :size="16" /> {{ t('services.newService') }}
      </button>
    </header>

    <!-- Editor --------------------------------------------------------- -->
    <section v-if="draft" class="card editor">
      <div class="card-header">
        <h2 class="card-title">
          {{ draft.id ? t('services.editService') : t('services.newService') }}
        </h2>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="draft = null">
          <AppIcon name="close" :size="18" />
        </button>
      </div>

      <div class="card-body stack">
        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="s-name">
              {{ t('services.name') }}<span class="req">*</span>
            </label>
            <input id="s-name" v-model="draft.name" class="input" :maxlength="LIMITS.position" />
          </div>

          <div class="field">
            <label class="field-label" for="s-cat">{{ t('services.category') }}</label>
            <input id="s-cat" v-model="draft.category" class="input" list="s-cats" :maxlength="LIMITS.name" />
            <datalist id="s-cats">
              <option v-for="c in categories" :key="c" :value="c" />
            </datalist>
          </div>

          <div class="field">
            <label class="field-label" for="s-desc">{{ t('services.description') }}</label>
            <input id="s-desc" v-model="draft.description" class="input" :maxlength="LIMITS.shortText" />
          </div>

          <div class="field">
            <label class="field-label" for="s-model">{{ t('services.pricingModel') }}</label>
            <select id="s-model" v-model="draft.pricingModel" class="select">
              <option v-for="m in PRICING_MODELS" :key="m" :value="m">
                {{ t(`pricingModel.${m}`) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="s-price">{{ t('services.defaultPrice') }}</label>
            <input id="s-price" v-model.number="draftPrice" class="input" type="number" step="0.01" />
          </div>

          <div class="field">
            <label class="field-label" for="s-cur">{{ t('finance.currency') }}</label>
            <select id="s-cur" v-model="draftCurrency" class="select">
              <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="s-unit">{{ t('services.unit') }}</label>
            <input id="s-unit" v-model="draft.unit" class="input" :maxlength="LIMITS.name" />
            <p class="field-hint">{{ t('services.unitHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="s-status">{{ t('table.status') }}</label>
            <select id="s-status" v-model="draft.status" class="select">
              <option value="active">{{ t('organisation.statusActive') }}</option>
              <option value="inactive">{{ t('organisation.statusInactive') }}</option>
            </select>
          </div>
        </div>

        <!-- Payment structure ------------------------------------------ -->
        <fieldset class="block">
          <legend>{{ t('services.paymentStructure') }}</legend>
          <p class="field-hint">{{ t('services.paymentHint') }}</p>

          <div class="field-grid">
            <div class="field">
              <label class="field-label" for="p-model">{{ t('sales.paymentModel') }}</label>
              <select id="p-model" v-model="draft.payment.model" class="select">
                <option v-for="m in PAYMENT_MODELS" :key="m" :value="m">
                  {{ t(`paymentModel.${m}`) }}
                </option>
              </select>
            </div>

            <div v-if="draft.payment.model !== 'one_off'" class="field">
              <label class="field-label" for="p-adv">{{ t('services.advanceRequired') }}</label>
              <div class="inline-row">
                <input id="p-adv" v-model.number="draftAdvance" class="input" type="number" step="0.01" />
                <button class="btn btn-ghost btn-sm" type="button" @click="suggestHalf">
                  {{ t('services.half') }}
                </button>
              </div>
              <p class="field-hint">{{ t('services.advanceHint') }}</p>
            </div>

            <div v-if="draft.payment.model === 'instalments'" class="field">
              <label class="field-label" for="p-count">{{ t('sales.instalmentCount') }}</label>
              <input
                id="p-count"
                v-model.number="draft.payment.instalmentCount"
                class="input"
                type="number"
                min="0"
              />
            </div>

            <div class="field">
              <label class="field-label" for="p-due">{{ t('services.paymentDeadline') }}</label>
              <input id="p-due" v-model.number="draft.payment.dueInDays" class="input" type="number" min="0" />
            </div>

            <div class="field">
              <label class="field-label" for="p-comm">{{ t('services.commissionPercent') }}</label>
              <input
                id="p-comm"
                v-model.number="draft.commissionPercent"
                class="input"
                type="number"
                min="0"
                max="100"
              />
              <p class="field-hint">{{ t('services.commissionHint') }}</p>
            </div>
          </div>

          <div class="field">
            <label class="field-label" for="p-note">{{ t('services.paymentNote') }}</label>
            <input id="p-note" v-model="draft.payment.note" class="input" :maxlength="LIMITS.shortText" />
          </div>
        </fieldset>

        <details class="more">
          <summary>{{ t('common.moreDetails') }}</summary>
          <div class="field">
            <label class="field-label" for="s-details">{{ t('services.details') }}</label>
            <textarea id="s-details" v-model="draft.details" class="textarea" rows="4" :maxlength="LIMITS.longText" />
            <p class="field-hint">{{ t('services.detailsHint') }}</p>
          </div>
          <div class="field">
            <label class="field-label" for="s-notes">{{ t('clients.notes') }}</label>
            <textarea id="s-notes" v-model="draft.notes" class="textarea" :maxlength="LIMITS.longText" />
          </div>
        </details>

        <CustomFields v-model="draft.custom" :fields="serviceFields" can-see-management />
      </div>

      <div class="card-footer">
        <button class="btn btn-secondary" @click="draft = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="commit">
          <span v-if="saving" class="spinner" />{{ t('common.save') }}
        </button>
      </div>
    </section>

    <!-- Filters -------------------------------------------------------- -->
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

      <select v-if="categories.length" v-model="categoryFilter" class="select compact">
        <option value="">{{ t('services.allCategories') }}</option>
        <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
      </select>

      <label class="check inline">
        <input v-model="showInactive" type="checkbox" />
        <span class="check-text">{{ t('services.showInactive') }}</span>
      </label>
    </div>

    <!-- List ----------------------------------------------------------- -->
    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 100px" />
      </div>
    </div>

    <div v-else-if="visible.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="spark" :size="20" /></span>
        <p class="empty-title">{{ services.length === 0 ? t('services.empty') : t('services.noMatch') }}</p>
        <p class="empty-text">{{ t('services.emptyHint') }}</p>
        <button v-if="canManage && services.length === 0" class="btn btn-primary" @click="startNew">
          {{ t('services.newService') }}
        </button>
      </div>
    </div>

    <div v-else class="grid">
      <article v-for="service in visible" :key="service.id" class="card service">
        <div class="service-head">
          <div class="service-id">
            <h2 class="service-name">{{ service.name }}</h2>
            <span v-if="service.category" class="tertiary service-cat">{{ service.category }}</span>
          </div>
          <span v-if="service.status === 'inactive'" class="badge badge-plain">
            {{ t('organisation.statusInactive') }}
          </span>
        </div>

        <p v-if="service.description" class="muted service-desc">{{ service.description }}</p>

        <p class="service-price">
          {{ money(service.defaultPrice.baseMinor, service.defaultPrice.currency) }}
          <span v-if="service.unit" class="tertiary service-unit">/ {{ service.unit }}</span>
        </p>

        <p class="structure">
          <AppIcon name="wallet" :size="13" /> {{ structureLabel(service) }}
        </p>

        <p v-if="service.commissionPercent" class="tertiary small">
          {{ t('services.commissionPercent') }}: {{ service.commissionPercent }}%
        </p>

        <dl v-if="canSeeMoney" class="stats">
          <div>
            <dt>{{ t('sales.count') }}</dt>
            <dd>{{ performance.get(service.id)?.count ?? 0 }}</dd>
          </div>
          <div>
            <dt>{{ t('sales.sold') }}</dt>
            <dd>{{ money(performance.get(service.id)?.value ?? 0) }}</dd>
          </div>
        </dl>

        <div v-if="canManage" class="service-foot">
          <button class="btn btn-ghost btn-sm" @click="toggleStatus(service)">
            {{ service.status === 'active' ? t('services.deactivate') : t('services.activate') }}
          </button>
          <span class="spacer" />
          <button class="btn btn-ghost btn-sm" @click="startEdit(service)">
            {{ t('common.edit') }}
          </button>
          <button
            class="btn btn-ghost btn-sm danger"
            :aria-label="t('common.delete')"
            @click="pendingDelete = service"
          >
            <AppIcon name="trash" :size="14" />
          </button>
        </div>
      </article>
    </div>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('services.deleteService')"
      :message="t('recycle.deleteExplain')"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>

<style scoped>
.editor { border-color: var(--accent-soft-border); }
.search { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: var(--space-3); color: var(--text-tertiary); pointer-events: none; }
.search-input { padding-left: calc(var(--space-3) * 2 + 16px); }
.select.compact { max-width: 190px; }
.check.inline { align-items: center; white-space: nowrap; }
.inline-row { display: flex; gap: var(--space-2); align-items: center; }
.inline-row .input { flex: 1; }

.block { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
.block > legend { padding: 0 var(--space-2); font-size: var(--text-sm); font-weight: 650; }
.more { border-top: 1px solid var(--border-subtle); padding-top: var(--space-3); }
.more > summary { cursor: pointer; font-size: var(--text-sm); font-weight: 600; color: var(--text-secondary); margin-bottom: var(--space-3); }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--space-4); }
.service { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-5); }
.service-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.service-id { display: flex; flex-direction: column; min-width: 0; }
.service-name { font-size: var(--text-md); font-weight: 650; }
.service-cat { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
.service-desc { font-size: var(--text-sm); line-height: var(--leading-relaxed); }
.service-price { font-size: var(--text-lg); font-weight: 700; color: var(--text-brand); font-variant-numeric: tabular-nums; }
.service-unit { font-size: var(--text-xs); font-weight: 500; }

.structure { display: flex; align-items: center; gap: 5px; font-size: var(--text-xs); color: var(--text-secondary); }

.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-3); margin: var(--space-2) 0 0; padding-top: var(--space-3); border-top: 1px solid var(--border-subtle); }
.stats dt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); margin-bottom: 2px; }
.stats dd { margin: 0; font-size: var(--text-sm); font-weight: 650; font-variant-numeric: tabular-nums; }

.service-foot { display: flex; align-items: center; gap: var(--space-1); margin-top: auto; padding-top: var(--space-3); border-top: 1px solid var(--border-subtle); }
.spacer { flex: 1; }
.small { font-size: var(--text-xs); }
.danger:hover { color: var(--danger-500); }
</style>
