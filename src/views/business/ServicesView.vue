<script setup lang="ts">
/**
 * The service catalogue — what the company sells and for how much.
 *
 * A list of prices, not a billing engine. Its job is that an entry in a
 * client's ledger can be picked rather than retyped, and that the same work
 * is not quoted at three different prices because nobody remembered the last
 * one.
 *
 * A service never owns money. What a client actually paid lives on their
 * ledger entry, because the agreed price and the list price are different
 * things and only one of them is a fact.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import { fetchServiceCatalogue, saveService } from '@/api/operations'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { PRICING_MODELS, type PricingModel, type Service } from '@/types/business'
import {
  BASE_CURRENCY,
  CURRENCIES,
  formatMoney,
  fromMinor,
  makeMoney,
  type CurrencyCode,
} from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'

const auth = useAuthStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const loading = ref(true)
const saving = ref(false)
const services = ref<Service[]>([])
const search = ref('')

const canManage = computed(() => auth.hasPermission(PERMISSIONS.SERVICES_MANAGE))

interface Draft {
  id: string
  name: string
  description: string
  amount: number
  currency: CurrencyCode
  unit: string
  category: string
  pricingModel: PricingModel
  status: 'active' | 'inactive'
}

const draft = ref<Draft | null>(null)

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return services.value
  return services.value.filter((s) =>
    `${s.name} ${s.description}`.toLowerCase().includes(term),
  )
})

function money(minor: number, currency: CurrencyCode = BASE_CURRENCY): string {
  return formatMoney(minor, currency, locale.value)
}

async function load(): Promise<void> {
  loading.value = true
  services.value = await fetchServiceCatalogue()
  loading.value = false
}

function startNew(): void {
  draft.value = {
    id: '',
    name: '',
    description: '',
    amount: 0,
    currency: BASE_CURRENCY,
    unit: '',
    category: '',
    pricingModel: 'fixed',
    status: 'active',
  }
}

function startEdit(service: Service): void {
  draft.value = {
    id: service.id,
    name: service.name,
    description: service.description ?? '',
    amount: fromMinor(service.defaultPrice?.minor ?? 0, service.defaultPrice?.currency),
    currency: service.defaultPrice?.currency ?? BASE_CURRENCY,
    unit: service.unit ?? '',
    category: service.category ?? '',
    pricingModel: service.pricingModel ?? 'fixed',
    status: service.status,
  }
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
      id: d.id,
      name: d.name.trim(),
      description: d.description.trim(),
      defaultPrice: makeMoney(d.amount, d.currency, 1, new Date().toISOString().slice(0, 10)),
      unit: d.unit.trim(),
      category: d.category.trim(),
      pricingModel: d.pricingModel,
      status: d.status,
    } as Service)
    ui.notify('ok', t('services.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('services.saveFailed'))
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
        <h1 class="page-title">{{ t('services.title') }}</h1>
        <p class="page-subtitle">{{ t('services.subtitle') }}</p>
      </div>
      <button v-if="canManage && !draft" class="btn btn-primary" @click="startNew">
        <AppIcon name="plus" :size="16" /> {{ t('services.newService') }}
      </button>
    </header>

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
            <label class="field-label" for="s-amount">{{ t('services.defaultPrice') }}</label>
            <input id="s-amount" v-model.number="draft.amount" class="input" type="number" step="0.01" />
          </div>
          <div class="field">
            <label class="field-label" for="s-cur">{{ t('finance.amount') }}</label>
            <select id="s-cur" v-model="draft.currency" class="select">
              <option v-for="c in CURRENCIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="s-unit">{{ t('services.unit') }}</label>
            <input id="s-unit" v-model="draft.unit" class="input" :maxlength="LIMITS.name" />
            <p class="field-hint">{{ t('services.unitHint') }}</p>
          </div>
          <div class="field">
            <label class="field-label" for="s-cat">{{ t('table.type') }}</label>
            <input id="s-cat" v-model="draft.category" class="input" :maxlength="LIMITS.name" list="s-cats" />
            <datalist id="s-cats">
              <option v-for="c in [...new Set(services.map((x) => x.category).filter(Boolean))]" :key="c" :value="c" />
            </datalist>
          </div>

          <div class="field">
            <label class="field-label" for="s-model">{{ t('affiliates.ruleModel') }}</label>
            <select id="s-model" v-model="draft.pricingModel" class="select">
              <option v-for="m in PRICING_MODELS" :key="m" :value="m">{{ t(`pricingModel.${m}`) }}</option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="s-status">{{ t('table.status') }}</label>
            <select id="s-status" v-model="draft.status" class="select">
              <option value="active">{{ t('organisation.statusActive') }}</option>
              <option value="inactive">{{ t('organisation.statusInactive') }}</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="s-desc">{{ t('services.description') }}</label>
          <input id="s-desc" v-model="draft.description" class="input" :maxlength="LIMITS.shortText" />
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
    </div>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 44px" />
      </div>
    </div>

    <div v-else-if="filtered.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="spark" :size="20" /></span>
        <p class="empty-title">{{ t('services.empty') }}</p>
        <p class="empty-text">{{ t('services.emptyHint') }}</p>
        <button v-if="canManage" class="btn btn-primary" @click="startNew">
          {{ t('services.newService') }}
        </button>
      </div>
    </div>

    <div v-else class="grid">
      <article v-for="service in filtered" :key="service.id" class="card service">
        <div class="service-head">
          <h2 class="service-name">{{ service.name }}</h2>
          <span v-if="service.status === 'inactive'" class="badge badge-deactivated">
            {{ t('organisation.statusInactive') }}
          </span>
        </div>

        <p v-if="service.category" class="tertiary service-cat">{{ service.category }}</p>
        <p v-if="service.description" class="muted service-desc">{{ service.description }}</p>

        <div class="service-foot">
          <span class="service-price">
            {{ money(service.defaultPrice?.minor ?? 0, service.defaultPrice?.currency) }}
            <span v-if="service.unit" class="tertiary service-unit">/ {{ service.unit }}</span>
          </span>
          <button v-if="canManage" class="btn btn-ghost btn-sm" @click="startEdit(service)">
            {{ t('common.edit') }}
          </button>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.editor { border-color: var(--accent-soft-border); }
.search { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: var(--space-3); color: var(--text-tertiary); pointer-events: none; }
.search-input { padding-left: calc(var(--space-3) * 2 + 16px); }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: var(--space-4); }

.service { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-5); }
.service-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.service-name { font-size: var(--text-md); font-weight: 650; }
.service-cat { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.04em; }
.service-desc { font-size: var(--text-sm); line-height: var(--leading-relaxed); }
.service-foot {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
  margin-top: auto; padding-top: var(--space-3); border-top: 1px solid var(--border-subtle);
}
.service-price { font-size: var(--text-lg); font-weight: 650; color: var(--text-brand); }
.service-unit { font-size: var(--text-xs); font-weight: 500; }
</style>
