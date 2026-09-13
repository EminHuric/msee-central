/** Presentation state only — theme, navigation drawer, transient toasts. */

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { setLocale, type AppLocale, currentLocale } from '@/i18n'

export type Theme = 'dark' | 'light'

const THEME_KEY = 'msee.theme'

/**
 * How large everything is drawn.
 *
 * A SWITCH AND NOT A BREAKPOINT, because the thing that matters cannot be
 * measured from here. A 55-inch television and a 27-inch monitor can report the
 * same width — many televisions report 1920 whatever their panel is — and the
 * difference that decides the right size is how far away the person is sitting.
 * No media query can know that; the person can.
 *
 * `big` raises the root font, and because every size in this system is in `rem`
 * the whole interface grows in proportion: the same layout, readable from a
 * sofa, with no separate design to keep in step.
 */
const SCALE_KEY = 'msee.scale'
export type Scale = 'normal' | 'big' | 'huge'
const SCALES: Scale[] = ['normal', 'big', 'huge']

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // Ignore storage failures; the default is fine.
  }
  return 'dark'
}

export interface Toast {
  id: number
  kind: 'ok' | 'danger' | 'info' | 'warn'
  message: string
}

let toastSequence = 0

export const useUiStore = defineStore('ui', () => {
  const theme = ref<Theme>(readStoredTheme())

  const scale = ref<Scale>(readStoredScale())

  function readStoredScale(): Scale {
    try {
      const stored = localStorage.getItem(SCALE_KEY) as Scale | null
      return stored && SCALES.includes(stored) ? stored : 'normal'
    } catch {
      /* A private window or blocked storage. Normal is the right default. */
      return 'normal'
    }
  }

  function applyScale(next: Scale): void {
    scale.value = next
    document.documentElement.setAttribute('data-scale', next)
    try {
      localStorage.setItem(SCALE_KEY, next)
    } catch {
      /* Not remembered, still applied. */
    }
  }

  /** Round the three, so one control can cycle them. */
  function cycleScale(): void {
    const at = SCALES.indexOf(scale.value)
    applyScale(SCALES[(at + 1) % SCALES.length] ?? 'normal')
  }
  const locale = ref<AppLocale>(currentLocale())
  const sidebarOpen = ref(false)
  const toasts = ref<Toast[]>([])

  function applyTheme(next: Theme): void {
    theme.value = next
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Persistence is a convenience, not a requirement.
    }
  }

  function toggleTheme(): void {
    applyTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  function changeLocale(next: AppLocale): void {
    locale.value = next
    setLocale(next)
  }

  function openSidebar(): void {
    sidebarOpen.value = true
  }

  function closeSidebar(): void {
    sidebarOpen.value = false
  }

  function toggleSidebar(): void {
    sidebarOpen.value = !sidebarOpen.value
  }

  function notify(kind: Toast['kind'], message: string): void {
    const id = ++toastSequence
    toasts.value.push({ id, kind, message })
    window.setTimeout(() => dismissToast(id), 5000)
  }

  function dismissToast(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  // Reflect the persisted theme immediately in case the inline boot script in
  // index.html was blocked.
  applyTheme(theme.value)
  applyScale(scale.value)

  return {
    theme,
    locale,
    sidebarOpen,
    toasts,
    applyTheme,
    toggleTheme,
    changeLocale,
    openSidebar,
    closeSidebar,
    toggleSidebar,
    scale,
    applyScale,
    cycleScale,
    notify,
    dismissToast,
  }
})
