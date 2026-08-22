import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const jsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const releaseConfig = JSON.parse(readFileSync(resolve(jsRoot, 'release-targets.json'), 'utf8'))

assert.equal(releaseConfig.schemaVersion, 1)
assert.equal(releaseConfig.targets.length, 11)
assert.equal(new Set(releaseConfig.targets.map(({ target }) => target)).size, 11)
assert.equal(new Set(releaseConfig.targets.map(({ suffix }) => suffix)).size, 11)

export const targetByTriple = new Map(
  releaseConfig.targets.map((target) => [target.target, target]),
)

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function inspectNativeBinary(buffer) {
  assert.ok(buffer.length >= 64, 'native binary is too short')

  if (buffer.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    const bits = { 1: 32, 2: 64 }[buffer[4]]
    assert.ok(bits, `unsupported ELF class ${buffer[4]}`)
    assert.equal(buffer[5], 1, 'only little-endian ELF binaries are supported')
    const machine = buffer.readUInt16LE(18)
    const arch = { 40: 'arm', 62: 'x64', 183: 'arm64' }[machine]
    assert.ok(arch, `unsupported ELF machine ${machine}`)
    return { format: 'elf', arch, bits }
  }

  const machoMagic = buffer.readUInt32LE(0)
  if (machoMagic === 0xfeedfacf) {
    const cpuType = buffer.readUInt32LE(4)
    const arch = { 0x01000007: 'x64', 0x0100000c: 'arm64' }[cpuType]
    assert.ok(arch, `unsupported Mach-O CPU type 0x${cpuType.toString(16)}`)
    return { format: 'macho', arch, bits: 64 }
  }

  if (buffer[0] === 0x4d && buffer[1] === 0x5a) {
    const peOffset = buffer.readUInt32LE(0x3c)
    assert.ok(peOffset + 26 <= buffer.length, 'invalid PE header offset')
    assert.equal(buffer.toString('ascii', peOffset, peOffset + 4), 'PE\0\0')
    const machine = buffer.readUInt16LE(peOffset + 4)
    const arch = { 0x8664: 'x64', 0xaa64: 'arm64' }[machine]
    assert.ok(arch, `unsupported PE machine 0x${machine.toString(16)}`)
    const optionalMagic = buffer.readUInt16LE(peOffset + 24)
    assert.equal(optionalMagic, 0x20b, 'native addon must use PE32+ (64-bit)')
    return { format: 'pe', arch, bits: 64 }
  }

  assert.fail(`unsupported native binary magic ${buffer.subarray(0, 4).toString('hex')}`)
}

export function expectedPackageName(spec) {
  return `@hansjm10/volt-iroh-${spec.suffix}`
}

export function expectedBinaryName(spec) {
  return `iroh.${spec.suffix}.node`
}
