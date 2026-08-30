<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import AuthShell from '@/layouts/AuthShell.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()

async function leave(): Promise<void> {
  await auth.signOut()
  await router.replace('/login')
}
</script>

<template>
  <AuthShell>
    <div class="stack pending">
      <span class="pending-icon"><AppIcon name="clock" :size="22" /></span>

      <div>
        <h1 class="pending-title">{{ t('auth.pendingTitle') }}</h1>
        <p class="muted pending-text">{{ t('auth.pendingMessage') }}</p>
      </div>

      <p class="tertiary pending-hint">{{ t('auth.pendingHint') }}</p>

      <button type="button" class="btn btn-secondary btn-block" @click="leave">
        {{ t('nav.signOut') }}
      </button>
    </div>
  </AuthShell>
</template>

<style scoped>
.pending {
  align-items: center;
  text-align: center;
}

.pending-icon {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: var(--radius-full);
  background: var(--warn-bg);
  border: 1px solid var(--warn-border);
  color: var(--warn-500);
}

.pending-title {
  font-size: var(--text-lg);
  font-weight: 650;
}

.pending-text {
  font-size: var(--text-sm);
  margin-top: var(--space-2);
  line-height: var(--leading-relaxed);
}

.pending-hint {
  font-size: var(--text-xs);
}
</style>
