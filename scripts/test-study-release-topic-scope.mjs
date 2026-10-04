import assert from 'node:assert/strict'

import { validateReleaseManifest } from './release-manifest-contract.mjs'
import { assertStudyReleaseInventory, parseStudyTopicScopes } from './study-release-policy.mjs'

const biologyRoute = 'cie-9700-as-biology'
const physicsRoute = 'cie-9702-as-physics'
const biologyTopicIds = Array.from({ length: 12 }, (_, index) => `9700-as-topic-${String(index + 1).padStart(2, '0')}`)
const selectedBiologyTopicIds = biologyTopicIds.slice(7, 11)

function topic(id, availableQuestionCount) {
  const apiStartable = availableQuestionCount >= 6
  return {
    id,
    verifiedQuestionCount: 0,
    studyQuestionCount: availableQuestionCount,
    availableQuestionCount,
    ready: false,
    studyReady: apiStartable,
    apiStartable,
    originalFoundationQuestionCount: 100,
  }
}

function inventory(counts = {}) {
  return {
    routeId: biologyRoute,
    topics: biologyTopicIds.map((id) => topic(id, counts[id] ?? (selectedBiologyTopicIds.includes(id) ? 6 : 0))),
  }
}

function manifestFixture(syllabusScope) {
  const commit = 'a'.repeat(40)
  const tree = { files: 1, symlinks: 0, bytes: 1, sha256: 'b'.repeat(64) }
  return {
    schemaVersion: 'stem-release-manifest.v1',
    releaseId: `fixture-${commit.slice(0, 7)}`,
    commit,
    packageSha256: 'c'.repeat(64),
    generatedAt: new Date().toISOString(),
    releaseTree: tree,
    immutableAssets: { identity: 'fixture-assets', ...tree },
    syllabusScope,
  }
}

assert.throws(
  () => assertStudyReleaseInventory(inventory(), biologyRoute),
  /not study-startable/,
  'the default release contract must still require every Biology topic',
)

const selectedReport = assertStudyReleaseInventory(inventory(), biologyRoute, selectedBiologyTopicIds)
assert.deepEqual(selectedReport.topicScope, selectedBiologyTopicIds)
assert.equal(selectedReport.topics, 4)
assert.equal(selectedReport.syllabusTopics, 12)
assert.equal(selectedReport.minimumStudyGroups, 6)

assert.throws(
  () => assertStudyReleaseInventory(inventory({ [selectedBiologyTopicIds[2]]: 5 }), biologyRoute, selectedBiologyTopicIds),
  /not study-startable|study floor/,
  'five true-source groups must not pass even when original foundation inventory exists',
)
assert.throws(() => assertStudyReleaseInventory(inventory(), biologyRoute, [...selectedBiologyTopicIds, '9702-as-topic-01']), /not found|scope/)
assert.throws(() => assertStudyReleaseInventory(inventory(), biologyRoute, [selectedBiologyTopicIds[0], selectedBiologyTopicIds[0]]), /duplicate|unique/)
assert.throws(() => assertStudyReleaseInventory(inventory(), biologyRoute, []), /empty|scope/)

assert.deepEqual(parseStudyTopicScopes(
  selectedBiologyTopicIds.map((topicId) => `${biologyRoute}:${topicId}`),
  [biologyRoute, physicsRoute],
), { [biologyRoute]: selectedBiologyTopicIds })
assert.throws(() => parseStudyTopicScopes([
  `${biologyRoute}:${selectedBiologyTopicIds[0]}`,
  `${biologyRoute}:${selectedBiologyTopicIds[0]}`,
], [biologyRoute]), /duplicate|unique/)
assert.throws(() => parseStudyTopicScopes([`foreign-route:${selectedBiologyTopicIds[0]}`], [biologyRoute]), /declared route/)
assert.throws(() => parseStudyTopicScopes([`${biologyRoute}:`], [biologyRoute]), /topic/)
assert.throws(() => parseStudyTopicScopes([` ${biologyRoute}:${selectedBiologyTopicIds[0]}`], [biologyRoute]), /canonical|whitespace/)

const scopedStudentScope = {
  schemaVersion: 'stem-syllabus-release-scope.v1',
  routeIds: [biologyRoute, physicsRoute],
  readinessMode: 'student-study',
  aiStudyFormalProgressEligible: false,
  topicScopes: { [biologyRoute]: selectedBiologyTopicIds },
}
assert.equal(validateReleaseManifest(manifestFixture(scopedStudentScope)).valid, true)
assert.equal(validateReleaseManifest(manifestFixture({ ...scopedStudentScope, readinessMode: 'formal' })).valid, false, 'formal mode must reject topic scoping')
assert.equal(validateReleaseManifest(manifestFixture({ ...scopedStudentScope, topicScopes: { 'foreign-route': selectedBiologyTopicIds } })).valid, false)
assert.equal(validateReleaseManifest(manifestFixture({ ...scopedStudentScope, topicScopes: { [biologyRoute]: [] } })).valid, false)
assert.equal(validateReleaseManifest(manifestFixture({
  ...scopedStudentScope,
  topicScopes: { [biologyRoute]: [selectedBiologyTopicIds[0], selectedBiologyTopicIds[0]] },
})).valid, false)
assert.equal(validateReleaseManifest(manifestFixture({
  ...scopedStudentScope,
  routeIds: [physicsRoute],
})).valid, false, 'topic-scope route must be declared')

assert.equal(validateReleaseManifest(manifestFixture({
  schemaVersion: 'stem-syllabus-release-scope.v1',
  routeIds: [biologyRoute, physicsRoute],
  readinessMode: 'student-study',
  aiStudyFormalProgressEligible: false,
})).valid, true, 'unscoped routes retain the legacy all-topic contract')

console.log(JSON.stringify({
  ok: true,
  scope: 'study-release-topic-scope',
  selectedTopics: selectedBiologyTopicIds,
  unscopedRoute: physicsRoute,
  minimumStudyGroups: 6,
  formalScopingAllowed: false,
}))
