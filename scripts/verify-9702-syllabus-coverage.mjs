import assert from 'node:assert/strict'
import { CAMBRIDGE_9702_AS_SYLLABUS } from '../src/data/syllabus/cambridge-9702-as-2025-2027.js'
import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { MIN_VERIFIED_GROUPS_FOR_PRACTICE } from '../src/lib/practiceConstants.js'

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
  assert.equal(topic.ctaPolicy, 'hidden', `${topic.id} must not expose a Topic Drill CTA below the formal readiness floor`)
  assert.deepEqual(topic.availableSetSizes, [], `${topic.id} must not advertise a formal Topic Drill set below the readiness floor`)
}

for (const topic of readyTopics) {
  assert.equal(topic.ready, true, `${topic.id} must be ready at or above the formal readiness floor`)
  assert.equal(topic.ctaPolicy, 'start', `${topic.id} must expose a Topic Drill CTA at or above the formal readiness floor`)
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
  minimumReviewedGroupsPerTopic,
  verifiedQuestionGroupCount: inventory.verifiedQuestionGroupCount,
  formalReadiness: {
    routeReady: inventory.ready,
    readyTopicCount: readyTopics.length,
    underFloorTopicCount: shortTopics.length,
  },
  topics: inventory.topics.map((topic) => ({
    id: topic.id,
    code: topic.code,
    name: topic.name,
    verifiedQuestionCount: topic.verifiedQuestionCount,
    ready: topic.ready,
    ctaPolicy: topic.ctaPolicy,
    availableSetSizes: topic.availableSetSizes,
  })),
}, null, 2))

if (!reportOnly && shortTopics.length > 0) {
  process.exitCode = 1
}
