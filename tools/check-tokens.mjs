/**
 * Undefined CSS custom properties.
 *
 * `background: var(--bg-elevated)` where nothing defines `--bg-elevated` does
 * not fall back to anything and does not warn. The browser drops the
 * declaration and moves on, so the element simply has no background — and a
 * panel with no background is transparent, which is exactly how the
 * notification list ended up unreadable with the page showing through it.
 *
 * Nothing else in this repo can see that. A type-check does not read CSS, a
 * build does not resolve variables, and the mistake is one character away from
 * a name that does exist.
 *
 * A property used with a fallback — `var(--x, 12px)` — is fine by construction
 * and is not reported.
 *
 *   npm run tokens:check
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('../src', import.meta.url))

function files(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return files(full)
    return /\.(css|vue)$/.test(entry) ? [full] : []
  })
}

const sources = files(srcDir)

/* ---- What is defined ---------------------------------------------------- */

const defined = new Set()

for (const file of sources) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1])
}

/*
 * Properties set from JavaScript rather than in a stylesheet — a chart writing
 * `style="--width: 40%"`, for instance. Matching the binding is enough: the
 * point is that something assigns it.
 */
for (const file of sources) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/['"`](--[\w-]+)['"`]\s*:/g)) defined.add(m[1])
}

/* ---- What is used ------------------------------------------------------- */

const missing = new Map()

for (const file of sources) {
  const text = readFileSync(file, 'utf8')
  const name = file.replace(/^.*[/\\]src[/\\]/, '').replace(/\\/g, '/')

  for (const m of text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
    const [, property, next] = m
    /* A fallback makes it safe whatever happens. */
    if (next === ',') continue
    if (defined.has(property)) continue

    const line = text.slice(0, m.index).split('\n').length
    if (!missing.has(property)) missing.set(property, [])
    missing.get(property).push(`${name}:${line}`)
  }
}

/* ---- Report ------------------------------------------------------------- */

console.log('\n  Design token check')
console.log(`  defined: ${defined.size}    files: ${sources.length}\n`)

if (missing.size === 0) {
  console.log('  ok — every custom property used is defined somewhere\n')
  process.exit(0)
}

console.log('  used but never defined — these declarations are silently dropped')
for (const [property, places] of missing) {
  console.log(`    ${property}`)
  for (const place of places.slice(0, 4)) console.log(`      ${place}`)
}
console.log(`\n  ${missing.size} undefined propert${missing.size === 1 ? 'y' : 'ies'}\n`)
process.exit(1)
