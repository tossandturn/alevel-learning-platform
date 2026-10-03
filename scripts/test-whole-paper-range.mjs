import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { PDFDocument, StandardFonts } from 'pdf-lib'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const signingKey = 'whole-paper-range-signing-key'

function identityToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: `ielts:${userId}`, username: `student-${userId}`, iat: now, exp: now + 3600,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

async function pdfFixture() {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  for (let index = 0; index < 2; index += 1) {
    const page = document.addPage([595, 842])
    page.drawText(`Range fixture answer page ${index + 1}`, { x: 48, y: 760, size: 24, font })
    for (let line = 0; line < 40; line += 1) page.drawText(`Synthetic working ${index + 1}.${line + 1}`, { x: 48, y: 720 - line * 15, size: 10, font })
  }
  return Buffer.from(await document.save({ useObjectStreams: false }))
}

function startServer(handler) {
  const server = http.createServer((request, response) => {
    Promise.resolve(handler(request, response, () => {
      response.statusCode = 404
      response.end('not found')
    })).catch((error) => {
      response.statusCode = 500
      response.end(error.message)
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function request(origin, pathname, { method = 'GET', token = '', headers = {}, body } = {}) {
  return fetch(`${origin}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
  })
}

async function json(response) {
  return response.json()
}

async function waitForCompleted(origin, jobId, token) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const response = await request(origin, `/api/stem/paper-marking-jobs/${jobId}`, { token })
    const value = await json(response)
    if (value.status === 'completed') return value
    if (value.status === 'failed') throw new Error(`Fixture marking failed: ${JSON.stringify(value)}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for whole-paper range fixture')
}

function assertPrivatePdfHeaders(response) {
  assert.equal(response.headers.get('accept-ranges'), 'bytes')
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.match(response.headers.get('content-disposition') || '', /attachment/)
  assert.match(response.headers.get('etag') || '', /^"sha256-[a-f0-9]{64}"$/)
}

function expectedRange(buffer, start, end) {
  return buffer.subarray(start, end + 1)
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-whole-paper-range-'))
const ownerToken = identityToken(3101)
const otherToken = identityToken(3102)
let server

try {
  const api = createStemApi({
    env: { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: ':memory:' },
    questionBank: [],
    wholePaperMarkingOptions: {
      storageRoot: path.join(temporaryRoot, 'private-jobs'),
      jobTimeoutMs: 3000,
      runner: async () => ({
        schemaVersion: 'stem-paper-marking-result-v1', assessmentMode: 'ai-advisory-unscored', officialScore: false,
        formalProgressEligible: false, provisionalScore: null, maxScore: null, reviewRequired: true,
        missingPages: [], missingQuestions: [], summary: 'Synthetic local range report.',
        questionResults: [{ questionLabel: 'Q1', provisionalScore: null, maxScore: null, confidence: 0.8, reviewRequired: true, rationale: 'Synthetic feedback.', evidence: ['Answer page 1'], criteria: [] }],
        provider: 'fixture', model: 'fixture',
      }),
    },
  })
  server = await startServer(api)
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`
  const answer = await pdfFixture()
  const createResponse = await request(origin, '/api/stem/paper-marking-jobs', {
    method: 'POST', token: ownerToken, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: 'stem-paper-marking-job-v1', clientRequestId: 'range-request-0001', title: 'Range fixture',
      files: [{ clientAssetId: 'answer-pdf', role: 'answer', mediaType: 'application/pdf', order: 1, fileName: 'answer.pdf', size: answer.length }],
    }),
  })
  assert.equal(createResponse.status, 201)
  const created = await json(createResponse)
  const asset = created.assets[0]
  assert.equal((await request(origin, asset.uploadPath, { method: 'PUT', token: ownerToken, headers: { 'Content-Type': 'application/pdf' }, body: answer })).status, 200)
  const submitResponse = await request(origin, `/api/stem/paper-marking-jobs/${created.jobId}/submit`, {
    method: 'POST', token: ownerToken, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientRequestId: 'range-request-0001', answerAssetIds: [asset.assetId] }),
  })
  assert.equal(submitResponse.status, 202)
  const completed = await waitForCompleted(origin, created.jobId, ownerToken)

  const fullResponse = await request(origin, completed.sourcePdfPath, { token: ownerToken })
  assert.equal(fullResponse.status, 200)
  assertPrivatePdfHeaders(fullResponse)
  const full = Buffer.from(await fullResponse.arrayBuffer())
  assert.ok(full.length > 256)
  assert.equal(fullResponse.headers.get('content-length'), String(full.length))
  assert.equal(fullResponse.headers.get('etag'), `"sha256-${crypto.createHash('sha256').update(full).digest('hex')}"`)
  assert.deepEqual(full, answer, 'Original GET must preserve complete source PDF bytes')
  const etag = fullResponse.headers.get('etag')

  for (const fixture of [
    { name: 'prefix', range: 'bytes=0-63', start: 0, end: 63 },
    { name: 'middle', range: 'bytes=64-127', start: 64, end: 127 },
    { name: 'open-end', range: 'bytes=128-', start: 128, end: full.length - 1 },
    { name: 'suffix', range: 'bytes=-64', start: full.length - 64, end: full.length - 1 },
  ]) {
    const response = await request(origin, completed.sourcePdfPath, { token: ownerToken, headers: { Range: fixture.range } })
    assert.equal(response.status, 206, fixture.name)
    assertPrivatePdfHeaders(response)
    assert.equal(response.headers.get('content-range'), `bytes ${fixture.start}-${fixture.end}/${full.length}`)
    assert.equal(response.headers.get('content-length'), String(fixture.end - fixture.start + 1))
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), expectedRange(full, fixture.start, fixture.end), fixture.name)
  }

  const matched = await request(origin, completed.sourcePdfPath, { token: ownerToken, headers: { Range: 'bytes=0-31', 'If-Range': etag } })
  assert.equal(matched.status, 206)
  assert.deepEqual(Buffer.from(await matched.arrayBuffer()), expectedRange(full, 0, 31))

  for (const mismatch of [`"sha256-${'0'.repeat(64)}"`, `W/${etag}`]) {
    const response = await request(origin, completed.sourcePdfPath, { token: ownerToken, headers: { Range: 'bytes=0-31', 'If-Range': mismatch } })
    assert.equal(response.status, 200, mismatch)
    assertPrivatePdfHeaders(response)
    assert.equal(response.headers.get('content-range'), null)
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), full)
  }

  for (const range of ['bytes=999999999-', 'bytes=12-4', 'bytes=0-1,4-5', 'items=0-1', 'bytes=-0']) {
    const response = await request(origin, completed.sourcePdfPath, { token: ownerToken, headers: { Range: range } })
    assert.equal(response.status, 416, range)
    assertPrivatePdfHeaders(response)
    assert.equal(response.headers.get('content-range'), `bytes */${full.length}`)
    assert.equal(response.headers.get('content-length'), '0')
    assert.equal((await response.arrayBuffer()).byteLength, 0)
  }

  const reportResponse = await request(origin, completed.reportPdfPath, { token: ownerToken })
  assert.equal(reportResponse.status, 200)
  assertPrivatePdfHeaders(reportResponse)
  assert.equal(reportResponse.headers.get('x-stem-report-text-selectable'), 'false')
  const reportBytes = Buffer.from(await reportResponse.arrayBuffer())
  assert.equal(reportBytes.subarray(0, 5).toString('ascii'), '%PDF-')
  const reportRange = await request(origin, completed.reportPdfPath, { token: ownerToken, headers: { Range: 'bytes=0-63' } })
  assert.equal(reportRange.status, 206)
  assertPrivatePdfHeaders(reportRange)
  assert.equal(reportRange.headers.get('x-stem-report-text-selectable'), 'false')
  assert.equal(reportRange.headers.get('content-range'), `bytes 0-63/${reportBytes.length}`)
  assert.deepEqual(Buffer.from(await reportRange.arrayBuffer()), reportBytes.subarray(0, 64))

  const crossOwner = await request(origin, completed.sourcePdfPath, { token: otherToken, headers: { Range: 'bytes=0-31' } })
  const noSession = await request(origin, completed.sourcePdfPath, { headers: { Range: 'bytes=0-31' } })
  assert.equal(crossOwner.status, 404)
  assert.equal(noSession.status, 401)
  for (const unauthorized of [crossOwner, noSession]) {
    for (const name of ['etag', 'accept-ranges', 'content-range']) assert.equal(unauthorized.headers.get(name), null, `${unauthorized.status} must not leak ${name}`)
    assert.notEqual(unauthorized.headers.get('content-length'), String(full.length), `${unauthorized.status} must not leak artifact size`)
  }

  console.log('Whole-paper PDF range: full GET, single ranges, If-Range, 416, owner and session isolation PASS')
} finally {
  if (server) await new Promise((resolve) => server.close(resolve))
  closeStemDatabaseForTests()
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
