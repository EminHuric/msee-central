<script setup lang="ts">
/**
 * My Workspace.
 *
 * Answers one question: what do I need to know, and what do I need to do. The
 * dashboard is about the company; this is about the person looking at it, and
 * nothing appears here that is not theirs.
 *
 * Every list is filtered by uid rather than by permission. A manager who can
 * see every lead still sees only their own here — "all leads" is a different
 * screen, and merging the two would make this page useless to the manager.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/ui/AppIcon.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { bucketOf, setTaskStatus } from '@/api/operations'
import { fetchMyAffiliate } from '@/api/affiliates'
import { buildCalendar } from '@/api/company'
import { EMPTY_SNAPSHOT, goalProgress, kpisFor, loadSnapshot, periodOf, type Snapshot } from '@/api/metrics'
import { formatDate } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { OPEN_STAGES } from '@/types/business'
import type { Task } from '@/types/business'
import { DEFAULT_KPIS, MONEY_KPIS, type KpiMetric } from '@/types/company'
import { BASE_CURRENCY, formatMoney } from '@/types/money'
import type { Affiliate } from '@/types/revenue'

const auth = useAuthStore()
const router = useRouter()
const { t, locale } = useI18n()

const loading = ref(true)
const snap = ref<Snapshot>(EMPTY_SNAPSHOT)
const affiliate = ref<Affiliate | null>(null)

const today = new Date().toISOString().slice(0, 10)
const uid = computed(() => auth.uid ?? '')

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

/* ---- What is mine ---------------------------------------------------- */

const myTasks = computed(() =>
  snap.value.tasks
    .filter((task) => task.assigneeUid === uid.value && task.status !== 'cancelled')
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')),
)

const taskGroups = computed(() => ({
  late: myTasks.value.filter((t1) => bucketOf(t1, today) === 'overdue'),
  today: myTasks.value.filter((t1) => bucketOf(t1, today) === 'today'),
  week: myTasks.value.filter((t1) => bucketOf(t1, today) === 'week'),
}))

const myLeads = computed(() =>
  snap.value.leads
    .filter((l) => l.assigneeUid === uid.value && OPEN_STAGES.includes(l.stage))
    .sort((a, b) => (a.nextContactDate ?? '9999').localeCompare(b.nextContactDate ?? '9999')),
)

const mySales = computed(() =>
  snap.value.sales
    .filter((s) => s.ownerUid === uid.value && s.stage !== 'lost')
    .sort((a, b) => b.value.baseMinor - a.value.baseMinor),
)

const myProjects = computed(() =>
  snap.value.projects.filter(
    (p) => (p.ownerUid === uid.value || p.teamUids?.includes(uid.value)) && p.status === 'active',
  ),
)

const myClients = computed(() => {
  const ids = new Set([
    ...myProjects.value.map((p) => p.clientId),
    ...mySales.value.map((s) => s.clientId).filter(Boolean),
  ])
  return snap.value.clients.filter((c) => ids.has(c.id))
})

const myGoals = computed(() =>
  snap.value.goals
    .filter(
      (g) =>
        g.status === 'active' &&
        (g.ownerUid === uid.value || g.scope === 'company' || g.scope === 'team'),
    )
    .map((g) => goalProgress(g, snap.value))
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 4),
)

/** The next three weeks of anything with my name or my team on it. */
const deadlines = computed(() => {
  const limit = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10)

  return buildCalendar({
    events: [],
    tasks: myTasks.value,
    contracts: snap.value.contracts.filter((c) => c.responsibleUid === uid.value),
    invoices: [],
    dueWork: [],
    uid: uid.value,
  })
    .filter((item) => !item.done && item.date >= today && item.date <= limit)
    .slice(0, 8)
})

/* My own numbers, on the same engine the performance screen uses. */
const myKpis = computed(() => kpisFor(uid.value, snap.value, periodOf('month')))

const myCommission = computed(() =>
  snap.value.commissions
    .filter((c) => c.affiliateId === affiliate.value?.id)
    .reduce(
      (acc, c) => {
        if (c.status === 'pending') acc.pending += c.amountBaseMinor
        if (c.status === 'approved') acc.approved += c.amountBaseMinor
        if (c.status === 'paid') acc.paid += c.amountBaseMinor
        return acc
      },
      { pending: 0, approved: 0, paid: 0 },
    ),
)

function kpiValue(metric: KpiMetric): string {
  const value = myKpis.value[metric]
  return MONEY_KPIS.includes(metric) ? money(value) : String(value)
}

async function toggle(task: Task): Promise<void> {
  await setTaskStatus(task, task.status === 'done' ? 'todo' : 'done')
  await load()
}

async function load(): Promise<void> {
  loading.value = true
  const [s, a] = await Promise.all([
    loadSnapshot(),
    uid.value ? fetchMyAffiliate(uid.value).catch(() => null) : Promise.resolve(null),
  ])
  snap.value = s
  affiliate.value = a
  loading.value = false
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div class="who">
        <UserAvatar :name="auth.displayName ?? ''" :photo-url="auth.photoUrl" :size="44" />
        <div>
          <h1 class="page-title">{{ t('workspace.title') }}</h1>
          <p class="page-subtitle">{{ t('workspace.subtitle') }}</p>
        </div>
      </div>
      <button class="btn btn-primary" @click="router.push('/tasks')">
        <AppIcon name="plus" :size="16" /> {{ t('workspace.quickTask') }}
      </button>
    </header>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 72px" />
      </div>
    </div>

    <template v-else>
      <!-- My numbers this month --------------------------------------- -->
      <div class="cards">
        <article v-for="metric in DEFAULT_KPIS" :key="metric" class="card figure">
          <span class="figure-label">{{ t(`kpi.${metric}`) }}</span>
          <span class="figure-value" :class="{ neg: metric === 'tasks_overdue' && myKpis[metric] > 0 }">
            {{ kpiValue(metric) }}
          </span>
        </article>
      </div>

      <div class="pair">
        <!-- Tasks ----------------------------------------------------- -->
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('workspace.myTasks') }}</h2>
            <button class="btn btn-ghost btn-sm" @click="router.push('/tasks')">
              {{ t('workspace.openAll') }}
            </button>
          </div>

          <div v-if="myTasks.filter((x) => x.status !== 'done').length === 0" class="empty">
            <span class="empty-icon"><AppIcon name="check" :size="20" /></span>
            <p class="empty-title">{{ t('workspace.noTasks') }}</p>
            <p class="empty-text">{{ t('workspace.noTasksHint') }}</p>
          </div>

          <template v-else>
            <template
              v-for="group in (
                [
                  { key: 'late', label: t('workspace.late'), rows: taskGroups.late },
                  { key: 'today', label: t('workspace.dueToday'), rows: taskGroups.today },
                  { key: 'week', label: t('workspace.thisWeek'), rows: taskGroups.week },
                ] as const
              )"
              :key="group.key"
            >
              <template v-if="group.rows.length">
                <p class="group-title" :class="{ late: group.key === 'late' }">{{ group.label }}</p>
                <ul class="tasks">
                  <li v-for="task in group.rows" :key="task.id" class="task">
                    <button
                      type="button"
                      class="tick"
                      :aria-label="t('taskStatus.done')"
                      @click="toggle(task)"
                    />
                    <span class="task-body" @click="router.push('/tasks')">
                      <span class="task-title">{{ task.title }}</span>
                      <span class="task-meta tertiary">
                        <template v-if="task.dueDate">{{ formatDate(task.dueDate) }}</template>
                        <template v-if="task.priority !== 'normal'">
                          · {{ t(`taskPriority.${task.priority}`) }}
                        </template>
                      </span>
                    </span>
                  </li>
                </ul>
              </template>
            </template>
          </template>
        </section>

        <!-- Coming up -------------------------------------------------- -->
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('workspace.deadlines') }}</h2>
            <button class="btn btn-ghost btn-sm" @click="router.push('/calendar')">
              {{ t('workspace.openAll') }}
            </button>
          </div>

          <p v-if="deadlines.length === 0" class="card-body tertiary small">
            {{ t('workspace.noDeadlines') }}
          </p>

          <ul v-else class="agenda">
            <li v-for="item in deadlines" :key="item.id">
              <span class="agenda-date">{{ formatDate(item.date) }}</span>
              <span class="agenda-body">
                <span class="agenda-title truncate">{{ item.title }}</span>
                <span class="tertiary agenda-kind">{{ t(`eventKind.${item.kind}`) }}</span>
              </span>
            </li>
          </ul>
        </section>
      </div>

      <div class="pair">
        <!-- Leads ------------------------------------------------------ -->
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('workspace.myLeads') }}</h2>
            <button class="btn btn-ghost btn-sm" @click="router.push('/leads')">
              {{ t('workspace.openAll') }}
            </button>
          </div>

          <p v-if="myLeads.length === 0" class="card-body tertiary small">
            {{ t('workspace.noLeads') }}
          </p>

          <ul v-else class="rows">
            <li v-for="lead in myLeads.slice(0, 6)" :key="lead.id">
              <span class="row-main truncate">{{ lead.company || lead.name }}</span>
              <span class="badge badge-plain">{{ t(`leadStage.${lead.stage}`) }}</span>
              <span v-if="lead.nextStep" class="tertiary truncate row-note">{{ lead.nextStep }}</span>
            </li>
          </ul>
        </section>

        <!-- Deals ------------------------------------------------------ -->
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('workspace.mySales') }}</h2>
            <button class="btn btn-ghost btn-sm" @click="router.push('/sales')">
              {{ t('workspace.openAll') }}
            </button>
          </div>

          <p v-if="mySales.length === 0" class="card-body tertiary small">
            {{ t('workspace.noSales') }}
          </p>

          <ul v-else class="rows">
            <li v-for="sale in mySales.slice(0, 6)" :key="sale.id">
              <span class="row-main truncate">{{ sale.title }}</span>
              <span class="badge badge-plain">{{ t(`saleStage.${sale.stage}`) }}</span>
              <span class="row-value">{{ money(sale.value.baseMinor) }}</span>
            </li>
          </ul>
        </section>
      </div>

      <div class="pair">
        <!-- Projects & clients ----------------------------------------- -->
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('workspace.myProjects') }}</h2>
            <button class="btn btn-ghost btn-sm" @click="router.push('/projects')">
              {{ t('workspace.openAll') }}
            </button>
          </div>

          <p v-if="myProjects.length === 0" class="card-body tertiary small">
            {{ t('workspace.noProjects') }}
          </p>

          <ul v-else class="rows">
            <li v-for="p in myProjects.slice(0, 6)" :key="p.id">
              <span class="row-main truncate">{{ p.name }}</span>
              <span v-if="p.endDate" class="tertiary" :class="{ late: p.endDate < today }">
                {{ formatDate(p.endDate) }}
              </span>
            </li>
          </ul>

          <template v-if="myClients.length">
            <p class="group-title">{{ t('workspace.myClients') }}</p>
            <ul class="rows">
              <li v-for="c in myClients.slice(0, 5)" :key="c.id">
                <button type="button" class="link row-main truncate" @click="router.push(`/clients/${c.id}`)">
                  {{ c.name }}
                </button>
              </li>
            </ul>
          </template>
        </section>

        <!-- Goals & commission ----------------------------------------- -->
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('workspace.myGoals') }}</h2>
            <button class="btn btn-ghost btn-sm" @click="router.push('/goals')">
              {{ t('workspace.openAll') }}
            </button>
          </div>

          <p v-if="myGoals.length === 0" class="card-body tertiary small">
            {{ t('workspace.noGoals') }}
          </p>

          <ul v-else class="goals">
            <li v-for="row in myGoals" :key="row.goal.id">
              <span class="goal-name truncate">{{ row.goal.title }}</span>
              <span class="bar-track">
                <span
                  class="bar"
                  :class="row.onTrack ? 'is-ok' : 'is-behind'"
                  :style="{ width: `${Math.min(100, row.percent)}%` }"
                />
              </span>
              <span class="goal-pct" :class="row.onTrack ? 'pos' : 'warn'">{{ row.percent }}%</span>
            </li>
          </ul>

          <template v-if="affiliate">
            <p class="group-title">{{ t('workspace.myCommission') }}</p>
            <dl class="commission">
              <div>
                <dt>{{ t('affiliates.pending') }}</dt>
                <dd class="warn">{{ money(myCommission.pending) }}</dd>
              </div>
              <div>
                <dt>{{ t('affiliates.approved') }}</dt>
                <dd>{{ money(myCommission.approved) }}</dd>
              </div>
              <div>
                <dt>{{ t('affiliates.paid') }}</dt>
                <dd class="pos">{{ money(myCommission.paid) }}</dd>
              </div>
            </dl>
          </template>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.who { display: flex; align-items: center; gap: var(--space-4); }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--space-3); }
.figure { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4); }
.figure-label { font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.figure-value { font-size: var(--text-lg); font-weight: 700; font-variant-numeric: tabular-nums; }

.pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--space-4); align-items: start; }

.group-title { padding: var(--space-3) var(--space-5) var(--space-1); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); }
.group-title.late { color: var(--danger-500); }

.tasks { list-style: none; margin: 0; padding: 0; }
.task { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-5); }
.task:hover { background: var(--bg-hover); }
.tick { width: 18px; height: 18px; flex-shrink: 0; border: 1.5px solid var(--border-strong); border-radius: var(--radius-sm); }
.tick:hover { border-color: var(--accent); }
.task-body { flex: 1; min-width: 0; display: flex; flex-direction: column; cursor: pointer; }
.task-title { font-size: var(--text-sm); font-weight: 550; }
.task-meta { font-size: var(--text-xs); }

.agenda { list-style: none; margin: 0; padding: 0; }
.agenda li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-5); }
.agenda-date { font-size: var(--text-xs); font-weight: 600; min-width: 82px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.agenda-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.agenda-title { font-size: var(--text-sm); }
.agenda-kind { font-size: 10px; }

.rows { list-style: none; margin: 0; padding: 0; }
.rows li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-5); }
.rows li:hover { background: var(--bg-hover); }
.row-main { flex: 1; min-width: 0; font-size: var(--text-sm); font-weight: 550; text-align: left; }
.row-note { font-size: var(--text-xs); max-width: 40%; }
.row-value { font-size: var(--text-xs); font-weight: 650; font-variant-numeric: tabular-nums; }

.goals { list-style: none; margin: 0; padding: 0; }
.goals li { display: grid; grid-template-columns: minmax(80px, 1fr) 2fr auto; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-5); }
.goal-name { font-size: var(--text-sm); }
.bar-track { height: 8px; border-radius: var(--radius-full); background: var(--bg-inset); overflow: hidden; }
.bar { display: block; height: 100%; border-radius: var(--radius-full); }
.bar.is-ok { background: var(--ok-500); }
.bar.is-behind { background: var(--warn-500); }
.goal-pct { font-size: var(--text-xs); font-weight: 700; font-variant-numeric: tabular-nums; min-width: 40px; text-align: right; }

.commission { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); margin: 0; padding: 0 var(--space-5) var(--space-4); }
.commission dt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); margin-bottom: 2px; }
.commission dd { margin: 0; font-size: var(--text-sm); font-weight: 650; font-variant-numeric: tabular-nums; }

.pos { color: var(--ok-500); }
.neg { color: var(--danger-500); }
.warn { color: var(--warn-500); }
.late { color: var(--danger-500); }
.small { font-size: var(--text-xs); }
</style>
