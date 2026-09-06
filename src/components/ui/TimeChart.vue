<script setup lang="ts">
/**
 * A line chart over time, for one to four series.
 *
 * One y-axis, always. Two measures on different scales get two charts, never
 * a second axis — a dual-axis chart lets the author choose where the lines
 * cross, which makes it a drawing rather than a measurement.
 *
 * Series colours come from the fixed categorical order in tokens.css and are
 * assigned by index, never cycled: hiding a series must not repaint the ones
 * left behind.
 *
 * Drawn as inline SVG with a viewBox, so it scales with its container and the
 * page ships no charting library.
 */

import { computed, ref } from 'vue'

export interface Series {
  key: string
  label: string
  /** One value per point, same length as `labels`. */
  values: number[]
}

const props = withDefaults(
  defineProps<{
    labels: string[]
    series: Series[]
    /** Turns a raw value into the text shown in the tooltip and on the axis. */
    format?: (value: number) => string
    height?: number
    /** Fill under a single series. Off for multiples, where fills overlap. */
    area?: boolean
  }>(),
  { height: 200, area: true, format: (v: number) => String(v) },
)

/* A fixed viewBox: the SVG scales, the stroke widths do not distort. */
const W = 640
const PAD_L = 8
const PAD_R = 8
const PAD_T = 12
const PAD_B = 22

const height = computed(() => props.height)
const plotH = computed(() => height.value - PAD_T - PAD_B)

const hover = ref<number | null>(null)

/** The largest value across every series, so all lines share one scale. */
const max = computed(() => {
  const all = props.series.flatMap((s) => s.values)
  return Math.max(1, ...all)
})

const stepX = computed(() =>
  props.labels.length > 1 ? (W - PAD_L - PAD_R) / (props.labels.length - 1) : 0,
)

function x(i: number): number {
  return PAD_L + i * stepX.value
}

function y(value: number): number {
  return PAD_T + plotH.value * (1 - value / max.value)
}

function linePath(values: number[]): string {
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
}

function areaPath(values: number[]): string {
  if (values.length === 0) return ''
  const base = PAD_T + plotH.value
  return `${linePath(values)} L${x(values.length - 1).toFixed(1)} ${base} L${x(0).toFixed(1)} ${base} Z`
}

/** Four recessive gridlines. Enough to read a level, not enough to compete. */
const gridLines = computed(() => [0, 0.25, 0.5, 0.75, 1].map((f) => PAD_T + plotH.value * f))

const hasData = computed(() => props.series.some((s) => s.values.some((v) => v !== 0)))

/** Which point the pointer is nearest, so the whole column highlights. */
function onMove(event: MouseEvent): void {
  const box = (event.currentTarget as SVGElement).getBoundingClientRect()
  const ratio = (event.clientX - box.left) / box.width
  hover.value = Math.max(0, Math.min(props.labels.length - 1, Math.round(ratio * (props.labels.length - 1))))
}
</script>

<template>
  <div class="chart">
    <!-- Legend: always present for two or more series, never for one. -->
    <div v-if="series.length > 1" class="legend">
      <span v-for="(s, i) in series" :key="s.key" class="legend-item">
        <span class="swatch" :style="{ background: `var(--chart-${i + 1})` }" />
        {{ s.label }}
      </span>
    </div>

    <svg
      :viewBox="`0 0 ${W} ${height}`"
      preserveAspectRatio="none"
      class="plot"
      :style="{ height: `${height}px` }"
      role="img"
      @mousemove="onMove"
      @mouseleave="hover = null"
    >
      <line
        v-for="(gy, i) in gridLines"
        :key="i"
        :x1="0"
        :x2="W"
        :y1="gy"
        :y2="gy"
        class="grid"
      />

      <template v-if="hasData">
        <template v-for="(s, i) in series" :key="s.key">
          <path
            v-if="area && series.length === 1"
            :d="areaPath(s.values)"
            :fill="`var(--chart-${i + 1})`"
            fill-opacity="0.12"
            stroke="none"
          />
          <path
            :d="linePath(s.values)"
            fill="none"
            :stroke="`var(--chart-${i + 1})`"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          />
        </template>

        <!-- Crosshair: one column, every series read at once. -->
        <template v-if="hover !== null">
          <line
            :x1="x(hover)"
            :x2="x(hover)"
            :y1="PAD_T"
            :y2="PAD_T + plotH"
            class="crosshair"
          />
          <circle
            v-for="(s, i) in series"
            :key="`p-${s.key}`"
            :cx="x(hover)"
            :cy="y(s.values[hover] ?? 0)"
            r="4"
            :fill="`var(--chart-${i + 1})`"
            class="marker"
          />
        </template>
      </template>
    </svg>

    <div class="axis">
      <span v-for="(label, i) in labels" :key="label" :class="{ 'is-on': hover === i }">
        {{ label }}
      </span>
    </div>

    <!-- Tooltip below the plot rather than floating, so it never clips. -->
    <div v-if="hover !== null && hasData" class="tip">
      <span class="tip-label">{{ labels[hover] }}</span>
      <span v-for="(s, i) in series" :key="`t-${s.key}`" class="tip-row">
        <span class="swatch" :style="{ background: `var(--chart-${i + 1})` }" />
        <span class="tip-name">{{ s.label }}</span>
        <span class="tip-value">{{ format(s.values[hover] ?? 0) }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.chart { display: flex; flex-direction: column; gap: var(--space-2); }

.legend { display: flex; flex-wrap: wrap; gap: var(--space-4); }
.legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: var(--text-xs); color: var(--text-secondary); }
.swatch { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }

.plot { width: 100%; display: block; cursor: crosshair; }
.grid { stroke: var(--chart-grid); stroke-width: 1; vector-effect: non-scaling-stroke; }
.crosshair { stroke: var(--chart-axis); stroke-width: 1; stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
.marker { stroke: var(--bg-surface); stroke-width: 2; }

.axis { display: flex; justify-content: space-between; font-size: 10px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
.axis .is-on { color: var(--text-primary); font-weight: 650; }

.tip {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
  background: var(--bg-inset);
}
.tip-label { font-size: var(--text-xs); font-weight: 650; }
.tip-row { display: inline-flex; align-items: center; gap: 5px; font-size: var(--text-xs); }
.tip-name { color: var(--text-secondary); }
.tip-value { font-weight: 650; font-variant-numeric: tabular-nums; }
</style>
