import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument, StandardFonts } from 'pdf-lib'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const signingKey = 'whole-paper-progress-signing-key'

function identityToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: `ielts:${userId}`, iat: issuedAt, exp: issuedAt + 3600,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function answerImage(label = 'Student answer') {
  const canvas = createCanvas(320, 240)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, 320, 240)
  context.fillStyle = '#111'
  context.font = '26px sans-serif'
  context.fillText(label, 20, 72)
  return canvas.toBuffer('image/png')
}

async function reportPdf(label) {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const page = document.addPage([420, 595])
  page.drawText(label, { x: 30, y: 530, size: 18, font })
  return Buffer.from(await document.save())
}

function successResult(summary = 'Synthetic whole-paper review completed.') {
  return {
    assessmentMode: 'ai-advisory-unscored', officialScore: false, formalProgressEligible: false,
    provisionalScore: null, maxScore: null, reviewRequired: true, missingPages: [], missingQuestions: [],
    summary,
    questionResults: [{
      questionLabel: 'Q1', provisionalScore: null, maxScore: null, confidence: 0.8, reviewRequired: true,
      rationale: 'The submitted answer page is visible.', evidence: ['Student answer page 1'], criteria: [],
    }],
    provider: 'fixture', model: 'fixture',
  }
}

function call(api, { method, url, token, json, raw, contentType = '' }) {
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
      write(chunk) { if (chunk) chunks.push(Buffer.from(chunk)) },
      end(chunk = '') {
        if (chunk !== '') chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        const buffer = Buffer.concat(chunks)
        let payload = null
        try { payload = JSON.parse(buffer.toString('utf8') || '{}') } catch { /* Binary response. */ }
        resolve({ statusCode: this.statusCode, payload, buffer })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

async function waitFor(api, token, jobId, predicate, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await call(api, { method: 'GET', url: `/api/stem/paper-marking-jobs/${jobId}`, token })
    if (predicate(latest.payload)) return latest.payload
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error(`Timed out waiting for job state; latest=${JSON.stringify(latest?.payload)}`)
}

async function createUploadSubmit(api, token, image, { clientRequestId, title }) {
  const created = await call(api, {
    method: 'POST', url: '/api/stem/paper-marking-jobs', token,
    json: {
      schemaVersion: 'stem-paper-marking-job-v1', clientRequestId, title,
      files: [{ clientAssetId: 'answer-1', role: 'answer', mediaType: 'image/png', order: 1, fileName: 'answer.png', size: image.length }],
    },
  })
  assert.equal(created.statusCode, 201, JSON.stringify(created.payload))
  const asset = created.payload.assets[0]
  const uploaded = await call(api, { method: 'PUT', url: asset.uploadPath, token, raw: image, contentType: 'image/png' })
  assert.equal(uploaded.statusCode, 200, JSON.stringify(uploaded.payload))
  const submitted = await call(api, {
    method: 'POST', url: `/api/stem/paper-marking-jobs/${created.payload.jobId}/submit`, token,
    json: { clientRequestId, answerAssetIds: [asset.assetId] },
  })
  assert.equal(submitted.statusCode, 202, JSON.stringify(submitted.payload))
  return { created: created.payload, submitted: submitted.payload, jobId: created.payload.jobId }
}

function assertUnknownEstimate(progress) {
  assert.equal(progress.estimatedRemainingSeconds, null)
  assert.equal(progress.estimatedRemainingRangeSeconds, null)
  assert.equal(progress.isEstimate, false)
  assert.equal(progress.estimateScope, null)
  assert.equal('queuePosition' in progress, false, 'the API must not invent or expose a queue position')
}

const ownerToken = identityToken(31001)
const otherToken = identityToken(32002)
const image = answerImage()
const questionPaper = await reportPdf('Question paper fixture')
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-whole-paper-progress-'))

try {
  let clock = Date.parse('2026-10-04T00:00:00.000Z')
  let api
  const jobIdsByTitle = new Map()
  const firstEntered = deferred()
  const releaseFirst = deferred()
  const estimatedEntered = deferred()
  const releaseEstimated = deferred()
  const observedStages = []
  const progressEvents = []

  api = createStemApi({
    env: { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: ':memory:' },
    questionBank: [],
    wholePaperMarkingOptions: {
      storageRoot: path.join(temporaryRoot, 'history-assets'),
      now: () => clock,
      jobTimeoutMs: 3_000,
      progressObserver: (event) => progressEvents.push(event),
      runner: async ({ job }) => {
        if (job.title === 'No history yet') {
          clock += 5_000
          const snapshot = await call(api, { method: 'GET', url: `/api/stem/paper-marking-jobs/${job.id}`, token: ownerToken })
          observedStages.push(snapshot.payload.progress.stage)
          assert.equal(snapshot.payload.progress.phase, 'analyzing')
          assert.equal(snapshot.payload.progress.label, 'AI analysis in progress')
          assert.equal(snapshot.payload.progress.elapsedSeconds, 5)
          assert.equal(snapshot.payload.progress.processingElapsedSeconds, 5)
          assert.equal(snapshot.payload.progress.completedPages, 2)
          assert.equal(snapshot.payload.progress.totalPages, 2)
          assert.equal(snapshot.payload.progress.answerPages, 1)
          assert.equal(snapshot.payload.progress.referencePages, 1)
          assertUnknownEstimate(snapshot.payload.progress)
          firstEntered.resolve()
          await releaseFirst.promise
          clock += 25_000
        } else if (job.title === 'History-backed estimate') {
          clock += 5_000
          const snapshot = await call(api, { method: 'GET', url: `/api/stem/paper-marking-jobs/${job.id}`, token: ownerToken })
          observedStages.push(snapshot.payload.progress.stage)
          assert.equal(snapshot.payload.progress.phase, 'analyzing')
          assert.equal(snapshot.payload.progress.isEstimate, true)
          assert.equal(snapshot.payload.progress.estimateScope, 'processing-only')
          assert.ok(snapshot.payload.progress.estimatedRemainingSeconds > 0)
          assert.ok(snapshot.payload.progress.estimatedRemainingRangeSeconds.minimum > 0)
          assert.ok(snapshot.payload.progress.estimatedRemainingRangeSeconds.maximum >= snapshot.payload.progress.estimatedRemainingRangeSeconds.minimum)
          estimatedEntered.resolve()
          await releaseEstimated.promise
          clock += 5_000
        } else {
          clock += job.title.endsWith('slow') ? 40_000 : 30_000
        }
        return successResult(job.title)
      },
      reportRenderer: async (input) => {
        clock += 5_000
        const jobId = jobIdsByTitle.get(input.title)
        if (!jobId) return reportPdf(input.title)
        const snapshot = await call(api, { method: 'GET', url: `/api/stem/paper-marking-jobs/${jobId}`, token: ownerToken })
        observedStages.push(snapshot.payload.progress.stage)
        assert.equal(snapshot.payload.progress.phase, 'reporting')
        assert.equal(snapshot.payload.progress.label, 'Generating report')
        return reportPdf(input.title)
      },
    },
  })

  const firstCreated = await call(api, {
    method: 'POST', url: '/api/stem/paper-marking-jobs', token: ownerToken,
    json: {
      schemaVersion: 'stem-paper-marking-job-v1', clientRequestId: 'progress-first-0001', title: 'No history yet',
      files: [
        { clientAssetId: 'answer-1', role: 'answer', mediaType: 'image/png', order: 1, fileName: 'answer.png', size: image.length },
        { clientAssetId: 'question-paper', role: 'question-paper', mediaType: 'application/pdf', order: 1, fileName: 'question.pdf', size: questionPaper.length },
      ],
    },
  })
  assert.equal(firstCreated.payload.progress.phase, 'uploading')
  assert.equal(firstCreated.payload.progress.label, 'Waiting for uploads')
  assert.equal(firstCreated.payload.progress.elapsedSeconds, 0)
  assert.equal(firstCreated.payload.progress.answerPages, null)
  assertUnknownEstimate(firstCreated.payload.progress)
  jobIdsByTitle.set('No history yet', firstCreated.payload.jobId)
  const firstAsset = firstCreated.payload.assets[0]
  const firstReference = firstCreated.payload.assets.find((asset) => asset.role === 'question-paper')
  await call(api, { method: 'PUT', url: firstAsset.uploadPath, token: ownerToken, raw: image, contentType: 'image/png' })
  await call(api, { method: 'PUT', url: firstReference.uploadPath, token: ownerToken, raw: questionPaper, contentType: 'application/pdf' })
  const firstSubmitted = await call(api, {
    method: 'POST', url: `/api/stem/paper-marking-jobs/${firstCreated.payload.jobId}/submit`, token: ownerToken,
    json: { clientRequestId: 'progress-first-0001', answerAssetIds: [firstAsset.assetId], questionPaperAssetId: firstReference.assetId },
  })
  observedStages.push(firstSubmitted.payload.progress.stage)
  assert.equal(firstSubmitted.payload.progress.phase, 'queued')
  assertUnknownEstimate(firstSubmitted.payload.progress)

  const crossOwner = await call(api, { method: 'GET', url: `/api/stem/paper-marking-jobs/${firstCreated.payload.jobId}`, token: otherToken })
  assert.equal(crossOwner.statusCode, 404)
  const otherList = await call(api, { method: 'GET', url: '/api/stem/paper-marking-jobs', token: otherToken })
  assert.deepEqual(otherList.payload.jobs, [], 'progress summaries remain owner-isolated')

  await firstEntered.promise
  releaseFirst.resolve()
  const firstCompleted = await waitFor(api, ownerToken, firstCreated.payload.jobId, (job) => job?.status === 'completed')
  observedStages.push(firstCompleted.progress.stage)
  assert.equal(firstCompleted.progress.phase, 'completed')
  assert.equal(firstCompleted.progress.label, 'Marking complete')
  assert.equal(firstCompleted.progress.completedPages, 2)
  assert.equal(firstCompleted.progress.totalPages, 2)
  assert.equal(firstCompleted.progress.lastStage, 'reporting')
  assert.equal(firstCompleted.progress.lastPhase, 'reporting')
  assert.ok(Number.isSafeInteger(firstCompleted.progress.phaseElapsedSeconds) && firstCompleted.progress.phaseElapsedSeconds >= 0)
  assertUnknownEstimate(firstCompleted.progress)
  const frozenElapsed = firstCompleted.progress.elapsedSeconds
  const firstStageEvents = progressEvents.filter((event) => event.jobId === firstCreated.payload.jobId)
  assert.deepEqual(firstStageEvents.map((event) => event.stage), [
    'queued',
    'starting',
    'preparing-source-pdf',
    'rendering-answer-pages',
    'rendering-references',
    'ai-review',
    'ai-result-received',
    'reporting',
    'completed',
  ], 'persisted progress must follow the real pipeline boundary order')
  assert.deepEqual(firstStageEvents.map((event) => event.completedPages), [0, 0, 0, 0, 1, 2, 2, 2, 2])
  assert.ok(firstStageEvents.every((event) => event.totalPages === 2))
  assert.deepEqual(firstStageEvents.map((event) => event.phase), ['queued', 'preparing', 'preparing', 'preparing', 'preparing', 'analyzing', 'analysis-received', 'reporting', 'completed'])
  assert.ok(firstStageEvents.every((event) => !Object.hasOwn(event, 'owner') && !Object.hasOwn(event, 'content') && !Object.hasOwn(event, 'prompt') && !Object.hasOwn(event, 'token')),
    'operational progress observers expose no owner, answer, prompt or credential fields')
  clock += 60_000
  const completedLater = await call(api, { method: 'GET', url: `/api/stem/paper-marking-jobs/${firstCreated.payload.jobId}`, token: ownerToken })
  assert.equal(completedLater.payload.progress.elapsedSeconds, frozenElapsed, 'terminal elapsed time must not keep increasing')

  for (const [index, suffix] of ['fast', 'slow'].entries()) {
    const title = `History seed ${suffix}`
    const seeded = await createUploadSubmit(api, ownerToken, image, { clientRequestId: `progress-seed-000${index + 1}`, title })
    jobIdsByTitle.set(title, seeded.jobId)
    await waitFor(api, ownerToken, seeded.jobId, (job) => job?.status === 'completed')
  }

  const estimated = await createUploadSubmit(api, ownerToken, image, { clientRequestId: 'progress-estimated-0001', title: 'History-backed estimate' })
  jobIdsByTitle.set('History-backed estimate', estimated.jobId)
  assert.equal(estimated.submitted.progress.phase, 'queued')
  assertUnknownEstimate(estimated.submitted.progress)
  await estimatedEntered.promise
  clock += 10 * 60 * 1000
  const estimateExpired = await call(api, { method: 'GET', url: `/api/stem/paper-marking-jobs/${estimated.jobId}`, token: ownerToken })
  assert.equal(estimateExpired.payload.status, 'processing')
  assertUnknownEstimate(estimateExpired.payload.progress)
  assert.notEqual(estimateExpired.payload.progress.estimatedRemainingSeconds, 0, 'an overdue estimate must become unknown, never zero while active')
  releaseEstimated.resolve()
  await waitFor(api, ownerToken, estimated.jobId, (job) => job?.status === 'completed')

  const stageOrder = ['queued', 'ai-review', 'reporting', 'completed']
  const firstObserved = observedStages.slice(0, 4)
  assert.deepEqual(firstObserved, stageOrder, `observable real stages must be monotonic: ${JSON.stringify(firstObserved)}`)

  const cancelledCreated = await call(api, {
    method: 'POST', url: '/api/stem/paper-marking-jobs', token: ownerToken,
    json: {
      schemaVersion: 'stem-paper-marking-job-v1', clientRequestId: 'progress-cancel-0001', title: 'Cancelled draft',
      files: [{ clientAssetId: 'answer-1', role: 'answer', mediaType: 'image/png', order: 1, fileName: 'answer.png', size: image.length }],
    },
  })
  const cancelled = await call(api, {
    method: 'POST', url: `/api/stem/paper-marking-jobs/${cancelledCreated.payload.jobId}/cancel`, token: ownerToken,
    json: { clientRequestId: 'progress-cancel-action-0001' },
  })
  assert.equal(cancelled.payload.progress.phase, 'cancelled')
  assert.equal(cancelled.payload.progress.label, 'Marking cancelled')
  assertUnknownEstimate(cancelled.payload.progress)

  closeStemDatabaseForTests()

  let retryApi
  let runnerCalls = 0
  const retryProgressEvents = []
  const releaseOldAttempt = deferred()
  const releaseCurrentAttempt = deferred()
  const currentAttemptEntered = deferred()
  retryApi = createStemApi({
    env: { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: ':memory:' },
    questionBank: [],
    wholePaperMarkingOptions: {
      storageRoot: path.join(temporaryRoot, 'retry-assets'),
      jobTimeoutMs: 80,
      abortDrainMs: 20,
      progressObserver: (event) => retryProgressEvents.push(event),
      runner: async () => {
        runnerCalls += 1
        if (runnerCalls === 1) {
          await releaseOldAttempt.promise
          return successResult('late stale result')
        }
        currentAttemptEntered.resolve()
        await releaseCurrentAttempt.promise
        return successResult('current result')
      },
      reportRenderer: (input) => reportPdf(input.title),
    },
  })
  const retried = await createUploadSubmit(retryApi, ownerToken, image, { clientRequestId: 'progress-retry-0001', title: 'Retry progress' })
  const failed = await waitFor(retryApi, ownerToken, retried.jobId, (job) => job?.status === 'failed')
  assert.equal(failed.progress.phase, 'failed')
  assert.equal(failed.progress.label, 'Marking failed')
  assert.equal(failed.progress.lastStage, 'ai-review', 'a terminal failure preserves the real stage that failed')
  assert.equal(failed.progress.lastPhase, 'analyzing')
  assert.ok(Number.isSafeInteger(failed.progress.phaseElapsedSeconds) && failed.progress.phaseElapsedSeconds >= 0)
  const failedMetric = retryProgressEvents.findLast((event) => event.status === 'failed')
  assert.equal(failedMetric.failureCode, 'marking_timeout')
  assert.equal(failedMetric.lastStage, 'ai-review')
  assert.equal(failedMetric.lastPhase, 'analyzing')
  assertUnknownEstimate(failed.progress)
  const retryRequest = await call(retryApi, {
    method: 'POST', url: `/api/stem/paper-marking-jobs/${retried.jobId}/retry`, token: ownerToken,
    json: { clientRequestId: 'progress-retry-action-0001' },
  })
  assert.equal(retryRequest.statusCode, 202)
  await currentAttemptEntered.promise
  const currentBeforeLateResult = await call(retryApi, { method: 'GET', url: `/api/stem/paper-marking-jobs/${retried.jobId}`, token: ownerToken })
  assert.equal(currentBeforeLateResult.payload.processingAttempt, 2)
  assert.equal(currentBeforeLateResult.payload.progress.stage, 'ai-review')
  releaseOldAttempt.resolve()
  await new Promise((resolve) => setTimeout(resolve, 30))
  const currentAfterLateResult = await call(retryApi, { method: 'GET', url: `/api/stem/paper-marking-jobs/${retried.jobId}`, token: ownerToken })
  assert.equal(currentAfterLateResult.payload.processingAttempt, 2)
  assert.equal(currentAfterLateResult.payload.progress.stage, 'ai-review', 'late attempt progress must not overwrite the active retry')
  releaseCurrentAttempt.resolve()
  const retryCompleted = await waitFor(retryApi, ownerToken, retried.jobId, (job) => job?.status === 'completed')
  assert.equal(retryCompleted.result.summary, 'current result')
  assert.equal(retryCompleted.progress.lastStage, 'reporting')
  assert.equal(retryCompleted.progress.lastPhase, 'reporting')
  assert.ok(Number.isSafeInteger(retryCompleted.progress.phaseElapsedSeconds) && retryCompleted.progress.phaseElapsedSeconds >= 0)

  console.log('Whole-paper truthful progress and ETA checks passed')
} finally {
  closeStemDatabaseForTests()
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
