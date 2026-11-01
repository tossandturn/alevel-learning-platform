import assert from 'node:assert/strict'
import http from 'node:http'
import { createAdmissionsPreviewDescriptor, admissionsSourceExcerpt } from '../server/admissionsPreviewContract.js'
import { createAdmissionsPreviewService } from '../server/admissionsPreviewService.js'

let clock = Date.parse('2026-11-02T04:00:00.000Z')
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlpeR0AAAAASUVORK5CYII='
const excerpt = admissionsSourceExcerpt('Page heading: Mechanical Engineering\n2027 entry\nA*A*A including Mathematics and Physics. '.repeat(60))
assert.ok(excerpt.length > 40 && excerpt.length <= 900)
const descriptor = createAdmissionsPreviewDescriptor({ sourceUrl: 'https://sheffield.ac.uk/undergraduate/courses/2027/mechanical-engineering-beng', now: clock })
assert.match(descriptor.previewId, /^apv_[A-Za-z0-9_-]{32,64}$/)
assert.equal(descriptor.path, '/api/ai/admissions/source-preview')
assert.equal(descriptor.kind, 'static-webpage-screenshot')
assert.equal(descriptor.status, 'pending')
assert.equal(Date.parse(descriptor.expiresAt) - clock, 3 * 24 * 60 * 60 * 1000)
assert.equal(descriptor.capturedAt, null)

const sourcesByOwner = new Map([
  [`owner-1:conversation-0001:turn-0001:source-0001`, { id: 'source-0001', url: descriptor.sourceUrl, title: 'Mechanical Engineering', excerpt, preview: descriptor }],
])
let captureCalls = 0
let captureFailure = false
let captureHang = false
let captureDelay = false
const service = createAdmissionsPreviewService({
  authenticateRequest: request => request.headers.authorization === 'Bearer owner-1' ? 'owner-1' : request.headers.authorization === 'Bearer owner-2' ? 'owner-2' : null,
  resolveSource: ({ ownerId, conversationId, turnId, sourceId }) => sourcesByOwner.get(`${ownerId}:${conversationId}:${turnId}:${sourceId}`) || null,
  now: () => clock,
  captureTimeoutMs: 20,
  captureSource: async source => {
    captureCalls += 1
    if (captureHang) return new Promise(() => {})
    if (captureDelay) await new Promise(resolve => setTimeout(resolve, 10))
    if (captureFailure) throw Object.assign(Error('fixture renderer offline'), { code: 'ADMISSIONS_PREVIEW_RENDERER_UNAVAILABLE' })
    assert.equal(source.url, descriptor.sourceUrl)
    return { kind: 'static-webpage-screenshot', mimeType: 'image/png', base64: tinyPng, width: 390, height: 900, focus: 'requirements-section' }
  },
})
const server = http.createServer((request, response) => Promise.resolve(service.handle(request, response, new URL(request.url, 'http://127.0.0.1'))).then(handled => {
  if (!handled) { response.statusCode = 404; response.end() }
}).catch(error => { response.statusCode = error.statusCode || 500; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ code: error.code, error: error.message })) }))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
async function get(id, { owner = 'owner-1', method = 'GET', query = '' } = {}) {
  const response = await fetch(`${base}/api/ai/admissions/source-preview${query}`, { method, headers: { ...(owner ? { Authorization: `Bearer ${owner}` } : {}), 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify({ conversationId: 'conversation-0001', turnId: 'turn-0001', sourceId: id }) } : {}) })
  return { status: response.status, body: await response.json() }
}
try {
  assert.equal((await get('source-0001', { owner: '', method: 'POST' })).status, 401)
  assert.equal((await get('source-0001', { owner: 'owner-2', method: 'POST' })).status, 404)
  assert.equal((await get('bad', { method: 'POST' })).status, 400)
  assert.equal((await get('source-0001', { method: 'GET' })).status, 405)
  assert.equal((await get('source-0001', { method: 'POST', query: '?url=https://example.com' })).status, 400, 'the endpoint accepts no client URL or query')
  const ready = await get('source-0001', { method: 'POST' })
  assert.equal(ready.status, 200)
  assert.deepEqual(Object.keys(ready.body.preview).sort(), ['base64', 'capturedAt', 'height', 'kind', 'mimeType', 'path', 'reason', 'sourceUrl', 'status', 'width'].sort())
  assert.equal(ready.body.preview.kind, 'static-webpage-screenshot')
  assert.equal(ready.body.preview.status, 'ready')
  assert.match(ready.body.preview.reason, /requirements_section_static_javascript_disabled/)
  assert.equal(ready.body.preview.sourceUrl, descriptor.sourceUrl)
  assert.equal(ready.body.excerpt, excerpt)
  assert.equal(captureCalls, 1)
  await get('source-0001', { method: 'POST' })
  assert.equal(captureCalls, 1, 'same owner/id uses the bounded preview cache')

  const fallbackDescriptor = createAdmissionsPreviewDescriptor({ sourceUrl: descriptor.sourceUrl, now: clock })
  sourcesByOwner.set(`owner-1:conversation-0001:turn-0001:source-0002`, { id: 'source-0002', url: descriptor.sourceUrl, title: 'Mechanical Engineering', excerpt, preview: fallbackDescriptor })
  captureFailure = true
  const fallback = await get('source-0002', { method: 'POST' })
  assert.equal(fallback.status, 200)
  assert.equal(fallback.body.preview.kind, 'excerpt-card')
  assert.equal(fallback.body.preview.status, 'fallback')
  assert.equal(fallback.body.preview.reason, 'renderer_unavailable')
  assert.equal(fallback.body.preview.mimeType, 'image/svg+xml')
  assert.ok(Buffer.from(fallback.body.preview.base64, 'base64').toString('utf8').includes('Mechanical Engineering'))
  captureFailure = false
  clock += 21_000
  const fallbackRetry = await get('source-0002', { method: 'POST' })
  assert.equal(fallbackRetry.body.preview.kind, 'static-webpage-screenshot', 'fallback cache expires quickly so the screenshot can retry')
  assert.equal(captureCalls, 3)

  const expiredDescriptor = { ...createAdmissionsPreviewDescriptor({ sourceUrl: descriptor.sourceUrl, now: clock - 4 * 24 * 60 * 60 * 1000 }), expiresAt: new Date(clock - 1).toISOString() }
  sourcesByOwner.set(`owner-1:conversation-0001:turn-0001:source-0003`, { id: 'source-0003', url: descriptor.sourceUrl, title: 'Mechanical Engineering', excerpt, preview: expiredDescriptor })
  const expired = await get('source-0003', { method: 'POST' })
  assert.equal(expired.body.preview.kind, 'excerpt-card')
  assert.equal(expired.body.preview.status, 'expired')
  assert.equal(expired.body.preview.reason, 'preview_expired')
  assert.equal(captureCalls, 3, 'expired metadata never invokes the renderer')

  const timeoutDescriptor = createAdmissionsPreviewDescriptor({ sourceUrl: descriptor.sourceUrl, now: clock })
  sourcesByOwner.set(`owner-1:conversation-0001:turn-0001:source-0004`, { id: 'source-0004', url: descriptor.sourceUrl, title: 'Mechanical Engineering', excerpt, preview: timeoutDescriptor })
  captureFailure = false
  captureHang = true
  const timeout = await get('source-0004', { method: 'POST' })
  assert.equal(timeout.body.preview.kind, 'excerpt-card')
  assert.equal(timeout.body.preview.reason, 'capture_timeout')
  captureHang = false

  const dedupeDescriptor = createAdmissionsPreviewDescriptor({ sourceUrl: descriptor.sourceUrl, now: clock })
  sourcesByOwner.set(`owner-1:conversation-0001:turn-0001:source-0005`, { id: 'source-0005', url: descriptor.sourceUrl, title: 'Mechanical Engineering', excerpt, preview: dedupeDescriptor })
  captureDelay = true
  const beforeDedupe = captureCalls
  const [dedupeOne, dedupeTwo] = await Promise.all([get('source-0005', { method: 'POST' }), get('source-0005', { method: 'POST' })])
  assert.equal(dedupeOne.body.preview.kind, 'static-webpage-screenshot')
  assert.equal(dedupeTwo.body.preview.kind, 'static-webpage-screenshot')
  assert.equal(captureCalls, beforeDedupe + 1, 'concurrent requests for one source share one capture and one cache write')
  captureDelay = false

  const ownerDescriptorA = createAdmissionsPreviewDescriptor({ sourceUrl: descriptor.sourceUrl, now: clock })
  const ownerDescriptorB = createAdmissionsPreviewDescriptor({ sourceUrl: descriptor.sourceUrl, now: clock })
  sourcesByOwner.set(`owner-1:conversation-0001:turn-0001:source-0006`, { id: 'source-0006', url: descriptor.sourceUrl, title: 'Mechanical Engineering', excerpt, preview: ownerDescriptorA })
  sourcesByOwner.set(`owner-1:conversation-0001:turn-0001:source-0007`, { id: 'source-0007', url: descriptor.sourceUrl, title: 'Mechanical Engineering', excerpt, preview: ownerDescriptorB })
  captureHang = true
  const ownerFirst = get('source-0006', { method: 'POST' })
  await new Promise(resolve => setImmediate(resolve))
  const ownerSecond = await get('source-0007', { method: 'POST' })
  assert.equal(ownerSecond.body.preview.reason, 'renderer_busy', 'one owner cannot queue multiple different source captures')
  assert.equal((await ownerFirst).body.preview.reason, 'capture_timeout')
  captureHang = false

  const restarted = createAdmissionsPreviewService({
    authenticateRequest: () => 'owner-1', resolveSource: ({ ownerId, conversationId, turnId, sourceId }) => sourcesByOwner.get(`${ownerId}:${conversationId}:${turnId}:${sourceId}`) || null,
    now: () => clock, captureSource: null,
  })
  const restartedServer = http.createServer((request, response) => restarted.handle(request, response, new URL(request.url, 'http://127.0.0.1')))
  await new Promise(resolve => restartedServer.listen(0, '127.0.0.1', resolve))
  const restartedResponse = await fetch(`http://127.0.0.1:${restartedServer.address().port}/api/ai/admissions/source-preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: 'conversation-0001', turnId: 'turn-0001', sourceId: 'source-0002' }) })
  const restartedBody = await restartedResponse.json()
  assert.equal(restartedBody.preview.kind, 'excerpt-card')
  assert.equal(restartedBody.preview.reason, 'renderer_unavailable', 'restart without worker falls back to persisted excerpt')
  restartedServer.closeAllConnections?.(); await new Promise(resolve => restartedServer.close(resolve)); restarted.close()
  console.log('Admissions source preview contract: auth/owner/read-only/opaque id/TTL/cache/fallback/restart and response fields passed.')
} finally {
  service.close(); server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve))
}
