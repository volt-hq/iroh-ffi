import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { jsRoot } from './release-config.mjs'

const repositoryRoot = resolve(jsRoot, '..')
const workflowRoot = join(repositoryRoot, '.github', 'workflows')
for (const file of readdirSync(workflowRoot).filter((name) => name.endsWith('.yml'))) {
  const source = readFileSync(join(workflowRoot, file), 'utf8')
  for (const match of source.matchAll(/\buses:\s*([^\s#]+)/g)) {
    const action = match[1]
    assert.match(action, /@[0-9a-f]{40}$/, `${file} has an unpinned action: ${action}`)
  }
}

const ciJsSource = readFileSync(join(workflowRoot, 'ci_js.yml'), 'utf8')
const uncommented = ciJsSource
  .split('\n')
  .map((line) => line.replace(/\s+#.*$/, ''))
  .join('\n')
const triggers = uncommented.slice(uncommented.indexOf('\non:'), uncommented.indexOf('\njobs:'))
assert.match(triggers, /\n\s+push:/)
assert.doesNotMatch(triggers, /pull_request|workflow_dispatch|pull_request_target/)
assert.match(uncommented, /\n\s+environment: npm-release/)
assert.doesNotMatch(uncommented, /npm install -g corepack|corepack enable/)
assert.doesNotMatch(uncommented, /npm publish/)
assert.match(uncommented, /node scripts\/verify-native-artifacts\.mjs artifacts/)
assert.match(uncommented, /stage:napi/)
assert.match(uncommented, /--tarballs release-tarballs/)
assert.match(uncommented, /publish:verified/)
assert.equal((uncommented.match(/\[self-hosted, macOS, ARM64\]/g) ?? []).length, 1)
assert.doesNotMatch(uncommented, /\[self-hosted, linux/)
assert.equal((uncommented.match(/github\.workspace \}\}:\/repo/g) ?? []).length, 5)
assert.doesNotMatch(uncommented, /-w \/build/)

const authorizeSource = readFileSync(join(jsRoot, 'scripts', 'authorize-release-ref.mjs'), 'utf8')
assert.match(authorizeSource, /branch\.protected, true/)
assert.match(authorizeSource, /tag\.verification\?\.verified, true/)
assert.match(authorizeSource, /authorizedCommit, branchCommit/)

console.log('verified pinned actions and fail-closed owned npm workflow structure')
