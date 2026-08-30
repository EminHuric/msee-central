<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import type { AccountStatus } from '@/types/domain'

defineProps<{ status: AccountStatus }>()

const { t } = useI18n()
</script>

<template>
  <span class="badge" :class="`badge-${status}`">{{ t(`status.${status}`) }}</span>
</template>
