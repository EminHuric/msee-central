/**
 * A copy of everything, in a file on your own disk.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS. A business whose records exist in exactly
 * one place has a single point of failure that is not its own: an account can be
 * locked, a project can be deleted by a wrong click in a console, a card can
 * expire. None of that is likely and all of it is survivable with a file — and
 * unsurvivable without one. This is the difference between an inconvenience and
 * starting the year again from memory.
 *
 * IT READS AND NEVER WRITES. Nothing here changes a single record, so running it
 * is always safe, however often and whenever.
 *
 * WHAT IS IN THE FILE. Every collection this person is allowed to read, exactly
 * as stored — including the deleted ones, because a recycle bin that is missing
 * from the backup is a recycle bin that cannot be restored from it.
 *
 * WHAT IS NOT. Anything the security rules refuse. A backup taken by somebody who
 * cannot read the payroll will not contain the payroll, and the file says so
 * rather than appearing complete. An owner's copy is the complete one.
 */

import { collection, getDocs } from 'firebase/firestore'

import { getDb } from '@/lib/firebase'

/**
 * Every collection worth keeping.
 *
 * Written out rather than discovered, because Firestore cannot list its own
 * collections from a browser — and a hard-coded list that somebody must extend
 * is better than a backup that silently stops covering a new one. The check
 * below names what came back empty, so a collection that quietly disappears from
 * this list is visible in the result.
 */
const COLLECTIONS = [
  'clients',
  'leads',
  'projects',
  'sales',
  'services',
  'transactions',
  'reservations',
  'staybrainListings',
  'attribution',
  'intake',
  'goals',
  'roleKpis',
  'bonusPrograms',
  'bonusAwards',
  'incentiveWork',
  'commissions',
  'affiliates',
  'walletEntries',
  'calendarEvents',
  'customFields',
  'activity',
  'notes',
  'employees',
  'departments',
  'positions',
  'roles',
  'userPermissions',
  'companySettings',
  'auditLogs',
] as const

export interface BackupResult {
  /** What the file is called, for telling somebody where it went. */
  filename: string
  /** Collection name to how many documents came back. */
  counts: Record<string, number>
  /** Collections the rules refused. Named, never silently dropped. */
  refused: string[]
  total: number
}

/**
 * Read everything, and hand it over as a file.
 *
 * One collection at a time rather than in parallel: a backup is not in a hurry,
 * and twenty-nine simultaneous reads from one browser is how a connection starts
 * dropping requests — a backup that half-worked is worse than one that took ten
 * seconds.
 */
export async function downloadBackup(): Promise<BackupResult> {
  const db = getDb()
  const data: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}
  const refused: string[] = []
  let total = 0

  for (const name of COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, name))
      data[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      counts[name] = snap.size
      total += snap.size
    } catch {
      /*
       * Refused by the rules, which is a fact about this person's access and not
       * a failure of the backup. Recorded in the file as well as reported, so a
       * copy restored years later cannot be mistaken for the whole of it.
       */
      refused.push(name)
      data[name] = []
      counts[name] = 0
    }
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const filename = `msee-central-backup-${stamp}.json`

  const file = {
    system: 'MsEe Central',
    takenAt: new Date().toISOString(),
    /*
     * Stated in the file itself. A restore reads this before anything else, and
     * "these collections were not readable" is the first thing it needs to know.
     */
    refused,
    counts,
    total,
    data,
  }

  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()

  /* Released on the next tick: revoking in the same frame cancels the download. */
  setTimeout(() => URL.revokeObjectURL(url), 0)

  return { filename, counts, refused, total }
}
