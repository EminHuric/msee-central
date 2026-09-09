<script setup lang="ts">
/**
 * Horizontal bars for a ranking — revenue by client, by service, by person.
 *
 * Horizontal because the labels are names, and names read left to right; a
 * vertical bar chart of names either rotates them or truncates them, and both
 * are worse than turning the chart.
 *
 * One measure, so one hue rather than a categorical set: colour here would be
 * decoration, and the length of the bar already carries the whole message.
 * Every bar is directly labelled, which is what lets the axis disappear.
 */

import { computed } from 'vue'

export interface RankRow {
  key: string
  label: string
  value: number
  /** Optional secondary figure, printed small beside the value. */
  detail?: string
}

const props = withDefaults(
  defineProps<{
    rows: RankRow[]
    format?: (value: number) => string
    /** Rows beyond this are folded into one "other" row rather than dropped. */
    limit?: number
    otherLabel?: string
  }>(),
  { limit: 8, format: (v: number) => String(v), otherLabel: '…' },
)

const max = computed(() => Math.max(1, ...props.rows.map((r) => Math.abs(r.value))))

/**
 * The rows to draw.
 *
 * Anything past the limit is summed into one row rather than cut, so the bars
 * still add up to the total somebody sees elsewhere on the page.
 */
const shown = computed(() => {
  if (props.rows.length <= props.limit) return props.rows

  const head = props.rows.slice(0, props.limit)
  const rest = props.rows.slice(props.limit)

  return [
    ...head,
    {
      key: '__other',
      label: props.otherLabel,
      value: rest.reduce((n, r) => n + r.value, 0),
      detail: String(rest.length),
    },
  ]
})

const total = computed(() => props.rows.reduce((n, r) => n + Math.abs(r.value), 0) || 1)

function share(value: number): number {
  return Math.round((Math.abs(value) / total.value) * 100)
}
</script>

<template>
  <ul class="rank">
    <li v-for="row in shown" :key="row.key" class="row">
      <span class="label truncate" :title="row.label">{{ row.label }}</span>

      <span class="track">
        <span
          class="bar"
          :class="{ 'is-other': row.key === '__other', 'is-negative': row.value < 0 }"
          :style="{ width: `${Math.max(2, (Math.abs(row.value) / max) * 100)}%` }"
        />
      </span>

      <span class="value">
        {{ format(row.value) }}
        <span class="share">{{ share(row.value) }}%</span>
      </span>
    </li>
  </ul>
</template>

<style scoped>
.rank { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }

.row { display: grid; grid-template-columns: minmax(90px, 150px) 1fr auto; align-items: center; gap: var(--space-3); }
@media (max-width: 560px) {
  .row { grid-template-columns: 1fr auto; }
  .track { grid-column: 1 / -1; order: 3; }
}

.label { font-size: var(--text-xs); color: var(--text-secondary); }

.track { height: 10px; border-radius: var(--radius-full); background: var(--bg-inset); overflow: hidden; }
.bar {
  display: block; height: 100%;
  /* Rounded only at the data end; the baseline end stays square. */
  border-radius: 0 var(--radius-full) var(--radius-full) 0;
  background: var(--chart-1);
  transition: width var(--dur-base) var(--ease-out);
}
.bar.is-other { background: var(--text-tertiary); }
.bar.is-negative { background: var(--danger-500); }

.value { font-size: var(--text-xs); font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; }
.share { margin-left: 6px; font-weight: 500; color: var(--text-tertiary); }
</style>
