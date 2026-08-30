<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BrandLogo from '@/components/BrandLogo.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { missingFirebaseConfig } from '@/lib/firebase'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const { t } = useI18n()

const missing = computed(() => missingFirebaseConfig())
</script>

<template>
  <!-- No Firebase project connected yet: say so plainly instead of failing
       with a blank page. -->
  <div v-if="auth.state === 'unconfigured'" class="boot">
    <div class="card boot-card">
      <div class="boot-body">
        <BrandLogo :size="44" glow />
        <h1 class="boot-title">{{ t('setup.title') }}</h1>
        <p class="muted boot-text">{{ t('setup.text') }}</p>

        <div class="boot-missing">
          <p class="eyebrow">{{ t('setup.missing') }}</p>
          <ul class="boot-list">
            <li v-for="key in missing" :key="key"><code>{{ key }}</code></li>
          </ul>
        </div>

        <p class="tertiary boot-docs">{{ t('setup.docs') }}</p>
      </div>
    </div>
  </div>

  <div v-else-if="auth.state === 'loading'" class="boot">
    <div class="boot-loading">
      <BrandLogo :size="40" glow />
      <span class="sr-only">{{ t('common.loading') }}</span>
    </div>
  </div>

  <RouterView v-else />

  <ToastHost />
</template>

<style scoped>
.boot {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: var(--space-6);
  background:
    radial-gradient(ellipse 70% 55% at 50% -10%, var(--accent-soft-bg), transparent 70%),
    var(--bg-base);
}

.boot-card {
  width: 100%;
  max-width: 520px;
  box-shadow: var(--shadow-lg);
}

.boot-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-4);
  padding: var(--space-8);
}

.boot-title {
  font-size: var(--text-lg);
  font-weight: 650;
}

.boot-text {
  font-size: var(--text-sm);
  line-height: var(--leading-relaxed);
  max-width: 44ch;
}

.boot-missing {
  width: 100%;
  text-align: left;
  padding: var(--space-4);
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.boot-list {
  list-style: none;
  padding: 0;
  margin-top: var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.boot-list code {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-brand);
}

.boot-docs {
  font-size: var(--text-xs);
}

.boot-loading {
  animation: boot-pulse 1.4s var(--ease-out) infinite;
}

@keyframes boot-pulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}
</style>
