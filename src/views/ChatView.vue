<script setup lang="ts">
/**
 * Internal messages.
 *
 * Read through live listeners rather than fetched: a message that arrives
 * while somebody is looking at the conversation should appear. Both listeners
 * are torn down on unmount and whenever the open thread changes — a forgotten
 * listener is a leak that also keeps billing.
 *
 * Announcements are threads nobody can reply to. They are not a separate
 * mechanism, so they obey the same membership rule as everything else; the
 * only difference is that the composer is hidden.
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { fetchEmployees } from '@/api/employees'
import { fetchDepartments } from '@/api/organisation'
import {
  createThread,
  isUnread,
  markThreadRead,
  openDirect,
  sendAnnouncement,
  sendMessage,
  watchMessages,
  watchThreads,
} from '@/api/chat'
import { formatRelative } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import type { ChatMessage, ChatThread } from '@/types/company'
import { PERMISSIONS } from '@/types/permissions'
import type { Department, EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const route = useRoute()
const { t } = useI18n()

const threads = ref<ChatThread[]>([])
const messages = ref<ChatMessage[]>([])
const people = ref<EmployeePublic[]>([])
const departments = ref<Department[]>([])

const activeId = ref<string | null>(null)
const body = ref('')
const sending = ref(false)
const search = ref('')
const composing = ref<'group' | 'announcement' | null>(null)
const listEnd = ref<HTMLElement | null>(null)

/* Group composer */
const groupName = ref('')
const chosen = ref<string[]>([])

/* Announcement composer */
const annTitle = ref('')
const annBody = ref('')
const annAudience = ref<'everyone' | 'department' | 'selected'>('everyone')
const annDepartment = ref('')

const canGroups = computed(() => auth.hasPermission(PERMISSIONS.CHAT_MANAGE_GROUPS))
const canAnnounce = computed(() => auth.hasPermission(PERMISSIONS.ANNOUNCEMENTS_SEND))

let stopThreads: (() => void) | null = null
let stopMessages: (() => void) | null = null

const colleagues = computed(() =>
  people.value.filter((p) => p.uid !== auth.uid && p.accountType !== 'affiliate'),
)

const directory = computed(() =>
  people.value.map((p) => ({ uid: p.uid, name: `${p.firstName} ${p.lastName}` })),
)

const active = computed(() => threads.value.find((th) => th.id === activeId.value) ?? null)

const visibleThreads = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return threads.value
  return threads.value.filter((th) => `${th.title} ${th.lastMessage}`.toLowerCase().includes(term))
})

const grouped = computed(() => ({
  direct: visibleThreads.value.filter((th) => th.kind === 'direct'),
  group: visibleThreads.value.filter((th) => th.kind === 'group'),
  announcement: visibleThreads.value.filter((th) => th.kind === 'announcement'),
}))

/** People you have no thread with yet, so a conversation can be started. */
const startable = computed(() => {
  const known = new Set(
    threads.value.filter((th) => th.kind === 'direct').flatMap((th) => th.memberUids),
  )
  return colleagues.value.filter((p) => !known.has(p.uid))
})

function titleOf(thread: ChatThread): string {
  if (thread.kind !== 'direct') return thread.title
  const other = thread.memberUids.find((uid) => uid !== auth.uid)
  const person = people.value.find((p) => p.uid === other)
  return person ? `${person.firstName} ${person.lastName}` : thread.title
}

function scrollDown(): void {
  requestAnimationFrame(() => listEnd.value?.scrollIntoView({ block: 'end' }))
}

async function select(id: string): Promise<void> {
  activeId.value = id
  composing.value = null

  stopMessages?.()
  stopMessages = watchMessages(id, (rows) => {
    messages.value = rows
    scrollDown()
  })

  const thread = threads.value.find((th) => th.id === id)
  if (thread && isUnread(thread, auth.uid ?? '')) await markThreadRead(thread)
}

async function send(): Promise<void> {
  const thread = active.value
  if (!thread || sending.value || !body.value.trim()) return

  sending.value = true
  try {
    await sendMessage(thread, body.value, directory.value)
    body.value = ''
  } catch {
    ui.notify('danger', t('chat.createFailed'))
  } finally {
    sending.value = false
  }
}

async function startDirect(person: EmployeePublic): Promise<void> {
  try {
    const id = await openDirect(person.uid, `${person.firstName} ${person.lastName}`)
    await select(id)
  } catch {
    ui.notify('danger', t('chat.createFailed'))
  }
}

function toggleChosen(uid: string): void {
  const i = chosen.value.indexOf(uid)
  if (i >= 0) chosen.value.splice(i, 1)
  else chosen.value.push(uid)
}

async function createGroup(): Promise<void> {
  if (chosen.value.length === 0) {
    ui.notify('danger', t('chat.membersRequired'))
    return
  }

  sending.value = true
  try {
    const id = await createThread({
      kind: 'group',
      title: groupName.value.trim() || t('chat.newGroup'),
      memberUids: chosen.value,
    })
    ui.notify('ok', t('chat.created'))
    composing.value = null
    groupName.value = ''
    chosen.value = []
    await select(id)
  } catch {
    ui.notify('danger', t('chat.createFailed'))
  } finally {
    sending.value = false
  }
}

/** Who an announcement reaches, given the chosen audience. */
const announcementRecipients = computed(() => {
  if (annAudience.value === 'everyone') return directory.value
  if (annAudience.value === 'department') {
    return people.value
      .filter((p) => p.departmentId === annDepartment.value)
      .map((p) => ({ uid: p.uid, name: `${p.firstName} ${p.lastName}` }))
  }
  return directory.value.filter((p) => chosen.value.includes(p.uid))
})

async function announce(): Promise<void> {
  if (!annTitle.value.trim() || announcementRecipients.value.length === 0) {
    ui.notify('danger', t('chat.membersRequired'))
    return
  }

  sending.value = true
  try {
    const id = await sendAnnouncement(annTitle.value, annBody.value, announcementRecipients.value)
    ui.notify('ok', t('chat.announcementSent'))
    composing.value = null
    annTitle.value = ''
    annBody.value = ''
    chosen.value = []
    await select(id)
  } catch {
    ui.notify('danger', t('chat.createFailed'))
  } finally {
    sending.value = false
  }
}

onMounted(async () => {
  people.value = await fetchEmployees().catch(() => [])
  departments.value = await fetchDepartments().catch(() => [])

  stopThreads = watchThreads(auth.uid ?? '', (rows) => {
    threads.value = rows
    /* A thread named in the URL — from a notification — opens itself. */
    const wanted = String(route.query.thread ?? '')
    if (!activeId.value && wanted && rows.some((th) => th.id === wanted)) void select(wanted)
  })
})

onBeforeUnmount(() => {
  stopThreads?.()
  stopMessages?.()
})

watch(activeId, () => {
  body.value = ''
})
</script>

<template>
  <div class="page chat-page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('chat.title') }}</h1>
        <p class="page-subtitle">{{ t('chat.subtitle') }}</p>
      </div>
      <div class="head-actions">
        <button v-if="canGroups" class="btn btn-secondary" @click="composing = 'group'">
          <AppIcon name="users" :size="16" /> {{ t('chat.newGroup') }}
        </button>
        <button v-if="canAnnounce" class="btn btn-primary" @click="composing = 'announcement'">
          <AppIcon name="send" :size="16" /> {{ t('chat.newAnnouncement') }}
        </button>
      </div>
    </header>

    <!-- Group composer -------------------------------------------------- -->
    <section v-if="composing === 'group'" class="card editor">
      <div class="card-header">
        <h2 class="card-title">{{ t('chat.newGroup') }}</h2>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="composing = null">
          <AppIcon name="close" :size="18" />
        </button>
      </div>
      <div class="card-body stack">
        <div class="field">
          <label class="field-label" for="g-name">{{ t('chat.groupName') }}</label>
          <input id="g-name" v-model="groupName" class="input" :maxlength="LIMITS.name" />
        </div>
        <div class="field">
          <span class="field-label">{{ t('chat.members') }}</span>
          <div class="picker">
            <label v-for="p in colleagues" :key="p.uid" class="check">
              <input type="checkbox" :checked="chosen.includes(p.uid)" @change="toggleChosen(p.uid)" />
              <span class="check-text">{{ p.firstName }} {{ p.lastName }}</span>
            </label>
          </div>
        </div>
      </div>
      <div class="card-footer">
        <button class="btn btn-secondary" @click="composing = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="sending" @click="createGroup">
          {{ t('common.create') }}
        </button>
      </div>
    </section>

    <!-- Announcement composer ------------------------------------------ -->
    <section v-if="composing === 'announcement'" class="card editor">
      <div class="card-header">
        <h2 class="card-title">{{ t('chat.newAnnouncement') }}</h2>
        <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="composing = null">
          <AppIcon name="close" :size="18" />
        </button>
      </div>
      <div class="card-body stack">
        <p class="field-hint">{{ t('chat.announcementHint') }}</p>

        <div class="field">
          <label class="field-label" for="a-title">{{ t('chat.announcementTitle') }}</label>
          <input id="a-title" v-model="annTitle" class="input" :maxlength="LIMITS.position" />
        </div>

        <div class="field-grid">
          <div class="field">
            <label class="field-label" for="a-aud">{{ t('chat.audience') }}</label>
            <select id="a-aud" v-model="annAudience" class="select">
              <option value="everyone">{{ t('chat.audienceEveryone') }}</option>
              <option value="department">{{ t('chat.audienceDepartment') }}</option>
              <option value="selected">{{ t('chat.audienceSelected') }}</option>
            </select>
          </div>
          <div v-if="annAudience === 'department'" class="field">
            <label class="field-label" for="a-dep">{{ t('table.department') }}</label>
            <select id="a-dep" v-model="annDepartment" class="select">
              <option value="">—</option>
              <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
          </div>
        </div>

        <div v-if="annAudience === 'selected'" class="field">
          <span class="field-label">{{ t('chat.members') }}</span>
          <div class="picker">
            <label v-for="p in colleagues" :key="p.uid" class="check">
              <input type="checkbox" :checked="chosen.includes(p.uid)" @change="toggleChosen(p.uid)" />
              <span class="check-text">{{ p.firstName }} {{ p.lastName }}</span>
            </label>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="a-body">{{ t('chat.announcementBody') }}</label>
          <textarea id="a-body" v-model="annBody" class="textarea" rows="4" :maxlength="LIMITS.longText" />
        </div>
      </div>
      <div class="card-footer">
        <span class="tertiary small">{{ announcementRecipients.length }}</span>
        <span class="spacer" />
        <button class="btn btn-secondary" @click="composing = null">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" :disabled="sending" @click="announce">
          {{ t('chat.sendAnnouncement') }}
        </button>
      </div>
    </section>

    <!-- Conversation ---------------------------------------------------- -->
    <div class="layout">
      <aside class="card list">
        <div class="list-search">
          <AppIcon name="search" :size="15" class="search-icon" />
          <input
            v-model="search"
            class="input search-input"
            type="search"
            :placeholder="t('common.searchPlaceholder')"
            :aria-label="t('common.search')"
          />
        </div>

        <div class="list-scroll">
          <template v-for="kind in (['announcement', 'direct', 'group'] as const)" :key="kind">
            <template v-if="grouped[kind].length">
              <p class="list-title">
                {{
                  kind === 'direct'
                    ? t('chat.direct')
                    : kind === 'group'
                      ? t('chat.groups')
                      : t('chat.announcements')
                }}
              </p>
              <button
                v-for="th in grouped[kind]"
                :key="th.id"
                type="button"
                class="thread"
                :class="{ 'is-active': th.id === activeId }"
                @click="select(th.id)"
              >
                <UserAvatar :name="titleOf(th)" :size="32" />
                <span class="thread-body">
                  <span class="thread-title">{{ titleOf(th) }}</span>
                  <span class="thread-last">{{ th.lastMessage || '—' }}</span>
                </span>
                <span v-if="isUnread(th, auth.uid ?? '')" class="unread" />
              </button>
            </template>
          </template>

          <template v-if="startable.length">
            <p class="list-title">{{ t('chat.newMessage') }}</p>
            <button
              v-for="p in startable"
              :key="p.uid"
              type="button"
              class="thread is-new"
              @click="startDirect(p)"
            >
              <UserAvatar :name="`${p.firstName} ${p.lastName}`" :photo-url="p.photoUrl" :size="32" />
              <span class="thread-body">
                <span class="thread-title">{{ p.firstName }} {{ p.lastName }}</span>
              </span>
              <AppIcon name="plus" :size="14" class="tertiary" />
            </button>
          </template>

          <div v-if="threads.length === 0 && startable.length === 0" class="empty">
            <span class="empty-icon"><AppIcon name="chat" :size="20" /></span>
            <p class="empty-title">{{ t('chat.noThreads') }}</p>
            <p class="empty-text">{{ t('chat.noThreadsHint') }}</p>
          </div>
        </div>
      </aside>

      <section class="card panel">
        <div v-if="!active" class="empty tall">
          <span class="empty-icon"><AppIcon name="chat" :size="20" /></span>
          <p class="empty-title">{{ t('chat.selectThread') }}</p>
          <p class="empty-text">{{ t('chat.selectThreadHint') }}</p>
        </div>

        <template v-else>
          <div class="card-header">
            <h2 class="card-title">{{ titleOf(active) }}</h2>
            <span v-if="active.kind !== 'direct'" class="badge badge-plain">
              {{ active.memberUids.length }}
            </span>
          </div>

          <div class="messages">
            <div v-if="messages.length === 0" class="empty">
              <p class="empty-title">{{ t('chat.noMessages') }}</p>
              <p class="empty-text">{{ t('chat.noMessagesHint') }}</p>
            </div>

            <div
              v-for="m in messages"
              :key="m.id"
              class="message"
              :class="{ 'is-mine': m.authorUid === auth.uid }"
            >
              <span class="bubble">
                <span v-if="m.authorUid !== auth.uid" class="author">{{ m.authorName }}</span>
                <span class="text">{{ m.body }}</span>
                <span class="time">{{ formatRelative(m.createdAt) }}</span>
              </span>
            </div>
            <div ref="listEnd" />
          </div>

          <div v-if="active.kind === 'announcement'" class="composer readonly">
            <AppIcon name="lock" :size="14" />
            {{ t('chat.readOnly') }}
          </div>

          <form v-else class="composer" @submit.prevent="send">
            <input
              v-model="body"
              class="input"
              :placeholder="t('chat.writeMessage')"
              :aria-label="t('chat.writeMessage')"
              :maxlength="LIMITS.longText"
            />
            <button class="btn btn-primary" type="submit" :disabled="sending || !body.trim()">
              <AppIcon name="send" :size="16" />
              <span class="send-label">{{ t('chat.send') }}</span>
            </button>
          </form>
          <p v-if="active.kind !== 'announcement'" class="mention-hint tertiary">
            {{ t('chat.mentionHint') }}
          </p>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.editor { border-color: var(--accent-soft-border); }
.head-actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.spacer { flex: 1; }
.picker { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-top: var(--space-2); }

.layout { display: grid; grid-template-columns: minmax(240px, 320px) minmax(0, 1fr); gap: var(--space-4); align-items: stretch; min-height: 480px; }
@media (max-width: 820px) { .layout { grid-template-columns: 1fr; } }

.list { display: flex; flex-direction: column; overflow: hidden; }
.list-search { position: relative; display: flex; align-items: center; padding: var(--space-3); border-bottom: 1px solid var(--border-subtle); }
.search-icon { position: absolute; left: calc(var(--space-3) * 2); color: var(--text-tertiary); pointer-events: none; }
.search-input { padding-left: calc(var(--space-3) * 2 + 14px); }
.list-scroll { flex: 1; overflow-y: auto; max-height: 520px; }
.list-title { padding: var(--space-3) var(--space-4) var(--space-1); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); }

.thread { display: flex; align-items: center; gap: var(--space-3); width: 100%; padding: var(--space-2) var(--space-4); text-align: left; }
.thread:hover { background: var(--bg-hover); }
.thread.is-active { background: var(--accent-soft-bg); }
.thread.is-new { opacity: 0.75; }
.thread-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.thread-title { font-size: var(--text-sm); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.thread-last { font-size: var(--text-xs); color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unread { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }

.panel { display: flex; flex-direction: column; overflow: hidden; }
.empty.tall { padding: var(--space-8) var(--space-4); margin: auto; }

.messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4); max-height: 460px; }
.message { display: flex; }
.message.is-mine { justify-content: flex-end; }
.bubble {
  display: flex; flex-direction: column; gap: 2px;
  max-width: min(78%, 520px);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--bg-inset);
}
.message.is-mine .bubble { background: var(--accent-soft-bg); }
.author { font-size: var(--text-xs); font-weight: 650; color: var(--text-brand); }
.text { font-size: var(--text-sm); line-height: var(--leading-relaxed); white-space: pre-wrap; word-break: break-word; }
.time { font-size: 10px; color: var(--text-tertiary); align-self: flex-end; }

.composer { display: flex; gap: var(--space-2); padding: var(--space-3) var(--space-4); border-top: 1px solid var(--border-subtle); }
.composer .input { flex: 1; }
.composer.readonly { align-items: center; gap: var(--space-2); color: var(--text-tertiary); font-size: var(--text-xs); }
.mention-hint { padding: 0 var(--space-4) var(--space-3); font-size: 10px; }
@media (max-width: 520px) { .send-label { display: none; } }
</style>
