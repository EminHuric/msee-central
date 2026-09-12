/**
 * Find components used in a template that nothing imports.
 *
 * WHY THIS EXISTS.
 *
 * `<script setup>` resolves a component by the name in scope. With no
 * auto-import plugin — and this project has none, deliberately, because an
 * invisible resolution step is worse than a line at the top of the file — a
 * PascalCase tag nobody imported is not an error. Vue logs
 * "Failed to resolve component" to the console and renders an empty element.
 *
 * So the page looks finished, the build passes, vue-tsc passes, and a whole
 * panel is missing. That happened here: ClientTradingPanel sat in
 * ClientProfileView's finance tab for a commit without an import, which means
 * the three figures it exists to show were never on screen once.
 *
 * A missing import is the one kind of dead UI that leaves no trace in the
 * code — which is exactly what a check is for.
 *
 *   npm run components:check
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const src = join(root, 'src')

/* Registered once, for everybody: router-view, router-link, transitions. */
const GLOBAL = new Set([
  'RouterView',
  'RouterLink',
  'Transition',
  'TransitionGroup',
  'KeepAlive',
  'Teleport',
  'Suspense',
  'Component',
])

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.vue')) out.push(full)
  }
  return out
}

/**
 * The template, without its script block.
 *
 * Taken by cutting the script out rather than by matching `<template>`, because
 * a template can contain a nested `<template v-if>` and the naive match stops
 * at the first closing tag.
 */
function templateOf(text) {
  return text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
}

/** Names bound at the top of the file: imports, and anything declared. */
function scopeOf(text) {
  const names = new Set()

  for (const [, clause] of text.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]/g)) {
    for (const part of clause.replace(/[{}]/g, ',').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name)
    }
  }

  /* defineAsyncComponent, a local alias, a component held in a ref. */
  for (const [, name] of text.matchAll(/(?:const|let|var)\s+([A-Z][\w$]*)\s*=/g)) {
    names.add(name)
  }

  return names
}

const problems = []
let checked = 0

for (const file of walk(src)) {
  const text = readFileSync(file, 'utf8')
  const scope = scopeOf(text)
  const template = templateOf(text)
  const seen = new Set()
  checked += 1

  for (const [, tag] of template.matchAll(/<([A-Z][A-Za-z0-9]*)[\s/>]/g)) {
    if (seen.has(tag) || GLOBAL.has(tag) || scope.has(tag)) continue
    seen.add(tag)
    problems.push([file.slice(src.length + 1), tag])
  }
}

console.log('\n  Component resolution')
console.log(`  files: ${checked}\n`)

if (!problems.length) {
  console.log('  ok — every component used in a template is in scope\n')
  process.exit(0)
}

console.log('  used in a template but never imported — renders as nothing')
for (const [file, tag] of problems) {
  console.log(`    ${tag.padEnd(28)} ${file}`)
}
console.log(`\n  ${problems.length} missing import(s)\n`)
process.exit(1)
