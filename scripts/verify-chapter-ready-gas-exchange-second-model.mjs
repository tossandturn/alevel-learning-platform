import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { callStructuredWithFallback, providersFromEnvironment } from './ai-pdf-ingestion/provider-fallback.mjs'

const replacementBatch = process.argv.includes('--replacement-batch')
const reserveBatch = process.argv.includes('--reserve-batch')
if (replacementBatch && reserveBatch) throw new Error('Select only one verification batch.')
const batch = reserveBatch
  ? Object.freeze({
      kind: 'reserve-candidates',
      primaryRoot: '.candidate-evidence/9700-as-gas-exchange-reserve-primary-20261004-v1',
      outputRoot: '.candidate-evidence/9700-as-gas-exchange-reserve-qwen-20261004-v1',
      followupRoot: '.candidate-evidence/9700-as-gas-exchange-reserve-qwen-20261004-followup1',
      callLimit: 1,
    })
  : replacementBatch
    ? Object.freeze({
      kind: 'replacement-candidates',
      primaryRoot: '.candidate-evidence/9700-as-gas-exchange-replacement-primary-20261004-v1',
      outputRoot: '.candidate-evidence/9700-as-gas-exchange-replacement-qwen-20261004-v1',
      followupRoot: '.candidate-evidence/9700-as-gas-exchange-replacement-qwen-20261004-followup1',
      callLimit: 3,
    })
    : Object.freeze({
      kind: 'initial-candidates',
      primaryRoot: '.candidate-evidence/9700-as-gas-exchange-primary-20261004-v2',
      outputRoot: '.candidate-evidence/9700-as-gas-exchange-qwen-20261004-v1',
      followupRoot: '.candidate-evidence/9700-as-gas-exchange-qwen-20261004-followup1',
      callLimit: 6,
    })
const PRIMARY_ROOT = path.resolve(batch.primaryRoot)
const ARTIFACT_ROOT = path.join(PRIMARY_ROOT, 'artifacts')
const PRIMARY_SUMMARY = path.join(PRIMARY_ROOT, 'summary.json')
const SYLLABUS_SOURCE = path.resolve('src/data/syllabus/biology-9700-as-gas-exchange-source.json')
const DEFAULT_OUTPUT_ROOT = path.resolve(batch.outputRoot)
const FOLLOWUP_OUTPUT_ROOT = path.resolve(batch.followupRoot)
const ROUTE_ID = 'cie-9700-as-biology'
const TOPIC_ID = '9700-as-topic-09'
const REQUIRED_PROVIDER = 'qwen'
const REQUIRED_MODEL = 'qwen3-vl-plus'
const CALL_LIMIT = batch.callLimit
const FOLLOWUP_LIMIT = 3
const IMAGE_LIMIT_PER_CALL = 2
const MAX_ATTEMPTS = 1
const TIMEOUT_MS = 60_000
const MAX_OUTPUT_TOKENS = 2_500
const FOLLOWUP_CLARIFICATIONS = Object.freeze({
  'cie-9700-9700_s25_qp_11:q35': 'For direct syllabus mapping, distinguish the exact competency asked by the question from other true facts visible in the labelled micrograph. Do not map an outcome merely because its terminology appears in the source.',
  'cie-9700-9700_s25_qp_13:q35': 'Distinguish a factor that maintains the oxygen concentration difference from a factor that changes diffusion distance or diffusion rate. Re-evaluate each printed option and the exact official mark-scheme row on that basis.',
  'cie-9700-9700_s25_qp_14:q36': 'For direct syllabus mapping, note that the organ names are supplied by the printed question. Distinguish knowledge of tissue distribution from recognising an unnamed organ or making a plan diagram.',
  'cie-9700-9700_s25_qp_12:q35': 'The organ names are supplied and the options are a text table. Distinguish describing tissue distribution from recognising an unnamed organ in a microscope image or making a plan diagram.',
  'cie-9700-9700_s25_qp_13:q34': 'Count the photomicrograph and the separate printed answer table as two retained visual objects. For direct syllabus mapping, distinguish recognising smooth muscle in a microscope image and giving its function from broadly describing tissue distribution.',
})

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function sha256File(file) {
  return sha256Bytes(fs.readFileSync(file))
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function artifactFiles(root) {
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
}

function dataUrl(file) {
  return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`
}

function sameSet(left, right) {
  const a = [...new Set(left || [])].sort()
  const b = [...new Set(right || [])].sort()
  return JSON.stringify(a) === JSON.stringify(b)
}

function canonicalInputHash(value) {
  return sha256Bytes(Buffer.from(JSON.stringify(value), 'utf8'))
}

function safeProviderError(error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.code)
    ? error.code
    : 'PROVIDER_REQUEST_FAILED'
  return {
    code,
    message: typeof error?.message === 'string' ? error.message.slice(0, 240) : 'Provider request failed.',
    attempts: (error?.providerTelemetry?.attempts || []).map((attempt) => ({
      provider: attempt.provider,
      model: attempt.model,
      timeoutMs: attempt.timeoutMs,
      providerStatus: attempt.providerStatus,
      schemaStatus: attempt.schemaStatus,
      durationMs: attempt.durationMs,
    })),
  }
}

function resultSchema({ sourceQuestionId, questionNumber, pointIds }) {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'sourceQuestionId', 'questionNumber', 'decision', 'questionIdentityConfirmed',
      'wholeQuestionConfirmed', 'optionLabels', 'independentDerivedAnswer',
      'markSchemeAnswer', 'marks', 'diagramRegionCount', 'primaryTopicId',
      'syllabusPointIds', 'reasoning', 'disagreementReasons',
    ],
    properties: {
      sourceQuestionId: { type: 'string', enum: [sourceQuestionId] },
      questionNumber: { type: 'string', enum: [String(questionNumber)] },
      decision: { type: 'string', enum: ['accept', 'block'] },
      questionIdentityConfirmed: { type: 'boolean' },
      wholeQuestionConfirmed: { type: 'boolean' },
      optionLabels: {
        type: 'array',
        minItems: 4,
        maxItems: 4,
        prefixItems: ['A', 'B', 'C', 'D'].map((label) => ({ type: 'string', enum: [label] })),
        items: false,
      },
      independentDerivedAnswer: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
      markSchemeAnswer: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
      marks: { type: 'integer', enum: [1] },
      diagramRegionCount: { type: 'integer', minimum: 0, maximum: 4 },
      primaryTopicId: { type: 'string', enum: [TOPIC_ID] },
      syllabusPointIds: {
        type: 'array',
        minItems: 1,
        uniqueItems: true,
        items: { type: 'string', enum: pointIds },
      },
      reasoning: { type: 'string', minLength: 1, maxLength: 1_200 },
      disagreementReasons: {
        type: 'array',
        maxItems: 8,
        items: { type: 'string', minLength: 1, maxLength: 240 },
      },
    },
  }
}

function comparison({ artifact, question, value }) {
  const expectedPart = question.parts[0]
  const expectedKey = expectedPart.answerKey
  const expectedDiagramCount = question.diagramRegions.length
  const expectedPointIds = question.tags.syllabusPointIds
  const checks = {
    decisionAccepted: value.decision === 'accept',
    questionIdentityConfirmed: value.questionIdentityConfirmed === true,
    wholeQuestionConfirmed: value.wholeQuestionConfirmed === true,
    optionLabelsMatch: JSON.stringify(value.optionLabels) === JSON.stringify(['A', 'B', 'C', 'D']),
    independentlyDerivedAnswerMatches: value.independentDerivedAnswer === expectedKey,
    markSchemeAnswerMatches: value.markSchemeAnswer === expectedKey,
    independentAndMarkSchemeAgree: value.independentDerivedAnswer === value.markSchemeAnswer,
    marksMatch: value.marks === expectedPart.marks,
    diagramRegionCountMatches: value.diagramRegionCount === expectedDiagramCount,
    topicMatches: value.primaryTopicId === question.tags.primaryTopicId,
    syllabusPointsMatch: sameSet(value.syllabusPointIds, expectedPointIds),
    noProviderDisagreement: value.disagreementReasons.length === 0,
    originalReviewIsSinglePass: artifact.studentRelease?.review?.method === 'single-model-source-review'
      && artifact.studentRelease?.review?.independentPassCount === 1,
    reviewerIsIndependent: artifact.studentRelease?.review?.reviewerProvider !== REQUIRED_PROVIDER
      && artifact.studentRelease?.review?.reviewerModel !== REQUIRED_MODEL,
  }
  return {
    status: Object.values(checks).every(Boolean) ? 'PASS_SECOND_MODEL' : 'BLOCKED_REVIEW_DISAGREEMENT',
    checks,
  }
}

function safeTelemetry(outcome) {
  return (outcome.telemetry?.attempts || []).map((attempt) => ({
    provider: attempt.provider,
    model: attempt.model,
    timeoutMs: attempt.timeoutMs,
    providerStatus: attempt.providerStatus,
    schemaStatus: attempt.schemaStatus,
    durationMs: attempt.durationMs,
  }))
}

function cropRecord(primarySummary, sourceQuestionId) {
  const record = primarySummary.results.find((candidate) => candidate.sourceQuestionId === sourceQuestionId)
  if (!record?.crops?.qp?.path || !record?.crops?.ms?.path) {
    throw new Error(`Pinned source crops are missing for ${sourceQuestionId}.`)
  }
  return record
}

function followupSourceIds() {
  const summary = readJson(path.join(DEFAULT_OUTPUT_ROOT, 'summary.json'))
  const blocked = summary.results
    .filter((result) => result.status !== 'PASS_SECOND_MODEL')
    .map((result) => result.sourceQuestionId)
  if (blocked.length === 0) throw new Error('No blocked initial reviews need clarification.')
  if (blocked.length > FOLLOWUP_LIMIT) {
    throw new Error(`Clarification is capped at ${FOLLOWUP_LIMIT} calls; ${blocked.length} initial reviews are blocked.`)
  }
  return new Set(blocked)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const followup = process.argv.includes('--followup-blocked')
  const outputArg = process.argv.find((value) => value.startsWith('--output-root='))?.slice('--output-root='.length)
  const outputRoot = path.resolve(outputArg || (followup ? FOLLOWUP_OUTPUT_ROOT : DEFAULT_OUTPUT_ROOT))
  const primarySummary = readJson(PRIMARY_SUMMARY)
  const syllabus = readJson(SYLLABUS_SOURCE)
  let artifacts = artifactFiles(ARTIFACT_ROOT).map((file) => ({ file, artifact: readJson(file) }))
    .sort((left, right) => left.artifact.candidate.questions[0].sourceQuestionId.localeCompare(right.artifact.candidate.questions[0].sourceQuestionId))

  if (primarySummary.status !== 'PASS_PRIMARY_REVIEW_PENDING_INDEPENDENT_PROVIDER'
    || primarySummary.questions !== CALL_LIMIT
    || primarySummary.runtimeGroups !== CALL_LIMIT
    || primarySummary.providerCalls !== 0) {
    throw new Error('The pinned primary preparation summary is invalid.')
  }
  if (artifacts.length !== CALL_LIMIT) throw new Error(`Expected exactly ${CALL_LIMIT} source-reviewed artifacts.`)
  if (syllabus.routeId !== ROUTE_ID || syllabus.topicId !== TOPIC_ID || syllabus.points.length !== 7) {
    throw new Error('The pinned official syllabus source is invalid.')
  }
  const pointIds = syllabus.points.map((point) => point.id)

  let selectedIds = null
  if (followup) {
    selectedIds = followupSourceIds()
    artifacts = artifacts.filter(({ artifact }) => selectedIds.has(artifact.candidate.questions[0].sourceQuestionId))
  }
  const callLimit = followup ? selectedIds.size : CALL_LIMIT
  if (artifacts.length !== callLimit) throw new Error(`Expected exactly ${callLimit} bounded review inputs.`)

  const qwen = providersFromEnvironment(process.env).find((provider) => provider.name === REQUIRED_PROVIDER)
  const providerReady = qwen?.model === REQUIRED_MODEL
  const plan = {
    schemaVersion: 'chapter-ready-second-model-plan.v1',
    batchKind: batch.kind,
    status: providerReady
      ? 'READY'
      : qwen ? 'BLOCKED_PROVIDER_MODEL_MISMATCH' : 'BLOCKED_PROVIDER_NOT_CONFIGURED',
    provider: qwen ? { name: qwen.name, model: qwen.model } : { name: REQUIRED_PROVIDER, model: 'UNSET' },
    credentialStatus: qwen ? 'SET_NOT_EXPOSED' : 'UNSET',
    reviewPass: followup ? 'clarification-followup-1' : 'initial-blind-review',
    callsPlanned: callLimit,
    imagesPerCall: IMAGE_LIMIT_PER_CALL,
    maxAttemptsPerCall: MAX_ATTEMPTS,
    timeoutMsPerCall: TIMEOUT_MS,
    maxOutputTokensPerCall: MAX_OUTPUT_TOKENS,
    artifactRoot: ARTIFACT_ROOT,
    outputRoot,
  }
  console.log(JSON.stringify({ event: 'second_model_plan', ...plan }))
  if (dryRun) return
  if (!qwen) throw Object.assign(new Error('Qwen verifier is not configured.'), { code: 'AI_PROVIDER_NOT_CONFIGURED' })
  if (!providerReady) throw Object.assign(new Error('The configured Qwen model does not match the pinned verifier model.'), { code: 'AI_PROVIDER_MODEL_MISMATCH' })
  if (fs.existsSync(outputRoot)) throw new Error(`Refuse to overwrite existing verification output: ${outputRoot}`)
  fs.mkdirSync(outputRoot, { recursive: true })

  const results = []
  for (const { file, artifact } of artifacts) {
    const question = artifact.candidate.questions[0]
    const sourceQuestionId = question.sourceQuestionId
    const record = cropRecord(primarySummary, sourceQuestionId)
    const qpPath = path.resolve(record.crops.qp.path)
    const msPath = path.resolve(record.crops.ms.path)
    if (sha256File(qpPath) !== record.crops.qp.sha256 || sha256File(msPath) !== record.crops.ms.sha256) {
      throw new Error(`Pinned source crop hash mismatch for ${sourceQuestionId}.`)
    }
    const requestIdentity = {
      sourceQuestionId,
      paperId: artifact.paperId,
      questionNumber: question.questionNumber,
      questionPdfSha256: artifact.source.questionPdfSha256,
      markSchemePdfSha256: artifact.source.markSchemePdfSha256,
      questionPage: record.geometry.qp.page,
      markSchemePage: record.geometry.ms.page,
      questionPageImageSha256: record.sourcePages.qp.sha256,
      markSchemePageImageSha256: record.sourcePages.ms.sha256,
      qpCropSha256: record.crops.qp.sha256,
      msCropSha256: record.crops.ms.sha256,
      officialSyllabus: {
        routeId: syllabus.routeId,
        topicId: syllabus.topicId,
        syllabusVersion: syllabus.syllabusVersion,
        source: syllabus.source,
        points: syllabus.points.map(({ id, officialOutcomeCode, sectionCode, summary }) => ({ id, officialOutcomeCode, sectionCode, summary })),
      },
      mappingRule: 'Select only official outcomes directly tested by the printed question. Exclude same-chapter background associations not required by the stem, options or calculation.',
      visualCountRule: 'diagramRegionCount means every retained non-text visual object needed to answer the question, including a diagram, photomicrograph, graph, chart or table.',
    }
    const passInstruction = followup
      ? `This is the single permitted clarification pass after a blocked initial review. Reinspect both images from scratch and resolve only what the visible source proves. ${FOLLOWUP_CLARIFICATIONS[sourceQuestionId] || ''}`
      : 'This is a blind initial review. Do not infer or rely on any prior extraction, answer key or syllabus mapping.'
    const input = [
      {
        role: 'system',
        content: [{
          type: 'input_text',
          text: `Act as an independent second-model reviewer. ${passInstruction} Solve the MCQ independently, then read the exact mark-scheme row and verify whole-question identity, marks, visual-object count and direct official syllabus mapping. Count every retained table, graph, chart, diagram or photomicrograph as one visual object. Fail closed on ambiguity or disagreement.`,
        }],
      },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: JSON.stringify(requestIdentity) },
          { type: 'input_image', image_url: dataUrl(qpPath) },
          { type: 'input_image', image_url: dataUrl(msPath) },
        ],
      },
    ]
    const schema = resultSchema({ sourceQuestionId, questionNumber: question.questionNumber, pointIds })
    const inputSha256 = canonicalInputHash({ requestIdentity, schema, reviewPass: plan.reviewPass })
    const startedAt = Date.now()
    let receipt
    try {
      const outcome = await callStructuredWithFallback({
        providers: [qwen],
        request: {
          schemaName: 'chapter_ready_gas_exchange_second_model_v1',
          schema,
          input,
          maxAttempts: MAX_ATTEMPTS,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          timeoutMs: TIMEOUT_MS,
          deadlineAt: Date.now() + TIMEOUT_MS,
        },
      })
      const reviewComparison = comparison({ artifact, question, value: outcome.value })
      receipt = {
        schemaVersion: 'chapter-ready-independent-verification.v1',
        status: reviewComparison.status,
        reviewPass: plan.reviewPass,
        sourceQuestionId,
        artifact: { path: file, sha256: sha256File(file), artifactId: artifact.artifactId },
        provider: { name: outcome.provider.name, model: outcome.provider.model },
        originalReview: {
          method: artifact.studentRelease.review.method,
          independentPassCount: artifact.studentRelease.review.independentPassCount,
          reviewerProvider: artifact.studentRelease.review.reviewerProvider,
          reviewerModel: artifact.studentRelease.review.reviewerModel,
        },
        inputSha256,
        source: requestIdentity,
        expectedPointIds: question.tags.syllabusPointIds,
        result: outcome.value,
        comparison: reviewComparison,
        telemetry: safeTelemetry(outcome),
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      receipt = {
        schemaVersion: 'chapter-ready-independent-verification.v1',
        status: 'BLOCKED_PROVIDER_FAILURE',
        reviewPass: plan.reviewPass,
        sourceQuestionId,
        artifact: { path: file, sha256: sha256File(file), artifactId: artifact.artifactId },
        provider: { name: qwen.name, model: qwen.model },
        inputSha256,
        source: requestIdentity,
        error: safeProviderError(error),
        durationMs: Date.now() - startedAt,
      }
    }
    const outputFile = path.join(outputRoot, `${sourceQuestionId.replaceAll(':', '--')}.json`)
    fs.writeFileSync(outputFile, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    results.push({ sourceQuestionId, status: receipt.status, file: outputFile, provider: receipt.provider, durationMs: receipt.durationMs })
    console.log(JSON.stringify({ event: 'second_model_result', ...results.at(-1) }))
  }

  const summary = {
    schemaVersion: 'chapter-ready-independent-verification-summary.v1',
    status: results.every((result) => result.status === 'PASS_SECOND_MODEL')
      ? `PASS_SECOND_MODEL_ALL_${callLimit}`
      : 'BLOCKED_SECOND_MODEL_BATCH',
    routeId: ROUTE_ID,
    topicId: TOPIC_ID,
    provider: { name: qwen.name, model: qwen.model },
    reviewPass: plan.reviewPass,
    callsExecuted: results.length,
    limits: plan,
    passed: results.filter((result) => result.status === 'PASS_SECOND_MODEL').length,
    blocked: results.filter((result) => result.status !== 'PASS_SECOND_MODEL').length,
    results,
  }
  fs.writeFileSync(path.join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ event: 'second_model_summary', ...summary }))
  if (summary.status !== `PASS_SECOND_MODEL_ALL_${callLimit}`) process.exitCode = 2
}

main().catch((error) => {
  const safe = safeProviderError(error)
  console.error(JSON.stringify({ event: 'second_model_fatal', status: 'BLOCKED', ...safe }))
  process.exitCode = 1
})
