<script setup lang="ts">
/**
 * My Workspace.
 *
 * Answers one question: what is mine, and what do I need to do about it. The
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
import { fetchActivityBy, fetchDatedNotes, saveNote } from '@/api/records'
import { affiliateOwners } from '@/api/affiliates'
import {
  EMPTY_SNAPSHOT,
  goalProgress,
  kpisFor,
  loadSnapshot,
  periodOf,
  type Snapshot,
} from '@/api/metrics'
import { earningsFor, membersOf, progressFor, submitWork, type ProgressSources } from '@/api/rewards'
import { balanceOf } from '@/types/revenue'
import { formatDate, formatRelative } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { OPEN_STAGES, type Note } from '@/types/business'
import { DEFAULT_KPIS, MONEY_KPIS, type KpiMetric } from '@/types/company'
import { STAFF_WORK_STATUSES, type IncentiveWork } from '@/types/rewards'
import { BASE_CURRENCY, formatMoney } from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import type { ActivityEntry } from '@/types/records'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { t, locale } = useI18n()

const loading = ref(true)
const saving = ref(false)

const snap = ref<Snapshot>(EMPTY_SNAPSHOT)
const notes = ref<Note[]>([])
const activity = ref<ActivityEntry[]>([])

const submitting = ref<IncentiveWork | null>(null)
const submitNote = ref('')

const today = new Date().toISOString().slice(0, 10)
const uid = computed(() => auth.uid ?? '')

const canMoney = computed(() => auth.hasPermission(PERMISSIONS.FINANCE_VIEW))

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

/* ---- What is mine ---------------------------------------------------- */

const myLeads = computed(() =>
  snap.value.leads
    .filter((l) => l.assigneeUid === uid.value && OPEN_STAGES.includes(l.stage))
    .sort((a, b) => (a.nextContactDate ?? '9999').localeCompare(b.nextContactDate ?? '9999')),
)

const mySales = computed(() =>
  snap.value.sales
    .filter((s) => s.ownerUid === uid.value)
    .sort((a, b) => b.saleDate.localeCompare(a.saleDate)),
)

const myClients = computed(() => snap.value.clients.filter((c) => c.responsibleUid === uid.value))

const myProjects = computed(() =>
  snap.value.projects.filter(
    (p) => (p.ownerUid === uid.value || p.teamUids?.includes(uid.value)) && p.status === 'active',
  ),
)

const myGoals = computed(() =>
  snap.value.goals
    .filter(
      (g) =>
        g.status === 'active' &&
        ((g.ownerUids ?? []).includes(uid.value) || g.scope === 'company' || g.scope === 'team'),
    )
    .map((g) => goalProgress(g, snap.value))
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 5),
)

/** My reminders, from the notes attached to whatever they are about. */
const myReminders = computed(() =>
  notes.value
    .filter((n) => n.authorUid === uid.value && !n.done && n.dueDate)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
)

const overdueReminders = computed(() => myReminders.value.filter((n) => (n.dueDate ?? '') < today))

/** What comes next: reminders, project deadlines and expected payments. */
const upcoming = computed(() => {
  const limit = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10)
  const out: { id: string; date: string; title: string; kind: string; link: string | null }[] = []

  for (const note of myReminders.value) {
    out.push({
      id: `note-${note.id}`,
      date: note.dueDate!,
      title: note.body.slice(0, 70),
      kind: t('eventKind.reminder'),
      link: null,
    })
  }

  for (const project of myProjects.value) {
    if (!project.endDate) continue
    out.push({
      id: `project-${project.id}`,
      date: project.endDate,
      title: project.name,
      kind: t('eventKind.deadline'),
      link: `/projects/${project.id}`,
    })
  }

  if (canMoney.value) {
    for (const sale of mySales.value) {
      const balance = balanceOf(sale, snap.value.transactions)
      if (balance.remainingBaseMinor <= 0) continue
      out.push({
        id: `sale-${sale.id}`,
        date: sale.saleDate,
        title: `${sale.title} · ${money(balance.remainingBaseMinor)}`,
        kind: t('eventKind.payment'),
        link: '/sales',
      })
    }
  }

  return out
    .filter((item) => item.date <= limit)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 10)
})

/* ---- Numbers and earnings -------------------------------------------- */

const myKpis = computed(() => kpisFor(uid.value, snap.value, periodOf('month')))

const owners = computed(() => affiliateOwners(snap.value.affiliates))

const earnings = computed(() =>
  earningsFor(uid.value, snap.value.awards, snap.value.commissions, owners.value),
)

const myAwards = computed(() =>
  snap.value.awards
    .filter((a) => a.employeeUid === uid.value)
    .sort((a, b) => b.earnedDate.localeCompare(a.earnedDate))
    .slice(0, 8),
)

const myWork = computed(() =>
  snap.value.work
    .filter((w) => w.assigneeUid === uid.value && w.status !== 'cancelled')
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')),
)

const roster = computed(() => [{ uid: uid.value, departmentId: null }])

const sources = computed<ProgressSources>(() => ({
  sales: snap.value.sales,
  transactions: snap.value.transactions,
  leads: snap.value.leads,
  clients: snap.value.clients,
  projects: snap.value.projects,
  awards: snap.value.awards,
}))

/** The bonus ladders I am on, with where I stand on each. */
const myProgrammes = computed(() =>
  snap.value.programmes
    .filter((p) => p.status === 'active' && p.visibleToStaff)
    .map((p) => ({ programme: p, progress: progressFor(p, uid.value, sources.value) }))
    .filter((row) => row.programme.audience === 'company' || membersOf(row.programme, roster.value).includes(uid.value)),
)

function kpiValue(metric: KpiMetric): string {
  const value = myKpis.value[metric]
  return MONEY_KPIS.includes(metric) ? money(value) : String(value)
}

async function toggleReminder(note: Note): Promise<void> {
  await saveNote({ ...note, done: !note.done })
  await load()
}

/** An employee may take work as far as `submitted`. Approving earns it. */
async function commitSubmit(): Promise<void> {
  const w = submitting.value
  if (!w || saving.value) return

  saving.value = true
  try {
    await submitWork(w, submitNote.value)
    ui.notify('ok', t('workspace.workSubmitted'))
    submitting.value = null
    submitNote.value = ''
    await load()
  } catch {
    ui.notify('danger', t('bonuses.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function load(): Promise<void> {
  loading.value = true
  const [s, n, a] = await Promise.all([
    loadSnapshot(),
    fetchDatedNotes().catch(() => []),
    uid.value ? fetchActivityBy(uid.value, 15).catch(() => []) : Promise.resolve([]),
  ])
  snap.value = s
  notes.value = n
  activity.value = a
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
          <span class="figure-value">{{ kpiValue(metric) }}</span>
        </article>
      </div>

      <div class="pair">
        <!-- Coming up -------------------------------------------------- -->
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('workspace.deadlines') }}</h2>
            <span v-if="overdueReminders.length" class="badge badge-danger">
              {{ overdueReminders.length }}
            </span>
          </div>

          <p v-if="upcoming.length === 0" class="card-body tertiary small">
            {{ t('workspace.noDeadlines') }}
          </p>

          <ul v-else class="agenda">
            <li v-for="item in upcoming" :key="item.id">
              <span class="agenda-date" :class="{ late: item.date < today }">
                {{ formatDate(item.date) }}
              </span>
              <span class="agenda-body">
                <span class="agenda-title truncate">{{ item.title }}</span>
                <span class="tertiary agenda-kind">{{ item.kind }}</span>
              </span>
              <button
                v-if="item.link"
                class="btn btn-ghost btn-sm"
                :aria-label="t('common.open')"
                @click="router.push(item.link)"
              >
                <AppIcon name="arrowRight" :size="14" />
              </button>
            </li>
          </ul>
        </section>

        <!-- Reminders -------------------------------------------------- -->
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('workspace.reminders') }}</h2>
          </div>

          <p v-if="myReminders.length === 0" class="card-body tertiary small">
            {{ t('workspace.noReminders') }}
          </p>

          <ul v-else class="reminders">
            <li v-for="note in myReminders" :key="note.id">
              <button
                type="button"
                class="tick"
                :aria-label="t('notes.markDone')"
                @click="toggleReminder(note)"
              />
              <span class="reminder-body">
                <span class="reminder-text truncate">{{ note.body }}</span>
                <span class="tertiary small" :class="{ late: (note.dueDate ?? '') < today }">
                  {{ formatDate(note.dueDate!) }}
                </span>
              </span>
            </li>
          </ul>
          <p class="card-body tertiary small">{{ t('workspace.remindersHint') }}</p>
        </section>
      </div>

      <!-- Bonus ladders ----------------------------------------------- -->
      <section v-if="myProgrammes.length" class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('workspace.myBonuses') }}</h2>
          <button class="btn btn-ghost btn-sm" @click="router.push('/bonuses')">
            {{ t('workspace.openAll') }}
          </button>
        </div>

        <div v-for="row in myProgrammes" :key="row.programme.id" class="programme">
          <div class="programme-head">
            <span class="programme-name">{{ row.programme.name }}</span>
            <span class="programme-current">
              {{ row.progress.isMoney ? money(row.progress.current) : row.progress.current }}
            </span>
          </div>

          <div class="bar-row">
            <span class="bar-track">
              <span class="bar" :style="{ width: `${row.progress.percent}%` }" />
            </span>
            <span class="bar-pct">{{ row.progress.percent }}%</span>
          </div>

          <p v-if="row.progress.nextMilestone" class="tertiary small">
            {{ t('bonuses.remaining') }}:
            {{
              row.progress.isMoney
                ? money(row.progress.remaining)
                : row.progress.remaining
            }}
            →
            {{
              row.progress.nextMilestone.rewardLabel ||
              money(row.progress.nextMilestone.rewardBaseMinor)
            }}
          </p>
          <p v-else class="tertiary small">{{ t('bonuses.allReached') }}</p>
        </div>
      </section>

      <!-- Incentive work ---------------------------------------------- -->
      <section v-if="myWork.length" class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('workspace.myWork') }}</h2>
        </div>

        <ul class="work">
          <li v-for="w in myWork" :key="w.id">
            <span class="work-body">
              <span class="work-title">{{ w.title }}</span>
              <span class="tertiary small">
                <template v-if="w.dueDate">{{ formatDate(w.dueDate) }} · </template>
                {{ w.rewardBaseMinor ? money(w.rewardBaseMinor) : w.rewardLabel }}
              </span>
            </span>
            <span class="badge" :class="`ws-${w.status}`">{{ t(`workStatus.${w.status}`) }}</span>
            <button
              v-if="STAFF_WORK_STATUSES.includes(w.status) && w.status !== 'submitted'"
              class="btn btn-secondary btn-sm"
              @click="submitting = w"
            >
              {{ t('workspace.submitWork') }}
            </button>
          </li>
        </ul>
        <p class="card-body tertiary small">{{ t('workspace.submitHint') }}</p>
      </section>

      <!-- Earnings ----------------------------------------------------- -->
      <section class="card">
        <div class="card-header">
          <h2 class="card-title">{{ t('workspace.myEarnings') }}</h2>
        </div>

        <dl class="earnings">
          <div>
            <dt>{{ t('earnings.month') }}</dt>
            <dd>{{ money(earnings.monthBaseMinor) }}</dd>
          </div>
          <div>
            <dt>{{ t('earnings.year') }}</dt>
            <dd>{{ money(earnings.yearBaseMinor) }}</dd>
          </div>
          <div>
            <dt>{{ t('earnings.owed') }}</dt>
            <dd class="warn">{{ money(earnings.owedBaseMinor) }}</dd>
          </div>
          <div>
            <dt>{{ t('earnings.pending') }}</dt>
            <dd class="tertiary">{{ money(earnings.pendingBaseMinor) }}</dd>
          </div>
          <div>
            <dt>{{ t('earnings.commission') }}</dt>
            <dd>{{ money(earnings.commissionPaidBaseMinor) }}</dd>
          </div>
          <div>
            <dt>{{ t('earnings.paid') }}</dt>
            <dd class="pos">{{ money(earnings.paidBaseMinor) }}</dd>
          </div>
        </dl>

        <p v-if="myAwards.length === 0" class="card-body tertiary small">
          {{ t('earnings.noAwards') }}
        </p>

        <ul v-else class="awards">
          <li v-for="a in myAwards" :key="a.id">
            <span class="award-body">
              <span class="award-reason">{{ a.reason || a.sourceLabel }}</span>
              <span class="tertiary small">{{ formatDate(a.earnedDate) }}</span>
            </span>
            <span class="badge" :class="`as-${a.status}`">{{ t(`awardStatus.${a.status}`) }}</span>
            <span class="award-amount">
              {{ a.amountBaseMinor ? money(a.amountBaseMinor) : a.rewardLabel }}
            </span>
          </li>
        </ul>
        <p class="card-body tertiary small">{{ t('earnings.earnedNotPaid') }}</p>
      </section>

      <!-- My records ---------------------------------------------------- -->
      <div class="pair">
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
              <span
                v-if="!lead.lastContactedAt"
                class="tertiary small neg"
              >{{ t('leads.neverContacted') }}</span>
            </li>
          </ul>
        </section>

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
              <span class="tertiary small">{{ sale.clientName }}</span>
              <span class="row-value">{{ money(sale.value.baseMinor) }}</span>
            </li>
          </ul>
        </section>
      </div>

      <div class="pair">
        <section class="card">
          <div class="card-header">
            <h2 class="card-title">{{ t('workspace.myClients') }}</h2>
          </div>

          <p v-if="myClients.length === 0" class="card-body tertiary small">
            {{ t('workspace.noClients') }}
          </p>

          <ul v-else class="rows">
            <li v-for="c in myClients.slice(0, 6)" :key="c.id">
              <button type="button" class="row-main link truncate" @click="router.push(`/clients/${c.id}`)">
                {{ c.name }}
              </button>
              <span class="badge badge-plain">{{ t(`clientStatus.${c.status}`) }}</span>
            </li>
          </ul>

          <template v-if="myProjects.length">
            <p class="group-title">{{ t('workspace.myProjects') }}</p>
            <ul class="rows">
              <li v-for="p in myProjects.slice(0, 5)" :key="p.id">
                <button
                  type="button"
                  class="row-main link truncate"
                  @click="router.push(`/projects/${p.id}`)"
                >
                  {{ p.name }}
                </button>
                <span v-if="p.endDate" class="tertiary small" :class="{ late: p.endDate < today }">
                  {{ formatDate(p.endDate) }}
                </span>
              </li>
            </ul>
          </template>
        </section>

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

          <template v-if="activity.length">
            <p class="group-title">{{ t('workspace.recentActivity') }}</p>
            <ul class="rows">
              <li v-for="entry in activity.slice(0, 6)" :key="entry.id">
                <span class="row-main truncate">
                  {{ t(`activityKind.${entry.kind}`) }} · {{ entry.entityLabel }}
                </span>
                <span class="tertiary small">{{ formatRelative(entry.createdAt) }}</span>
              </li>
            </ul>
          </template>
        </section>
      </div>
    </template>

    <!-- Submit work ---------------------------------------------------- -->
    <div v-if="submitting" class="modal-backdrop" @click.self="submitting = null">
      <section class="card modal">
        <div class="card-header">
          <h2 class="card-title">{{ t('workspace.submitWork') }}</h2>
          <button
            class="btn btn-ghost btn-icon"
            :aria-label="t('common.close')"
            @click="submitting = null"
          >
            <AppIcon name="close" :size="18" />
          </button>
        </div>

        <div class="card-body stack">
          <p class="strong">{{ submitting.title }}</p>
          <p class="field-hint">{{ t('workspace.submitHint') }}</p>

          <div class="field">
            <label class="field-label" for="sw-note">{{ t('workspace.submissionNote') }}</label>
            <textarea id="sw-note" v-model="submitNote" class="textarea" maxlength="2000" />
          </div>
        </div>

        <div class="card-footer">
          <button class="btn btn-secondary" @click="submitting = null">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="saving" @click="commitSubmit">
            <span v-if="saving" class="spinner" />{{ t('workspace.submitWork') }}
          </button>
        </div>
      </section>
    </div>
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

.agenda, .reminders, .rows, .work, .awards, .goals { list-style: none; margin: 0; padding: 0; }
.agenda li, .rows li, .work li, .awards li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-5); }
.agenda li:hover, .rows li:hover { background: var(--bg-hover); }
.agenda-date { font-size: var(--text-xs); font-weight: 600; min-width: 82px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.agenda-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.agenda-title { font-size: var(--text-sm); }
.agenda-kind { font-size: 10px; }

.reminders li { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-5); }
.tick { width: 18px; height: 18px; flex-shrink: 0; border: 1.5px solid var(--border-strong); border-radius: var(--radius-sm); }
.tick:hover { border-color: var(--accent); }
.reminder-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.reminder-text { font-size: var(--text-sm); }

.row-main { flex: 1; min-width: 0; font-size: var(--text-sm); font-weight: 550; text-align: left; }
.row-value { font-size: var(--text-xs); font-weight: 650; font-variant-numeric: tabular-nums; }

.programme { padding: var(--space-4) var(--space-5); border-top: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: var(--space-2); }
.programme-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
.programme-name { font-weight: 600; }
.programme-current { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--text-brand); }

.bar-row { display: flex; align-items: center; gap: var(--space-3); }
.bar-track { flex: 1; height: 8px; border-radius: var(--radius-full); background: var(--bg-inset); overflow: hidden; }
.bar { display: block; height: 100%; border-radius: var(--radius-full); background: var(--accent); }
.bar.is-ok { background: var(--ok-500); }
.bar.is-behind { background: var(--warn-500); }
.bar-pct { font-size: var(--text-xs); font-weight: 700; font-variant-numeric: tabular-nums; min-width: 40px; text-align: right; }

.work-body, .award-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.work-title, .award-reason { font-size: var(--text-sm); font-weight: 550; }
.award-amount { font-size: var(--text-sm); font-weight: 650; font-variant-numeric: tabular-nums; }

.earnings { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--space-3); margin: 0; padding: var(--space-4) var(--space-5); }
.earnings dt { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); margin-bottom: 2px; }
.earnings dd { margin: 0; font-size: var(--text-md); font-weight: 700; font-variant-numeric: tabular-nums; }

.goals li { display: grid; grid-template-columns: minmax(80px, 1fr) 2fr auto; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-5); }
.goal-name { font-size: var(--text-sm); }
.goal-pct { font-size: var(--text-xs); font-weight: 700; font-variant-numeric: tabular-nums; min-width: 40px; text-align: right; }

.modal-backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: var(--space-4); background: rgb(0 0 0 / 45%); }
.modal { width: min(480px, 100%); box-shadow: var(--shadow-lg); }

.pos { color: var(--ok-500); }
.neg { color: var(--danger-500); }
.warn { color: var(--warn-500); }
.late { color: var(--danger-500); font-weight: 600; }
.strong { font-weight: 650; }
.small { font-size: var(--text-xs); }

.ws-approved, .as-paid { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.ws-assigned, .as-pending, .ws-cancelled, .as-cancelled { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }
.ws-in_progress, .as-earned { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); color: var(--text-brand); }
.ws-submitted, .as-approved { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.ws-rejected, .as-rejected { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-500); }
</style>
