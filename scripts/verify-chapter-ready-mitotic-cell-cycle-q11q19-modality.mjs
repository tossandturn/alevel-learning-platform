import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { callStructuredWithFallback, providersFromEnvironment } from './ai-pdf-ingestion/provider-fallback.mjs'
import { chapterReadyModalityEligibility } from './chapter-ready-modality-eligibility.mjs'

const batch = Object.freeze({
  kind: 'root-authorized-q11q19-modality-replacement',
  primaryRoot: '.candidate-evidence/9700-as-mitotic-cell-cycle-primary-20261005-v6',
  followupPrimaryRoot: '.candidate-evidence/9700-as-mitotic-cell-cycle-primary-20261005-v6',
  outputRoot: '.candidate-evidence/9700-as-mitotic-cell-cycle-qwen-20261005-q11q19-modality-v1',
  followupRoot: '.candidate-evidence/9700-as-mitotic-cell-cycle-qwen-20261005-q11q19-modality-no-followup-authorised',
  callLimit: 1,
})
const SYLLABUS_SOURCE = path.resolve('src/data/syllabus/biology-9700-as-mitotic-cell-cycle-source.json')
const DEFAULT_OUTPUT_ROOT = path.resolve(batch.outputRoot)
const FOLLOWUP_OUTPUT_ROOT = batch.followupRoot ? path.resolve(batch.followupRoot) : null
const ROUTE_ID = 'cie-9700-as-biology'
const TOPIC_ID = '9700-as-topic-05'
const REQUIRED_PROVIDER = 'qwen'
const REQUIRED_MODEL = 'qwen3-vl-plus'
const CALL_LIMIT = batch.callLimit
const PRIMARY_ARTIFACT_COUNT = 6
const FOLLOWUP_LIMIT = 1
const IMAGE_LIMIT_PER_CALL = 2
const MAX_ATTEMPTS = 1
const TIMEOUT_MS = 60_000
const MAX_OUTPUT_TOKENS = 2_500
const FOLLOWUP_CLARIFICATIONS = Object.freeze({
  'cie-9700-9700_s25_qp_11:q19': 'Independently compute the two requested counts from the printed sample size and percentages before reading the MS: calculate 45% of 500 for chromosomes at the equator and 24% of 500 for separated chromatids, then choose the matching printed row. The results table and A-D option table are two distinct complete visual objects, so diagramRegionCount is 2 for source delivery. However, they are tables, not a cell diagram, photomicrograph or microscope slide. Official outcome 5.2.2 requires interpreting one of those cell-visual modalities, so deterministic modality eligibility has excluded only that outcome while retaining all other seven current Topic 5 outcomes. Select only the directly tested outcome from the allowed set. Return every required JSON field; use an empty disagreementReasons array only if there is genuinely no conflict.',
})
const FOLLOWUP_SOURCE_IDS = new Set([
  'cie-9700-9700_s25_qp_11:q19',
])

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

function resultSchema({ sourceQuestionId, questionNumber, pointIds, requireGeometryConfirmation = false }) {
  const sourceCheckFields = requireGeometryConfirmation
    ? ['graphRegionComplete', 'answerTableRegionComplete', 'diagramRegionsExcludeUnrelatedContent']
    : []
  const required = [
    'sourceQuestionId', 'questionNumber', 'questionIdentityConfirmed',
    'wholeQuestionConfirmed', 'optionLabels', 'marks', 'diagramRegionCount',
    'primaryTopicId', 'syllabusPointIds', ...sourceCheckFields,
    'reasoning', 'disagreementReasons', 'independentDerivedAnswer',
    'markSchemeAnswer', 'reviewDecision',
  ]
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties: {
      sourceQuestionId: { type: 'string', enum: [sourceQuestionId] },
      questionNumber: { type: 'string', enum: [String(questionNumber)] },
      questionIdentityConfirmed: { type: 'boolean' },
      wholeQuestionConfirmed: { type: 'boolean' },
      optionLabels: {
        type: 'array',
        minItems: 4,
        maxItems: 4,
        prefixItems: ['A', 'B', 'C', 'D'].map((label) => ({ type: 'string', enum: [label] })),
        items: false,
      },
      marks: { type: 'integer', enum: [1] },
      diagramRegionCount: { type: 'integer', minimum: 0, maximum: 4 },
      primaryTopicId: { type: 'string', enum: [TOPIC_ID] },
      syllabusPointIds: {
        type: 'array',
        minItems: 1,
        uniqueItems: true,
        items: { type: 'string', enum: pointIds },
      },
      ...(requireGeometryConfirmation ? {
        graphRegionComplete: { type: 'boolean' },
        answerTableRegionComplete: { type: 'boolean' },
        diagramRegionsExcludeUnrelatedContent: { type: 'boolean' },
      } : {}),
      reasoning: { type: 'string', minLength: 1, maxLength: 1_200 },
      disagreementReasons: {
        type: 'array',
        maxItems: 8,
        items: { type: 'string', minLength: 1, maxLength: 240 },
      },
      independentDerivedAnswer: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
      markSchemeAnswer: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
      reviewDecision: { type: 'string', enum: ['accept', 'block'] },
    },
  }
}

function assertTerminalFieldOrder(schema) {
  const expectedTerminalFields = ['reasoning', 'disagreementReasons', 'independentDerivedAnswer', 'markSchemeAnswer', 'reviewDecision']
  assert.deepEqual(Object.keys(schema.properties).slice(-5), expectedTerminalFields)
  assert.deepEqual(schema.required.slice(-5), expectedTerminalFields)
  return expectedTerminalFields
}

function standardResult(providerResult) {
  if (!['accept', 'block'].includes(providerResult?.reviewDecision)) {
    throw Object.assign(new Error('reviewDecision failed strict enum validation.'), { code: 'PROVIDER_SCHEMA_INVALID' })
  }
  const { reviewDecision, ...result } = providerResult
  return { ...result, decision: reviewDecision }
}

function comparison({ artifact, question, value }) {
  const expectedPart = question.parts[0]
  const expectedKey = expectedPart.answerKey
  const checks = {
    decisionAccepted: value.decision === 'accept',
    questionIdentityConfirmed: value.questionIdentityConfirmed === true,
    wholeQuestionConfirmed: value.wholeQuestionConfirmed === true,
    optionLabelsMatch: JSON.stringify(value.optionLabels) === JSON.stringify(['A', 'B', 'C', 'D']),
    independentlyDerivedAnswerMatches: value.independentDerivedAnswer === expectedKey,
    markSchemeAnswerMatches: value.markSchemeAnswer === expectedKey,
    independentAndMarkSchemeAgree: value.independentDerivedAnswer === value.markSchemeAnswer,
    marksMatch: value.marks === expectedPart.marks,
    diagramRegionCountMatches: value.diagramRegionCount === question.diagramRegions.length,
    topicMatches: value.primaryTopicId === question.tags.primaryTopicId,
    syllabusPointsMatch: sameSet(value.syllabusPointIds, question.tags.syllabusPointIds),
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
  if (!record?.crops?.qp?.path || !record?.crops?.ms?.path) throw new Error(`Pinned source crops are missing for ${sourceQuestionId}.`)
  return record
}

function followupSourceIds() {
  const summary = readJson(path.join(DEFAULT_OUTPUT_ROOT, 'summary.json'))
  const blocked = summary.results
    .filter((result) => result.status !== 'PASS_SECOND_MODEL' && FOLLOWUP_SOURCE_IDS.has(result.sourceQuestionId))
    .map((result) => result.sourceQuestionId)
  if (blocked.length === 0) throw new Error('No blocked initial reviews need clarification.')
  if (blocked.length > FOLLOWUP_LIMIT) throw new Error(`Clarification is capped at ${FOLLOWUP_LIMIT} calls; ${blocked.length} reviews are blocked.`)
  return new Set(blocked)
}

async function main() {
  if (process.argv.includes('--schema-order-check')) {
    const schema = resultSchema({ sourceQuestionId: 'fixture:q1', questionNumber: '1', pointIds: ['fixture-point'] })
    const terminalFields = assertTerminalFieldOrder(schema)
    console.log(JSON.stringify({ status: 'PASS_TERMINAL_REVIEW_FIELD_ORDER', terminalFields }))
    return
  }
  const dryRun = process.argv.includes('--dry-run')
  const followup = process.argv.includes('--followup-blocked')
  const outputRoot = path.resolve(followup ? FOLLOWUP_OUTPUT_ROOT : DEFAULT_OUTPUT_ROOT)
  const primaryRoot = path.resolve(followup ? batch.followupPrimaryRoot : batch.primaryRoot)
  const artifactRoot = path.join(primaryRoot, 'artifacts')
  const primarySummary = readJson(path.join(primaryRoot, 'summary.json'))
  const syllabus = readJson(SYLLABUS_SOURCE)
  let artifacts = artifactFiles(artifactRoot).map((file) => ({ file, artifact: readJson(file) }))
    .sort((left, right) => left.artifact.candidate.questions[0].sourceQuestionId.localeCompare(right.artifact.candidate.questions[0].sourceQuestionId))
  if (primarySummary.status !== 'PASS_PRIMARY_REVIEW_PENDING_INDEPENDENT_PROVIDER' || primarySummary.batchKind !== 'initial-candidates'
    || primarySummary.questions !== PRIMARY_ARTIFACT_COUNT || primarySummary.runtimeGroups !== PRIMARY_ARTIFACT_COUNT || primarySummary.providerCalls !== 0) {
    throw new Error('The pinned primary preparation summary is invalid.')
  }
  if (artifacts.length !== PRIMARY_ARTIFACT_COUNT) throw new Error(`Expected exactly ${PRIMARY_ARTIFACT_COUNT} source-reviewed primary artifacts.`)
  artifacts = artifacts.filter(({ artifact }) => FOLLOWUP_SOURCE_IDS.has(artifact.candidate.questions[0].sourceQuestionId))
  if (artifacts.length !== CALL_LIMIT) throw new Error(`Expected exactly ${CALL_LIMIT} final source-audit artifacts.`)
  if (syllabus.routeId !== ROUTE_ID || syllabus.topicId !== TOPIC_ID || syllabus.points.length !== 8) throw new Error('The pinned official syllabus source is invalid.')
  let selectedIds = null
  if (followup) {
    selectedIds = followupSourceIds()
    artifacts = artifacts.filter(({ artifact }) => selectedIds.has(artifact.candidate.questions[0].sourceQuestionId))
  }
  const callLimit = followup ? selectedIds.size : CALL_LIMIT
  const qwen = providersFromEnvironment(process.env).find((provider) => provider.name === REQUIRED_PROVIDER)
  const providerReady = qwen?.model === REQUIRED_MODEL
  const plan = {
    schemaVersion: 'chapter-ready-second-model-plan.v1',
    batchKind: batch.kind,
    status: providerReady ? 'READY' : qwen ? 'BLOCKED_PROVIDER_MODEL_MISMATCH' : 'BLOCKED_PROVIDER_NOT_CONFIGURED',
    provider: qwen ? { name: qwen.name, model: qwen.model } : { name: REQUIRED_PROVIDER, model: 'UNSET' },
    credentialStatus: qwen ? 'SET_NOT_EXPOSED' : 'UNSET',
    reviewPass: 'root-authorized-q11q19-modality-replacement-1',
    authorisedStageBudget: {
      q11q21CorrectiveMaximumCalls: 2,
      qpOnlyQ11q21CallsExecuted: 1,
      fullSourceQ11q21CallsExecuted: 0,
      redirectedQ11q19CallsPlanned: 1,
      totalEnvelopeBeforeThisCall: 17,
      totalEnvelopeAfterThisCall: 18,
      callsRemainingAfterThis: 0,
    },
    callsPlanned: callLimit,
    imagesPerCall: IMAGE_LIMIT_PER_CALL,
    maxAttemptsPerCall: MAX_ATTEMPTS,
    timeoutMsPerCall: TIMEOUT_MS,
    maxOutputTokensPerCall: MAX_OUTPUT_TOKENS,
    artifactRoot,
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
    const modalityEvidence = Object.freeze({
      sourceKind: 'table-mcq',
      hasDiagram: false,
      hasPhotomicrograph: false,
      hasMicroscopeSlide: false,
      printedTableCount: 2,
    })
    assert.equal(question.diagramRegions.length, 2)
    const modalityEligibility = chapterReadyModalityEligibility(syllabus.points, modalityEvidence)
    const pointIds = modalityEligibility.eligiblePoints.map((point) => point.id)
    assert.equal(pointIds.length, 7)
    assert.deepEqual(modalityEligibility.excludedPoints.map((point) => point.officialOutcomeCode), ['5.2.2'])
    const record = cropRecord(primarySummary, sourceQuestionId)
    const qpPath = path.resolve(record.crops.qp.path)
    const msPath = path.resolve(record.crops.ms.path)
    if (sha256File(qpPath) !== record.crops.qp.sha256 || sha256File(msPath) !== record.crops.ms.sha256) throw new Error(`Pinned crop hash mismatch for ${sourceQuestionId}.`)
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
      modalityEligibility: {
        evidence: modalityEligibility.evidence,
        eligiblePointIds: pointIds,
        excludedPoints: modalityEligibility.excludedPoints,
        rule: 'An outcome that explicitly requires interpretation of a photomicrograph, diagram or microscope slide is ineligible when the source contains none of those modalities. This constrains mapping only and does not supply or alter an answer.',
      },
      mappingRule: 'Select only official outcomes directly tested by the printed question. Exclude same-chapter background facts not required by the stem, options or decision.',
      visualCountRule: 'Count every retained diagram, graph, chart or printed answer table needed to answer as one distinct visual object. A figure and a separate printed answer table count separately even when both appear in one whole-question crop. Ordinary linear text and non-tabular option lists are not visual objects.',
      independentAgreementRule: 'Derive the answer from the QP image before comparing with the MS image. If the independent answer differs from the MS, or either image is ambiguous, reviewDecision must be block and disagreementReasons must state the conflict. Never change the independent answer merely to match the MS.',
    }
    const clarification = FOLLOWUP_CLARIFICATIONS[sourceQuestionId] || ''
    const requiredFieldInstruction = 'Return every required JSON key in the supplied schema order. First emit identity/source checks, marks, visual count and syllabus mapping; then emit one concise reasoning field containing the final verified observation or calculation. Only after that reasoning is stable, emit disagreementReasons, independentDerivedAnswer, markSchemeAnswer, and reviewDecision last. Do not guess an answer or decision early and then attempt to revise only in prose. optionLabels must be ["A","B","C","D"]. disagreementReasons must always be a JSON array, using [] only when there is genuinely no disagreement.'
    const passInstruction = followup
      ? `No follow-up is authorised for this redirected replacement call. Reinspect both images from scratch. ${clarification} ${requiredFieldInstruction}`
      : `This is the only redirected replacement call in the separately authorised Q11/21 corrective stage. Do not rely on any prior receipt, extraction, answer or mapping. ${clarification} ${requiredFieldInstruction}`
    const input = [
      { role: 'system', content: [{ type: 'input_text', text: `Act as an independent second-model reviewer. ${passInstruction} reviewDecision is a review verdict and must be exactly accept or block; put A-D only in independentDerivedAnswer and markSchemeAnswer. Return every field required by the supplied JSON schema. Solve the MCQ from the QP image before reading the MS image. If your independently derived answer conflicts with the MS, keep your independent answer, set reviewDecision to block, and describe the conflict. Never defer to the MS merely because it is official. Also block on image ambiguity. Verify identity, completeness, marks, distinct visual-object count and direct official mapping.` }] },
      { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(requestIdentity) }, { type: 'input_image', image_url: dataUrl(qpPath) }, { type: 'input_image', image_url: dataUrl(msPath) }] },
    ]
    const schema = resultSchema({ sourceQuestionId, questionNumber: question.questionNumber, pointIds })
    assertTerminalFieldOrder(schema)
    const requestText = JSON.stringify(requestIdentity)
    assert.ok(!/(?:correctOption|answerKey|expectedAnswer|expectedOption)/i.test(requestText), 'Provider request must not include an expected answer key.')
    const inputSha256 = canonicalInputHash({ requestIdentity, schema, reviewPass: plan.reviewPass })
    const startedAt = Date.now()
    let receipt
    try {
      const outcome = await callStructuredWithFallback({ providers: [qwen], request: {
        schemaName: 'chapter_ready_mitotic_cell_cycle_q11q19_modality_v1', schema, input,
        maxAttempts: MAX_ATTEMPTS, maxOutputTokens: MAX_OUTPUT_TOKENS, timeoutMs: TIMEOUT_MS, deadlineAt: Date.now() + TIMEOUT_MS,
      } })
      const normalizedResult = standardResult(outcome.value)
      const reviewComparison = comparison({ artifact, question, value: normalizedResult })
      receipt = {
        schemaVersion: 'chapter-ready-independent-verification.v1', status: reviewComparison.status, reviewPass: plan.reviewPass,
        sourceQuestionId, artifact: { path: file, sha256: sha256File(file), artifactId: artifact.artifactId },
        provider: { name: outcome.provider.name, model: outcome.provider.model },
        originalReview: {
          method: artifact.studentRelease.review.method,
          independentPassCount: artifact.studentRelease.review.independentPassCount,
          reviewerProvider: artifact.studentRelease.review.reviewerProvider,
          reviewerModel: artifact.studentRelease.review.reviewerModel,
        },
        inputSha256, source: requestIdentity, expectedPointIds: question.tags.syllabusPointIds,
        providerResult: outcome.value, result: normalizedResult, comparison: reviewComparison,
        telemetry: safeTelemetry(outcome), durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      receipt = {
        schemaVersion: 'chapter-ready-independent-verification.v1', status: 'BLOCKED_PROVIDER_FAILURE', reviewPass: plan.reviewPass,
        sourceQuestionId, artifact: { path: file, sha256: sha256File(file), artifactId: artifact.artifactId },
        provider: { name: qwen.name, model: qwen.model }, inputSha256, source: requestIdentity,
        error: safeProviderError(error), durationMs: Date.now() - startedAt,
      }
    }
    const outputFile = path.join(outputRoot, `${sourceQuestionId.replaceAll(':', '--')}.json`)
    fs.writeFileSync(outputFile, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    results.push({ sourceQuestionId, status: receipt.status, file: outputFile, provider: receipt.provider, durationMs: receipt.durationMs })
    console.log(JSON.stringify({ event: 'second_model_result', ...results.at(-1) }))
  }
  const summary = {
    schemaVersion: 'chapter-ready-independent-verification-summary.v1',
    status: results.every((result) => result.status === 'PASS_SECOND_MODEL') ? `PASS_SECOND_MODEL_ALL_${callLimit}` : 'BLOCKED_SECOND_MODEL_BATCH',
    routeId: ROUTE_ID, topicId: TOPIC_ID, provider: { name: qwen.name, model: qwen.model }, reviewPass: plan.reviewPass,
    callsExecuted: results.length, limits: plan,
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
