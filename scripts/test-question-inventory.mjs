import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = execFileSync(process.execPath, ['scripts/question-inventory-matrix.mjs'], {
  cwd: projectRoot,
  encoding: 'utf8',
})
const matrix = JSON.parse(output)

assert.equal(matrix.schemaVersion, 'stem-question-inventory-v1')
assert.equal(matrix.totals.catalogItems, 10689)
assert.ok(matrix.totals.indexedQuestionGroups > 0, 'the imported index must not be empty')
assert.equal(matrix.totals.effectiveFileQuarantined, matrix.totals.indexQuarantined + matrix.totals.sourceAdditionalQuarantined, 'file quarantine totals must be decomposable without overlap')
assert.equal(matrix.totals.effectivePracticeQuarantinedQuestionGroups + matrix.totals.effectivePracticeAvailableQuestionGroups, matrix.totals.indexedQuestionGroups, 'practice gate must partition the imported index')
assert.equal(matrix.totals.semanticVerifiedQuestionGroups, matrix.totals.effectivePracticeAvailableQuestionGroups, 'runtime practice must use the same semantic gate as the manifest')
assert.ok(matrix.totals.effectivePracticeAvailableQuestionGroups >= 230, 'reviewed practice inventory must not regress below the current baseline')
assert.equal(matrix.totals.minimumGroupsForReadyRouteOrTopic, 10)

const cambridge0580 = matrix.routes.find((route) => route.routeId === 'cie-0580-igcse-mathematics')
assert.ok(cambridge0580, '0580 route must be present in the inventory matrix')
assert.equal(cambridge0580.practiceAvailableQuestionGroups, 26)
assert.equal(cambridge0580.ready, true)
assert.equal(cambridge0580.ctaPolicy, 'start')
assert.equal(cambridge0580.topicMatrix.find((topic) => topic.topicId === 'math-0580-number')?.practiceAvailableQuestionGroups, 13)
assert.equal(cambridge0580.topicMatrix.find((topic) => topic.topicId === 'math-0580-number')?.ctaPolicy, 'start')
assert.ok(cambridge0580.topicMatrix
  .filter((topic) => topic.practiceAvailableQuestionGroups > 0 && topic.practiceAvailableQuestionGroups < 10)
  .every((topic) => topic.ctaPolicy === 'limited-indexing' && topic.ready === false))

const cambridge9702 = matrix.routes.find((route) => route.routeId === 'cie-9702-as-physics')
assert.ok(cambridge9702, '9702 AS Physics route must be present in the inventory matrix')
assert.equal(cambridge9702.practiceAvailableQuestionGroups, 112)
assert.equal(cambridge9702.semanticVerifiedQuestionGroups, 112)
assert.equal(cambridge9702.ready, true)
assert.equal(cambridge9702.ctaPolicy, 'start')
assert.equal(cambridge9702.topicMatrix.find((topic) => topic.topicId === 'physics-9702-topic-05')?.practiceAvailableQuestionGroups, 10)
assert.equal(cambridge9702.topicMatrix.find((topic) => topic.topicId === 'physics-9702-topic-05')?.ctaPolicy, 'start')
assert.equal(cambridge9702.topicMatrix.find((topic) => topic.topicId === 'physics-9702-topic-02')?.practiceAvailableQuestionGroups, 10)
assert.equal(cambridge9702.topicMatrix.find((topic) => topic.topicId === 'physics-9702-topic-02')?.ctaPolicy, 'start')
assert.equal(cambridge9702.topicMatrix.length, 11)
assert.ok(cambridge9702.topicMatrix.every((topic) => topic.practiceAvailableQuestionGroups >= 10 && topic.ctaPolicy === 'start'), 'all eleven 9702 AS syllabus topics must remain available for ten-question P1/P2 drills')

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
