/**
 * Departments and positions.
 *
 * Kept separate from roles on purpose. A position is the job somebody does
 * ("Marketing Manager"); a role is what they may do inside MsEe Central
 * ("Manager"). Conflating them is the mistake that makes permission systems
 * impossible to reason about later.
 */

import { collection, getDocs, orderBy, query } from 'firebase/firestore'

import { getDb } from '@/lib/firebase'
import { currentLocale } from '@/i18n'
import type { AccountType, Department, Position } from '@/types/domain'

export async function fetchDepartments(): Promise<Department[]> {
  const snap = await getDocs(query(collection(getDb(), 'departments'), orderBy('name')))
  return snap.docs.map((d) => ({ ...(d.data() as Department), id: d.id }))
}

export async function fetchPositions(): Promise<Position[]> {
  const snap = await getDocs(query(collection(getDb(), 'positions'), orderBy('title')))
  return snap.docs.map((d) => {
    // Positions created before account types existed are staff positions.
    const data = d.data() as Partial<Position>
    return {
      ...data,
      id: d.id,
      forAccountType: data.forAccountType ?? 'employee',
    } as Position
  })
}

/**
 * Positions offered for one kind of account.
 *
 * An affiliate is not hired as a Developer and staff are not hired as
 * Affiliate Partners, so showing the whole list in either picker only invites
 * a wrong choice.
 */
export function positionsFor(positions: Position[], accountType: AccountType): Position[] {
  return positions.filter((p) => p.status === 'active' && p.forAccountType === accountType)
}

/** Localised name, falling back to the English one when no translation exists. */
export function departmentName(department: Department | undefined): string | null {
  if (!department) return null
  return (currentLocale() === 'sr' ? department.nameSr : department.name) || department.name
}

export function positionName(position: Position | undefined): string | null {
  if (!position) return null
  return (currentLocale() === 'sr' ? position.titleSr : position.title) || position.title
}

/**
 * Look up by id, tolerating references to records that no longer exist.
 *
 * Departments and positions are deactivated rather than deleted, but an
 * employee can still hold an id that was never created — early data, or an
 * import. Showing the raw id beats showing nothing.
 */
export function lookupLabel<T extends { id: string }>(
  index: Map<string, T>,
  id: string | null,
  label: (item: T | undefined) => string | null,
): string | null {
  if (!id) return null
  return label(index.get(id)) ?? id
}

export function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}
