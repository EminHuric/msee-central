<script setup lang="ts">
/**
 * The recycle bin.
 *
 * Deleting anything important in this system sets `deletedAt` and nothing
 * more. The record drops out of every list, keeps its id, keeps its history,
 * and can be put back — which matters because the most common way to lose data
 * is not a bug, it is somebody being sure for four seconds.
 *
 * Purging is a separate permission and a separate button, and it says plainly
 * that it cannot be undone. The retention window is enforced here, when
 * somebody empties the bin, rather than by a timer nobody is watching: a record
 * vanishing on a schedule is exactly the surprise this feature exists to avoid.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { expired, fetchBin, purgeRecord, restoreRecord } from '@/api/records'
import { formatDate, formatRelative } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { RECOVERABLE, RETENTION_DAYS, type DeletedRecord } from '@/types/records'
import { PERMISSIONS } from '@/types/permissions'

const auth = useAuthStore()
const ui = useUiStore()
const { t } = useI18n()

const loading = ref(true)
const working = ref(false)

const rows = ref<DeletedRecord[]>([])
const search = ref('')
const kindFilter = ref('')

const pendingPurge = ref<DeletedRecord | null>(null)
const pendingEmpty = ref(false)

const canRestore = computed(() => auth.hasPermission(PERMISSIONS.RECYCLE_RESTORE))
const canPurge = computed(() => auth.hasPermission(PERMISSIONS.RECYCLE_PURGE))

const visible = computed(() => {
  const term = search.value.trim().toLowerCase()

  return rows.value.filter((r) => {
    if (kindFilter.value && r.collection !== kindFilter.value) return false
    if (!term) return true
    return `${r.label} ${r.detail} ${r.deletedByName}`.toLowerCase().includes(term)
  })
})

const overdue = computed(() => expired(rows.value))

async function load(): Promise<void> {
  loading.value = true
  rows.value = await fetchBin()
  loading.value = false
}

async function restore(record: DeletedRecord): Promise<void> {
  if (working.value) return
  working.value = true
  try {
    await restoreRecord(record)
    ui.notify('ok', t('recycle.restored'))
    await load()
  } catch {
    ui.notify('danger', t('recycle.restoreFailed'))
  } finally {
    working.value = false
  }
}

async function confirmPurge(): Promise<void> {
  if (!pendingPurge.value) return
  try {
    await purgeRecord(pendingPurge.value)
    ui.notify('ok', t('recycle.purged'))
  } catch {
    ui.notify('danger', t('recycle.purgeFailed'))
  }
  pendingPurge.value = null
  await load()
}

/** Empty the bin: destroy only what is past the retention window. */
async function confirmEmpty(): Promise<void> {
  pendingEmpty.value = false
  if (working.value) return

  working.value = true
  try {
    for (const record of overdue.value) await purgeRecord(record)
    ui.notify('ok', t('recycle.emptied'))
    await load()
  } catch {
    ui.notify('danger', t('recycle.purgeFailed'))
  } finally {
    working.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="stack">
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">{{ t('recycle.title') }}</h2>
          <p class="field-hint">{{ t('recycle.subtitle', { days: RETENTION_DAYS }) }}</p>
        </div>
        <button
          v-if="canPurge && overdue.length"
          class="btn btn-ghost btn-sm danger"
          @click="pendingEmpty = true"
        >
          {{ t('recycle.empty', { n: overdue.length }) }}
        </button>
      </div>

      <div class="card-body toolbar">
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

        <select v-model="kindFilter" class="select compact" :aria-label="t('recycle.kind')">
          <option value="">{{ t('recycle.allKinds') }}</option>
          <option v-for="c in RECOVERABLE" :key="c" :value="c">{{ t(`recycle.kinds.${c}`) }}</option>
        </select>
      </div>

      <div v-if="loading" class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 40px" />
      </div>

      <div v-else-if="visible.length === 0" class="empty">
        <span class="empty-icon"><AppIcon name="trash" :size="20" /></span>
        <p class="empty-title">{{ rows.length === 0 ? t('recycle.empty0') : t('recycle.noMatch') }}</p>
        <p class="empty-text">{{ t('recycle.emptyHint') }}</p>
      </div>

      <div v-else class="table-wrap">
        <table class="table table-cards">
          <thead>
            <tr>
              <th>{{ t('recycle.record') }}</th>
              <th class="hide-sm">{{ t('recycle.kind') }}</th>
              <th class="hide-sm">{{ t('recycle.deletedBy') }}</th>
              <th>{{ t('recycle.deletedAt') }}</th>
              <th>{{ t('recycle.daysLeft') }}</th>
              <th class="col-actions" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="record in visible" :key="`${record.collection}-${record.id}`">
              <td>
                <span class="strong">{{ record.label }}</span>
                <span v-if="record.detail" class="tertiary small block">{{ record.detail }}</span>
              </td>
              <td :data-label="t('recycle.kind')" class="hide-sm">
                <span class="badge badge-plain">{{ t(`recycle.kinds.${record.collection}`) }}</span>
              </td>
              <td :data-label="t('recycle.deletedBy')" class="hide-sm muted">{{ record.deletedByName || '—' }}</td>
              <td :data-label="t('recycle.deletedAt')" class="muted nowrap">
                {{ formatDate(record.deletedAt.slice(0, 10)) }}
                <span class="tertiary small block">{{ formatRelative(record.deletedAt) }}</span>
              </td>
              <td :data-label="t('recycle.daysLeft')" :class="record.daysLeft <= 0 ? 'neg' : record.daysLeft <= 7 ? 'warn' : ''">
                {{ record.daysLeft > 0 ? record.daysLeft : t('recycle.overdue') }}
              </td>
              <td class="col-actions">
                <button
                  v-if="canRestore"
                  class="btn btn-secondary btn-sm"
                  :disabled="working"
                  @click="restore(record)"
                >
                  {{ t('recycle.restore') }}
                </button>
                <button
                  v-if="canPurge"
                  class="btn btn-ghost btn-sm danger"
                  :aria-label="t('recycle.purge')"
                  @click="pendingPurge = record"
                >
                  <AppIcon name="trash" :size="15" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <ConfirmDialog
      :open="pendingPurge !== null"
      :title="t('recycle.purge')"
      :message="t('recycle.purgeExplain')"
      danger
      @confirm="confirmPurge"
      @cancel="pendingPurge = null"
    />

    <ConfirmDialog
      :open="pendingEmpty"
      :title="t('recycle.emptyTitle')"
      :message="t('recycle.emptyExplain', { n: overdue.length })"
      danger
      @confirm="confirmEmpty"
      @cancel="pendingEmpty = false"
    />
  </div>
</template>

<style scoped>
.search { position: relative; display: flex; align-items: center; }
.search-icon { position: absolute; left: var(--space-3); color: var(--text-tertiary); pointer-events: none; }
.search-input { padding-left: calc(var(--space-3) * 2 + 16px); }
.select.compact { max-width: 200px; }

.strong { font-weight: 650; }
.block { display: block; }
.small { font-size: var(--text-xs); }
.nowrap { white-space: nowrap; }
.warn { color: var(--warn-500); font-weight: 600; }
.neg { color: var(--danger-500); font-weight: 600; }
.danger:hover { color: var(--danger-500); }

</style>
