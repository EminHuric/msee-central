<script setup lang="ts">
/** Centred card used by every signed-out screen. */

import BrandLogo from '@/components/BrandLogo.vue'
import LanguageSwitcher from '@/components/ui/LanguageSwitcher.vue'

withDefaults(defineProps<{ wide?: boolean }>(), { wide: false })
</script>

<template>
  <div class="auth">
    <div class="auth-corner">
      <LanguageSwitcher />
    </div>

    <div class="auth-inner" :class="{ 'is-wide': wide }">
      <div class="auth-brand">
        <BrandLogo :size="54" glow />
        <p class="auth-app">MsEe Central</p>
      </div>

      <div class="card auth-card">
        <slot />
      </div>

      <slot name="below" />
    </div>
  </div>
</template>

<style scoped>
.auth {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding: var(--space-6) var(--space-4) var(--space-12);
  background:
    radial-gradient(ellipse 70% 55% at 50% -10%, var(--accent-soft-bg), transparent 70%),
    var(--bg-base);
}

.auth-corner {
  position: fixed;
  top: var(--space-5);
  right: var(--space-5);
  z-index: var(--z-sticky);
}

.auth-inner {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.auth-inner.is-wide {
  max-width: 720px;
}

.auth-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}

.auth-app {
  font-size: var(--text-lg);
  font-weight: 650;
  letter-spacing: -0.02em;
}

.auth-card {
  padding: var(--space-8);
  box-shadow: var(--shadow-lg);
}

@media (max-width: 640px) {
  .auth-card {
    padding: var(--space-6);
  }

  .auth-corner {
    top: var(--space-4);
    right: var(--space-4);
  }
}
</style>
