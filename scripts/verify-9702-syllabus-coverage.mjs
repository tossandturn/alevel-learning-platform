import assert from 'node:assert/strict'
import { CAMBRIDGE_9702_AS_SYLLABUS } from '../src/data/syllabus/cambridge-9702-as-2025-2027.js'
import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'

const routeId = 'cie-9702-as-physics'
const minimumReviewedGroupsPerTopic = 5
const inventory = syllabusTopicsInventory({ routeId, questionBank: unifiedQuestionBank })

assert.equal(inventory.topics.length, 11, '9702 AS coverage gate requires all 11 official syllabus topics')
assert.equal(
  CAMBRIDGE_9702_AS_SYLLABUS.assessmentComponents.find((component) => component.component === 3)?.stage,
  'AS',
  'Paper 3 must remain classified as an AS practical component',
)

const shortTopics = inventory.topics
  .filter((topic) => topic.verifiedQuestionCount < minimumReviewedGroupsPerTopic)
  .map((topic) => ({
    topicId: topic.id,
    code: topic.code,
    name: topic.name,
    verifiedQuestionCount: topic.verifiedQuestionCount,
  }))

assert.deepEqual(
  shortTopics,
  [],
  `9702 AS release coverage requires at least ${minimumReviewedGroupsPerTopic} reviewed QP/MS groups for every official syllabus topic.`,
)

console.log(JSON.stringify({
  status: 'passed',
  routeId,
  syllabusVersion: inventory.syllabusVersion,
  minimumReviewedGroupsPerTopic,
  verifiedQuestionGroupCount: inventory.verifiedQuestionGroupCount,
  topics: inventory.topics.map((topic) => ({
    id: topic.id,
    code: topic.code,
    name: topic.name,
    verifiedQuestionCount: topic.verifiedQuestionCount,
  })),
}, null, 2))
