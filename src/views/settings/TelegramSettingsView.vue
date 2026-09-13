<script setup lang="ts">
/**
 * Telegram, on a page of its own.
 *
 * WHY NOT A SECTION INSIDE NOTIFICATIONS, WHICH IS WHERE IT WAS. It made that
 * page render black and I could not find the fault by reading — the build
 * compiles, the labels exist, the imports resolve. So this is the same feature
 * rebuilt with the plainest bindings I can write and given its own route, where
 * the worst it can do is break itself. A settings page somebody needs should not
 * be at the mercy of a feature they have not switched on.
 *
 * WHAT IT SENDS. Everything the bell shows: a sale, a payment, a cost, a new
 * client, bookings collected, a cancellation, a debt gone unpaid too long.
 *
 * WHERE THE TOKEN LIVES. In the company's settings, in a document only an owner
 * can read — never in the code and never in this repository, which is public.
 */

import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import {
  fetchTelegramSettings,
  forgetTelegramCache,
  saveTelegramSettings,
  sendToTelegram,
} from '@/api/telegram'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const { t } = useI18n()

/*
 * Three plain refs rather than one object.
 *
 * Nothing is bound to a nested property, which keeps every binding in the
 * template as simple as a binding can be — and simple bindings are the ones that
 * cannot surprise anybody at render time.
 */
const botToken = ref('')
const chatId = ref('')
const relayUrl = ref('')
const enabled = ref(false)

const busy = ref(false)
const result = ref('')
const good = ref(false)

async function load(): Promise<void> {
  const saved = await fetchTelegramSettings()
  botToken.value = saved.botToken
  chatId.value = saved.chatId
  relayUrl.value = saved.relayUrl
  enabled.value = saved.enabled
}

function current() {
  return {
    botToken: botToken.value,
    chatId: chatId.value,
    relayUrl: relayUrl.value,
    enabled: enabled.value,
  }
}

async function save(): Promise<void> {
  busy.value = true
  result.value = ''
  try {
    await saveTelegramSettings(current())
    /* Or the next message would still go to the old address. */
    forgetTelegramCache()
    ui.notify('ok', t('common.saved'))
  } catch {
    ui.notify('danger', t('errors.generic'))
  } finally {
    busy.value = false
  }
}

/**
 * Send one now, and say exactly what came back.
 *
 * Telegram's own words rather than "could not send": "chat not found" and "Unauthorized"
 * point at two different steps, and collapsing them leaves somebody guessing
 * which of four things went wrong.
 */
async function test(): Promise<void> {
  busy.value = true
  result.value = ''
  try {
    await saveTelegramSettings(current())
    forgetTelegramCache()

    const sent = await sendToTelegram(t('telegram.testMessage'), current())
    good.value = sent.ok
    result.value = sent.ok
      ? t('telegram.testSent')
      : t('telegram.testFailed', { reason: sent.error ?? '' })
  } catch (error) {
    good.value = false
    result.value = t('telegram.testFailed', { reason: (error as Error).message })
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  /* Never awaited into the mount: a failed read must not stop the page drawing. */
  void load().catch(() => undefined)
})
</script>

<template>
  <div class="stack">
    <section class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">{{ t('telegram.title') }}</h2>
          <p class="field-hint">{{ t('telegram.subtitle') }}</p>
        </div>
      </div>

      <div class="card-body stack">
        <ol class="steps">
          <li>{{ t('telegram.step1') }}</li>
          <li>{{ t('telegram.step2') }}</li>
          <li>{{ t('telegram.step3') }}</li>
          <li>{{ t('telegram.step4') }}</li>
        </ol>

        <div class="field">
          <label class="field-label" for="tg-token">{{ t('telegram.botToken') }}</label>
          <input id="tg-token" v-model="botToken" class="input" autocomplete="off" />
        </div>

        <div class="field">
          <label class="field-label" for="tg-chat">{{ t('telegram.chatId') }}</label>
          <input id="tg-chat" v-model="chatId" class="input" autocomplete="off" />
        </div>

        <label class="check">
          <input v-model="enabled" type="checkbox" />
          <span>{{ t('telegram.enabled') }}</span>
        </label>

        <p class="field-hint">{{ t('telegram.whoCanRead') }}</p>

        <p v-if="result" class="field-hint">{{ result }}</p>

        <div class="actions">
          <button class="btn btn-secondary" :disabled="busy" @click="test">
            <AppIcon name="send" :size="15" />
            {{ t('telegram.test') }}
          </button>
          <button class="btn btn-primary" :disabled="busy" @click="save">
            {{ t('common.save') }}
          </button>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-body stack">
        <h3 class="card-title">{{ t('telegram.advanced') }}</h3>
        <p class="field-hint">{{ t('telegram.relayHint') }}</p>

        <div class="field">
          <label class="field-label" for="tg-relay">{{ t('telegram.relayUrl') }}</label>
          <input
            id="tg-relay"
            v-model="relayUrl"
            class="input"
            placeholder="https://something.workers.dev"
          />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.steps {
  color: var(--text-secondary);
  display: grid;
  font-size: var(--text-sm);
  gap: 4px;
  margin: 0;
  padding-left: 1.2rem;
}

.actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
</style>
