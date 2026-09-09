<script setup lang="ts">
/**
 * Custom fields.
 *
 * The escape hatch that stops this system needing a developer every time the
 * company wants to record one more thing. A field defined here appears on the
 * record it belongs to, in the order set here, and its values travel on the
 * record itself — so whoever may read a client reads its custom values too.
 *
 * The storage key is generated from the label once and then frozen. Renaming a
 * field must not orphan every value already stored under the old name.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { deleteFieldDef, fetchFieldDefs, saveFieldDef } from '@/api/records'
import { LIMITS } from '@/lib/validation'
import { useUiStore } from '@/stores/ui'
import {
  FIELD_ENTITIES,
  FIELD_TYPES,
  FIELD_VISIBILITY,
  fieldKey,
  type CustomFieldDef,
  type FieldEntity,
} from '@/types/records'

const ui = useUiStore()
const { t } = useI18n()

const loading = ref(true)
const saving = ref(false)

const fields = ref<CustomFieldDef[]>([])
const entity = ref<FieldEntity>('client')

const draft = ref<CustomFieldDef | null>(null)
const optionsText = ref('')
const pendingDelete = ref<CustomFieldDef | null>(null)

const visible = computed(() =>
  fields.value
    .filter((f) => f.entity === entity.value)
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)),
)

const needsOptions = computed(
  () => draft.value?.type === 'select' || draft.value?.type === 'multi_select',
)

async function load(): Promise<void> {
  loading.value = true
  try {
    fields.value = await fetchFieldDefs()
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

function blankField(): CustomFieldDef {
  return {
    id: '',
    entity: entity.value,
    key: '',
    label: '',
    type: 'text',
    required: false,
    visibility: 'everyone',
    options: [],
    defaultValue: '',
    helpText: '',
    order: visible.value.length,
    active: true,
    createdAt: '',
    createdBy: '',
    updatedAt: '',
  }
}

function startNew(): void {
  draft.value = blankField()
  optionsText.value = ''
}

function startEdit(field: CustomFieldDef): void {
  draft.value = { ...field, options: [...(field.options ?? [])] }
  optionsText.value = (field.options ?? []).join(', ')
}

async function commit(): Promise<void> {
  const d = draft.value
  if (!d || saving.value) return
  if (!d.label.trim()) {
    ui.notify('danger', t('fields.labelRequired'))
    return
  }

  saving.value = true
  try {
    await saveFieldDef({
      ...d,
      label: d.label.trim(),
      /* Generated once, then frozen — see the note at the top of this file. */
      key: d.key || fieldKey(d.label, fields.value),
      options: needsOptions.value
        ? optionsText.value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    })
    ui.notify('ok', t('fields.saved'))
    draft.value = null
    await load()
  } catch {
    ui.notify('danger', t('fields.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function move(field: CustomFieldDef, delta: number): Promise<void> {
  const list = visible.value
  const i = list.findIndex((f) => f.id === field.id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= list.length) return

  await saveFieldDef({ ...list[i]!, order: j })
  await saveFieldDef({ ...list[j]!, order: i })
  await load()
}

async function toggleActive(field: CustomFieldDef): Promise<void> {
  await saveFieldDef({ ...field, active: !field.active })
  await load()
}

async function confirmDelete(): Promise<void> {
  try {
    if (!pendingDelete.value) return
    await deleteFieldDef(pendingDelete.value.id)
    ui.notify('ok', t('fields.deleted'))
    await load()
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    /* Always clears, so a refused delete cannot leave the
       confirmation on screen with nothing happening. */
    pendingDelete.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="stack">
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">{{ t('fields.title') }}</h2>
          <p class="field-hint">{{ t('fields.subtitle') }}</p>
        </div>
        <button v-if="!draft" class="btn btn-primary btn-sm" @click="startNew">
          <AppIcon name="plus" :size="15" /> {{ t('fields.newField') }}
        </button>
      </div>

      <div class="card-body">
        <div class="chips">
          <button
            v-for="e in FIELD_ENTITIES"
            :key="e"
            type="button"
            class="chip"
            :class="{ 'is-on': entity === e }"
            @click="entity = e"
          >
            {{ t(`fields.entity.${e}`) }}
          </button>
        </div>
      </div>

      <div v-if="loading" class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 36px" />
      </div>

      <div v-else-if="visible.length === 0" class="empty">
        <span class="empty-icon"><AppIcon name="edit" :size="20" /></span>
        <p class="empty-title">{{ t('fields.empty') }}</p>
        <p class="empty-text">{{ t('fields.emptyHint') }}</p>
        <button class="btn btn-primary" @click="startNew">{{ t('fields.newField') }}</button>
      </div>

      <ul v-else class="fields">
        <li v-for="(field, i) in visible" :key="field.id" :class="{ 'is-off': !field.active }">
          <span class="order">
            <button
              class="btn btn-ghost btn-sm"
              :disabled="i === 0"
              :aria-label="t('fields.moveUp')"
              @click="move(field, -1)"
            >
              <AppIcon name="arrowUp" :size="13" />
            </button>
            <button
              class="btn btn-ghost btn-sm"
              :disabled="i === visible.length - 1"
              :aria-label="t('fields.moveDown')"
              @click="move(field, 1)"
            >
              <AppIcon name="arrowDown" :size="13" />
            </button>
          </span>

          <span class="field-body">
            <span class="field-name">
              {{ field.label }}
              <span v-if="field.required" class="req">*</span>
            </span>
            <span class="tertiary small">
              {{ t(`fields.type.${field.type}`) }} ·
              {{ t(`fields.visibility.${field.visibility}`) }} ·
              <code>{{ field.key }}</code>
            </span>
          </span>

          <button class="btn btn-ghost btn-sm" @click="toggleActive(field)">
            {{ field.active ? t('organisation.statusActive') : t('organisation.statusInactive') }}
          </button>
          <button class="btn btn-ghost btn-sm" :aria-label="t('common.edit')" @click="startEdit(field)">
            <AppIcon name="edit" :size="15" />
          </button>
          <button
            class="btn btn-ghost btn-sm danger"
            :aria-label="t('common.delete')"
            @click="pendingDelete = field"
          >
            <AppIcon name="trash" :size="15" />
          </button>
        </li>
      </ul>
    </section>

    <!-- Editor --------------------------------------------------------- -->
    <section v-if="draft" class="card editor">
      <div class="card-header">
        <h2 class="card-title">{{ draft.id ? t('fields.editField') : t('fields.newField') }}</h2>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="draft = null">
          <AppIcon name="close" :size="18" />
        </button>
      </div>

      <div class="card-body stack">
        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="cf-label">
              {{ t('fields.label') }}<span class="req">*</span>
            </label>
            <input id="cf-label" v-model="draft.label" class="input" :maxlength="LIMITS.name" />
          </div>

          <div class="field">
            <label class="field-label" for="cf-entity">{{ t('fields.appliesTo') }}</label>
            <select id="cf-entity" v-model="draft.entity" class="select" :disabled="!!draft.id">
              <option v-for="e in FIELD_ENTITIES" :key="e" :value="e">
                {{ t(`fields.entity.${e}`) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="cf-type">{{ t('fields.fieldType') }}</label>
            <select id="cf-type" v-model="draft.type" class="select">
              <option v-for="ty in FIELD_TYPES" :key="ty" :value="ty">
                {{ t(`fields.type.${ty}`) }}
              </option>
            </select>
          </div>

          <div class="field">
            <label class="field-label" for="cf-vis">{{ t('fields.visibilityLabel') }}</label>
            <select id="cf-vis" v-model="draft.visibility" class="select">
              <option v-for="v in FIELD_VISIBILITY" :key="v" :value="v">
                {{ t(`fields.visibility.${v}`) }}
              </option>
            </select>
          </div>

          <div v-if="needsOptions" class="field">
            <label class="field-label" for="cf-options">{{ t('fields.options') }}</label>
            <input id="cf-options" v-model="optionsText" class="input" />
            <p class="field-hint">{{ t('fields.optionsHint') }}</p>
          </div>

          <div class="field">
            <label class="field-label" for="cf-default">{{ t('fields.defaultValue') }}</label>
            <input id="cf-default" v-model="draft.defaultValue" class="input" :maxlength="LIMITS.name" />
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="cf-help">{{ t('fields.helpText') }}</label>
          <input id="cf-help" v-model="draft.helpText" class="input" :maxlength="LIMITS.shortText" />
        </div>

        <label class="check">
          <input v-model="draft.required" type="checkbox" />
          <span class="check-text">{{ t('fields.required') }}</span>
        </label>
      </div>

      <div class="card-footer">
        <button class="btn btn-secondary" @click="draft = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="saving" @click="commit">
          <span v-if="saving" class="spinner" />{{ t('common.save') }}
        </button>
      </div>
    </section>

    <ConfirmDialog
      :open="pendingDelete !== null"
      :title="t('fields.deleteField')"
      :message="t('fields.deleteExplain')"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </div>
</template>

<style scoped>
.editor { border-color: var(--accent-soft-border); }

.chips { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.chip {
  padding: 0 var(--space-3); height: 30px;
  border: 1px solid var(--border-subtle); border-radius: var(--radius-full);
  background: var(--bg-surface);
  font-size: var(--text-xs); font-weight: 550; color: var(--text-secondary);
}
.chip:hover { background: var(--bg-hover); color: var(--text-primary); }
.chip.is-on { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }

.fields { list-style: none; margin: 0; padding: 0; }
.fields li {
  display: flex; align-items: center; gap: var(--space-2);
  padding: var(--space-2) var(--space-5);
  border-top: 1px solid var(--border-subtle);
}
.fields li.is-off { opacity: 0.55; }
.order { display: flex; flex-direction: column; }
.order .btn { padding: 0 var(--space-1); height: 18px; }

.field-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.field-name { font-size: var(--text-sm); font-weight: 600; }
.field-body code { font-family: var(--font-mono); }
.small { font-size: var(--text-xs); }
.danger:hover { color: var(--danger-500); }
</style>
