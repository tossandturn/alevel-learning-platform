import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  createCodexDraftRunCli,
  importCodexPaddleReview,
} from './ingest-codex-paddle-review.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-codex-paddle-review-'))
const workRoot = path.join(root, 'work')
const outputRoot = path.join(root, 'output')
const draftRoot = path.join(workRoot, 'review-drafts')
const isolatedLedgerPath = path.join(workRoot, 'state', 'isolated-review-ledger.json')
const job = {
  jobId: `sha256:${'a'.repeat(64)}`,
  jobKey: 'a'.repeat(64),
  paperId: 'cie-0580-0580_s24_qp_12',
  subject: '0580',
  component: 1,
}
const routeId = 'cie-0580-igcse-mathematics'
const routeDirectory = path.join(draftRoot, job.jobKey, routeId)
const extraction = {
  source: {
    questionPdfSha256: '1'.repeat(64),
    markSchemePdfSha256: '2'.repeat(64),
  },
  questions: [],
}
const verification = { questionStarts: [], questions: [] }

try {
  fs.mkdirSync(routeDirectory, { recursive: true })
  const extractionText = `${JSON.stringify(extraction, null, 2)}\n`
  const verificationText = `${JSON.stringify(verification, null, 2)}\n`
  fs.writeFileSync(path.join(routeDirectory, 'extraction.json'), extractionText, 'utf8')
  fs.writeFileSync(path.join(routeDirectory, 'verification.json'), verificationText, 'utf8')

  const observed = []
  const validationCalls = []
  const validateReviewImpl = (options) => {
    validationCalls.push(options)
    return { status: 'PASS', errorCode: null, counts: { questions: 1, parts: 1, marks: 1, topics: 1, points: 1 } }
  }
  const runCliImpl = async (options, dependencies) => {
    observed.push(options)
    assert.equal(options.pageWindowed, false, 'Codex drafts describe a complete paper, not repeated page-window responses')
    assert.equal(options.retry, true, 'an explicit Codex import must be able to replace a provider quarantine')
    assert.equal(options.forceReprocess, true, 'an explicit Codex import must rebuild an existing released artifact after a provenance migration')
    assert.equal(options.model, 'gpt-5.6')
    assert.deepEqual(dependencies.providerChain(), [{ name: 'codex-draft', model: 'gpt-5.6' }])

    const extractionResult = await dependencies.callWithFallback({
      providers: dependencies.providerChain(),
      request: { schemaName: 'ai_pdf_question_extraction_v1' },
    })
    const verificationResult = await dependencies.callWithFallback({
      providers: dependencies.providerChain(),
      request: { schemaName: 'ai_pdf_question_verification_v1' },
    })
    assert.deepEqual(extractionResult.value, extraction)
    assert.deepEqual(verificationResult.value, verification)
    assert.equal(extractionResult.provider.name, 'codex-independent-extraction')
    assert.equal(verificationResult.provider.name, 'codex-independent-verification')
    assert.equal(extractionResult.provider.model, 'gpt-5.6')
    assert.equal(verificationResult.provider.model, 'gpt-5.6')
    assert.equal(extractionResult.telemetry.attempts[0].schemaStatus, 'parsed')
    assert.equal(extractionResult.telemetry.attempts[0].draftSha256, crypto.createHash('sha256').update(extractionText).digest('hex'))
    assert.equal(verificationResult.telemetry.attempts[0].draftSha256, crypto.createHash('sha256').update(verificationText).digest('hex'))
    await assert.rejects(
      () => dependencies.callWithFallback({ providers: [], request: { schemaName: 'unknown_schema' } }),
      /CODEX_DRAFT_SCHEMA_UNSUPPORTED/,
    )
    return { status: 'auto-quarantined' }
  }

  const runDraft = createCodexDraftRunCli({ workRoot, draftRoot, job, model: 'gpt-5.6', runCliImpl, validateReviewImpl })
  assert.deepEqual(await runDraft({ routeId, pageWindowed: true, retry: false, model: 'wrong' }, {}), { status: 'auto-quarantined' })
  assert.equal(observed.length, 1)
  assert.deepEqual(validationCalls, [{ workRoot, reviewId: job.jobId, routeId }])

  fs.writeFileSync(path.join(routeDirectory, 'extraction.json'), `${JSON.stringify({
    ...extraction,
    reviewSummary: {
      status: 'paired_independent_local_passes_not_released',
      providerStatus: 'not_called_local_evidence_synthesis',
      studentRelease: false,
    },
  }, null, 2)}\n`, 'utf8')
  fs.writeFileSync(path.join(routeDirectory, 'verification.json'), `${JSON.stringify({
    ...verification,
    reviewSummary: {
      status: 'independent_verification_pass_not_released',
      providerStatus: 'not_called_local_evidence_synthesis',
      studentRelease: false,
    },
  }, null, 2)}\n`, 'utf8')
  let releaseBlockedCalls = 0
  const releaseBlockedRun = createCodexDraftRunCli({
    workRoot,
    draftRoot,
    job,
    model: 'gpt-5.6',
    validateReviewImpl,
    runCliImpl: async () => {
      releaseBlockedCalls += 1
      return { status: 'ai-verified' }
    },
  })
  await assert.rejects(
    () => releaseBlockedRun({ routeId }, {}),
    error => error?.code === 'CODEX_DRAFT_RELEASE_BLOCKED',
  )
  assert.equal(releaseBlockedCalls, 0, 'a draft that explicitly says it is not released must stop before canonical ingestion')

  const blockedRun = createCodexDraftRunCli({
    workRoot,
    draftRoot,
    job,
    model: 'gpt-5.6',
    runCliImpl,
    validateReviewImpl: () => ({ status: 'BLOCKED', errorCode: 'REVIEW_PARTS_MARKS_MISMATCH', counts: {} }),
  })
  await assert.rejects(
    () => blockedRun({ routeId }, {}),
    error => error?.code === 'CODEX_DRAFT_SYLLABUS_BINDING_BLOCKED',
  )
  assert.equal(observed.length, 1, 'a blocked syllabus review must stop before canonical ingestion')

  let capturedConsumerOptions = null
  let capturedIngestOptions = null
  const result = await importCodexPaddleReview({
    workRoot,
    outputRoot,
    draftRoot,
    ledgerPath: isolatedLedgerPath,
    reviewId: job.jobId,
    model: 'gpt-5.6',
    consumeImpl: async (options) => {
      capturedConsumerOptions = options
      await options.ingestJobImpl({ workRoot, outputRoot, job })
      return { selected: 1, completed: 1 }
    },
    ingestPaddleJobImpl: async (options) => {
      capturedIngestOptions = options
      return []
    },
  })
  assert.deepEqual(result, { selected: 1, completed: 1 })
  assert.equal(capturedConsumerOptions.reviewId, job.jobId)
  assert.equal(capturedConsumerOptions.ledgerPath, isolatedLedgerPath, 'an isolated validation import must not mutate the live review ledger')
  assert.equal(capturedConsumerOptions.retryFailed, true, 'an explicit Codex import must retry a prior provider failure')
  assert.equal(capturedConsumerOptions.retryBlocked, true, 'an explicit Codex import must retry a prior validation block')
  assert.equal(capturedConsumerOptions.retryQuarantined, true)
  assert.equal(capturedConsumerOptions.retryCompleted, true, 'an explicit Codex import must be able to refresh a released artifact after a provenance migration')
  assert.equal(capturedIngestOptions.retry, true)
  assert.equal(typeof capturedIngestOptions.runCliImpl, 'function')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(JSON.stringify({ status: 'passed', scope: 'codex-paddle-review-import' }))
