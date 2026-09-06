/**
 * Internal messages and announcements.
 *
 * Threads are read live rather than fetched: a message that arrives while
 * somebody is looking at the conversation should appear, and polling for it
 * would be both slower and more expensive. `onSnapshot` returns an unsubscribe
 * function, and every caller here is responsible for calling it — a listener
 * left running after a component unmounts is a memory leak that also keeps
 * billing.
 *
 * Membership is the whole access model. A thread carries the uids that may
 * read it, the rules check that list, and there is no "public" thread — an
 * announcement to everybody is a thread whose member list happens to contain
 * everybody, which means it obeys exactly the same rule as everything else.
 */

import {
  collection,
  doc,
  getDocs,
  limit as limitTo,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore'

import { logAudit } from './audit'
import { actor, newId } from './store'
import { getDb } from '@/lib/firebase'
import { notifyMany } from './notifications'
import type { ChatMessage, ChatThread, ThreadKind } from '@/types/company'

function threads() {
  return collection(getDb(), 'chatThreads')
}

function messagesOf(threadId: string) {
  return collection(getDb(), 'chatThreads', threadId, 'messages')
}

/* ------------------------------------------------------------------ *
 * Threads
 * ------------------------------------------------------------------ */

/** Live list of the threads you are in, most recently active first. */
export function watchThreads(uid: string, onChange: (rows: ChatThread[]) => void): () => void {
  const q = query(threads(), where('memberUids', 'array-contains', uid), limitTo(100))

  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ ...(d.data() as ChatThread), id: d.id }))
      rows.sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''))
      onChange(rows)
    },
    () => onChange([]),
  )
}

/** Live messages in one thread, oldest first so the view reads downward. */
export function watchMessages(
  threadId: string,
  onChange: (rows: ChatMessage[]) => void,
): () => void {
  const q = query(messagesOf(threadId), orderBy('createdAt', 'asc'), limitTo(300))

  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => ({ ...(d.data() as ChatMessage), id: d.id }))),
    () => onChange([]),
  )
}

/**
 * Find the direct thread with somebody, or start one.
 *
 * Looked up by membership rather than by a composed id, because a composed id
 * would have to encode both uids in a fixed order and that ordering becomes a
 * silent bug the first time somebody writes it the other way round.
 */
export async function openDirect(otherUid: string, otherName: string): Promise<string> {
  const me = actor()

  const existing = await getDocs(
    query(threads(), where('memberUids', 'array-contains', me.uid), limitTo(100)),
  )

  const found = existing.docs
    .map((d) => ({ ...(d.data() as ChatThread), id: d.id }))
    .find(
      (t) =>
        t.kind === 'direct' && t.memberUids.length === 2 && t.memberUids.includes(otherUid),
    )

  if (found) return found.id

  return createThread({
    kind: 'direct',
    title: otherName,
    memberUids: [me.uid, otherUid],
  })
}

export async function createThread(input: {
  kind: ThreadKind
  title: string
  memberUids: string[]
}): Promise<string> {
  const me = actor()
  const id = newId()
  const now = new Date().toISOString()

  /* The creator is always a member — the rules refuse the write otherwise. */
  const members = [...new Set([me.uid, ...input.memberUids])]

  await setDoc(doc(threads(), id), {
    id,
    kind: input.kind,
    title: input.title.trim(),
    memberUids: members,
    createdAt: now,
    createdBy: me.uid,
    lastMessage: '',
    lastMessageAt: now,
    lastMessageBy: '',
    readAt: { [me.uid]: now },
    updatedAt: now,
  } satisfies ChatThread)

  return id
}

export async function updateThread(thread: ChatThread, changes: Partial<ChatThread>): Promise<void> {
  await setDoc(
    doc(threads(), thread.id),
    { ...thread, ...changes, updatedAt: new Date().toISOString() },
    { merge: true },
  )
}

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

/** uids named with @ in the text, matched against the people in the thread. */
export function findMentions(body: string, people: { uid: string; name: string }[]): string[] {
  const lower = body.toLowerCase()
  return people
    .filter((p) => {
      const first = p.name.split(' ')[0]
      return !!first && lower.includes(`@${first.toLowerCase()}`)
    })
    .map((p) => p.uid)
}

/**
 * Post a message.
 *
 * The thread carries a copy of the last message so the conversation list can
 * be rendered from one read instead of one read per thread. That is a
 * denormalisation, and an acceptable one: it is a display cache that is
 * rewritten on every message, never a figure anything is computed from.
 */
export async function sendMessage(
  thread: ChatThread,
  body: string,
  people: { uid: string; name: string }[] = [],
): Promise<void> {
  const text = body.trim()
  if (!text) return

  const me = actor()
  const now = new Date().toISOString()
  const id = newId()
  const mentions = findMentions(text, people)

  await setDoc(doc(messagesOf(thread.id), id), {
    id,
    threadId: thread.id,
    authorUid: me.uid,
    authorName: me.name,
    body: text,
    mentions,
    createdAt: now,
    editedAt: null,
  } satisfies ChatMessage)

  await setDoc(
    doc(threads(), thread.id),
    {
      lastMessage: text.slice(0, 140),
      lastMessageAt: now,
      lastMessageBy: me.name,
      readAt: { ...(thread.readAt ?? {}), [me.uid]: now },
      updatedAt: now,
    },
    { merge: true },
  )

  /* Mentions are told immediately; everybody else finds it in the thread. */
  if (mentions.length) {
    await notifyMany(mentions, {
      kind: 'message',
      priority: 'normal',
      title: me.name,
      body: text.slice(0, 120),
      link: `/chat?thread=${thread.id}`,
    })
  }
}

export async function markThreadRead(thread: ChatThread): Promise<void> {
  const me = actor()
  const now = new Date().toISOString()

  await setDoc(
    doc(threads(), thread.id),
    { readAt: { ...(thread.readAt ?? {}), [me.uid]: now }, updatedAt: now },
    { merge: true },
  )
}

/** Unread when somebody else wrote after you last opened it. */
export function isUnread(thread: ChatThread, uid: string): boolean {
  if (!thread.lastMessageAt) return false
  if (thread.lastMessageBy && thread.lastMessageBy === '') return false
  const seen = thread.readAt?.[uid] ?? ''
  return thread.lastMessageAt > seen
}

/* ------------------------------------------------------------------ *
 * Announcements
 * ------------------------------------------------------------------ */

/**
 * Send an announcement.
 *
 * It is a thread with everybody in it and one message already posted, plus a
 * notification each — an announcement nobody is told about is just a message
 * in a list they were not looking at.
 */
export async function sendAnnouncement(
  title: string,
  body: string,
  recipients: { uid: string; name: string }[],
): Promise<string> {
  const id = await createThread({
    kind: 'announcement',
    title: title.trim(),
    memberUids: recipients.map((r) => r.uid),
  })

  const thread: ChatThread = {
    id,
    kind: 'announcement',
    title: title.trim(),
    memberUids: recipients.map((r) => r.uid),
    createdAt: '',
    createdBy: '',
    lastMessage: '',
    lastMessageAt: '',
    lastMessageBy: '',
    readAt: {},
    updatedAt: '',
  }

  await sendMessage(thread, body)

  await notifyMany(
    recipients.map((r) => r.uid),
    {
      kind: 'announcement',
      priority: 'important',
      title,
      body: body.slice(0, 140),
      link: `/chat?thread=${id}`,
    },
  )

  await logAudit({
    action: 'announcement.sent',
    targetType: 'settings',
    targetId: id,
    targetLabel: title,
    metadata: { recipients: recipients.length },
  })

  return id
}
