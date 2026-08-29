import assert from 'node:assert/strict'

import { artifactId, buildAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'
import { callCompatibleStructured, callStructuredWithFallback, providersFromEnvironment } from './ai-pdf-ingestion/provider-fallback.mjs'
import { selectA2P4FiveYearPairs } from './ai-pdf-ingestion/a2-p4-five-year.mjs'
import { questionGroupsFromAiArtifacts } from '../server/aiVerifiedQuestionBank.js'
import { isAiMarkablePastPaperItem, isStudentReleasedAiStudyItem, isStudyOnlyPastPaperItem } from '../src/data/questionBank.js'
import { buildSyllabusPracticeSet } from '../src/lib/syllabusPractice.js'

const primaryAndFallback = providersFromEnvironment({
  OPENAI_API_KEY: 'openai-test-key',
  QWEN_VISION_API_KEY: 'qwen-test-key',
  DASHSCOPE_COMPAT_BASE_URL: 'https://dashscope.example.test/compatible-mode/v1',
}, { model: 'gpt-5.6' })

assert.deepEqual(primaryAndFallback.map((provider) => ({ name: provider.name, model: provider.model })), [
  { name: 'openai', model: 'gpt-5.6' },
  { name: 'qwen', model: 'qwen3-vl-plus' },
])

const attemptedProviders = []
const fallbackResult = await callStructuredWithFallback({
  providers: primaryAndFallback,
  request: { schemaName: 'fixture', schema: { type: 'object' }, input: [] },
  callOpenAi: async () => {
    attemptedProviders.push('openai')
    const error = new Error('rate limited')
    error.code = 'OPENAI_HTTP_429'
    throw error
  },
  callCompatible: async () => {
    attemptedProviders.push('qwen')
    return { questions: [] }
  },
})

assert.deepEqual(attemptedProviders, ['openai', 'qwen'])
assert.equal(fallbackResult.provider.name, 'qwen')
assert.deepEqual(fallbackResult.value, { questions: [] })
assert.deepEqual(fallbackResult.telemetry.attempts.map((attempt) => ({
  provider: attempt.provider,
  model: attempt.model,
  providerStatus: attempt.providerStatus,
  schemaStatus: attempt.schemaStatus,
})), [
  { provider: 'openai', model: 'gpt-5.6', providerStatus: 'OPENAI_HTTP_429', schemaStatus: 'not-returned' },
  { provider: 'qwen', model: 'qwen3-vl-plus', providerStatus: 'success', schemaStatus: 'parsed' },
])
assert.ok(fallbackResult.telemetry.attempts.every((attempt) => Number.isInteger(attempt.durationMs) && attempt.durationMs >= 0))

const providerTimeoutRequests = []
const providerTimeoutProviders = providersFromEnvironment({
  OPENAI_API_KEY: 'openai-test-key',
  QWEN_VISION_API_KEY: 'qwen-test-key',
  AI_PDF_OPENAI_PROVIDER_TIMEOUT_MS: '15000',
  AI_PDF_QWEN_PROVIDER_TIMEOUT_MS: '180000',
}, { model: 'gpt-5.6' })
await callStructuredWithFallback({
  providers: providerTimeoutProviders,
  request: { schemaName: 'fixture', schema: { type: 'object' }, input: [] },
  callOpenAi: async (request) => {
    providerTimeoutRequests.push({ provider: 'openai', timeoutMs: request.timeoutMs })
    const error = new Error('unavailable')
    error.code = 'OPENAI_HTTP_503'
    throw error
  },
  callCompatible: async (request) => {
    providerTimeoutRequests.push({ provider: 'qwen', timeoutMs: request.timeoutMs })
    return { questions: [] }
  },
})
assert.deepEqual(providerTimeoutRequests, [
  { provider: 'openai', timeoutMs: 15000 },
  { provider: 'qwen', timeoutMs: 180000 },
])

const qwenRequests = []
const qwenStructuredResult = await callCompatibleStructured({
  apiKey: 'qwen-test-key',
  model: 'qwen3-vl-plus',
  schemaName: 'fixture',
  schema: { type: 'object', properties: { questions: { type: 'array' } } },
  input: [{ role: 'system', content: [{ type: 'input_text', text: 'Return JSON.' }] }],
  maxAttempts: 1,
  fetchImpl: async (_url, request) => {
    qwenRequests.push(JSON.parse(request.body))
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'Result:\n```json\n{"questions":[]}\n```' } }] }),
    }
  },
})
assert.deepEqual(qwenStructuredResult, { questions: [] })
assert.equal(qwenRequests[0].enable_thinking, false)
assert.equal(qwenRequests[0].max_tokens, 8192)
assert.equal(qwenRequests[0].stream, false)
assert.deepEqual(qwenRequests[0].response_format, { type: 'json_object' })

const qwenJsonFallbackRequests = []
await callCompatibleStructured({
  apiKey: 'qwen-test-key',
  model: 'qwen3-vl-plus',
  schemaName: 'fixture',
  schema: { type: 'object', properties: { questions: { type: 'array' } } },
  input: [{ role: 'system', content: [{ type: 'input_text', text: 'Return JSON.' }] }],
  maxAttempts: 1,
  fetchImpl: async (_url, request) => {
    qwenJsonFallbackRequests.push(JSON.parse(request.body))
    if (qwenJsonFallbackRequests.length === 1) return { ok: false, status: 400, json: async () => ({}) }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"questions":[]}' } }] }),
    }
  },
})
assert.equal(qwenJsonFallbackRequests.length, 2)
assert.equal(Object.hasOwn(qwenJsonFallbackRequests[0], 'response_format'), true)
assert.equal(Object.hasOwn(qwenJsonFallbackRequests[1], 'response_format'), false)
assert.equal(qwenJsonFallbackRequests[1].max_tokens, 8192)

const qwenSchemaRequests = []
await callCompatibleStructured({
  apiKey: 'qwen-test-key',
  model: 'qwen3.7-plus',
  schemaName: 'fixture',
  schema: { type: 'object', properties: { questions: { type: 'array' } } },
  input: [{ role: 'system', content: [{ type: 'input_text', text: 'Return JSON.' }] }],
  maxAttempts: 1,
  fetchImpl: async (_url, request) => {
    qwenSchemaRequests.push(JSON.parse(request.body))
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"questions":[]}' } }] }),
    }
  },
})
assert.equal(qwenSchemaRequests[0].response_format.type, 'json_schema')
assert.equal(qwenSchemaRequests[0].response_format.json_schema.strict, true)

const qwenMalformedJsonRequests = []
const qwenMalformedJsonSleeps = []
const qwenMalformedJsonDiagnostics = []
const originalConsoleError = console.error
let qwenRecoveredResult
try {
  console.error = (entry) => qwenMalformedJsonDiagnostics.push(JSON.parse(String(entry)))
  qwenRecoveredResult = await callCompatibleStructured({
    apiKey: 'qwen-test-key',
    model: 'qwen3-vl-plus',
    schemaName: 'fixture',
    schema: { type: 'object', properties: { questions: { type: 'array' } } },
    input: [{ role: 'system', content: [{ type: 'input_text', text: 'Return JSON.' }] }],
    maxAttempts: 2,
    sleep: async (delayMs) => qwenMalformedJsonSleeps.push(delayMs),
    fetchImpl: async () => {
      qwenMalformedJsonRequests.push(true)
      return {
        ok: true,
        status: 200,
        json: async () => qwenMalformedJsonRequests.length === 1
          ? { choices: [{ finish_reason: 'stop', message: { content: '{"questions":[' } }] }
          : { choices: [{ finish_reason: 'stop', message: { content: '{"questions":[]}' } }] },
      }
    },
  })
} finally {
  console.error = originalConsoleError
}
assert.deepEqual(qwenRecoveredResult, { questions: [] })
assert.equal(qwenMalformedJsonRequests.length, 2)
assert.deepEqual(qwenMalformedJsonSleeps, [250])
assert.deepEqual(qwenMalformedJsonDiagnostics, [{
  event: 'qwen_response_json_invalid',
  finishReason: 'stop',
  contentLength: 14,
  startsWithObject: true,
  endsWithObject: false,
  hasCodeFence: false,
}])

const pairs = selectA2P4FiveYearPairs([
  '9702_m20_qp_42.pdf',
  '9702_m20_ms_42.pdf',
  '9702_m21_qp_42.pdf',
  '9702_m21_ms_42.pdf',
  '9702_s21_qp_41.pdf',
  '9702_s21_ms_41.pdf',
  '9702_s21_qp_51.pdf',
  '9702_s21_ms_51.pdf',
  '9702_w25_qp_44.pdf',
  '9702_w25_ms_44.pdf',
  '9702_w25_qp_45.pdf',
  '9702_w25_ms_45.pdf',
])

assert.deepEqual(pairs.map((pair) => pair.questionFile), [
  '9702_m21_qp_42.pdf',
  '9702_s21_qp_41.pdf',
  '9702_w25_qp_44.pdf',
])
assert.ok(pairs.every((pair) => pair.component === 4 && pair.year >= 2021 && pair.year <= 2025))

const sha = 'a'.repeat(64)
const markSha = 'b'.repeat(64)
const sourcePath = '/library/pdf/9702/9702_m21_qp_42.pdf'
const boundArtifactId = artifactId({
  paperId: 'cie-9702-9702_m21_qp_42',
  questionPdfSha256: sha,
  markSchemePdfSha256: markSha,
})
const artifact = {
  schemaVersion: 'ai-pdf-ingestion.v1',
  artifactId: boundArtifactId,
  paperId: 'cie-9702-9702_m21_qp_42',
  subject: '9702',
  stage: 'A2',
  syllabusRouteId: 'cie-9702-a2-physics',
  status: 'ai-verified',
  storageMode: 'coordinate-only',
  extractor: { provider: 'openai', model: 'gpt-5.6', schemaName: 'ai_pdf_question_extraction_v1' },
  verifier: { provider: 'qwen', model: 'qwen3-vl-plus', schemaName: 'ai_pdf_question_verification_v1' },
  source: {
    questionPdfPath: sourcePath,
    markSchemePdfPath: '/library/pdf/9702/9702_m21_ms_42.pdf',
    questionPdfSha256: sha,
    markSchemePdfSha256: markSha,
    pageSizes: { 3: { width: 1200, height: 1600 } },
    markSchemePageSizes: { 5: { width: 1200, height: 1600 } },
  },
  candidate: {
    questions: [{
      questionNumber: '2',
      regions: [{ page: 3, pageImageSha256: 'd'.repeat(64), x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }],
      diagramRegions: [],
      parts: [{ label: 'a', marks: 4, ocrText: 'State the answer.', math: [], diagramAssociations: [] }],
      tags: { primaryTopicId: 'physics-9702-topic-13', secondaryTopicIds: [], syllabusPointIds: [] },
      markSchemeEvidence: [{ page: 5, pageImageSha256: 'e'.repeat(64) }],
    }],
  },
  verification: {
    questions: [{ questionNumber: '2', pages: [3], parts: [{ label: 'a', marks: 4 }], diagramRegionCount: 0, markSchemeEvidence: [{ page: 5, pageImageSha256: 'e'.repeat(64) }] }],
  },
}
artifact.studentRelease = buildAiStudentStudyRelease({
  artifactId: artifact.artifactId,
  routeId: artifact.syllabusRouteId,
  status: artifact.status,
  source: artifact.source,
  extractor: artifact.extractor,
  verifier: artifact.verifier,
  candidate: artifact.candidate,
  verification: artifact.verification,
})

const unreleasedGroups = questionGroupsFromAiArtifacts([{ ...artifact, studentRelease: undefined }], { libraryRoot: '/library/pdf/9702' })
assert.equal(unreleasedGroups.length, 1)
assert.equal(isStudentReleasedAiStudyItem(unreleasedGroups[0]), false, 'AI verification without an explicit bound release must remain unavailable')

const tamperedReleaseGroups = questionGroupsFromAiArtifacts([{
  ...artifact,
  studentRelease: {
    ...artifact.studentRelease,
    sourceBinding: { ...artifact.studentRelease.sourceBinding, markSchemePdfSha256: 'f'.repeat(64) },
  },
}], { libraryRoot: '/library/pdf/9702' })
assert.equal(tamperedReleaseGroups.length, 1)
assert.equal(isStudentReleasedAiStudyItem(tamperedReleaseGroups[0]), false, 'a release bound to another mark scheme must fail closed')

const tamperedTopicArtifact = structuredClone(artifact)
tamperedTopicArtifact.candidate.questions[0].tags.primaryTopicId = 'physics-9702-topic-14'
const tamperedTopicGroups = questionGroupsFromAiArtifacts([tamperedTopicArtifact], { libraryRoot: '/library/pdf/9702' })
assert.equal(tamperedTopicGroups.length, 1)
assert.equal(isStudentReleasedAiStudyItem(tamperedTopicGroups[0]), false, 'changing a released syllabus topic must invalidate the content binding')

const groups = questionGroupsFromAiArtifacts([artifact], { libraryRoot: '/library/pdf/9702' })
assert.equal(groups.length, 1)
assert.equal(groups[0].routeId, 'cie-9702-a2-physics')
assert.equal(groups[0].paperComponent, 4)
assert.equal(groups[0].answerBinding.verificationStatus, 'ai-verified')
assert.equal(groups[0].sourceRef.localUrl, '/local-pdf/9702/9702_m21_qp_42.pdf')
assert.equal(groups[0].answerRef.localUrl, '/local-pdf/9702/9702_m21_ms_42.pdf')
assert.deepEqual(groups[0].parts[0].sourceEvidence[0].region, [0.1, 0.2, 0.9, 0.8])
assert.equal(groups[0].sourceContent.fileComplete, true)
assert.equal(groups[0].sourceContent.semanticStatus, 'ai-verified')
assert.equal(isStudyOnlyPastPaperItem(groups[0]), true, 'double-AI-verified coordinate records must be available as study questions')
assert.equal(isStudentReleasedAiStudyItem(groups[0]), true, 'a fully bound release must be eligible for student study')
assert.equal(isAiMarkablePastPaperItem(groups[0]), true, 'double-AI-verified coordinate records must receive automatic AI marking')

const practiceSet = buildSyllabusPracticeSet({
  routeId: 'cie-9702-a2-physics',
  syllabusTopicIds: ['9702-a2-topic-02'],
  questionCount: 1,
  components: [4],
  questionBank: groups,
  includeStudyOnly: true,
})
assert.equal(practiceSet.questionCount, 1)
assert.deepEqual(practiceSet.syllabusTopicIds, ['physics-9702-topic-13'])
assert.equal(practiceSet.questionGroups[0].reviewStatus, 'ai-verified')
assert.equal(practiceSet.questionGroups[0].studyOnly, true)

console.log(JSON.stringify({ status: 'passed', pairs: pairs.length, groups: groups.length }))
