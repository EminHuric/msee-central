/**
 * Leads, projects, tasks, the service catalogue and overheads.
 *
 * One module rather than five near-identical ones. They are all flat
 * collections with the same shape of read and write, and splitting them would
 * produce five files differing only in a string.
 *
 * What they have in common beyond CRUD: none of them owns money. Money earned
 * from a client lives in that client's ledger, and a project or service is a
 * label on an entry there. That is what keeps one euro from existing in three
 * tables.
 */

import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore'

import { logAudit } from './audit'
import { notify } from './notifications'
import { actor, newId, readAll, readOne, remove, write } from './store'
import { getDb } from '@/lib/firebase'
import { REPEAT_DAYS, type ExpenseEntry, type Lead, type LeadStage, type Project, type Service, type Task, type TaskComment, type TaskStatus } from '@/types/business'

/* ------------------------------------------------------------------ *
 * Leads
 * ------------------------------------------------------------------ */

export const fetchLeads = () => readAll<Lead>('leads')

export async function saveLead(input: Lead, previousAssignee?: string | null): Promise<string> {
  const isNew = !input.id
  const id = await write('leads', input)

  await logAudit({
    action: isNew ? 'lead.created' : 'lead.updated',
    targetType: 'lead',
    targetId: id,
    targetLabel: input.company || input.name,
    metadata: { stage: input.stage, assignee: input.assigneeUid },
  })

  /* Handing somebody a lead without telling them is how leads go cold. */
  if (input.assigneeUid && input.assigneeUid !== previousAssignee) {
    await notify(input.assigneeUid, {
      kind: 'lead_new',
      priority: 'important',
      title: input.company || input.name,
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
}

export const deleteLead = (id: string) => remove('leads', id)

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

export const fetchProjects = () => readAll<Project>('projects')

export const fetchProject = (id: string) => readOne<Project>('projects', id)

export async function fetchProjectsFor(clientId: string): Promise<Project[]> {
  try {
    const snap = await getDocs(
      query(collection(getDb(), 'projects'), where('clientId', '==', clientId)),
    )
    return snap.docs.map((d) => ({ ...(d.data() as Project), id: d.id }))
  } catch {
    return []
  }
}

export async function fetchTasksFor(field: 'projectId' | 'clientId', id: string): Promise<Task[]> {
  try {
    const snap = await getDocs(query(collection(getDb(), 'tasks'), where(field, '==', id)))
    return snap.docs.map((d) => ({ ...(d.data() as Task), id: d.id }))
  } catch {
    return []
  }
}

export async function saveProject(input: Project): Promise<string> {
  const isNew = !input.id
  const id = await write('projects', input)

  await logAudit({
    action: isNew ? 'project.created' : 'project.updated',
    targetType: 'project',
    targetId: id,
    targetLabel: input.name,
    metadata: { clientId: input.clientId, status: input.status },
  })

  return id
}

/* ------------------------------------------------------------------ *
 * Tasks
 * ------------------------------------------------------------------ */

export const fetchTasks = () => readAll<Task>('tasks', 'createdAt')

/**
 * A blank task with every field present.
 *
 * Exists so no screen has to cast a half-built object into a Task: a missing
 * field is not a type error you catch, it is a document written without it and
 * a `undefined` somewhere three screens away.
 */
export function blankTask(assigneeUid: string | null, assigneeName: string): Task {
  return {
    id: '',
    title: '',
    description: '',
    clientId: null,
    projectId: null,
    assigneeUid,
    assigneeName,
    status: 'todo',
    priority: 'normal',
    dueDate: null,
    completedAt: null,
    estimatedMinutes: 0,
    actualMinutes: 0,
    checklist: [],
    repeat: '',
    createdAt: '',
    createdBy: '',
    createdByName: '',
    updatedAt: '',
  }
}

export async function saveTask(input: Task, previousAssignee?: string | null): Promise<string> {
  const isNew = !input.id
  const me = actor()

  const id = await write('tasks', {
    ...input,
    // Stamped when it lands on done, cleared if it comes back off.
    completedAt: input.status === 'done' ? (input.completedAt ?? new Date().toISOString()) : null,
    createdByName: input.createdByName || me.name,
  })

  await logAudit({
    action: isNew ? 'task.created' : 'task.updated',
    targetType: 'task',
    targetId: id,
    targetLabel: input.title,
    metadata: { status: input.status, assignee: input.assigneeUid },
  })

  /* Only when it changed hands, so editing your own task is silent. */
  if (input.assigneeUid && input.assigneeUid !== previousAssignee && input.assigneeUid !== me.uid) {
    await notify(input.assigneeUid, {
      kind: 'task_assigned',
      priority: input.priority === 'urgent' ? 'important' : 'normal',
      title: input.title,
      body: input.dueDate ?? '',
      link: '/tasks',
    })
  }

  return id
}

/**
 * Flip a task's state from a checkbox, without opening the editor.
 *
 * Completing a repeating task opens the next one rather than editing this one:
 * the record of what was done stays, and the work still comes back.
 */
export async function setTaskStatus(task: Task, status: TaskStatus): Promise<void> {
  await saveTask({ ...task, status }, task.assigneeUid)

  if (status === 'done' && task.repeat && task.dueDate) {
    const days = REPEAT_DAYS[task.repeat]
    const next = new Date(Date.parse(task.dueDate) + days * 86_400_000).toISOString().slice(0, 10)

    await saveTask(
      {
        ...task,
        id: '',
        status: 'todo',
        completedAt: null,
        actualMinutes: 0,
        checklist: (task.checklist ?? []).map((c) => ({ ...c, done: false })),
        dueDate: next,
      },
      task.assigneeUid,
    )
  }
}

/* ---- Task comments -------------------------------------------------- */

export async function fetchTaskComments(taskId: string): Promise<TaskComment[]> {
  try {
    const snap = await getDocs(collection(getDb(), 'tasks', taskId, 'comments'))
    return snap.docs
      .map((d) => ({ ...(d.data() as TaskComment), id: d.id }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  } catch {
    return []
  }
}

export async function addTaskComment(taskId: string, body: string): Promise<void> {
  const text = body.trim()
  if (!text) return

  const me = actor()
  const id = newId()

  await setDoc(doc(getDb(), 'tasks', taskId, 'comments', id), {
    id,
    body: text,
    authorUid: me.uid,
    authorName: me.name,
    createdAt: new Date().toISOString(),
  } satisfies TaskComment)
}

export const deleteTask = (id: string) => remove('tasks', id)

/**
 * How a task reads today.
 *
 * Overdue is deliberately computed rather than stored: a task does not become
 * late by being written to, it becomes late by the date passing.
 */
export type TaskBucket = 'overdue' | 'today' | 'week' | 'later' | 'done' | 'someday'

export function bucketOf(task: Task, today = new Date().toISOString().slice(0, 10)): TaskBucket {
  if (task.status === 'done') return 'done'
  if (!task.dueDate) return 'someday'
  if (task.dueDate < today) return 'overdue'
  if (task.dueDate === today) return 'today'

  const days = (Date.parse(task.dueDate) - Date.parse(today)) / 86_400_000
  return days <= 7 ? 'week' : 'later'
}

/* ------------------------------------------------------------------ *
 * Service catalogue
 * ------------------------------------------------------------------ */

export const fetchServiceCatalogue = () => readAll<Service>('services', 'name', 'asc')

export async function saveService(input: Service): Promise<string> {
  const isNew = !input.id
  const id = await write('services', input)

  await logAudit({
    action: 'settings.updated',
    targetType: 'settings',
    targetId: id,
    targetLabel: input.name,
    metadata: { entity: 'service', new: isNew, status: input.status },
  })

  return id
}

/* ------------------------------------------------------------------ *
 * Overheads
 *
 * Costs that belong to no client: tools, salaries, rent. Anything spent on a
 * specific piece of work is recorded on that work item instead, so it can be
 * set against what the work earned.
 * ------------------------------------------------------------------ */

export const fetchExpenses = () => readAll<ExpenseEntry>('expenses', 'date')

export async function saveExpense(input: ExpenseEntry): Promise<string> {
  const id = await write('expenses', input)

  await logAudit({
    action: 'expense.recorded',
    targetType: 'expense',
    targetId: id,
    targetLabel: input.description,
    metadata: { category: input.category, amount: input.amount.baseMinor },
  })

  return id
}

export const deleteExpense = (id: string) => remove('expenses', id)
