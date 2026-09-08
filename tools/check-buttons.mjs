/**
 * Dead-control check.
 *
 * Finds every `<button>` and `<RouterLink>` in the templates and reports the
 * ones that cannot do anything: no `@click`, not a form submit, no `to`.
 *
 * This exists because a button that renders and does nothing is the single
 * most expensive kind of bug in an internal tool. It does not throw, it does
 * not log, and it does not fail a build. Somebody clicks "Add client", nothing
 * happens, and they conclude the system is broken — which, for them, it is.
 *
 * Buttons are matched across line breaks because almost every one here is
 * written over several lines with its attributes indented.
 *
 *   npm run buttons:check
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('../src', import.meta.url))

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return entry.endsWith('.vue') ? [full] : []
  })
}

/** Everything that makes a control actually do something. */
const ACTIONS = [
  /@click/,
  /v-on:click/,
  /@submit/,
  /type="submit"/,
  /\bto="/,
  /:to="/,
  /@change/,
  /v-model/,
]

/**
 * The opening tag's attributes, from `<button` to the matching `>`.
 *
 * Scanned character by character rather than by regex, because attribute
 * values contain `>` all the time — `v-if="items.some((n) => !n.read)"` is
 * ordinary Vue. A regex that stops at the first `>` truncates the attributes
 * mid-value and then reports a perfectly wired button as dead. That is exactly
 * what the first version of this file did, on five real buttons, which is a
 * good reminder that a checker producing false alarms gets ignored and then
 * catches nothing at all.
 */
function attributesAt(text, start) {
  let quote = null
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return text.slice(start, i)
    }
  }
  return text.slice(start)
}

const dead = []

for (const file of sourceFiles(srcDir)) {
  const text = readFileSync(file, 'utf8')
  const name = file.replace(/^.*[/\\]src[/\\]/, '').replace(/\\/g, '/')

  for (const m of text.matchAll(/<(button|RouterLink)\b/g)) {
    const attrs = attributesAt(text, m.index + m[0].length)
    if (ACTIONS.some((pattern) => pattern.test(attrs))) continue

    /* A submit button inside a form is driven by the form's own @submit. */
    const before = text.slice(0, m.index)
    if (before.lastIndexOf('<form') > before.lastIndexOf('</form>')) continue

    const line = before.split('\n').length
    dead.push(`${name}:${line}   <${m[1]}> with nothing behind it`)
  }
}

console.log('\n  Dead-control check')
console.log(`  files: ${sourceFiles(srcDir).length}\n`)

if (dead.length === 0) {
  console.log('  ok — every button and link does something\n')
  process.exit(0)
}

for (const row of dead) console.log(`    ${row}`)
console.log(`\n  ${dead.length} control(s) with no action\n`)
process.exit(1)
