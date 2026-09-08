/**
 * A person's own dashboard layout.
 *
 * Stored per user, beside their notification preferences, and readable only by
 * them — the rules allow `dashboardLayouts/{uid}` to nobody but `uid`. There is
 * nothing sensitive in a list of widget names, but there is nothing useful in
 * anybody else reading it either.
 *
 * What this deliberately does not do is decide anything. It stores a
 * preference; `resolveLayout` in `@/types/dashboard` decides what that
 * preference is allowed to draw.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore'

import { getDb } from '@/lib/firebase'
import { defaultLayout, type DashboardLayout } from '@/types/dashboard'

export async function fetchLayout(uid: string): Promise<DashboardLayout> {
  try {
    const snap = await getDoc(doc(getDb(), 'dashboardLayouts', uid))
    if (snap.exists()) {
      const data = snap.data() as Partial<DashboardLayout>
      /* A stored layout with no list is a broken one; fall back rather than
         render an empty dashboard somebody cannot explain. */
      if (Array.isArray(data.visible)) {
        return { uid, visible: data.visible, updatedAt: data.updatedAt ?? '' }
      }
    }
  } catch {
    /* Nobody has saved one, or the read was refused. Either way: the default. */
  }
  return defaultLayout(uid)
}

export async function saveLayout(layout: DashboardLayout): Promise<void> {
  await setDoc(doc(getDb(), 'dashboardLayouts', layout.uid), {
    uid: layout.uid,
    visible: layout.visible,
    updatedAt: new Date().toISOString(),
  })
}

/** Back to the default, by removing the stored preference rather than rewriting it. */
export async function resetLayout(uid: string): Promise<void> {
  await saveLayout(defaultLayout(uid))
}
