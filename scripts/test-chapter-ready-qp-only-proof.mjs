import assert from 'node:assert/strict'

import { qpOnlyProofSchema, runQpOnlySourceProof } from './chapter-ready-qp-only-proof.mjs'

const sourceQuestionId = 'cie-9700-fixture_qp_11:q21'
const topicId = '9700-as-topic-05'
const pointId = 'biology-9700-2025-5-1-05'
const schema = qpOnlyProofSchema({ sourceQuestionId, questionNumber: '21', topicId, pointIds: [pointId] })
const sourceIdentity = Object.freeze({
  sourceQuestionId,
  questionNumber: '21',
  topicId,
  questionPdfSha256: 'a'.repeat(64),
  questionPageImageSha256: 'b'.repeat(64),
  qpCropSha256: 'c'.repeat(64),
})
const captured = []
const providerRequest = {
  schema,
  reviewPass: 'fixture-qp-only',
  input: [
    { role: 'system', content: [{ type: 'input_text', text: 'fixture' }] },
    { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(sourceIdentity) }, { type: 'input_image', image_url: 'data:image/png;base64,AA==' }] },
  ],
}
const providerResult = Object.freeze({
  sourceQuestionId,
  questionNumber: '21',
  questionIdentityConfirmed: true,
  wholeQuestionConfirmed: true,
  optionLabels: Object.freeze(['A', 'B', 'C', 'D']),
  primaryTopicId: topicId,
  syllabusPointIds: Object.freeze([pointId]),
  reasoning: 'All three printed processes are used during stem-cell tissue repair.',
  disagreementReasons: Object.freeze([]),
  independentDerivedAnswer: 'A',
  reviewDecision: 'accept',
})
const providerRawBefore = JSON.stringify(providerResult)
const receipt = await runQpOnlySourceProof({
  sourceRunner: async (request) => {
    captured.push(request)
    return { provider: { name: 'qwen', model: 'fixture' }, value: providerResult, telemetry: { attempts: [] } }
  },
  providerRequest,
  sourceIdentity,
  expectedDerivedAnswer: 'A',
  expectedPointIds: [pointId],
})
assert.equal(receipt.status, 'PASS_QP_ONLY_PROOF')
assert.equal(JSON.stringify(receipt.providerResult), providerRawBefore, 'QP-only proof must preserve provider raw output.')
assert.equal(captured.length, 1)
assert.equal(captured[0].input.flatMap((message) => message.content).filter((entry) => entry.type === 'input_image').length, 1)
assert.ok(!/(?:markScheme|msCrop|answerKey|correctOption|expectedAnswer|expectedOption)/i.test(JSON.stringify(captured[0])))
assert.deepEqual(Object.keys(schema.properties).slice(-4), ['reasoning', 'disagreementReasons', 'independentDerivedAnswer', 'reviewDecision'])

console.log(JSON.stringify({ status: 'PASS_QP_ONLY_SOURCE_RUNNER', qpImages: 1, msImages: 0, rawRewritten: false }))
