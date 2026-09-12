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

export function rmsUser(): RmsSession | null {
  const user = rmsAuth().currentUser
  return user ? { uid: user.uid, email: user.email ?? '' } : null
}

/**
 * Wait until Firebase has restored whatever session the browser was holding.
 *
 * `currentUser` is null for the first moment after a page load even when a
 * session exists, so anything that reads it immediately concludes "not
 * connected" and shows a login form to somebody who is already signed in.
 */
export function rmsReady(): Promise<RmsSession | null> {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(rmsAuth(), (user: User | null) => {
      stop()
      resolve(user ? { uid: user.uid, email: user.email ?? '' } : null)
    })
  })
}

export class RmsAuthError extends Error {
  constructor(public readonly code: string) {
    super(`RMS sign-in failed: ${code}`)
    this.name = 'RmsAuthError'
  }
}

export async function rmsSignIn(email: string, password: string): Promise<RmsSession> {
  try {
    const credential = await signInWithEmailAndPassword(rmsAuth(), email.trim(), password)
    return { uid: credential.user.uid, email: credential.user.email ?? '' }
  } catch (error) {
    throw new RmsAuthError((error as { code?: string }).code ?? 'unknown')
  }
}

export const rmsSignOut = (): Promise<void> => signOut(rmsAuth())
