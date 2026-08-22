import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  expectedBinaryName,
  inspectNativeBinary,
  jsRoot,
  sha256,
  targetByTriple,
} from './release-config.mjs'

const target = process.argv[2]
const spec = targetByTriple.get(target)
assert.ok(spec, `usage: node scripts/create-native-manifest.mjs <known-target>; got ${target ?? '<none>'}`)

function capture(command, args = []) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

const binary = expectedBinaryName(spec)
const binaryPath = join(jsRoot, binary)
const contents = readFileSync(binaryPath)
const observedBinary = inspectNativeBinary(contents)
assert.deepEqual(observedBinary, {
  format: spec.binary.format,
  arch: spec.binary.arch,
  bits: spec.binary.bits,
})

const systemPackageVersions = {}
for (const packageName of spec.systemPackages ?? []) {
  const version = capture('dpkg-query', ['-W', '-f=${Version}', packageName])
  assert.ok(version, `could not record installed version for ${packageName}`)
  systemPackageVersions[packageName] = version
}

const manifest = {
  schemaVersion: 1,
  target,
  suffix: spec.suffix,
  binary,
  sha256: sha256(contents),
  size: contents.length,
  observedBinary,
  packageMetadata: spec.package,
  trustedInputs: spec.trustedInputs,
  systemPackageVersions,
  buildEnvironment: {
    runnerEnvironment: process.env.RUNNER_ENVIRONMENT ?? null,
    runnerArch: process.env.RUNNER_ARCH ?? null,
    runnerName: process.env.RUNNER_NAME ?? null,
    imageOs: process.env.ImageOS ?? null,
    imageVersion: process.env.ImageVersion ?? null,
    node: process.version,
    rustc: capture('rustc', ['--version', '--verbose']),
    kernel: capture('uname', ['-a']),
    macos: capture('sw_vers'),
    xcode: capture('xcodebuild', ['-version']),
    windows: capture('cmd.exe', ['/d', '/c', 'ver']),
  },
}

assert.ok(manifest.buildEnvironment.rustc?.includes('rustc 1.97.1'), manifest.buildEnvironment.rustc)
assert.equal(manifest.buildEnvironment.node, 'v24.9.0')
assert.ok(
  manifest.buildEnvironment.runnerEnvironment || process.env.CI !== 'true',
  'RUNNER_ENVIRONMENT must be recorded in CI',
)

const stem = `native-artifact-${target}`
writeFileSync(join(jsRoot, `${stem}.json`), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(join(jsRoot, `${stem}.sha256`), `${manifest.sha256}  ${binary}\n`)
console.log(`recorded ${target}: ${manifest.sha256}  ${binary}`)
