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
console.log(`  en: ${enPaths.length} keys    sr: ${srPaths.length} keys\n`)

function report(title, rows, format) {
  if (rows.length === 0) return 0
  console.log(`  ${title}`)
  for (const row of rows.slice(0, 40)) console.log(`    ${format(row)}`)
  if (rows.length > 40) console.log(`    ... and ${rows.length - 40} more`)
  console.log('')
  return rows.length
}

let problems = 0
problems += report('missing in sr.ts', missingInSr, (p) => p)
problems += report('missing in en.ts', missingInEn, (p) => p)
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
