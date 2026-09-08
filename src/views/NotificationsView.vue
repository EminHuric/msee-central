<script setup lang="ts">
/**
 * The notification centre as a full page.
 *
 * Same two lists as the bell, with room to read them. They are kept apart
 * because they behave differently: "needs action" is derived from dates and
 * cannot be dismissed — the only way to clear an overdue payment is to collect
 * it — while "from people" is what somebody sent you and can be cleared.
 *
 * Mixing the two is what turns a notification centre into wallpaper.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import { fetchDatedNotes } from '@/api/records'
import { fetchProjects } from '@/api/operations'
import { fetchSales } from '@/api/sales'
import { fetchTransactions } from '@/api/finance'
import {
  deriveNotifications,
  dismiss,
  fetchNotifications,
  fetchPreferences,
  markAllRead,
  markRead,
} from '@/api/notifications'
import { balanceOf } from '@/types/revenue'
import { formatRelative } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import type { AppNotification } from '@/types/company'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()

const loading = ref(true)
const stored = ref<AppNotification[]>([])
const derived = ref<AppNotification[]>([])
const muted = ref<string[]>([])

const visibleStored = computed(() => stored.value.filter((n) => !muted.value.includes(n.kind)))
const visibleDerived = computed(() => derived.value.filter((n) => !muted.value.includes(n.kind)))

async function load(): Promise<void> {
  const uid = auth.uid
  if (!uid) return

  loading.value = true
  try {
    const [items, prefs, transactions, projects, notes, sales] = await Promise.all([
      fetchNotifications(uid, 100),
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
  if (item.link) await router.push(item.link)
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

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('notifications.title') }}</h1>
        <p class="page-subtitle">{{ t('notifications.subtitle') }}</p>
      </div>
      <div class="head-actions">
        <button
          v-if="visibleStored.some((n) => !n.read)"
          class="btn btn-secondary"
          @click="clearAll"
        >
          {{ t('notifications.markAllRead') }}
        </button>
        <RouterLink to="/settings/notifications" class="btn btn-ghost">
          <AppIcon name="settings" :size="15" /> {{ t('notifications.preferences') }}
        </RouterLink>
      </div>
    </header>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 4" :key="n" class="skeleton" style="height: 44px" />
      </div>
    </div>

    <div
      v-else-if="visibleDerived.length === 0 && visibleStored.length === 0"
      class="card"
    >
      <div class="empty">
        <span class="empty-icon"><AppIcon name="check" :size="20" /></span>
        <p class="empty-title">{{ t('notifications.empty') }}</p>
        <p class="empty-text">{{ t('notifications.emptyHint') }}</p>
      </div>
    </div>

    <template v-else>
      <section v-if="visibleDerived.length" class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">{{ t('notifications.needsAction') }}</h2>
            <p class="field-hint">{{ t('notifications.needsActionHint') }}</p>
          </div>
          <span class="badge badge-plain">{{ visibleDerived.length }}</span>
        </div>

        <ul class="items">
          <li v-for="item in visibleDerived" :key="item.id">
            <button type="button" class="item" @click="go(item, false)">
              <span class="pip" :class="`p-${item.priority}`" />
              <span class="item-body">
                <span class="item-title">{{ item.title }}</span>
                <span class="item-meta tertiary">
                  {{ t(`notificationKind.${item.kind}`) }}
                  <template v-if="item.body"> · {{ item.body }}</template>
                </span>
              </span>
              <span class="badge badge-plain">{{ t(`notificationPriority.${item.priority}`) }}</span>
            </button>
          </li>
        </ul>
      </section>

      <section v-if="visibleStored.length" class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('notifications.fromPeople') }}</h2>
        </div>

        <ul class="items">
          <li v-for="item in visibleStored" :key="item.id" class="row">
            <button
              type="button"
              class="item"
              :class="{ 'is-unread': !item.read }"
              @click="go(item, true)"
            >
              <span class="pip" :class="`p-${item.priority}`" />
              <span class="item-body">
                <span class="item-title">{{ item.title }}</span>
                <span class="item-meta tertiary">
                  {{ item.actorName || t(`notificationKind.${item.kind}`) }}
                  · {{ formatRelative(item.createdAt) }}
                  <template v-if="item.body"> · {{ item.body }}</template>
                </span>
              </span>
            </button>
            <button
              class="btn btn-ghost btn-sm dismiss"
              :aria-label="t('notifications.dismiss')"
              @click="remove(item)"
            >
              <AppIcon name="close" :size="14" />
            </button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.head-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }

.items { list-style: none; margin: 0; padding: 0; }
.items li { border-top: 1px solid var(--border-subtle); }
.row { display: flex; align-items: stretch; }

.item { flex: 1; display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-5); text-align: left; min-width: 0; }
.item:hover { background: var(--bg-hover); }
.item.is-unread .item-title { font-weight: 650; }

.pip { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.p-critical { background: var(--danger-500); }
.p-important { background: var(--warn-500); }
.p-normal { background: var(--accent); }
.p-info { background: var(--text-tertiary); }

.item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.item-title { font-size: var(--text-sm); }
.item-meta { font-size: var(--text-xs); }
.dismiss { align-self: center; }
.dismiss:hover { color: var(--danger-500); }
</style>
