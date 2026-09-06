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
 * Only literal keys are collected. A key built at runtime — `taskStatus.${s}`
 * — is skipped, because its prefix is checked instead: if `taskStatus` exists
 * at all, the enum values under it are covered by the parity check above.
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
  for (const row of rows.slice(0, 40)) console.log(`    ${format(row)}`)
  if (rows.length > 40) console.log(`    ... and ${rows.length - 40} more`)
  console.log('')
  return rows.length
}

let problems = 0
problems += report('duplicate keys in en.ts', duplicateKeys(enSource), (k) => k)
problems += report('duplicate keys in sr.ts', duplicateKeys(srSource), (k) => k)
problems += report('missing in sr.ts', missingInSr, (p) => p)
problems += report('missing in en.ts', missingInEn, (p) => p)
problems += report('used in src but missing from the catalogue', unknownKeys, (r) => r)
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
