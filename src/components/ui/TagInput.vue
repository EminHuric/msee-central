<script setup lang="ts">
/** Free-text list input used for skills, languages, expertise and interests. */

import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string[]
    id?: string
    placeholder?: string
    maxItems?: number
    maxLength?: number
    disabled?: boolean
  }>(),
  { maxItems: 30, maxLength: 40, disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const { t } = useI18n()
const draft = ref('')

function commit(): void {
  const value = draft.value.trim().slice(0, props.maxLength)
  if (!value) return
  // Case-insensitive de-duplication, so "Vue" and "vue" do not both appear.
  const exists = props.modelValue.some((item) => item.toLowerCase() === value.toLowerCase())
  if (!exists && props.modelValue.length < props.maxItems) {
    emit('update:modelValue', [...props.modelValue, value])
  }
  draft.value = ''
}

function remove(index: number): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  )
}

/** Backspace on an empty box removes the last chip — the expected shortcut. */
function onBackspace(): void {
  if (draft.value === '' && props.modelValue.length > 0) {
    remove(props.modelValue.length - 1)
  }
}
</script>

<template>
  <div class="tags" :class="{ 'is-disabled': disabled }">
    <ul v-if="modelValue.length" class="tag-list">
      <li v-for="(item, index) in modelValue" :key="item" class="tag">
        <span>{{ item }}</span>
        <button
          type="button"
          class="tag-remove"
          :disabled="disabled"
          :aria-label="t('profile.tagRemove', { item })"
          @click="remove(index)"
        >
          <AppIcon name="close" :size="12" />
        </button>
      </li>
    </ul>

    <input
      :id="id"
      v-model="draft"
      class="input"
      type="text"
      :placeholder="placeholder ?? t('profile.tagPlaceholder')"
      :disabled="disabled || modelValue.length >= maxItems"
      :maxlength="maxLength"
      @keydown.enter.prevent="commit"
      @keydown.delete="onBackspace"
      @blur="commit"
    />
  </div>
</template>

<style scoped>
.tags {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.tag-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 3px var(--space-2) 3px var(--space-3);
  background: var(--accent-soft-bg);
  border: 1px solid var(--accent-soft-border);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  color: var(--text-primary);
}

.tag-remove {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  color: var(--text-tertiary);
}

.tag-remove:hover:not(:disabled) {
  background: var(--bg-active);
  color: var(--danger-500);
}

.is-disabled {
  opacity: 0.6;
}
</style>
