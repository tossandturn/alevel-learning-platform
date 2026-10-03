import assert from 'node:assert/strict'
import { CAMBRIDGE_9702_AS_SYLLABUS } from '../src/data/syllabus/cambridge-9702-as-2025-2027.js'
import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import {
  MIN_QUESTION_GROUPS_PER_TEST,
  MIN_VERIFIED_GROUPS_FOR_PRACTICE,
  topicPracticeEligibility,
} from '../src/lib/practiceConstants.js'

const routeId = 'cie-9702-as-physics'
const minimumReviewedGroupsPerTopic = MIN_VERIFIED_GROUPS_FOR_PRACTICE
const reportOnly = process.argv.includes('--report-only')
const inventory = syllabusTopicsInventory({ routeId, questionBank: unifiedQuestionBank })

assert.equal(inventory.topics.length, 11, '9702 AS coverage gate requires all 11 official syllabus topics')
assert.equal(
  CAMBRIDGE_9702_AS_SYLLABUS.assessmentComponents.find((component) => component.component === 3)?.stage,
  'AS',
  'Paper 3 must remain classified as an AS practical component',
)

const shortTopics = inventory.topics
  .filter((topic) => topic.verifiedQuestionCount < minimumReviewedGroupsPerTopic)
const readyTopics = inventory.topics
  .filter((topic) => topic.verifiedQuestionCount >= minimumReviewedGroupsPerTopic)

for (const topic of shortTopics) {
  assert.equal(topic.ready, false, `${topic.id} must remain unavailable below the formal readiness floor`)
  const policy = topicPracticeEligibility(topic)
  assert.equal(topic.studyReady, policy.studyReady, `${topic.id} study readiness must follow the shared eligibility policy`)
  assert.equal(topic.apiStartable, policy.ready || policy.studyReady, `${topic.id} API readiness must follow the shared eligibility policy`)
  assert.equal(topic.ctaPolicy, policy.ctaPolicy, `${topic.id} CTA must distinguish study-only from formal readiness`)
  assert.deepEqual(topic.availableSetSizes, policy.availableSetSizes, `${topic.id} set sizes must follow actual source availability`)
}

for (const topic of readyTopics) {
  const policy = topicPracticeEligibility(topic)
  assert.equal(topic.ready, true, `${topic.id} must be ready at or above the formal readiness floor`)
  assert.equal(topic.studyReady, false, `${topic.id} must not be labelled study-only once formally ready`)
  assert.equal(topic.apiStartable, true, `${topic.id} must remain API-startable once formally ready`)
  assert.equal(topic.ctaPolicy, policy.ctaPolicy, `${topic.id} formal CTA must follow the shared eligibility policy`)
  assert.deepEqual(topic.availableSetSizes, policy.availableSetSizes, `${topic.id} formal set sizes must follow actual source availability`)
}

assert.equal(
  inventory.ready,
  shortTopics.length === 0,
  'route readiness must remain false until every official topic reaches the formal readiness floor',
)

console.log(JSON.stringify({
  status: shortTopics.length === 0 ? 'ready' : 'partial',
  routeId,
  syllabusVersion: inventory.syllabusVersion,
  minimumQuestionGroupsPerTest: MIN_QUESTION_GROUPS_PER_TEST,
  minimumReviewedGroupsPerTopic,
  verifiedQuestionGroupCount: inventory.verifiedQuestionGroupCount,
  formalReadiness: {
    routeReady: inventory.ready,
    readyTopicCount: readyTopics.length,
    underFloorTopicCount: shortTopics.length,
  },
  studyReadiness: {
    startableTopicCount: inventory.topics.filter((topic) => topic.apiStartable).length,
    studyOnlyTopicCount: inventory.topics.filter((topic) => topic.studyReady).length,
    belowStudyFloorTopicCount: inventory.topics.filter((topic) => !topic.apiStartable).length,
  },
  topics: inventory.topics.map((topic) => ({
    id: topic.id,
    code: topic.code,
    name: topic.name,
    verifiedQuestionCount: topic.verifiedQuestionCount,
    availableQuestionCount: topic.availableQuestionCount,
    ready: topic.ready,
    studyReady: topic.studyReady,
    apiStartable: topic.apiStartable,
    ctaPolicy: topic.ctaPolicy,
    availableSetSizes: topic.availableSetSizes,
  })),
}, null, 2))

if (!reportOnly && shortTopics.length > 0) {
  process.exitCode = 1
}
