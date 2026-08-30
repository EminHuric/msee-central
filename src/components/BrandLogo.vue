<script setup lang="ts">
/**
 * The MsEe mark, drawn as vectors so it stays sharp at every size and can be
 * recoloured by the theme.
 *
 * To use the original artwork instead, drop the file at `public/logo.svg` and
 * swap this component's <svg> for <img src="/logo.svg" alt="MsEe">.
 */

withDefaults(
  defineProps<{
    /** Rendered size in pixels (the mark is square). */
    size?: number
    /** Adds the neon bloom used on the sign-in screen. */
    glow?: boolean
    /** Shows the wordmark next to the symbol. */
    withName?: boolean
  }>(),
  { size: 32, glow: false, withName: false },
)
</script>

<template>
  <span class="brand" :class="{ 'brand-glow': glow }">
    <svg
      :width="size"
      :height="size"
      viewBox="0 0 240 216"
      fill="none"
      role="img"
      aria-label="MsEe"
      class="brand-mark"
    >
      <g
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      >
        <!-- Outer shell: a circle squared off into a sharp top-right corner. -->
        <path
          d="M 108 16 H 198 A 10 10 0 0 1 208 26 V 116 A 100 100 0 1 1 108 16 Z"
          stroke-width="11"
        />

        <!-- Inner coil, two turns tightening toward the centre. -->
        <path
          d="M 40.5 155
             A 76 76 0 0 1 43.3 78.6
             A 73 73 0 0 1 108 44.6
             A 70 70 0 0 1 167 81.9
             A 66 66 0 0 1 164.1 148.4
             A 63 63 0 0 1 108 177.5
             A 60 60 0 0 1 57.6 145.1
             A 56 56 0 0 1 60.5 88.5
             A 53 53 0 0 1 108 64.4
             A 50 50 0 0 1 149.8 91.8
             A 47 47 0 0 1 147 138.5
             A 43 43 0 0 1 108 157.7
             A 40 40 0 0 1 74.7 135.2"
          stroke-width="10"
        />

        <!-- Segment ticks bridging consecutive turns of the coil. -->
        <g stroke-width="4" opacity="0.9">
          <path d="M32.3 129.3 51.8 125.9" />
          <path d="M35.9 94 54.8 99.7" />
          <path d="M54.8 64.7 69.1 78.4" />
          <path d="M84.4 47.5 90.9 66.3" />
          <path d="M117.9 45.7 115.1 65.3" />
          <path d="M147.9 59.1 136.5 75.3" />
          <path d="M168 84.1 150.6 93.4" />
          <path d="M174.5 114.8 154.7 115.2" />
          <path d="M166.4 144.5 148.6 135.8" />
          <path d="M146.2 166.7 134.3 150.9" />
          <path d="M118.8 177.2 115.3 157.7" />
          <path d="M90.3 173.9 96.1 155" />
          <path d="M66.9 158.5 80.7 144.3" />
        </g>
      </g>
    </svg>

    <span v-if="withName" class="brand-name">MsEe&nbsp;Central</span>
  </span>
</template>

<style scoped>
.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--brand-500);
  flex-shrink: 0;
}

.brand-mark {
  flex-shrink: 0;
  overflow: visible;
}

.brand-glow .brand-mark {
  filter: drop-shadow(0 0 6px var(--brand-glow)) drop-shadow(0 0 18px var(--brand-glow));
}

.brand-name {
  font-size: var(--text-md);
  font-weight: 650;
  letter-spacing: -0.014em;
  color: var(--text-primary);
  white-space: nowrap;
}
</style>
