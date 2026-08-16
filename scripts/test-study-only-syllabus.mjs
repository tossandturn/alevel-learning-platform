import assert from 'node:assert/strict'
import * as syllabusPractice from '../src/lib/syllabusPractice.js'
import { studyQuestionBank, unifiedQuestionBank } from '../src/data/questionBank.js'
import { isScoredAttempt, sourceBindingSnapshotForUnit } from '../src/lib/attemptAudit.js'
import { buildLearningProgress } from '../src/lib/learningProgress.js'
import { courseRoutes } from '../src/data/routeRegistry.js'
import { normalizeState } from '../src/lib/storage.js'
import {
  canonicalSyllabusTopicIdForRoute,
  syllabusPracticeComponentsForRoute,
} from '../src/lib/syllabusPracticeRoutes.js'

const { buildSyllabusPracticeSet, syllabusTopicsInventory, supportsSyllabusPracticeRoute } = syllabusPractice

for (const routeId of [
  'cie-0580-igcse-mathematics',
  'cie-0606-igcse-additional-mathematics',
  'cie-0625-igcse-physics',
  'cie-9702-as-physics',
  'cie-9702-a2-physics',
  'cie-9709-as-p1-p2',
]) {
  assert.equal(supportsSyllabusPracticeRoute(routeId), true, `${routeId} must use the source-backed syllabus practice API`)
}

const igcseMath = syllabusTopicsInventory({
  routeId: 'cie-0580-igcse-mathematics',
  questionBank: studyQuestionBank,
})
assert.equal(igcseMath.verifiedQuestionGroupCount, 0, '0580 mappings remain study-only until the new syllabus mapping is reviewed')
assert.equal(igcseMath.availableQuestionGroupCount, 63, '0580 Topic study must include every currently eligible reviewed or self-mark source group')
assert.equal(igcseMath.studyQuestionGroupCount, 63)
assert.ok(igcseMath.topics.every((topic) => topic.availableQuestionCount > 0), 'every 0580 syllabus topic with complete source pages must be open for study')
const igcseMathSet = buildSyllabusPracticeSet({
  routeId: 'cie-0580-igcse-mathematics',
  syllabusTopicIds: ['0580-igcse-topic-02'],
  components: [1, 2, 3, 4],
  questionCount: 10,
  questionBank: studyQuestionBank,
  includeStudyOnly: true,
  seed: 580,
})
assert.equal(igcseMathSet.questionCount, Math.min(10, igcseMathSet.availableCount))
assert.ok(igcseMathSet.questionGroups.every((group) => group.routeId === 'cie-0580-igcse-mathematics'))

const additionalMath = syllabusTopicsInventory({
  routeId: 'cie-0606-igcse-additional-mathematics',
  questionBank: studyQuestionBank,
})
assert.equal(additionalMath.availableQuestionGroupCount, 21)
assert.equal(additionalMath.topics.find((topic) => topic.id === 'math-0606-functions')?.availableQuestionCount, 1)
assert.equal(additionalMath.topics.find((topic) => topic.id === 'math-0606-functions')?.ctaPolicy, 'start-study', 'a complete one-question topic must remain usable as a shorter study set')

const igcsePhysics = syllabusTopicsInventory({
  routeId: 'cie-0625-igcse-physics',
  questionBank: studyQuestionBank,
})
assert.equal(igcsePhysics.verifiedQuestionGroupCount, 80)
assert.equal(igcsePhysics.studyQuestionGroupCount, 40, 'legacy 0625 topic tags with complete QP/MS files must remain available for self-mark study')
assert.equal(igcsePhysics.availableQuestionGroupCount, 120)
assert.deepEqual(
  igcsePhysics.topics.map((topic) => topic.availableQuestionCount),
  [26, 24, 21, 27, 14, 8],
  'all source-backed 0625 questions must map into the six official syllabus topics',
)
assert.equal(igcsePhysics.topics.find((topic) => topic.id === '0625-igcse-topic-06')?.availableQuestionCount, 8)
assert.equal(igcsePhysics.topics.find((topic) => topic.id === '0625-igcse-topic-06')?.ctaPolicy, 'start-study', 'a complete five-question physics topic must not be locked behind a ten-question floor')

const a2Physics = syllabusTopicsInventory({
  routeId: 'cie-9702-a2-physics',
  questionBank: studyQuestionBank,
})
assert.equal(a2Physics.verifiedQuestionGroupCount, 0)
assert.equal(a2Physics.studyQuestionGroupCount, 11, 'A2 Physics source-backed questions must not disappear behind the AS-only route')
assert.equal(a2Physics.availableQuestionGroupCount, 11)
assert.ok(a2Physics.topics.some((topic) => topic.availableQuestionCount > 0))

assert.equal(canonicalSyllabusTopicIdForRoute('cie-0580-igcse-mathematics', 'math-0580-number'), '0580-igcse-topic-01')
assert.equal(canonicalSyllabusTopicIdForRoute('cie-0625-igcse-physics', 'physics-0625-waves'), '0625-igcse-topic-03')
assert.equal(canonicalSyllabusTopicIdForRoute('cie-9702-a2-physics', 'physics-9702-topic-20'), '9702-a2-topic-09')
assert.equal(canonicalSyllabusTopicIdForRoute('cie-9709-as-p1-p4', 'math-9709-mechanics'), '9709-as-topic-03')
assert.equal(canonicalSyllabusTopicIdForRoute('cie-9709-a2-after-p1-p5-p3-p6', 'math-9709-statistics'), '9709-a2-topic-04')
assert.deepEqual(syllabusPracticeComponentsForRoute('cie-0580-igcse-mathematics'), [1, 2, 3, 4])
assert.deepEqual(syllabusPracticeComponentsForRoute('cie-9702-as-physics'), [1, 2])
assert.deepEqual(syllabusPracticeComponentsForRoute('cie-9709-as-p1-p4'), [1, 4])

const a2PhysicsSet = buildSyllabusPracticeSet({
  routeId: 'cie-9702-a2-physics',
  syllabusTopicIds: ['9702-a2-topic-02'],
  components: [4],
  questionCount: 10,
  questionBank: studyQuestionBank,
  includeStudyOnly: true,
  seed: 9702,
})
assert.equal(a2PhysicsSet.questionCount, 2)
assert.equal(a2PhysicsSet.practiceMode, 'study-only')
assert.ok(a2PhysicsSet.questionGroups.every((group) => group.routeId === 'cie-9702-a2-physics' && group.paperComponent === 4))

const asMath = syllabusTopicsInventory({
  routeId: 'cie-9709-as-p1-p2',
  questionBank: studyQuestionBank,
})
assert.deepEqual(
  asMath.topics.map((topic) => topic.availableQuestionCount),
  [43, 22, 0, 0],
  '9709 AS P1/P2 must expose the real file-complete study inventory by syllabus topic',
)
assert.deepEqual(
  asMath.topics.map((topic) => topic.verifiedQuestionCount),
  [0, 0, 0, 0],
  'study-only inventory must not inflate the formal verified count',
)
assert.equal(asMath.topics[0].componentCounts['1'].availableQuestionCount, 43)
assert.equal(asMath.topics[1].componentCounts['2'].availableQuestionCount, 22)

const asSet = buildSyllabusPracticeSet({
  routeId: 'cie-9709-as-p1-p2',
  syllabusTopicIds: ['9709-as-topic-01', '9709-as-topic-02'],
  components: [1, 2],
  questionCount: 10,
  questionBank: studyQuestionBank,
  includeStudyOnly: true,
  seed: 9709,
})
assert.equal(asSet.practiceMode, 'study-only')
assert.equal(asSet.questionCount, 10)
assert.equal(asSet.availableCount, 65)
assert.equal(asSet.partial, false)
assert.ok(asSet.questionGroups.every((group) => group.studyOnly === true))
assert.ok(asSet.questionGroups.every((group) => group.reviewStatus === 'machine-indexed'))
assert.ok(asSet.questionGroups.every((group) => group.sourceContent.fileComplete === true))
assert.ok(asSet.questionGroups.every((group) => group.sourceContent.complete === false))
assert.ok(asSet.questionGroups.every((group) => group.routeId === 'cie-9709-as-p1-p2'))
assert.ok(asSet.questionGroups.every((group) => group.paperComponent === 1 || group.paperComponent === 2))

const persistedStudyUnit = {
  id: 'syllabus-set:cie-9709-as-p1-p2:9709-as-topic-01+9709-as-topic-02:c1-2:q10:s9709',
  type: 'topic',
  sourceAuthority: 'server-syllabus',
  sourceGateVersion: 'server-syllabus-catalog-v2',
  routeId: 'cie-9709-as-p1-p2',
  knowledgeGroupId: '9709-as-topic-01',
  topicId: '9709-as-topic-01',
  syllabusTopic: '9709-as-topic-01,9709-as-topic-02',
  paperComponent: [1, 2],
  practiceMode: 'study-only',
  parts: asSet.questionGroups.flatMap((group) => group.parts.map((part, index) => ({
    ...part,
    id: `persisted:${group.id}:${part.partId}:${index}`,
    sourceKind: 'past-paper',
    sourceQuestionId: group.id,
    questionPartId: part.partId,
    sourceBindingProvenance: part.sourceBindingProvenance,
  }))),
}

const normalizedPersistedState = normalizeState({ generatedUnits: [persistedStudyUnit] })
assert.equal(normalizedPersistedState.generatedUnits[0].routeId, persistedStudyUnit.routeId, 'storage must preserve an explicit registered syllabus route until server source rebind')
assert.equal(normalizedPersistedState.generatedUnits[0].sourceGateStatus, 'pending-source-rebind', 'a stored syllabus unit must remain non-executable before server rebind')

assert.equal(typeof syllabusPractice.rebindSyllabusPracticeUnit, 'function', 'source-backed study units need a canonical refresh rebind')
const reboundStudyUnit = syllabusPractice.rebindSyllabusPracticeUnit(persistedStudyUnit)
assert.ok(reboundStudyUnit, 'a current source-backed study unit must survive reload by rebuilding from the current study pool')
assert.equal(reboundStudyUnit.practiceMode, 'study-only')
assert.ok(reboundStudyUnit.parts.every((part) => part.studyOnly === true && part.aiAssistedMarkingAvailable === false))
assert.ok(sourceBindingSnapshotForUnit(reboundStudyUnit), 'a study unit needs a source binding snapshot for safe submit/history checks')

const selfMarkedStudyAttempt = {
  id: 'study-only-self-marked',
  unitId: reboundStudyUnit.id,
  routeId: reboundStudyUnit.routeId,
  stage: reboundStudyUnit.stage,
  attemptStatus: 'result',
  submittedAt: '2026-08-16T08:00:00.000Z',
  sourceBinding: sourceBindingSnapshotForUnit(reboundStudyUnit),
  scoreResult: { rawMarks: 3, maxMarks: 3, percentage: 100 },
}
assert.equal(isScoredAttempt(selfMarkedStudyAttempt, reboundStudyUnit), false, 'self-mark-only study results must not become formal mastery evidence')
const studyProgress = buildLearningProgress({
  attempts: [selfMarkedStudyAttempt],
  units: [reboundStudyUnit],
  routes: courseRoutes,
  routeId: reboundStudyUnit.routeId,
  weeklyTarget: 18,
})
assert.equal(studyProgress.completedSets, 0, 'study-only self-marks must not advance weekly or mastery progress')

const tamperedStudyUnit = structuredClone(persistedStudyUnit)
tamperedStudyUnit.parts[0].sourceBindingProvenance.bindingSignature = 'fnv1a64:0000000000000000'
assert.equal(syllabusPractice.rebindSyllabusPracticeUnit(tamperedStudyUnit), null, 'a stale or forged study source binding must remain blocked')

assert.throws(
  () => buildSyllabusPracticeSet({
    routeId: 'cie-9709-as-p1-p2',
    syllabusTopicIds: ['9709-as-topic-01'],
    components: [1],
    questionCount: 1,
    questionBank: unifiedQuestionBank,
  }),
  (error) => error.code === 'insufficient_verified_questions',
  'the formal bank must remain fail-closed for unreviewed 9709 records',
)

const a2Math = syllabusTopicsInventory({
  routeId: 'cie-9709-a2-after-p1-p5-p3-p4',
  questionBank: studyQuestionBank,
})
assert.deepEqual(
  a2Math.topics.map((topic) => topic.availableQuestionCount),
  [31, 21, 0, 0],
  '9709 A2 study-only inventory must retain the source-backed P3 and P5 structural repairs without promoting them to formal practice',
)
const a2Set = buildSyllabusPracticeSet({
  routeId: 'cie-9709-a2-after-p1-p5-p3-p4',
  syllabusTopicIds: ['9709-a2-topic-02'],
  components: [4],
  questionCount: 10,
  questionBank: studyQuestionBank,
  includeStudyOnly: true,
  seed: 9709,
})
assert.equal(a2Set.questionCount, 10)
assert.ok(a2Set.questionGroups.every((group) => group.paperComponent === 4))

const physics = syllabusTopicsInventory({
  routeId: 'cie-9702-as-physics',
  questionBank: studyQuestionBank,
})
assert.equal(physics.verifiedQuestionGroupCount, 112)
assert.ok(physics.availableQuestionGroupCount > physics.verifiedQuestionGroupCount)
assert.ok(physics.topics.every((topic) => topic.verifiedQuestionCount >= 10))

const physicsFormalFirst = buildSyllabusPracticeSet({
  routeId: 'cie-9702-as-physics',
  syllabusTopicIds: ['physics-9702-topic-01'],
  components: [1, 2],
  questionCount: 5,
  questionBank: studyQuestionBank,
  includeStudyOnly: true,
  seed: 1,
})
assert.ok(physicsFormalFirst.questionGroups.every((group) => group.studyOnly !== true), 'formal reviewed questions must be selected before study-only backfill')

console.log(JSON.stringify({
  igcse0580: {
    verified: igcseMath.verifiedQuestionGroupCount,
    studyOnly: igcseMath.studyQuestionGroupCount,
    available: igcseMath.availableQuestionGroupCount,
  },
  igcse0606: {
    verified: additionalMath.verifiedQuestionGroupCount,
    studyOnly: additionalMath.studyQuestionGroupCount,
    available: additionalMath.availableQuestionGroupCount,
  },
  as9709: asMath.topics.map(({ id, verifiedQuestionCount, studyQuestionCount, availableQuestionCount }) => ({ id, verifiedQuestionCount, studyQuestionCount, availableQuestionCount })),
  a2_9709: a2Math.topics.map(({ id, verifiedQuestionCount, studyQuestionCount, availableQuestionCount }) => ({ id, verifiedQuestionCount, studyQuestionCount, availableQuestionCount })),
  physics9702: {
    verified: physics.verifiedQuestionGroupCount,
    studyOnly: physics.studyQuestionGroupCount,
    available: physics.availableQuestionGroupCount,
  },
}))
