import assert from 'node:assert/strict'

import { studyQuestionBank } from '../src/data/questionBank.js'
import { filterQuestionGroupsByPracticeInventory } from '../src/lib/practicePresentation.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'

const inventory = syllabusTopicsInventory({
  routeId: 'cie-9702-as-physics',
  questionBank: studyQuestionBank,
  includeStudyOnly: false,
})
for (const topic of inventory.topics) {
  for (const [component, counts] of Object.entries(topic.componentCounts || {})) {
    assert.equal(
      counts.studyQuestionCount,
      0,
      `${topic.id} component ${component} must hide study-only records in production`,
    )
    assert.equal(
      counts.availableQuestionCount,
      counts.verifiedQuestionCount,
      `${topic.id} component ${component} availability must match its reviewed IDs`,
    )
  }
}

const topic = {
  id: 'physics-9702-topic-04',
  questionIdsByComponent: {
    2: {
      indexedQuestionIds: ['cie-9702-9702_s25_qp_22:q1', 'cie-9702-9702_s25_qp_22:q2'],
      verifiedQuestionIds: ['cie-9702-9702_s25_qp_22:q2'],
      studyQuestionIds: [],
      pendingReviewQuestionIds: ['cie-9702-9702_s25_qp_22:q1'],
    },
  },
}

const projected = filterQuestionGroupsByPracticeInventory([
  {
    sourceQuestionId: 'cie-9702-9702_s25_qp_22:q1',
    paperComponent: 2,
    studyOnly: true,
  },
  {
    sourceQuestionId: 'cie-9702-9702_s25_qp_22:q2',
    paperComponent: 2,
    studyOnly: false,
  },
], [topic], [2])

assert.deepEqual(
  projected.map((question) => question.sourceQuestionId),
  ['cie-9702-9702_s25_qp_22:q2'],
  'Topic Detail must list only the same production-eligible IDs that inventory and start accept',
)

const studyOnlyTopic = {
  ...topic,
  questionIdsByComponent: {
    2: {
      ...topic.questionIdsByComponent[2],
      studyQuestionIds: ['cie-9702-9702_s25_qp_22:q1'],
    },
  },
}
const studyOnlyProjected = filterQuestionGroupsByPracticeInventory([
  {
    sourceQuestionId: 'cie-9702-9702_s25_qp_22:q1',
    paperComponent: 2,
    studyOnly: true,
  },
  {
    sourceQuestionId: 'cie-9702-9702_s25_qp_22:q2',
    paperComponent: 2,
    studyOnly: false,
  },
], [studyOnlyTopic], [2])

assert.deepEqual(
  studyOnlyProjected.map((question) => question.sourceQuestionId),
  ['cie-9702-9702_s25_qp_22:q1', 'cie-9702-9702_s25_qp_22:q2'],
  'an explicitly server-authorized study-only inventory must keep list and start aligned outside production',
)

console.log('Topic practice eligibility regression passed.')
