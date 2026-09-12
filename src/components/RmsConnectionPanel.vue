<script setup lang="ts">
/**
 * The RMS session.
 *
 * WHY THERE IS A LOGIN HERE AT ALL. The RMS is a separate Firebase project, and
 * Firebase sessions do not cross projects — being signed in to MsEe Central
 * means nothing over there. There is no server of ours to hold a credential on
 * our behalf, so something has to sign in, and the honest version of that is a
 * person doing it once.
 *
 * WHAT IS STORED WHERE. Nothing from this form is written to our database. The
 * email and password go straight to Firebase Auth for the RMS project, which
 * keeps the resulting session in this browser's own storage exactly as the RMS
 * app itself does. The password is never held, never logged, and never leaves
 * this component.
 *
 * WHICH ACCOUNT. A dedicated agency account, not a person's own login and not a
 * property owner's. What it may do is fixed by the RMS's security rules: read the
 * accounts, and create or cancel bookings stamped as ours in accounts that have
 * switched access on. It cannot touch a unit, a guest, or a booking an owner
 * entered — so a leaked session is worth bookings, not the business.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import { RmsAuthError, rmsSession, rmsSignIn, rmsSignOut } from '@/lib/rms'
import { useUiStore } from '@/stores/ui'

const emit = defineEmits<{ changed: [] }>()

const ui = useUiStore()
const { t } = useI18n()

const open = ref(false)
const email = ref('')
const password = ref('')
const busy = ref(false)

/*
 * Read straight from the shared ref rather than through a prop.
 *
 * The prop was the parent's copy, refreshed only when the parent reloaded — so a
 * successful sign-in left this panel showing "not connected" until something
 * else happened. One source, reactive, no copies.
 */
const connected = computed(() => rmsSession.value !== null)

/**
 * Turn Firebase's code into a sentence that says what to do.
 *
 * `auth/invalid-credential` covers a wrong password and an account that does not
 * exist, because Firebase deliberately does not distinguish them — so neither
 * does this.
 */
function reasonFor(code: string): string {
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
    return t('rms.wrongCredentials')
  }
  if (code === 'auth/user-not-found') return t('rms.wrongCredentials')
  if (code === 'auth/too-many-requests') return t('rms.tooMany')
  if (code === 'auth/network-request-failed') return t('rms.offline')
  return t('rms.signInFailed')
}

async function connect(): Promise<void> {
  if (busy.value) return
  if (!email.value.trim() || !password.value) {
    ui.notify('danger', t('rms.needBoth'))
    return
  }

  busy.value = true
  try {
    await rmsSignIn(email.value, password.value)
    /* Cleared the moment it has been used. */
    password.value = ''
    open.value = false
    ui.notify('ok', t('rms.connected'))
    emit('changed')
  } catch (error) {
    ui.notify('danger', reasonFor(error instanceof RmsAuthError ? error.code : 'unknown'))
  } finally {
    busy.value = false
  }
}

async function disconnect(): Promise<void> {
  busy.value = true
  try {
    await rmsSignOut()
    ui.notify('ok', t('rms.disconnected'))
    emit('changed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="rms" :class="{ live: connected }">
    <div class="rms-state">
      <AppIcon :name="connected ? 'check' : 'alert'" :size="15" />
      <div>
        <p class="rms-title">
          {{ connected ? t('rms.live') : t('rms.notConnected') }}
        </p>
        <p class="rms-hint">
          {{ connected
            ? t('rms.liveHint', { email: rmsSession?.email ?? '' })
            : t('rms.notConnectedHint') }}
        </p>
      </div>
    </div>

    <div class="rms-actions">
      <button v-if="connected" class="btn btn-ghost btn-sm" :disabled="busy" @click="disconnect">
        {{ t('rms.disconnect') }}
      </button>
      <button v-else-if="!open" class="btn btn-secondary btn-sm" @click="open = true">
        {{ t('rms.connect') }}
      </button>
    </div>

    <form v-if="open && !connected" class="rms-form" @submit.prevent="connect">
      <div class="field">
        <label class="field-label" for="rms-email">{{ t('rms.email') }}</label>
        <input
          id="rms-email"
          v-model="email"
          class="input"
          type="email"
          autocomplete="off"
          :placeholder="t('rms.emailPlaceholder')"
        />
      </div>

      <div class="field">
        <label class="field-label" for="rms-password">{{ t('rms.password') }}</label>
        <!--
          autocomplete off, deliberately: this is not the password of the person
          at the keyboard, and offering to save it in their own password manager
          under this site's name would be wrong.
        -->
        <input
          id="rms-password"
          v-model="password"
          class="input"
          type="password"
          autocomplete="off"
        />
      </div>

      <div class="rms-form-actions">
        <button type="button" class="btn btn-ghost btn-sm" @click="open = false">
          {{ t('common.cancel') }}
        </button>
        <button type="submit" class="btn btn-primary btn-sm" :disabled="busy">
          <span v-if="busy" class="spinner" />
          {{ t('rms.connect') }}
        </button>
      </div>

      <p class="field-hint">{{ t('rms.whatItCanDo') }}</p>
    </form>
  </section>
</template>

<style scoped>
.rms {
  align-items: center;
  background: var(--warn-bg);
  border: 1px solid var(--warn-border);
  border-radius: var(--radius-lg);
  display: grid;
  gap: var(--space-3);
  grid-template-columns: 1fr auto;
  padding: var(--space-3) var(--space-4);
}

.rms.live {
  background: var(--ok-bg);
  border-color: var(--ok-border);
}

.rms-state {
  align-items: flex-start;
  display: flex;
  gap: var(--space-2);
}

.rms-title {
  font-size: var(--text-sm);
  font-weight: 600;
  margin: 0;
}

.rms-hint {
  color: var(--text-secondary);
  font-size: var(--text-xs);
  margin: 0;
}

.rms-actions {
  display: flex;
  gap: var(--space-2);
}

.rms-form {
  display: grid;
  gap: var(--space-3);
  grid-column: 1 / -1;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.rms-form-actions {
  align-items: flex-end;
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

.rms-form .field-hint {
  grid-column: 1 / -1;
}

@media (max-width: 560px) {
  .rms {
    grid-template-columns: 1fr;
  }

  .rms-actions {
    justify-content: flex-start;
  }
}
</style>
