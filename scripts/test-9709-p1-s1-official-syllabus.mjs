import assert from 'node:assert/strict'
import { courseRoutes, formatRouteComponents } from '../src/data/routeRegistry.js'
import {
  canonicalSyllabusTopicIdForRoute,
  syllabusPracticeComponentsForRoute,
  supportsSyllabusPracticeRoute,
} from '../src/lib/syllabusPracticeRoutes.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { studyQuestionBank } from '../src/data/questionBank.js'

const routeId = 'cie-9709-as-p1-p5'
const route = courseRoutes.find((item) => item.routeId === routeId)

assert.ok(route, '9709 AS P1 + S1 route must exist')
assert.equal(formatRouteComponents(route.paperComponents, route), 'P1 + S1', 'P5 must be labelled as S1 in student-facing AS Mathematics routes')
assert.equal(supportsSyllabusPracticeRoute(routeId), true, 'P1 + S1 must remain available in source-backed Topic Drill')
assert.deepEqual(syllabusPracticeComponentsForRoute(routeId), [1, 5], 'P1 + S1 must use Paper 1 and Paper 5 source components')

const expectedTopicIds = [
  '9709-p1-topic-01',
  '9709-p1-topic-02',
  '9709-p1-topic-03',
  '9709-p1-topic-04',
  '9709-p1-topic-05',
  '9709-p1-topic-06',
  '9709-p1-topic-07',
  '9709-p1-topic-08',
  '9709-s1-topic-01',
  '9709-s1-topic-02',
  '9709-s1-topic-03',
  '9709-s1-topic-04',
  '9709-s1-topic-05',
]
const expectedTopicNames = [
  'Quadratics',
  'Functions',
  'Coordinate geometry',
  'Circular measure',
  'Trigonometry',
  'Series',
  'Differentiation',
  'Integration',
  'Representation of data',
  'Permutations and combinations',
  'Probability',
  'Discrete random variables',
  'The normal distribution',
]

assert.deepEqual(route.syllabus.topics.map((topic) => topic.id), expectedTopicIds, 'P1 + S1 route must expose official syllabus chapters, not paper-component buckets')
assert.deepEqual(route.syllabus.topics.map((topic) => topic.title.replace(/^\d+(?:\.\d+)?\s+/, '')), expectedTopicNames)
assert.equal(canonicalSyllabusTopicIdForRoute(routeId, 'math-9709-pure'), '9709-p1-topic-01', 'legacy pure records must fail into an official P1 chapter')
assert.equal(canonicalSyllabusTopicIdForRoute(routeId, 'math-9709-statistics'), '9709-s1-topic-01', 'legacy statistics records must fail into an official S1 chapter')

const inventory = syllabusTopicsInventory({ routeId, questionBank: studyQuestionBank })
assert.equal(inventory.assessmentComponents.find((item) => item.component === 5)?.label, 'Paper 5 Probability & Statistics 1')
assert.deepEqual(inventory.topics.map((topic) => topic.id), expectedTopicIds, 'API inventory must use the same official P1/S1 chapter IDs')
assert.ok(inventory.topics.some((topic) => topic.id.startsWith('9709-s1-topic-')), 'S1 chapters must be visible in the route inventory')

console.log(JSON.stringify({
  status: 'passed',
  routeId,
  componentLabel: formatRouteComponents(route.paperComponents, route),
  topics: inventory.topics.length,
}))
