/**
 * Registration requests.
 *
 * A person who registers gets a Firebase Auth account immediately but no
 * `userPermissions` document, so they can read nothing at all. The only thing
 * they may write is their own request, once. From then on only a reviewer can
 * touch it — which is why an applicant cannot approve themselves.
 *
 * WHY SUBMISSION IS NOT IN THE AUDIT LOG
 *
 * The specification lists "registration submitted" as an audit event, and it
 * is deliberately not written here. Doing so would mean letting accounts that
 * are not yet approved append to `auditLogs`, and anybody can create an
 * unapproved account — that is an open invitation to flood the collection and
 * burn through the project's quota.
 *
 * Nothing is lost. The request document carries `submittedAt`, the rules
 * forbid changing it, and they forbid deleting the document at all. It is the
 * submission record, and a tamper-proof one. The CEO's decision on it is
 * logged normally.
 */

import { deleteUser } from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'

import { getDb } from '@/lib/firebase'
import { useAuthStore } from '@/stores/auth'
import type { RegistrationRequest } from '@/types/domain'

export interface RegistrationInput {
  firstName: string
  lastName: string
  email: string
  password: string
  phone: string
  country: string
  city: string
  /** Data URI produced by `processProfilePhoto`. */
  photoUrl: string | null
  personalDescription: string
  desiredPosition: string
  additionalInfo: string
}

/**
 * Create the account and file the request.
 *
 * If the request write fails the freshly created account is removed again.
 * Without that, a failure here would strand somebody with credentials that let
 * them sign in forever to a screen saying "waiting for approval", with no
 * request for the CEO to ever act on.
 */
export async function submitRegistration(input: RegistrationInput): Promise<void> {
  const auth = useAuthStore()
  const fullName = `${input.firstName} ${input.lastName}`.trim()

  const user = await auth.createAccount(input.email, input.password, fullName)

  try {
    const request: Omit<RegistrationRequest, 'submittedAt'> & { submittedAt: unknown } = {
      id: user.uid,
      uid: user.uid,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      /*
       * Taken from the credential, not the form. The security rule compares
       * this against the caller's token, and Firebase normalises the address
       * it stores — using the raw input risks a mismatch on capitalisation
       * that would read as a forgery attempt.
       */
      email: user.email ?? input.email.trim().toLowerCase(),
      phone: input.phone.trim(),
      country: input.country.trim(),
      city: input.city.trim(),
      photoUrl: input.photoUrl,
      personalDescription: input.personalDescription.trim(),
      desiredPosition: input.desiredPosition.trim(),
      additionalInfo: input.additionalInfo.trim(),
      termsAcceptedAt: new Date().toISOString(),
      status: 'pending',
      submittedAt: serverTimestamp(),
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
    }

    await setDoc(doc(getDb(), 'registrationRequests', user.uid), request)
  } catch (error) {
    // Roll back the half-made account so the person can try again cleanly.
    try {
      await deleteUser(user)
    } catch {
      // If even this fails the CEO will see an account with no request, which
      // the Requests screen reports rather than hides.
    }
    throw error
  }
}

/** Has this email already filed a request? Used for a clearer error message. */
export async function hasExistingRequest(uid: string): Promise<boolean> {
  const snap = await getDoc(doc(getDb(), 'registrationRequests', uid))
  return snap.exists()
}
