import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, StandardFonts } from 'pdf-lib'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const signingKey = 'whole-paper-api-signing-key'

function identityToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: `ielts:${userId}`, username: `student-${userId}`, iat: now, exp: now + 3600,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function imageFixture(label, color) {
  const canvas = createCanvas(420, 300)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, 420, 300)
  context.fillStyle = color
  context.font = 'bold 34px sans-serif'
  context.fillText(label, 30, 90)
  return canvas.toBuffer('image/png')
}

async function pdfFixture(label, pages = 1) {
  const document = await PDFDocument.create()
  document.setTitle(label)
  const font = await document.embedFont(StandardFonts.Helvetica)
  for (let index = 0; index < pages; index += 1) {
    const page = document.addPage([595, 842])
    page.drawText(`${label} ${index + 1}`, { x: 50, y: 742, size: 28, font })
  }
  return Buffer.from(await document.save())
}

function call(api, { method, url, token = '', json, raw, contentType = '' }) {
  return new Promise((resolve, reject) => {
    const body = raw !== undefined ? Buffer.from(raw) : json !== undefined ? Buffer.from(JSON.stringify(json), 'utf8') : Buffer.alloc(0)
    const request = Readable.from(body.length ? [body] : [])
    request.method = method
    request.url = url
    request.headers = {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(contentType ? { 'content-type': contentType } : {}),
      ...(body.length ? { 'content-length': String(body.length) } : {}),
    }
    const chunks = []
    const response = {
      statusCode: 0,
      headers: new Map(),
      setHeader(name, value) { this.headers.set(String(name).toLowerCase(), String(value)) },
      getHeader(name) { return this.headers.get(String(name).toLowerCase()) },
      writeHead(statusCode, headers = {}) { this.statusCode = statusCode; for (const [name, value] of Object.entries(headers)) this.setHeader(name, value) },
      write(chunk) { if (chunk) chunks.push(Buffer.from(chunk)) },
      end(chunk = '') {
        if (chunk !== '') chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        const buffer = Buffer.concat(chunks)
        let payload = null
        try { payload = JSON.parse(buffer.toString('utf8') || '{}') } catch { /* binary response */ }
        resolve({ statusCode: this.statusCode, headers: Object.fromEntries(this.headers), buffer, payload })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

async function waitForStatus(api, jobId, token, expected, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await call(api, { method: 'GET', url: `/api/stem/paper-marking-jobs/${jobId}`, token })
    if (expected.includes(latest.payload?.status)) return latest
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${expected.join(', ')}; latest=${JSON.stringify(latest?.payload)}`)
}

const ownerToken = identityToken(1001)
const otherToken = identityToken(2002)
const answer1 = imageFixture('Answer 1', '#285')
const answer2 = imageFixture('Answer 2', '#258')
const questionPaper = await pdfFixture('Question paper', 2)
const markScheme = await pdfFixture('Mark scheme', 2)
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-whole-paper-api-'))
const runnerCalls = []

try {
  const api = createStemApi({
    env: { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: ':memory:' },
    questionBank: [],
    wholePaperMarkingOptions: {
      storageRoot: path.join(temporaryRoot, 'private-jobs'),
      jobTimeoutMs: 3000,
      runner: async (input) => {
        runnerCalls.push(input)
        assert.equal(input.answerPages.length, 2)
        assert.ok(input.answerPages.every((page) => /^data:image\/jpeg;base64,/.test(page.dataUrl)), 'worker must send rendered page images, not extracted text')
        return {
          schemaVersion: 'stem-paper-marking-result-v1',
          assessmentMode: input.markSchemePages.length ? 'ai-provisional' : 'ai-advisory-unscored',
          officialScore: false,
          formalProgressEligible: false,
          provisionalScore: input.markSchemePages.length ? 6 : null,
          maxScore: input.markSchemePages.length ? 10 : null,
          reviewRequired: true,
          missingPages: [3],
          missingQuestions: ['Q4'],
          summary: 'Fixture visual review completed.',
          questionResults: [{ questionLabel: 'Q1', provisionalScore: 2, maxScore: 3, confidence: 0.8, reviewRequired: false, rationale: 'Visible working.', evidence: ['Page 1'], criteria: [] }],
          provider: 'fixture-vision',
          model: 'fixture-model',
        }
      },
    },
  })

  const anonymous = await call(api, { method: 'POST', url: '/api/stem/paper-marking-jobs', json: {} })
  assert.equal(anonymous.statusCode, 401)

  const createBody = {
    schemaVersion: 'stem-paper-marking-job-v1',
    clientRequestId: 'whole-paper-request-0001',
    title: 'Physics whole-paper practice',
    studentLabel: 'Student A',
    instructions: 'Review clarity only. This is report context, not a model instruction.',
    routeId: 'cie-9702-as-physics',
    stage: 'AS',
    paperId: 'student-uploaded-mock-1',
    files: [
      { clientAssetId: 'answer-1', role: 'answer', mediaType: 'image/png', order: 1, fileName: 'answer-1.png', size: answer1.length },
      { clientAssetId: 'answer-2', role: 'answer', mediaType: 'image/png', order: 2, fileName: 'answer-2.png', size: answer2.length },
      { clientAssetId: 'question-paper', role: 'question-paper', mediaType: 'application/pdf', order: 1, fileName: 'question.pdf', size: questionPaper.length },
      { clientAssetId: 'mark-scheme', role: 'mark-scheme', mediaType: 'application/pdf', order: 1, fileName: 'marks.pdf', size: markScheme.length },
    ],
  }
  const created = await call(api, { method: 'POST', url: '/api/stem/paper-marking-jobs', token: ownerToken, json: createBody })
  assert.equal(created.statusCode, 201, JSON.stringify(created.payload))
  assert.equal(created.payload.status, 'draft')
  assert.match(created.payload.expiresAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(created.payload.assets.length, 4)
  assert.ok(created.payload.assets.every((asset) => asset.status === 'awaiting-upload' && asset.clientAssetId && asset.assetId && asset.fileName))
  assert.ok(created.payload.assets.every((asset) => asset.uploadPath.endsWith(`/files/${asset.assetId}`)))
  const jobId = created.payload.jobId
  const byClientId = Object.fromEntries(created.payload.assets.map((asset) => [asset.clientAssetId, asset]))

  const idempotentCreate = await call(api, { method: 'POST', url: '/api/stem/paper-marking-jobs', token: ownerToken, json: createBody })
  assert.equal(idempotentCreate.statusCode, 200)
  assert.equal(idempotentCreate.payload.jobId, jobId)
  assert.equal(idempotentCreate.payload.duplicate, true)
  const conflictingCreate = await call(api, { method: 'POST', url: '/api/stem/paper-marking-jobs', token: ownerToken, json: { ...createBody, title: 'Changed title' } })
  assert.equal(conflictingCreate.statusCode, 409)
  assert.equal(conflictingCreate.payload.code, 'idempotency_conflict')

  const crossUserRead = await call(api, { method: 'GET', url: `/api/stem/paper-marking-jobs/${jobId}`, token: otherToken })
  assert.equal(crossUserRead.statusCode, 404)
  const crossUserUpload = await call(api, { method: 'PUT', url: byClientId['answer-1'].uploadPath, token: otherToken, raw: answer1, contentType: 'image/png' })
  assert.equal(crossUserUpload.statusCode, 404)

  const wrongType = await call(api, { method: 'PUT', url: byClientId['answer-1'].uploadPath, token: ownerToken, raw: questionPaper, contentType: 'image/png' })
  assert.equal(wrongType.statusCode, 400)
  assert.equal(wrongType.payload.code, 'asset_type_mismatch')

  for (const [clientAssetId, raw, mediaType] of [
    ['answer-1', answer1, 'image/png'],
    ['answer-2', answer2, 'image/png'],
    ['question-paper', questionPaper, 'application/pdf'],
    ['mark-scheme', markScheme, 'application/pdf'],
  ]) {
    const uploaded = await call(api, { method: 'PUT', url: byClientId[clientAssetId].uploadPath, token: ownerToken, raw, contentType: mediaType })
    assert.equal(uploaded.statusCode, 200, `${clientAssetId}: ${JSON.stringify(uploaded.payload)}`)
    assert.equal(uploaded.payload.status, 'uploaded')
  }
  const duplicateUpload = await call(api, { method: 'PUT', url: byClientId['answer-1'].uploadPath, token: ownerToken, raw: answer1, contentType: 'image/png' })
  assert.equal(duplicateUpload.statusCode, 200)
  assert.equal(duplicateUpload.payload.duplicate, true)
  const changedUpload = await call(api, { method: 'PUT', url: byClientId['answer-1'].uploadPath, token: ownerToken, raw: answer2, contentType: 'image/png' })
  assert.equal(changedUpload.statusCode, 409)
  assert.equal(changedUpload.payload.code, 'asset_already_uploaded')

  const hydrated = await call(api, { method: 'GET', url: `/api/stem/paper-marking-jobs/${jobId}`, token: ownerToken })
  assert.equal(hydrated.statusCode, 200)
  assert.ok(hydrated.payload.assets.every((asset) => asset.status === 'uploaded' && asset.fileName))

  const wrongOrder = await call(api, {
    method: 'POST', url: `/api/stem/paper-marking-jobs/${jobId}/submit`, token: ownerToken,
    json: { clientRequestId: createBody.clientRequestId, answerAssetIds: [byClientId['answer-2'].assetId, byClientId['answer-1'].assetId], questionPaperAssetId: byClientId['question-paper'].assetId, markSchemeAssetId: byClientId['mark-scheme'].assetId },
  })
  assert.equal(wrongOrder.statusCode, 409)
  assert.equal(wrongOrder.payload.code, 'answer_asset_order_mismatch')

  const submitBody = {
    clientRequestId: createBody.clientRequestId,
    answerAssetIds: [byClientId['answer-1'].assetId, byClientId['answer-2'].assetId],
    questionPaperAssetId: byClientId['question-paper'].assetId,
    markSchemeAssetId: byClientId['mark-scheme'].assetId,
  }
  const submitted = await call(api, { method: 'POST', url: `/api/stem/paper-marking-jobs/${jobId}/submit`, token: ownerToken, json: submitBody })
  assert.equal(submitted.statusCode, 202, JSON.stringify(submitted.payload))
  const uploadAfterSubmit = await call(api, { method: 'PUT', url: byClientId['answer-1'].uploadPath, token: ownerToken, raw: answer1, contentType: 'image/png' })
  assert.equal(uploadAfterSubmit.statusCode, 409, 'submitted file bindings must be immutable')
  assert.equal(uploadAfterSubmit.payload.code, 'job_not_draft')
  const duplicateSubmit = await call(api, { method: 'POST', url: `/api/stem/paper-marking-jobs/${jobId}/submit`, token: ownerToken, json: submitBody })
  assert.equal(duplicateSubmit.statusCode, 200)
  assert.equal(duplicateSubmit.payload.duplicate, true)

  const completed = await waitForStatus(api, jobId, ownerToken, ['completed'])
  assert.equal(runnerCalls.length, 1, 'duplicate submit must not start or charge a second processing attempt')
  assert.equal(completed.payload.result.assessmentMode, 'ai-provisional')
  assert.equal(completed.payload.result.provisionalScore, null, 'missing pages/questions must suppress an apparently complete total')
  assert.equal(completed.payload.result.maxScore, null)
  assert.equal(completed.payload.result.officialScore, false)
  assert.equal(completed.payload.result.formalProgressEligible, false)
  assert.deepEqual(completed.payload.result.missingPages, [3])
  assert.deepEqual(completed.payload.result.missingQuestions, ['Q4'])
  assert.match(completed.payload.sourcePdfPath, /source\.pdf$/)
  assert.match(completed.payload.reportPdfPath, /report\.pdf$/)
  assert.equal(completed.payload.reportTextSelectable, false)
  assert.match(completed.payload.expiresAt, /^\d{4}-\d{2}-\d{2}T/)

  const source = await call(api, { method: 'GET', url: completed.payload.sourcePdfPath, token: ownerToken })
  assert.equal(source.statusCode, 200)
  assert.equal(source.headers['content-type'], 'application/pdf')
  assert.match(source.headers['content-disposition'], /filename\*=UTF-8''/)
  const sourceDocument = await getDocument({ data: new Uint8Array(source.buffer), disableWorker: true }).promise
  assert.equal(sourceDocument.numPages, 2)
  await sourceDocument.destroy()

  const report = await call(api, { method: 'GET', url: completed.payload.reportPdfPath, token: ownerToken })
  assert.equal(report.statusCode, 200)
  assert.equal(report.headers['x-stem-report-text-selectable'], 'false')
  assert.equal(report.buffer.subarray(0, 5).toString('ascii'), '%PDF-')
  assert.match(report.headers['content-disposition'], /filename="ai-marking-report-/)
  const reportDocument = await getDocument({ data: new Uint8Array(report.buffer), disableWorker: true }).promise
  assert.ok(reportDocument.numPages >= 1)
  await reportDocument.destroy()

  const otherReport = await call(api, { method: 'GET', url: completed.payload.reportPdfPath, token: otherToken })
  assert.equal(otherReport.statusCode, 404)
  const listed = await call(api, { method: 'GET', url: '/api/stem/paper-marking-jobs?limit=10', token: ownerToken })
  assert.equal(listed.statusCode, 200)
  assert.equal(listed.payload.jobs[0].jobId, jobId)
  assert.ok(Array.isArray(listed.payload.jobs[0].assets))

  closeStemDatabaseForTests()

  const timeoutRoot = path.join(temporaryRoot, 'timeout-jobs')
  const timeoutApi = createStemApi({
    env: { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: ':memory:' },
    questionBank: [],
    wholePaperMarkingOptions: {
      storageRoot: timeoutRoot,
      jobTimeoutMs: 80,
      runner: async ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'aborted' })), { once: true })
      }),
    },
  })
  const timeoutPdf = await pdfFixture('Answer PDF', 2)
  const timeoutCreateBody = {
    schemaVersion: 'stem-paper-marking-job-v1', clientRequestId: 'timeout-request-0001', title: 'Timeout fixture',
    files: [{ clientAssetId: 'answer-pdf', role: 'answer', mediaType: 'application/pdf', order: 1, fileName: 'answer.pdf', size: timeoutPdf.length }],
  }
  const timeoutCreated = await call(timeoutApi, { method: 'POST', url: '/api/stem/paper-marking-jobs', token: ownerToken, json: timeoutCreateBody })
  assert.equal(timeoutCreated.statusCode, 201)
  const timeoutAsset = timeoutCreated.payload.assets[0]
  assert.equal((await call(timeoutApi, { method: 'PUT', url: timeoutAsset.uploadPath, token: ownerToken, raw: timeoutPdf, contentType: 'application/pdf' })).statusCode, 200)
  assert.equal((await call(timeoutApi, { method: 'POST', url: `/api/stem/paper-marking-jobs/${timeoutCreated.payload.jobId}/submit`, token: ownerToken, json: { clientRequestId: timeoutCreateBody.clientRequestId, answerAssetIds: [timeoutAsset.assetId] } })).statusCode, 202)
  const timedOut = await waitForStatus(timeoutApi, timeoutCreated.payload.jobId, ownerToken, ['failed'])
  assert.equal(timedOut.payload.failureCode, 'marking_timeout')
  assert.equal(timedOut.payload.retryable, true)
  assert.equal(timedOut.payload.assets[0].status, 'uploaded', 'timeout must retain the uploaded answer for explicit retry')
  const retry = await call(timeoutApi, { method: 'POST', url: `/api/stem/paper-marking-jobs/${timeoutCreated.payload.jobId}/retry`, token: ownerToken, json: { clientRequestId: 'timeout-retry-0001' } })
  assert.equal(retry.statusCode, 202)
  const timedOutAgain = await waitForStatus(timeoutApi, timeoutCreated.payload.jobId, ownerToken, ['failed'])
  assert.ok(timedOutAgain.payload.processingAttempt >= 2)

  console.log('Whole-paper marking API checks passed')
} finally {
  closeStemDatabaseForTests()
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
