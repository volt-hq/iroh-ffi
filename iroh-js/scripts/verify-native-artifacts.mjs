import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import {
  expectedBinaryName,
  inspectNativeBinary,
  releaseConfig,
  sha256,
  targetByTriple,
} from './release-config.mjs'

const artifactRoot = resolve(process.argv[2] ?? 'artifacts')

function walk(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

const files = walk(artifactRoot)
const jsonManifests = files.filter((path) => /^native-artifact-.+\.json$/.test(basename(path)))
const hashManifests = files.filter((path) => /^native-artifact-.+\.sha256$/.test(basename(path)))
const binaries = files.filter((path) => path.endsWith('.node'))
assert.equal(jsonManifests.length, releaseConfig.targets.length, 'native JSON manifest count')
assert.equal(hashManifests.length, releaseConfig.targets.length, 'native SHA-256 manifest count')
assert.equal(binaries.length, releaseConfig.targets.length, 'native artifact count')

const seenTargets = new Set()
const seenBinaries = new Set()
const sums = []
for (const manifestPath of jsonManifests) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  const spec = targetByTriple.get(manifest.target)
  assert.ok(spec, `unknown target in ${manifestPath}: ${manifest.target}`)
  assert.ok(!seenTargets.has(manifest.target), `duplicate target ${manifest.target}`)
  seenTargets.add(manifest.target)

  const binary = expectedBinaryName(spec)
  assert.equal(manifest.suffix, spec.suffix)
  assert.equal(manifest.binary, binary)
  assert.deepEqual(manifest.packageMetadata, spec.package)
  assert.deepEqual(manifest.trustedInputs, spec.trustedInputs)
  assert.deepEqual(Object.keys(manifest.systemPackageVersions).sort(), [...(spec.systemPackages ?? [])].sort())
  for (const version of Object.values(manifest.systemPackageVersions)) assert.ok(version)
  assert.match(manifest.buildEnvironment?.rustc ?? '', /^rustc 1\.97\.1\b/)
  assert.equal(manifest.buildEnvironment?.node, 'v24.9.0')
  assert.ok(manifest.buildEnvironment?.runnerEnvironment)

  const binaryPath = join(dirname(manifestPath), binary)
  const contents = readFileSync(binaryPath)
  assert.equal(contents.length, manifest.size, `${binary} size`)
  assert.equal(sha256(contents), manifest.sha256, `${binary} SHA-256`)
  assert.deepEqual(inspectNativeBinary(contents), {
    format: spec.binary.format,
    arch: spec.binary.arch,
    bits: spec.binary.bits,
  })

  const fileDescription = execFileSync('file', ['-b', binaryPath], { encoding: 'utf8' }).trim()
  assert.match(fileDescription, new RegExp(spec.binary.filePattern, 'i'), `${binary}: ${fileDescription}`)

  const hashPath = join(dirname(manifestPath), `native-artifact-${manifest.target}.sha256`)
  assert.equal(readFileSync(hashPath, 'utf8'), `${manifest.sha256}  ${binary}\n`)
  assert.ok(!seenBinaries.has(binary), `duplicate binary ${binary}`)
  seenBinaries.add(binary)
  sums.push(`${manifest.sha256}  ${binary}`)
}

assert.deepEqual([...seenTargets].sort(), releaseConfig.targets.map(({ target }) => target).sort())
assert.deepEqual([...seenBinaries].sort(), releaseConfig.targets.map(expectedBinaryName).sort())
writeFileSync(join(artifactRoot, 'SHA256SUMS'), `${sums.sort().join('\n')}\n`)
console.log(`verified ${sums.length} native artifacts and wrote ${join(artifactRoot, 'SHA256SUMS')}`)
