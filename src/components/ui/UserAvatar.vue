<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    photoUrl?: string | null
    size?: number
  }>(),
  { photoUrl: null, size: 36 },
)

const initials = computed(() => {
  const parts = props.name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
})

/**
 * Deterministic hue from the name, so the same person keeps the same colour
 * everywhere without storing anything.
 */
const hue = computed(() => {
  let hash = 0
  for (let i = 0; i < props.name.length; i++) {
    hash = (hash * 31 + props.name.charCodeAt(i)) % 360
  }
  return hash
})
</script>

<template>
  <img
    v-if="photoUrl"
    :src="photoUrl"
    :alt="name"
    :width="size"
    :height="size"
    class="avatar avatar-img"
    loading="lazy"
    decoding="async"
  />
  <span
    v-else
    class="avatar avatar-initials"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.max(10, size * 0.36)}px`,
      '--avatar-hue': hue,
    }"
    :title="name"
    aria-hidden="true"
  >
    {{ initials }}
  </span>
</template>

<style scoped>
.avatar {
  border-radius: var(--radius-full);
  flex-shrink: 0;
  object-fit: cover;
  border: 1px solid var(--border-default);
}

.avatar-img {
  background: var(--bg-surface-3);
}

.avatar-initials {
  display: inline-grid;
  place-items: center;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: hsl(var(--avatar-hue) 60% 88%);
  background: linear-gradient(
    145deg,
    hsl(var(--avatar-hue) 42% 28%),
    hsl(var(--avatar-hue) 38% 18%)
  );
  user-select: none;
}

:root[data-theme='light'] .avatar-initials {
  color: hsl(var(--avatar-hue) 55% 26%);
  background: linear-gradient(
    145deg,
    hsl(var(--avatar-hue) 58% 90%),
    hsl(var(--avatar-hue) 52% 82%)
  );
}
</style>
