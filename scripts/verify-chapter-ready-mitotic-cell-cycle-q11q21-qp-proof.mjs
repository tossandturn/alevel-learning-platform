import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { callStructuredWithFallback, providersFromEnvironment } from './ai-pdf-ingestion/provider-fallback.mjs'
import { qpOnlyProofSchema, runQpOnlySourceProof } from './chapter-ready-qp-only-proof.mjs'

const PRIMARY_ROOT = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-primary-20261005-v8')
const OUTPUT_ROOT = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-q11q21-qp-proof-20261005-v1')
const SYLLABUS_SOURCE = path.resolve('src/data/syllabus/biology-9700-as-mitotic-cell-cycle-source.json')
const SOURCE_QUESTION_ID = 'cie-9700-9700_s25_qp_11:q21'
const TOPIC_ID = '9700-as-topic-05'
const EXPECTED_POINT_IDS = Object.freeze(['biology-9700-2025-5-1-05'])
const REQUIRED_PROVIDER = 'qwen'
const REQUIRED_MODEL = 'qwen3-vl-plus'
const MAX_ATTEMPTS = 1
const TIMEOUT_MS = 60_000
const MAX_OUTPUT_TOKENS = 2_500

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }
function dataUrl(file) { return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` }
function artifactFiles(root) {
  return fs.readdirSync(path.join(root, 'artifacts'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(entry.parentPath, entry.name)).sort()
}
function safeError(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : 'PROVIDER_REQUEST_FAILED',
    message: typeof error?.message === 'string' ? error.message.slice(0, 240) : 'Provider request failed.',
    attempts: (error?.providerTelemetry?.attempts || []).map((attempt) => ({
      provider: attempt.provider, model: attempt.model, timeoutMs: attempt.timeoutMs,
      providerStatus: attempt.providerStatus, schemaStatus: attempt.schemaStatus, durationMs: attempt.durationMs,
    })),
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const qwen = providersFromEnvironment(process.env).find((provider) => provider.name === REQUIRED_PROVIDER)
  const providerReady = qwen?.model === REQUIRED_MODEL
  const primarySummary = readJson(path.join(PRIMARY_ROOT, 'summary.json'))
  assert.equal(primarySummary.status, 'PASS_PRIMARY_REVIEW_PENDING_INDEPENDENT_PROVIDER')
  const primaryRecord = primarySummary.results.find((entry) => entry.sourceQuestionId === SOURCE_QUESTION_ID)
  assert.ok(primaryRecord)
  const artifactEntry = artifactFiles(PRIMARY_ROOT).map((file) => ({ file, artifact: readJson(file) }))
    .find(({ artifact }) => artifact.candidate.questions[0].sourceQuestionId === SOURCE_QUESTION_ID)
  assert.ok(artifactEntry)
  const question = artifactEntry.artifact.candidate.questions[0]
  assert.equal(artifactEntry.artifact.studentRelease.review.method, 'single-model-source-review')
  assert.equal(artifactEntry.artifact.studentRelease.review.independentPassCount, 1)
  const qpPath = path.resolve(primaryRecord.crops.qp.path)
  assert.equal(sha256File(qpPath), primaryRecord.crops.qp.sha256)
  const syllabus = readJson(SYLLABUS_SOURCE)
  assert.equal(syllabus.topicId, TOPIC_ID)
  const sourceIdentity = {
    sourceQuestionId: SOURCE_QUESTION_ID,
    questionNumber: question.questionNumber,
    topicId: TOPIC_ID,
    questionPdfSha256: artifactEntry.artifact.source.questionPdfSha256,
    questionPage: primaryRecord.geometry.qp.page,
    questionPageImageSha256: primaryRecord.sourcePages.qp.sha256,
    qpCropSha256: primaryRecord.crops.qp.sha256,
    officialSyllabus: {
      routeId: syllabus.routeId,
      topicId: syllabus.topicId,
      syllabusVersion: syllabus.syllabusVersion,
      points: syllabus.points.map(({ id, officialOutcomeCode, sectionCode, summary }) => ({ id, officialOutcomeCode, sectionCode, summary })),
    },
    stemReadingRule: 'Read the exact printed wording. The stem asks which processes are used by stem cells during tissue repair; do not invent a unique-to-stem-cells or stem-cell-specific qualifier.',
    mappingRule: 'Select only the current official outcome directly tested by the printed stem and decision. Exclude related background outcomes that are not the focus of the question.',
  }
  const pointIds = syllabus.points.map((point) => point.id)
  const schema = qpOnlyProofSchema({ sourceQuestionId: SOURCE_QUESTION_ID, questionNumber: question.questionNumber, topicId: TOPIC_ID, pointIds })
  const input = [
    { role: 'system', content: [{ type: 'input_text', text: 'Act as an independent question-paper-only reviewer. No mark scheme or prior answer is supplied. Read the exact stem literally: it asks which processes are used, not which are unique or specific. First give concise biological reasoning about cytokinesis, DNA replication and transcription during stem-cell proliferation, differentiation and tissue repair. Only after the reasoning is stable, emit independentDerivedAnswer and reviewDecision last. Return every required JSON field and block on ambiguity. Map only the directly tested official outcome.' }] },
    { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(sourceIdentity) }, { type: 'input_image', image_url: dataUrl(qpPath) }] },
  ]
  const providerRequest = {
    schemaName: 'chapter_ready_q11q21_qp_only_proof_v1',
    schema,
    input,
    reviewPass: 'root-authorized-q11q21-qp-only-proof-1',
    maxAttempts: MAX_ATTEMPTS,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    timeoutMs: TIMEOUT_MS,
    deadlineAt: Date.now() + TIMEOUT_MS,
  }
  const plan = {
    schemaVersion: 'chapter-ready-qp-only-plan.v1',
    status: providerReady ? 'READY' : qwen ? 'BLOCKED_PROVIDER_MODEL_MISMATCH' : 'BLOCKED_PROVIDER_NOT_CONFIGURED',
    provider: qwen ? { name: qwen.name, model: qwen.model } : { name: REQUIRED_PROVIDER, model: 'UNSET' },
    credentialStatus: qwen ? 'SET_NOT_EXPOSED' : 'UNSET',
    reviewPass: providerRequest.reviewPass,
    authorisedStageBudget: { maximumCalls: 2, qpOnlyCallsPlanned: 1, fullSourceCallsConditional: 1 },
    callsPlanned: 1,
    qpImagesPerCall: 1,
    msImagesPerCall: 0,
    maxAttemptsPerCall: MAX_ATTEMPTS,
    timeoutMsPerCall: TIMEOUT_MS,
    maxOutputTokensPerCall: MAX_OUTPUT_TOKENS,
    outputRoot: OUTPUT_ROOT,
  }
  console.log(JSON.stringify({ event: 'qp_only_plan', ...plan }))
  if (dryRun) return
  if (!qwen || !providerReady) throw Object.assign(new Error('Pinned Qwen verifier is unavailable.'), { code: 'AI_PROVIDER_NOT_CONFIGURED' })
  if (fs.existsSync(OUTPUT_ROOT)) throw new Error(`Refuse to overwrite QP-only proof root: ${OUTPUT_ROOT}`)
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true })
  let receipt
  try {
    const sourceRunner = (request) => callStructuredWithFallback({ providers: [qwen], request })
    receipt = await runQpOnlySourceProof({
      sourceRunner,
      providerRequest,
      sourceIdentity,
      expectedDerivedAnswer: 'A',
      expectedPointIds: EXPECTED_POINT_IDS,
    })
  } catch (error) {
    receipt = {
      schemaVersion: 'chapter-ready-qp-only-proof.v1',
      status: 'BLOCKED_PROVIDER_FAILURE',
      sourceQuestionId: SOURCE_QUESTION_ID,
      provider: { name: qwen.name, model: qwen.model },
      source: sourceIdentity,
      error: safeError(error),
    }
  }
  receipt.artifact = { path: artifactEntry.file, sha256: sha256File(artifactEntry.file), artifactId: artifactEntry.artifact.artifactId }
  const receiptPath = path.join(OUTPUT_ROOT, `${SOURCE_QUESTION_ID.replaceAll(':', '--')}.json`)
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  const summary = {
    schemaVersion: 'chapter-ready-qp-only-proof-summary.v1',
    status: receipt.status,
    routeId: syllabus.routeId,
    topicId: TOPIC_ID,
    callsExecuted: 1,
    plan,
    result: { sourceQuestionId: SOURCE_QUESTION_ID, status: receipt.status, file: receiptPath, sha256: sha256File(receiptPath) },
  }
  const summaryPath = path.join(OUTPUT_ROOT, 'summary.json')
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ event: 'qp_only_result', ...summary, summaryPath, summarySha256: sha256File(summaryPath) }))
  if (receipt.status !== 'PASS_QP_ONLY_PROOF') process.exitCode = 2
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'qp_only_fatal', status: 'BLOCKED', ...safeError(error) }))
  process.exitCode = 1
})
