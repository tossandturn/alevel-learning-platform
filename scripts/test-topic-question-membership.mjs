import assert from 'node:assert/strict'

import { questionMatchesSyllabusTopicMembership } from '../src/lib/syllabusPracticeRoutes.js'

const a2Route = 'cie-9702-a2-physics'
const a2Primary = 'physics-9702-topic-13'
const a2Secondary = 'physics-9702-topic-12'
const a2Unrelated = 'physics-9702-topic-15'

const crossTopicQuestion = {
  routeId: a2Route,
  knowledgeGroupId: a2Primary,
  topicId: a2Primary,
  syllabusMapping: {
    primaryTopicId: a2Primary,
    secondaryTopicIds: [a2Secondary],
    topicIds: [a2Primary, a2Secondary],
  },
}

assert.equal(
  questionMatchesSyllabusTopicMembership(a2Route, crossTopicQuestion, a2Secondary),
  true,
  'Topic Detail must include a question through its official secondary topic mapping',
)
assert.equal(
  questionMatchesSyllabusTopicMembership(a2Route, crossTopicQuestion, a2Unrelated),
  false,
  'Topic Detail must not include a question under an unrelated official topic',
)
assert.equal(
  questionMatchesSyllabusTopicMembership(a2Route, { routeId: a2Route, knowledgeGroupId: a2Primary }, a2Primary),
  true,
  'legacy primary-topic records must retain their existing matching behavior',
)

assert.equal(
  questionMatchesSyllabusTopicMembership('cie-9709-as-p1-p4', {
    routeId: 'cie-9709-as-p1-p4',
    syllabusMapping: { topicIds: ['9709-m1-topic-01'] },
  }, '9709-as-topic-03'),
  true,
  'legacy 9709 chapter scopes must match mapped component topics',
)

console.log(JSON.stringify({ status: 'passed', scope: 'topic-question-membership' }))
