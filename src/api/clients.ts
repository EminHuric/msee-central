/**
 * Clients.
 *
 * The record everything else hangs from: projects point at a client, income
 * points at a project, and the question "is this client worth keeping" is
 * answered by walking that chain.
 *
 * Clients are never deleted, only moved to `former`. A client with money
 * attached is the company's history, and deleting one would leave income
 * records pointing at nothing.
 */

import { collection, doc, getDoc, getDocs, orderBy, query, setDoc } from 'firebase/firestore'

import { logAudit } from './audit'
import { slugify } from './administration'
import { getDb } from '@/lib/firebase'
import { useAuthStore } from '@/stores/auth'
import type { Client, ClientStatus } from '@/types/business'

export async function fetchClients(): Promise<Client[]> {
  const snap = await getDocs(query(collection(getDb(), 'clients'), orderBy('name')))
  return snap.docs.map((d) => ({ ...(d.data() as Client), id: d.id }))
}

export async function fetchClient(id: string): Promise<Client | null> {
  const snap = await getDoc(doc(getDb(), 'clients', id))
  return snap.exists() ? { ...(snap.data() as Client), id: snap.id } : null
}

export interface ClientInput {
  id: string
  name: string
  contactName: string
  email: string
  phone: string
  city: string
  country: string
  website: string
  status: ClientStatus
  notes: string
}

export const EMPTY_CLIENT: ClientInput = {
  id: '',
  name: '',
  contactName: '',
  email: '',
  phone: '',
  city: '',
  country: '',
  website: '',
  status: 'prospect',
  notes: '',
}

/**
 * Create or update a client.
 *
 * The id is derived from the first name given and then frozen. A client that
 * rebrands must not orphan the projects and invoices pointing at it, and the
 * id is what those hold.
 */
export async function saveClient(input: ClientInput, isNew: boolean): Promise<string> {
  const id = isNew ? uniqueId(input.name) : input.id
  const now = new Date().toISOString()
  const actorUid = useAuthStore().uid ?? 'unknown'

  await setDoc(
    doc(getDb(), 'clients', id),
    {
      id,
      name: input.name.trim(),
      contactName: input.contactName.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
      city: input.city.trim(),
      country: input.country.trim(),
      website: input.website.trim(),
      status: input.status,
      notes: input.notes.trim(),
      ...(isNew ? { externalClientId: null, createdAt: now, createdBy: actorUid } : {}),
      updatedAt: now,
    },
    { merge: true },
  )

  await logAudit({
    action: isNew ? 'client.created' : 'client.updated',
    targetType: 'client',
    targetId: id,
    targetLabel: input.name,
    metadata: { status: input.status },
  })

  return id
}

/**
 * A slug with a short suffix.
 *
 * Two clients genuinely can share a name — a franchise, a rebrand, a common
 * word — and silently merging them into one record because the slug collided
 * would be far worse than an id that is slightly less pretty.
 */
function uniqueId(name: string): string {
  const base = slugify(name) || 'client'
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${base}-${suffix}`
}
