import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { artifactId } from './ai-pdf-ingestion/contract.mjs'
import {
  REVIEW_LEDGER_SCHEMA_VERSION,
  acquireReviewConsumerLock,
  consumePaddleReviewQueue,
  openAiOnlyProviders,
  parseReviewQueueArgs,
  watchPaddleReviewQueue,
} from './review-paddle-ocr-queue.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-paddle-review-queue-'))
const workRoot = path.join(root, 'work')
const outputRoot = path.join(root, 'ai-pdf-ingestion')
const manifestPath = path.join(workRoot, 'manifest', 'manifest.json')
const queuePath = path.join(workRoot, 'queue', 'structure-review.jsonl')
const ledgerPath = path.join(workRoot, 'state', 'structure-review-ledger.json')

function buildJob({ digit, paperId, subject = '0580', component = 1, fixtureStatus = 'completed' }) {
  const questionPdfSha256 = digit.repeat(64)
  const markSchemePdfSha256 = String((Number(digit) + 5) % 10).repeat(64)
  const jobId = artifactId({ paperId, questionPdfSha256, markSchemePdfSha256 })
  const jobKey = jobId.slice('sha256:'.length)
  const routeHints = subject === '9709' && component === 1
    ? ['cie-9709-as-p1-p2', 'cie-9709-as-p1-p4', 'cie-9709-as-p1-p5']
    : [subject === '9709' ? 'cie-9709-as-p1-p2' : 'cie-0580-igcse-mathematics']
  return {
    schemaVersion: 'stem-paddle-ocr-job.v1',
    jobId,
    jobKey,
    paperId,
    subject,
    year: 2024,
    session: 's',
    component,
    variant: 1,
    routeBindings: routeHints.map((routeHint) => ({
      routeHint,
      qualificationStage: subject === '9709' ? 'AS' : 'IGCSE',
      paper: `P${component}`,
      component,
      reviewStatus: 'pending_official_review',
    })),
    documents: {
      qp: { path: path.join(root, `${paperId}.pdf`), sha256: questionPdfSha256, pageCount: 1, bytes: 10 },
      ms: { path: path.join(root, `${paperId.replace('_qp_', '_ms_')}.pdf`), sha256: markSchemePdfSha256, pageCount: 1, bytes: 10 },
    },
    statePath: `state/jobs/${jobKey}.json`,
    stagingArtifactPath: `artifacts/staging/${paperId}/${jobKey}/artifact.json`,
    quarantinePath: `artifacts/quarantine/${paperId}/${jobKey}/failure.json`,
    fixtureStatus,
  }
}

function writeStagingArtifact(job) {
  const target = path.join(workRoot, job.stagingArtifactPath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify({
    schemaVersion: 'stem-paddle-ocr-staging-artifact.v1',
    artifactId: job.jobId,
    paperId: job.paperId,
    subject: job.subject,
    component: job.component,
    status: 'ocr-complete-pending-review',
    reviewStatus: 'pending_ai_structure_review',
    syllabusBinding: { status: 'pending_official_review', routeBindings: job.routeBindings, topicIds: [] },
    sourcePair: {
      bindingMethod: 'exact_filename_substitution_and_sha256',
      questionPaper: job.documents.qp,
      markScheme: job.documents.ms,
    },
    questionGroups: [],
    studentStudyEligible: false,
    formalProgressEligible: false,
  }, null, 2)}\n`, 'utf8')
}

function queueRow(job, overrides = {}) {
  return {
    schemaVersion: 'stem-paddle-ocr-structure-review.v1',
    reviewId: job.jobId,
    paperId: job.paperId,
    artifactPath: job.stagingArtifactPath,
    status: 'pending_provider_review',
    providers: ['codex'],
    requiredChecks: [
      'whole_question_boundaries',
      'question_part_structure',
      'qp_ms_question_binding',
      'diagram_region_integrity',
      'official_syllabus_topic_binding',
    ],
    studentStudyEligible: false,
    ...overrides,
  }
}

function outputArtifactPath(job, routeId) {
  return path.join(outputRoot, job.paperId, `${job.jobKey}--route-${routeId}.json`)
}

function writeTerminalArtifact(job, routeId, status = 'auto-quarantined') {
  const target = outputArtifactPath(job, routeId)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const artifact = {
    schemaVersion: 'ai-pdf-ingestion.v1',
    artifactId: job.jobId,
    paperId: job.paperId,
    artifactSuffix: `route-${routeId}`,
    subject: job.subject,
    stage: subjectStage(job.subject),
    syllabusRouteId: routeId,
    status,
    reasonCodes: status === 'auto-quarantined' ? ['TEST_QUARANTINE'] : [],
  }
  fs.writeFileSync(target, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  return artifact
}

function subjectStage(subject) {
  return subject === '9709' ? 'AS' : 'IGCSE'
}

try {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.mkdirSync(path.dirname(queuePath), { recursive: true })

  const terminalJob = buildJob({ digit: '1', paperId: 'cie-0580-0580_s24_qp_11' })
  const partialJob = buildJob({ digit: '2', paperId: 'cie-0580-0580_s24_qp_12', fixtureStatus: 'partial' })
  const mismatchJob = buildJob({ digit: '3', paperId: 'cie-0580-0580_s24_qp_13' })
  const failingJob = buildJob({ digit: '4', paperId: 'cie-0580-0580_w24_qp_11' })
  const successJob = buildJob({ digit: '5', paperId: 'cie-9709-9709_s24_qp_11', subject: '9709', component: 1 })
  const laterJob = buildJob({ digit: '6', paperId: 'cie-0580-0580_w24_qp_12' })
  const jobs = [terminalJob, partialJob, mismatchJob, failingJob, successJob, laterJob]
  jobs.forEach(writeStagingArtifact)

  fs.writeFileSync(manifestPath, `${JSON.stringify({
    schemaVersion: 'stem-paddle-ocr-manifest.v1',
    jobs,
  }, null, 2)}\n`, 'utf8')
  fs.writeFileSync(queuePath, `${[
    queueRow(terminalJob),
    queueRow(partialJob),
    queueRow(mismatchJob, { artifactPath: partialJob.stagingArtifactPath }),
    queueRow(failingJob),
    queueRow(successJob),
  ].map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8')

  writeTerminalArtifact(terminalJob, 'cie-0580-igcse-mathematics')

  const providerNames = openAiOnlyProviders({
    OPENAI_API_KEY: 'openai-test-key',
    QWEN_API_KEY: 'qwen-test-key',
  }, { model: 'gpt-5.6' }).map((provider) => provider.name)
  assert.deepEqual(providerNames, ['openai'], 'the Paddle review consumer must never select Qwen even when a Qwen key exists')

  const ingestCalls = []
  const loadCompletedJobImpl = ({ job }) => {
    if (job.fixtureStatus !== 'completed') {
      const error = new Error('both OCR documents must be completed')
      error.code = 'PADDLE_JOB_INCOMPLETE'
      throw error
    }
    return { job, workRoot, documents: {}, state: { status: 'completed' } }
  }
  const ingestJobImpl = async ({ job }) => {
    ingestCalls.push(job.jobId)
    if (job.jobId === failingJob.jobId) {
      const error = new Error('OpenAI request timed out')
      error.code = 'OPENAI_TIMEOUT'
      throw error
    }
    const routes = job.jobId === successJob.jobId
      ? ['cie-9709-as-p1-p2', 'cie-9709-as-p1-p4', 'cie-9709-as-p1-p5']
      : job.jobId === terminalJob.jobId
        ? ['cie-0580-igcse-mathematics']
      : job.jobId === laterJob.jobId
        ? ['cie-0580-igcse-mathematics']
        : []
    assert.ok(routes.length, 'a queue failure must not redirect another review to the wrong job')
    return routes.map((routeId) => writeTerminalArtifact(job, routeId))
  }

  await assert.rejects(
    () => consumePaddleReviewQueue({
      workRoot,
      outputRoot,
      retryCompleted: true,
      loadCompletedJobImpl,
      ingestJobImpl,
    }),
    /retryCompleted requires one explicit reviewId/,
    'a provenance refresh must never turn into an unbounded bulk rerun',
  )

  const summary = await consumePaddleReviewQueue({
    workRoot,
    outputRoot,
    env: { OPENAI_API_KEY: 'openai-test-key', QWEN_API_KEY: 'qwen-test-key' },
    loadCompletedJobImpl,
    ingestJobImpl,
    now: () => new Date('2026-08-29T00:00:00.000Z'),
  })

  assert.deepEqual(summary, {
    selected: 5,
    completed: 2,
    blocked: 2,
    failed: 1,
    skipped: 0,
    releasedRoutes: 0,
    quarantinedRoutes: 4,
  })
  assert.deepEqual(ingestCalls, [failingJob.jobId, successJob.jobId], 'terminal, incomplete, and mismatched jobs must never call the AI reviewer')

  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
  assert.equal(ledger.schemaVersion, REVIEW_LEDGER_SCHEMA_VERSION)
  assert.equal(ledger.entries.length, 5)
  const entries = new Map(ledger.entries.map((entry) => [entry.reviewId, entry]))
  assert.equal(entries.get(terminalJob.jobId).status, 'completed')
  assert.equal(entries.get(terminalJob.jobId).source, 'existing-artifacts')
  assert.equal(entries.get(partialJob.jobId).status, 'blocked')
  assert.equal(entries.get(partialJob.jobId).errorCode, 'PADDLE_JOB_INCOMPLETE')
  assert.equal(entries.get(mismatchJob.jobId).status, 'blocked')
  assert.equal(entries.get(mismatchJob.jobId).errorCode, 'PADDLE_REVIEW_ARTIFACT_PATH_MISMATCH')
  assert.equal(entries.get(failingJob.jobId).status, 'failed')
  assert.equal(entries.get(failingJob.jobId).errorCode, 'OPENAI_TIMEOUT')
  assert.deepEqual(entries.get(successJob.jobId).routes.map((route) => route.routeId), [
    'cie-9709-as-p1-p2',
    'cie-9709-as-p1-p4',
    'cie-9709-as-p1-p5',
  ])
  assert.ok(entries.get(successJob.jobId).routes.every((route) => route.status === 'auto-quarantined'))
  assert.equal(fs.readdirSync(path.dirname(ledgerPath)).some((name) => name.includes('.tmp')), false, 'the review ledger write must leave no partial temporary file')

  ingestCalls.length = 0
  const retriedQuarantine = await consumePaddleReviewQueue({
    workRoot,
    outputRoot,
    reviewId: terminalJob.jobId,
    retryQuarantined: true,
    env: { OPENAI_API_KEY: 'openai-test-key', QWEN_API_KEY: 'qwen-test-key' },
    loadCompletedJobImpl,
    ingestJobImpl,
    now: () => new Date('2026-08-29T00:00:15.000Z'),
  })
  assert.deepEqual(retriedQuarantine, {
    selected: 1,
    completed: 1,
    blocked: 0,
    failed: 0,
    skipped: 0,
    releasedRoutes: 0,
    quarantinedRoutes: 1,
  })
  assert.deepEqual(ingestCalls, [terminalJob.jobId], 'an explicit quarantine retry must re-enter the reviewer exactly once')

  ingestCalls.length = 0
  fs.appendFileSync(queuePath, `${JSON.stringify(queueRow(laterJob))}\n`, 'utf8')
  const limitedResume = await consumePaddleReviewQueue({
    workRoot,
    outputRoot,
    env: { OPENAI_API_KEY: 'openai-test-key', QWEN_API_KEY: 'qwen-test-key' },
    limit: 1,
    loadCompletedJobImpl,
    ingestJobImpl,
    now: () => new Date('2026-08-29T00:00:30.000Z'),
  })
  assert.deepEqual(limitedResume, {
    selected: 1,
    completed: 1,
    blocked: 0,
    failed: 0,
    skipped: 5,
    releasedRoutes: 0,
    quarantinedRoutes: 1,
  }, 'the actionable limit must be applied after completed ledger rows are skipped')
  assert.deepEqual(ingestCalls, [laterJob.jobId], 'a bounded resume must advance to the next unreviewed job')

  ingestCalls.length = 0
  const resumed = await consumePaddleReviewQueue({
    workRoot,
    outputRoot,
    env: { OPENAI_API_KEY: 'openai-test-key', QWEN_API_KEY: 'qwen-test-key' },
    loadCompletedJobImpl,
    ingestJobImpl,
    now: () => new Date('2026-08-29T00:01:00.000Z'),
  })
  assert.deepEqual(resumed, {
    selected: 0,
    completed: 0,
    blocked: 0,
    failed: 0,
    skipped: 6,
    releasedRoutes: 0,
    quarantinedRoutes: 0,
  })
  assert.deepEqual(ingestCalls, [], 'a resumed consumer must not repeat terminal, blocked, or failed work without an explicit retry')

  assert.deepEqual(parseReviewQueueArgs([
    '--work-root', workRoot,
    '--output-root', outputRoot,
    '--watch',
    '--retry-quarantined',
    '--limit', '2',
    '--poll-interval-ms', '1000',
    '--idle-exit-polls', '2',
  ]), {
    workRoot,
    outputRoot,
    ledgerPath: null,
    reviewId: null,
    limit: 2,
    retryFailed: false,
    retryBlocked: false,
    retryQuarantined: true,
    watch: true,
    pollIntervalMs: 1000,
    idleExitPolls: 2,
  })

  const watchPolls = []
  const watchResults = [
    { selected: 1, completed: 1, blocked: 0, failed: 0, skipped: 0, releasedRoutes: 1, quarantinedRoutes: 0 },
    { selected: 0, completed: 0, blocked: 0, failed: 0, skipped: 1, releasedRoutes: 0, quarantinedRoutes: 0 },
    { selected: 0, completed: 0, blocked: 0, failed: 0, skipped: 1, releasedRoutes: 0, quarantinedRoutes: 0 },
  ]
  let sleeps = 0
  const watched = await watchPaddleReviewQueue({
    consumeOptions: { workRoot, outputRoot },
    pollIntervalMs: 1000,
    idleExitPolls: 2,
    consumeImpl: async () => watchResults.shift(),
    sleepImpl: async () => { sleeps += 1 },
    onPoll: (result) => watchPolls.push(result),
  })
  assert.deepEqual(watched, { polls: 3, idlePolls: 2, stopped: 'idle' })
  assert.equal(sleeps, 2)
  assert.equal(watchPolls.length, 3)

  const firstLock = acquireReviewConsumerLock({
    workRoot,
    pid: 12345,
    nonce: 'first-lock',
    now: () => new Date('2026-08-29T00:02:00.000Z'),
    isProcessAlive: () => true,
  })
  assert.throws(
    () => acquireReviewConsumerLock({
      workRoot,
      pid: 67890,
      nonce: 'second-lock',
      now: () => new Date('2026-08-29T00:02:01.000Z'),
      isProcessAlive: () => true,
    }),
    /PADDLE_REVIEW_CONSUMER_LOCKED/,
    'a live review consumer lock must prevent duplicate provider calls',
  )
  firstLock.release()
  const replacementLock = acquireReviewConsumerLock({
    workRoot,
    pid: 67890,
    nonce: 'replacement-lock',
    now: () => new Date('2026-08-29T00:02:02.000Z'),
    isProcessAlive: () => false,
  })
  replacementLock.release()
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(JSON.stringify({ status: 'passed', scope: 'paddle-ocr-review-queue' }))
