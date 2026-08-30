/**
 * Navigation gate.
 *
 * This decides which screen a person lands on, not what data they may read.
 * Bypassing it in a browser console gets you an empty page: the Firestore
 * rules refuse the reads independently. That separation is deliberate — the
 * guard is for a good experience, the rules are for security.
 */

import type { Router } from 'vue-router'

import { i18n } from '@/i18n'
import { useAuthStore } from '@/stores/auth'

export function installAuthGuard(router: Router): void {
  router.beforeEach((to) => {
    const auth = useAuthStore()
    const state = auth.state

    // Nothing to guard until the operator has connected a Firebase project.
    if (state === 'unconfigured') return true

    if (state === 'loading') return true

    // Signed-out visitors.
    if (state === 'anonymous') {
      if (to.meta.requiresAuth) {
        return { name: 'login', query: { redirect: to.fullPath } }
      }
      if (to.name === 'pending' || to.name === 'blocked') {
        return { name: 'login' }
      }
      return true
    }

    // Signed in but not yet allowed through.
    if (state === 'pending') {
      return to.name === 'pending' ? true : { name: 'pending' }
    }

    if (state === 'rejected' || state === 'blocked') {
      return to.name === 'blocked' ? true : { name: 'blocked' }
    }

    // Signed in and active.
    if (to.meta.guestOnly || to.name === 'pending' || to.name === 'blocked') {
      return { name: 'dashboard' }
    }

    if (to.meta.permission && !auth.hasPermission(to.meta.permission)) {
      return { name: 'forbidden' }
    }

    return true
  })

  router.afterEach((to) => {
    const { t } = i18n.global
    const page = to.meta.titleKey ? t(to.meta.titleKey) : null
    document.title = page ? `${page} · MsEe Central` : 'MsEe Central'
  })
}
