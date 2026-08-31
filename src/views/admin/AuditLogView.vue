<script setup lang="ts">
/**
 * Audit log.
 *
 * The entries were being written from the first day the approval flow
 * existed; this is the screen that finally reads them.
 *
 * Append-only is enforced by the security rules, not here: `create` is
 * allowed, `update` and `delete` are refused to everybody including the
 * owner. That is the whole reason the log is worth reading — a record its
 * subject could quietly edit would prove nothing.
 *
 * The known limit stays honest: the client writes these entries, so the rules
 * can reject a forged one but cannot force one to be written. Everything done
 * through the application is logged.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { fetchAuditLog } from '@/api/audit'
import { formatDate, formatRelative } from '@/i18n'
import { AUDIT_ACTIONS, type AuditAction, type AuditLogEntry } from '@/types/domain'

const { t } = useI18n()

const loading = ref(true)
const loadError = ref(false)
const entries = ref<AuditLogEntry[]>([])
const expanded = ref<string | null>(null)

const search = ref('')
const actionFilter = ref<AuditAction | ''>('')
const actorFilter = ref('')

const PAGE = 100
const limit = ref(PAGE)

/** Only the actions that actually occur, so the filter is not mostly empty. */
const usedActions = computed(() => {
  const present = new Set(entries.value.map((e) => e.action))
  return AUDIT_ACTIONS.filter((action) => present.has(action))
})

const actors = computed(() => {
  const seen = new Map<string, string>()
  for (const entry of entries.value) {
    if (!seen.has(entry.actorUid)) seen.set(entry.actorUid, entry.actorName || entry.actorEmail)
  }
  return [...seen].map(([uid, name]) => ({ uid, name }))
})

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()

  return entries.value.filter((entry) => {
    if (actionFilter.value && entry.action !== actionFilter.value) return false
    if (actorFilter.value && entry.actorUid !== actorFilter.value) return false
    if (!term) return true

    return [entry.actorName, entry.actorEmail, entry.targetLabel, entry.action]
      .join(' ')
      .toLowerCase()
      .includes(term)
  })
})

const hasFilters = computed(
  () => search.value.trim() !== '' || actionFilter.value !== '' || actorFilter.value !== '',
)

function clearFilters(): void {
  search.value = ''
  actionFilter.value = ''
  actorFilter.value = ''
}

/** Colour the row by what kind of event it was, so a suspension stands out. */
function toneFor(action: AuditAction): string {
  if (action.includes('rejected') || action.includes('suspended') || action.includes('deleted')) {
    return 'is-danger'
  }
  if (action.includes('approved') || action.includes('activated') || action.includes('created')) {
    return 'is-ok'
  }
  if (action.startsWith('role') || action.startsWith('permissions')) return 'is-accent'
  return ''
}

/** Metadata is free-form; render it as readable lines rather than raw JSON. */
function metadataLines(entry: AuditLogEntry): { key: string; value: string }[] {
  const meta = entry.metadata ?? {}
  return Object.entries(meta)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({
      key,
      value: Array.isArray(value) ? value.join(', ') : String(value),
    }))
}

function toggle(id: string): void {
  expanded.value = expanded.value === id ? null : id
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = false
  try {
    entries.value = await fetchAuditLog(limit.value)
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function loadMore(): Promise<void> {
  limit.value += PAGE
  await load()
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('audit.title') }}</h1>
        <p class="page-subtitle">{{ t('audit.subtitle') }}</p>
      </div>
      <span class="badge badge-plain badge-accent">
        <AppIcon name="lock" :size="12" /> {{ t('audit.immutable') }}
      </span>
    </header>

    <div class="alert alert-info">
      <AppIcon name="shield" :size="16" />
      <span>{{ t('audit.immutableHint') }}</span>
    </div>

    <!-- Filters -------------------------------------------------------- -->
    <div class="toolbar">
      <div class="search toolbar-grow">
        <AppIcon name="search" :size="16" class="search-icon" />
        <input
          v-model="search"
          class="input search-input"
          type="search"
          :placeholder="t('audit.searchPlaceholder')"
          :aria-label="t('common.search')"
        />
      </div>

      <select v-model="actionFilter" class="select" :aria-label="t('audit.filterAction')">
        <option value="">{{ t('audit.allActions') }}</option>
        <option v-for="action in usedActions" :key="action" :value="action">
          {{ t(`auditAction.${action}`) }}
        </option>
      </select>

      <select v-model="actorFilter" class="select" :aria-label="t('audit.filterActor')">
        <option value="">{{ t('audit.allActors') }}</option>
        <option v-for="person in actors" :key="person.uid" :value="person.uid">
          {{ person.name }}
        </option>
      </select>

      <button v-if="hasFilters" type="button" class="btn btn-ghost" @click="clearFilters">
        {{ t('common.clear') }}
      </button>
    </div>

    <!-- States --------------------------------------------------------- -->
    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 6" :key="n" class="skeleton" style="height: 40px" />
      </div>
    </div>

    <div v-else-if="loadError" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="alert" :size="20" /></span>
        <p class="empty-title">{{ t('errors.generic') }}</p>
        <button class="btn btn-secondary" @click="load">{{ t('common.retry') }}</button>
      </div>
    </div>

    <div v-else-if="filtered.length === 0" class="card">
      <div class="empty">
        <span class="empty-icon"><AppIcon name="scroll" :size="20" /></span>
        <p class="empty-title">
          {{ entries.length === 0 ? t('audit.empty') : t('audit.noMatch') }}
        </p>
        <p class="empty-text">
          {{ entries.length === 0 ? t('audit.emptyHint') : t('audit.noMatchHint') }}
        </p>
        <button v-if="hasFilters" class="btn btn-secondary" @click="clearFilters">
          {{ t('common.clear') }}
        </button>
      </div>
    </div>

    <!-- The trail ------------------------------------------------------ -->
    <template v-else>
      <div class="card">
        <ul class="trail">
          <li
            v-for="entry in filtered"
            :key="entry.id"
            class="entry"
            :class="[toneFor(entry.action), { 'is-open': expanded === entry.id }]"
          >
            <button type="button" class="entry-row" @click="toggle(entry.id)">
              <span class="entry-dot" />

              <UserAvatar :name="entry.actorName || entry.actorEmail" :size="28" />

              <span class="entry-main">
                <span class="entry-line">
                  <strong>{{ entry.actorName || entry.actorEmail }}</strong>
                  <span class="entry-action">{{ t(`auditAction.${entry.action}`) }}</span>
                  <span v-if="entry.targetLabel" class="entry-target">{{ entry.targetLabel }}</span>
                </span>
                <span class="entry-when">{{ formatRelative(entry.createdAt) }}</span>
              </span>

              <span class="entry-date tertiary">{{ formatDate(entry.createdAt, true) }}</span>

              <AppIcon
                v-if="metadataLines(entry).length"
                name="chevronDown"
                :size="15"
                class="entry-chevron tertiary"
              />
            </button>

            <dl v-if="expanded === entry.id && metadataLines(entry).length" class="meta">
              <div v-for="line in metadataLines(entry)" :key="line.key" class="meta-row">
                <dt>{{ line.key }}</dt>
                <dd>{{ line.value }}</dd>
              </div>
            </dl>
          </li>
        </ul>
      </div>

      <div class="foot">
        <span class="tertiary">{{ t('audit.showing', { n: filtered.length }) }}</span>
        <button
          v-if="entries.length >= limit"
          class="btn btn-secondary btn-sm"
          @click="loadMore"
        >
          {{ t('audit.loadMore') }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.search {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: var(--space-3);
  color: var(--text-tertiary);
  pointer-events: none;
}

.search-input {
  padding-left: calc(var(--space-3) * 2 + 16px);
}

.trail {
  list-style: none;
  padding: 0;
  margin: 0;
}

.entry {
  border-bottom: 1px solid var(--border-subtle);
}

.entry:last-child {
  border-bottom: none;
}

.entry-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-5);
  text-align: left;
  transition: background var(--dur-fast) var(--ease-out);
}

.entry-row:hover {
  background: var(--bg-hover);
}

.entry-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--neutral-500);
  flex-shrink: 0;
}

.is-ok .entry-dot {
  background: var(--ok-500);
}
.is-danger .entry-dot {
  background: var(--danger-500);
}
.is-accent .entry-dot {
  background: var(--accent);
}

.entry-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.entry-line {
  font-size: var(--text-base);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.entry-action {
  color: var(--text-secondary);
  margin-inline: var(--space-2);
}

.entry-target {
  color: var(--text-brand);
  font-weight: 550;
}

.entry-when {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.entry-date {
  font-size: var(--text-xs);
  white-space: nowrap;
}

.entry-chevron {
  transition: transform var(--dur-fast) var(--ease-out);
}

.is-open .entry-chevron {
  transform: rotate(180deg);
}

.meta {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5) var(--space-4) calc(var(--space-5) + 46px);
  background: var(--bg-inset);
}

.meta-row {
  display: flex;
  gap: var(--space-3);
  font-size: var(--text-sm);
}

.meta-row dt {
  min-width: 140px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  padding-top: 2px;
}

.meta-row dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  font-size: var(--text-sm);
}

@media (max-width: 720px) {
  .entry-date {
    display: none;
  }
}
</style>
