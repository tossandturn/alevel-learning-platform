import assert from 'node:assert/strict'

import { routeById } from '../src/data/routeRegistry.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { SYLLABUS_PRACTICE_ROUTE_IDS } from '../src/lib/syllabusPracticeRoutes.js'
import {
  decorateOriginalFoundationInventory,
  originalFoundationCatalogEntries,
  originalFoundationQuestion,
  publicOriginalFoundationQuestion,
  scoreOriginalFoundationResponse,
} from '../server/originalFoundationPractice.js'

const expected = SYLLABUS_PRACTICE_ROUTE_IDS.flatMap((routeId) => {
  const route = routeById(routeId)
  return (route?.syllabus?.topics || []).map((topic) => ({ routeId, topicId: topic.id }))
})
const entries = originalFoundationCatalogEntries()

assert.equal(entries.length, expected.length, 'every configured syllabus chapter needs one bounded original-foundation item')
assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length, 'original question IDs must be canonical and unique by route/topic')

for (const { routeId, topicId } of expected) {
  const entry = originalFoundationQuestion(routeId, topicId)
  assert.ok(entry, `${routeId}/${topicId} must have an original-foundation entry`)
  assert.equal(entry.id, `original-foundation:${routeId}:${topicId}:v1`)
  assert.equal(entry.routeId, routeId)
  assert.equal(entry.topicId, topicId)
  assert.equal(entry.sourceKind, 'original-foundation')
  assert.equal(entry.sourceAuthority, 'original-foundation-catalog')
  assert.equal(entry.displaySourceLabel, '原创基础练习')
  assert.equal(entry.foundationBasis, 'curated-foundation')
  assert.equal(entry.answerType, 'single-choice')
  if (entry.subject === 'Further Mathematics') {
    assert.notEqual(entry.prompt, `Which statement about ${entry.topicName} is correct?`)
    assert.doesNotMatch(`${entry.prompt} ${entry.solution.summary}`, /standard course|selected for A Level|paper component|which topic/i)
  } else {
    assert.equal(entry.prompt, `Which statement about ${entry.topicName} is correct?`)
  }
  assert.ok(entry.options.length >= 3 && entry.options.length <= 4)
  assert.equal(new Set(entry.options.map((option) => option.id)).size, entry.options.length)
  assert.equal(new Set(entry.options.map((option) => option.text)).size, entry.options.length)
  assert.ok(entry.options.some((option) => option.id === entry.correctOptionId))
  assert.ok(entry.options.find((option) => option.id === entry.correctOptionId).text.length >= 20)
  assert.ok(entry.solution.summary.length >= 20)
  assert.equal(entry.solution.markPoints.length, 1)
  assert.equal(entry.formalProgressEligible, false)
  assert.equal(entry.countsTowardFormalGrade, false)
  assert.equal(entry.sourceRef, undefined)
  assert.equal(entry.answerRef, undefined)
  assert.doesNotMatch(`${entry.prompt} ${entry.solution.summary}`, /placeholder|synthetic fixture|past[- ]paper|official question|syllabus statement|learning focus|chapter-aligned|belongs to this chapter/i)
  assert.equal(entry.distractorBasis, 'curated-within-topic')
  assert.equal(entry.options.length, 4)
  assert.equal(entry.options.filter((option) => option.id !== entry.correctOptionId).length, 3)

  const projected = publicOriginalFoundationQuestion(routeId, topicId)
  assert.equal(projected.correctOptionId, undefined)
  assert.equal(projected.solution, undefined)
  assert.equal(projected.syllabusPointId, undefined)
  assert.equal(projected.sourceRef, undefined)
  assert.equal(projected.answerRef, undefined)
  assert.equal(projected.answerContract.reveal, 'after-submission')
  assert.doesNotMatch(JSON.stringify(projected), /"(?:correctOptionId|solution|syllabusPointId)"/)

  const scored = scoreOriginalFoundationResponse({
    routeId,
    syllabusTopicId: topicId,
    questionId: entry.id,
    response: { selectedOptionId: entry.correctOptionId },
  })
  assert.equal(scored.correct, true)
  assert.equal(scored.score, 1)
  assert.equal(scored.maxScore, 1)
  assert.equal(scored.scoreScope, 'original-learning-only')
  assert.equal(scored.formalProgressEligible, false)
  assert.equal(scored.countsTowardFormalGrade, false)
}

for (const routeId of SYLLABUS_PRACTICE_ROUTE_IDS) {
  const routeEntries = entries.filter((entry) => entry.routeId === routeId)
  assert.equal(
    new Set(routeEntries.map((entry) => `${entry.prompt}\u0000${entry.options.find((option) => option.id === entry.correctOptionId)?.text}`)).size,
    routeEntries.length,
    `${routeId} chapters must not reuse one generic prompt/answer pair`,
  )
  const inventory = decorateOriginalFoundationInventory(syllabusTopicsInventory({ routeId, includeStudyOnly: false }))
  assert.equal(inventory.chapterStudy.topicCount, inventory.topics.length)
  assert.equal(inventory.chapterStudy.startableTopicCount, inventory.topics.length)
  assert.deepEqual(
    inventory.chapterStudy.gapTopicIds,
    inventory.topics.filter((topic) => topic.chapterStudy.officialAvailable === 0).map((topic) => topic.id),
  )
  for (const topic of inventory.topics) {
    assert.equal(topic.chapterStudy.originalAvailable, 1)
    assert.equal(topic.chapterStudy.available, topic.chapterStudy.officialAvailable + topic.chapterStudy.originalAvailable)
    assert.equal(topic.chapterStudy.startable, true)
  }
}
assert.equal(entries.filter((entry) => entry.distractorBasis === 'cross-topic-v1').length, 0)

assert.equal(originalFoundationQuestion('cie-9702-as-physics', 'not-a-topic'), null)
assert.throws(
  () => scoreOriginalFoundationResponse({
    routeId: 'cie-9702-as-physics',
    syllabusTopicId: 'not-a-topic',
    questionId: 'original-foundation:cie-9702-as-physics:not-a-topic:v1',
    response: { selectedOptionId: 'A' },
  }),
  (error) => error?.code === 'original_foundation_question_not_found' && error?.statusCode === 404,
)

console.log(JSON.stringify({ status: 'passed', scope: 'original-foundation-catalog', entries: entries.length }))
