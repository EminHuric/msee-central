import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { i18n } from './i18n'
import router from './router'
import { installAuthGuard } from './router/guards'
import { useAuthStore } from './stores/auth'

import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'

async function bootstrap(): Promise<void> {
  const app = createApp(App)

  app.use(createPinia())
  app.use(i18n)

  // Resolve the session before the first navigation, so the guard never has to
  // decide with half the picture and flash the login screen at a signed-in
  // user.
  const auth = useAuthStore()
  await auth.initialise()

  installAuthGuard(router)
  app.use(router)
  await router.isReady()

  app.mount('#app')
}

void bootstrap()
