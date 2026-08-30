/**
 * Firebase initialisation.
 *
 * The values read here are public by design — Firebase web config ships in
 * every client bundle. Nothing in this file is a secret and nothing here
 * protects data. Authorisation lives in firebase/firestore.rules, enforced by
 * Google's servers on every read and write.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
  type Auth,
} from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore'
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage'

/**
 * Exported so a second, short-lived app instance can be created for
 * provisioning employee accounts. See src/api/provisioning.ts for why that is
 * necessary.
 */
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

/** Which required environment variables are still empty. */
export function missingFirebaseConfig(): string[] {
  return Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => `VITE_FIREBASE_${camelToScreamingSnake(key)}`)
}

export function isFirebaseConfigured(): boolean {
  return missingFirebaseConfig().length === 0
}

function camelToScreamingSnake(value: string): string {
  return value.replace(/([A-Z])/g, '_$1').toUpperCase()
}

let app: FirebaseApp | null = null
let authInstance: Auth | null = null
let dbInstance: Firestore | null = null
let storageInstance: FirebaseStorage | null = null

function ensureApp(): FirebaseApp {
  if (!isFirebaseConfigured()) {
    throw new Error(
      `Firebase is not configured. Missing: ${missingFirebaseConfig().join(', ')}. ` +
        'Copy .env.example to .env and fill in the values from the Firebase console.',
    )
  }

  if (!app) {
    app = initializeApp(firebaseConfig)
  }
  return app
}

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(ensureApp())

    // Keep the session across browser restarts. Firebase refreshes the ID
    // token roughly hourly, which is also how quickly a revoked permission
    // change reaches the client.
    void setPersistence(authInstance, browserLocalPersistence)

    if (useEmulator()) {
      connectAuthEmulator(authInstance, 'http://127.0.0.1:9099', { disableWarnings: true })
    }
  }
  return authInstance
}

export function getDb(): Firestore {
  if (!dbInstance) {
    dbInstance = getFirestore(ensureApp())
    if (useEmulator()) {
      connectFirestoreEmulator(dbInstance, '127.0.0.1', 8080)
    }
  }
  return dbInstance
}

export function getFileStorage(): FirebaseStorage {
  if (!storageInstance) {
    storageInstance = getStorage(ensureApp())
    if (useEmulator()) {
      connectStorageEmulator(storageInstance, '127.0.0.1', 9199)
    }
  }
  return storageInstance
}

function useEmulator(): boolean {
  return import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true'
}
