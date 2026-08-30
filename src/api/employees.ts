/**
 * Employee profiles.
 *
 * The privacy model lives here, and it is worth stating plainly: a Firestore
 * rule guards a whole document, never a single field. So "phone visible to
 * management, city private, name public" cannot be one document with flags on
 * it — the tiers ARE separate documents, and changing a privacy setting means
 * physically moving the value between them.
 *
 *   employees/{uid}                        professional identity, always shown
 *   employees/{uid}/visibility/everyone    fields marked "everyone"
 *   employees/{uid}/visibility/management  fields marked "management"
 *   employees/{uid}/visibility/private     every field, plus the privacy map
 *
 * The private tier holds the authoritative copy of everything. The other two
 * are projections of it, rebuilt on every save.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore'

import { getDb } from '@/lib/firebase'
import {
  DEFAULT_PRIVACY,
  PRIVACY_CONTROLLED_FIELDS,
  type EmployeePublic,
  type PrivacyControlledField,
  type PrivacySettings,
} from '@/types/domain'

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/** Personal fields, all of them subject to a visibility setting. */
export interface PersonalRecord {
  email: string
  phone: string
  city: string
  country: string
  personalDescription: string
  languages: string[]
  interests: string[]
}

export const EMPTY_PERSONAL: PersonalRecord = {
  email: '',
  phone: '',
  city: '',
  country: '',
  personalDescription: '',
  languages: [],
  interests: [],
}

export interface EmployeeDetail {
  profile: EmployeePublic
  /** Merged from every tier the viewer was allowed to open. */
  personal: PersonalRecord
  /** Only present when the private tier was readable: the subject, or the CEO. */
  privacy: PrivacySettings | null
  /** True when `personal` is complete rather than partially withheld. */
  sawEverything: boolean
}

/* ------------------------------------------------------------------ *
 * Required fields
 *
 * The specification asks for two kinds of mandatory information: things
 * everyone must fill in AND that colleagues can see, and things everyone must
 * fill in that stay with the owner. Both are listed here so one place answers
 * "is this profile complete".
 * ------------------------------------------------------------------ */

/** Always visible to colleagues. An employee cannot hide these. */
export const REQUIRED_PUBLIC_FIELDS = ['photoUrl', 'bio', 'skills'] as const

/** Must be filled in, but the owner's privacy setting decides who sees them. */
export const REQUIRED_PERSONAL_FIELDS = [
  'phone',
  'city',
  'country',
  'personalDescription',
  'languages',
] as const

export type MissingField =
  | (typeof REQUIRED_PUBLIC_FIELDS)[number]
  | (typeof REQUIRED_PERSONAL_FIELDS)[number]

/** Which required fields are still empty. Drives the completeness meter. */
export function missingFields(detail: EmployeeDetail): MissingField[] {
  const out: MissingField[] = []

  if (!detail.profile.photoUrl) out.push('photoUrl')
  if (!detail.profile.bio.trim()) out.push('bio')
  if (detail.profile.skills.length === 0) out.push('skills')

  if (!detail.personal.phone.trim()) out.push('phone')
  if (!detail.personal.city.trim()) out.push('city')
  if (!detail.personal.country.trim()) out.push('country')
  if (!detail.personal.personalDescription.trim()) out.push('personalDescription')
  if (detail.personal.languages.length === 0) out.push('languages')

  return out
}

export function completeness(detail: EmployeeDetail): number {
  const total = REQUIRED_PUBLIC_FIELDS.length + REQUIRED_PERSONAL_FIELDS.length
  return Math.round(((total - missingFields(detail).length) / total) * 100)
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/**
 * Read a tier, treating "you may not" as an answer rather than an error.
 *
 * A denied read is the privacy model working, not a fault, so it returns
 * `undefined` and the caller carries on with less information.
 */
async function readTier(uid: string, tier: string): Promise<DocumentData | null | undefined> {
  try {
    const snap = await getDoc(doc(getDb(), 'employees', uid, 'visibility', tier))
    return snap.exists() ? snap.data() : null
  } catch (error) {
    if ((error as { code?: string }).code === 'permission-denied') return undefined
    throw error
  }
}

function mergePersonal(target: PersonalRecord, source: DocumentData | null | undefined): void {
  if (!source) return
  for (const field of PRIVACY_CONTROLLED_FIELDS) {
    const value = source[field]
    if (value === undefined || value === null) continue
    if (field === 'languages' || field === 'interests') {
      if (Array.isArray(value)) target[field] = value as string[]
    } else {
      target[field] = String(value)
    }
  }
}

/**
 * Assemble one employee from whatever the current viewer is allowed to open.
 *
 * Tiers are attempted from least to most sensitive; each denial simply leaves
 * those fields empty.
 */
export async function fetchEmployee(uid: string): Promise<EmployeeDetail | null> {
  const snap = await getDoc(doc(getDb(), 'employees', uid))
  if (!snap.exists()) return null

  const profile = snap.data() as EmployeePublic
  const personal: PersonalRecord = { ...EMPTY_PERSONAL }

  mergePersonal(personal, await readTier(uid, 'everyone'))
  mergePersonal(personal, await readTier(uid, 'management'))

  const priv = await readTier(uid, 'private')
  const sawEverything = priv !== undefined
  mergePersonal(personal, priv)

  const privacy =
    priv && typeof priv.privacy === 'object' ? ({ ...DEFAULT_PRIVACY, ...priv.privacy } as PrivacySettings) : null

  return { profile, personal, privacy: sawEverything ? (privacy ?? DEFAULT_PRIVACY) : null, sawEverything }
}

/** The directory. Only the professional tier — no personal fields are fetched. */
export async function fetchEmployees(): Promise<EmployeePublic[]> {
  const snap = await getDocs(query(collection(getDb(), 'employees'), orderBy('lastName')))
  return snap.docs.map((d) => d.data() as EmployeePublic)
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

export interface OwnProfileInput {
  photoUrl: string | null
  bio: string
  skills: string[]
  expertise: string[]
  personal: PersonalRecord
  privacy: PrivacySettings
  /**
   * Only sent by somebody holding `employees.edit_professional`.
   *
   * A person cannot rename themselves — the security rules accept just four
   * fields from the subject, and these are not among them. An administrator
   * correcting a misspelled surname is a different matter, so the same
   * function serves both and simply omits these when they are absent.
   */
  firstName?: string
  lastName?: string
}

/**
 * Save a profile.
 *
 * Serves two callers: the person editing their own, and an administrator
 * editing somebody else's. The difference is what they pass — a subject sends
 * no name fields, because the rules accept only four fields from them; an
 * administrator holding edit_professional may send those too.
 *
 * Role, status, position and department are never sent from here. They belong
 * to the management panel and are gated by separate permissions, so that
 * editing a photo can never quietly become a promotion.
 *
 * The three tier documents are REPLACED, not merged. That is the important
 * line in this file: merging would leave a value behind in the `everyone`
 * document after the owner moved it to `private`, and the old value would keep
 * being served to colleagues. Replacing guarantees a field exists in exactly
 * one visible tier.
 */
export async function saveOwnProfile(uid: string, input: OwnProfileInput): Promise<void> {
  const db = getDb()
  const batch = writeBatch(db)

  batch.update(doc(db, 'employees', uid), {
    photoUrl: input.photoUrl,
    bio: input.bio.trim(),
    skills: input.skills,
    expertise: input.expertise,
    ...(input.firstName !== undefined ? { firstName: input.firstName.trim() } : {}),
    ...(input.lastName !== undefined ? { lastName: input.lastName.trim() } : {}),
    updatedAt: new Date().toISOString(),
  })

  const { everyone, management } = projectTiers(input.personal, input.privacy)

  batch.set(doc(db, 'employees', uid, 'visibility', 'everyone'), everyone)
  batch.set(doc(db, 'employees', uid, 'visibility', 'management'), management)
  batch.set(doc(db, 'employees', uid, 'visibility', 'private'), {
    ...input.personal,
    privacy: input.privacy,
    updatedAt: serverTimestamp(),
  })

  await batch.commit()
}

/** Split personal fields into the two visible tiers according to the settings. */
function projectTiers(
  personal: PersonalRecord,
  privacy: PrivacySettings,
): { everyone: Record<string, unknown>; management: Record<string, unknown> } {
  const everyone: Record<string, unknown> = {}
  const management: Record<string, unknown> = {}

  for (const field of PRIVACY_CONTROLLED_FIELDS) {
    const value = personal[field as PrivacyControlledField]
    if (isEmpty(value)) continue

    switch (privacy[field]) {
      case 'everyone':
        everyone[field] = value
        break
      case 'management':
        management[field] = value
        break
      case 'private':
        // Stays only in the private tier.
        break
    }
  }

  return { everyone, management }
}

function isEmpty(value: string | string[]): boolean {
  return Array.isArray(value) ? value.length === 0 : value.trim() === ''
}
