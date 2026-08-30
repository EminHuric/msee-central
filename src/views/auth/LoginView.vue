<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import AuthShell from '@/layouts/AuthShell.vue'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()

const email = ref('')
const password = ref('')
const busy = ref(false)
const error = ref('')
const resetSent = ref(false)

/**
 * Firebase reports "no such user" and "wrong password" separately. Both are
 * shown as one message so the form cannot be used to discover which email
 * addresses belong to employees.
 */
function describeError(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-email':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return t('auth.invalidCredentials')
    case 'auth/too-many-requests':
      return t('auth.tooManyAttempts')
    case 'auth/network-request-failed':
      return t('errors.network')
    default:
      return t('errors.generic')
  }
}

async function submit(): Promise<void> {
  if (busy.value) return
  error.value = ''
  resetSent.value = false

  if (!email.value.trim() || !password.value) {
    error.value = t('errors.required')
    return
  }

  busy.value = true
  try {
    await auth.signIn(email.value, password.value)
    const target = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.replace(target)
  } catch (err) {
    error.value = describeError((err as { code?: string }).code ?? '')
  } finally {
    busy.value = false
  }
}

async function requestReset(): Promise<void> {
  error.value = ''
  if (!email.value.trim()) {
    error.value = t('errors.invalidEmail')
    return
  }

  try {
    await auth.sendPasswordReset(email.value)
  } catch {
    // Deliberately ignored: the confirmation is identical either way so the
    // form never reveals whether an address is registered.
  }
  resetSent.value = true
  ui.notify('info', t('auth.resetSent'))
}
</script>

<template>
  <AuthShell>
    <form class="stack" novalidate @submit.prevent="submit">
      <div>
        <h1 class="form-title">{{ t('auth.signInTitle') }}</h1>
        <p class="muted form-subtitle">{{ t('auth.signInSubtitle') }}</p>
      </div>

      <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
      <div v-else-if="resetSent" class="alert alert-info" role="status">
        {{ t('auth.resetSent') }}
      </div>

      <div class="field">
        <label class="field-label" for="login-email">{{ t('auth.email') }}</label>
        <input
          id="login-email"
          v-model="email"
          class="input"
          type="email"
          autocomplete="username"
          inputmode="email"
          required
          :disabled="busy"
        />
      </div>

      <div class="field">
        <label class="field-label" for="login-password">{{ t('auth.password') }}</label>
        <input
          id="login-password"
          v-model="password"
          class="input"
          type="password"
          autocomplete="current-password"
          required
          :disabled="busy"
        />
      </div>

      <button type="submit" class="btn btn-primary btn-lg btn-block" :disabled="busy">
        <span v-if="busy" class="spinner" />
        {{ busy ? t('auth.signingIn') : t('auth.signIn') }}
      </button>

      <button type="button" class="link-button" :disabled="busy" @click="requestReset">
        {{ t('auth.forgotPassword') }}
      </button>
    </form>

    <template #below>
      <p class="muted auth-alt">
        {{ t('auth.noAccount') }}
        <RouterLink to="/register">{{ t('auth.register') }}</RouterLink>
      </p>
    </template>
  </AuthShell>
</template>

<style scoped>
.form-title {
  font-size: var(--text-xl);
  font-weight: 650;
  letter-spacing: -0.02em;
}

.form-subtitle {
  font-size: var(--text-sm);
  margin-top: var(--space-1);
}

.link-button {
  align-self: center;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  padding: var(--space-1);
  border-radius: var(--radius-sm);
}

.link-button:hover {
  color: var(--text-brand);
}

.auth-alt {
  text-align: center;
  font-size: var(--text-sm);
}
</style>
