import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { targetByTriple } from './release-config.mjs'
import { finalizeTargetBuild } from './target-build-output.mjs'

const args = process.argv.slice(2)
const targetFlag = args.indexOf('--target')
assert.ok(targetFlag >= 0 && args[targetFlag + 1], 'build target requires --target <triple>')
const target = args[targetFlag + 1]
const spec = targetByTriple.get(target)
assert.ok(spec, `untrusted build target: ${target}`)
const expectedArgs = args.includes('--use-napi-cross')
  ? ['--target', target, '--use-napi-cross']
  : ['--target', target]
assert.deepEqual(args, expectedArgs, `unsupported target build arguments: ${args.join(' ')}`)

const jsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const napiCli = resolve(dirname(fileURLToPath(import.meta.resolve('@napi-rs/cli'))), 'cli.js')
rmSync(resolve(jsRoot, 'iroh.node'), { force: true })
rmSync(resolve(jsRoot, `iroh.${spec.suffix}.node`), { force: true })
execFileSync(process.execPath, [napiCli, 'build', '--release', '--strip', ...args], {
  cwd: jsRoot,
  stdio: 'inherit',
})
finalizeTargetBuild(jsRoot, spec)
execFileSync(process.execPath, [resolve(jsRoot, 'scripts', 'harden-generated-loader.mjs')], {
  cwd: jsRoot,
  stdio: 'inherit',
})
