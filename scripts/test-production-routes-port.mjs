import assert from 'node:assert/strict'
import http from 'node:http'

import { freeFetchPort, isFetchSafePort } from './lib/fetch-safe-port.mjs'

assert.equal(isFetchSafePort(1723), false, 'the Windows PPTP port is rejected by fetch')
assert.equal(isFetchSafePort(0), false)
assert.equal(isFetchSafePort(49152), true)
assert.equal(isFetchSafePort(65535), true)
assert.equal(isFetchSafePort(65536), false)
const port = await freeFetchPort()
assert.equal(isFetchSafePort(port), true)
const server = http.createServer((_request, response) => response.end('ready'))
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  const response = await fetch(`http://127.0.0.1:${port}/`)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'ready')
} finally {
  if (server.listening) await new Promise((resolve) => server.close(resolve))
}
console.log(JSON.stringify({ status: 'PASS', scope: 'fetch-safe-production-route-test-port' }))
