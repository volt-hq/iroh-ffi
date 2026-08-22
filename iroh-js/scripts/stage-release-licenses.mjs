import { copyFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const jsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(jsRoot, '..')
const packageDirs = readdirSync(join(jsRoot, 'npm'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(jsRoot, 'npm', entry.name))

for (const license of ['LICENSE-APACHE', 'LICENSE-MIT']) {
  const source = join(repositoryRoot, license)
  copyFileSync(source, join(jsRoot, license))
  for (const packageDir of packageDirs) {
    copyFileSync(source, join(packageDir, license))
  }
}

console.log(`staged dual-license texts in the main package and ${packageDirs.length} platform packages`)
