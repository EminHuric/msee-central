<script setup lang="ts">
/**
 * The notification centre in the top bar.
 *
 * Two lists, kept apart because they behave differently. "Needs action" is
 * derived from dates and cannot be dismissed — the only way to clear an
 * overdue payment is to collect it. "From people" is what somebody sent you,
 * and can be read and cleared like a message.
 *
 * Mixing them is what turns a bell into wallpaper: a person learns that
 * clearing it is free, and then stops reading the half that matters.
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import { fetchDatedNotes } from '@/api/records'
import { fetchProjects } from '@/api/operations'
import { fetchSales } from '@/api/sales'
import { fetchTransactions } from '@/api/finance'
import { balanceOf } from '@/types/revenue'
import {
  deriveNotifications,
  dismiss,
  fetchNotifications,
  fetchPreferences,
  markAllRead,
  markRead,
} from '@/api/notifications'
import { formatRelative } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import type { AppNotification } from '@/types/company'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()

const open = ref(false)
const loading = ref(false)
const root = ref<HTMLElement | null>(null)

const stored = ref<AppNotification[]>([])
const derived = ref<AppNotification[]>([])
const muted = ref<string[]>([])

const visibleStored = computed(() => stored.value.filter((n) => !muted.value.includes(n.kind)))
const visibleDerived = computed(() => derived.value.filter((n) => !muted.value.includes(n.kind)))

/**
 * The badge.
 *
 * Counts unread messages plus everything needing action — a person who has
 * read every message but has three overdue invoices should still see a number.
 */
const count = computed(
  () => visibleStored.value.filter((n) => !n.read).length + visibleDerived.value.length,
)

async function load(): Promise<void> {
  const uid = auth.uid
  if (!uid) return

  loading.value = true
  try {
    const [items, prefs, transactions, projects, notes, sales] = await Promise.all([
      fetchNotifications(uid),
      fetchPreferences(uid),
      fetchTransactions().catch(() => []),
      fetchProjects().catch(() => []),
      fetchDatedNotes().catch(() => []),
      fetchSales().catch(() => []),
    ])

    stored.value = items
    muted.value = prefs.muted ?? []
    derived.value = deriveNotifications({
      uid,
      transactions,
      projects,
      notes,
      /* A sale sold on an advance that has not arrived is the loudest one. */
      advanceDue: sales
        .filter((s) => balanceOf(s, transactions).advanceDue)
        .map((s) => ({ id: s.id, label: s.title, clientName: s.clientName })),
    })
  } finally {
    loading.value = false
  }
}

async function go(item: AppNotification, isStored: boolean): Promise<void> {
  if (isStored && !item.read && auth.uid) {
    await markRead(auth.uid, item.id)
    item.read = true
  }
  if (item.link) {
    open.value = false
    await router.push(item.link)
  }
}

async function clearAll(): Promise<void> {
  if (!auth.uid) return
  await markAllRead(auth.uid, stored.value)
  stored.value = stored.value.map((n) => ({ ...n, read: true }))
}

async function remove(item: AppNotification): Promise<void> {
  if (!auth.uid) return
  await dismiss(auth.uid, item.id)
  stored.value = stored.value.filter((n) => n.id !== item.id)
}

function onPointerDown(event: PointerEvent): void {
  if (!open.value) return
  if (root.value && !root.value.contains(event.target as Node)) open.value = false
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false
}

async function toggle(): Promise<void> {
  open.value = !open.value
  if (open.value) await load()
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('keydown', onKeydown)
  void load()
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="root" class="bell-root">
    <button
      type="button"
      class="btn btn-ghost btn-icon bell"
      :aria-label="t('notifications.title')"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="toggle"
    >
      <AppIcon name="bell" :size="18" />
      <span v-if="count > 0" class="badge-dot">{{ count > 9 ? '9+' : count }}</span>
    </button>

    <Transition name="menu">
      <div v-if="open" class="panel card" role="dialog" :aria-label="t('notifications.title')">
        <div class="panel-head">
          <h2 class="panel-title">{{ t('notifications.title') }}</h2>
          <button
            v-if="visibleStored.some((n) => !n.read)"
            class="btn btn-ghost btn-sm"
            @click="clearAll"
          >
            {{ t('notifications.markAllRead') }}
          </button>
        </div>

        <div v-if="loading" class="panel-body stack">
          <div v-for="n in 3" :key="n" class="skeleton" style="height: 40px" />
        </div>

        <div
          v-else-if="visibleDerived.length === 0 && visibleStored.length === 0"
          class="panel-empty"
        >
          <AppIcon name="check" :size="20" />
          <p class="empty-title">{{ t('notifications.empty') }}</p>
          <p class="empty-text">{{ t('notifications.emptyHint') }}</p>
        </div>

        <template v-else>
          <!-- Needs action ------------------------------------------- -->
          <section v-if="visibleDerived.length" class="group">
            <p class="group-title">{{ t('notifications.needsAction') }}</p>
            <button
              v-for="item in visibleDerived"
              :key="item.id"
              type="button"
              class="item"
              @click="go(item, false)"
            >
              <span class="pip" :class="`p-${item.priority}`" />
              <span class="item-body">
                <span class="item-title">{{ item.title }}</span>
                <span class="item-meta">
                  {{ t(`notificationKind.${item.kind}`) }}
                  <template v-if="item.body"> · {{ item.body }}</template>
                </span>
              </span>
            </button>
            <p class="group-note">{{ t('notifications.needsActionHint') }}</p>
          </section>

          <!-- From people -------------------------------------------- -->
          <section v-if="visibleStored.length" class="group">
            <p class="group-title">{{ t('notifications.fromPeople') }}</p>
            <div v-for="item in visibleStored" :key="item.id" class="item-row">
              <button
                type="button"
                class="item"
                :class="{ 'is-unread': !item.read }"
                @click="go(item, true)"
              >
                <span class="pip" :class="`p-${item.priority}`" />
                <span class="item-body">
                  <span class="item-title">{{ item.title }}</span>
                  <span class="item-meta">
                    {{ item.actorName || t(`notificationKind.${item.kind}`) }}
                    · {{ formatRelative(item.createdAt) }}
                  </span>
                </span>
              </button>
              <button
                class="btn btn-ghost btn-sm dismiss"
                :aria-label="t('notifications.dismiss')"
                @click="remove(item)"
              >
                <AppIcon name="close" :size="13" />
              </button>
            </div>
          </section>
        </template>

        <RouterLink to="/settings/notifications" class="panel-foot" @click="open = false">
          <AppIcon name="settings" :size="14" />
          {{ t('notifications.preferences') }}
        </RouterLink>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.bell-root { position: relative; }
.bell { position: relative; }

.badge-dot {
  position: absolute; top: 2px; right: 2px;
  min-width: 15px; height: 15px; padding: 0 3px;
  display: grid; place-items: center;
  border-radius: var(--radius-full);
  background: var(--danger-500); color: #fff;
  font-size: 9px; font-weight: 700; line-height: 1;
}

.panel {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 60;
  width: min(380px, calc(100vw - 24px));
  max-height: min(560px, calc(100vh - 90px));
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
}

.panel-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border-subtle); }
.panel-title { font-size: var(--text-base); font-weight: 650; }
.panel-body { padding: var(--space-4); }
.panel-empty { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-6) var(--space-4); text-align: center; color: var(--text-tertiary); }
.panel-empty .empty-title { font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); }
.panel-empty .empty-text { font-size: var(--text-xs); }

.group { border-bottom: 1px solid var(--border-subtle); padding-bottom: var(--space-2); }
.group-title { padding: var(--space-3) var(--space-4) var(--space-1); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); }
.group-note { padding: var(--space-1) var(--space-4); font-size: 10px; color: var(--text-tertiary); }

.item-row { display: flex; align-items: stretch; }
.item { flex: 1; display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-2) var(--space-4); text-align: left; min-width: 0; }
.item:hover { background: var(--bg-hover); }
.item.is-unread .item-title { font-weight: 650; }
.item.is-unread .pip { box-shadow: 0 0 0 3px var(--accent-soft-bg); }

.pip { width: 7px; height: 7px; border-radius: 50%; margin-top: 6px; flex-shrink: 0; }
.p-critical { background: var(--danger-500); }
.p-important { background: var(--warn-500); }
.p-normal { background: var(--accent); }
.p-info { background: var(--text-tertiary); }

.item-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.item-title { font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-meta { font-size: var(--text-xs); color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dismiss { align-self: center; }
.dismiss:hover { color: var(--danger-500); }

.panel-foot { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-4); font-size: var(--text-xs); color: var(--text-secondary); }
.panel-foot:hover { background: var(--bg-hover); color: var(--text-brand); }

.menu-enter-active, .menu-leave-active { transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out); }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
