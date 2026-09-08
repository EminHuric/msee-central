/**
 * Bonus programmes, incentive work, awards and what somebody has earned.
 *
 * One sentence governs the whole module: **nobody awards themselves anything.**
 *
 * Progress is counted from records the employee cannot edit — their sales,
 * their leads, the money that arrived. Reaching a milestone produces an award
 * in `earned`, not in `paid`. Moving it to `approved` and then to `paid` are
 * separate acts by somebody else, and the rules refuse both to the person the
 * award belongs to.
 *
 * Earned and paid are stored apart because they are apart. A bonus earned in
 * March and paid in May is a debt for two months, and a system with one flag
 * for both cannot tell you what it owes.
 */

import { logAudit } from './audit'
import { logActivity, remove } from './records'
import { notify } from './notifications'
import { actor, newId, now, readAll, readWhere, today, where, write } from './store'
import type { Client, Project } from '@/types/business'
import type { Commission, Sale, Transaction } from '@/types/revenue'
import { INCOME_TYPES } from '@/types/revenue'
import {
  MONEY_BONUS_METRICS,
  OWED_STATUSES,
  type AwardStatus,
  type BonusAward,
  type BonusMetric,
  type BonusMilestone,
  type BonusProgramme,
  type Earnings,
  type IncentiveWork,
  type MilestoneProgress,
  type ProgrammeProgress,
  type WorkStatus,
} from '@/types/rewards'

/* ------------------------------------------------------------------ *
 * Programmes
 * ------------------------------------------------------------------ */

export const fetchProgrammes = () => readAll<BonusProgramme>('bonusPrograms')

export async function saveProgramme(input: BonusProgramme): Promise<string> {
  const isNew = !input.id
  const id = await write('bonusPrograms', input)

  await logAudit({
    action: 'bonus.programme_created',
    targetType: 'bonus',
    targetId: id,
    targetLabel: input.name,
    metadata: {
      metric: input.metric,
      milestones: input.milestones?.length ?? 0,
      audience: input.audience,
      new: isNew,
    },
  })

  return id
}

export const deleteProgramme = (p: BonusProgramme) => remove('bonusPrograms', p.id, p.name)

/** Who a programme applies to, given the company's people. */
export function membersOf(
  programme: BonusProgramme,
  people: { uid: string; departmentId: string | null }[],
): string[] {
  switch (programme.audience) {
    case 'company':
      return people.map((p) => p.uid)
    case 'department':
      return people.filter((p) => p.departmentId === programme.departmentId).map((p) => p.uid)
    default:
      return programme.memberUids ?? []
  }
}

/* ------------------------------------------------------------------ *
 * Progress
 * ------------------------------------------------------------------ */

export interface ProgressSources {
  sales: Sale[]
  transactions: Transaction[]
  leads: { assigneeUid: string | null; createdBy?: string; stage: string; createdAt?: string }[]
  clients: Client[]
  projects: Project[]
  awards: BonusAward[]
}

const inWindow = (date: string | null | undefined, from: string, to: string) =>
  !!date && date >= from && date <= to

/**
 * What one person has done, on the metric a programme measures.
 *
 * Every branch reads records the employee cannot alter in their own favour.
 * `manual` is the exception, and even there the number comes from an award a
 * manager created rather than from anything the employee typed.
 */
export function countFor(
  metric: BonusMetric,
  uid: string,
  from: string,
  to: string,
  serviceId: string | null,
  src: ProgressSources,
): number {
  const matchesService = (id: string | null | undefined) => !serviceId || id === serviceId

  const mySales = src.sales.filter(
    (s) => s.ownerUid === uid && inWindow(s.saleDate, from, to) && matchesService(s.serviceId),
  )

  switch (metric) {
    case 'sales_count':
      return mySales.length

    case 'sales_value':
      return mySales.reduce((n, s) => n + s.value.baseMinor, 0)

    case 'revenue_collected': {
      const saleIds = new Set(mySales.map((s) => s.id))
      return src.transactions
        .filter(
          (tx) =>
            tx.status === 'paid' &&
            INCOME_TYPES.includes(tx.type) &&
            inWindow(tx.date, from, to) &&
            (tx.employeeUid === uid || (tx.saleId && saleIds.has(tx.saleId))),
        )
        .reduce((n, tx) => n + tx.amount.baseMinor, 0)
    }

    case 'leads_created':
      return src.leads.filter(
        (l) =>
          (l.assigneeUid === uid || l.createdBy === uid) &&
          inWindow(l.createdAt?.slice(0, 10), from, to),
      ).length

    case 'leads_converted':
      return src.leads.filter(
        (l) =>
          (l.assigneeUid === uid || l.createdBy === uid) &&
          l.stage === 'won' &&
          inWindow(l.createdAt?.slice(0, 10), from, to),
      ).length

    case 'new_clients':
      return src.clients.filter(
        (c) => c.responsibleUid === uid && inWindow(c.createdAt?.slice(0, 10), from, to),
      ).length

    case 'projects_completed':
      return src.projects.filter(
        (p) =>
          p.status === 'completed' &&
          (p.ownerUid === uid || p.teamUids?.includes(uid)) &&
          inWindow(p.endDate, from, to),
      ).length

    default:
      /* Manual: the value is whatever a manager has already awarded. */
      return src.awards
        .filter((a) => a.employeeUid === uid && a.source === 'manual')
        .reduce((n, a) => n + a.amountBaseMinor, 0)
  }
}

/**
 * Where one person stands in one programme.
 *
 * Returns the next rung and what is left to reach it, because that is what the
 * employee actually wants to know — a percentage on its own tells nobody how
 * many more sales to make.
 */
export function progressFor(
  programme: BonusProgramme,
  uid: string,
  src: ProgressSources,
): ProgrammeProgress {
  const current = countFor(
    programme.metric,
    uid,
    programme.startDate,
    programme.endDate,
    programme.serviceId,
    src,
  )

  const ladder = [...(programme.milestones ?? [])].sort((a, b) => a.target - b.target)

  const milestones: MilestoneProgress[] = ladder.map((milestone) => {
    const award = src.awards.find(
      (a) =>
        a.employeeUid === uid &&
        a.sourceId === programme.id &&
        a.milestoneId === milestone.id,
    )

    return {
      milestone,
      reached: current >= milestone.target,
      awardStatus: award?.status ?? null,
    }
  })

  const next = ladder.find((m) => current < m.target) ?? null
  const last = ladder[ladder.length - 1]
  const ceiling = next?.target ?? last?.target ?? 1

  return {
    programmeId: programme.id,
    employeeUid: uid,
    current,
    isMoney: MONEY_BONUS_METRICS.includes(programme.metric),
    milestones,
    nextMilestone: next,
    remaining: next ? Math.max(0, next.target - current) : 0,
    percent: Math.min(100, Math.round((current / (ceiling || 1)) * 100)),
    earnedBaseMinor: src.awards
      .filter((a) => a.employeeUid === uid && a.sourceId === programme.id)
      .reduce((n, a) => n + a.amountBaseMinor, 0),
  }
}

/* ------------------------------------------------------------------ *
 * Awards
 * ------------------------------------------------------------------ */

export const fetchAwards = () => readAll<BonusAward>('bonusAwards', 'earnedDate')

export const fetchAwardsFor = (uid: string) =>
  readWhere<BonusAward>('bonusAwards', where('employeeUid', '==', uid))

/**
 * Record that somebody reached a milestone.
 *
 * Written as `earned` when the programme trusts the count, and as `pending`
 * when it wants a person to look first. Either way it is somebody with
 * `bonuses.manage` doing the writing — the rules refuse an employee creating
 * an award for themselves, which is why this is never called automatically in
 * the background of the employee's own screen.
 */
export async function grantMilestone(
  programme: BonusProgramme,
  milestone: BonusMilestone,
  employee: { uid: string; name: string },
): Promise<string> {
  const id = newId()
  const status: AwardStatus = programme.requiresApproval ? 'pending' : 'earned'

  await write('bonusAwards', {
    id,
    employeeUid: employee.uid,
    employeeName: employee.name,
    source: 'programme',
    sourceId: programme.id,
    sourceLabel: programme.name,
    milestoneId: milestone.id,
    reason: milestone.note || `${milestone.target}`,
    amountBaseMinor: milestone.rewardBaseMinor,
    rewardLabel: milestone.rewardLabel,
    status,
    earnedDate: today(),
    approvedBy: null,
    approvedAt: null,
    paidAt: null,
    note: '',
  } as unknown as BonusAward)

  await logAudit({
    action: 'bonus.awarded',
    targetType: 'bonus',
    targetId: id,
    targetLabel: `${employee.name} · ${programme.name}`,
    metadata: { amount: milestone.rewardBaseMinor, status, milestone: milestone.target },
  })

  await notify(employee.uid, {
    kind: 'bonus_earned',
    priority: 'important',
    title: programme.name,
    body: milestone.rewardLabel || String(milestone.target),
    link: '/workspace',
  })

  return id
}

/** A one-off bonus with no programme behind it. */
export async function grantManual(input: {
  employeeUid: string
  employeeName: string
  reason: string
  amountBaseMinor: number
  rewardLabel: string
}): Promise<string> {
  const id = newId()

  await write('bonusAwards', {
    id,
    employeeUid: input.employeeUid,
    employeeName: input.employeeName,
    source: 'manual',
    sourceId: '',
    sourceLabel: '',
    milestoneId: '',
    reason: input.reason,
    amountBaseMinor: input.amountBaseMinor,
    rewardLabel: input.rewardLabel,
    status: 'earned',
    earnedDate: today(),
    approvedBy: null,
    approvedAt: null,
    paidAt: null,
    note: '',
  } as unknown as BonusAward)

  await logAudit({
    action: 'bonus.awarded',
    targetType: 'bonus',
    targetId: id,
    targetLabel: input.employeeName,
    metadata: { amount: input.amountBaseMinor, reason: input.reason, source: 'manual' },
  })

  await notify(input.employeeUid, {
    kind: 'bonus_earned',
    priority: 'important',
    title: input.reason,
    body: input.rewardLabel,
    link: '/workspace',
  })

  return id
}

export async function setAwardStatus(award: BonusAward, status: AwardStatus): Promise<void> {
  const me = actor()
  const stamp = now()

  await write('bonusAwards', {
    ...award,
    status,
    approvedBy: status === 'approved' ? me.uid : award.approvedBy,
    approvedAt: status === 'approved' ? stamp : award.approvedAt,
    paidAt: status === 'paid' ? stamp : award.paidAt,
  })

  await logAudit({
    action:
      status === 'approved' ? 'bonus.approved' : status === 'paid' ? 'bonus.paid' : 'bonus.rejected',
    targetType: 'bonus',
    targetId: award.id,
    targetLabel: award.employeeName,
    metadata: { amount: award.amountBaseMinor, status, source: award.source },
  })

  if (status === 'approved' || status === 'paid') {
    await notify(award.employeeUid, {
      kind: 'bonus_approved',
      priority: 'important',
      title: award.reason || award.sourceLabel,
      body: status,
      link: '/workspace',
    })
  }
}

/* ------------------------------------------------------------------ *
 * Incentive work
 * ------------------------------------------------------------------ */

export const fetchIncentiveWork = () => readAll<IncentiveWork>('incentiveWork')

export const fetchWorkFor = (uid: string) =>
  readWhere<IncentiveWork>('incentiveWork', where('assigneeUid', '==', uid))

export async function saveWork(input: IncentiveWork): Promise<string> {
  const isNew = !input.id
  const me = actor()
  const id = await write('incentiveWork', {
    ...input,
    createdByName: input.createdByName || me.name,
  })

  if (isNew) {
    await logAudit({
      action: 'work.assigned',
      targetType: 'work',
      targetId: id,
      targetLabel: input.title,
      metadata: { assignee: input.assigneeUid, reward: input.rewardBaseMinor },
    })

    await notify(input.assigneeUid, {
      kind: 'work_assigned',
      priority: 'important',
      title: input.title,
      body: input.rewardLabel || input.dueDate || '',
      link: '/workspace',
    })
  }

  return id
}

/** The employee's own move: progress and, at most, submitting it. */
export async function submitWork(work: IncentiveWork, note: string): Promise<void> {
  await write('incentiveWork', {
    ...work,
    status: 'submitted',
    submissionNote: note.trim(),
    submittedAt: now(),
  })

  await logAudit({
    action: 'work.submitted',
    targetType: 'work',
    targetId: work.id,
    targetLabel: work.title,
    metadata: { assignee: work.assigneeUid },
  })

  if (work.createdBy) {
    await notify(work.createdBy, {
      kind: 'work_submitted',
      priority: 'important',
      title: work.title,
      body: work.assigneeName,
      link: '/bonuses',
    })
  }
}

export async function setWorkStatus(
  work: IncentiveWork,
  status: WorkStatus,
  note = '',
): Promise<void> {
  await write('incentiveWork', { ...work, status, submissionNote: note || work.submissionNote })
}

/**
 * Approve a piece of incentive work, which is what earns the bonus.
 *
 * The award is created here rather than when the work was submitted, because
 * approval is the whole point of the ladder: an employee may mark their own
 * work done, and that must not move any money.
 */
export async function approveWork(work: IncentiveWork, note: string): Promise<void> {
  const me = actor()
  const stamp = now()

  await write('incentiveWork', {
    ...work,
    status: 'approved',
    reviewedBy: me.uid,
    reviewedByName: me.name,
    reviewedAt: stamp,
    reviewNote: note.trim(),
  })

  const id = newId()
  await write('bonusAwards', {
    id,
    employeeUid: work.assigneeUid,
    employeeName: work.assigneeName,
    source: 'incentive_work',
    sourceId: work.id,
    sourceLabel: work.title,
    milestoneId: '',
    reason: work.title,
    amountBaseMinor: work.rewardBaseMinor,
    rewardLabel: work.rewardLabel,
    status: 'earned',
    earnedDate: today(),
    approvedBy: me.uid,
    approvedAt: stamp,
    paidAt: null,
    note: note.trim(),
  } as unknown as BonusAward)

  await logAudit({
    action: 'work.reviewed',
    targetType: 'work',
    targetId: work.id,
    targetLabel: work.title,
    metadata: { status: 'approved', reward: work.rewardBaseMinor },
  })

  await logActivity({
    entity: 'incentiveWork',
    entityId: work.id,
    entityLabel: work.title,
    kind: 'approved',
    summary: work.assigneeName,
  })

  await notify(work.assigneeUid, {
    kind: 'bonus_earned',
    priority: 'important',
    title: work.title,
    body: work.rewardLabel,
    link: '/workspace',
  })
}

export async function rejectWork(work: IncentiveWork, note: string): Promise<void> {
  const me = actor()

  await write('incentiveWork', {
    ...work,
    status: 'rejected',
    reviewedBy: me.uid,
    reviewedByName: me.name,
    reviewedAt: now(),
    reviewNote: note.trim(),
  })

  await logAudit({
    action: 'work.reviewed',
    targetType: 'work',
    targetId: work.id,
    targetLabel: work.title,
    metadata: { status: 'rejected' },
  })

  await notify(work.assigneeUid, {
    kind: 'work_assigned',
    priority: 'normal',
    title: work.title,
    body: note.trim(),
    link: '/workspace',
  })
}

export const deleteWork = (w: IncentiveWork) => remove('incentiveWork', w.id, w.title)

/* ------------------------------------------------------------------ *
 * Earnings
 * ------------------------------------------------------------------ */

/**
 * What one person has been given, and what is still owed to them.
 *
 * Counted from awards and commissions rather than stored, so a status change
 * anywhere is reflected everywhere. `owed` deliberately spans earned and
 * approved: both are money the company has committed and not handed over, and
 * an employee reading their own page cares about the total, not the stage.
 */
export function earningsFor(
  uid: string,
  awards: BonusAward[],
  commissions: Commission[],
  affiliateEmployeeUids: Map<string, string>,
): Earnings {
  const mine = awards.filter((a) => a.employeeUid === uid)
  const sum = (rows: BonusAward[]) => rows.reduce((n, a) => n + a.amountBaseMinor, 0)

  const paid = mine.filter((a) => a.status === 'paid')
  const month = new Date().toISOString().slice(0, 7)
  const year = month.slice(0, 4)

  const myCommissions = commissions.filter(
    (c) => affiliateEmployeeUids.get(c.affiliateId) === uid,
  )
  const commissionSum = (rows: Commission[]) => rows.reduce((n, c) => n + c.amountBaseMinor, 0)

  return {
    employeeUid: uid,
    paidBaseMinor: sum(paid),
    owedBaseMinor: sum(mine.filter((a) => OWED_STATUSES.includes(a.status))),
    pendingBaseMinor: sum(mine.filter((a) => a.status === 'pending')),
    commissionPaidBaseMinor: commissionSum(myCommissions.filter((c) => c.status === 'paid')),
    commissionOwedBaseMinor: commissionSum(
      myCommissions.filter((c) => c.status === 'pending' || c.status === 'approved'),
    ),
    monthBaseMinor: sum(paid.filter((a) => (a.paidAt ?? a.earnedDate).startsWith(month))),
    yearBaseMinor: sum(paid.filter((a) => (a.paidAt ?? a.earnedDate).startsWith(year))),
    rewards: mine
      .filter((a) => a.rewardLabel && a.status !== 'rejected' && a.status !== 'cancelled')
      .map((a) => a.rewardLabel),
  }
}
