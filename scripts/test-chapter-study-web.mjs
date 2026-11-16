import assert from 'node:assert/strict'
import { isStartableTopicPracticeUnit } from '../src/lib/practiceConstants.js'
import { studentNavigationFromLocation, studentNavigationHref } from '../src/lib/studentNavigation.js'
import { chapterStudySizes, objectiveAnswerSnapshot, officialChapterCount, validateOfficialChapterSet, validateServerObjectiveResult } from '../src/lib/chapterStudyWeb.js'
import { buildPartMarkingLifecycle, markingCapabilityForUnit } from '../src/lib/markingLifecycle.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { validateSyllabusInventoryPayload } from '../src/hooks/useSyllabusInventory.js'

const part = { sourceKind: 'past-paper', sourceQuestionId: 'cie-9708-9708_m25_qp_12:q3' }
const chapter = { type: 'topic', sourceAuthority: 'server-syllabus', studyMode: 'chapter-study',
  sourcePreference: 'official-first', practiceMode: 'study-only', formalProgressEligible: false, parts: [part] }
assert.equal(isStartableTopicPracticeUnit(chapter), true, 'a source-backed study-only chapter may start with one question')
for (const invalid of [
  { ...chapter, studyMode: 'topic-drill' }, { ...chapter, formalProgressEligible: true },
  { ...chapter, practiceMode: 'verified' }, { ...chapter, sourceAuthority: 'untrusted' },
  { ...chapter, sourceAuthority: 'untrusted', parts: [{ sourceKind: 'original-foundation', sourceQuestionId: 'fake' }] },
  { ...chapter, parts: [] },
]) assert.equal(isStartableTopicPracticeUnit(invalid), false, 'one question must not bypass the normal topic or source gate')
const href = studentNavigationHref({ view: 'library', tab: 'chapter-study', routeId: 'cie-9708-as-economics', stage: 'AS', course: '9708' })
assert.equal(studentNavigationFromLocation(`https://stem.ieltsist.com${href}`).tab, 'chapter-study')
assert.deepEqual(chapterStudySizes(2), [1, 2])
const topic = { chapterStudy: { mode: 'chapter-study', available: 4, officialAvailable: 1, originalAvailable: 3, startable: true },
  componentCounts: { 1: { chapterStudy: { mode: 'chapter-study', available: 2, officialAvailable: 1, originalAvailable: 1, startable: true } } } }
assert.equal(officialChapterCount(topic, [1], [1, 2, 3]), 1, 'original foundation questions must not count as official')
assert.equal(officialChapterCount(topic, [1, 2], [1, 2, 3]), 0, 'unsupported mixed subsets must fail closed')
const response = { routeId: 'cie-9708-as-economics', studyMode: 'chapter-study', sourcePreference: 'official-first',
  practiceMode: 'study-only', formalProgressEligible: false, sourceMix: { official: 1, originalFoundation: 0 },
  questionGroups: [{ id: part.sourceQuestionId, studentStudyEligible: true, formalProgressEligible: false,
    sourceContent: { complete: true, fileComplete: true }, sourceRef: { paper: '9708_m25_qp_12.pdf', sha256: 'a'.repeat(64) },
    answerRef: { file: '9708_m25_ms_12.pdf', sha256: 'b'.repeat(64) } }] }
assert.equal(validateOfficialChapterSet(response, response.routeId), true)
assert.equal(validateOfficialChapterSet({ ...response, sourceMix: { official: 0, originalFoundation: 1 } }, response.routeId), false)
assert.equal(validateOfficialChapterSet({ ...response, formalProgressEligible: true }, response.routeId), false)
const objectiveResponse = structuredClone(response)
const objectiveGroup = objectiveResponse.questionGroups[0]
delete objectiveGroup.answerRef
objectiveGroup.answerFormat = 'single-choice'
objectiveGroup.choiceLabels = ['A', 'B', 'C', 'D']
objectiveGroup.parts = [{ partId: 'synthetic-part', answerFormat: 'single-choice',
  sourceBindingProvenance: { sourceQuestionId: objectiveGroup.id, questionPartId: 'synthetic-part',
    sourceDocumentSha256: 'a'.repeat(64), answerDocumentSha256: 'b'.repeat(64) } }]
assert.equal(validateOfficialChapterSet(objectiveResponse, response.routeId), true)
const leaking = structuredClone(objectiveResponse)
leaking.questionGroups[0].parts[0].answerKey = 'A'
assert.equal(validateOfficialChapterSet(leaking, response.routeId), false, 'the answer must not be sent before submission')
const objectivePart = { ...part, id: 'synthetic-part', marks: 1, answerType: 'multiple-choice',
  answerFormat: 'single-choice', serverDeterministicScoringAvailable: true }
const objectiveUnit = { ...chapter, parts: [objectivePart] }
assert.equal(markingCapabilityForUnit(objectiveUnit).mode, 'server-objective')
const answer = { [objectivePart.id]: 'A' }
assert.equal(objectiveAnswerSnapshot(objectiveUnit, answer)[part.sourceQuestionId], 'A')
assert.equal(Object.hasOwn(objectiveAnswerSnapshot(objectiveUnit, { [objectivePart.id]: 'invalid' }), part.sourceQuestionId), false)
const pending = buildPartMarkingLifecycle(objectiveUnit, answer, 0, {}, {}, {})
assert.equal(pending.complete, false, 'missing server marking must remain unscored')
assert.equal(pending.provisionalCriteria.length, 0)
for (const score of [0, 1]) {
  const lifecycle = buildPartMarkingLifecycle(objectiveUnit, answer, 0, {}, {},
    { [objectivePart.id]: { status: 'success', available: true, score, maxScore: 1, sourceStatus: 'ai-checked-official-key' } })
  assert.equal(lifecycle.complete, true)
  assert.equal(lifecycle.provisionalRawMarks, score)
}
const expectedObjective = { attemptId: 'synthetic-attempt', routeId: response.routeId, stage: 'AS',
  paperId: 'cie-9708-9708_m25_qp_12', sourceQuestionId: part.sourceQuestionId, questionPartId: 'synthetic-part', selectedOption: 'A' }
const objectiveResult = { schemaVersion: 'stem-objective-result-v1', mode: 'topic', ...expectedObjective,
  available: true, score: 1, maxScore: 1, correctOption: 'A', sourceStatus: 'ai-checked-official-key', formalProgressEligible: false }
assert.equal(validateServerObjectiveResult(objectiveResult, expectedObjective), true)
for (const bad of [{ ...objectiveResult, attemptId: 'other' }, { ...objectiveResult, score: 0 },
  { ...objectiveResult, available: false }, { ...objectiveResult, formalProgressEligible: true }]) {
  assert.equal(validateServerObjectiveResult(bad, expectedObjective), false, 'invalid or mismatched results must remain unscored')
}
const furtherMathematicsInventory = syllabusTopicsInventory({ routeId: 'cie-9231-as-p1-p4', questionBank: [], includeStudyOnly: true })
assert.doesNotThrow(() => validateSyllabusInventoryPayload(furtherMathematicsInventory, 'cie-9231-as-p1-p4'),
  'a shared AS/A2 component must remain valid on an AS route')
const furtherMathematicsA2 = syllabusTopicsInventory({ routeId: 'cie-9231-a2-after-p1-p3-p2-p4', questionBank: [], includeStudyOnly: true })
assert.doesNotThrow(() => validateSyllabusInventoryPayload(furtherMathematicsA2, 'cie-9231-a2-after-p1-p3-p2-p4'),
  'a shared AS/A2 component must remain valid on an A2 route')
for (const invalidStage of ['A2', 'AS/AS', 'AS/OTHER', 'IGCSE/AS/A2', 'A2/AS']) {
  const invalid = structuredClone(furtherMathematicsInventory)
  invalid.assessmentComponents[1].stage = invalidStage
  assert.throws(() => validateSyllabusInventoryPayload(invalid, 'cie-9231-as-p1-p4'), /stage does not match/,
    `invalid shared component stage ${invalidStage} must fail closed`)
}
const wrongComponent = structuredClone(furtherMathematicsInventory)
wrongComponent.assessmentComponents[1].component = 3
assert.throws(() => validateSyllabusInventoryPayload(wrongComponent, 'cie-9231-as-p1-p4'), /outside the selected course/)
const wrongQualification = structuredClone(furtherMathematicsInventory)
wrongQualification.qualification = 'IGCSE'
assert.throws(() => validateSyllabusInventoryPayload(wrongQualification, 'cie-9231-as-p1-p4'), /qualification does not match/)
console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', chapterOneQuestion: true, topicFloorPreserved: true, deepLink: true }))
