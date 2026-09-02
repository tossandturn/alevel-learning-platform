import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { courseRoutes } from '../src/data/routeRegistry.js'
import { MIN_QUESTION_GROUPS_PER_TEST, MIN_VERIFIED_GROUPS_FOR_PRACTICE } from '../src/lib/practiceConstants.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { SYLLABUS_PRACTICE_ROUTE_IDS } from '../src/lib/syllabusPracticeRoutes.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = execFileSync(process.execPath, ['scripts/question-inventory-matrix.mjs'], {
  cwd: projectRoot,
  encoding: 'utf8',
})
const matrix = JSON.parse(output)

assert.equal(matrix.schemaVersion, 'stem-question-inventory-v1')
for (const routeId of SYLLABUS_PRACTICE_ROUTE_IDS) {
  const route = courseRoutes.find((candidate) => candidate.routeId === routeId)
  const matrixRoute = matrix.routes.find((candidate) => candidate.routeId === routeId)
  assert.ok(route && matrixRoute, `${routeId} must be represented in the inventory matrix`)
  const officialTopicIds = route.syllabus.topics.map((topic) => topic.id).sort()
  const matrixTopicIds = matrixRoute.topicMatrix.map((topic) => topic.topicId).sort()
  assert.deepEqual(matrixTopicIds, officialTopicIds, `${routeId} inventory must include every official syllabus topic exactly once`)
}
assert.equal(matrix.totals.catalogItems, 10689)
assert.ok(matrix.totals.indexedQuestionGroups > 0, 'the imported index must not be empty')
assert.equal(matrix.totals.effectiveFileQuarantined, matrix.totals.indexQuarantined + matrix.totals.sourceAdditionalQuarantined, 'file quarantine totals must be decomposable without overlap')
assert.equal(matrix.totals.effectivePracticeQuarantinedQuestionGroups + matrix.totals.effectivePracticeAvailableQuestionGroups, matrix.totals.indexedQuestionGroups, 'practice gate must partition the imported index')
assert.equal(matrix.totals.semanticVerifiedQuestionGroups, matrix.totals.effectivePracticeAvailableQuestionGroups, 'runtime practice must use the same semantic gate as the manifest')
assert.ok(matrix.totals.effectivePracticeAvailableQuestionGroups >= 236, 'reviewed practice inventory must retain the six newly reviewed groups')
assert.equal(matrix.totals.minimumGroupsForReadyRouteOrTopic, MIN_VERIFIED_GROUPS_FOR_PRACTICE)

const cambridge0580 = matrix.routes.find((route) => route.routeId === 'cie-0580-igcse-mathematics')
assert.ok(cambridge0580, '0580 route must be present in the inventory matrix')
assert.equal(cambridge0580.practiceAvailableQuestionGroups, 26)
assert.equal(cambridge0580.ready, false)
assert.equal(cambridge0580.ctaPolicy, 'start-study')
assert.equal(cambridge0580.topicMatrix.find((topic) => topic.topicId === '0580-igcse-topic-01')?.practiceAvailableQuestionGroups, 13)
assert.equal(cambridge0580.topicMatrix.find((topic) => topic.topicId === '0580-igcse-topic-01')?.ctaPolicy, 'start')
assert.ok(cambridge0580.topicMatrix
  .filter((topic) => topic.practiceAvailableQuestionGroups > 0 && topic.practiceAvailableQuestionGroups < MIN_VERIFIED_GROUPS_FOR_PRACTICE)
  .every((topic) => topic.ctaPolicy === (topic.practiceAvailableQuestionGroups >= MIN_QUESTION_GROUPS_PER_TEST ? 'start-study' : 'hidden') && topic.ready === false))

const cambridge9702 = matrix.routes.find((route) => route.routeId === 'cie-9702-as-physics')
assert.ok(cambridge9702, '9702 AS Physics route must be present in the inventory matrix')
assert.equal(cambridge9702.practiceAvailableQuestionGroups, 118)
assert.equal(cambridge9702.semanticVerifiedQuestionGroups, 118)
assert.equal(cambridge9702.ready, false, '9702 AS must remain partial until every official topic reaches the formal readiness floor')
assert.equal(cambridge9702.ctaPolicy, 'start-study', 'a partial 9702 inventory may expose its qualifying topic without claiming route readiness')
assert.equal(cambridge9702.readyTopics, 10, 'reviewed mappings must count toward every qualifying 9702 topic')
assert.equal(cambridge9702.topicMatrix.length, 11)
const underFloor9702Topics = cambridge9702.topicMatrix
  .filter((topic) => topic.practiceAvailableQuestionGroups < MIN_VERIFIED_GROUPS_FOR_PRACTICE)
assert.equal(underFloor9702Topics.length, 1)
assert.ok(
  underFloor9702Topics.every((topic) => (
    topic.practiceAvailableQuestionGroups < MIN_VERIFIED_GROUPS_FOR_PRACTICE
    && topic.ready === false
    && topic.ctaPolicy === 'hidden'
  )),
  'each under-floor 9702 topic must remain hidden below the formal readiness floor',
)
const wavesTopic = cambridge9702.topicMatrix.find((topic) => topic.topicId === 'physics-9702-topic-07')
assert.ok(wavesTopic, 'the Waves topic must remain in the official 9702 inventory')
assert.equal(wavesTopic.practiceAvailableQuestionGroups, 18, 'reviewed secondary mappings must be counted once in the Waves topic')
assert.equal(wavesTopic.ready, true)
assert.equal(wavesTopic.ctaPolicy, 'start')
assert.equal(cambridge9702.topicMatrix.filter((topic) => topic.ctaPolicy === 'start').length, 10)
assert.equal(cambridge9702.topicMatrix.filter((topic) => topic.ctaPolicy === 'start-study').length, 0)

const audit = JSON.parse(execFileSync(process.execPath, ['scripts/audit-question-bank.mjs'], {
  cwd: projectRoot,
  encoding: 'utf8',
}))
assert.equal(audit.inventoryTopicMembershipPolicy, 'reviewed-primary-and-explicit-secondary')
const audited9702Topics = Object.entries(audit.inventory)
  .filter(([key]) => key.startsWith('cambridge-9702 | AS | '))
assert.equal(
  audited9702Topics.filter(([, count]) => Number(count) >= MIN_VERIFIED_GROUPS_FOR_PRACTICE).length,
  10,
  'the source audit and syllabus gate must agree on the ten 9702 AS ready topics',
)
const syllabus9702 = syllabusTopicsInventory({ routeId: cambridge9702.routeId, questionBank: unifiedQuestionBank })
const underFloorSyllabus9702Topics = syllabus9702.topics
  .filter((topic) => topic.verifiedQuestionCount < MIN_VERIFIED_GROUPS_FOR_PRACTICE)
assert.equal(underFloorSyllabus9702Topics.length, 1)
assert.ok(
  underFloorSyllabus9702Topics.every((topic) => (
    topic.ready === false
    && topic.ctaPolicy === 'hidden'
    && Array.isArray(topic.availableSetSizes)
    && topic.availableSetSizes.length === 0
  )),
  'under-floor 9702 topics must not advertise a formal Topic Drill set',
)

const appSource = execFileSync(process.execPath, ['-e', "process.stdout.write(require('node:fs').readFileSync('src/App.jsx','utf8'))"], {
  cwd: projectRoot,
  encoding: 'utf8',
})
assert.match(appSource, /const sampleReady = !practiceReady && available > 0 && topicPracticeUnits\.length > 0/, 'low-coverage reviewed source samples must remain openable without marking the topic ready')
assert.match(appSource, /Start (?:verified|checked) sample/, 'limited-indexing topics with checked source samples need an honest non-ready CTA')

for (const route of matrix.routes.filter((route) => route.practiceAvailableQuestionGroups === 0)) {
  assert.equal(route.ready, false, `${route.routeId} must not be marked ready with an empty practice pool`)
  assert.equal(route.ctaPolicy, 'hidden', `${route.routeId} must hide its start CTA while empty`)
}

console.log(JSON.stringify({
  status: 'passed',
  totals: matrix.totals,
  readyRoutes: matrix.totals.readyRoutes,
  limitedIndexingRoutes: matrix.totals.limitedIndexingRoutes,
  hiddenRoutes: matrix.totals.hiddenRoutes,
}))
