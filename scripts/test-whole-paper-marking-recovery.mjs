import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import { createCanvas } from '@napi-rs/canvas'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { wholePaperFailureCode, wholePaperFailureIsRetryable } from '../server/wholePaperMarking.js'
import { renderWholePaperReport } from '../server/wholePaperReport.js'

const signingKey = 'whole-paper-recovery-signing-key'
const token = (() => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: 'ielts:9001', iat: now, exp: now + 3600 })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
})()

function answerImage() {
  const canvas = createCanvas(320, 240)
  const context = canvas.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, 320, 240)
  context.fillStyle = '#111'
  context.font = '28px sans-serif'
  context.fillText('Student answer', 24, 72)
  return canvas.toBuffer('image/png')
}

function call(api, { method, url, json, raw, contentType = '' }) {
  return new Promise((resolve, reject) => {
    const body = raw !== undefined ? Buffer.from(raw) : json !== undefined ? Buffer.from(JSON.stringify(json)) : Buffer.alloc(0)
    const request = Readable.from(body.length ? [body] : [])
    request.method = method
    request.url = url
    request.headers = {
      authorization: `Bearer ${token}`,
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(contentType ? { 'content-type': contentType } : {}),
      ...(body.length ? { 'content-length': String(body.length) } : {}),
    }
    const chunks = []
    const response = {
      statusCode: 0,
      headers: new Map(),
      setHeader(name, value) { this.headers.set(String(name).toLowerCase(), String(value)) },
      write(chunk) { chunks.push(Buffer.from(chunk)) },
      end(chunk = '') {
        if (chunk !== '') chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        const buffer = Buffer.concat(chunks)
        let payload = null
        try { payload = JSON.parse(buffer.toString('utf8') || '{}') } catch { /* binary */ }
        resolve({ statusCode: this.statusCode, payload, buffer })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

async function waitFor(api, jobId, status) {
  for (let index = 0; index < 100; index += 1) {
    const result = await call(api, { method: 'GET', url: `/api/stem/paper-marking-jobs/${jobId}` })
    if (result.payload?.status === status) return result.payload
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${status}`)
}

function createBody(clientRequestId, image) {
  return {
    schemaVersion: 'stem-paper-marking-job-v1',
    clientRequestId,
    title: 'Recovery fixture',
    files: [{ clientAssetId: 'answer-1', role: 'answer', mediaType: 'image/png', order: 1, fileName: 'answer.png', size: image.length }],
  }
}

function successResult() {
  return {
    assessmentMode: 'ai-advisory-unscored', officialScore: false, formalProgressEligible: false,
    provisionalScore: null, maxScore: null, reviewRequired: true, missingPages: [], missingQuestions: [],
    summary: 'Recovered job completed from the retained image.',
    questionResults: [{
      questionLabel: 'Q1', provisionalScore: null, maxScore: null, confidence: 0.8, reviewRequired: true,
      rationale: 'The retained answer page is visible.', evidence: ['Student answer page 1'], criteria: [],
    }],
    provider: 'fixture', model: 'fixture',
  }
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-whole-paper-recovery-'))
const image = answerImage()

assert.equal(wholePaperFailureIsRetryable(Object.assign(new Error('bad PDF'), { statusCode: 422 })), false)
assert.equal(wholePaperFailureIsRetryable(Object.assign(new Error('too many pixels'), { statusCode: 413 })), false)
assert.equal(wholePaperFailureIsRetryable(Object.assign(new Error('rate limited'), { statusCode: 429 })), true)
assert.equal(wholePaperFailureIsRetryable(Object.assign(new Error('font missing'), { statusCode: 503, retryable: true })), true)
assert.equal(wholePaperFailureIsRetryable(Object.assign(new Error('immutable binding'), { statusCode: 409, retryable: true })), true, 'explicit retryability must override the status default')
assert.equal(wholePaperFailureCode(Object.assign(new Error('safe'), { code: 'ai_assessment_schema_invalid', assessmentFailureReason: 'evidence_missing' })), 'ai_assessment_evidence_missing')
assert.equal(wholePaperFailureCode(Object.assign(new Error('safe'), { code: 'ai_assessment_schema_invalid', assessmentFailureReason: 'evidence_type_invalid' })), 'ai_assessment_evidence_type_invalid')
assert.equal(wholePaperFailureCode(Object.assign(new Error('safe'), { code: 'ai_assessment_schema_invalid', assessmentFailureReason: 'confidence_invalid' })), 'ai_assessment_confidence_invalid')
assert.equal(wholePaperFailureCode(Object.assign(new Error('safe'), { code: 'ai_assessment_schema_invalid', assessmentFailureReason: 'total_mismatch' })), 'ai_assessment_total_mismatch')
assert.equal(wholePaperFailureCode(Object.assign(new Error('safe'), { code: 'ai_assessment_schema_invalid', assessmentFailureReason: 'not_whitelisted' })), 'ai_assessment_schema_invalid', 'unknown diagnostics must not enter the persisted failure code')

try {
  const databasePath = path.join(temporaryRoot, 'restart.sqlite')
  const storageRoot = path.join(temporaryRoot, 'restart-assets')
  const env = { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: databasePath }
  const firstApi = createStemApi({ env, questionBank: [], wholePaperMarkingOptions: { storageRoot, runner: async () => successResult() } })
  const created = await call(firstApi, { method: 'POST', url: '/api/stem/paper-marking-jobs', json: createBody('restart-request-0001', image) })
  assert.equal(created.statusCode, 201)
  const jobId = created.payload.jobId
  const asset = created.payload.assets[0]
  assert.equal((await call(firstApi, { method: 'PUT', url: asset.uploadPath, raw: image, contentType: 'image/png' })).statusCode, 200)
  closeStemDatabaseForTests()

  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const direct = new DatabaseSync(databasePath)
  direct.prepare("UPDATE whole_paper_marking_jobs SET status = 'processing', progress_json = ? WHERE id = ?").run(JSON.stringify({ stage: 'ai-review', phaseStartedAt: new Date(Date.now() - 5_000).toISOString() }), jobId)
  direct.close()

  let recoveredRuns = 0
  const recoveredApi = createStemApi({
    env,
    questionBank: [],
    wholePaperMarkingOptions: { storageRoot, runner: async () => { recoveredRuns += 1; return successResult() } },
  })
  const recovered = await call(recoveredApi, { method: 'GET', url: `/api/stem/paper-marking-jobs/${jobId}` })
  assert.equal(recovered.statusCode, 200)
  assert.equal(recovered.payload.status, 'failed')
  assert.equal(recovered.payload.failureCode, 'worker_restarted')
  assert.equal(recovered.payload.retryable, true)
  assert.equal(recovered.payload.progress.lastStage, 'ai-review')
  assert.equal(recovered.payload.progress.lastPhase, 'analyzing')
  assert.ok(recovered.payload.progress.phaseElapsedSeconds >= 4)
  assert.equal(recovered.payload.assets[0].status, 'uploaded', 'restart recovery must retain private upload bytes')
  const retried = await call(recoveredApi, { method: 'POST', url: `/api/stem/paper-marking-jobs/${jobId}/retry`, json: { clientRequestId: 'restart-retry-0001' } })
  assert.equal(retried.statusCode, 202)
  const completed = await waitFor(recoveredApi, jobId, 'completed')
  assert.equal(recoveredRuns, 1)
  assert.ok(completed.sourcePdfPath && completed.reportPdfPath)
  closeStemDatabaseForTests()

  let currentTime = Date.parse('2026-09-23T00:00:00.000Z')
  const cleanupRoot = path.join(temporaryRoot, 'cleanup-assets')
  const cleanupApi = createStemApi({
    env: { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: ':memory:' },
    questionBank: [],
    wholePaperMarkingOptions: {
      storageRoot: cleanupRoot,
      now: () => currentTime,
      draftTtlMs: 1000,
      resultTtlMs: 1000,
      runner: async () => successResult(),
    },
  })
  const expiring = await call(cleanupApi, { method: 'POST', url: '/api/stem/paper-marking-jobs', json: createBody('cleanup-request-0001', image) })
  assert.equal(expiring.statusCode, 201)
  assert.equal((await call(cleanupApi, { method: 'PUT', url: expiring.payload.assets[0].uploadPath, raw: image, contentType: 'image/png' })).statusCode, 200)
  assert.ok(fs.readdirSync(cleanupRoot, { recursive: true }).some((entry) => String(entry).endsWith('.bin')), 'private fixture should exist before TTL cleanup')
  currentTime += 2_000
  const afterCleanup = await call(cleanupApi, { method: 'GET', url: '/api/stem/paper-marking-jobs?limit=10' })
  assert.equal(afterCleanup.statusCode, 200)
  assert.deepEqual(afterCleanup.payload.jobs, [], 'expired draft metadata must be removed')
  assert.equal(fs.readdirSync(cleanupRoot, { recursive: true }).some((entry) => String(entry).endsWith('.bin')), false, 'expired private bytes must be removed with their job')

  const quotaJobs = []
  for (let index = 0; index < 3; index += 1) {
    const active = await call(cleanupApi, { method: 'POST', url: '/api/stem/paper-marking-jobs', json: createBody(`quota-request-${index + 1}`, image) })
    assert.equal(active.statusCode, 201)
    quotaJobs.push(active.payload.jobId)
  }
  const overQuota = await call(cleanupApi, { method: 'POST', url: '/api/stem/paper-marking-jobs', json: createBody('quota-request-0004', image) })
  assert.equal(overQuota.statusCode, 429)
  assert.equal(overQuota.payload.code, 'active_job_quota')
  const cancelled = await call(cleanupApi, {
    method: 'POST', url: `/api/stem/paper-marking-jobs/${quotaJobs[0]}/cancel`, json: { clientRequestId: 'cancel-request-0001' },
  })
  assert.equal(cancelled.statusCode, 200)
  assert.equal(cancelled.payload.status, 'failed')
  assert.equal(cancelled.payload.failureCode, 'cancelled')
  assert.equal(cancelled.payload.retryable, false)
  assert.match(cancelled.payload.expiresAt, /^\d{4}-\d{2}-\d{2}T/)
  const duplicateCancel = await call(cleanupApi, {
    method: 'POST', url: `/api/stem/paper-marking-jobs/${quotaJobs[0]}/cancel`, json: { clientRequestId: 'cancel-request-0001' },
  })
  assert.equal(duplicateCancel.payload.duplicate, true)
  const afterCancel = await call(cleanupApi, { method: 'POST', url: '/api/stem/paper-marking-jobs', json: createBody('quota-request-0005', image) })
  assert.equal(afterCancel.statusCode, 201, 'cancelling an unsubmitted draft must release one active-job slot')

  closeStemDatabaseForTests()
  let releaseFirstRunner
  const startedJobs = []
  const concurrencyApi = createStemApi({
    env: { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: ':memory:' },
    questionBank: [],
    wholePaperMarkingOptions: {
      storageRoot: path.join(temporaryRoot, 'concurrency-assets'),
      jobTimeoutMs: 80,
      abortDrainMs: 25,
      runner: async ({ job }) => {
        startedJobs.push(job.id)
        if (startedJobs.length === 1) return new Promise((resolve) => { releaseFirstRunner = () => resolve(successResult()) })
        return successResult()
      },
    },
  })
  const queuedJobs = []
  for (let index = 0; index < 2; index += 1) {
    const createdJob = await call(concurrencyApi, { method: 'POST', url: '/api/stem/paper-marking-jobs', json: createBody(`concurrency-request-${index + 1}`, image) })
    const createdAsset = createdJob.payload.assets[0]
    await call(concurrencyApi, { method: 'PUT', url: createdAsset.uploadPath, raw: image, contentType: 'image/png' })
    await call(concurrencyApi, {
      method: 'POST', url: `/api/stem/paper-marking-jobs/${createdJob.payload.jobId}/submit`,
      json: { clientRequestId: `concurrency-request-${index + 1}`, answerAssetIds: [createdAsset.assetId] },
    })
    queuedJobs.push(createdJob.payload.jobId)
  }
  await waitFor(concurrencyApi, queuedJobs[0], 'failed')
  await waitFor(concurrencyApi, queuedJobs[1], 'completed')
  assert.equal(startedJobs.length, 2, 'a timed-out uncooperative runner must not hold later jobs in the queue forever')
  const firstBeforeLateSettle = await call(concurrencyApi, { method: 'GET', url: `/api/stem/paper-marking-jobs/${queuedJobs[0]}` })
  assert.equal(firstBeforeLateSettle.payload.status, 'failed')
  releaseFirstRunner()
  await new Promise((resolve) => setTimeout(resolve, 50))
  const firstAfterLateSettle = await call(concurrencyApi, { method: 'GET', url: `/api/stem/paper-marking-jobs/${queuedJobs[0]}` })
  assert.equal(firstAfterLateSettle.payload.status, 'failed', 'a detached late result must not revive its failed job')

  closeStemDatabaseForTests()
  let releaseOldAttempt
  let retryRuns = 0
  const unhandled = []
  const onUnhandled = (error) => unhandled.push(error)
  process.on('unhandledRejection', onUnhandled)
  const sameJobRetryRoot = path.join(temporaryRoot, 'same-job-retry-assets')
  const sameJobRetryApi = createStemApi({
    env: { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: ':memory:' },
    questionBank: [],
    wholePaperMarkingOptions: {
      storageRoot: sameJobRetryRoot,
      jobTimeoutMs: 80,
      abortDrainMs: 25,
      runner: async () => {
        retryRuns += 1
        if (retryRuns === 1) return new Promise((resolve) => { releaseOldAttempt = () => resolve({ ...successResult(), summary: 'stale attempt' }) })
        return { ...successResult(), summary: 'current retry attempt' }
      },
    },
  })
  try {
    const retryCreated = await call(sameJobRetryApi, { method: 'POST', url: '/api/stem/paper-marking-jobs', json: createBody('same-job-retry-request-0001', image) })
    const retryAsset = retryCreated.payload.assets[0]
    await call(sameJobRetryApi, { method: 'PUT', url: retryAsset.uploadPath, raw: image, contentType: 'image/png' })
    await call(sameJobRetryApi, {
      method: 'POST', url: `/api/stem/paper-marking-jobs/${retryCreated.payload.jobId}/submit`,
      json: { clientRequestId: 'same-job-retry-request-0001', answerAssetIds: [retryAsset.assetId] },
    })
    const firstAttemptFailed = await waitFor(sameJobRetryApi, retryCreated.payload.jobId, 'failed')
    assert.equal(firstAttemptFailed.failureCode, 'marking_timeout')
    await call(sameJobRetryApi, {
      method: 'POST', url: `/api/stem/paper-marking-jobs/${retryCreated.payload.jobId}/retry`, json: { clientRequestId: 'same-job-retry-0001' },
    })
    const retriedJob = await waitFor(sameJobRetryApi, retryCreated.payload.jobId, 'completed')
    assert.equal(retriedJob.processingAttempt, 2)
    assert.equal(retriedJob.result.summary, 'current retry attempt')
    const retryFilesBeforeLateSettle = fs.readdirSync(sameJobRetryRoot, { recursive: true }).map(String)
    assert.ok(retryFilesBeforeLateSettle.some((entry) => entry.endsWith('source-attempt-2.pdf')))
    assert.ok(retryFilesBeforeLateSettle.some((entry) => entry.endsWith('report-attempt-2.pdf')))
    assert.equal(retryFilesBeforeLateSettle.some((entry) => entry.endsWith('source-attempt-1.pdf')), false, 'a current retry must remove the unreachable source artifact from the lower attempt')
    assert.equal(retryFilesBeforeLateSettle.some((entry) => entry.endsWith('report-attempt-1.pdf')), false)
    const currentReportPath = path.join(sameJobRetryRoot, retryFilesBeforeLateSettle.find((entry) => entry.endsWith('report-attempt-2.pdf')))
    const currentReportHash = crypto.createHash('sha256').update(fs.readFileSync(currentReportPath)).digest('hex')
    releaseOldAttempt()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const afterStaleSuccess = await call(sameJobRetryApi, { method: 'GET', url: `/api/stem/paper-marking-jobs/${retryCreated.payload.jobId}` })
    assert.equal(afterStaleSuccess.payload.status, 'completed')
    assert.equal(afterStaleSuccess.payload.processingAttempt, 2)
    assert.equal(afterStaleSuccess.payload.result.summary, 'current retry attempt', 'late attempt 1 must not overwrite attempt 2')
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(currentReportPath)).digest('hex'), currentReportHash, 'late attempt 1 must not overwrite attempt 2 artifacts')
    assert.equal(fs.readdirSync(sameJobRetryRoot, { recursive: true }).map(String).some((entry) => entry.endsWith('source-attempt-1.pdf')), false, 'a late aborted runner cannot recreate its cleaned source namespace')
    assert.equal(fs.readdirSync(sameJobRetryRoot, { recursive: true }).map(String).some((entry) => entry.endsWith('report-attempt-1.pdf')), false)
    assert.deepEqual(unhandled, [], 'detached stale attempts must not emit unhandled rejections')
  } finally {
    process.off('unhandledRejection', onUnhandled)
    releaseOldAttempt?.()
  }

  closeStemDatabaseForTests()
  const repeatedFailureRoot = path.join(temporaryRoot, 'repeated-failure-assets')
  const repeatedFailureApi = createStemApi({
    env: { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: ':memory:' },
    questionBank: [],
    wholePaperMarkingOptions: {
      storageRoot: repeatedFailureRoot,
      runner: async () => { throw Object.assign(new Error('retryable provider fixture'), { code: 'fixture_retryable', statusCode: 503, retryable: true }) },
    },
  })
  const repeatedCreated = await call(repeatedFailureApi, { method: 'POST', url: '/api/stem/paper-marking-jobs', json: createBody('repeated-failure-request-0001', image) })
  const repeatedAsset = repeatedCreated.payload.assets[0]
  await call(repeatedFailureApi, { method: 'PUT', url: repeatedAsset.uploadPath, raw: image, contentType: 'image/png' })
  await call(repeatedFailureApi, {
    method: 'POST', url: `/api/stem/paper-marking-jobs/${repeatedCreated.payload.jobId}/submit`,
    json: { clientRequestId: 'repeated-failure-request-0001', answerAssetIds: [repeatedAsset.assetId] },
  })
  const firstRepeatedFailure = await waitFor(repeatedFailureApi, repeatedCreated.payload.jobId, 'failed')
  assert.equal(firstRepeatedFailure.failureCode, 'fixture_retryable')
  const firstRepeatedFiles = fs.readdirSync(repeatedFailureRoot, { recursive: true }).map(String)
  const firstSource = firstRepeatedFiles.find((entry) => entry.endsWith('source-attempt-1.pdf'))
  assert.ok(firstSource)
  const repeatedJobDirectory = path.dirname(path.join(repeatedFailureRoot, firstSource))
  const legacySource = path.join(repeatedJobDirectory, 'source.pdf')
  const legacyReport = path.join(repeatedJobDirectory, 'report.pdf')
  const lowerFixture = path.join(repeatedJobDirectory, 'source-attempt-0.pdf')
  const outsideAttemptLikeFile = path.join(repeatedFailureRoot, 'source-attempt-0.pdf')
  fs.writeFileSync(legacySource, Buffer.from('%PDF-legacy-source'))
  fs.writeFileSync(legacyReport, Buffer.from('%PDF-legacy-report'))
  fs.writeFileSync(lowerFixture, Buffer.from('%PDF-generated-lower-attempt'))
  fs.writeFileSync(outsideAttemptLikeFile, Buffer.from('%PDF-outside-job-directory'))
  const legacySourceHash = crypto.createHash('sha256').update(fs.readFileSync(legacySource)).digest('hex')
  const legacyReportHash = crypto.createHash('sha256').update(fs.readFileSync(legacyReport)).digest('hex')
  for (let attempt = 2; attempt <= 4; attempt += 1) {
    await call(repeatedFailureApi, {
      method: 'POST', url: `/api/stem/paper-marking-jobs/${repeatedCreated.payload.jobId}/retry`,
      json: { clientRequestId: `repeated-failure-retry-000${attempt}` },
    })
    const failedAttempt = await waitFor(repeatedFailureApi, repeatedCreated.payload.jobId, 'failed')
    assert.equal(failedAttempt.processingAttempt, attempt)
    const files = fs.readdirSync(repeatedJobDirectory, { recursive: true }).map(String)
    const generated = files.filter((entry) => /(?:^|[\\/])(?:source|report)-attempt-\d+\.pdf$/.test(entry))
    assert.deepEqual(generated.map((entry) => path.basename(entry)), [`source-attempt-${attempt}.pdf`], 'repeated retryable failures retain only the current generated attempt artifact')
    assert.ok(files.some((entry) => entry.endsWith('.bin')), 'generated-artifact cleanup must preserve uploaded answer bytes')
  }
  assert.equal(fs.existsSync(lowerFixture), false, 'strict lower-attempt generated names are cleaned')
  assert.equal(fs.readFileSync(outsideAttemptLikeFile).toString(), '%PDF-outside-job-directory', 'cleanup never traverses outside the exact current job directory')
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(legacySource)).digest('hex'), legacySourceHash, 'legacy unknown filenames are preserved')
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(legacyReport)).digest('hex'), legacyReportHash, 'legacy unknown report filenames are preserved')

  closeStemDatabaseForTests()
  const emptyAssessmentApi = createStemApi({
    env: { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: ':memory:' },
    questionBank: [],
    wholePaperMarkingOptions: {
      storageRoot: path.join(temporaryRoot, 'empty-assessment-assets'),
      runner: async () => ({ ...successResult(), questionResults: [] }),
    },
  })
  const emptyCreated = await call(emptyAssessmentApi, { method: 'POST', url: '/api/stem/paper-marking-jobs', json: createBody('empty-assessment-request-0001', image) })
  const emptyAsset = emptyCreated.payload.assets[0]
  await call(emptyAssessmentApi, { method: 'PUT', url: emptyAsset.uploadPath, raw: image, contentType: 'image/png' })
  await call(emptyAssessmentApi, {
    method: 'POST', url: `/api/stem/paper-marking-jobs/${emptyCreated.payload.jobId}/submit`,
    json: { clientRequestId: 'empty-assessment-request-0001', answerAssetIds: [emptyAsset.assetId] },
  })
  const emptyFailed = await waitFor(emptyAssessmentApi, emptyCreated.payload.jobId, 'failed')
  assert.equal(emptyFailed.failureCode, 'ai_assessment_empty')
  assert.equal(emptyFailed.retryable, true)
  assert.equal(emptyFailed.reportPdfPath, null, 'an empty assessment must not generate a completed report')

  closeStemDatabaseForTests()
  let chargedProviderRuns = 0
  let reportRuns = 0
  const reportRetryApi = createStemApi({
    env: { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: ':memory:' },
    questionBank: [],
    wholePaperMarkingOptions: {
      storageRoot: path.join(temporaryRoot, 'report-retry-assets'),
      runner: async () => { chargedProviderRuns += 1; return successResult() },
      reportRenderer: async (input) => {
        reportRuns += 1
        if (reportRuns === 1) throw Object.assign(new Error('font unavailable fixture'), { code: 'report_font_unavailable', retryable: true })
        return renderWholePaperReport(input)
      },
    },
  })
  const reportRetryCreated = await call(reportRetryApi, { method: 'POST', url: '/api/stem/paper-marking-jobs', json: createBody('report-retry-request-0001', image) })
  const reportRetryAsset = reportRetryCreated.payload.assets[0]
  await call(reportRetryApi, { method: 'PUT', url: reportRetryAsset.uploadPath, raw: image, contentType: 'image/png' })
  await call(reportRetryApi, {
    method: 'POST', url: `/api/stem/paper-marking-jobs/${reportRetryCreated.payload.jobId}/submit`,
    json: { clientRequestId: 'report-retry-request-0001', answerAssetIds: [reportRetryAsset.assetId] },
  })
  const reportFailed = await waitFor(reportRetryApi, reportRetryCreated.payload.jobId, 'failed')
  assert.equal(reportFailed.failureCode, 'report_font_unavailable')
  assert.ok(reportFailed.result, 'validated AI result must persist before report rendering')
  assert.equal(reportFailed.progress.lastStage, 'reporting', 'a report-only failure must remain distinguishable from an AI-analysis failure')
  assert.equal(reportFailed.progress.lastPhase, 'reporting')
  assert.ok(Number.isSafeInteger(reportFailed.progress.phaseElapsedSeconds) && reportFailed.progress.phaseElapsedSeconds >= 0)
  await call(reportRetryApi, {
    method: 'POST', url: `/api/stem/paper-marking-jobs/${reportRetryCreated.payload.jobId}/retry`, json: { clientRequestId: 'report-retry-0001' },
  })
  await waitFor(reportRetryApi, reportRetryCreated.payload.jobId, 'completed')
  assert.equal(chargedProviderRuns, 1, 'report-only retry must reuse the validated AI result without charging the provider again')
  assert.equal(reportRuns, 2)

  console.log('Whole-paper restart, cleanup and quota checks passed')
} finally {
  closeStemDatabaseForTests()
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
