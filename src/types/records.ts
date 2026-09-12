/**
 * The three things every record in this system has in common.
 *
 * They live together because they are the same idea from three angles: a
 * record is something that can be extended without a code change, something
 * whose changes are worth remembering, and something that must survive being
 * deleted by mistake.
 */

/* ------------------------------------------------------------------ *
 * Soft delete
 * ------------------------------------------------------------------ */

/**
 * Deleting removes a record from every list; it does not destroy it.
 *
 * `deletedAt` is the whole mechanism. Every query filters on it, the recycle
 * bin selects on it, and restoring is clearing it. Nothing is copied to a
 * second collection — a copy would need its own rules, its own indexes, and
 * would drift from the original the first time somebody changed the shape.
 *
 * The retention window is enforced when the bin is emptied, not by a timer:
 * there is no server to run one, and a record quietly vanishing on a schedule
 * nobody watched is worse than a bin that needs emptying.
 */
export interface SoftDeletable {
  deletedAt: string | null
  deletedBy: string | null
  deletedByName: string
}

/** Default retention. Configurable in settings; this is what it starts at. */
export const RETENTION_DAYS = 30

/** Collections whose records go to the bin rather than being destroyed. */
export const RECOVERABLE = [
  'clients',
  'leads',
  'projects',
  'sales',
  'services',
  'transactions',
  'goals',
  'affiliates',
  'calendarEvents',
  'bonusPrograms',
  'incentiveWork',
  'reservations',
  'staybrainListings',
] as const
export type RecoverableCollection = (typeof RECOVERABLE)[number]

/** One row in the recycle bin, whatever it used to be. */
export interface DeletedRecord {
  id: string
  collection: RecoverableCollection
  label: string
  detail: string
  deletedAt: string
  deletedByName: string
  /** Days left before it may be purged. Negative means it is overdue. */
  daysLeft: number
}

/* ------------------------------------------------------------------ *
 * Custom fields
 * ------------------------------------------------------------------ */

export const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'boolean',
  'select',
  'multi_select',
  /*
   * `currency` is a number the screen formats as money, not a Money record.
   * A custom field cannot carry a frozen exchange rate, so it must never be
   * summed into a company total — it is a note about an amount, and the
   * amounts the business runs on live on sales and transactions.
   */
  'currency',
  'url',
] as const
export type FieldType = (typeof FIELD_TYPES)[number]

/** Which record types can be extended. Adding one is a one-line change. */
export const FIELD_ENTITIES = [
  'client',
  'lead',
  'project',
  'sale',
  'service',
  'employee',
  'goal',
] as const
export type FieldEntity = (typeof FIELD_ENTITIES)[number]

/**
 * Who may see a custom field.
 *
 * The same three tiers the employee profile already uses, so a person does not
 * have to learn a second privacy vocabulary.
 */
export const FIELD_VISIBILITY = ['everyone', 'management', 'owner'] as const
export type FieldVisibility = (typeof FIELD_VISIBILITY)[number]

export interface CustomFieldDef {
  id: string
  entity: FieldEntity
  /** The key the value is stored under. Generated from the label, then frozen. */
  key: string
  label: string
  type: FieldType
  required: boolean
  visibility: FieldVisibility
  /** For select and multi_select. Ignored otherwise. */
  options: string[]
  defaultValue: string
  helpText: string
  /** Lower sorts first, so the CEO controls the order fields appear in. */
  order: number
  active: boolean
  createdAt: string
  createdBy: string
  updatedAt: string
}

/** The bag a record carries. Keys are `CustomFieldDef.key`. */
export type CustomValues = Record<string, string | number | boolean | string[] | null>

/** A blank value of the right shape for a field's type. */
export function emptyValue(field: CustomFieldDef): CustomValues[string] {
  switch (field.type) {
    case 'number':
      return field.defaultValue ? Number(field.defaultValue) : null
    case 'boolean':
      return field.defaultValue === 'true'
    case 'multi_select':
      return field.defaultValue ? field.defaultValue.split(',').map((s) => s.trim()) : []
    default:
      return field.defaultValue || ''
  }
}

/** Turn a label into a stable storage key. */
export function fieldKey(label: string, existing: CustomFieldDef[]): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 32) || 'field'

  const taken = new Set(existing.map((f) => f.key))
  if (!taken.has(base)) return base

  let n = 2
  while (taken.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

/* ------------------------------------------------------------------ *
 * Activity
 * ------------------------------------------------------------------ */

export const ACTIVITY_KINDS = [
  'created',
  'updated',
  'deleted',
  'restored',
  'status_changed',
  'note',
  'contacted',
  'converted',
  'payment',
  'approved',
  'assigned',
] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

/**
 * What happened to one record.
 *
 * Written to `activity`, flat, with the record it belongs to named on it. Flat
 * rather than a subcollection per record so that "everything that happened
 * this week" is one query rather than one per client.
 *
 * This is not the audit log. The audit log answers "who changed permissions in
 * March" and is protected from ordinary employees; this answers "what has been
 * going on with this client" and is meant to be read by whoever works on it.
 */
export interface ActivityEntry {
  id: string
  /** The collection and id of the record this is about. */
  entity: string
  entityId: string
  entityLabel: string
  kind: ActivityKind
  /** One line, already written for a human. */
  summary: string
  detail: string
  actorUid: string
  actorName: string
  createdAt: string
}
