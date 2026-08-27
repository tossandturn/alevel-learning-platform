import assert from 'node:assert/strict'
import {
  buildSyllabusPracticeSet,
  syllabusTopicsInventory,
  topicMembershipIdsForQuestion,
} from '../src/lib/syllabusPractice.js'
import { studyQuestionBank } from '../src/data/questionBank.js'

function question({ routeId, component, knowledgeGroupId, topicTags = [], skillTags = [], syllabusMapping = null }) {
  return {
    routeId,
    subjectCode: '9709',
    sourceRef: { component },
    knowledgeGroupId,
    topicTags,
    skillTags,
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
  ['9709-p1-topic-02', '9709-p1-topic-07'],
  'AS Paper 1 evidence must map to the matching official Function and Differentiation chapters',
)

assert.deepEqual(
  topicMembershipIdsForQuestion(question({
    routeId: 'cie-9709-as-p1-p2',
    component: 2,
    knowledgeGroupId: 'math-9709-pure',
    topicTags: ['math-9709-pure', 'integration'],
  })),
  ['9709-p2-topic-05'],
  'AS Paper 2 integration evidence must map to official chapter 2.5',
)

assert.deepEqual(
  topicMembershipIdsForQuestion(question({
    routeId: 'cie-9709-as-p1-p4',
    component: 4,
    knowledgeGroupId: 'math-9709-mechanics',
    topicTags: ['math-9709-mechanics', 'kinematics'],
  })),
  ['9709-m1-topic-02'],
  'AS Mechanics kinematics evidence must map to official chapter 4.2',
)

assert.deepEqual(
  topicMembershipIdsForQuestion(question({
    routeId: 'cie-9709-a2-after-p1-p5-p3-p4',
    component: 4,
    knowledgeGroupId: 'math-9709-mechanics',
    topicTags: ['math-9709-mechanics', 'forces and equilibrium'],
  })),
  ['9709-m1-topic-01'],
  'A2 Paper 4 equilibrium evidence must use the shared official Mechanics chapter 4.1',
)

assert.deepEqual(
  topicMembershipIdsForQuestion(question({
    routeId: 'cie-9709-a2-after-p1-p5-p3-p6',
    component: 6,
    knowledgeGroupId: 'math-9709-statistics',
    topicTags: ['math-9709-statistics', 'sampling', 'hypothesis testing'],
    syllabusMapping: {
      primaryTopicId: '9709-s2-topic-05',
      secondaryTopicIds: ['9709-s2-topic-04'],
      reviewStatus: 'reviewed',
    },
  })),
  ['9709-s2-topic-05', '9709-s2-topic-04'],
  'an explicitly reviewed cross-topic mapping must retain both valid Topic memberships',
)

assert.deepEqual(
  topicMembershipIdsForQuestion(question({
    routeId: 'cie-9709-as-p1-p2',
    component: 1,
    knowledgeGroupId: 'math-9709-statistics@cie-9709-as-p1-p2',
    topicTags: ['math-9709-statistics', 'probability'],
    syllabusMapping: { primaryTopicId: '9709-p2-topic-01', reviewStatus: 'reviewed' },
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
    primaryTopicId: '9709-p1-topic-02',
    secondaryTopicIds: ['9709-p1-topic-03'],
    reviewStatus: 'pending',
  },
}
const dualMappedBank = [dualMappedP1]
const dualInventory = syllabusTopicsInventory({
  routeId: 'cie-9709-as-p1-p2',
  questionBank: dualMappedBank,
})
assert.equal(dualInventory.topics.find((topic) => topic.id === '9709-p1-topic-02')?.studyQuestionCount, 1)
assert.equal(dualInventory.topics.find((topic) => topic.id === '9709-p1-topic-03')?.studyQuestionCount, 1)
const mixedSet = buildSyllabusPracticeSet({
  routeId: 'cie-9709-as-p1-p2',
  syllabusTopicIds: ['9709-p1-topic-02', '9709-p1-topic-03'],
  components: [1],
  questionCount: 2,
  questionBank: dualMappedBank,
  includeStudyOnly: true,
  seed: 9709,
})
assert.equal(mixedSet.questionCount, 1, 'a group mapped to two topics must not be duplicated in one mixed-topic set')
assert.equal(new Set(mixedSet.questionGroups.map((group) => group.id)).size, mixedSet.questionCount)

console.log(JSON.stringify({ status: 'passed', cases: 8, multiTopic: { inventoryCounts: [1, 1], mixedSetCount: mixedSet.questionCount } }))
