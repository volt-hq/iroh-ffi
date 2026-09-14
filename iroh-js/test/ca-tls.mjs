import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { once } from 'node:events'
import pkg from '../index.js'

const { Endpoint, RelayMode } = pkg
const fixture = name => readFileSync(new URL(`../../tests/fixtures/tls/${name}`, import.meta.url))
const root = [...fixture('root.der')]

// This is a TLS boundary test, not a fake successful Iroh relay. The server
// receives the client's TLS Finished only after the client verifies its certificate.
async function observeTLS(builder, certificate = 'server.pem') {
  const server = createServer({ key: fixture('server-key.pem'), cert: fixture(certificate) })
  const sockets = new Set()
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  let timer
  const observed = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('No TLS outcome within 10 seconds')), 10_000)
    server.once('tlsClientError', () => resolve('rejected'))
    server.once('secureConnection', () => resolve('verified'))
  })
  // Attach immediately so a startup failure cannot produce an unhandled timer rejection.
  observed.catch(() => {})
  let endpoint
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    builder.relayMode(RelayMode.customFromUrls([`https://127.0.0.1:${server.address().port}`]))
    endpoint = await builder.bind()
    return await observed
  } finally {
    clearTimeout(timer)
    await endpoint?.close()
    for (const socket of sockets) socket.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}

function builder() {
  const value = Endpoint.builder()
  value.applyMinimal()
  return value
}

test('custom roots permit a real verified HTTPS relay handshake', async () => {
  const value = builder()
  value.caRoots([root])
  assert.equal(await observeTLS(value), 'verified')
  assert.throws(() => value.caRoots([root]), /already consumed/)
})

test('default and wrong roots reject the private relay CA', async () => {
  assert.equal(await observeTLS(builder()), 'rejected')
  const value = builder()
  value.caRoots([[...fixture('other-root.der')]])
  assert.equal(await observeTLS(value), 'rejected')
})

test('custom roots do not disable certificate expiry checks', async () => {
  const value = builder()
  value.caRoots([root])
  assert.equal(await observeTLS(value, 'expired.pem'), 'rejected')
})

test('malformed and oversized roots do not change the builder', async () => {
  const value = builder()
  value.caRoots([root])
  for (const invalid of [[], [[]], Array(9).fill(root), [Array(16385).fill(0)], [[1, 2, 3]], [root, [1]]]) {
    assert.throws(() => value.caRoots(invalid), /ca_roots/)
  }
  assert.equal(await observeTLS(value), 'verified')
})
