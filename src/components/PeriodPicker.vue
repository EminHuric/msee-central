<script setup lang="ts">
/**
 * The date filter every reporting screen shares.
 *
 * One component so that "this month" means the same thing on the dashboard,
 * in finance and in analytics. Two screens with their own idea of where a
 * quarter starts is how a company ends up with two revenue figures.
 *
 * Custom is a real option rather than a decoration: some questions — "how did
 * the campaign in the first fortnight of March do" — have no named period.
 */

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { periodOf, type Period, type PeriodKey } from '@/api/metrics'

const props = defineProps<{ modelValue: Period }>()
const emit = defineEmits<{ 'update:modelValue': [Period] }>()

const { t } = useI18n()

const NAMED: PeriodKey[] = [
  'today',
  'yesterday',
  'last7',
  'last30',
  'month',
  'prev_month',
  'quarter',
  'year',
  'all',
]

const customOpen = ref(props.modelValue.key === 'custom')
const from = ref(props.modelValue.from)
const to = ref(props.modelValue.to)

const active = computed(() => props.modelValue.key)

function choose(key: PeriodKey): void {
  customOpen.value = false
  emit('update:modelValue', periodOf(key))
}

function openCustom(): void {
  customOpen.value = true
  from.value = props.modelValue.from
  to.value = props.modelValue.to
}

function applyCustom(): void {
  if (!from.value || !to.value) return
  /* Reversed dates are a slip, not an error worth refusing. */
  const [a, b] = from.value <= to.value ? [from.value, to.value] : [to.value, from.value]
  emit('update:modelValue', { from: a, to: b, key: 'custom' })
}

watch(() => props.modelValue.key, (key) => {
  if (key !== 'custom') customOpen.value = false
})
</script>

<template>
  <div class="period">
    <div class="chips">
      <button
        v-for="key in NAMED"
        :key="key"
        type="button"
        class="chip"
        :class="{ 'is-on': active === key }"
        @click="choose(key)"
      >
        {{ t(`period.${key}`) }}
      </button>

      <button
        type="button"
        class="chip"
        :class="{ 'is-on': active === 'custom' }"
        @click="openCustom"
      >
        {{ t('period.custom') }}
      </button>
    </div>

    <form v-if="customOpen" class="custom" @submit.prevent="applyCustom">
      <label class="sr-only" for="pp-from">{{ t('period.from') }}</label>
      <input id="pp-from" v-model="from" class="input" type="date" />
      <span class="tertiary">→</span>
      <label class="sr-only" for="pp-to">{{ t('period.to') }}</label>
      <input id="pp-to" v-model="to" class="input" type="date" />
      <button class="btn btn-secondary btn-sm" type="submit">{{ t('common.apply') }}</button>
    </form>
  </div>
</template>

<style scoped>
.period { display: flex; flex-direction: column; gap: var(--space-2); }

.chips { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.chip {
  padding: 0 var(--space-3); height: 30px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-full);
  background: var(--bg-surface);
  font-size: var(--text-xs); font-weight: 550; color: var(--text-secondary);
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.chip:hover { background: var(--bg-hover); color: var(--text-primary); }
.chip.is-on { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }

.custom { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.custom .input { max-width: 160px; }

.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
</style>
