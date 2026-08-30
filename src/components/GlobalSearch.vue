<script setup lang="ts">
/**
 * Search across people and pages.
 *
 * The directory is loaded once on first use rather than on every keystroke:
 * a company has tens of employees, not thousands, so filtering in memory is
 * instant and costs one read instead of one per letter typed.
 *
 * Only what the viewer may reach is searchable. Pages are filtered by the same
 * permissions that build the sidebar, and people are simply absent for anybody
 * the rules would refuse — an affiliate searching finds only pages.
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { fetchEmployees } from '@/api/employees'
import { useAuthStore } from '@/stores/auth'
import type { EmployeePublic } from '@/types/domain'
import { PERMISSIONS, type Permission } from '@/types/permissions'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()

const term = ref('')
const open = ref(false)
const loaded = ref(false)
const people = ref<EmployeePublic[]>([])
const root = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const highlighted = ref(0)

const isAffiliate = computed(() => auth.access?.accountType === 'affiliate')
const canSeePeople = computed(
  () => auth.hasPermission(PERMISSIONS.EMPLOYEES_VIEW) && !isAffiliate.value,
)

interface PageEntry {
  to: string
  labelKey: string
  icon: string
  permission?: Permission
  internalOnly?: boolean
}

const PAGES: PageEntry[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: 'dashboard' },
  {
    to: '/employees',
    labelKey: 'nav.employees',
    icon: 'users',
    permission: PERMISSIONS.EMPLOYEES_VIEW,
    internalOnly: true,
  },
  {
    to: '/requests',
    labelKey: 'nav.requests',
    icon: 'inbox',
    permission: PERMISSIONS.REQUESTS_VIEW,
    internalOnly: true,
  },
  {
    to: '/roles',
    labelKey: 'nav.roles',
    icon: 'shield',
    permission: PERMISSIONS.ROLES_VIEW,
    internalOnly: true,
  },
  {
    to: '/organization',
    labelKey: 'nav2.organization',
    icon: 'building',
    permission: PERMISSIONS.DEPARTMENTS_MANAGE,
    internalOnly: true,
  },
  {
    to: '/audit',
    labelKey: 'nav.audit',
    icon: 'scroll',
    permission: PERMISSIONS.AUDIT_VIEW,
    internalOnly: true,
  },
  { to: '/profile', labelKey: 'nav.profile', icon: 'user' },
  { to: '/settings', labelKey: 'nav.settings', icon: 'settings' },
]

const availablePages = computed(() =>
  PAGES.filter((page) => {
    if (page.internalOnly && isAffiliate.value) return false
    if (page.permission && !auth.hasPermission(page.permission)) return false
    return true
  }),
)

const query = computed(() => term.value.trim().toLowerCase())

const pageResults = computed(() => {
  if (!query.value) return []
  return availablePages.value
    .filter((page) => t(page.labelKey).toLowerCase().includes(query.value))
    .slice(0, 5)
})

const peopleResults = computed(() => {
  if (!query.value || !canSeePeople.value) return []
  return people.value
    .filter((person) =>
      `${person.firstName} ${person.lastName} ${person.employeeCode ?? ''}`
        .toLowerCase()
        .includes(query.value),
    )
    .slice(0, 6)
})

/** One flat list, so the arrow keys walk everything in the order shown. */
const flat = computed(() => [
  ...peopleResults.value.map((p) => ({ kind: 'person' as const, to: `/employees/${p.uid}`, person: p })),
  ...pageResults.value.map((p) => ({ kind: 'page' as const, to: p.to, page: p })),
])

watch(query, () => {
  highlighted.value = 0
})

async function ensureLoaded(): Promise<void> {
  if (loaded.value || !canSeePeople.value) return
  loaded.value = true
  people.value = await fetchEmployees().catch(() => [])
}

function focusSearch(): void {
  open.value = true
  void ensureLoaded()
  requestAnimationFrame(() => input.value?.focus())
}

function close(): void {
  open.value = false
  term.value = ''
}

function go(to: string): void {
  close()
  void router.push(to)
}

function onKeydown(event: KeyboardEvent): void {
  // Ctrl/Cmd+K from anywhere, the shortcut people already expect.
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    focusSearch()
    return
  }

  if (!open.value) return

  if (event.key === 'Escape') {
    close()
    return
  }

  if (flat.value.length === 0) return

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    highlighted.value = (highlighted.value + 1) % flat.value.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    highlighted.value = (highlighted.value - 1 + flat.value.length) % flat.value.length
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const target = flat.value[highlighted.value]
    if (target) go(target.to)
  }
}

function onPointerDown(event: PointerEvent): void {
  if (open.value && root.value && !root.value.contains(event.target as Node)) close()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('pointerdown', onPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('pointerdown', onPointerDown)
})
</script>

<template>
  <div ref="root" class="search-root">
    <button type="button" class="search-trigger" @click="focusSearch">
      <AppIcon name="search" :size="16" />
      <span class="search-text">{{ t('search.placeholder') }}</span>
      <kbd class="search-kbd">{{ t('search.shortcut') }}</kbd>
    </button>

    <Transition name="pop">
      <div v-if="open" class="panel card">
        <div class="panel-input">
          <AppIcon name="search" :size="16" class="tertiary" />
          <input
            ref="input"
            v-model="term"
            class="bare"
            type="text"
            :placeholder="t('search.placeholder')"
            :aria-label="t('search.open')"
            @focus="ensureLoaded"
          />
          <button
            v-if="term"
            type="button"
            class="btn btn-ghost btn-icon"
            :aria-label="t('common.clear')"
            @click="term = ''"
          >
            <AppIcon name="close" :size="15" />
          </button>
        </div>

        <p v-if="!query" class="panel-hint">{{ t('search.hint') }}</p>

        <p v-else-if="flat.length === 0" class="panel-hint">
          {{ t('search.noResults', { term }) }}
        </p>

        <div v-else class="panel-results">
          <template v-if="peopleResults.length">
            <p class="eyebrow group-label">{{ t('search.people') }}</p>
            <button
              v-for="(person, index) in peopleResults"
              :key="person.uid"
              type="button"
              class="result"
              :class="{ 'is-active': highlighted === index }"
              @click="go(`/employees/${person.uid}`)"
              @mouseenter="highlighted = index"
            >
              <UserAvatar
                :name="`${person.firstName} ${person.lastName}`"
                :photo-url="person.photoUrl"
                :size="28"
              />
              <span class="result-text">
                <span class="result-name">{{ person.firstName }} {{ person.lastName }}</span>
                <span class="result-sub">{{ person.employeeCode }}</span>
              </span>
            </button>
          </template>

          <template v-if="pageResults.length">
            <p class="eyebrow group-label">{{ t('search.pages') }}</p>
            <button
              v-for="(page, index) in pageResults"
              :key="page.to"
              type="button"
              class="result"
              :class="{ 'is-active': highlighted === peopleResults.length + index }"
              @click="go(page.to)"
              @mouseenter="highlighted = peopleResults.length + index"
            >
              <span class="result-icon"><AppIcon :name="page.icon" :size="15" /></span>
              <span class="result-text">
                <span class="result-name">{{ t(page.labelKey) }}</span>
              </span>
            </button>
          </template>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.search-root {
  position: relative;
  flex: 1;
  max-width: 420px;
}

.search-trigger {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  height: 34px;
  padding: 0 var(--space-3);
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  transition: border-color var(--dur-fast) var(--ease-out);
}

.search-trigger:hover {
  border-color: var(--border-strong);
  color: var(--text-secondary);
}

.search-text {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-kbd {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  padding: 1px var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-surface-3);
}

.panel {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-dropdown);
  background: var(--bg-surface-2);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.panel-input {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}

.bare {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  height: 30px;
  font-size: var(--text-base);
  color: var(--text-primary);
}

.bare::placeholder {
  color: var(--text-tertiary);
}

.panel-hint {
  padding: var(--space-4);
  font-size: var(--text-sm);
  color: var(--text-tertiary);
}

.panel-results {
  max-height: 380px;
  overflow-y: auto;
  padding: var(--space-2);
}

.group-label {
  padding: var(--space-2) var(--space-2) var(--space-1);
}

.result {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-2);
  border-radius: var(--radius-sm);
  text-align: left;
}

.result.is-active {
  background: var(--accent-soft-bg);
}

.result-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: var(--bg-surface-3);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.result-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.result-name {
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--text-primary);
}

.result-sub {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}

.pop-enter-active,
.pop-leave-active {
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
  transform-origin: top;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

@media (max-width: 640px) {
  .search-text,
  .search-kbd {
    display: none;
  }

  .search-root {
    flex: 0 0 auto;
    max-width: none;
  }

  .search-trigger {
    width: 34px;
    justify-content: center;
  }

  .panel {
    width: min(360px, calc(100vw - var(--space-8)));
    left: auto;
    right: 0;
  }
}
</style>
