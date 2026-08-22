import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  expectedBinaryName,
  expectedPackageName,
  inspectNativeBinary,
  releaseConfig,
  sha256,
} from './release-config.mjs'

const jsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const metadataOnly = process.argv.includes('--metadata-only')
const argument = (name) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1]
}
const artifactManifestPath = argument('--artifacts-manifest')
const tarballRootArgument = argument('--tarballs')
const ownedName = '@hansjm10/volt-iroh'
const repositoryUrl = 'https://github.com/volt-hq/iroh-ffi.git'
const license = 'MIT OR Apache-2.0'

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sorted(values) {
  return [...values].sort()
}

function expectedOptionalDependencies(version) {
  return Object.fromEntries(
    releaseConfig.targets
      .map((spec) => [expectedPackageName(spec), version])
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function verifyRootPackage(packageJson, { staged }) {
  assert.equal(packageJson.name, ownedName)
  assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  assert.equal(packageJson.repository?.url, repositoryUrl)
  assert.equal(packageJson.license, license)
  assert.match(packageJson.author, /n0 team/)
  assert.match(packageJson.author, /Volt contributors/)
  assert.equal(packageJson.main, 'index.js')
  assert.equal(packageJson.types, 'index.d.ts')
  assert.deepEqual(
    sorted(packageJson.files),
    sorted(['index.js', 'index.d.ts', 'LICENSE-APACHE', 'LICENSE-MIT']),
  )
  assert.deepEqual(packageJson.publishConfig, { access: 'public', provenance: true })
  assert.deepEqual(sorted(packageJson.napi.targets), sorted(releaseConfig.targets.map(({ target }) => target)))
  assert.equal(packageJson.packageManager, 'yarn@4.4.0')
  assert.equal(packageJson.scripts?.prepublishOnly, undefined)
  if (staged) {
    assert.deepEqual(packageJson.optionalDependencies, expectedOptionalDependencies(packageJson.version))
  } else if (packageJson.optionalDependencies) {
    assert.deepEqual(packageJson.optionalDependencies, expectedOptionalDependencies(packageJson.version))
  }
}

function verifyPlatformPackage(packageJson, spec, version) {
  const binary = expectedBinaryName(spec)
  assert.equal(packageJson.name, expectedPackageName(spec))
  assert.equal(packageJson.version, version)
  assert.equal(packageJson.repository?.url, repositoryUrl)
  assert.equal(packageJson.license, license)
  assert.equal(packageJson.main, binary)
  assert.deepEqual(sorted(packageJson.files), sorted([binary, 'LICENSE-APACHE', 'LICENSE-MIT']))
  assert.deepEqual(packageJson.os, spec.package.os)
  assert.deepEqual(packageJson.cpu, spec.package.cpu)
  assert.deepEqual(packageJson.libc, spec.package.libc)
  assert.deepEqual(packageJson.publishConfig, { access: 'public', provenance: true })
  assert.equal(packageJson.scripts, undefined)
}

function verifyBinary(path, spec) {
  const contents = readFileSync(path)
  assert.ok(contents.length > 0, `${path} is empty`)
  assert.deepEqual(inspectNativeBinary(contents), {
    format: spec.binary.format,
    arch: spec.binary.arch,
    bits: spec.binary.bits,
  })
  const description = execFileSync('file', ['-b', path], { encoding: 'utf8' }).trim()
  assert.match(description, new RegExp(spec.binary.filePattern, 'i'), `${path}: ${description}`)
  return contents
}

function walkFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? walkFiles(path) : [path]
  })
}

const rootPackage = readJson(join(jsRoot, 'package.json'))
const ownedVersion = rootPackage.version
verifyRootPackage(rootPackage, { staged: !metadataOnly })

const npmRoot = join(jsRoot, 'npm')
const packageDirs = readdirSync(npmRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
assert.deepEqual(sorted(packageDirs), sorted(releaseConfig.targets.map(({ suffix }) => suffix)))

for (const spec of releaseConfig.targets) {
  const packageDir = join(npmRoot, spec.suffix)
  const packageJson = readJson(join(packageDir, 'package.json'))
  verifyPlatformPackage(packageJson, spec, ownedVersion)

  if (!metadataOnly) {
    const binary = expectedBinaryName(spec)
    const nativeFiles = readdirSync(packageDir).filter((file) => file.endsWith('.node'))
    assert.deepEqual(nativeFiles, [binary])
    const rootContents = verifyBinary(join(jsRoot, binary), spec)
    const packageContents = verifyBinary(join(packageDir, binary), spec)
    assert.deepEqual(packageContents, rootContents, `${binary} differs between root and platform package`)
  }
}

if (!metadataOnly) {
  assert.ok(artifactManifestPath, '--artifacts-manifest is required for native release verification')
  const expectedSums = new Map(
    readFileSync(resolve(jsRoot, artifactManifestPath), 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64})  ([^/]+\.node)$/)
        assert.ok(match, `invalid SHA256SUMS line: ${line}`)
        return [match[2], match[1]]
      }),
  )
  assert.equal(expectedSums.size, releaseConfig.targets.length)
  const rootBinaries = readdirSync(jsRoot).filter((file) => file.endsWith('.node'))
  assert.deepEqual(sorted(rootBinaries), sorted(releaseConfig.targets.map(expectedBinaryName)))
  for (const binary of rootBinaries) {
    assert.equal(sha256(readFileSync(join(jsRoot, binary))), expectedSums.get(binary), `${binary} manifest hash`)
  }

  for (const licenseFile of ['LICENSE-APACHE', 'LICENSE-MIT']) {
    const rootLicense = join(jsRoot, licenseFile)
    assert.ok(existsSync(rootLicense), `${licenseFile} was not staged in the main package`)
    const expected = readFileSync(rootLicense)
    for (const spec of releaseConfig.targets) {
      assert.deepEqual(
        readFileSync(join(npmRoot, spec.suffix, licenseFile)),
        expected,
        `${licenseFile} differs in ${spec.suffix}`,
      )
    }
  }
}

if (tarballRootArgument) {
  assert.ok(!metadataOnly, '--tarballs cannot be combined with --metadata-only')
  const tarballRoot = resolve(jsRoot, tarballRootArgument)
  const manifest = readJson(join(tarballRoot, 'manifest.json'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.version, ownedVersion)
  assert.equal(manifest.entries.length, releaseConfig.targets.length + 1)
  assert.equal(new Set(manifest.entries.map(({ name }) => name)).size, releaseConfig.targets.length + 1)

  const expectedPackages = new Set([ownedName, ...releaseConfig.targets.map(expectedPackageName)])
  const expectedTarballs = new Set()
  for (const entry of manifest.entries) {
    assert.ok(expectedPackages.delete(entry.name), `unexpected or duplicate tarball package ${entry.name}`)
    const tarball = join(tarballRoot, entry.file)
    expectedTarballs.add(entry.file)
    assert.equal(sha256(readFileSync(tarball)), entry.sha256, `${entry.file} immutable hash`)

    const extraction = mkdtempSync(join(tmpdir(), 'volt-iroh-tarball-'))
    try {
      execFileSync('tar', ['-xzf', tarball, '-C', extraction])
      const packageRoot = join(extraction, 'package')
      const extractedFiles = walkFiles(packageRoot)
      for (const file of extractedFiles) assert.ok(lstatSync(file).isFile(), `${file} is not a regular file`)
      const paths = sorted(extractedFiles.map((path) => relative(packageRoot, path)))
      const extractedPackage = readJson(join(packageRoot, 'package.json'))

      if (entry.name === ownedName) {
        verifyRootPackage(extractedPackage, { staged: true })
        assert.deepEqual(paths, sorted(['LICENSE-APACHE', 'LICENSE-MIT', 'README.md', 'index.d.ts', 'index.js', 'package.json']))
      } else {
        const spec = releaseConfig.targets.find((candidate) => expectedPackageName(candidate) === entry.name)
        assert.ok(spec)
        verifyPlatformPackage(extractedPackage, spec, ownedVersion)
        const binary = expectedBinaryName(spec)
        assert.deepEqual(paths, sorted(['LICENSE-APACHE', 'LICENSE-MIT', 'README.md', binary, 'package.json']))
        verifyBinary(join(packageRoot, binary), spec)
      }
    } finally {
      rmSync(extraction, { recursive: true, force: true })
    }
  }
  assert.equal(expectedPackages.size, 0, `missing tarballs: ${[...expectedPackages].join(', ')}`)
  const actualTarballs = readdirSync(tarballRoot).filter((file) => file.endsWith('.tgz'))
  assert.deepEqual(sorted(actualTarballs), sorted(expectedTarballs))
}

console.log(
  `verified ${ownedName}@${ownedVersion}: ${releaseConfig.targets.length} platform packages${metadataOnly ? ' (metadata only)' : ' and native artifacts'}${tarballRootArgument ? ' plus 12 immutable tarballs' : ''}`,
)
