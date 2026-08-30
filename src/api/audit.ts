/**
 * Audit trail.
 *
 * Entries are append-only: the rules allow `create` and refuse `update` and
 * `delete` to everybody, including the CEO. The actor cannot be forged either,
 * because the rules compare the entry against the caller's own token.
 *
 * KNOWN LIMIT, stated plainly: the client writes these entries. Rules can
 * reject a forged or altered one, but cannot force an entry to be written at
 * all — somebody working directly against the API could act without logging
 * it. Everything done through the application is logged. Closing the gap
 * entirely needs Cloud Functions, which is the intended upgrade path.
 */

import { addDoc, collection, serverTimestamp } from 'firebase/firestore'

import { getDb } from '@/lib/firebase'
import { useAuthStore } from '@/stores/auth'
import type { AuditAction, AuditTargetType } from '@/types/domain'

export interface AuditInput {
  action: AuditAction
  targetType: AuditTargetType
  targetId: string
  /** Human-readable label, so the log stays meaningful if the target is gone. */
  targetLabel: string
  metadata?: Record<string, unknown>
}

/**
 * Record an action.
 *
 * Never throws. A failed audit write must not roll back or block the thing the
 * user was actually doing — losing one log line is bad, but leaving the app
 * half-finished because logging failed is worse. Failures surface in the
 * console for the developer.
 */
export async function logAudit(input: AuditInput): Promise<void> {
  const auth = useAuthStore()
  const user = auth.firebaseUser

  if (!user?.email) return

  try {
    await addDoc(collection(getDb(), 'auditLogs'), {
      actorUid: user.uid,
      actorEmail: user.email,
      actorName: user.displayName ?? user.email,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      targetLabel: input.targetLabel,
      metadata: input.metadata ?? {},
      createdAt: serverTimestamp(),
    })
  } catch (error) {
    console.error('[audit] entry could not be written', input.action, error)
  }
}
