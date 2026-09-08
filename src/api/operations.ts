/**
 * Leads, projects and the service catalogue.
 *
 * One module rather than three near-identical ones: they are flat collections
 * with the same shape of read and write, and splitting them would produce
 * three files differing only in a string.
 *
 * The one thing that is not boilerplate here is conversion — turning a lead
 * into a client, and optionally into a sale at the same time. That is the
 * hinge the whole system turns on, and it is careful to leave the lead
 * standing: a pipeline that forgets what it converted cannot tell you where
 * your customers came from.
 */

import { logAudit } from './audit'
import { logActivity, remove } from './records'
import { notify } from './notifications'
import { actor, readAll, readOne, readWhere, today, where, write } from './store'
import { saveClient, blankClient } from './clients'
import { blankSale, saveSale, structureFromService } from './sales'
import {
  NO_REFERRAL,
  type Client,
  type Lead,
  type LeadStage,
  type Project,
  type Service,
} from '@/types/business'
import { NO_STRUCTURE } from '@/types/revenue'
import { moneyOf } from './sales'

/* ------------------------------------------------------------------ *
 * Leads
 * ------------------------------------------------------------------ */

export const fetchLeads = () => readAll<Lead>('leads')

export const fetchLead = (id: string) => readOne<Lead>('leads', id)

/** The leads one affiliate submitted, for their own panel. */
export const fetchLeadsBy = (uid: string) =>
  readWhere<Lead>('leads', where('createdBy', '==', uid))

export function blankLead(assigneeUid: string | null, assigneeName: string): Lead {
  return {
    id: '',
    name: '',
    company: '',
    description: '',
    email: '',
    phone: '',
    city: '',
    country: '',
    source: 'direct',
    sourceDetail: '',
    affiliateId: null,
    affiliateName: '',
    estimatedValue: null,
    serviceId: null,
    serviceInterest: '',
    stage: 'new',
    assigneeUid,
    assigneeName,
    priority: 'normal',
    lastContactedAt: null,
    nextStep: '',
    nextContactDate: null,
    notes: '',
    lostReason: '',
    custom: {},
    clientId: null,
    saleId: null,
    deletedAt: null,
    deletedBy: null,
    deletedByName: '',
    createdAt: '',
    createdBy: '',
    updatedAt: '',
  }
}

export async function saveLead(input: Lead, previousAssignee?: string | null): Promise<string> {
  const isNew = !input.id
  const id = await write('leads', input)
  const label = input.company || input.name

  await logAudit({
    action: isNew ? 'lead.created' : 'lead.updated',
    targetType: 'lead',
    targetId: id,
    targetLabel: label,
    metadata: { stage: input.stage, assignee: input.assigneeUid, source: input.source },
  })

  await logActivity({
    entity: 'leads',
    entityId: id,
    entityLabel: label,
    kind: isNew ? 'created' : 'updated',
    summary: input.serviceInterest || input.description,
    detail: input.stage,
  })

  /* Handing somebody a lead without telling them is how leads go cold. */
  const me = actor()
  if (input.assigneeUid && input.assigneeUid !== previousAssignee && input.assigneeUid !== me.uid) {
    await notify(input.assigneeUid, {
      kind: 'lead_assigned',
      priority: 'important',
      title: label,
      body: input.serviceInterest,
      link: '/leads',
    })
  }

  return id
}

/** Move a lead along the pipeline without opening the whole editor. */
export async function setLeadStage(lead: Lead, stage: LeadStage): Promise<void> {
  await write('leads', { ...lead, stage })

  await logAudit({
    action: 'lead.updated',
    targetType: 'lead',
    targetId: lead.id,
    targetLabel: lead.company || lead.name,
    metadata: { from: lead.stage, to: stage },
  })

  await logActivity({
    entity: 'leads',
    entityId: lead.id,
    entityLabel: lead.company || lead.name,
    kind: 'status_changed',
    summary: stage,
    detail: lead.stage,
  })
}

/**
 * Mark that somebody actually spoke to them.
 *
 * Separate from any other edit on purpose: `updatedAt` moves when a note is
 * corrected, and a pipeline that treats that as contact will tell you a cold
 * lead is warm.
 */
export async function markContacted(lead: Lead): Promise<void> {
  await write('leads', {
    ...lead,
    lastContactedAt: today(),
    stage: lead.stage === 'new' ? 'contacted' : lead.stage,
  })

  await logActivity({
    entity: 'leads',
    entityId: lead.id,
    entityLabel: lead.company || lead.name,
    kind: 'contacted',
    summary: today(),
  })
}

export const deleteLead = (lead: Lead) => remove('leads', lead.id, lead.company || lead.name)

/**
 * Convert a lead into a client, and optionally into a sale at the same time.
 *
 * The lead is not moved or deleted. It is marked won, stamped with the ids it
 * produced, and left standing — deleting it would erase where the client came
 * from, which is the one thing a pipeline exists to remember.
 */
export async function convertLead(
  lead: Lead,
  options: {
    service?: Service | null
    /** When set, a sale of this value is created alongside the client. */
    saleValue?: number
    saleCurrency?: 'RSD' | 'EUR'
    responsibleUid?: string | null
    responsibleName?: string
  } = {},
): Promise<{ clientId: string; saleId: string | null }> {
  const me = actor()

  const clientId = await saveClient({
    ...blankClient(),
    name: lead.company || lead.name,
    description: lead.description,
    contactName: lead.company ? lead.name : '',
    email: lead.email,
    phone: lead.phone,
    city: lead.city,
    country: lead.country,
    status: 'active',
    notes: lead.notes,
    responsibleUid: options.responsibleUid ?? lead.assigneeUid ?? me.uid,
    responsibleName: options.responsibleName ?? lead.assigneeName,
    serviceIds: lead.serviceId ? [lead.serviceId] : [],
    clientSince: today(),
    referral: lead.affiliateId
      ? {
          source: 'affiliate',
          referrerName: lead.affiliateName,
          affiliateId: lead.affiliateId,
          note: '',
        }
      : { ...NO_REFERRAL, source: lead.source, referrerName: lead.sourceDetail },
  })

  let saleId: string | null = null

  if (options.saleValue && options.saleValue > 0) {
    const value = moneyOf(options.saleValue, options.saleCurrency ?? 'RSD', 1, today())

    saleId = await saveSale({
      ...blankSale(lead.assigneeUid ?? me.uid, lead.assigneeName || me.name),
      title: `${lead.company || lead.name}${lead.serviceInterest ? ` — ${lead.serviceInterest}` : ''}`,
      clientId,
      clientName: lead.company || lead.name,
      serviceId: lead.serviceId,
      serviceName: options.service?.name ?? lead.serviceInterest,
      leadId: lead.id,
      affiliateId: lead.affiliateId,
      affiliateName: lead.affiliateName,
      value,
      payment: options.service
        ? structureFromService(options.service, value.baseMinor)
        : { ...NO_STRUCTURE },
      channel: lead.affiliateId ? 'affiliate' : 'inbound',
    })
  }

  await write('leads', { ...lead, stage: 'won', clientId, saleId })

  await logAudit({
    action: 'lead.converted',
    targetType: 'lead',
    targetId: lead.id,
    targetLabel: lead.company || lead.name,
    metadata: { clientId, saleId },
  })

  await logActivity({
    entity: 'leads',
    entityId: lead.id,
    entityLabel: lead.company || lead.name,
    kind: 'converted',
    summary: lead.company || lead.name,
    detail: saleId ? 'client + sale' : 'client',
  })

  return { clientId, saleId }
}

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

export const fetchProjects = () => readAll<Project>('projects')

export const fetchProject = (id: string) => readOne<Project>('projects', id)

/** Projects one client belongs to. An array membership, not an equality. */
export const fetchProjectsFor = (clientId: string) =>
  readWhere<Project>('projects', where('clientIds', 'array-contains', clientId))

export function blankProject(ownerUid: string | null, ownerName: string): Project {
  return {
    id: '',
    name: '',
    coverUrl: null,
    description: '',
    objective: '',
    status: 'planning',
    priority: 'normal',
    startDate: today(),
    endDate: null,
    ownerUid,
    ownerName,
    teamUids: [],
    clientIds: [],
    serviceId: null,
    serviceName: '',
    budget: null,
    milestones: [],
    notes: '',
    custom: {},
    deletedAt: null,
    deletedBy: null,
    deletedByName: '',
    createdAt: '',
    createdBy: '',
    updatedAt: '',
  }
}

export async function saveProject(input: Project, previousTeam: string[] = []): Promise<string> {
  const isNew = !input.id
  const id = await write('projects', input)

  await logAudit({
    action: isNew ? 'project.created' : 'project.updated',
    targetType: 'project',
    targetId: id,
    targetLabel: input.name,
    metadata: {
      status: input.status,
      clients: input.clientIds?.length ?? 0,
      team: input.teamUids?.length ?? 0,
    },
  })

  await logActivity({
    entity: 'projects',
    entityId: id,
    entityLabel: input.name,
    kind: isNew ? 'created' : 'updated',
    summary: input.objective || input.description,
    detail: input.status,
  })

  /* Anybody newly on the team is told; the rest are not told again. */
  const me = actor()
  const added = (input.teamUids ?? []).filter((uid) => !previousTeam.includes(uid))

  for (const uid of added) {
    if (uid === me.uid) continue
    await notify(uid, {
      kind: 'project_assigned',
      priority: 'normal',
      title: input.name,
      body: input.objective,
      link: `/projects/${id}`,
    })
  }

  return id
}

export const deleteProject = (project: Project) => remove('projects', project.id, project.name)

/**
 * How far along a project is.
 *
 * Counted from milestones. A project without any reports null rather than
 * nought: "no way to tell" and "nothing done" are different answers, and
 * showing an empty bar for the first is a lie the manager will act on.
 */
export function projectProgress(project: Project): number | null {
  const milestones = project.milestones ?? []
  if (milestones.length === 0) return null
  return Math.round((milestones.filter((m) => m.done).length / milestones.length) * 100)
}

/* ------------------------------------------------------------------ *
 * Services
 * ------------------------------------------------------------------ */

export const fetchServices = () => readAll<Service>('services', 'name', 'asc')

export const fetchService = (id: string) => readOne<Service>('services', id)

export function blankService(): Service {
  return {
    id: '',
    name: '',
    description: '',
    details: '',
    category: '',
    pricingModel: 'fixed',
    defaultPrice: moneyOf(0, 'RSD'),
    unit: '',
    payment: { ...NO_STRUCTURE },
    commissionPercent: 0,
    status: 'active',
    notes: '',
    custom: {},
    deletedAt: null,
    deletedBy: null,
    deletedByName: '',
    createdAt: '',
    createdBy: '',
    updatedAt: '',
  }
}

export async function saveService(input: Service): Promise<string> {
  const isNew = !input.id
  const id = await write('services', input)

  await logAudit({
    action: 'settings.updated',
    targetType: 'settings',
    targetId: id,
    targetLabel: input.name,
    metadata: {
      entity: 'service',
      new: isNew,
      status: input.status,
      price: input.defaultPrice.baseMinor,
      payment: input.payment?.model,
    },
  })

  return id
}

export const deleteService = (service: Service) => remove('services', service.id, service.name)

/** Re-exported so a screen needing a client shape does not import two modules. */
export type { Client }
