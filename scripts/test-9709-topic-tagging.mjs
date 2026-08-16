import assert from 'node:assert/strict'
import {
  buildSyllabusPracticeSet,
  syllabusTopicsInventory,
  topicMembershipIdsForQuestion,
} from '../src/lib/syllabusPractice.js'
import { studyQuestionBank } from '../src/data/questionBank.js'

function question({ routeId, component, knowledgeGroupId, topicTags = [], syllabusMapping = null }) {
  return {
    routeId,
    subjectCode: '9709',
    sourceRef: { component },
    knowledgeGroupId,
    topicTags,
    syllabusMapping,
  }
}

assert.deepEqual(
  topicMembershipIdsForQuestion(question({
    routeId: 'cie-9709-as-p1-p2',
    component: 1,
    knowledgeGroupId: 'math-9709-pure',
    topicTags: ['math-9709-pure', 'algebra and functions', 'differentiation'],
  })),
  ['9709-as-topic-01'],
  'AS Paper 1 pure questions must map to Pure Mathematics 1',
)

assert.deepEqual(
  topicMembershipIdsForQuestion(question({
    routeId: 'cie-9709-as-p1-p2',
    component: 2,
    knowledgeGroupId: 'math-9709-pure',
    topicTags: ['math-9709-pure', 'integration'],
  })),
  ['9709-as-topic-02'],
  'AS Paper 2 pure questions must map to the AS-only Pure Mathematics 2 topic',
)

assert.deepEqual(
  topicMembershipIdsForQuestion(question({
    routeId: 'cie-9709-as-p1-p4',
    component: 4,
    knowledgeGroupId: 'math-9709-mechanics',
    topicTags: ['math-9709-mechanics', 'kinematics'],
  })),
  ['9709-as-topic-03'],
  'AS Mechanics questions must use the Mechanics topic even when the skill tag is narrower',
)

assert.deepEqual(
  topicMembershipIdsForQuestion(question({
    routeId: 'cie-9709-a2-after-p1-p5-p3-p4',
    component: 4,
    knowledgeGroupId: 'math-9709-mechanics',
    topicTags: ['math-9709-mechanics', 'forces and equilibrium'],
  })),
  ['9709-a2-topic-02'],
  'A2 Paper 4 questions must map to A2 Mechanics, never AS Mechanics',
)

assert.deepEqual(
  topicMembershipIdsForQuestion(question({
    routeId: 'cie-9709-a2-after-p1-p5-p3-p6',
    component: 6,
    knowledgeGroupId: 'math-9709-statistics',
    topicTags: ['math-9709-statistics', 'normal distribution', 'probability'],
    syllabusMapping: {
      primaryTopicId: '9709-a2-topic-04',
      secondaryTopicIds: ['9709-a2-topic-03'],
    },
  })),
  ['9709-a2-topic-04', '9709-a2-topic-03'],
  'an explicitly reviewed cross-topic mapping must retain both valid Topic memberships',
)

assert.deepEqual(
  topicMembershipIdsForQuestion(question({
    routeId: 'cie-9709-as-p1-p2',
    component: 1,
    knowledgeGroupId: 'math-9709-statistics@cie-9709-as-p1-p2',
    topicTags: ['math-9709-statistics', 'probability'],
    syllabusMapping: { primaryTopicId: '9709-a2-topic-04' },
  })),
  [],
  'a cross-domain tag on a Pure paper must not cross the component boundary',
)

const sourceBackedP1 = studyQuestionBank.find((item) => (
  item.subjectCode === '9709'
  && item.routeId === 'cie-9709-as-p1-p2'
  && Number(item.sourceRef?.component) === 1
))
assert.ok(sourceBackedP1, 'the focused 9709 regression needs one source-backed P1 group')
const dualMappedP1 = {
  ...sourceBackedP1,
  syllabusMapping: {
    ...(sourceBackedP1.syllabusMapping || {}),
    primaryTopicId: '9709-as-topic-01',
    secondaryTopicIds: ['9709-as-topic-02'],
    reviewStatus: 'pending',
  },
}
const dualMappedBank = [dualMappedP1]
const dualInventory = syllabusTopicsInventory({
  routeId: 'cie-9709-as-p1-p2',
  questionBank: dualMappedBank,
})
assert.equal(dualInventory.topics.find((topic) => topic.id === '9709-as-topic-01')?.studyQuestionCount, 1)
assert.equal(dualInventory.topics.find((topic) => topic.id === '9709-as-topic-02')?.studyQuestionCount, 1)
const mixedSet = buildSyllabusPracticeSet({
  routeId: 'cie-9709-as-p1-p2',
  syllabusTopicIds: ['9709-as-topic-01', '9709-as-topic-02'],
  components: [1],
  questionCount: 2,
  questionBank: dualMappedBank,
  includeStudyOnly: true,
  seed: 9709,
})
assert.equal(mixedSet.questionCount, 1, 'a group mapped to two topics must not be duplicated in one mixed-topic set')
assert.equal(new Set(mixedSet.questionGroups.map((group) => group.id)).size, mixedSet.questionCount)

console.log(JSON.stringify({ status: 'passed', cases: 8, multiTopic: { inventoryCounts: [1, 1], mixedSetCount: mixedSet.questionCount } }))
