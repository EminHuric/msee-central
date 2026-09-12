/**
 * What we brought each client, month by month.
 *
 * Guarded by the finance permissions, because these are money figures about the
 * company's own performance — and by the same `canRead` shape as everything
 * else, so somebody who may only see their own clients sees the attribution for
 * those and no others.
 */

import { logAudit } from './audit'
import { logActivity } from './records'
import { readAll, readWhere, where, write } from './store'
import type { Attribution } from '@/types/attribution'

export const fetchAttribution = () =>
  readAll<Attribution>('attribution', 'period', 'desc')

/**
 * Every month recorded for one client, newest first.
 *
 * Sorted here rather than by Firestore, and that is not a style choice: a
 * `where` on one field plus an `orderBy` on another needs a composite index,
 * Firestore does not create one on demand, and the query throws until somebody
 * deploys it. The reader catches that and returns an empty list — so the
 * untested version of this function returned "no months" for ever, for every
 * client, and looked exactly like a client with no months.
 *
 * One client's months number in the dozens. Sorting them in the browser costs
 * nothing and cannot be broken by a missing deploy.
 */
export const fetchAttributionFor = async (clientId: string): Promise<Attribution[]> => {
  const rows = await readWhere<Attribution>('attribution', where('clientId', '==', clientId))
  return rows.sort((a, b) => b.period.localeCompare(a.period))
}

/**
 * Record or correct a month.
 *
 * One document per client per month, with the id built from both — so recording
 * the same month twice corrects it rather than producing two. This is
 * deliberately unlike the wallet: an attribution figure is a current best
 * understanding of what our work produced, not a transaction, and revising it
 * when better channel data arrives is the normal case rather than a correction
 * to be preserved.
 */
export async function saveAttribution(input: Attribution): Promise<string> {
  const id = input.id || `${input.clientId}-${input.period}`
  const isNew = !input.createdAt

  await write('attribution', { ...input, id })

  await logAudit({
    action: 'settings.updated',
    targetType: 'client',
    targetId: input.clientId,
    targetLabel: input.clientName,
    metadata: {
      entity: 'attribution',
      period: input.period,
      turnover: input.turnover.baseMinor,
      attributed: input.attributed.baseMinor,
      ourShare: input.ourShare.baseMinor,
      basis: input.basis,
      new: isNew,
    },
  })

  await logActivity({
    entity: 'clients',
    entityId: input.clientId,
    entityLabel: input.clientName,
    kind: isNew ? 'created' : 'updated',
    summary: input.period,
    detail: input.note,
  })

  return id
}
