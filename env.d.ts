/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

interface ImportMetaEnv {
  /**
   * Firebase web configuration.
   *
   * These values are NOT secrets. Firebase web config is public by design and
   * ships inside every client bundle. What protects the data is Firestore
   * Security Rules, not the obscurity of these keys.
   *
   * A service account key IS a secret and must never appear here or anywhere
   * under src/. It belongs only in tools/ scripts, loaded from a file that is
   * listed in .gitignore.
   */
  readonly VITE_FIREBASE_API_KEY: string
  readonly VITE_FIREBASE_AUTH_DOMAIN: string
  readonly VITE_FIREBASE_PROJECT_ID: string
  readonly VITE_FIREBASE_STORAGE_BUCKET: string
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string
  readonly VITE_FIREBASE_APP_ID: string

  /** When 'true', connect to the local Firebase emulator suite instead of production. */
  readonly VITE_USE_FIREBASE_EMULATOR?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
