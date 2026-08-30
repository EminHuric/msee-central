/**
 * Publish firebase/firestore.rules to the live project.
 *
 * Uses the service account rather than the Firebase CLI, so it needs no
 * interactive login and can run from a script. The alternative — copying the
 * file into the console by hand — is where a stale paste silently reverts a
 * security fix, and that is not a mistake worth leaving available.
 *
 *   npm run rules:publish
 *
 * Always follow it with `npm run rules:verify`, which attacks the newly
 * published rules with a real account and reports what actually holds.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { cert, initializeApp } from 'firebase-admin/app'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const serviceAccount = JSON.parse(readFileSync(resolve(here, 'serviceAccount.json'), 'utf8'))
const rulesPath = resolve(root, 'firebase/firestore.rules')
const rules = readFileSync(rulesPath, 'utf8')

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id,
})

const { access_token: token } = await app.options.credential.getAccessToken()
const projectId = serviceAccount.project_id
const api = 'https://firebaserules.googleapis.com/v1'

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

function fail(stage, error) {
  console.error(`\n  x ${stage}: ${error.status ?? ''} ${error.message ?? ''}`)
  console.error('')
  process.exit(1)
}

console.log('\n  Publishing Firestore rules')
console.log(`  project: ${projectId}`)
console.log(`  source : firebase/firestore.rules (${rules.split('\n').length} lines)\n`)

/*
 * Creating the ruleset is also the syntax check: a malformed file is rejected
 * here, before anything is released, so a broken rule can never reach the
 * live database.
 */
const createResponse = await fetch(`${api}/projects/${projectId}/rulesets`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: rules }] } }),
})

const ruleset = await createResponse.json()

if (ruleset.error) {
  const issues = ruleset.error.details?.flatMap((d) => d.issues ?? []) ?? []
  for (const issue of issues) {
    console.error(`  line ${issue.sourcePosition?.line}: ${issue.description}`)
  }
  fail('ruleset rejected', ruleset.error)
}

console.log(`  + validated   ${ruleset.name.split('/').pop()}`)

const releaseResponse = await fetch(
  `${api}/projects/${projectId}/releases/cloud.firestore?updateMask=rulesetName`,
  {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      release: {
        name: `projects/${projectId}/releases/cloud.firestore`,
        rulesetName: ruleset.name,
      },
    }),
  },
)

const release = await releaseResponse.json()
if (release.error) fail('release failed', release.error)

console.log('  + published   now live\n')
console.log('  Next: npm run rules:verify\n')

process.exit(0)
