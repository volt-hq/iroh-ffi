import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const transcript = process.argv[2]
assert.ok(transcript, 'usage: verify-trust-transcript.mjs <transcript>')
const expectedWorkflow = process.env.EXPECTED_WORKFLOW
const expectedEnvironment = process.env.EXPECTED_ENVIRONMENT
assert.ok(expectedWorkflow)
assert.ok(expectedEnvironment)

const source = readFileSync(transcript, 'utf8')
  .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
  .replaceAll('\r', '')
let trust
let trustCandidate
for (let start = 0; start < source.length && trust === undefined; start += 1) {
  if (source[start] !== '{' && source[start] !== '[') continue
  for (let end = source.length - 1; end > start; end -= 1) {
    if (source[end] !== '}' && source[end] !== ']') continue
    try {
      const candidate = JSON.parse(source.slice(start, end + 1))
      if (candidate?.id && candidate?.type) trustCandidate = candidate
      if (candidate?.repository === 'volt-hq/iroh-ffi') trust = candidate
      if (trust !== undefined) break
    } catch {}
  }
}
if (trust === undefined && trustCandidate === undefined) process.exit(10)
trust ??= trustCandidate
assert.notEqual(trust, undefined, 'npm trust list did not return its trust record')
assert.equal(trust.type, 'github')
assert.equal(trust.file, expectedWorkflow)
assert.equal(trust.repository, 'volt-hq/iroh-ffi')
assert.equal(trust.environment, expectedEnvironment)
assert.deepEqual(trust.permissions, ['createPackage'])
