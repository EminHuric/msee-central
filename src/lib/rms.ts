/**
 * The connection to the RMS.
 *
 * WHAT THE RMS IS, in one paragraph, because everything here follows from it.
 *
 * The RMS is a separate Firebase project (`apartmens-saas`) with no server and
 * no API: a Vue app talking straight to Firestore, multi-tenant by a
 * `workspaceId` on every apartment and booking. So "integrating" with it is not
 * calling an endpoint — it is opening a second Firestore connection and being
 * subject to that project's own security rules.
 *
 * WHY A SECOND FIREBASE APP. Firebase Auth is per project: a session for
 * `msee-central` means nothing to `apartmens-saas`. Two apps in one page is the
 * supported way to do this, and the codebase already does it once (see
 * `src/api/provisioning.ts`). The two sessions are independent, which is the
 * property that matters: signing out of the RMS does not touch the MsEe session,
 * and an RMS outage cannot log anybody out of here.
 *
 * WHAT IS AND IS NOT A SECRET. The config below is public, exactly like MsEe
 * Central's own — every Firebase web config ships in the bundle, and the RMS
 * already publishes this one. What is NOT public is the password of the agency
 * account, and it is nowhere in this repository: somebody signs in once from the
 * StayBrain settings and Firebase keeps the session in the browser's own
 * storage, the same way the RMS itself does. There is no server here to hold a
 * credential for us, so the honest options were a login or a paid plan, and a
 * login is what this is.
 *
 * WHAT THE AGENCY ACCOUNT CAN DO is decided by the RMS's rules, not by this
 * file: read the accounts that exist, and create or amend bookings stamped as
 * ours in accounts that have switched access on. It cannot touch an apartment's
 * details, a guest, or a booking an owner made.
 */

import { readonly, ref } from 'vue'

import { forgetRmsLogin, rememberRmsLogin, rmsLoginFor } from './rmsAccounts'

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import {
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

/** Named so it can never collide with the main app's unnamed instance. */
const APP_NAME = 'rms'

/**
 * The RMS project's web config.
 *
 * Defaults are built in because they are public and because a connection that
 * needs six environment variables set correctly before it will even try is a
 * connection that looks broken on a fresh checkout. An environment variable
 * still wins, so pointing this at a test project stays a one-line change.
 */
export const rmsConfig = {
  apiKey: import.meta.env.VITE_RMS_API_KEY || 'AIzaSyChAeNwRkUF6DfUnnI1xKl_XRoSjv82WZU',
  authDomain: import.meta.env.VITE_RMS_AUTH_DOMAIN || 'apartmens-saas.firebaseapp.com',
  projectId: import.meta.env.VITE_RMS_PROJECT_ID || 'apartmens-saas',
  storageBucket: import.meta.env.VITE_RMS_STORAGE_BUCKET || 'apartmens-saas.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_RMS_MESSAGING_SENDER_ID || '543830218393',
  appId: import.meta.env.VITE_RMS_APP_ID || '1:543830218393:web:2d01ea273c6d6807270a08',
}

let rmsApp: FirebaseApp | null = null
let rmsAuthInstance: Auth | null = null
let rmsDbInstance: Firestore | null = null

function ensureRmsApp(): FirebaseApp {
  if (rmsApp) return rmsApp

  /*
   * Reuse an app of this name if one already exists.
   *
   * Vite's hot reload re-runs this module without reloading the page, and
   * initializeApp throws on a duplicate name. Without this the second save
   * during development breaks the whole screen.
   */
  rmsApp = getApps().some((a) => a.name === APP_NAME)
    ? getApp(APP_NAME)
    : initializeApp(rmsConfig, APP_NAME)

  return rmsApp
}

export function rmsAuth(): Auth {
  if (!rmsAuthInstance) {
    rmsAuthInstance = getAuth(ensureRmsApp())
    void setPersistence(rmsAuthInstance, browserLocalPersistence)
  }
  return rmsAuthInstance
}

export function rmsDb(): Firestore {
  if (!rmsDbInstance) {
    rmsDbInstance = getFirestore(ensureRmsApp())
  }
  return rmsDbInstance
}

/* ------------------------------------------------------------------ *
 * The session
 * ------------------------------------------------------------------ */

export interface RmsSession {
  uid: string
  email: string
}

/**
 * The live session, as a ref.
 *
 * A REF AND NOT A FUNCTION, AND THIS WAS A REAL BUG. Three components asked
 * `computed(() => rmsUser() !== null)`, which reads `auth.currentUser` — a plain
 * property with no reactive dependency. Vue therefore computed it once, cached
 * it, and never looked again: somebody signed in, the panel went green, and the
 * next screen still said "connect to the RMS first" for ever.
 *
 * One listener writes this ref, so everything that reads it updates together —
 * including after a token refresh, a sign-out in another tab, or an account
 * being disabled over there.
 */
const session = ref<RmsSession | null>(null)

/** Read-only to everyone else: only the auth listener below may set it. */
export const rmsSession = readonly(session)

let watching = false
let firstAnswer: Promise<RmsSession | null> | null = null

function toSession(user: User | null): RmsSession | null {
  return user ? { uid: user.uid, email: user.email ?? '' } : null
}

/**
 * Start watching, once, and remember the promise of the first answer.
 *
 * `currentUser` is null for a moment after a page load even when a session
 * exists, because Firebase has to read it back from the browser's storage first.
 * Anything that checks immediately concludes "not connected" and shows a login
 * form to somebody who is already signed in — so callers await this instead.
 */
function watchSession(): Promise<RmsSession | null> {
  if (firstAnswer) return firstAnswer

  firstAnswer = new Promise((resolve) => {
    let settled = false

    onAuthStateChanged(rmsAuth(), (user: User | null) => {
      session.value = toSession(user)
      if (!settled) {
        settled = true
        resolve(session.value)
      }
    })
  })

  watching = true
  return firstAnswer
}

/** What the session is right now. Prefer `rmsSession` in a component. */
export function rmsUser(): RmsSession | null {
  if (!watching) void watchSession()
  return session.value
}

/** Resolves once Firebase has restored whatever session the browser held. */
export const rmsReady = (): Promise<RmsSession | null> => watchSession()

export class RmsAuthError extends Error {
  constructor(public readonly code: string) {
    super(`RMS sign-in failed: ${code}`)
    this.name = 'RmsAuthError'
  }
}

export async function rmsSignIn(email: string, password: string): Promise<RmsSession> {
  /* Started first, so the listener is in place before the sign-in lands. */
  void watchSession()

  try {
    const credential = await signInWithEmailAndPassword(rmsAuth(), email.trim(), password)
    const signedIn = toSession(credential.user)
    /*
     * Set here as well as by the listener.
     *
     * The listener will fire, but not necessarily before this function returns,
     * and a caller that re-reads the session immediately afterwards would see the
     * old value. Writing it twice with the same value costs nothing.
     */
    session.value = signedIn
    return signedIn as RmsSession
  } catch (error) {
    throw new RmsAuthError((error as { code?: string }).code ?? 'unknown')
  }
}

/**
 * Make sure the session is the one this property needs.
 *
 * FIREBASE AUTH HOLDS ONE SESSION PER APP, so reading two properties owned by two
 * accounts means being each of them in turn. That is the whole of this function:
 * if the wrong account is signed in, sign in as the right one.
 *
 * Returns what happened, because the three outcomes need three different things
 * from the screen: carry on, ask for a password, or say what went wrong.
 */
export type RmsConnectResult =
  | { state: 'ready'; session: RmsSession }
  | { state: 'needs-password'; email: string }
  | { state: 'failed'; email: string; code: string }

export async function rmsConnectAs(
  email: string,
  password?: string,
): Promise<RmsConnectResult> {
  const wanted = email.trim().toLowerCase()
  if (!wanted) return { state: 'failed', email, code: 'no-account' }

  await watchSession()

  /* Already the right account: nothing to do, and no needless round trip. */
  const current = session.value
  if (current && current.email.trim().toLowerCase() === wanted) {
    return { state: 'ready', session: current }
  }

  const secret = password ?? rmsLoginFor(wanted)
  if (!secret) return { state: 'needs-password', email: wanted }

  try {
    const signedIn = await rmsSignIn(wanted, secret)
    /* Only remember a password that has actually worked. */
    rememberRmsLogin(wanted, secret)
    return { state: 'ready', session: signedIn }
  } catch (error) {
    const code = error instanceof RmsAuthError ? error.code : 'unknown'

    /*
     * A remembered password that no longer works is dropped.
     *
     * Kept, it would be retried on every visit and the property would look
     * permanently broken; dropped, the next visit asks for it, which is the
     * thing that actually fixes it.
     */
    if (!password) forgetRmsLogin(wanted)

    return { state: 'failed', email: wanted, code }
  }
}

export async function rmsSignOut(): Promise<void> {
  await signOut(rmsAuth())
  session.value = null
}
