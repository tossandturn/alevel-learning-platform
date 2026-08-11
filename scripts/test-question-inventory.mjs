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
assert.equal(matrix.totals.indexedQuestionGroups, 1320)
assert.equal(matrix.totals.indexQuarantined, 427)
assert.equal(matrix.totals.sourceAdditionalQuarantined, 3)
assert.equal(matrix.totals.effectiveFileQuarantined, 430)
assert.equal(matrix.totals.effectivePracticeAvailableQuestionGroups, 26)
assert.equal(matrix.totals.effectivePracticeQuarantinedQuestionGroups, 1294)
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
