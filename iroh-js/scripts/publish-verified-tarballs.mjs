import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { jsRoot, releaseConfig, sha256 } from './release-config.mjs'

function requireEnvironment(name, expected) {
  assert.equal(process.env[name], expected, `${name} must be ${expected}`)
}

requireEnvironment('GITHUB_ACTIONS', 'true')
requireEnvironment('GITHUB_EVENT_NAME', 'push')
requireEnvironment('GITHUB_REPOSITORY', 'volt-hq/iroh-ffi')
requireEnvironment('GITHUB_REF_TYPE', 'tag')
requireEnvironment('VOLT_NPM_RELEASE_ENVIRONMENT', 'npm-release')
assert.match(process.env.GITHUB_REF ?? '', /^refs\/tags\/npm-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
assert.match(
  process.env.GITHUB_WORKFLOW_REF ?? '',
  /^volt-hq\/iroh-ffi\/\.github\/workflows\/ci_js\.yml@refs\/tags\/npm-v/,
)
assert.equal(process.env.VOLT_RELEASE_AUTHORIZED_SHA, process.env.GITHUB_SHA)
for (const name of ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'NPM_AUTH_TOKEN']) {
  assert.equal(process.env[name], undefined, `${name} must not be present; npm OIDC is required`)
}

const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim()
assert.equal(npmVersion, '11.17.0', 'release publishing requires the reviewed npm 11.17.0 CLI')

const packageJson = JSON.parse(readFileSync(join(jsRoot, 'package.json'), 'utf8'))
assert.equal(process.env.GITHUB_REF_NAME, `npm-v${packageJson.version}`)
const distTag = packageJson.version.includes('-') ? 'next' : 'latest'
const tarballRoot = join(jsRoot, 'release-tarballs')
const manifest = JSON.parse(readFileSync(join(tarballRoot, 'manifest.json'), 'utf8'))
assert.equal(manifest.schemaVersion, 1)
assert.equal(manifest.version, packageJson.version)
assert.equal(manifest.entries.length, releaseConfig.targets.length + 1)
assert.equal(manifest.entries.at(-1)?.name, packageJson.name, 'root package must publish last')

for (const entry of manifest.entries) {
  const tarball = join(tarballRoot, entry.file)
  assert.equal(sha256(readFileSync(tarball)), entry.sha256, `${entry.file} changed after verification`)
  console.log(`publishing verified ${entry.name}@${entry.version} (${entry.sha256})`)
  execFileSync(
    'npm',
    [
      'publish',
      tarball,
      '--ignore-scripts',
      '--access',
      'public',
      '--tag',
      distTag,
      '--provenance',
    ],
    { stdio: 'inherit', env: process.env },
  )
}
