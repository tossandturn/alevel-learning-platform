import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { createAiApi } from '../server/aiApi.js'

const protocol = 'stem-coach-image-upload-v1'
const chunkChars = 65_536
const maxImageBytes = 4 * 1024 * 1024
const maxBase64Chars = Math.ceil(maxImageBytes / 3) * 4
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-image-upload-api-'))
const signingKey = 'synthetic-coach-upload-signing-key'
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlYV5sAAAAASUVORK5CYII='
const pngDataUrl = `data:image/png;base64,${pngBase64}`
const sha = value => crypto.createHash('sha256').update(value, 'ascii').digest('hex')
const token = (owner = 1) => {
  const at = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({ iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: `ielts:${owner}`, iat: at, exp: at + 600 })).toString('base64url')
  return `${header}.${claims}.${crypto.createHmac('sha256', signingKey).update(`${header}.${claims}`).digest('base64url')}`
}
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))

let providerCalls = 0
const providerBodies = []
const provider = http.createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  providerCalls += 1
  providerBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Chunked image accepted.' }, finish_reason: null }] })}\n\n`)
  await new Promise(resolve => setTimeout(resolve, 30))
  response.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
})
const providerBase = await listen(provider)

const options = {
  env: {
    AI_PROVIDER: 'qwen',
    STEM_INTERNAL_AUTH_KEY: signingKey,
    COACH_AI_API_KEY: 'synthetic-coach-key',
    COACH_AI_BASE_URL: providerBase,
    COACH_AI_MODEL: 'synthetic-coach-model',
    VISION_AI_API_KEY: 'synthetic-vision-key',
    VISION_AI_BASE_URL: providerBase,
    VISION_AI_MODEL: 'synthetic-vision-model',
  },
  libraryRoot: root,
  allowedSubjects: new Set(),
  coachJobsRoot: root,
  telemetry: () => {},
}
let api = createAiApi(options)
const app = http.createServer((request, response) => api(request, response, () => {
  response.statusCode = 404
  response.end()
}))
const base = await listen(app)

async function request(route, { method = 'GET', body, rawBody, owner = 1, authenticated = true } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(authenticated ? { Authorization: `Bearer ${token(owner)}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : rawBody !== undefined ? { body: rawBody } : {}),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

const uploadPath = id => `/api/ai/coach/uploads/${id}`
const metadata = (base64 = pngBase64, mimeType = 'image/png') => ({ mimeType, base64Length: base64.length, base64Sha256: sha(base64) })
const init = (id, base64 = pngBase64, owner = 1, mimeType = 'image/png') => request(uploadPath(id), { method: 'PUT', owner, body: metadata(base64, mimeType) })
const append = (id, offset, chunk, owner = 1) => request(uploadPath(id), { method: 'PATCH', owner, body: { offset, chunk } })
const complete = (id, owner = 1) => request(`${uploadPath(id)}/complete`, { method: 'POST', owner, body: {} })

try {
  assert.equal((await request('/api/ai/coach/uploads/capabilities', { authenticated: false })).status, 401)
  const capabilities = await request('/api/ai/coach/uploads/capabilities')
  assert.equal(capabilities.status, 200)
  assert.deepEqual(capabilities.body, { protocol, enabled: true, chunkChars, maxImageBytes, ttlMs: 900_000 })

  const readyId = 'cu-readyImage1234567890'
  const initialized = await init(readyId)
  assert.equal(initialized.status, 200)
  assert.equal(initialized.body.status, 'uploading')
  assert.equal(initialized.body.receivedChars, 0)
  assert.equal(initialized.body.base64Sha256, sha(pngBase64))
  assert.equal((await init(readyId)).body.receivedChars, 0, 'same metadata initialization is idempotent')
  assert.equal((await request(uploadPath(readyId), { method: 'PUT', body: { ...metadata(), base64Sha256: 'f'.repeat(64) } })).status, 409)
  assert.equal((await request(uploadPath(readyId), { owner: 2 })).status, 404, 'cross-owner lookup is indistinguishable from unknown ID')
  assert.equal((await request(uploadPath('cu-unknownImage1234567'))).status, 404)

  const split = 32
  const firstChunk = pngBase64.slice(0, split)
  const secondChunk = pngBase64.slice(split)
  const firstPatch = await append(readyId, 0, firstChunk)
  assert.equal(firstPatch.status, 200)
  assert.equal(firstPatch.body.receivedChars, split)
  const repeatedPatch = await append(readyId, 0, firstChunk)
  assert.equal(repeatedPatch.status, 200)
  assert.equal(repeatedPatch.body.receivedChars, split, 'lost acknowledgement retry must not append twice')
  const offsetConflict = await append(readyId, split + 4, secondChunk)
  assert.equal(offsetConflict.status, 409)
  assert.equal(offsetConflict.body.code, 'coach_upload_offset_conflict')
  assert.equal((await append(readyId, split, secondChunk)).body.receivedChars, pngBase64.length)
  const completed = await complete(readyId)
  assert.equal(completed.status, 200)
  assert.equal(completed.body.status, 'ready')
  assert.equal(completed.body.receivedChars, pngBase64.length)
  assert.equal((await complete(readyId)).body.status, 'ready', 'lost completion acknowledgement is idempotent')

  const alignmentId = 'cu-alignment1234567890'
  await request(uploadPath(alignmentId), { method: 'PUT', body: { mimeType: 'image/png', base64Length: 8, base64Sha256: sha('AAAAAAAA') } })
  const alignment = await append(alignmentId, 0, 'AAAAA')
  assert.equal(alignment.status, 400)
  assert.equal(alignment.body.code, 'coach_upload_chunk_invalid')
  await request(uploadPath(alignmentId), { method: 'DELETE' })

  const oversizedBodyId = 'cu-oversizedBody1234567'
  await request(uploadPath(oversizedBodyId), { method: 'PUT', body: { mimeType: 'image/png', base64Length: 4, base64Sha256: sha('AAAA') } })
  const oversizedBody = await request(uploadPath(oversizedBodyId), { method: 'PATCH', rawBody: JSON.stringify({ offset: 0, chunk: 'A'.repeat(82 * 1024) }) })
  assert.equal(oversizedBody.status, 413)
  assert.equal((await request(uploadPath(oversizedBodyId))).body.receivedChars, 0)
  await request(uploadPath(oversizedBodyId), { method: 'DELETE' })

  const nonCanonicalId = 'cu-noncanonical123456789'
  await init(nonCanonicalId, 'AB==')
  await append(nonCanonicalId, 0, 'AB==')
  const nonCanonical = await complete(nonCanonicalId)
  assert.equal(nonCanonical.status, 422)
  assert.equal(nonCanonical.body.code, 'coach_upload_base64_invalid')
  await request(uploadPath(nonCanonicalId), { method: 'DELETE' })

  const shaMismatchId = 'cu-shaMismatch123456789'
  await request(uploadPath(shaMismatchId), { method: 'PUT', body: { ...metadata(), base64Sha256: '0'.repeat(64) } })
  await append(shaMismatchId, 0, pngBase64)
  const shaMismatch = await complete(shaMismatchId)
  assert.equal(shaMismatch.status, 422)
  assert.equal(shaMismatch.body.code, 'coach_upload_sha_mismatch')
  await request(uploadPath(shaMismatchId), { method: 'DELETE' })

  const fakeBase64 = Buffer.from('not an image').toString('base64')
  const magicId = 'cu-magicMismatch1234567'
  await init(magicId, fakeBase64)
  await append(magicId, 0, fakeBase64)
  const magicMismatch = await complete(magicId)
  assert.equal(magicMismatch.status, 422)
  assert.equal(magicMismatch.body.code, 'coach_upload_mime_mismatch')
  await request(uploadPath(magicId), { method: 'DELETE' })

  const imageFormats = [
    { id: 'cu-jpegMagic12345678901', mimeType: 'image/jpeg', base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xd9]).toString('base64') },
    { id: 'cu-webpMagic12345678901', mimeType: 'image/webp', base64: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]).toString('base64') },
  ]
  for (const fixture of imageFormats) {
    assert.equal((await init(fixture.id, fixture.base64, 1, fixture.mimeType)).status, 200)
    await append(fixture.id, 0, fixture.base64)
    assert.equal((await complete(fixture.id)).body.status, 'ready')
    await request(uploadPath(fixture.id), { method: 'DELETE' })
  }

  const unfinishedId = 'cu-unfinished1234567890'
  await init(unfinishedId)
  const callsBeforeInvalidJobs = providerCalls
  const unfinishedJob = await request('/api/ai/coach/jobs/cj-unfinished123456789', {
    method: 'POST',
    body: { feature: 'answers', helpIntent: 'worked-solution', message: 'Analyze this image.', context: { view: 'coach-photo' }, imageUploadIds: [unfinishedId] },
  })
  assert.equal(unfinishedJob.status, 409)
  assert.equal(unfinishedJob.body.code, 'coach_upload_not_ready')
  const mixedJob = await request('/api/ai/coach/jobs/cj-mixedImages123456789', {
    method: 'POST',
    body: { feature: 'answers', helpIntent: 'worked-solution', message: 'Analyze this image.', context: { view: 'coach-photo' }, imageUploadIds: [readyId], imageDataUrls: [pngDataUrl] },
  })
  assert.equal(mixedJob.status, 400)
  assert.equal(mixedJob.body.code, 'coach_upload_input_conflict')
  const malformedMixedJob = await request('/api/ai/coach/jobs/cj-mixedMalformed1234567', {
    method: 'POST',
    body: { feature: 'answers', helpIntent: 'worked-solution', message: 'Analyze this image.', context: { view: 'coach-photo' }, imageUploadIds: [readyId], imageDataUrls: 'nonempty-invalid-inline-field' },
  })
  assert.equal(malformedMixedJob.status, 400)
  assert.equal(malformedMixedJob.body.code, 'coach_upload_input_conflict')
  assert.equal(providerCalls, callsBeforeInvalidJobs, 'invalid upload jobs must make zero provider calls')

  const mirrorId = 'cu-mirrorImage123456789'
  await init(mirrorId)
  await append(mirrorId, 0, pngBase64)
  await complete(mirrorId)
  const jobId = 'cj-uploadedImage123456789'
  const jobBody = { feature: 'answers', helpIntent: 'worked-solution', message: 'Analyze this image.', context: { view: 'coach-photo' }, imageUploadIds: [readyId] }
  const accepted = await request(`/api/ai/coach/jobs/${jobId}`, { method: 'POST', body: jobBody })
  assert.equal(accepted.status, 202)
  assert.equal(accepted.body.created, true)
  const duplicate = await request(`/api/ai/coach/jobs/${jobId}`, { method: 'POST', body: jobBody })
  assert.equal(duplicate.status, 202)
  assert.equal(duplicate.body.created, false)
  const duplicateContent = await request(`/api/ai/coach/jobs/${jobId}`, { method: 'POST', body: { ...jobBody, imageUploadIds: [mirrorId] } })
  assert.equal(duplicateContent.status, 202)
  assert.equal(duplicateContent.body.created, false, 'idempotency hashes normalized image content instead of upload ID')
  await new Promise(resolve => setTimeout(resolve, 100))
  const job = await request(`/api/ai/coach/jobs/${jobId}`)
  assert.equal(job.body.status, 'succeeded')
  assert.equal(providerCalls, callsBeforeInvalidJobs + 1, 'same job retry must run inference once')
  assert.ok(providerBodies.at(-1).messages.at(-1).content.some(part => part.type === 'image_url' && part.image_url.url === pngDataUrl))
  assert.doesNotMatch(JSON.stringify(job.body), /data:image|imageUploadIds|iVBORw0/)

  assert.equal((await request(uploadPath(readyId), { method: 'DELETE' })).status, 200)
  assert.equal((await request(uploadPath(mirrorId), { method: 'DELETE' })).status, 200)
  assert.equal((await request(uploadPath(readyId))).status, 404)
  const jobAfterDelete = await request(`/api/ai/coach/jobs/${jobId}`)
  assert.equal(jobAfterDelete.body.status, 'succeeded', 'completed job recovery must not depend on retained upload bytes')

  const legacyJobId = 'cj-legacyImage1234567890'
  const legacy = await request(`/api/ai/coach/jobs/${legacyJobId}`, {
    method: 'POST',
    body: { feature: 'answers', helpIntent: 'worked-solution', message: 'Analyze the legacy attachment.', context: { view: 'coach-photo' }, imageDataUrls: [pngDataUrl] },
  })
  assert.equal(legacy.status, 202)
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal((await request(`/api/ai/coach/jobs/${legacyJobId}`)).body.status, 'succeeded')
  assert.equal(providerCalls, callsBeforeInvalidJobs + 2, 'legacy imageDataUrls entry remains compatible')

  const cancelledId = 'cu-cancelled1234567890'
  await init(cancelledId)
  assert.equal((await request(uploadPath(cancelledId), { method: 'DELETE' })).status, 200)
  assert.equal((await request(uploadPath(cancelledId))).status, 404)
  assert.equal((await append(cancelledId, 0, pngBase64)).status, 404)

  assert.equal((await request(uploadPath('cu-tooLarge12345678901'), { method: 'PUT', body: { mimeType: 'image/png', base64Length: maxBase64Chars + 4, base64Sha256: 'a'.repeat(64) } })).status, 413)
  const ownerLimitIds = Array.from({ length: 5 }, (_, index) => `cu-ownerLimit${index}1234567890`)
  for (const id of ownerLimitIds.slice(0, 4)) assert.equal((await request(uploadPath(id), { method: 'PUT', owner: 3, body: { mimeType: 'image/png', base64Length: 4, base64Sha256: sha('AAAA') } })).status, 200)
  const ownerLimit = await request(uploadPath(ownerLimitIds[4]), { method: 'PUT', owner: 3, body: { mimeType: 'image/png', base64Length: 4, base64Sha256: sha('AAAA') } })
  assert.equal(ownerLimit.status, 429)
  assert.equal(ownerLimit.body.code, 'coach_upload_owner_limit')
  for (const id of ownerLimitIds.slice(0, 4)) await request(uploadPath(id), { method: 'DELETE', owner: 3 })

  const reservedIds = []
  let reservationFailure = null
  for (let index = 0; index < 6; index += 1) {
    const id = `cu-reserved${index}123456789012`
    const result = await request(uploadPath(id), { method: 'PUT', owner: 10 + index, body: { mimeType: 'image/png', base64Length: maxBase64Chars, base64Sha256: String(index).repeat(64).slice(0, 64) } })
    if (result.status === 200) reservedIds.push({ id, owner: 10 + index })
    else reservationFailure = result
  }
  assert.equal(reservedIds.length, 5)
  assert.equal(reservationFailure.status, 429)
  assert.equal(reservationFailure.body.code, 'coach_upload_capacity')
  for (const item of reservedIds) await request(uploadPath(item.id), { method: 'DELETE', owner: item.owner })

  const restartId = 'cu-restartLost123456789'
  await init(restartId)
  await append(restartId, 0, pngBase64)
  await complete(restartId)
  await api.close()
  api = createAiApi(options)
  assert.equal((await request(uploadPath(restartId))).status, 404, 'in-memory uploads do not survive service restart')

  await api.close()
  api = createAiApi({ ...options, coachImageUploadsOptions: { maxEntries: 2 } })
  for (let index = 0; index < 2; index += 1) {
    const result = await request(uploadPath(`cu-globalEntry${index}123456789`), { method: 'PUT', owner: 30 + index, body: { mimeType: 'image/png', base64Length: 4, base64Sha256: sha('AAAA') } })
    assert.equal(result.status, 200)
  }
  const globalEntryLimit = await request(uploadPath('cu-globalEntry2123456789'), { method: 'PUT', owner: 32, body: { mimeType: 'image/png', base64Length: 4, base64Sha256: sha('AAAA') } })
  assert.equal(globalEntryLimit.status, 429)
  assert.equal(globalEntryLimit.body.code, 'coach_upload_capacity')

  await api.close()
  let clock = 1_000
  api = createAiApi({ ...options, coachImageUploadsOptions: { ttlMs: 50, now: () => clock } })
  const expiredId = 'cu-expiredImage12345678'
  await init(expiredId)
  clock += 51
  assert.ok([404, 410].includes((await request(uploadPath(expiredId))).status))

  console.log('PASS Coach resumable uploads: auth/capabilities/idempotent chunks/owner/TTL/restart/limits/integrity/jobs/legacy/recovery')
} finally {
  await api.close()
  app.closeAllConnections?.()
  provider.closeAllConnections?.()
  await Promise.all([new Promise(resolve => app.close(resolve)), new Promise(resolve => provider.close(resolve))])
  fs.rmSync(root, { recursive: true, force: true })
}
