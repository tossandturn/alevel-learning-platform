import assert from 'node:assert/strict'

import { isHumanReviewedPastPaperItem, unifiedQuestionBank } from '../src/data/questionBank.js'
import { topicPracticeEligibility } from '../src/lib/practiceConstants.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { buildCoachPractice, coachPracticeOptions } from '../src/lib/verifiedPracticeCatalog.js'

const routeId = 'cie-9702-as-physics'
const heldCorrectionId = 'cie-9702-9702_s25_qp_22:q1'
const reviewedRouteQuestions = unifiedQuestionBank.filter((question) => (
  question.routeId === routeId && isHumanReviewedPastPaperItem(question)
))
const reviewedRouteIds = new Set(reviewedRouteQuestions.map((question) => question.sourceQuestionId))
const inventory = syllabusTopicsInventory({ routeId, questionBank: unifiedQuestionBank })
const mappedTopicIds = (question) => new Set([
  question.syllabusMapping?.primaryTopicId,
  ...(question.syllabusMapping?.secondaryTopicIds || []),
  ...(question.syllabusMapping?.topicIds || []),
].filter(Boolean))

assert.equal(inventory.verifiedQuestionGroupCount, reviewedRouteIds.size, 'secondary mappings must not duplicate route-level formally eligible groups')
assert.equal(reviewedRouteIds.has(heldCorrectionId), false, 'the corrected AI-only Q1 must remain outside formal inventory')
for (const topic of inventory.topics) {
  const expectedIds = new Set(reviewedRouteQuestions
    .filter((question) => mappedTopicIds(question).has(topic.id))
    .map((question) => question.sourceQuestionId))
  assert.equal(topic.verifiedQuestionCount, expectedIds.size, `${topic.id}: secondary mappings must count each eligible source group once`)
  const expectedPolicy = topicPracticeEligibility({
    verifiedQuestionCount: expectedIds.size,
    availableQuestionCount: expectedIds.size,
  })
  assert.equal(topic.ready, expectedPolicy.ready, `${topic.id}: formal readiness must use the shared 12-group policy`)
  assert.equal(topic.ctaPolicy, expectedPolicy.ctaPolicy, `${topic.id}: CTA must use the shared 6/12 policy`)
}
assert.equal(inventory.ready, inventory.topics.every((topic) => topic.ready), 'route readiness must require every official topic to clear the formal floor')
assert.equal(inventory.topics.filter((topic) => topic.ctaPolicy === 'start-study').length, 1, 'the single under-formal topic must retain reviewed-subset study access')

const legacyPhysicsOption = coachPracticeOptions().find((option) => option.routeId === routeId)
assert.ok(legacyPhysicsOption, 'AI Practice must retain the exact 9702 AS route')
assert.deepEqual(
  legacyPhysicsOption.topics
    .filter((topic) => topic.id.startsWith('physics-9702-topic-'))
    .map((topic) => [topic.id, topic.inventory]),
  inventory.topics.map((topic) => [topic.id, topic.verifiedQuestionCount]),
  'legacy AI Practice and the server syllabus gate must count the same reviewed topic memberships',
)
const secondaryTopicPractice = buildCoachPractice({
  routeId,
  knowledgeGroupId: 'physics-9702-topic-04',
  questionCount: 15,
})
assert.ok(
  secondaryTopicPractice.parts.some((part) => part.sourceQuestionId === 'cie-9702-9702_m24_qp_22:q2'),
  'a reviewed secondary membership must be selectable through the AI Practice catalog as well as the server Topic Drill',
)
assert.equal(secondaryTopicPractice.parts.some((part) => part.sourceQuestionId === heldCorrectionId), false, 'the quarantined correction must never enter AI Practice through its former secondary membership')

const reviewedSecondaryQuestion = unifiedQuestionBank.find((question) => (
  question.routeId === routeId
  && question.answerBinding?.verificationStatus === 'reviewed'
  && Array.isArray(question.syllabusMapping?.secondaryTopicIds)
  && question.syllabusMapping.secondaryTopicIds.length
))
assert.ok(reviewedSecondaryQuestion, 'a reviewed fixture with secondary topic tags is required')
const dualShapeQuestion = {
  ...reviewedSecondaryQuestion,
  syllabusMapping: {
    ...reviewedSecondaryQuestion.syllabusMapping,
    topicIds: [reviewedSecondaryQuestion.syllabusMapping.primaryTopicId],
  },
}
const dualShapeInventory = syllabusTopicsInventory({ routeId, questionBank: [dualShapeQuestion] })
assert.equal(dualShapeInventory.verifiedQuestionGroupCount, 1, 'explicit topicIds and secondary IDs must remain one reviewed source group')
assert.equal(dualShapeInventory.topics.find((topic) => topic.id === 'physics-9702-topic-01')?.verifiedQuestionCount, 1)
assert.equal(dualShapeInventory.topics.find((topic) => topic.id === 'physics-9702-topic-07')?.verifiedQuestionCount, 1, 'secondary IDs must be unioned when topicIds is also present')
const pendingQuestion = {
  ...reviewedSecondaryQuestion,
  answerBinding: { ...reviewedSecondaryQuestion.answerBinding, verificationStatus: 'machine-indexed' },
  syllabusMapping: { ...reviewedSecondaryQuestion.syllabusMapping, topicIds: [reviewedSecondaryQuestion.syllabusMapping.primaryTopicId], reviewStatus: 'pending' },
}
const pendingInventory = syllabusTopicsInventory({
  routeId,
  questionBank: [pendingQuestion],
})
assert.equal(
  pendingInventory.topics.reduce((sum, topic) => sum + topic.verifiedQuestionCount, 0),
  0,
  'pending secondary mappings must not become reviewed inventory',
)

console.log(JSON.stringify({
  status: 'passed',
  routeId,
  verifiedQuestionGroups: inventory.verifiedQuestionGroupCount,
  readyTopics: inventory.topics.filter((topic) => topic.ready).length,
}))
