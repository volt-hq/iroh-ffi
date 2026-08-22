import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { jsRoot } from './release-config.mjs'

const loaderPath = join(jsRoot, 'index.js')
const optOut = " && process.env.NAPI_RS_ENFORCE_VERSION_CHECK && process.env.NAPI_RS_ENFORCE_VERSION_CHECK !== '0'"
const checkOnly = process.argv.includes('--check')
let loader = readFileSync(loaderPath, 'utf8')
const optOutCount = loader.split(optOut).length - 1

if (!checkOnly && optOutCount > 0) {
  loader = loader.replaceAll(optOut, '')
  writeFileSync(loaderPath, loader)
}

const finalLoader = checkOnly ? loader : readFileSync(loaderPath, 'utf8')
assert.ok(finalLoader.includes('Native binding package version mismatch'))
assert.ok(!finalLoader.includes('NAPI_RS_ENFORCE_VERSION_CHECK'))
assert.match(finalLoader, /if \(bindingPackageVersion !== '[^']+'\) \{/)
console.log(`native package version checks are fail-closed${optOutCount ? ` (removed ${optOutCount} opt-outs)` : ''}`)
