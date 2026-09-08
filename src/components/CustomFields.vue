<script setup lang="ts">
/**
 * Renders whatever fields the CEO defined for a kind of record.
 *
 * The whole point of custom fields is that adding one must not need a code
 * change, so this component knows nothing about clients or sales — it takes a
 * list of definitions and a bag of values and renders the pairing.
 *
 * Values are bound through a model rather than mutated in place, so a form can
 * discard an edit by throwing the draft away, exactly like the fixed fields
 * beside them.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { LIMITS } from '@/lib/validation'
import { BASE_CURRENCY } from '@/types/money'
import type { CustomFieldDef, CustomValues } from '@/types/records'

const props = defineProps<{
  fields: CustomFieldDef[]
  modelValue: CustomValues
  /** Hides fields the viewer is not allowed to see. */
  canSeeManagement?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [CustomValues] }>()

const { t } = useI18n()

/**
 * Which fields to draw.
 *
 * `management` fields are hidden from somebody without the permission. That is
 * a courtesy, not a boundary: the values travel on the record itself, so the
 * real protection is the rule that decides who may read the record at all.
 */
const visible = computed(() =>
  props.fields.filter((f) => f.visibility !== 'management' || props.canSeeManagement),
)

function set(key: string, value: CustomValues[string]): void {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function toggleOption(field: CustomFieldDef, option: string): void {
  const current = props.modelValue[field.key]
  const list = Array.isArray(current) ? [...current] : []
  const i = list.indexOf(option)
  if (i >= 0) list.splice(i, 1)
  else list.push(option)
  set(field.key, list)
}

function isChosen(field: CustomFieldDef, option: string): boolean {
  const current = props.modelValue[field.key]
  return Array.isArray(current) && current.includes(option)
}

function textOf(key: string): string {
  const value = props.modelValue[key]
  return value === null || value === undefined ? '' : String(value)
}

function numberOf(key: string): number | string {
  const value = props.modelValue[key]
  return typeof value === 'number' ? value : ''
}

function boolOf(key: string): boolean {
  return props.modelValue[key] === true
}
</script>

<template>
  <div v-if="visible.length" class="custom-fields">
    <p class="eyebrow">{{ t('fields.sectionTitle') }}</p>

    <div class="field-grid">
      <div v-for="field in visible" :key="field.id" class="field">
        <label class="field-label" :for="`cf-${field.id}`">
          {{ field.label }}<span v-if="field.required" class="req">*</span>
        </label>

        <textarea
          v-if="field.type === 'long_text'"
          :id="`cf-${field.id}`"
          class="textarea"
          :value="textOf(field.key)"
          :maxlength="LIMITS.longText"
          @input="set(field.key, ($event.target as HTMLTextAreaElement).value)"
        />

        <input
          v-else-if="field.type === 'number'"
          :id="`cf-${field.id}`"
          class="input"
          type="number"
          :value="numberOf(field.key)"
          @input="set(field.key, Number(($event.target as HTMLInputElement).value))"
        />

        <!--
          Money as a plain decimal, with the base currency shown beside it.
          Deliberately not a Money record: see the note on FIELD_TYPES.
        -->
        <div v-else-if="field.type === 'currency'" class="money-field">
          <input
            :id="`cf-${field.id}`"
            class="input"
            type="number"
            step="0.01"
            inputmode="decimal"
            :value="numberOf(field.key)"
            @input="set(field.key, Number(($event.target as HTMLInputElement).value))"
          />
          <span class="money-unit">{{ BASE_CURRENCY }}</span>
        </div>

        <input
          v-else-if="field.type === 'url'"
          :id="`cf-${field.id}`"
          class="input"
          type="url"
          inputmode="url"
          placeholder="https://"
          :value="textOf(field.key)"
          @input="set(field.key, ($event.target as HTMLInputElement).value)"
        />

        <input
          v-else-if="field.type === 'date'"
          :id="`cf-${field.id}`"
          class="input"
          type="date"
          :value="textOf(field.key)"
          @input="set(field.key, ($event.target as HTMLInputElement).value)"
        />

        <label v-else-if="field.type === 'boolean'" class="check">
          <input
            :id="`cf-${field.id}`"
            type="checkbox"
            :checked="boolOf(field.key)"
            @change="set(field.key, ($event.target as HTMLInputElement).checked)"
          />
          <span class="check-text">{{ field.helpText || field.label }}</span>
        </label>

        <select
          v-else-if="field.type === 'select'"
          :id="`cf-${field.id}`"
          class="select"
          :value="textOf(field.key)"
          @change="set(field.key, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">—</option>
          <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
        </select>

        <div v-else-if="field.type === 'multi_select'" class="options">
          <label v-for="option in field.options" :key="option" class="check">
            <input
              type="checkbox"
              :checked="isChosen(field, option)"
              @change="toggleOption(field, option)"
            />
            <span class="check-text">{{ option }}</span>
          </label>
        </div>

        <input
          v-else
          :id="`cf-${field.id}`"
          class="input"
          :value="textOf(field.key)"
          :maxlength="LIMITS.shortText"
          @input="set(field.key, ($event.target as HTMLInputElement).value)"
        />

        <p v-if="field.helpText && field.type !== 'boolean'" class="field-hint">
          {{ field.helpText }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
}
.options { display: flex; flex-wrap: wrap; gap: var(--space-3); }

.money-field { display: flex; align-items: center; gap: var(--space-2); }
.money-field .input { flex: 1; min-width: 0; }
.money-unit { color: var(--text-tertiary); font-size: var(--text-sm); white-space: nowrap; }
</style>
