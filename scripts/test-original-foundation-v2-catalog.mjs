import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import { routeById } from '../src/data/routeRegistry.js'
import { SYLLABUS_PRACTICE_ROUTE_IDS } from '../src/lib/syllabusPracticeRoutes.js'
import {
  originalFoundationCatalogEntries,
  publicOriginalFoundationQuestion,
  scoreOriginalFoundationResponse,
} from '../server/originalFoundationPractice.js'

const V1_FINGERPRINT = '4a7d9e37a4db2b00584b05553518090ec3e6e2721d03265655a0077ddb2b7186'
const expectedTopics = SYLLABUS_PRACTICE_ROUTE_IDS.flatMap((routeId) => (
  (routeById(routeId)?.syllabus?.topics || []).map((topic) => ({ routeId, topicId: topic.id }))
))

const v1Entries = originalFoundationCatalogEntries()
assert.equal(v1Entries.length, 222)
assert.equal(
  crypto.createHash('sha256').update(JSON.stringify(v1Entries)).digest('hex'),
  V1_FINGERPRINT,
  'the gated v2 catalog must not change one byte of the legacy v1 private catalog',
)
const v1Public = publicOriginalFoundationQuestion(v1Entries[0].routeId, v1Entries[0].topicId)
assert.equal(v1Public.id, v1Entries[0].id)
assert.equal(v1Public.foundationCatalog, undefined)
assert.equal(v1Public.itemKind, undefined)
assert.equal(v1Public.skillFocus, undefined)

const v2Entries = originalFoundationCatalogEntries({ foundationCatalog: 'v2' })
assert.equal(v2Entries.length, expectedTopics.length * 3)
assert.equal(new Set(v2Entries.map((entry) => entry.id)).size, v2Entries.length)
assert.ok(Buffer.byteLength(JSON.stringify(v2Entries), 'utf8') < 2 * 1024 * 1024, 'the immutable 666-item catalog must stay below a bounded 2 MiB payload footprint')

for (const { routeId, topicId } of expectedTopics) {
  const items = v2Entries.filter((entry) => entry.routeId === routeId && entry.topicId === topicId)
  assert.deepEqual(items.map((entry) => entry.itemKind).sort(), ['application', 'concept', 'transfer'])
  assert.deepEqual(items.map((entry) => entry.skillFocus).sort(), ['apply', 'retrieve', 'transfer'])
  assert.equal(new Set(items.map((entry) => entry.prompt)).size, 3, `${routeId}/${topicId} must expose three genuinely distinct prompts`)
  assert.equal(new Set(items.map((entry) => JSON.stringify(entry.options))).size, 3, `${routeId}/${topicId} must not reuse one option set three times`)

  for (const entry of items) {
    assert.equal(entry.schemaVersion, 'stem-original-foundation-question-v2')
    assert.equal(entry.catalogVersion, 'v2')
    assert.equal(entry.foundationCatalog, 'v2')
    assert.equal(entry.id, `original-foundation:${routeId}:${topicId}:v2:${entry.itemKind}`)
    assert.equal(entry.sourceKind, 'original-foundation')
    assert.equal(entry.sourceAuthority, 'original-foundation-catalog')
    assert.equal(entry.formalProgressEligible, false)
    assert.equal(entry.countsTowardFormalGrade, false)
    assert.equal(entry.options.length, 4)
    assert.equal(new Set(entry.options.map((option) => option.id)).size, 4)
    assert.equal(new Set(entry.options.map((option) => option.text)).size, 4)
    assert.ok(entry.options.some((option) => option.id === entry.correctOptionId))
    assert.ok(entry.solution.summary)
    assert.ok(entry.solution.explanation)
    assert.ok(entry.solution.nextStep)
    assert.equal(entry.solution.markPoints.length, 1)
    assert.equal(entry.feedback.schemaVersion, 'stem-original-foundation-feedback-v2')
    assert.ok(entry.feedback.correctSummary)
    assert.ok(entry.feedback.incorrectSummary)
    assert.ok(entry.feedback.explanation)
    assert.ok(entry.feedback.nextStep)
    if (entry.itemKind === 'application') {
      assert.equal(entry.applicationBasis, 'curated-scenario')
      assert.doesNotMatch(entry.prompt, /which statement about .* is correct/i)
    }
    if (entry.itemKind === 'transfer') {
      assert.equal(entry.transferBasis, 'misconception-correction')
      assert.ok(entry.misconceptionId)
      assert.match(entry.prompt, /learner|student|claim|says|concludes/i)
      assert.deepEqual(
        [...new Set(entry.options.map((option) => option.text.split(':', 1)[0]))],
        ['Correction'],
        'transfer options must use the same neutral prefix so the correct answer is not visually cued',
      )
    }

    const projected = publicOriginalFoundationQuestion(routeId, topicId, {
      foundationCatalog: 'v2',
      itemKind: entry.itemKind,
    })
    assert.equal(projected.id, entry.id)
    assert.equal(projected.foundationCatalog, 'v2')
    assert.equal(projected.itemKind, entry.itemKind)
    assert.equal(projected.skillFocus, entry.skillFocus)
    assert.equal(projected.correctOptionId, undefined)
    assert.equal(projected.solution, undefined)
    assert.equal(projected.feedback, undefined)
    assert.equal(projected.answerContract.schemaVersion, 'stem-original-foundation-answer-contract-v2')
    assert.equal(projected.answerContract.id, `${entry.id}:answer:v2`)
    assert.equal(projected.answerContract.foundationCatalog, 'v2')

    const result = scoreOriginalFoundationResponse({
      foundationCatalog: 'v2',
      routeId,
      syllabusTopicId: topicId,
      questionId: entry.id,
      response: { selectedOptionId: entry.correctOptionId },
    })
    assert.equal(result.schemaVersion, 'stem-original-foundation-result-v2')
    assert.equal(result.foundationCatalog, 'v2')
    assert.equal(result.catalogVersion, 'v2')
    assert.equal(result.itemKind, entry.itemKind)
    assert.equal(result.skillFocus, entry.skillFocus)
    assert.equal(result.correct, true)
    assert.equal(result.score, 1)
    assert.equal(result.formalProgressEligible, false)
    assert.equal(result.countsTowardFormalGrade, false)
    assert.equal(result.feedback.schemaVersion, 'stem-original-foundation-feedback-v2')
    assert.equal(result.feedback.outcome, 'correct')
    assert.equal(result.feedback.misconceptionId, entry.itemKind === 'transfer' ? entry.misconceptionId : null)
    assert.ok(result.solution.explanation)
    assert.ok(result.solution.nextStep)
  }
}

const firstV2 = v2Entries[0]
assert.throws(
  () => scoreOriginalFoundationResponse({
    routeId: firstV2.routeId,
    syllabusTopicId: firstV2.topicId,
    questionId: firstV2.id,
    response: { selectedOptionId: firstV2.correctOptionId },
  }),
  (error) => error?.statusCode === 409 && error?.code === 'original_foundation_catalog_mismatch',
  'v2 IDs require the explicit v2 scorer capability',
)

console.log(JSON.stringify({ status: 'passed', scope: 'original-foundation-v2-catalog', entries: v2Entries.length }))
