import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const jsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const metadataOnly = process.argv.includes('--metadata-only')
const ownedName = '@hansjm10/volt-iroh'
const repositoryUrl = 'https://github.com/volt-hq/iroh-ffi.git'
const license = 'MIT OR Apache-2.0'
const targetPackages = new Map([
  ['aarch64-apple-darwin', 'darwin-arm64'],
  ['aarch64-linux-android', 'android-arm64'],
  ['aarch64-unknown-linux-gnu', 'linux-arm64-gnu'],
  ['aarch64-unknown-linux-musl', 'linux-arm64-musl'],
  ['aarch64-pc-windows-msvc', 'win32-arm64-msvc'],
  ['x86_64-pc-windows-msvc', 'win32-x64-msvc'],
  ['x86_64-unknown-linux-gnu', 'linux-x64-gnu'],
  ['x86_64-unknown-linux-musl', 'linux-x64-musl'],
  ['armv7-unknown-linux-gnueabihf', 'linux-arm-gnueabihf'],
  ['armv7-unknown-linux-musleabihf', 'linux-arm-musleabihf'],
  ['armv7-linux-androideabi', 'android-arm-eabi'],
])

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sorted(values) {
  return [...values].sort()
}

const rootPackage = readJson(join(jsRoot, 'package.json'))
const ownedVersion = rootPackage.version
assert.equal(rootPackage.name, ownedName)
assert.match(ownedVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
assert.equal(rootPackage.repository?.url, repositoryUrl)
assert.equal(rootPackage.license, license)
assert.equal(rootPackage.main, 'index.js')
assert.equal(rootPackage.types, 'index.d.ts')
assert.deepEqual(
  sorted(rootPackage.files),
  sorted(['index.js', 'index.d.ts', 'LICENSE-APACHE', 'LICENSE-MIT']),
)
assert.deepEqual(rootPackage.publishConfig, { access: 'public', provenance: true })
assert.deepEqual(sorted(rootPackage.napi.targets), sorted(targetPackages.keys()))
const expectedOptionalDependencies = Object.fromEntries(
  [...targetPackages.values()].sort().map((suffix) => [`${ownedName}-${suffix}`, ownedVersion]),
)
if (rootPackage.optionalDependencies) {
  assert.deepEqual(rootPackage.optionalDependencies, expectedOptionalDependencies)
}

const npmRoot = join(jsRoot, 'npm')
const packageDirs = readdirSync(npmRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
assert.deepEqual(sorted(packageDirs), sorted(targetPackages.values()))

const expectedRootBinaries = []
for (const suffix of targetPackages.values()) {
  const packageDir = join(npmRoot, suffix)
  const packageJson = readJson(join(packageDir, 'package.json'))
  const binary = `iroh.${suffix}.node`
  expectedRootBinaries.push(binary)

  assert.equal(packageJson.name, `${ownedName}-${suffix}`)
  assert.equal(packageJson.version, ownedVersion)
  assert.equal(packageJson.repository?.url, repositoryUrl)
  assert.equal(packageJson.license, license)
  assert.equal(packageJson.main, binary)
  assert.deepEqual(sorted(packageJson.files), sorted([binary, 'LICENSE-APACHE', 'LICENSE-MIT']))
  if (!metadataOnly) {
    const nativeFiles = readdirSync(packageDir).filter((file) => file.endsWith('.node'))
    assert.deepEqual(nativeFiles, [binary])
    assert.ok(statSync(join(packageDir, binary)).size > 0, `${binary} is empty`)
  }
}

if (!metadataOnly) {
  const rootBinaries = readdirSync(jsRoot).filter((file) => file.endsWith('.node'))
  assert.deepEqual(sorted(rootBinaries), sorted(expectedRootBinaries))

  for (const licenseFile of ['LICENSE-APACHE', 'LICENSE-MIT']) {
    const rootLicense = join(jsRoot, licenseFile)
    assert.ok(existsSync(rootLicense), `${licenseFile} was not staged in the main package`)
    const expected = readFileSync(rootLicense)
    for (const suffix of targetPackages.values()) {
      assert.deepEqual(
        readFileSync(join(npmRoot, suffix, licenseFile)),
        expected,
        `${licenseFile} differs in ${suffix}`,
      )
    }
  }
}

console.log(
  `verified ${ownedName}@${ownedVersion}: ${targetPackages.size} platform packages${metadataOnly ? ' (metadata only)' : ' and native artifacts'}`,
)
