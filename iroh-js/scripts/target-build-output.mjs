import assert from 'node:assert/strict'
import { existsSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'

export function finalizeTargetBuild(jsRoot, spec) {
  const source = resolve(jsRoot, 'iroh.node')
  const destination = resolve(jsRoot, `iroh.${spec.suffix}.node`)
  assert.ok(existsSync(source), `target build did not produce ${source}`)
  assert.ok(!existsSync(destination), `refusing to replace stale target artifact ${destination}`)
  renameSync(source, destination)
  return destination
}
