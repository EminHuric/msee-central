/** Presentation state only — theme, navigation drawer, transient toasts. */

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { setLocale, type AppLocale, currentLocale } from '@/i18n'

export type Theme = 'dark' | 'light'

const THEME_KEY = 'msee.theme'

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
    notify,
    dismissToast,
  }
})
