/**
 * Compile a rules file without deploying it.
 *
 *   npm run rules:lint                       this project's rules
 *   npm run rules:lint -- <path/to/rules>     any rules file
 *
 * WHY THIS IS USEFUL FOR A FILE THAT IS NOT OURS. The rules language is
 * project-independent, so creating a ruleset — never releasing it — against a
 * project we DO hold credentials for is a real compile of any rules file. That
 * is how the RMS's rules get checked from here: we cannot deploy to that project
 * and should not be able to, but a syntax error found after handing the file over
 * is a syntax error found by somebody else.
 *
 * The temporary ruleset is deleted afterwards and nothing is ever released.
 */
import { readFileSync } from 'node:fs'
import { cert, initializeApp } from 'firebase-admin/app'

const sa = JSON.parse(readFileSync('tools/serviceAccount.json', 'utf8'))
const target = process.argv[2] ?? 'firebase/firestore.rules'
const rules = readFileSync(target, 'utf8')

const app = initializeApp({ credential: cert(sa), projectId: sa.project_id })
const { access_token: token } = await app.options.credential.getAccessToken()
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const api = `https://firebaserules.googleapis.com/v1/projects/${sa.project_id}`

const res = await fetch(`${api}/rulesets`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: rules }] } }),
})
const body = await res.json()

if (body.error) {
  console.log(`\n  ${target} REJECTED (${rules.split('\n').length} lines)\n`)
  for (const issue of body.error.details?.flatMap((d) => d.issues ?? []) ?? []) {
    console.log(`  line ${issue.sourcePosition?.line}: ${issue.description}`)
  }
  process.exit(1)
}

console.log(`\n  ${target} compiles cleanly (${rules.split('\n').length} lines)`)

await fetch(`https://firebaserules.googleapis.com/v1/${body.name}`, { method: 'DELETE', headers })
console.log('  temporary ruleset deleted — nothing was released\n')
