import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { callStructuredWithFallback, providersFromEnvironment } from './ai-pdf-ingestion/provider-fallback.mjs'

const BATCH_ROOT = path.resolve('D:/CodexWork/stem-ocr-work/postprocess-batches/chapter-20260930/biology-as-mammal-transport')
const ARTIFACT_ROOT = path.join(BATCH_ROOT, 'reviewed-artifacts')
const CROP_MANIFEST = path.join(BATCH_ROOT, 'pdf-crop-preview-manifest.json')
const SYLLABUS_SOURCE = path.join(BATCH_ROOT, 'full-candidate-v1/src/data/syllabus/biology-9700-as-mammal-transport-source.json')
const DEFAULT_OUTPUT_ROOT = path.resolve('.candidate-evidence/9700-as-mammal-transport-qwen-20261004')
const FOLLOWUP_OUTPUT_ROOT = path.resolve('.candidate-evidence/9700-as-mammal-transport-qwen-20261004-followup1')
const ROUTE_ID = 'cie-9700-as-biology'
const TOPIC_ID = '9700-as-topic-08'
const CALL_LIMIT = 6
const IMAGE_LIMIT_PER_CALL = 2
const MAX_ATTEMPTS = 1
const TIMEOUT_MS = 60_000
const MAX_OUTPUT_TOKENS = 2_500
const FOLLOWUP_IDS = new Set([
  'cie-9700-9700_s25_qp_12:q32',
  'cie-9700-9700_s25_qp_12:q33',
  'cie-9700-9700_s25_qp_14:q33',
])
const DIRECT_POINT_OVERRIDE = Object.freeze({
  'cie-9700-9700_s25_qp_12:q33': Object.freeze([
    'biology-9700-2025-8-1-02',
    'biology-9700-2025-8-3-02',
  ]),
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

function comparison({ artifact, question, value, expectedPointIds = question.tags.syllabusPointIds }) {
  const expectedPart = question.parts[0]
  const expectedKey = expectedPart.answerKey
  const expectedDiagramCount = question.diagramRegions.length
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

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const followup = process.argv.includes('--followup-blocked')
  const outputArg = process.argv.find((value) => value.startsWith('--output-root='))?.slice('--output-root='.length)
  const outputRoot = path.resolve(outputArg || (followup ? FOLLOWUP_OUTPUT_ROOT : DEFAULT_OUTPUT_ROOT))
  let artifacts = artifactFiles(ARTIFACT_ROOT).map((file) => ({ file, artifact: readJson(file) }))
    .sort((left, right) => left.artifact.candidate.questions[0].sourceQuestionId.localeCompare(right.artifact.candidate.questions[0].sourceQuestionId))
  if (artifacts.length !== CALL_LIMIT) throw new Error(`Expected exactly ${CALL_LIMIT} reviewed artifacts.`)
  if (followup) artifacts = artifacts.filter(({ artifact }) => FOLLOWUP_IDS.has(artifact.candidate.questions[0].sourceQuestionId))
  const callLimit = followup ? FOLLOWUP_IDS.size : CALL_LIMIT
  if (artifacts.length !== callLimit) throw new Error(`Expected exactly ${callLimit} bounded review inputs.`)

  const cropManifest = readJson(CROP_MANIFEST)
  const syllabus = readJson(SYLLABUS_SOURCE)
  if (syllabus.routeId !== ROUTE_ID || syllabus.topicId !== TOPIC_ID || syllabus.points.length !== 17) {
    throw new Error('The pinned official syllabus source is invalid.')
  }
  const pointIds = syllabus.points.map((point) => point.id)
  const qwen = providersFromEnvironment(process.env).find((provider) => provider.name === 'qwen')
  const plan = {
    schemaVersion: 'chapter-ready-second-model-plan.v1',
    status: qwen ? 'READY' : 'BLOCKED_PROVIDER_NOT_CONFIGURED',
    provider: qwen ? { name: qwen.name, model: qwen.model } : { name: 'qwen', model: 'UNSET' },
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
  if (fs.existsSync(outputRoot)) throw new Error(`Refuse to overwrite existing verification output: ${outputRoot}`)
  fs.mkdirSync(outputRoot, { recursive: true })

  const results = []
  for (const { file, artifact } of artifacts) {
    const question = artifact.candidate.questions[0]
    const sourceQuestionId = question.sourceQuestionId
    const expectedPointIds = DIRECT_POINT_OVERRIDE[sourceQuestionId] || question.tags.syllabusPointIds
    const qpRecord = cropManifest.records.find((record) => record.sourceQuestionId === sourceQuestionId && record.kind === 'qp')
    const msRecord = cropManifest.records.find((record) => record.sourceQuestionId === sourceQuestionId && record.kind === 'ms')
    if (!qpRecord || !msRecord) throw new Error(`Pinned source crops are missing for ${sourceQuestionId}.`)
    const qpPath = path.resolve(qpRecord.previewPath)
    const msPath = path.resolve(msRecord.previewPath)
    if (sha256File(qpPath) !== qpRecord.sha256 || sha256File(msPath) !== msRecord.sha256) {
      throw new Error(`Pinned source crop hash mismatch for ${sourceQuestionId}.`)
    }
    const requestIdentity = {
      sourceQuestionId,
      paperId: artifact.paperId,
      questionNumber: question.questionNumber,
      questionPdfSha256: artifact.source.questionPdfSha256,
      markSchemePdfSha256: artifact.source.markSchemePdfSha256,
      qpCropSha256: qpRecord.sha256,
      msCropSha256: msRecord.sha256,
      officialSyllabus: {
        routeId: syllabus.routeId,
        topicId: syllabus.topicId,
        syllabusVersion: syllabus.syllabusVersion,
        source: syllabus.source,
        points: syllabus.points.map(({ id, officialOutcomeCode, sectionCode, summary }) => ({ id, officialOutcomeCode, sectionCode, summary })),
      },
      mappingRule: 'Select only syllabus outcomes directly tested by the printed question. Exclude same-chapter background associations that are not explicitly required by the stem, options or calculation.',
      visualCountRule: 'diagramRegionCount means every retained non-text visual object needed to answer the question, including a diagram, graph, chart or table.',
    }
    const input = [
      {
        role: 'system',
        content: [{
          type: 'input_text',
          text: 'Act as an independent second-model reviewer. Inspect the original question crop and exact mark-scheme crop without relying on any prior extraction, answer key or syllabus mapping. Solve the MCQ independently, then read the mark-scheme row, verify the whole-question identity, marks, visual-object count and official syllabus points. Map only outcomes directly tested by the printed question; do not add related background outcomes. Count every retained table, graph, chart or diagram as one visual object. Fail closed on ambiguity or disagreement.',
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
    const inputSha256 = canonicalInputHash({ requestIdentity, schema })
    const startedAt = Date.now()
    let receipt
    try {
      const outcome = await callStructuredWithFallback({
        providers: [qwen],
        request: {
          schemaName: 'chapter_ready_mcq_second_model_v1',
          schema,
          input,
          maxAttempts: MAX_ATTEMPTS,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          timeoutMs: TIMEOUT_MS,
          deadlineAt: Date.now() + TIMEOUT_MS,
        },
      })
      const reviewComparison = comparison({ artifact, question, value: outcome.value, expectedPointIds })
      receipt = {
        schemaVersion: 'chapter-ready-independent-verification.v1',
        status: reviewComparison.status,
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
        expectedPointIds,
        result: outcome.value,
        comparison: reviewComparison,
        telemetry: safeTelemetry(outcome),
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      receipt = {
        schemaVersion: 'chapter-ready-independent-verification.v1',
        status: 'BLOCKED_PROVIDER_FAILURE',
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
