<script setup lang="ts">
/**
 * One chart that answers "how is the business going?"
 *
 * Six metrics, each switchable, with the comparison against the period before
 * shown beside each one.
 *
 * WHY THERE ARE TWO GROUPS RATHER THAN TWO AXES. Revenue is money; clients is
 * a count of people. Drawn against one scale, forty clients is a flat line
 * along the bottom of a chart whose top is eight thousand euro. The usual
 * escape is a second y-axis, and it is worse: with two scales the author
 * chooses where the lines cross, so the picture can be made to show a
 * relationship that is not in the data. That makes it a drawing, not a
 * measurement.
 *
 * So the metrics are grouped by what they are — money, or activity — and the
 * chart shows one group at a time against one honest axis. Switching group is
 * one click, and nothing is hidden.
 *
 * Colour follows the metric and never its position: revenue is the same green
 * whether it is alone or one of three. The steps are in `tokens.css` and were
 * checked with a palette validator rather than by eye — lightness band, chroma
 * floor, colour-blind separation and contrast, in both themes.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import TimeChart, { type Series } from '@/components/ui/TimeChart.vue'

export type MetricKey =
  | 'revenue'
  | 'expenses'
  | 'profit'
  | 'clients'
  | 'leads'
  | 'sales'

export interface MetricInput {
  key: MetricKey
  /** One value per point, in the order of `labels`. */
  values: number[]
  /** The same measure over the period before, for the comparison. */
  previousTotal: number
  total: number
}

const props = defineProps<{
  labels: string[]
  metrics: MetricInput[]
  /** Formats money; counts are rendered as plain numbers. */
  money: (minor: number) => string
}>()

const { t } = useI18n()

/** Which group each metric belongs to, and therefore which scale it shares. */
const GROUPS = {
  financial: ['revenue', 'expenses', 'profit'] as MetricKey[],
  activity: ['clients', 'leads', 'sales'] as MetricKey[],
}

type Group = keyof typeof GROUPS

const group = ref<Group>('financial')

/** Metrics switched on. Starts as everything in the chosen group. */
const enabled = ref<Set<MetricKey>>(new Set([...GROUPS.financial, ...GROUPS.activity]))

const isMoney = (key: MetricKey) => GROUPS.financial.includes(key)

const inGroup = computed(() =>
  props.metrics.filter((m) => GROUPS[group.value].includes(m.key)),
)

const shown = computed(() => inGroup.value.filter((m) => enabled.value.has(m.key)))

const series = computed<Series[]>(() =>
  shown.value.map((m) => ({
    key: m.key,
    label: t(`metric.${m.key}`),
    values: m.values,
    color: `var(--metric-${m.key})`,
  })),
)

function toggle(key: MetricKey): void {
  const next = new Set(enabled.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  /* Never leave the chart with nothing on it. */
  if (GROUPS[group.value].some((k) => next.has(k))) enabled.value = next
}

function format(value: number): string {
  return group.value === 'financial' ? props.money(value) : String(Math.round(value))
}

function display(m: MetricInput): string {
  return isMoney(m.key) ? props.money(m.total) : String(Math.round(m.total))
}

/**
 * Change against the period before, as a percentage.
 *
 * Returns null when there is nothing to compare against — a first month has no
 * previous month, and "+100%" would be an invention rather than a measurement.
 */
function change(m: MetricInput): number | null {
  if (!m.previousTotal) return null
  return Math.round(((m.total - m.previousTotal) / Math.abs(m.previousTotal)) * 100)
}

/**
 * Whether a rise is good news.
 *
 * Everything here improves by going up except expenses, and colouring a 20%
 * rise in costs green would be actively misleading.
 */
function isGood(m: MetricInput, delta: number): boolean {
  return m.key === 'expenses' ? delta < 0 : delta > 0
}
</script>

<template>
  <section class="card overview">
    <div class="card-header overview-head">
      <h2 class="card-title">{{ t('overview.title') }}</h2>

      <!-- Money, or activity. See the note on why this is not two axes. -->
      <div class="group-switch" role="group" :aria-label="t('overview.group')">
        <button
          v-for="key in (['financial', 'activity'] as const)"
          :key="key"
          type="button"
          class="group-option"
          :class="{ 'is-active': group === key }"
          @click="group = key"
        >
          {{ t(`overview.${key}`) }}
        </button>
      </div>
    </div>

    <!-- Each metric: its total, its change, and a switch. -->
    <div class="figures">
      <button
        v-for="m in inGroup"
        :key="m.key"
        type="button"
        class="figure"
        :class="{ 'is-off': !enabled.has(m.key) }"
        :aria-pressed="enabled.has(m.key)"
        @click="toggle(m.key)"
      >
        <span class="figure-head">
          <span class="dot" :style="{ background: `var(--metric-${m.key})` }" />
          <span class="figure-label">{{ t(`metric.${m.key}`) }}</span>
        </span>

        <span class="figure-value">{{ display(m) }}</span>

        <span
          v-if="change(m) !== null"
          class="figure-delta"
          :class="isGood(m, change(m) as number) ? 'pos' : 'neg'"
        >
          <AppIcon :name="(change(m) as number) >= 0 ? 'arrowUp' : 'arrowDown'" :size="12" />
          {{ Math.abs(change(m) as number) }}%
          <span class="figure-versus">{{ t('overview.versusPrevious') }}</span>
        </span>

        <!-- No previous period is a fact, not a zero. -->
        <span v-else class="figure-delta tertiary">{{ t('overview.noComparison') }}</span>
      </button>
    </div>

    <div class="card-body plot-body">
      <TimeChart :labels="labels" :series="series" :format="format" :height="260" :area="false" />
    </div>
  </section>
</template>

<style scoped>
.overview-head {
  flex-wrap: wrap;
  gap: var(--space-3);
}

.group-switch {
  display: inline-flex;
  padding: 2px;
  border-radius: var(--radius-md);
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
}

.group-option {
  padding: var(--space-2) var(--space-4);
  border-radius: calc(var(--radius-md) - 2px);
  font-size: var(--text-sm);
  font-weight: 550;
  color: var(--text-secondary);
}

.group-option.is-active {
  background: var(--bg-surface);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

.figures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1px;
  background: var(--border-subtle);
  border-bottom: 1px solid var(--border-subtle);
}

.figure {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  align-items: flex-start;
  padding: var(--space-4) var(--space-5);
  background: var(--bg-surface);
  text-align: left;
}

.figure:hover { background: var(--bg-hover); }

/* Switched off: dimmed, never hidden — you can still read what you turned off. */
.figure.is-off { opacity: 0.45; }
.figure.is-off .figure-value { text-decoration: line-through; }

.figure-head {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.figure-label {
  font-size: var(--text-xs);
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
}

.figure-value {
  font-size: var(--text-xl);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.figure-delta {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--text-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.figure-delta.pos { color: var(--ok-500); }
.figure-delta.neg { color: var(--danger-500); }

.figure-versus {
  font-weight: 500;
  color: var(--text-tertiary);
}

.plot-body { padding: var(--space-5) var(--space-4) var(--space-4); }

@media (max-width: 640px) {
  .figures { grid-template-columns: repeat(2, 1fr); }
  .figure { padding: var(--space-3) var(--space-4); }
  .figure-value { font-size: var(--text-lg); }
  /* The comparison caption is the first thing to go when space is tight. */
  .figure-versus { display: none; }
}
</style>
