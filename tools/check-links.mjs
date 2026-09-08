/**
 * Dead-link check.
 *
 * Collects every in-app path the source navigates to — `to="/x"`, `:to="'/x'"`,
 * `router.push('/x')`, and the `link:` fields the notification and alert lists
 * carry — and matches each against the routes the router actually declares.
 *
 * This exists because a link to a route that does not exist fails silently:
 * vue-router renders the catch-all, the user sees "not found", and nothing in
 * a type-check or a build says a word. That happened once here already —
 * `/requests` was in the menu and on the dashboard while the review flow lived
 * inside another page.
 *
 *   npm run links:check
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = fileURLToPath(new URL('../src', import.meta.url))

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(vue|ts)$/.test(entry) ? [full] : []
  })
}

/* ---- What the router declares --------------------------------------- */

const routerSource = readFileSync(join(srcDir, 'router', 'index.ts'), 'utf8')

/**
 * Paths are read from the source rather than by importing the router, because
 * importing it pulls in every view and the Firebase client with them.
 *
 * Child routes are relative to their parent, and the router now nests two
 * levels deep — `/settings/recycle` is a `recycle` inside a `settings` inside
 * the root. So the file is walked with a brace counter that remembers which
 * `children:` array each `path:` sits in, and the prefixes are composed.
 *
 * The first version assumed one level and quietly declared `/recycle`, which
 * is exactly the kind of near-miss this tool exists to catch.
 */
const declared = new Set(['/'])

{
  const lines = routerSource.split(/\r?\n/)

  /* A stack of { depth, prefix }: the route arrays currently open. */
  const stack = [{ depth: 0, prefix: '' }]
  let depth = 0
  let pendingChildren = false

  for (const line of lines) {
    const pathMatch = /path:\s*'([^']*)'/.exec(line)

    if (pathMatch) {
      const raw = pathMatch[1]
      if (!raw.startsWith('/:pathMatch')) {
        const parent = stack[stack.length - 1].prefix
        const full = raw.startsWith('/')
          ? raw
          : `${parent}/${raw}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1')

        declared.add(full || '/')
        /* If this route opens a `children:` block, its children hang off here. */
        stack[stack.length - 1].lastPath = full || '/'
      }
    }

    if (/children:\s*\[/.test(line)) pendingChildren = true

    for (const ch of line) {
      if (ch === '{' || ch === '[') {
        depth += 1
        if (pendingChildren && ch === '[') {
          stack.push({ depth, prefix: stack[stack.length - 1].lastPath ?? '' })
          pendingChildren = false
        }
      } else if (ch === '}' || ch === ']') {
        if (stack.length > 1 && stack[stack.length - 1].depth === depth) stack.pop()
        depth -= 1
      }
    }
  }
}

/** A concrete path matches a declared one with `:params` in it. */
function matches(path) {
  if (declared.has(path)) return true

  const parts = path.split('/').filter(Boolean)
  for (const pattern of declared) {
    const shape = pattern.split('/').filter(Boolean)
    const optional = shape.filter((p) => p.endsWith('?')).length
    if (parts.length < shape.length - optional || parts.length > shape.length) continue

    const ok = shape.every((segment, i) => {
      if (segment.startsWith(':')) return segment.endsWith('?') || parts[i] !== undefined
      return segment === parts[i]
    })
    if (ok) return true
  }

  return false
}

/* ---- What the source links to ---------------------------------------- */

const PATTERNS = [
  /\bto="(\/[^"{}]*)"/g,
  /:to="'(\/[^']*)'"/g,
  /router\.push\('(\/[^']*)'\)/g,
  /\blink:\s*'(\/[^']*)'/g,
]

const found = new Map()

for (const file of sourceFiles(srcDir)) {
  const text = readFileSync(file, 'utf8')
  for (const pattern of PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      /* Strip a query string: the route is the part before it. */
      const path = m[1].split('?')[0]
      if (!found.has(path)) found.set(path, file.split(/[\\/]src[\\/]/)[1] ?? file)
    }
  }
}

/* ---- Report ----------------------------------------------------------- */

console.log('\n  Link check')
console.log(`  routes: ${declared.size}    links found: ${found.size}\n`)

const broken = [...found].filter(([path]) => !matches(path))

if (broken.length === 0) {
  console.log('  ok — every link resolves to a route\n')
  process.exit(0)
}

console.log('  links with no matching route')
for (const [path, file] of broken) console.log(`    ${path}   ${file}`)
console.log(`\n  ${broken.length} problem(s)\n`)
process.exit(1)
