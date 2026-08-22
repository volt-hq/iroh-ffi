import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  expectedPackageName,
  jsRoot,
  releaseConfig,
  sha256,
} from './release-config.mjs'

const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim()
assert.equal(npmVersion, '11.17.0', 'release packing requires the reviewed npm 11.17.0 CLI')

const rootPackage = JSON.parse(readFileSync(join(jsRoot, 'package.json'), 'utf8'))
const tarballRoot = join(jsRoot, 'release-tarballs')
rmSync(tarballRoot, { recursive: true, force: true })
mkdirSync(tarballRoot)

const packages = [
  ...releaseConfig.targets.map((spec) => ({
    name: expectedPackageName(spec),
    source: join(jsRoot, 'npm', spec.suffix),
  })),
  { name: rootPackage.name, source: jsRoot },
]

const entries = []
for (const packageToPack of packages) {
  const output = execFileSync(
    'npm',
    ['pack', packageToPack.source, '--ignore-scripts', '--json', '--pack-destination', tarballRoot],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  )
  const result = JSON.parse(output)
  assert.equal(result.length, 1)
  assert.equal(result[0].name, packageToPack.name)
  assert.equal(result[0].version, rootPackage.version)
  const file = result[0].filename
  const contents = readFileSync(join(tarballRoot, file))
  entries.push({
    name: packageToPack.name,
    version: rootPackage.version,
    file,
    sha256: sha256(contents),
    size: contents.length,
  })
}

writeFileSync(
  join(tarballRoot, 'manifest.json'),
  `${JSON.stringify({ schemaVersion: 1, version: rootPackage.version, entries }, null, 2)}\n`,
)
console.log(`packed ${entries.length} packages with scripts disabled into ${tarballRoot}`)
