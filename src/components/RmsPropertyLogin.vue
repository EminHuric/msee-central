<script setup lang="ts">
/**
 * The login for one property's reservation system.
 *
 * EACH PROPERTY HAS ITS OWN ACCOUNT over there, so each has its own login here.
 * Reading a property as the account that owns it is the correct authorisation —
 * MsEe Central sees exactly what that owner sees and nothing about any other
 * client.
 *
 * ASKED ONCE PER DEVICE. A password that works is remembered in this browser, so
 * the next visit connects on its own. It is never written to our database: a
 * client's password belongs to the client, and in a shared document every
 * employee with `staybrain.view` could read it. See `lib/rmsAccounts.ts` for the
 * full reasoning and for what "remembered" does and does not protect.
 *
 * THE EMAIL IS NOT A SECRET and lives on the listing, which is why it is shown
 * here rather than typed: it says which account this property is linked to, and
 * getting it wrong would link a property to the wrong client's calendar.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import { forgetRmsLogin, remembersRmsLogin } from '@/lib/rmsAccounts'
import { rmsSession } from '@/lib/rms'

const props = defineProps<{
  /** The account this property is linked to. Empty when it is not linked yet. */
  email: string
  /** Set when a connection has been tried and refused. */
  problem?: string
  busy?: boolean
}>()

const emit = defineEmits<{ connect: [login: { email: string; password: string }]; forget: [] }>()

const { t } = useI18n()

const email = ref(props.email)
const password = ref('')
const open = ref(false)

/**
 * Connected, and nothing stronger.
 *
 * Whether this session can read this particular property is answered by the read
 * itself, not guessed from which account it is: an administrator login reads
 * every property, so comparing emails would call a working connection broken.
 */
const connected = computed(() => rmsSession.value !== null)

const remembered = computed(() => remembersRmsLogin(props.email))

function submit(): void {
  if (!email.value.trim() || !password.value) return
  emit('connect', { email: email.value.trim(), password: password.value })
  /* Cleared the moment it leaves this component. */
  password.value = ''
  open.value = false
}

function forget(): void {
  forgetRmsLogin(email.value || props.email)
  emit('forget')
}
</script>

<template>
  <section class="login" :class="{ live: connected }">
    <div class="state">
      <AppIcon :name="connected ? 'check' : 'lock'" :size="15" />
      <div>
        <p class="title">
          {{ connected ? t('rms.propertyLive') : t('rms.propertyLocked') }}
        </p>
        <p class="hint">
          <template v-if="connected">
            {{ t('rms.propertyLiveHint', { email: rmsSession?.email ?? '' }) }}
          </template>
          <template v-else>{{ t('rms.signInToRead') }}</template>
        </p>
        <p v-if="props.problem" class="problem">{{ props.problem }}</p>
      </div>
    </div>

    <div class="actions">
      <button
        v-if="connected && remembered"
        class="btn btn-ghost btn-sm"
        :title="t('rms.forgetHint')"
        @click="forget"
      >
        {{ t('rms.forget') }}
      </button>
      <button
        v-else-if="!connected && !open"
        class="btn btn-secondary btn-sm"
        :disabled="props.busy"
        @click="open = true"
      >
        {{ t('rms.connect') }}
      </button>
    </div>

    <form v-if="open && !connected" class="form" @submit.prevent="submit">
      <div class="field">
        <label class="field-label" for="prop-email">{{ t('rms.email') }}</label>
        <!--
          Editable, and filled in with the property's own account.

          Either login reads this property: the account that owns it, or an
          administrator account on the platform. Locking this field to the first
          shut out the second, which is the one the platform's owner actually has.
        -->
        <input
          id="prop-email"
          v-model="email"
          class="input"
          type="email"
          autocomplete="off"
        />
      </div>

      <div class="field">
        <label class="field-label" for="prop-password">{{ t('rms.password') }}</label>
        <input
          id="prop-password"
          v-model="password"
          class="input"
          type="password"
          autocomplete="off"
        />
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-ghost btn-sm" @click="open = false">
          {{ t('common.cancel') }}
        </button>
        <button type="submit" class="btn btn-primary btn-sm" :disabled="props.busy">
          <span v-if="props.busy" class="spinner" />
          {{ t('rms.connect') }}
        </button>
      </div>

      <p class="field-hint">{{ t('rms.rememberedHere') }}</p>
    </form>
  </section>
</template>

<style scoped>
.login {
  align-items: center;
  background: var(--warn-bg);
  border: 1px solid var(--warn-border);
  border-radius: var(--radius-lg);
  display: grid;
  gap: var(--space-3);
  grid-template-columns: 1fr auto;
  padding: var(--space-3) var(--space-4);
}

.login.live {
  background: var(--ok-bg);
  border-color: var(--ok-border);
}

.state {
  align-items: flex-start;
  display: flex;
  gap: var(--space-2);
}

.title {
  font-size: var(--text-sm);
  font-weight: 600;
  margin: 0;
}

.hint {
  color: var(--text-secondary);
  font-size: var(--text-xs);
  margin: 0;
}

.problem {
  color: var(--danger-500);
  font-size: var(--text-xs);
  margin: 2px 0 0;
}

.actions {
  display: flex;
  gap: var(--space-2);
}

.form {
  display: grid;
  gap: var(--space-3);
  grid-column: 1 / -1;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.account {
  font-size: var(--text-sm);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.form-actions {
  align-items: flex-end;
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

.form .field-hint {
  grid-column: 1 / -1;
}

@media (max-width: 560px) {
  .login {
    grid-template-columns: 1fr;
  }

  .actions {
    justify-content: flex-start;
  }
}
</style>
