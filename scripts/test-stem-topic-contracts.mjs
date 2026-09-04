import assert from 'node:assert/strict'

import { courseRoutes, formatRouteComponents } from '../src/data/routeRegistry.js'
import { studyQuestionBank } from '../src/data/questionBank.js'
import { cambridge9709SyllabusForRoute } from '../src/data/syllabus/cambridge-9709-2026-2027.js'
import { syllabusTopicsInventory, topicMembershipIdsForQuestion } from '../src/lib/syllabusPractice.js'
import {
  canonicalSyllabusTopicIdForRoute,
  syllabusPracticeComponentsForRoute,
  syllabusTopicScopeIdsForRoute,
} from '../src/lib/syllabusPracticeRoutes.js'

const a2Physics = courseRoutes.find((route) => route.routeId === 'cie-9702-a2-physics')
assert.ok(a2Physics, 'A2 Physics route must exist')
assert.deepEqual(a2Physics.paperComponents, [4, 5], 'full A2 Physics paper route must retain P4 and experimental P5')
assert.equal(formatRouteComponents(a2Physics.paperComponents, a2Physics), 'P4 + P5')
assert.deepEqual(syllabusPracticeComponentsForRoute(a2Physics.routeId), [4], 'A2 Physics Topic Drill must remain P4-only')

const a2PhysicsInventory = syllabusTopicsInventory({ routeId: a2Physics.routeId, questionBank: [] })
assert.deepEqual(
  a2PhysicsInventory.assessmentComponents.map((item) => item.component),
  [4],
  'Topic Drill inventory must not advertise experimental P5',
)

const official9709Routes = courseRoutes.filter((route) => route.subjectCode === '9709')
assert.equal(official9709Routes.length, 6)
for (const route of official9709Routes) {
  assert.ok(route.syllabus.topics.length > 0, `${route.routeId} must expose official chapters`)
  assert.ok(route.syllabus.topics.every((topic) => topic.points.length > 0), `${route.routeId} chapters must expose official outcomes`)
}
const allOfficial9709Topics = new Map(official9709Routes.flatMap((route) => route.syllabus.topics.map((topic) => [topic.id, topic])))
assert.equal(allOfficial9709Topics.size, 38, '9709 must retain all 38 official syllabus chapters')
assert.equal(
  [...allOfficial9709Topics.values()].reduce((sum, topic) => sum + topic.points.length, 0),
  153,
  '9709 chapters must expose all 153 official outcome bullets rather than placeholder chapter labels',
)
assert.match(allOfficial9709Topics.get('9709-p1-topic-01').points[0].officialText, /completing the square/i)
assert.match(allOfficial9709Topics.get('9709-m1-topic-03').points[0].officialText, /linear momentum/i)
assert.match(allOfficial9709Topics.get('9709-s2-topic-05').points[0].officialText, /hypothesis test/i)

const complete9709 = cambridge9709SyllabusForRoute('all-9709-components', [1, 2, 3, 4, 5, 6])
assert.equal(complete9709.points.length, 153, 'the complete 9709 source must expose all official outcome bullets')
const point = (sectionCode, outcomeNumber) => complete9709.points.find((item) => item.sectionCode === sectionCode && item.outcomeNumber === outcomeNumber)
assert.match(point('2.1', 1).officialText, /\|a\| = \|b\|.*a\^2 = b\^2/i, '2.1 must preserve the official modulus relations')
assert.match(point('3.5', 1).officialText, /partial fractions|1\/\(x\^2 \+ a\^2\)/i, '3.5 must preserve the exact integration scope')
assert.match(point('6.2', 1).officialText, /Var\(aX \+ bY\).*independent X and Y/i, '6.2 must preserve all stated linear-combination results')
assert.ok(point('1.5', 5).officialNotes.some((note) => /general forms of solution are not included/i.test(note)), '1.5 must retain its explicit exclusion')
assert.ok(point('3.7', 5).officialNotes.some((note) => /shortest distance between two skew lines.*not required/i.test(note)), '3.7 must retain its skew-line limitation')
assert.ok(point('5.5', 3).officialNotes.some((note) => /np > 5.*nq > 5/i.test(note)), '5.5 must retain the normal-approximation conditions')
assert.ok(complete9709.componentScope.find((item) => item.component === 4).notes.some((note) => /mainly numerical/i.test(note)), 'Mechanics scope notes must be exposed')
assert.match(complete9709.componentScope.find((item) => item.component === 6).notes.join(' '), /Paper 5.*Paper 3/i, 'S2 prerequisite scope must be exposed')

assert.equal(
  canonicalSyllabusTopicIdForRoute('cie-9709-as-p1-p2', 'math-9709-pure'),
  'math-9709-pure',
  'a broad legacy domain must not be rewritten as one arbitrary official chapter',
)
assert.deepEqual(
  syllabusTopicScopeIdsForRoute('cie-9709-as-p1-p2', '9709-as-topic-02'),
  Array.from({ length: 6 }, (_, index) => `9709-p2-topic-${String(index + 1).padStart(2, '0')}`),
  'a persisted legacy P2 bucket must expand to the complete official P2 chapter scope',
)
assert.deepEqual(
  syllabusTopicScopeIdsForRoute('cie-9709-a2-after-p1-p5-p3-p6', 'math-9709-statistics'),
  Array.from({ length: 5 }, (_, index) => `9709-s2-topic-${String(index + 1).padStart(2, '0')}`),
  'a persisted legacy statistics selection must expand only to the route S2 scope',
)

const unmappedP1 = {
  subjectCode: '9709',
  routeId: 'cie-9709-as-p1-p2',
  sourceRef: { component: 1 },
  knowledgeGroupId: 'math-9709-pure',
  topicTags: ['math-9709-pure', 'unrelated label'],
}
assert.deepEqual(
  topicMembershipIdsForQuestion(unmappedP1),
  [],
  'an unclassified 9709 question must remain unmapped instead of falling back to the first chapter',
)

const representativeMappings = [
  ['cie-9709-as-p1-p2', 1, ['quadratic'], '9709-p1-topic-01'],
  ['cie-9709-as-p1-p2', 2, ['numerical solution'], '9709-p2-topic-06'],
  ['cie-9709-as-p1-p4', 4, ['momentum'], '9709-m1-topic-03'],
  ['cie-9709-as-p1-p5', 5, ['normal distribution'], '9709-s1-topic-05'],
  ['cie-9709-a2-after-p1-p5-p3-p4', 3, ['complex numbers'], '9709-p3-topic-09'],
  ['cie-9709-a2-after-p1-p5-p3-p6', 6, ['hypothesis tests'], '9709-s2-topic-05'],
]
for (const [routeId, component, topicTags, expectedTopicId] of representativeMappings) {
  assert.deepEqual(
    topicMembershipIdsForQuestion({
      subjectCode: '9709',
      routeId,
      sourceRef: { component },
      knowledgeGroupId: `math-9709-${component === 4 ? 'mechanics' : [5, 6].includes(component) ? 'statistics' : 'pure'}`,
      topicTags,
    }),
    [expectedTopicId],
    `${routeId} component ${component} must map to its official chapter`,
  )
}

assert.deepEqual(
  topicMembershipIdsForQuestion({
    subjectCode: '9709',
    routeId: 'cie-9709-as-p1-p4',
    sourceRef: { component: 4 },
    knowledgeGroupId: 'math-9709-mechanics',
    topicTags: ['math-9709-mechanics'],
    prompt: 'A particle moves in a straight line. Its velocity is a function of time.',
  }),
  ['9709-m1-topic-02'],
  'a source prompt with explicit straight-line motion evidence must map to official M1 chapter 4.2',
)
assert.deepEqual(
  topicMembershipIdsForQuestion({
    subjectCode: '9709',
    routeId: 'cie-9709-a2-after-p1-p5-p3-p6',
    sourceRef: { component: 6 },
    knowledgeGroupId: 'math-9709-statistics',
    topicTags: ['math-9709-statistics', 'discrete distributions'],
    prompt: 'The random variable X has the distribution Po(1.5).',
  }),
  ['9709-s2-topic-01'],
  'official Po(lambda) notation in the source prompt must map to chapter 6.1',
)

const sourceBacked9709 = studyQuestionBank.find((question) => question.subjectCode === '9709')
assert.ok(sourceBacked9709, 'the imported 9709 regression needs source-backed data')
const inventory = syllabusTopicsInventory({ routeId: sourceBacked9709.routeId, questionBank: [sourceBacked9709] })
const indexedTopicMembershipCount = inventory.topics.reduce((sum, topic) => sum + topic.indexedQuestionCount, 0)
assert.ok(inventory.indexedQuestionGroupCount <= indexedTopicMembershipCount, 'topic membership counts may repeat a multi-topic question')
assert.ok(inventory.topics.every((topic) => topic.indexedQuestionCount <= inventory.indexedQuestionGroupCount))
assert.equal(inventory.availableQuestionGroupCount, 1, 'top-level availability must count a multi-topic source question only once')

console.log(JSON.stringify({ status: 'passed', scope: 'stem-topic-contracts', routes: official9709Routes.length }))
