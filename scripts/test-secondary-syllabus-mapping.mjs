import assert from 'node:assert/strict'

import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { buildCoachPractice, coachPracticeOptions } from '../src/lib/verifiedPracticeCatalog.js'

const routeId = 'cie-9702-as-physics'
const inventory = syllabusTopicsInventory({ routeId, questionBank: unifiedQuestionBank })
const count = (topicId) => inventory.topics.find((topic) => topic.id === topicId)?.verifiedQuestionCount

assert.equal(inventory.verifiedQuestionGroupCount, 120, 'secondary mappings must not duplicate route-level reviewed groups')
assert.equal(count('physics-9702-topic-03'), 13, 'reviewed secondary mechanics mappings must count toward Dynamics')
assert.equal(count('physics-9702-topic-04'), 15, 'reviewed secondary pressure mappings must count toward Forces, density and pressure')
assert.equal(count('physics-9702-topic-05'), 18, 'reviewed secondary energy mappings must count toward Work, energy and power')
assert.equal(count('physics-9702-topic-06'), 12, 'reviewed deformation mappings must close the final 9702 AS topic floor')
assert.equal(count('physics-9702-topic-09'), 15, 'reviewed secondary circuit mappings must count toward Electricity')
assert.equal(count('physics-9702-topic-10'), 12, 'reviewed secondary circuit mappings must count toward D.C. circuits')
assert.equal(inventory.topics.filter((topic) => topic.ready).length, 11, 'reviewed mappings should raise the ready-topic count to every official 9702 AS topic')
assert.equal(inventory.topics.filter((topic) => topic.ctaPolicy === 'start').length, 11)

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
  knowledgeGroupId: 'physics-9702-topic-01',
  questionCount: 10,
})
assert.ok(
  secondaryTopicPractice.parts.some((part) => part.sourceQuestionId === 'cie-9702-9702_s25_qp_22:q1'),
  'a reviewed secondary membership must be selectable through the AI Practice catalog as well as the server Topic Drill',
)

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
