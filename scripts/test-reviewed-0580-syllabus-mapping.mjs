import assert from 'node:assert/strict'

import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { buildSyllabusPracticeSet, syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'

const routeId = 'cie-0580-igcse-mathematics'
const paperId = 'cie-0580-0580_m25_qp_12'
const reviewedPaperQuestions = unifiedQuestionBank.filter((question) => (
  question.routeId === routeId
  && question.sourceRef?.paperId === paperId
  && question.answerBinding?.verificationStatus === 'reviewed'
))

assert.equal(reviewedPaperQuestions.length, 26, 'the reviewed 0580 paper must retain all 26 whole-question groups')

const inventory = syllabusTopicsInventory({
  routeId,
  questionBank: unifiedQuestionBank,
  includeStudyOnly: false,
})

assert.equal(inventory.verifiedQuestionGroupCount, 26, 'reviewed 0580 groups need reviewed mappings to the current official syllabus')
assert.equal(inventory.unmappedQuestionGroupCount, 0, 'every reviewed 0580 group must map to at least one official syllabus topic')

const numberTopic = inventory.topics.find((topic) => topic.id === '0580-igcse-topic-01')
assert.ok(numberTopic, 'the official Number topic must exist')
assert.ok(numberTopic.verifiedQuestionCount >= 12, 'the reviewed Number inventory must clear the two-test production readiness threshold')
assert.equal(numberTopic.ready, true)

const practiceSet = buildSyllabusPracticeSet({
  routeId,
  syllabusTopicIds: [numberTopic.id],
  questionCount: 6,
  components: [1],
  seed: 20260828,
  questionBank: unifiedQuestionBank,
  includeStudyOnly: false,
})

assert.equal(practiceSet.questionCount, 6, 'a ready topic must start a six-question test')
assert.equal(new Set(practiceSet.questionGroups.map((question) => question.id)).size, 6, 'one question means one distinct whole-question group')
assert.ok(practiceSet.questionGroups.every((question) => question.sourceRef?.paperId === paperId))

console.log(JSON.stringify({
  status: 'passed',
  routeId,
  reviewedQuestionGroups: inventory.verifiedQuestionGroupCount,
  numberQuestionGroups: numberTopic.verifiedQuestionCount,
  practiceQuestionGroups: practiceSet.questionCount,
}))
