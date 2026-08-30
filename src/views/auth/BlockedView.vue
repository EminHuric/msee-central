<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import AuthShell from '@/layouts/AuthShell.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()

const message = computed(() => {
  switch (auth.state) {
    case 'rejected':
      return t('auth.rejectedMessage')
    default:
      break
  }

  switch (auth.status) {
    case 'suspended':
      return t('auth.suspendedMessage')
    case 'deactivated':
      return t('auth.deactivatedMessage')
    default:
      return t('errors.forbidden')
  }
})

/** A rejection reason is shown only when the CEO chose to give one. */
const reason = computed(() => auth.request?.rejectionReason ?? null)

async function leave(): Promise<void> {
  await auth.signOut()
  await router.replace('/login')
}
</script>

<template>
  <AuthShell>
    <div class="stack blocked">
      <span class="blocked-icon"><AppIcon name="lock" :size="22" /></span>

      <div>
        <h1 class="blocked-title">{{ t('auth.blockedTitle') }}</h1>
        <p class="muted blocked-text">{{ message }}</p>
      </div>

      <div v-if="reason" class="alert alert-warn reason">
        <span>
          <strong>{{ t('auth.rejectionReason') }}:</strong>
          {{ reason }}
        </span>
      </div>

      <button type="button" class="btn btn-secondary btn-block" @click="leave">
        {{ t('nav.signOut') }}
      </button>
    </div>
  </AuthShell>
</template>

<style scoped>
.blocked {
  align-items: center;
  text-align: center;
}

.blocked-icon {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: var(--radius-full);
  background: var(--danger-bg);
  border: 1px solid var(--danger-border);
  color: var(--danger-500);
}

.blocked-title {
  font-size: var(--text-lg);
  font-weight: 650;
}

.blocked-text {
  font-size: var(--text-sm);
  margin-top: var(--space-2);
  line-height: var(--leading-relaxed);
}

.reason {
  text-align: left;
  width: 100%;
}
</style>
