/**
 * Clients.
 *
 * Kept deliberately plain. A client record is a name, a way to reach them, who
 * looks after them, and what they buy; everything else about the relationship
 * — the sales, the money, the projects, the notes — lives in its own module
 * and is read onto the client's page. A CRM that stores all of it on one
 * document is a CRM nobody keeps up to date.
 *
 * The id is derived from the first name given and then frozen. A client that
 * rebrands must not orphan the sales and projects pointing at it.
 */

import { logAudit } from './audit'
import { logActivity, remove } from './records'
import { newId, readAll, readOne, today, write } from './store'
import { NO_REFERRAL, type Client } from '@/types/business'

export const fetchClients = () => readAll<Client>('clients', 'name', 'asc')

export const fetchClient = (id: string) => readOne<Client>('clients', id)

export function blankClient(): Client {
  return {
    id: '',
    name: '',
    description: '',
    contactName: '',
    email: '',
    phone: '',
    city: '',
    country: '',
    address: '',
    website: '',
    industry: '',
    tags: [],
    status: 'prospect',
    archived: false,
    notes: '',
    logoUrl: null,
    ownerName: '',
    managerName: '',
    instagram: '',
    facebook: '',
    otherContact: '',
    responsibleUid: null,
    responsibleName: '',
    serviceIds: [],
    referral: { ...NO_REFERRAL },
    custom: {},
    clientSince: today(),
    externalRefs: [],
    deletedAt: null,
    deletedBy: null,
    deletedByName: '',
    createdAt: '',
    createdBy: '',
    updatedAt: '',
  }
}

/**
 * A readable, stable id from the client's name.
 *
 * Readable because a document id turns up in URLs and in the console, and
 * `hotel-abc` is worth more there than a random string. Suffixed when taken,
 * because two clients may legitimately share a name.
 */
function slugId(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'client'

  return `${base}-${newId().slice(0, 4).toLowerCase()}`
}

export async function saveClient(input: Client): Promise<string> {
  const isNew = !input.id
  const id = await write('clients', { ...input, id: input.id || slugId(input.name) })

  await logAudit({
    action: isNew ? 'client.created' : 'client.updated',
    targetType: 'client',
    targetId: id,
    targetLabel: input.name,
    metadata: {
      status: input.status,
      responsible: input.responsibleUid,
      services: input.serviceIds?.length ?? 0,
    },
  })

  await logActivity({
    entity: 'clients',
    entityId: id,
    entityLabel: input.name,
    kind: isNew ? 'created' : 'updated',
    summary: input.description || input.contactName,
    detail: input.status,
  })

  return id
}

export const deleteClient = (client: Client) => remove('clients', client.id, client.name)

/**
 * Archive rather than delete.
 *
 * A former client with three years of sales behind them is history, not
 * clutter. Archiving drops them out of the working lists and leaves every
 * figure they contributed to intact.
 */
export async function setArchived(client: Client, archived: boolean): Promise<void> {
  await write('clients', { ...client, archived, status: archived ? 'former' : client.status })

  await logActivity({
    entity: 'clients',
    entityId: client.id,
    entityLabel: client.name,
    kind: 'status_changed',
    summary: archived ? 'archived' : 'restored',
  })
}
