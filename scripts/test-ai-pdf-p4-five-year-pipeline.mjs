import assert from 'node:assert/strict'

import { callCompatibleStructured, callStructuredWithFallback, providersFromEnvironment } from './ai-pdf-ingestion/provider-fallback.mjs'
import { selectA2P4FiveYearPairs } from './ai-pdf-ingestion/a2-p4-five-year.mjs'
import { questionGroupsFromAiArtifacts } from '../server/aiVerifiedQuestionBank.js'
import { isAiMarkablePastPaperItem, isStudyOnlyPastPaperItem } from '../src/data/questionBank.js'
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
const artifact = {
  schemaVersion: 'ai-pdf-ingestion.v1',
  artifactId: `sha256:${'c'.repeat(64)}`,
  paperId: 'cie-9702-9702_m21_qp_42',
  subject: '9702',
  status: 'ai-verified',
  storageMode: 'coordinate-only',
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
