import assert from 'node:assert/strict'
import { validateReleaseManifest, baselineSyllabusScopeMatches } from './release-manifest-contract.mjs'
import { assertStudyReleaseInventory, assertChapterStudyReleaseInventory } from './study-release-policy.mjs'

const routeId = 'cie-9708-as-economics', first = '9708-as-topic-1-5', missing = '9708-as-topic-2-1'
const chapterPolicy = { mode: 'chapter-study', minSourceGroups: 1, maxSourceGroups: 15,
  countPolicy: 'cap-to-available', formalProgressEligible: false }
const item = (id, official) => ({ id, verifiedQuestionCount: 0, studyQuestionCount: official,
  releasedStudyQuestionCount: official, availableQuestionCount: official, ready: false, studyReady: false, apiStartable: false,
  chapterStudy: { mode: 'chapter-study', available: official + 1, officialAvailable: official, originalAvailable: 1, startable: true },
  questionIdsByComponent: { 1: { verifiedQuestionIds: [], releasedStudyQuestionIds: official ? ['paper:q1'] : [],
    apiReadyQuestionIds: official ? ['paper:q1'] : [] } } })
const inventory = () => ({ routeId, practicePolicy: { chapterStudy: { ...chapterPolicy } },
  topics: [item(first, 1), item(missing, 0)] })
assert.throws(() => assertStudyReleaseInventory(inventory(), routeId, [first]), /not study-startable|study floor/,
  'the existing student-study six-question floor must remain intact')
const report = assertChapterStudyReleaseInventory(inventory(), routeId, [first])
assert.equal(report.readinessMode, 'chapter-study')
assert.equal(report.minimumChapterSourceGroups, 1)
assert.equal(report.minimumStudentStudyGroups, 6)
assert.equal(report.minimumFormalGroups, 12)
assert.equal(report.fullChapterCoverage, false)
assert.deepEqual(report.missingOfficialTopicIds, [missing])
assert.throws(() => assertChapterStudyReleaseInventory(inventory(), routeId), /no reviewed source|not chapter-startable/,
  'unscoped release must not conceal missing chapters behind original-foundation content')
assert.throws(() => assertChapterStudyReleaseInventory(inventory(), routeId, [missing]), /no reviewed source|not chapter-startable/)
for (const mutate of [
  (value) => { value.practicePolicy.chapterStudy.formalProgressEligible = true },
  (value) => { value.practicePolicy.chapterStudy.minSourceGroups = 0 },
  (value) => { value.topics[0].releasedStudyQuestionCount = 0 },
  (value) => { value.topics[0].chapterStudy.officialAvailable = 0 },
  (value) => { value.topics[0].questionIdsByComponent[1].apiReadyQuestionIds = ['paper:q1', 'paper:q1'] },
  (value) => { value.topics[0].questionIdsByComponent[1].releasedStudyQuestionIds = [] },
]) {
  const value = inventory(); mutate(value)
  assert.throws(() => assertChapterStudyReleaseInventory(value, routeId, [first]))
}
const commit = 'a'.repeat(40), tree = { files: 1, symlinks: 0, bytes: 1, sha256: 'b'.repeat(64) }
const manifest = (scope) => ({ schemaVersion: 'stem-release-manifest.v1', releaseId: `fixture-${commit.slice(0, 7)}`,
  commit, packageSha256: 'c'.repeat(64), generatedAt: new Date().toISOString(), releaseTree: tree,
  immutableAssets: { identity: 'fixture-assets', ...tree }, syllabusScope: scope })
const baseline = { schemaVersion: 'stem-syllabus-release-scope.v1', routeIds: ['cie-9700-as-biology', 'cie-9702-as-physics'],
  readinessMode: 'student-study', aiStudyFormalProgressEligible: false,
  topicScopes: { 'cie-9700-as-biology': ['9700-as-topic-01'] } }
const chapterStudy = { schemaVersion: 'stem-chapter-study-release-scope.v1', routeIds: [routeId],
  topicScopes: { [routeId]: [first] }, formalProgressEligible: false,
  packBinding: { schemaVersion: 'stem-release-study-pack-binding.v1', relativePath: 'data/ai-study-packs/fixture', manifestSha256: 'f'.repeat(64) } }
const baselineManifest = manifest(baseline), baselineSha256 = 'd'.repeat(64)
const baselineIdentity = { releaseId: baselineManifest.releaseId, commit: baselineManifest.commit, manifestSha256: baselineSha256 }
const scope = { schemaVersion: 'stem-syllabus-release-scope.v2', baseline, baselineIdentity, chapterStudy }
assert.equal(validateReleaseManifest(manifest(scope)).valid, true)
assert.equal(baselineSyllabusScopeMatches(scope, baselineManifest, baselineSha256), true)
assert.equal(baselineSyllabusScopeMatches(scope, { ...baselineManifest, syllabusScope: { ...baseline, routeIds: ['cie-9702-as-physics'] } }, baselineSha256), false)
assert.equal(baselineSyllabusScopeMatches(scope, { ...baselineManifest, syllabusScope: { ...baseline, topicScopes: {} } }, baselineSha256), false)
assert.equal(baselineSyllabusScopeMatches(scope, baselineManifest, 'e'.repeat(64)), false)
assert.equal(baselineSyllabusScopeMatches({ ...scope, baselineIdentity: { ...baselineIdentity, commit: 'f'.repeat(40) } }, baselineManifest, baselineSha256), false)
assert.equal(baselineSyllabusScopeMatches({ ...scope, baselineIdentity: undefined }, baselineManifest, baselineSha256), false)
assert.equal(validateReleaseManifest(manifest({ ...scope, schemaVersion: 'stem-syllabus-release-scope.v1' })).valid, false)
assert.equal(validateReleaseManifest(manifest({ ...scope, chapterStudy: { ...chapterStudy, topicScopes: undefined } })).valid, false)
assert.equal(validateReleaseManifest(manifest({ ...scope, chapterStudy: { ...chapterStudy, formalProgressEligible: true } })).valid, false)
assert.equal(validateReleaseManifest(manifest({ ...scope, chapterStudy: { ...chapterStudy, packBinding: undefined } })).valid, false)
assert.equal(validateReleaseManifest(manifest({ ...scope, chapterStudy: { ...chapterStudy,
  packBinding: { ...chapterStudy.packBinding, relativePath: 'data/ai-study-packs/../other' } } })).valid, false)
assert.equal(validateReleaseManifest(manifest({ ...scope, baseline: { ...baseline, readinessMode: 'unknown' } })).valid, false)
assert.equal(validateReleaseManifest(manifest({ ...scope, baseline: { ...baseline, routeIds: [] } })).valid, false)
assert.equal(validateReleaseManifest(manifest({ ...scope, chapterStudy: { ...chapterStudy, routeIds: [routeId, routeId] } })).valid, false)
console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'chapter-study-release-v2', existingStudyFloor: 6, formalFloor: 12 }))
