<script setup lang="ts">
/**
 * Bonuses, incentive work and awards.
 *
 * One sentence governs the whole screen: **nobody awards themselves anything.**
 *
 * Progress is counted from records the employee cannot edit. Reaching a
 * milestone lets a manager grant the award — it is not granted silently,
 * because money leaving the company should be somebody's decision. Approving
 * and paying are two further steps, and the rules refuse all three to the
 * person the award belongs to.
 *
 * Earned and paid are shown as separate columns because they are separate
 * facts. A bonus earned in March and paid in May is a debt for two months.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/ui/AppIcon.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import UserAvatar from '@/components/ui/UserAvatar.vue'
import { fetchEmployees } from '@/api/employees'
import { fetchDepartments } from '@/api/organisation'
import { EMPTY_SNAPSHOT, loadSnapshot, type Snapshot } from '@/api/metrics'
import {
  approveWork,
  deleteProgramme,
  deleteWork,
  grantManual,
  grantMilestone,
  membersOf,
  progressFor,
  rejectWork,
  saveProgramme,
  saveWork,
  setAwardStatus,
  type ProgressSources,
} from '@/api/rewards'
import { ACCEPTED_TYPES, PhotoError, processRewardImage } from '@/api/photos'
import { formatDate } from '@/i18n'
import { LIMITS } from '@/lib/validation'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import {
  AWARD_STATUSES,
  BONUS_AUDIENCES,
  BONUS_METRICS,
  MONEY_BONUS_METRICS,
  PROGRAMME_STATUSES,
  REWARD_TYPES,
  rewardValueOf,
  type AwardStatus,
  type BonusAward,
  type BonusMilestone,
  type BonusProgramme,
  type IncentiveWork,
} from '@/types/rewards'
import { BASE_CURRENCY, formatMoney, fromMinor, toMinor } from '@/types/money'
import { PERMISSIONS } from '@/types/permissions'
import type { Department, EmployeePublic } from '@/types/domain'

const auth = useAuthStore()
const ui = useUiStore()
const { t, locale } = useI18n()

type Tab = 'programmes' | 'work' | 'awards'

const tab = ref<Tab>('programmes')
const loading = ref(true)
const saving = ref(false)

const snapshot = ref<Snapshot>(EMPTY_SNAPSHOT)
const people = ref<EmployeePublic[]>([])
const departments = ref<Department[]>([])

const programmeDraft = ref<BonusProgramme | null>(null)
const milestoneAmounts = ref<Record<string, number>>({})
const workDraft = ref<IncentiveWork | null>(null)
const workReward = ref(0)
const manualOpen = ref(false)
const manual = ref({ uid: '', reason: '', amount: 0, label: '' })
const reviewing = ref<IncentiveWork | null>(null)
const reviewNote = ref('')

const pendingProgramme = ref<BonusProgramme | null>(null)
const pendingWork = ref<IncentiveWork | null>(null)
const statusFilter = ref<AwardStatus | ''>('')

const today = new Date().toISOString().slice(0, 10)

const canManage = computed(() => auth.hasPermission(PERMISSIONS.BONUSES_MANAGE))
const canApprove = computed(() => auth.hasPermission(PERMISSIONS.BONUSES_APPROVE))
const canSeeAll = computed(() => auth.hasPermission(PERMISSIONS.BONUSES_VIEW_ALL))

function money(minor: number): string {
  return formatMoney(minor, BASE_CURRENCY, locale.value)
}

const peopleByUid = computed(() => new Map(people.value.map((p) => [p.uid, p])))

const sources = computed<ProgressSources>(() => ({
  sales: snapshot.value.sales,
  transactions: snapshot.value.transactions,
  leads: snapshot.value.leads,
  clients: snapshot.value.clients,
  projects: snapshot.value.projects,
  awards: snapshot.value.awards,
}))

/** Programmes the viewer may see: everything, or only ones they are part of. */
const programmes = computed(() =>
  snapshot.value.programmes.filter(
    (p) =>
      canSeeAll.value ||
      canManage.value ||
      membersOf(p, roster.value).includes(auth.uid ?? ''),
  ),
)

const roster = computed(() =>
  people.value.map((p) => ({ uid: p.uid, departmentId: p.departmentId ?? null })),
)

/** Every member of every programme, with where they stand. */
function standings(programme: BonusProgramme) {
  const uids = canSeeAll.value || canManage.value
    ? membersOf(programme, roster.value)
    : [auth.uid ?? '']

  return uids
    .filter(Boolean)
    .map((uid) => ({
      uid,
      person: peopleByUid.value.get(uid),
      progress: progressFor(programme, uid, sources.value),
    }))
    .sort((a, b) => b.progress.current - a.progress.current)
}

const work = computed(() =>
  snapshot.value.work
    .filter((w) => canSeeAll.value || canManage.value || w.assigneeUid === auth.uid)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
)

const awards = computed(() =>
  snapshot.value.awards
    .filter((a) => canSeeAll.value || a.employeeUid === auth.uid)
    .filter((a) => !statusFilter.value || a.status === statusFilter.value)
    .sort((a, b) => b.earnedDate.localeCompare(a.earnedDate)),
)

const owed = computed(() =>
  snapshot.value.awards
    .filter((a) => a.status === 'earned' || a.status === 'approved')
    .reduce((n, a) => n + a.amountBaseMinor, 0),
)

async function load(): Promise<void> {
  loading.value = true
  try {
    const [snap, e, d] = await Promise.all([
      loadSnapshot(),
      fetchEmployees().catch(() => []),
      fetchDepartments().catch(() => []),
    ])
    snapshot.value = snap
    people.value = e
    departments.value = d
  } catch {
    ui.notify('danger', t('errors.loadFailed'))
  } finally {
    loading.value = false
  }
}

/* ---- Programme editor ------------------------------------------------ */

function blankProgramme(): BonusProgramme {
  const year = today.slice(0, 4)
  return {
    id: '',
    name: '',
    description: '',
    metric: 'sales_count',
    audience: 'company',
    departmentId: null,
    memberUids: [],
    milestones: [],
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    serviceId: null,
    requiresApproval: true,
    repeats: false,
    status: 'draft',
    visibleToStaff: true,
    rules: '',
    notes: '',
    deletedAt: null,
    deletedBy: null,
    deletedByName: '',
    createdAt: '',
    createdBy: '',
    updatedAt: '',
  }
}

function startProgramme(): void {
  programmeDraft.value = blankProgramme()
  milestoneAmounts.value = {}
}

function editProgramme(p: BonusProgramme): void {
  programmeDraft.value = {
    ...p,
    memberUids: [...(p.memberUids ?? [])],
    milestones: (p.milestones ?? []).map((m) => ({ ...m })),
  }
  milestoneAmounts.value = Object.fromEntries(
    (p.milestones ?? []).map((m) => [m.id, fromMinor(m.rewardBaseMinor, BASE_CURRENCY)]),
  )
}

function addMilestone(): void {
  const d = programmeDraft.value
  if (!d) return
  const milestone: BonusMilestone = {
    id: Math.random().toString(36).slice(2, 10),
    target: 0,
    type: 'money',
    rewardBaseMinor: 0,
    rewardPercent: 0,
    rewardLabel: '',
    rewardImage: null,
    description: '',
    note: '',
  }
  d.milestones.push(milestone)
  milestoneAmounts.value[milestone.id] = 0
}

/**
 * The ladder, in the order somebody climbs it.
 *
 * Sorted for display rather than on save, so a level added out of order slots
 * into place while the CEO is still looking at it instead of jumping after a
 * reload.
 */
const sortedDraftMilestones = computed(() =>
  [...(programmeDraft.value?.milestones ?? [])].sort((a, b) => a.target - b.target),
)

function removeMilestone(id: string): void {
  const d = programmeDraft.value
  if (!d) return
  d.milestones = d.milestones.filter((m) => m.id !== id)
  delete milestoneAmounts.value[id]
}

/** A one-line summary for the collapsed header of each level. */
function describeLevel(m: BonusMilestone): string {
  const target = displayCount(programmeDraft.value, m.target)
  const reward =
    m.type === 'money'
      ? money(toMinor(milestoneAmounts.value[m.id] ?? 0, BASE_CURRENCY))
      : m.type === 'percentage'
        ? `${m.rewardPercent}%`
        : m.rewardLabel || t(`rewardType.${m.type}`)
  return `${target} → ${reward}`
}

async function pickImage(m: BonusMilestone, event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  try {
    m.rewardImage = await processRewardImage(file)
  } catch (error) {
    ui.notify(
      'danger',
      error instanceof PhotoError && error.reason === 'type'
        ? t('errors.fileWrongType')
        : t('errors.fileTooLarge', { max: '12 MB' }),
    )
  }
}

function toggleMember(uid: string): void {
  const list = programmeDraft.value?.memberUids
  if (!list) return
  const i = list.indexOf(uid)
  if (i >= 0) list.splice(i, 1)
  else list.push(uid)
}

async function commitProgramme(): Promise<void> {
  const d = programmeDraft.value
  if (!d || saving.value) return
  if (!d.name.trim()) {
    ui.notify('danger', t('bonuses.nameRequired'))
    return
  }

  saving.value = true
  try {
    await saveProgramme({
      ...d,
      name: d.name.trim(),
      /*
       * The amount is cleared for anything that is not money.
       *
       * The editor hides the amount field when the type changes, but the value
       * typed before the switch is still sitting in `milestoneAmounts` — and
       * saving it would leave a day off carrying a price, which finance reads
       * as a cash bonus. The same goes for a percentage: its amount is fixed
       * when the level is granted, not when it is written.
       */
      milestones: d.milestones
        .map((m) => ({
          ...m,
          rewardBaseMinor:
            m.type === 'money' ? toMinor(milestoneAmounts.value[m.id] ?? 0, BASE_CURRENCY) : 0,
          rewardPercent: m.type === 'percentage' ? m.rewardPercent : 0,
          rewardLabel: m.type === 'money' || m.type === 'percentage' ? '' : m.rewardLabel.trim(),
        }))
        .sort((a, b) => a.target - b.target),
    })
    ui.notify('ok', t('bonuses.saved'))
    programmeDraft.value = null
    await load()
  } catch {
    ui.notify('danger', t('bonuses.saveFailed'))
  } finally {
    saving.value = false
  }
}

/**
 * Grant a milestone somebody has reached.
 *
 * Deliberately a button rather than something that happens on its own. The
 * count is automatic; handing over money is not.
 */
async function grant(
  programme: BonusProgramme,
  milestone: BonusMilestone,
  uid: string,
): Promise<void> {
  const person = peopleByUid.value.get(uid)
  if (!person) return

  try {
    await grantMilestone(
      programme,
      milestone,
      { uid, name: `${person.firstName} ${person.lastName}` },
      /* Recounted here rather than taken from the row, so a percentage reward
         is worked out from the figure at the moment of granting. */
      progressFor(programme, uid, sources.value).current,
    )
    ui.notify('ok', t('bonuses.granted'))
    await load()
  } catch {
    ui.notify('danger', t('bonuses.saveFailed'))
  }
}

async function confirmDeleteProgramme(): Promise<void> {
  if (!pendingProgramme.value) return
  await deleteProgramme(pendingProgramme.value)
  pendingProgramme.value = null
  await load()
}

/* ---- Incentive work -------------------------------------------------- */

function blankWork(): IncentiveWork {
  return {
    id: '',
    title: '',
    description: '',
    assigneeUid: '',
    assigneeName: '',
    dueDate: null,
    rewardBaseMinor: 0,
    rewardLabel: '',
    status: 'assigned',
    submittedAt: null,
    submissionNote: '',
    reviewedBy: null,
    reviewedByName: '',
    reviewedAt: null,
    reviewNote: '',
    deletedAt: null,
    deletedBy: null,
    deletedByName: '',
    createdAt: '',
    createdBy: '',
    createdByName: '',
    updatedAt: '',
  }
}

function startWork(): void {
  workDraft.value = blankWork()
  workReward.value = 0
}

function onAssigneeChange(uid: string): void {
  const d = workDraft.value
  if (!d) return
  const person = peopleByUid.value.get(uid)
  d.assigneeUid = uid
  d.assigneeName = person ? `${person.firstName} ${person.lastName}` : ''
}

async function commitWork(): Promise<void> {
  const d = workDraft.value
  if (!d || saving.value) return
  if (!d.title.trim() || !d.assigneeUid) {
    ui.notify('danger', t('bonuses.workRequired'))
    return
  }

  saving.value = true
  try {
    await saveWork({
      ...d,
      title: d.title.trim(),
      rewardBaseMinor: toMinor(workReward.value, BASE_CURRENCY),
    })
    ui.notify('ok', t('bonuses.workAssigned'))
    workDraft.value = null
    await load()
  } catch {
    ui.notify('danger', t('bonuses.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function decideWork(approve: boolean): Promise<void> {
  const w = reviewing.value
  if (!w || saving.value) return

  saving.value = true
  try {
    if (approve) await approveWork(w, reviewNote.value)
    else await rejectWork(w, reviewNote.value)

    ui.notify('ok', approve ? t('bonuses.workApproved') : t('bonuses.workRejected'))
    reviewing.value = null
    reviewNote.value = ''
    await load()
  } catch {
    ui.notify('danger', t('bonuses.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function confirmDeleteWork(): Promise<void> {
  if (!pendingWork.value) return
  await deleteWork(pendingWork.value)
  pendingWork.value = null
  await load()
}

/* ---- Awards ---------------------------------------------------------- */

async function decideAward(award: BonusAward, status: AwardStatus): Promise<void> {
  if (award.employeeUid === auth.uid) {
    ui.notify('danger', t('bonuses.approveOwn'))
    return
  }

  try {
    await setAwardStatus(award, status)
    ui.notify('ok', t('bonuses.statusChanged'))
    await load()
  } catch {
    ui.notify('danger', t('bonuses.saveFailed'))
  }
}

async function commitManual(): Promise<void> {
  if (saving.value || !manual.value.uid || !manual.value.reason.trim()) return
  const person = peopleByUid.value.get(manual.value.uid)
  if (!person) return

  saving.value = true
  try {
    await grantManual({
      employeeUid: manual.value.uid,
      employeeName: `${person.firstName} ${person.lastName}`,
      reason: manual.value.reason.trim(),
      amountBaseMinor: toMinor(manual.value.amount, BASE_CURRENCY),
      rewardLabel: manual.value.label.trim(),
    })
    ui.notify('ok', t('bonuses.granted'))
    manualOpen.value = false
    manual.value = { uid: '', reason: '', amount: 0, label: '' }
    await load()
  } catch {
    ui.notify('danger', t('bonuses.saveFailed'))
  } finally {
    saving.value = false
  }
}

function isMoneyMetric(programme: BonusProgramme): boolean {
  return MONEY_BONUS_METRICS.includes(programme.metric)
}

function displayCount(programme: BonusProgramme | null, value: number): string {
  if (!programme) return String(value)
  return isMoneyMetric(programme) ? money(value) : String(value)
}

/**
 * What a rung is worth, in words.
 *
 * A percentage rung is worth nothing fixed until it is reached, so it is shown
 * as the rate and what that currently comes to — an estimate, and labelled as
 * one, rather than a number that looks promised and then changes.
 */
function rewardText(milestone: BonusMilestone, currentValue: number): string {
  if (milestone.type === 'money') return money(milestone.rewardBaseMinor)

  if (milestone.type === 'percentage') {
    const { baseMinor } = rewardValueOf(milestone, currentValue)
    return `${milestone.rewardPercent}% · ${t('bonuses.approx', { amount: money(baseMinor) })}`
  }

  return milestone.rewardLabel || t(`rewardType.${milestone.type}`)
}

/** How far along this rung somebody is: 740 of 1,000 is 74%. */
function rungPercent(
  progress: { current: number },
  milestone: BonusMilestone,
): number {
  if (milestone.target <= 0) return 100
  return Math.min(100, (progress.current / milestone.target) * 100)
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1 class="page-title">{{ t('bonuses.title') }}</h1>
        <p class="page-subtitle">{{ t('bonuses.subtitle') }}</p>
      </div>

      <div v-if="canManage" class="head-actions">
        <button v-if="tab === 'programmes'" class="btn btn-primary" @click="startProgramme">
          <AppIcon name="plus" :size="16" /> {{ t('bonuses.newProgramme') }}
        </button>
        <button v-else-if="tab === 'work'" class="btn btn-primary" @click="startWork">
          <AppIcon name="plus" :size="16" /> {{ t('bonuses.assignWork') }}
        </button>
        <button v-else class="btn btn-primary" @click="manualOpen = true">
          <AppIcon name="plus" :size="16" /> {{ t('bonuses.grantManual') }}
        </button>
      </div>
    </header>

    <div class="note">
      <AppIcon name="shield" :size="16" />
      <div>
        <p class="note-title">{{ t('bonuses.ruleTitle') }}</p>
        <p class="note-text">{{ t('bonuses.ruleText') }}</p>
      </div>
    </div>

    <div class="tabs" role="tablist">
      <button
        v-for="key in (['programmes', 'work', 'awards'] as Tab[])"
        :key="key"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'is-active': tab === key }"
        :aria-selected="tab === key"
        @click="tab = key"
      >
        {{
          key === 'programmes'
            ? t('bonuses.programmes')
            : key === 'work'
              ? t('bonuses.incentiveWork')
              : t('bonuses.history')
        }}
      </button>
    </div>

    <div v-if="loading" class="card">
      <div class="card-body stack">
        <div v-for="n in 3" :key="n" class="skeleton" style="height: 90px" />
      </div>
    </div>

    <!-- ===================== PROGRAMMES ===================== -->
    <template v-else-if="tab === 'programmes'">
      <section v-if="programmeDraft" class="card editor">
        <div class="card-header">
          <h2 class="card-title">
            {{ programmeDraft.id ? t('bonuses.editProgramme') : t('bonuses.newProgramme') }}
          </h2>
          <button
            class="btn btn-ghost btn-icon"
            :aria-label="t('common.close')"
            @click="programmeDraft = null"
          >
            <AppIcon name="close" :size="18" />
          </button>
        </div>

        <div class="card-body stack">
          <div class="field-grid">
            <div class="field">
              <label class="field-label" for="b-name">
                {{ t('bonuses.name') }}<span class="req">*</span>
              </label>
              <input id="b-name" v-model="programmeDraft.name" class="input" :maxlength="LIMITS.position" />
            </div>

            <div class="field">
              <label class="field-label" for="b-metric">{{ t('bonuses.metric') }}</label>
              <select id="b-metric" v-model="programmeDraft.metric" class="select">
                <option v-for="m in BONUS_METRICS" :key="m" :value="m">
                  {{ t(`bonusMetric.${m}`) }}
                </option>
              </select>
              <p class="field-hint">{{ t('bonuses.metricHint') }}</p>
            </div>

            <div class="field">
              <label class="field-label" for="b-audience">{{ t('bonuses.audience') }}</label>
              <select id="b-audience" v-model="programmeDraft.audience" class="select">
                <option v-for="a in BONUS_AUDIENCES" :key="a" :value="a">
                  {{ t(`bonusAudience.${a}`) }}
                </option>
              </select>
            </div>

            <div v-if="programmeDraft.audience === 'department'" class="field">
              <label class="field-label" for="b-dept">{{ t('goals.department') }}</label>
              <select id="b-dept" v-model="programmeDraft.departmentId" class="select">
                <option :value="null">—</option>
                <option v-for="d in departments" :key="d.id" :value="d.id">{{ d.name }}</option>
              </select>
            </div>

            <div v-if="snapshot.services.length" class="field">
              <label class="field-label" for="b-svc">{{ t('goals.service') }}</label>
              <select id="b-svc" v-model="programmeDraft.serviceId" class="select">
                <option :value="null">{{ t('goals.anyService') }}</option>
                <option v-for="s in snapshot.services" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
            </div>

            <div class="field">
              <label class="field-label" for="b-from">{{ t('goals.startDate') }}</label>
              <input id="b-from" v-model="programmeDraft.startDate" class="input" type="date" />
            </div>

            <div class="field">
              <label class="field-label" for="b-to">{{ t('goals.endDate') }}</label>
              <input id="b-to" v-model="programmeDraft.endDate" class="input" type="date" />
            </div>

            <div class="field">
              <label class="field-label" for="b-status">{{ t('table.status') }}</label>
              <select id="b-status" v-model="programmeDraft.status" class="select">
                <option v-for="s in PROGRAMME_STATUSES" :key="s" :value="s">
                  {{ t(`programmeStatus.${s}`) }}
                </option>
              </select>
            </div>
          </div>

          <div v-if="programmeDraft.audience === 'selected'" class="field">
            <span class="field-label">{{ t('bonuses.members') }}</span>
            <div class="picker">
              <label v-for="p in people" :key="p.uid" class="check">
                <input
                  type="checkbox"
                  :checked="programmeDraft.memberUids.includes(p.uid)"
                  @change="toggleMember(p.uid)"
                />
                <span class="check-text">{{ p.firstName }} {{ p.lastName }}</span>
              </label>
            </div>
          </div>

          <!-- Milestones ---------------------------------------------- -->
          <fieldset class="block">
            <legend>{{ t('bonuses.milestones') }}</legend>
            <p class="field-hint">{{ t('bonuses.milestonesHint') }}</p>

            <div v-for="(m, i) in sortedDraftMilestones" :key="m.id" class="level">
              <div class="level-head">
                <span class="level-rank">{{ i + 1 }}</span>
                <span class="level-summary">{{ describeLevel(m) }}</span>
                <button
                  class="btn btn-ghost btn-sm danger"
                  type="button"
                  :aria-label="t('common.delete')"
                  @click="removeMilestone(m.id)"
                >
                  <AppIcon name="trash" :size="14" />
                </button>
              </div>

              <div class="level-grid">
                <div class="field">
                  <label class="field-label" :for="`m-target-${i}`">
                    {{ t('bonuses.target') }}
                  </label>
                  <input
                    :id="`m-target-${i}`"
                    v-model.number="m.target"
                    class="input"
                    type="number"
                    min="0"
                  />
                  <p class="field-hint">{{ t(`bonusMetric.${programmeDraft.metric}`) }}</p>
                </div>

                <div class="field">
                  <label class="field-label" :for="`m-type-${i}`">
                    {{ t('bonuses.rewardType') }}
                  </label>
                  <select :id="`m-type-${i}`" v-model="m.type" class="select">
                    <option v-for="type in REWARD_TYPES" :key="type" :value="type">
                      {{ t(`rewardType.${type}`) }}
                    </option>
                  </select>
                </div>

                <!-- Money and percentage are numbers; everything else is a thing. -->
                <div v-if="m.type === 'money'" class="field">
                  <label class="field-label" :for="`m-amount-${i}`">
                    {{ t('bonuses.rewardAmount') }}
                  </label>
                  <input
                    :id="`m-amount-${i}`"
                    v-model.number="milestoneAmounts[m.id]"
                    class="input"
                    type="number"
                    step="0.01"
                    min="0"
                  />
                </div>

                <div v-else-if="m.type === 'percentage'" class="field">
                  <label class="field-label" :for="`m-percent-${i}`">
                    {{ t('bonuses.rewardPercent') }}
                  </label>
                  <input
                    :id="`m-percent-${i}`"
                    v-model.number="m.rewardPercent"
                    class="input"
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                  />
                  <p class="field-hint">{{ t('bonuses.percentHint') }}</p>
                </div>

                <div v-else class="field">
                  <label class="field-label" :for="`m-label-${i}`">
                    {{ t('bonuses.rewardName') }}
                  </label>
                  <input
                    :id="`m-label-${i}`"
                    v-model="m.rewardLabel"
                    class="input"
                    :maxlength="LIMITS.name"
                    :placeholder="t('bonuses.rewardNamePlaceholder')"
                  />
                </div>
              </div>

              <div class="field">
                <label class="field-label" :for="`m-desc-${i}`">
                  {{ t('bonuses.rewardDescription') }}
                </label>
                <input
                  :id="`m-desc-${i}`"
                  v-model="m.description"
                  class="input"
                  :maxlength="LIMITS.shortText"
                />
              </div>

              <div class="field">
                <label class="field-label" :for="`m-note-${i}`">
                  {{ t('bonuses.levelConditions') }}
                </label>
                <input
                  :id="`m-note-${i}`"
                  v-model="m.note"
                  class="input"
                  :maxlength="LIMITS.shortText"
                  :placeholder="t('bonuses.levelConditionsPlaceholder')"
                />
              </div>

              <!-- A picture, for a reward somebody is meant to want. -->
              <div class="field">
                <span class="field-label">{{ t('bonuses.rewardImage') }}</span>
                <div class="image-row">
                  <img
                    v-if="m.rewardImage"
                    :src="m.rewardImage"
                    alt=""
                    class="image-preview"
                  />
                  <div v-else class="image-empty">
                    <AppIcon name="gift" :size="20" />
                  </div>

                  <div class="image-actions">
                    <label class="btn btn-secondary btn-sm">
                      <input
                        type="file"
                        class="sr-only"
                        :accept="ACCEPTED_TYPES.join(',')"
                        @change="pickImage(m, $event)"
                      />
                      {{ m.rewardImage ? t('bonuses.changeImage') : t('bonuses.addImage') }}
                    </label>
                    <button
                      v-if="m.rewardImage"
                      class="btn btn-ghost btn-sm danger"
                      type="button"
                      @click="m.rewardImage = null"
                    >
                      {{ t('common.remove') }}
                    </button>
                    <p class="field-hint">{{ t('bonuses.imageHint') }}</p>
                  </div>
                </div>
              </div>
            </div>

            <button class="btn btn-secondary btn-sm" type="button" @click="addMilestone">
              <AppIcon name="plus" :size="14" /> {{ t('bonuses.addLevel') }}
            </button>
          </fieldset>

          <div class="switches">
            <label class="check">
              <input v-model="programmeDraft.requiresApproval" type="checkbox" />
              <span class="check-text">{{ t('bonuses.requiresApproval') }}</span>
            </label>
            <label class="check">
              <input v-model="programmeDraft.repeats" type="checkbox" />
              <span class="check-text">{{ t('bonuses.repeats') }}</span>
            </label>
            <label class="check">
              <input v-model="programmeDraft.visibleToStaff" type="checkbox" />
              <span class="check-text">{{ t('bonuses.visibleToStaff') }}</span>
            </label>
          </div>

          <div class="field">
            <label class="field-label" for="b-desc">{{ t('bonuses.description') }}</label>
            <textarea
              id="b-desc"
              v-model="programmeDraft.description"
              class="textarea"
              :maxlength="LIMITS.longText"
            />
          </div>

          <!--
            The rules, in the CEO's words, read by everybody on the programme.
            A reward scheme whose conditions are not written down is one people
            argue about afterwards.
          -->
          <div class="field">
            <label class="field-label" for="b-rules">{{ t('bonuses.rules') }}</label>
            <textarea
              id="b-rules"
              v-model="programmeDraft.rules"
              class="textarea"
              rows="3"
              :maxlength="LIMITS.longText"
              :placeholder="t('bonuses.rulesPlaceholder')"
            />
            <p class="field-hint">{{ t('bonuses.rulesHint') }}</p>
          </div>
        </div>

        <div class="card-footer">
          <button class="btn btn-secondary" @click="programmeDraft = null">
            {{ t('common.cancel') }}
          </button>
          <button class="btn btn-primary" :disabled="saving" @click="commitProgramme">
            <span v-if="saving" class="spinner" />{{ t('common.save') }}
          </button>
        </div>
      </section>

      <div v-if="programmes.length === 0" class="card">
        <div class="empty">
          <span class="empty-icon"><AppIcon name="gift" :size="20" /></span>
          <p class="empty-title">{{ t('bonuses.empty') }}</p>
          <p class="empty-text">{{ t('bonuses.emptyHint') }}</p>
          <button v-if="canManage" class="btn btn-primary" @click="startProgramme">
            {{ t('bonuses.newProgramme') }}
          </button>
        </div>
      </div>

      <section v-for="programme in programmes" :key="programme.id" class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">{{ programme.name }}</h2>
            <p class="field-hint">
              {{ t(`bonusMetric.${programme.metric}`) }} ·
              {{ formatDate(programme.startDate) }} → {{ formatDate(programme.endDate) }}
            </p>
          </div>
          <span class="badge" :class="`pg-${programme.status}`">
            {{ t(`programmeStatus.${programme.status}`) }}
          </span>
          <button v-if="canManage" class="btn btn-ghost btn-sm" @click="editProgramme(programme)">
            <AppIcon name="edit" :size="15" />
          </button>
          <button
            v-if="canManage"
            class="btn btn-ghost btn-sm danger"
            :aria-label="t('common.delete')"
            @click="pendingProgramme = programme"
          >
            <AppIcon name="trash" :size="15" />
          </button>
        </div>

        <p v-if="programme.description" class="card-body muted">{{ programme.description }}</p>

        <!-- Readable before somebody chases the target, not after they miss it. -->
        <div v-if="programme.rules" class="card-body rules">
          <p class="rules-title">{{ t('bonuses.rules') }}</p>
          <p class="rules-body">{{ programme.rules }}</p>
        </div>

        <p v-if="(programme.milestones ?? []).length === 0" class="card-body tertiary small">
          {{ t('bonuses.noMilestones') }}
        </p>

        <!-- The ladder, per person -------------------------------------- -->
        <div v-else class="standings">
          <article v-for="row in standings(programme)" :key="row.uid" class="standing">
            <div class="standing-head">
              <UserAvatar
                :name="row.person ? `${row.person.firstName} ${row.person.lastName}` : row.uid"
                :photo-url="row.person?.photoUrl ?? null"
                :size="30"
              />
              <span class="standing-name">
                {{ row.person ? `${row.person.firstName} ${row.person.lastName}` : row.uid }}
              </span>
              <span class="standing-current">
                {{ displayCount(programme, row.progress.current) }}
              </span>
            </div>

            <!--
              The reward ladder.

              The whole point of this screen is that somebody can see, before
              they start, what reaching each number gets them. So nothing is
              hidden: locked rungs show their reward and their picture exactly
              like earned ones, only quieter. A ladder that reveals the next
              prize only once you have passed it cannot motivate anybody
              towards it.
            -->
            <ol class="ladder">
              <li
                v-for="step in row.progress.milestones"
                :key="step.milestone.id"
                class="rung"
                :class="{
                  'is-reached': step.reached,
                  'is-next': step.milestone.id === row.progress.nextMilestone?.id,
                }"
              >
                <span class="rung-rail" aria-hidden="true">
                  <span class="rung-dot">
                    <AppIcon v-if="step.awardStatus === 'paid'" name="check" :size="12" />
                    <AppIcon v-else-if="step.reached" name="flag" :size="12" />
                  </span>
                </span>

                <div class="rung-card">
                  <img
                    v-if="step.milestone.rewardImage"
                    :src="step.milestone.rewardImage"
                    :alt="step.milestone.rewardLabel"
                    class="rung-image"
                    loading="lazy"
                  />

                  <div class="rung-body">
                    <p class="rung-target">
                      {{ displayCount(programme, step.milestone.target) }}
                    </p>
                    <p class="rung-reward">{{ rewardText(step.milestone, row.progress.current) }}</p>
                    <p v-if="step.milestone.description" class="rung-note tertiary">
                      {{ step.milestone.description }}
                    </p>
                    <p v-if="step.milestone.note" class="rung-note tertiary">
                      {{ step.milestone.note }}
                    </p>

                    <!--
                      Progress, but only on the rung being climbed. Showing a
                      bar on every level turns the ladder into a wall of bars
                      and hides the one number that matters today.
                    -->
                    <template v-if="step.milestone.id === row.progress.nextMilestone?.id">
                      <div
                        class="rung-bar"
                        role="progressbar"
                        :aria-valuenow="Math.round(rungPercent(row.progress, step.milestone))"
                        aria-valuemin="0"
                        aria-valuemax="100"
                      >
                        <span :style="{ width: `${rungPercent(row.progress, step.milestone)}%` }" />
                      </div>
                      <p class="rung-remaining">
                        {{ displayCount(programme, row.progress.current) }}
                        /
                        {{ displayCount(programme, step.milestone.target) }}
                        ·
                        {{
                          t('bonuses.remainingToGo', {
                            amount: displayCount(programme, row.progress.remaining),
                          })
                        }}
                      </p>
                    </template>
                  </div>

                  <div class="rung-side">
                    <span v-if="step.awardStatus" class="badge" :class="`award-${step.awardStatus}`">
                      {{ t(`awardStatus.${step.awardStatus}`) }}
                    </span>
                    <span v-else-if="!step.reached" class="rung-locked tertiary">
                      <AppIcon name="lock" :size="12" />
                      {{ t('bonuses.locked') }}
                    </span>
                    <button
                      v-if="!step.awardStatus && step.reached && canManage && row.uid !== auth.uid"
                      class="btn btn-secondary btn-sm"
                      @click="grant(programme, step.milestone, row.uid)"
                    >
                      {{ t('bonuses.grant') }}
                    </button>
                  </div>
                </div>
              </li>
            </ol>

            <p v-if="!row.progress.nextMilestone" class="next">
              {{ t('bonuses.ladderComplete') }}
            </p>
          </article>
        </div>
      </section>
    </template>

    <!-- ===================== INCENTIVE WORK ===================== -->
    <template v-else-if="tab === 'work'">
      <section v-if="workDraft" class="card editor">
        <div class="card-header">
          <h2 class="card-title">{{ t('bonuses.assignWork') }}</h2>
          <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="workDraft = null">
            <AppIcon name="close" :size="18" />
          </button>
        </div>

        <div class="card-body stack">
          <p class="field-hint">{{ t('bonuses.workHint') }}</p>

          <div class="field-grid">
            <div class="field">
              <label class="field-label" for="w-title">
                {{ t('bonuses.workTitle') }}<span class="req">*</span>
              </label>
              <input id="w-title" v-model="workDraft.title" class="input" :maxlength="LIMITS.position" />
            </div>
            <div class="field">
              <label class="field-label" for="w-assignee">
                {{ t('table.assignee') }}<span class="req">*</span>
              </label>
              <select
                id="w-assignee"
                :value="workDraft.assigneeUid"
                class="select"
                @change="onAssigneeChange(($event.target as HTMLSelectElement).value)"
              >
                <option value="">—</option>
                <option v-for="p in people" :key="p.uid" :value="p.uid">
                  {{ p.firstName }} {{ p.lastName }}
                </option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="w-due">{{ t('table.dueDate') }}</label>
              <input id="w-due" v-model="workDraft.dueDate" class="input" type="date" />
            </div>
            <div class="field">
              <label class="field-label" for="w-reward">{{ t('bonuses.rewardAmount') }}</label>
              <input id="w-reward" v-model.number="workReward" class="input" type="number" step="0.01" />
            </div>
            <div class="field">
              <label class="field-label" for="w-label">{{ t('bonuses.rewardLabel') }}</label>
              <input id="w-label" v-model="workDraft.rewardLabel" class="input" :maxlength="LIMITS.name" />
            </div>
          </div>

          <div class="field">
            <label class="field-label" for="w-desc">{{ t('bonuses.description') }}</label>
            <textarea id="w-desc" v-model="workDraft.description" class="textarea" :maxlength="LIMITS.longText" />
          </div>
        </div>

        <div class="card-footer">
          <button class="btn btn-secondary" @click="workDraft = null">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="saving" @click="commitWork">
            <span v-if="saving" class="spinner" />{{ t('bonuses.assignWork') }}
          </button>
        </div>
      </section>

      <div v-if="work.length === 0" class="card">
        <div class="empty">
          <span class="empty-icon"><AppIcon name="briefcase" :size="20" /></span>
          <p class="empty-title">{{ t('bonuses.noWork') }}</p>
          <p class="empty-text">{{ t('bonuses.noWorkHint') }}</p>
        </div>
      </div>

      <section v-else class="card">
        <div class="table-wrap">
          <table class="table table-cards">
            <thead>
              <tr>
                <th>{{ t('bonuses.workTitle') }}</th>
                <th class="hide-sm">{{ t('table.assignee') }}</th>
                <th class="hide-sm">{{ t('table.dueDate') }}</th>
                <th class="num">{{ t('bonuses.reward') }}</th>
                <th>{{ t('table.status') }}</th>
                <th class="col-actions" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="w in work" :key="w.id">
                <td>
                  <span class="strong">{{ w.title }}</span>
                  <span v-if="w.submissionNote" class="tertiary small block">{{ w.submissionNote }}</span>
                </td>
                <td :data-label="t('table.assignee')" class="hide-sm muted">{{ w.assigneeName }}</td>
                <td :data-label="t('table.dueDate')" class="hide-sm muted nowrap" :class="{ late: w.dueDate && w.dueDate < today }">
                  {{ w.dueDate ? formatDate(w.dueDate) : '—' }}
                </td>
                <td :data-label="t('bonuses.reward')" class="num strong">
                  {{ w.rewardBaseMinor ? money(w.rewardBaseMinor) : w.rewardLabel || '—' }}
                </td>
                <td :data-label="t('table.status')">
                  <span class="badge" :class="`ws-${w.status}`">
                    {{ t(`workStatus.${w.status}`) }}
                  </span>
                </td>
                <td class="col-actions">
                  <button
                    v-if="canApprove && w.status === 'submitted'"
                    class="btn btn-primary btn-sm"
                    @click="reviewing = w"
                  >
                    {{ t('bonuses.review') }}
                  </button>
                  <button
                    v-if="canManage"
                    class="btn btn-ghost btn-sm danger"
                    :aria-label="t('common.delete')"
                    @click="pendingWork = w"
                  >
                    <AppIcon name="trash" :size="15" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!-- ===================== AWARDS ===================== -->
    <template v-else>
      <div class="figures">
        <article class="card figure">
          <span class="figure-label">{{ t('bonuses.owed') }}</span>
          <span class="figure-value warn">{{ money(owed) }}</span>
          <span class="figure-hint">{{ t('bonuses.owedHint') }}</span>
        </article>
      </div>

      <div class="toolbar">
        <select v-model="statusFilter" class="select compact" :aria-label="t('table.status')">
          <option value="">{{ t('clients.allStatuses') }}</option>
          <option v-for="s in AWARD_STATUSES" :key="s" :value="s">{{ t(`awardStatus.${s}`) }}</option>
        </select>
      </div>

      <div v-if="awards.length === 0" class="card">
        <div class="empty">
          <span class="empty-icon"><AppIcon name="gift" :size="20" /></span>
          <p class="empty-title">{{ t('bonuses.noAwards') }}</p>
          <p class="empty-text">{{ t('bonuses.noAwardsHint') }}</p>
        </div>
      </div>

      <section v-else class="card">
        <div class="table-wrap">
          <table class="table table-cards">
            <thead>
              <tr>
                <th>{{ t('table.employee') }}</th>
                <th>{{ t('bonuses.reason') }}</th>
                <th class="hide-sm">{{ t('bonuses.source') }}</th>
                <th class="num">{{ t('table.amount') }}</th>
                <th class="hide-sm">{{ t('bonuses.earnedDate') }}</th>
                <th class="hide-md">{{ t('bonuses.paidDate') }}</th>
                <th>{{ t('table.status') }}</th>
                <th class="col-actions" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in awards" :key="a.id">
                <td class="strong">{{ a.employeeName }}</td>
                <td :data-label="t('bonuses.reason')">{{ a.reason || a.sourceLabel }}</td>
                <td :data-label="t('bonuses.source')" class="hide-sm muted">{{ t(`awardSource.${a.source}`) }}</td>
                <td :data-label="t('table.amount')" class="num strong">
                  {{ a.amountBaseMinor ? money(a.amountBaseMinor) : a.rewardLabel || '—' }}
                </td>
                <td :data-label="t('bonuses.earnedDate')" class="hide-sm muted nowrap">{{ formatDate(a.earnedDate) }}</td>
                <td :data-label="t('bonuses.paidDate')" class="hide-md muted nowrap">
                  {{ a.paidAt ? formatDate(a.paidAt.slice(0, 10)) : '—' }}
                </td>
                <td :data-label="t('table.status')">
                  <span class="badge" :class="`as-${a.status}`">
                    {{ t(`awardStatus.${a.status}`) }}
                  </span>
                </td>
                <td class="col-actions">
                  <template v-if="canApprove && a.employeeUid !== auth.uid">
                    <button
                      v-if="a.status === 'pending'"
                      class="btn btn-secondary btn-sm"
                      @click="decideAward(a, 'earned')"
                    >
                      {{ t('bonuses.markEarned') }}
                    </button>
                    <button
                      v-if="a.status === 'earned'"
                      class="btn btn-primary btn-sm"
                      @click="decideAward(a, 'approved')"
                    >
                      {{ t('bonuses.approve') }}
                    </button>
                    <button
                      v-if="a.status === 'approved'"
                      class="btn btn-secondary btn-sm"
                      @click="decideAward(a, 'paid')"
                    >
                      {{ t('bonuses.markPaid') }}
                    </button>
                    <button
                      v-if="a.status === 'pending' || a.status === 'earned'"
                      class="btn btn-ghost btn-sm danger"
                      @click="decideAward(a, 'rejected')"
                    >
                      {{ t('bonuses.reject') }}
                    </button>
                  </template>
                  <span v-else-if="a.employeeUid === auth.uid" class="tertiary small">
                    {{ t('bonuses.approveOwn') }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>

    <!-- Review a submission ------------------------------------------- -->
    <div v-if="reviewing" class="modal-backdrop" @click.self="reviewing = null">
      <section class="card modal">
        <div class="card-header">
          <h2 class="card-title">{{ t('bonuses.review') }}</h2>
          <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="reviewing = null">
            <AppIcon name="close" :size="18" />
          </button>
        </div>

        <div class="card-body stack">
          <p class="strong">{{ reviewing.title }}</p>
          <p class="tertiary small">{{ reviewing.assigneeName }}</p>
          <p v-if="reviewing.submissionNote" class="prose">{{ reviewing.submissionNote }}</p>
          <p class="field-hint">{{ t('bonuses.reviewHint') }}</p>

          <div class="field">
            <label class="field-label" for="rv-note">{{ t('bonuses.reviewNote') }}</label>
            <textarea id="rv-note" v-model="reviewNote" class="textarea" :maxlength="LIMITS.longText" />
          </div>
        </div>

        <div class="card-footer">
          <button class="btn btn-ghost danger" :disabled="saving" @click="decideWork(false)">
            {{ t('bonuses.reject') }}
          </button>
          <span class="spacer" />
          <button class="btn btn-secondary" @click="reviewing = null">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="saving" @click="decideWork(true)">
            <span v-if="saving" class="spinner" />{{ t('bonuses.approve') }}
          </button>
        </div>
      </section>
    </div>

    <!-- Grant a one-off ------------------------------------------------ -->
    <div v-if="manualOpen" class="modal-backdrop" @click.self="manualOpen = false">
      <section class="card modal">
        <div class="card-header">
          <h2 class="card-title">{{ t('bonuses.grantManual') }}</h2>
          <button class="btn btn-ghost btn-icon" :aria-label="t('common.close')" @click="manualOpen = false">
            <AppIcon name="close" :size="18" />
          </button>
        </div>

        <div class="card-body stack">
          <div class="field">
            <label class="field-label" for="mn-uid">{{ t('table.employee') }}</label>
            <select id="mn-uid" v-model="manual.uid" class="select">
              <option value="">—</option>
              <option v-for="p in people" :key="p.uid" :value="p.uid">
                {{ p.firstName }} {{ p.lastName }}
              </option>
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="mn-reason">{{ t('bonuses.reason') }}</label>
            <input id="mn-reason" v-model="manual.reason" class="input" :maxlength="LIMITS.position" />
          </div>
          <div class="field-grid">
            <div class="field">
              <label class="field-label" for="mn-amount">{{ t('bonuses.rewardAmount') }}</label>
              <input id="mn-amount" v-model.number="manual.amount" class="input" type="number" step="0.01" />
            </div>
            <div class="field">
              <label class="field-label" for="mn-label">{{ t('bonuses.rewardLabel') }}</label>
              <input id="mn-label" v-model="manual.label" class="input" :maxlength="LIMITS.name" />
            </div>
          </div>
        </div>

        <div class="card-footer">
          <button class="btn btn-secondary" @click="manualOpen = false">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="saving" @click="commitManual">
            <span v-if="saving" class="spinner" />{{ t('bonuses.grant') }}
          </button>
        </div>
      </section>
    </div>

    <ConfirmDialog
      :open="pendingProgramme !== null"
      :title="t('bonuses.deleteProgramme')"
      :message="t('recycle.deleteExplain')"
      danger
      @confirm="confirmDeleteProgramme"
      @cancel="pendingProgramme = null"
    />

    <ConfirmDialog
      :open="pendingWork !== null"
      :title="t('bonuses.deleteWork')"
      :message="t('recycle.deleteExplain')"
      danger
      @confirm="confirmDeleteWork"
      @cancel="pendingWork = null"
    />
  </div>
</template>

<style scoped>
.head-actions { display: flex; gap: var(--space-2); }
.note {
  display: flex; align-items: flex-start; gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle); border-radius: var(--radius-md);
  background: var(--bg-inset); color: var(--text-secondary);
}
.note-title { font-size: var(--text-sm); font-weight: 650; color: var(--text-primary); }
.note-text { font-size: var(--text-xs); line-height: var(--leading-relaxed); margin-top: 2px; }

.tabs { display: flex; gap: var(--space-1); border-bottom: 1px solid var(--border-subtle); overflow-x: auto; }
.tab { padding: var(--space-3) var(--space-4); border-bottom: 2px solid transparent; font-size: var(--text-base); font-weight: 550; color: var(--text-secondary); white-space: nowrap; }
.tab:hover { color: var(--text-primary); }
.tab.is-active { color: var(--text-brand); border-bottom-color: var(--accent); }

.editor { border-color: var(--accent-soft-border); }
.block { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-3); }
.block > legend { padding: 0 var(--space-2); font-size: var(--text-sm); font-weight: 650; }
/* ---- The level editor ------------------------------------------------ */

.level {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-surface-2);
  margin-bottom: var(--space-3);
}

.level-head { display: flex; align-items: center; gap: var(--space-3); }

.level-rank {
  display: grid; place-items: center;
  width: 22px; height: 22px; flex-shrink: 0;
  border-radius: 50%;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  font-size: var(--text-xs); font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.level-summary { flex: 1; font-weight: 600; font-size: var(--text-sm); }

.level-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-3);
  align-items: start;
}

.image-row { display: flex; gap: var(--space-3); align-items: flex-start; }

.image-preview {
  width: 96px; height: 72px; flex-shrink: 0;
  object-fit: contain;
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
}

.image-empty {
  display: grid; place-items: center;
  width: 96px; height: 72px; flex-shrink: 0;
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-default);
  color: var(--text-tertiary);
}

.image-actions { display: flex; flex-direction: column; gap: var(--space-2); align-items: flex-start; }
.image-actions .btn { cursor: pointer; }

/* ---- Standings -------------------------------------------------------- */

.standings { display: flex; flex-direction: column; }
.standing {
  padding: var(--space-5);
  border-top: 1px solid var(--border-subtle);
  display: flex; flex-direction: column; gap: var(--space-4);
}
.standing-head { display: flex; align-items: center; gap: var(--space-3); }
.standing-name { flex: 1; font-weight: 600; }
.standing-current {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-brand);
}

/* ---- The reward ladder ------------------------------------------------ *
 *
 * A vertical timeline: a rail down the left with a marker per level, and the
 * reward beside it. Restrained on purpose — the specification asked for this
 * to read as premium rather than as a game, so the only colour is on the level
 * being climbed and the ones already won. Locked levels are quiet but fully
 * legible, because being able to read them is the entire point.
 */

.ladder {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: var(--space-3);
}

.rung { display: flex; gap: var(--space-3); align-items: stretch; }

/* The rail is drawn per rung so it stops cleanly at the last one. */
.rung-rail {
  position: relative;
  flex: 0 0 20px;
  display: flex; justify-content: center;
}

.rung-rail::before {
  content: ''; position: absolute;
  top: 22px; bottom: calc(var(--space-3) * -1);
  width: 2px; background: var(--border-subtle);
}

.rung:last-child .rung-rail::before { display: none; }

.rung-dot {
  position: relative; z-index: 1;
  display: grid; place-items: center;
  width: 20px; height: 20px; margin-top: 2px;
  border-radius: 50%;
  border: 2px solid var(--border-default);
  background: var(--bg-surface);
  color: var(--text-tertiary);
}

.rung.is-reached .rung-dot {
  border-color: var(--ok-500);
  background: var(--ok-bg);
  color: var(--ok-500);
}

.rung.is-next .rung-dot { border-color: var(--brand-500); }

.rung-card {
  flex: 1; min-width: 0;
  display: flex; gap: var(--space-3); align-items: flex-start;
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
}

.rung.is-next .rung-card {
  border-color: var(--brand-500);
  background: var(--bg-surface-2);
}

/* A locked level is dimmed, never hidden. */
.rung:not(.is-reached):not(.is-next) .rung-card { opacity: 0.72; }

.rung-image {
  width: 84px; height: 64px; flex-shrink: 0;
  object-fit: contain;
  border-radius: var(--radius-md);
  background: var(--bg-surface-2);
}

.rung-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }

.rung-target {
  font-size: var(--text-sm); font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.rung-reward { font-size: var(--text-sm); color: var(--text-secondary); }
.rung-note { font-size: var(--text-xs); }

.rung-bar {
  height: 5px; margin-top: var(--space-2);
  border-radius: 3px; overflow: hidden;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
}

.rung-bar > span {
  display: block; height: 100%;
  background: var(--brand-500);
  transition: width var(--dur-slow) var(--ease-out);
}

.rung-remaining {
  margin-top: var(--space-1);
  font-size: var(--text-xs); font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-brand);
}

.rung-side {
  display: flex; flex-direction: column; align-items: flex-end;
  gap: var(--space-2); flex-shrink: 0;
}

.rung-locked {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: var(--text-xs);
}

.next { font-size: var(--text-sm); font-weight: 600; color: var(--ok-500); }

.rules {
  padding-top: 0;
  border-left: 2px solid var(--border-default);
  margin-left: var(--space-5);
  padding-left: var(--space-4);
}
.rules-title {
  font-size: var(--text-xs); font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em;
  color: var(--text-tertiary);
  margin-bottom: var(--space-1);
}
.rules-body { font-size: var(--text-sm); color: var(--text-secondary); white-space: pre-wrap; }

@media (max-width: 640px) {
  .rung-card { flex-direction: column; }
  .rung-image { width: 100%; height: 120px; }
  .rung-side { flex-direction: row; align-items: center; align-self: stretch; }
  .image-row { flex-direction: column; }
}

.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--space-3); }
.figure { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4); }
.figure-label { font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-tertiary); }
.figure-value { font-size: var(--text-lg); font-weight: 700; font-variant-numeric: tabular-nums; }
.figure-hint { font-size: var(--text-xs); color: var(--text-tertiary); }
.select.compact { max-width: 200px; }

.modal-backdrop { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; padding: var(--space-4); background: rgb(0 0 0 / 45%); }
.modal { width: min(520px, 100%); box-shadow: var(--shadow-lg); }
.spacer { flex: 1; }
.prose { font-size: var(--text-sm); line-height: var(--leading-relaxed); white-space: pre-wrap; }

.num { text-align: right; font-variant-numeric: tabular-nums; }
.strong { font-weight: 650; }
.block { display: block; }
.warn { color: var(--warn-500); }
.late { color: var(--danger-500); font-weight: 600; }
.nowrap { white-space: nowrap; }
.small { font-size: var(--text-xs); }
.danger:hover { color: var(--danger-500); }

.pg-active, .ws-approved, .as-paid { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok-500); }
.pg-draft, .ws-assigned, .as-pending { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }
.pg-ended, .ws-cancelled, .as-cancelled { background: var(--bg-inset); border-color: var(--border-subtle); color: var(--text-tertiary); }
.ws-in_progress, .as-earned { background: var(--accent-soft-bg); border-color: var(--accent-soft-border); color: var(--text-brand); }
.ws-submitted, .as-approved { background: var(--warn-bg); border-color: var(--warn-border); color: var(--warn-500); }
.ws-rejected, .as-rejected { background: var(--danger-bg); border-color: var(--danger-border); color: var(--danger-500); }

</style>
