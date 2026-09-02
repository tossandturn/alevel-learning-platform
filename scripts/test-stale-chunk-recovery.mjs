import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'

import { createMissingBuiltAssetMiddleware } from '../vite.config.js'
import { freshReloadUrl, shouldRetryBootFailure } from '../src/lib/bootRecovery.js'

function createResponse() {
  const chunks = []
  const response = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding))
      callback()
    },
  })
  response.statusCode = 200
  response.headers = {}
  response.body = ''
  response.setHeader = function setHeader(name, value) {
    this.headers[String(name)] = String(value)
  }
  response.on('finish', () => {
    response.body = Buffer.concat(chunks).toString('utf8')
  })
  return response
}

async function runMiddleware(middleware, request) {
  const response = createResponse()
  let nextCalled = false
  await new Promise((resolve, reject) => {
    response.once('error', reject)
    response.once('finish', resolve)
    Promise.resolve(middleware(request, response, () => {
      nextCalled = true
      resolve()
    })).catch(reject)
  })
  return { response, nextCalled }
}

const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-stale-chunk-'))
const assetRoot = path.join(scratchRoot, 'dist')
fs.mkdirSync(path.join(assetRoot, 'assets'), { recursive: true })
fs.writeFileSync(path.join(assetRoot, 'assets', 'live-chunk.js'), 'export default 1;\n', 'utf8')

try {
  const middleware = createMissingBuiltAssetMiddleware({ assetRoot })

  const missing = await runMiddleware(middleware, {
    method: 'GET',
    url: '/assets/missing-stale-chunk.js',
    headers: {},
  })
  assert.equal(missing.nextCalled, false, 'a missing built chunk must not fall through to the SPA fallback')
  assert.equal(missing.response.statusCode, 404, 'a missing built chunk must return 404')
  assert.match(String(missing.response.headers['Content-Type'] || ''), /text\/plain/i, 'a missing built chunk must not be served as HTML')
  assert.match(missing.response.body, /asset not found/i, 'a missing built chunk should explain that the asset is unavailable')

  const traversal = await runMiddleware(middleware, {
    method: 'GET',
    url: '/assets/%2e%2e/%2e%2e/outside.js',
    headers: {},
  })
  assert.equal(traversal.nextCalled, true, 'a traversal-shaped path must not be claimed as a built asset')

  const existing = await runMiddleware(middleware, {
    method: 'GET',
    url: '/assets/live-chunk.js',
    headers: {},
  })
  assert.equal(existing.nextCalled, false, 'the built chunk guard should own /assets/*.js directly')
  assert.equal(existing.response.statusCode, 200, 'an existing built chunk must be served directly')
  assert.match(String(existing.response.headers['Content-Type'] || ''), /javascript/i, 'an existing built chunk must keep a JavaScript MIME type')
  assert.match(String(existing.response.headers['Cache-Control'] || ''), /immutable/i, 'an existing built chunk should stay cacheable as a hashed asset')
  assert.match(existing.response.body, /export default 1/, 'an existing built chunk must return the requested file')

  const freshReload = freshReloadUrl('https://stem.example.test/topic/123?view=study#workspace', 123)
  assert.equal(
    shouldRetryBootFailure({ href: freshReload, previousReloadAt: 0, now: 456 }),
    false,
    'the cache-busting marker must suppress a second reload attempt',
  )
  assert.equal(
    shouldRetryBootFailure({ href: 'https://stem.example.test/topic/123?view=study#workspace', previousReloadAt: 0, now: 456 }),
    true,
    'the first boot failure must still trigger one cache-busting reload',
  )
  assert.equal(
    shouldRetryBootFailure({ href: 'https://stem.example.test/topic/123?view=study#workspace', previousReloadAt: 300, now: 456 }),
    false,
    'the reload cooldown must block repeat attempts inside the same recovery window',
  )

  console.log('stale chunk recovery checks passed')
} finally {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
}
