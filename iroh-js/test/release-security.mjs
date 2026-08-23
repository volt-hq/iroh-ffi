import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { inspectNativeBinary, releaseConfig } from '../scripts/release-config.mjs'

function run(script, args = [], env = process.env) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env,
  })
}

test('owned release metadata and trusted matrix are internally consistent', () => {
  const metadata = run('scripts/verify-release-packages.mjs', ['--metadata-only'])
  assert.equal(metadata.status, 0, metadata.stderr)
  const matrix = run('scripts/authorize-release-ref.mjs', ['--check-config-only'])
  assert.equal(matrix.status, 0, matrix.stderr)
  const workflow = run('scripts/verify-workflow-security.mjs')
  assert.equal(workflow.status, 0, workflow.stderr)
  assert.equal(releaseConfig.targets.length, 11)
})

test('generated loader enforces native package versions by default', () => {
  const result = run('scripts/harden-generated-loader.mjs', ['--check'])
  assert.equal(result.status, 0, result.stderr)
})

test('native binary parser rejects architecture and format ambiguity', () => {
  const elf = Buffer.alloc(64)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(elf)
  elf.writeUInt16LE(183, 18)
  assert.deepEqual(inspectNativeBinary(elf), { format: 'elf', arch: 'arm64', bits: 64 })

  const macho = Buffer.alloc(64)
  macho.writeUInt32LE(0xfeedfacf, 0)
  macho.writeUInt32LE(0x0100000c, 4)
  assert.deepEqual(inspectNativeBinary(macho), { format: 'macho', arch: 'arm64', bits: 64 })

  const pe = Buffer.alloc(128)
  pe.write('MZ', 0, 'ascii')
  pe.writeUInt32LE(64, 0x3c)
  pe.write('PE\0\0', 64, 'ascii')
  pe.writeUInt16LE(0x8664, 68)
  pe.writeUInt16LE(0x20b, 88)
  assert.deepEqual(inspectNativeBinary(pe), { format: 'pe', arch: 'x64', bits: 64 })

  assert.throws(() => inspectNativeBinary(Buffer.alloc(64)), /unsupported native binary magic/)
})

test('verified tarball publisher rejects local execution before invoking npm', () => {
  const env = { ...process.env }
  delete env.GITHUB_ACTIONS
  const result = run('scripts/publish-verified-tarballs.mjs', [], env)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /GITHUB_ACTIONS/)
})

test('trust transcript verifier distinguishes auth prompts, absence, and exact trust', () => {
  const directory = mkdtempSync(join(tmpdir(), 'volt-iroh-trust-'))
  const transcript = join(directory, 'trust.txt')
  const env = {
    ...process.env,
    EXPECTED_WORKFLOW: 'ci_js.yml',
    EXPECTED_ENVIRONMENT: 'npm-release',
  }
  try {
    writeFileSync(transcript, '{"title":"Authenticate your account at","url":"https://example.invalid"}\n')
    const absent = run('scripts/verify-trust-transcript.mjs', [transcript], env)
    assert.equal(absent.status, 10, absent.stderr)

    writeFileSync(transcript, `${JSON.stringify({ title: 'Authenticate your account at' })}\n${JSON.stringify({
      id: 'trust-id',
      type: 'github',
      file: 'ci_js.yml',
      repository: 'volt-hq/iroh-ffi',
      environment: 'npm-release',
      permissions: ['createPackage'],
    }, null, 2)}\n`)
    const exact = run('scripts/verify-trust-transcript.mjs', [transcript], env)
    assert.equal(exact.status, 0, exact.stderr)

    writeFileSync(transcript, `${JSON.stringify({
      id: 'trust-id',
      type: 'github',
      file: 'wrong.yml',
      repository: 'other/repository',
      environment: 'npm-release',
      permissions: ['createPackage'],
    })}\n`)
    const mismatch = run('scripts/verify-trust-transcript.mjs', [transcript], env)
    assert.notEqual(mismatch.status, 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
