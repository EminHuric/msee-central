/**
 * Session and effective permissions.
 *
 * Two documents decide what the signed-in person may do:
 *
 *   userPermissions/{uid}      created by the CEO on approval. Its absence is
 *                              itself meaningful: no document means no access.
 *   registrationRequests/{uid} readable by its own author, so somebody still
 *                              waiting can be told why they cannot get in.
 *
 * Both are watched live. If the CEO suspends an account or removes a
 * permission, the open browser reacts within moments rather than at next
 * login. The UI reacting is a courtesy; the security rules are what actually
 * stop the request.
 */

import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { getDb, getFirebaseAuth, isFirebaseConfigured } from '@/lib/firebase'
import type {
  AccountStatus,
  EmployeePublic,
  RegistrationRequest,
  UserPermissions,
} from '@/types/domain'
import type { Permission } from '@/types/permissions'

export type SessionState =
  | 'loading'
  | 'anonymous'
  | 'pending'
  | 'rejected'
  | 'blocked'
  | 'active'
  | 'unconfigured'

export const useAuthStore = defineStore('auth', () => {
  const firebaseUser = ref<FirebaseUser | null>(null)
  const access = ref<UserPermissions | null>(null)
  const request = ref<RegistrationRequest | null>(null)
  /**
   * The signed-in person's own employee record.
   *
   * Watched live rather than fetched once, so a new profile photo appears in
   * the header the moment it is saved, on every open tab.
   */
  const profile = ref<EmployeePublic | null>(null)
  const initialised = ref(false)

  let stopAccessWatch: Unsubscribe | null = null
  let stopRequestWatch: Unsubscribe | null = null
  let stopProfileWatch: Unsubscribe | null = null

  const uid = computed(() => firebaseUser.value?.uid ?? null)
  const email = computed(() => firebaseUser.value?.email ?? null)
  /*
   * The employee record wins over the Firebase Auth display name. Auth only
   * holds whatever was set at sign-up; the profile is what the CEO and the
   * person themselves actually maintain.
   */
  const displayName = computed(() => {
    const p = profile.value
    if (p) {
      const full = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim()
      if (full) return full
    }
    return firebaseUser.value?.displayName ?? null
  })

  const photoUrl = computed(() => profile.value?.photoUrl ?? null)
  /** Owner: CEO or an appointed co-owner. Full authority. */
  const isCeo = computed(() => access.value?.isCeo === true)
  /**
   * The founder. Untouchable by anyone, and the only account that may appoint
   * or remove a co-owner.
   */
  const isFounder = computed(() => access.value?.isFounder === true)
  const status = computed<AccountStatus | null>(() => access.value?.status ?? null)

  const state = computed<SessionState>(() => {
    if (!isFirebaseConfigured()) return 'unconfigured'
    if (!initialised.value) return 'loading'
    if (!firebaseUser.value) return 'anonymous'

    if (access.value) {
      switch (access.value.status) {
        case 'active':
          return 'active'
        case 'pending':
          return 'pending'
        case 'rejected':
          return 'rejected'
        default:
          return 'blocked'
      }
    }

    // No permissions document. Either still waiting, or turned away.
    if (request.value?.status === 'rejected') return 'rejected'
    if (request.value?.status === 'pending') return 'pending'

    // Signed in with nothing attached — treat as not yet approved rather than
    // guessing. This is the safe direction to fail in.
    return 'pending'
  })

  const isSignedIn = computed(() => firebaseUser.value !== null)
  const isActive = computed(() => state.value === 'active')

  /**
   * Does the current user hold this permission?
   *
   * The CEO role carries `grantsAll`, so it answers true for permissions that
   * do not exist yet — future modules are covered without a migration.
   */
  function hasPermission(permission: Permission): boolean {
    const a = access.value
    if (!a) return false
    if (a.status !== 'active') return false
    if (a.isCeo) return true
    return a.permissions.includes(permission)
  }

  function hasAny(...permissions: Permission[]): boolean {
    return permissions.some(hasPermission)
  }

  function hasAll(...permissions: Permission[]): boolean {
    return permissions.every(hasPermission)
  }

  /** Start watching the two access documents for a given account. */
  function watchAccess(user: FirebaseUser): void {
    stopWatching()
    const db = getDb()

    stopAccessWatch = onSnapshot(
      doc(db, 'userPermissions', user.uid),
      (snap) => {
        access.value = snap.exists() ? (snap.data() as UserPermissions) : null
        initialised.value = true
      },
      () => {
        // A denied read is a legitimate answer: no access.
        access.value = null
        initialised.value = true
      },
    )

    stopRequestWatch = onSnapshot(
      doc(db, 'registrationRequests', user.uid),
      (snap) => {
        request.value = snap.exists() ? (snap.data() as RegistrationRequest) : null
      },
      () => {
        request.value = null
      },
    )

    stopProfileWatch = onSnapshot(
      doc(db, 'employees', user.uid),
      (snap) => {
        profile.value = snap.exists() ? (snap.data() as EmployeePublic) : null
      },
      () => {
        // Somebody still awaiting approval has no employee record yet.
        profile.value = null
      },
    )
  }

  function stopWatching(): void {
    stopAccessWatch?.()
    stopRequestWatch?.()
    stopProfileWatch?.()
    stopAccessWatch = null
    stopRequestWatch = null
    stopProfileWatch = null
  }

  /** Called once at boot. Resolves when the first auth state is known. */
  function initialise(): Promise<void> {
    if (!isFirebaseConfigured()) {
      initialised.value = true
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      onAuthStateChanged(getFirebaseAuth(), (user) => {
        firebaseUser.value = user

        if (user) {
          watchAccess(user)
        } else {
          stopWatching()
          access.value = null
          request.value = null
          profile.value = null
          initialised.value = true
        }

        resolve()
      })
    })
  }

  async function signIn(emailAddress: string, password: string): Promise<void> {
    initialised.value = false
    await signInWithEmailAndPassword(getFirebaseAuth(), emailAddress.trim(), password)
  }

  /**
   * Create the Firebase Auth account for a registration request.
   *
   * The account exists immediately but carries no permissions document, so it
   * cannot read anything. The caller then writes the request itself.
   */
  async function createAccount(
    emailAddress: string,
    password: string,
    fullName: string,
  ): Promise<FirebaseUser> {
    const credential = await createUserWithEmailAndPassword(
      getFirebaseAuth(),
      emailAddress.trim(),
      password,
    )
    await updateProfile(credential.user, { displayName: fullName })
    return credential.user
  }

  async function signOut(): Promise<void> {
    stopWatching()
    access.value = null
    request.value = null
    profile.value = null
    await firebaseSignOut(getFirebaseAuth())
  }

  async function sendPasswordReset(emailAddress: string): Promise<void> {
    await sendPasswordResetEmail(getFirebaseAuth(), emailAddress.trim())
  }

  return {
    firebaseUser,
    access,
    request,
    profile,
    initialised,
    uid,
    email,
    displayName,
    photoUrl,
    isCeo,
    isFounder,
    status,
    state,
    isSignedIn,
    isActive,
    hasPermission,
    hasAny,
    hasAll,
    initialise,
    signIn,
    createAccount,
    signOut,
    sendPasswordReset,
  }
})
