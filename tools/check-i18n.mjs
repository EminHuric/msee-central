/**
 * Translation parity check.
 *
 * Compares the English and Serbian catalogues key by key, at every depth, and
 * fails if they diverge. A missing key means the application silently falls
 * back to English for one label — the kind of hole nobody notices until a
 * customer does.
 *
 * It also catches structural damage: an editing slip that drops a whole
 * section shows up here as dozens of missing keys rather than as a confusing
 * TypeScript error hundreds of lines away.
 *
 *   npm run i18n:check
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ACCOUNT_TYPES,
  ACTIVITY_KINDS,
  AFFILIATE_TYPES,
  ANNOUNCEMENT_AUDIENCES,
  AUDIT_ACTIONS,
  AWARD_SOURCES,
  AWARD_STATUSES,
  BONUS_AUDIENCES,
  BONUS_METRICS,
  CLIENT_SOURCES,
  CLIENT_STATUSES,
  COMMISSION_MODELS,
  COMMISSION_STATUSES,
  CONTACT_CHANNELS,
  EMPLOYMENT_STATUSES,
  EVENT_KINDS,
  FIELD_ENTITIES,
  FIELD_TYPES,
  FIELD_VISIBILITY,
  GOAL_METRICS,
  GOAL_SCOPES,
  GOAL_STATUSES,
  GOAL_VISIBILITY,
  KPI_METRICS,
  LEAD_STAGES,
  NOTIFICATION_KINDS,
  NOTIFICATION_PRIORITIES,
  PAYMENT_MODELS,
  PAYMENT_STATES,
  PERMISSION_GROUPS,
  PRICING_MODELS,
  PRIORITIES,
  PROGRAMME_STATUSES,
  PROJECT_STATUSES,
  RECOVERABLE,
  SALE_CHANNELS,
  TRANSACTION_CATEGORIES,
  TRANSACTION_TYPES,
  WORK_STATUSES,
} from './i18n-sources.mjs'
import { ALL_PERMISSIONS } from '../src/types/permissions.ts'
import en from '../src/i18n/locales/en.ts'
import sr from '../src/i18n/locales/sr.ts'

/** Flatten to dotted paths so the report names the exact key. */
function paths(value, prefix = '') {
  if (value === null || typeof value !== 'object') return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key),
  )
}

/**
 * Placeholders such as {min} must survive translation, or the text breaks.
 *
 * Compares the distinct NAMES used, not how many times each appears: a plural
 * string legitimately repeats {n} once per form, and Serbian has four forms
 * where English has three.
 */
function placeholders(text) {
  if (typeof text !== 'string') return []
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()
}

function at(root, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), root)
}

/**
 * Duplicate keys in the source text.
 *
 * A repeated key is legal JavaScript — the last one silently wins — so the
 * flattened object above can never reveal it. TypeScript does complain, but
 * only after a build, pointing at a line number rather than a name. This has
 * bitten twice while adding navigation labels, so it is checked here where the
 * report is readable.
 */
function duplicateKeys(source) {
  const found = []
  const seen = new Map()
  const lines = source.split(/\r?\n/)
  let section = ''

  for (const line of lines) {
    const opening = /^ {2}([A-Za-z][\w]*): \{/.exec(line)
    if (opening) {
      section = opening[1]
      seen.set(section, new Set())
      continue
    }

    const entry = /^ {4}'?([A-Za-z][\w]*)'?:/.exec(line)
    if (entry && section) {
      const keys = seen.get(section)
      if (keys.has(entry[1])) found.push(`${section}.${entry[1]}`)
      else keys.add(entry[1])
    }
  }

  return found
}

/**
 * Keys the application asks for that the catalogue does not have.
 *
 * vue-i18n does not fail on a missing key — it prints the key itself, so the
 * screen reads `tasks.showDone` where a label should be. Nothing catches that
 * except opening the page, which is exactly the check nobody performs on the
 * screen they did not touch.
 *
 * Literal keys are collected here. Keys built at runtime are handled below,
 * and they are the ones that actually bite.
 */
function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(vue|ts)$/.test(entry) && !full.includes('locales') ? [full] : []
  })
}

function usedKeys() {
  const found = new Map()

  for (const file of sourceFiles(fileURLToPath(new URL('../src', import.meta.url)))) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) {
      if (!found.has(m[1])) found.set(m[1], file)
    }
    // Interpolated keys: check the fixed prefix only.
    for (const m of text.matchAll(/\bt\(\s*`([a-zA-Z][\w.]*)\.\$\{/g)) {
      if (!found.has(m[1])) found.set(m[1], file)
    }
  }

  return found
}

const used = usedKeys()
const unknownKeys = [...used]
  .filter(([key]) => at(en, key) === undefined)
  .map(([key, file]) => `${key}   ${file.replace(/^.*[/\\]src[/\\]/, '')}`)

/**
 * Runtime keys: `t(`kpi.${metric}`)`.
 *
 * These are where labels actually go missing, and the old version of this file
 * was blind to every one of them. Its reasoning was that checking the prefix
 * was enough — if `kpi` exists, the values under it must be fine. That is
 * false, and it shipped: the `kpi` section still listed `sales_won` and
 * `tasks_completed` long after those metrics were replaced, so the performance
 * screen rendered the literal text `kpi.revenue_collected` at somebody.
 *
 * Parity could never catch it either. Parity compares the two catalogues with
 * each other; when a value is missing from *both*, they agree perfectly.
 *
 * So each prefix is checked against the list that feeds it. The map below is
 * the whole point, and it is enforced: a dynamic prefix found in `src/` with
 * no entry here is itself reported, so the next one cannot slip through by
 * simply not being listed.
 */
const withHints = (values) => [...values, ...values.map((v) => `${v}Hint`)]

const DYNAMIC_KEYS = {
  /* Two selectors render a value and, under it, a sentence explaining it. */
  accountType: withHints(ACCOUNT_TYPES),
  activityKind: ACTIVITY_KINDS,
  affiliateType: AFFILIATE_TYPES,
  announceAudience: ANNOUNCEMENT_AUDIENCES,
  auditAction: AUDIT_ACTIONS,
  awardSource: AWARD_SOURCES,
  awardStatus: AWARD_STATUSES,
  bonusAudience: BONUS_AUDIENCES,
  bonusMetric: BONUS_METRICS,
  clientStatus: CLIENT_STATUSES,
  commissionModel: COMMISSION_MODELS,
  commissionStatus: COMMISSION_STATUSES,
  contactChannel: CONTACT_CHANNELS,
  employmentStatus: EMPLOYMENT_STATUSES,
  eventKind: EVENT_KINDS,
  'fields.entity': FIELD_ENTITIES,
  'fields.type': FIELD_TYPES,
  'fields.visibility': FIELD_VISIBILITY,
  goalMetric: GOAL_METRICS,
  goalScope: GOAL_SCOPES,
  goalStatus: GOAL_STATUSES,
  goalVisibility: GOAL_VISIBILITY,
  kpi: KPI_METRICS,
  leadStage: LEAD_STAGES,
  notificationKind: NOTIFICATION_KINDS,
  notificationPriority: NOTIFICATION_PRIORITIES,
  paymentModel: PAYMENT_MODELS,
  payState: PAYMENT_STATES,
  payStatus: PAYMENT_STATES,
  permissionGroup: PERMISSION_GROUPS.map((g) => g.key),
  pricingModel: PRICING_MODELS,
  priority: PRIORITIES,
  programmeStatus: PROGRAMME_STATUSES,
  projectStatus: PROJECT_STATUSES,
  'recycle.kinds': RECOVERABLE,
  saleChannel: SALE_CHANNELS,
  source: CLIENT_SOURCES,
  transactionCategory: TRANSACTION_CATEGORIES,
  transactionType: TRANSACTION_TYPES,
  visibility: withHints(FIELD_VISIBILITY),
  workStatus: WORK_STATUSES,
}

/**
 * Prefixes whose values are not an enum: a fixed set of hand-written labels
 * indexed by something the code decides. Listing them is the deliberate act of
 * saying "no list backs this one", so they do not silently count as covered.
 */
const FREEFORM_PREFIXES = new Set(['tabs', 'status', 'period', 'dossier', 'permission'])

function dynamicPrefixes() {
  const found = new Map()
  for (const file of sourceFiles(fileURLToPath(new URL('../src', import.meta.url)))) {
    const text = readFileSync(file, 'utf8')
    /*
     * The prefix may be several segments deep — `fields.type.${f.type}` — and
     * an earlier version of this pattern stopped at the first dot, so those
     * families were neither checked nor reported as unchecked. Silence from a
     * tool is worse than a warning from one.
     */
    for (const m of text.matchAll(/\bt\(\s*`([a-zA-Z][\w.]*)\.\$\{/g)) {
      if (!found.has(m[1])) found.set(m[1], file.replace(/^.*[/\\]src[/\\]/, ''))
    }
  }
  return found
}

const dynamic = dynamicPrefixes()

const unmappedPrefixes = [...dynamic]
  .filter(([prefix]) => !(prefix in DYNAMIC_KEYS) && !FREEFORM_PREFIXES.has(prefix))
  .map(([prefix, file]) => `${prefix}.*   ${file}`)

/*
 * The value is looked up as one key inside the section, not by walking dots.
 * Audit actions are named `account.approved`, and the catalogue holds that as
 * a single quoted key — walking it would look for a nested `account` object
 * that was never meant to exist.
 */
const dynamicMissing = []
for (const [prefix, values] of Object.entries(DYNAMIC_KEYS)) {
  for (const [lang, catalogue] of [
    ['en', en],
    ['sr', sr],
  ]) {
    const section = at(catalogue, prefix)
    for (const value of values) {
      if (section?.[value] === undefined) {
        dynamicMissing.push(`${prefix}.${value}   missing from ${lang}.ts`)
      }
    }
  }
}

/**
 * The other direction: a label under a checked prefix that no longer has a
 * value behind it. Harmless on screen, but it is how `kpi.sales_won` survived
 * the metric being deleted, and a stale label reads as a supported feature.
 *
 * A section may legitimately hold more than its enum — `accountType` carries
 * the two values plus the heading above them. Those are asked for by name, so
 * anything referenced literally in `src/` is not stale.
 */
const staleLabels = []
for (const [prefix, values] of Object.entries(DYNAMIC_KEYS)) {
  const section = at(en, prefix)
  if (!section || typeof section !== 'object') continue
  const live = new Set(values)
  for (const key of Object.keys(section)) {
    if (!live.has(key) && !used.has(`${prefix}.${key}`)) staleLabels.push(`${prefix}.${key}`)
  }
}


/**
 * Every permission needs a label and a description.
 *
 * The role editor renders `permission.<key>.label`, and vue-i18n prints the
 * key itself when it is missing — so a permission added without text shows up
 * in the CEO's role editor as `permission.sales.view_all.label`, which tells
 * whoever is handing out access precisely nothing. That happened once already.
 */
const permissionText = ALL_PERMISSIONS.flatMap((key) => {
  const missing = []
  if (at(en, `permission.${key}.label`) === undefined) missing.push(`permission.${key}.label`)
  if (at(en, `permission.${key}.description`) === undefined) {
    missing.push(`permission.${key}.description`)
  }
  return missing
})

const enSource = readFileSync(new URL('../src/i18n/locales/en.ts', import.meta.url), 'utf8')
const srSource = readFileSync(new URL('../src/i18n/locales/sr.ts', import.meta.url), 'utf8')

const enPaths = paths(en)
const srPaths = paths(sr)
const enSet = new Set(enPaths)
const srSet = new Set(srPaths)

const missingInSr = enPaths.filter((p) => !srSet.has(p))
const missingInEn = srPaths.filter((p) => !enSet.has(p))

const placeholderMismatch = enPaths
  .filter((p) => srSet.has(p))
  .map((p) => ({ path: p, en: placeholders(at(en, p)), sr: placeholders(at(sr, p)) }))
  .filter((row) => row.en.join() !== row.sr.join())

console.log('\n  Translation parity')
console.log(`  en: ${enPaths.length} keys    sr: ${srPaths.length} keys    used in src: ${used.size}\n`)

function report(title, rows, format) {
  if (rows.length === 0) return 0
  console.log(`  ${title}`)
  for (const row of rows.slice(0, 200)) console.log(`    ${format(row)}`)
  if (rows.length > 200) console.log(`    ... and ${rows.length - 200} more`)
  console.log('')
  return rows.length
}

let problems = 0
problems += report('duplicate keys in en.ts', duplicateKeys(enSource), (k) => k)
problems += report('duplicate keys in sr.ts', duplicateKeys(srSource), (k) => k)
problems += report('missing in sr.ts', missingInSr, (p) => p)
problems += report('missing in en.ts', missingInEn, (p) => p)
problems += report('used in src but missing from the catalogue', unknownKeys, (r) => r)
problems += report('runtime key with no label — this renders as raw text', dynamicMissing, (r) => r)
problems += report('label for a value that no longer exists', staleLabels, (r) => r)
problems += report('runtime prefix nothing checks — add it to DYNAMIC_KEYS', unmappedPrefixes, (r) => r)
problems += report('permission with no plain-language text', permissionText, (r) => r)
problems += report(
  'placeholder mismatch',
  placeholderMismatch,
  (r) => `${r.path}   en {${r.en.join(', ')}}   sr {${r.sr.join(', ')}}`,
)

if (problems === 0) {
  console.log('  ok — catalogues match\n')
  process.exit(0)
}

console.log(`  ${problems} problem(s)\n`)
process.exit(1)
