<script setup lang="ts">
/**
 * The public end of a referral link.
 *
 * Reachable without an account, because a referral link has to work for a
 * stranger. That constraint shapes everything here: the page reads nothing —
 * no affiliate name, no contact details, no commission rules — and writes one
 * document containing a code and a timestamp.
 *
 * The code is also kept in the browser, so if the visitor goes on to become a
 * lead the attribution is already there rather than depending on somebody
 * remembering to ask "who sent you".
 */

import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import BrandLogo from '@/components/BrandLogo.vue'
import { recordReferralClick } from '@/api/affiliates'

const route = useRoute()
const { t } = useI18n()

const code = ref('')
const service = ref('')
const done = ref(false)

onMounted(async () => {
  code.value = String(route.params.code ?? '').slice(0, 40)
  service.value = String(route.params.service ?? '')
  if (!code.value) return

  /* Remembered for the app, in case this visitor later becomes a lead. */
  try {
    localStorage.setItem('msee.referral', code.value)
  } catch {
    /* Private browsing, or storage disabled. The click below still counts. */
  }

  await recordReferralClick(code.value)
  done.value = true
})
</script>

<template>
  <main class="ref">
    <div class="card panel">
      <BrandLogo :size="44" />

      <h1 class="title">{{ t('referral.title') }}</h1>
      <p class="text">{{ t('referral.text') }}</p>

      <div v-if="code" class="code-row">
        <span class="code-label">{{ t('referral.yourCode') }}</span>
        <code class="code">{{ code }}</code>
      </div>

      <p v-if="service" class="text tertiary">{{ service }}</p>

      <p class="hint tertiary">{{ t('referral.hint') }}</p>

      <RouterLink to="/login" class="btn btn-primary">{{ t('referral.continue') }}</RouterLink>
    </div>
  </main>
</template>

<style scoped>
.ref {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: var(--space-6);
  background: var(--bg-base);
}

.panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  width: min(440px, 100%);
  padding: var(--space-8) var(--space-6);
  text-align: center;
}

.title { font-size: var(--text-xl); font-weight: 700; }
.text { font-size: var(--text-base); line-height: var(--leading-relaxed); color: var(--text-secondary); }
.hint { font-size: var(--text-xs); line-height: var(--leading-relaxed); }

.code-row { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); }
.code-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); }
.code {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--accent-soft-bg);
  color: var(--text-brand);
  font-family: var(--font-mono);
  font-size: var(--text-md);
  font-weight: 650;
}
</style>
