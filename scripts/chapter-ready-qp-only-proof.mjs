import assert from 'node:assert/strict'
import crypto from 'node:crypto'

export function canonicalJsonSha256(value) {
  return crypto.createHash('sha256').update(Buffer.from(JSON.stringify(value), 'utf8')).digest('hex')
}

export function qpOnlyProofSchema({ sourceQuestionId, questionNumber, topicId, pointIds }) {
  assert.equal(typeof sourceQuestionId, 'string')
  assert.equal(typeof questionNumber, 'string')
  assert.equal(typeof topicId, 'string')
  assert.ok(Array.isArray(pointIds) && pointIds.length > 0)
  const required = [
    'sourceQuestionId', 'questionNumber', 'questionIdentityConfirmed',
    'wholeQuestionConfirmed', 'optionLabels', 'primaryTopicId',
    'syllabusPointIds', 'reasoning', 'disagreementReasons',
    'independentDerivedAnswer', 'reviewDecision',
  ]
  const schema = {
    type: 'object',
    additionalProperties: false,
    required,
    properties: {
      sourceQuestionId: { type: 'string', enum: [sourceQuestionId] },
      questionNumber: { type: 'string', enum: [questionNumber] },
      questionIdentityConfirmed: { type: 'boolean' },
      wholeQuestionConfirmed: { type: 'boolean' },
      optionLabels: {
        type: 'array', minItems: 4, maxItems: 4,
        prefixItems: ['A', 'B', 'C', 'D'].map((label) => ({ type: 'string', enum: [label] })),
        items: false,
      },
      primaryTopicId: { type: 'string', enum: [topicId] },
      syllabusPointIds: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: pointIds } },
      reasoning: { type: 'string', minLength: 1, maxLength: 1_200 },
      disagreementReasons: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 240 } },
      independentDerivedAnswer: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
      reviewDecision: { type: 'string', enum: ['accept', 'block'] },
    },
  }
  assert.deepEqual(Object.keys(schema.properties).slice(-4), [
    'reasoning', 'disagreementReasons', 'independentDerivedAnswer', 'reviewDecision',
  ])
  assert.deepEqual(schema.required.slice(-4), [
    'reasoning', 'disagreementReasons', 'independentDerivedAnswer', 'reviewDecision',
  ])
  return schema
}

function sameSet(left, right) {
  const a = [...new Set(left || [])].sort()
  const b = [...new Set(right || [])].sort()
  return JSON.stringify(a) === JSON.stringify(b)
}

export async function runQpOnlySourceProof({
  sourceRunner,
  providerRequest,
  sourceIdentity,
  expectedDerivedAnswer,
  expectedPointIds,
}) {
  assert.equal(typeof sourceRunner, 'function')
  assert.match(expectedDerivedAnswer, /^[A-D]$/)
  assert.ok(Array.isArray(expectedPointIds) && expectedPointIds.length > 0)
  const serializedIdentity = JSON.stringify(sourceIdentity)
  assert.ok(!/(?:markScheme|msCrop|answerKey|correctOption|expectedAnswer|expectedOption)/i.test(serializedIdentity),
    'QP-only source identity must not include MS or expected-answer data.')
  const outcome = await sourceRunner(providerRequest)
  const providerResult = outcome.value
  const checks = {
    decisionAccepted: providerResult?.reviewDecision === 'accept',
    questionIdentityConfirmed: providerResult?.questionIdentityConfirmed === true,
    wholeQuestionConfirmed: providerResult?.wholeQuestionConfirmed === true,
    optionLabelsMatch: JSON.stringify(providerResult?.optionLabels) === JSON.stringify(['A', 'B', 'C', 'D']),
    independentlyDerivedAnswerMatches: providerResult?.independentDerivedAnswer === expectedDerivedAnswer,
    topicMatches: providerResult?.primaryTopicId === sourceIdentity.topicId,
    syllabusPointsMatch: sameSet(providerResult?.syllabusPointIds, expectedPointIds),
    reasoningPresent: typeof providerResult?.reasoning === 'string' && providerResult.reasoning.trim().length > 0,
    noProviderDisagreement: Array.isArray(providerResult?.disagreementReasons) && providerResult.disagreementReasons.length === 0,
  }
  const status = Object.values(checks).every(Boolean) ? 'PASS_QP_ONLY_PROOF' : 'BLOCKED_QP_ONLY_PROOF'
  return {
    schemaVersion: 'chapter-ready-qp-only-proof.v1',
    status,
    sourceQuestionId: sourceIdentity.sourceQuestionId,
    provider: { name: outcome.provider.name, model: outcome.provider.model },
    inputSha256: canonicalJsonSha256({ sourceIdentity, schema: providerRequest.schema, reviewPass: providerRequest.reviewPass }),
    source: sourceIdentity,
    providerResult,
    result: { ...providerResult, decision: providerResult?.reviewDecision },
    comparison: { status, checks },
    telemetry: (outcome.telemetry?.attempts || []).map((attempt) => ({
      provider: attempt.provider,
      model: attempt.model,
      timeoutMs: attempt.timeoutMs,
      providerStatus: attempt.providerStatus,
      schemaStatus: attempt.schemaStatus,
      durationMs: attempt.durationMs,
    })),
  }
}
