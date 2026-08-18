import assert from 'node:assert/strict'
import { sourceRangeReviewCandidates, sourceStructuralConsistencyIssues } from '../src/lib/sourceSemanticContract.js'
import { buildPartMarkingLifecycle, markingCapabilityForUnit } from '../src/lib/markingLifecycle.js'
import { practiceUnitMetrics } from '../src/lib/practicePresentation.js'
import { buildSyllabusPracticeSet } from '../src/lib/syllabusPractice.js'
import { unifiedQuestionBank } from '../src/data/questionBank.js'

function part(questionId, label, marks = 1, overrides = {}) {
  return {
    partId: `${questionId}:part-${label}`,
    label,
    marks,
    promptFragment: `Prompt ${label}`,
    ...overrides,
  }
}

function question(questionId, parts, marks = parts.reduce((sum, item) => sum + item.marks, 0)) {
  return {
    questionId,
    totalMarks: marks,
    parts,
  }
}

const valid = question('paper:q1', [part('paper:q1', 'a', 2), part('paper:q1', 'b', 3)])
assert.deepEqual(sourceStructuralConsistencyIssues(valid, {
  answerParts: [part('paper:q1', 'a', 2), part('paper:q1', 'b', 3)],
}), [], 'a whole question with closed part labels must pass the structural audit')

const startsAtB = question('paper:q2', [part('paper:q2', 'b', 2)])
assert.ok(sourceStructuralConsistencyIssues(startsAtB, { answerParts: [part('paper:q2', 'b', 2)] })
  .includes('question-part-sequence-starts-after-a:b'), 'a group beginning at b must fail closed')

const missingNested = question('paper:q3', [part('paper:q3', 'a(ii)', 1), part('paper:q3', 'a(iii)', 1)])
assert.ok(sourceStructuralConsistencyIssues(missingNested, {
  answerParts: [part('paper:q3', 'a(ii)', 1), part('paper:q3', 'a(iii)', 1)],
}).some((reason) => reason.includes('nested-part-sequence-starts-after-i:a')),
'a group missing a(i) must fail closed')

const wrongPartIdentity = question('paper:q4', [
  part('paper:q4', 'a', 1, { partId: 'paper:q3:part-a' }),
])
assert.ok(sourceStructuralConsistencyIssues(wrongPartIdentity, { answerParts: [part('paper:q4', 'a', 1)] })
  .includes('question-part-id-mismatch:paper:q3:part-a'), 'a part from another source question must fail closed')

const rangeCandidates = sourceRangeReviewCandidates([
  { questionId: 'paper:q1', sourceRef: { paperId: 'paper', pageStart: 2, pageEnd: 3 } },
  { questionId: 'paper:q2', sourceRef: { paperId: 'paper', pageStart: 5, pageEnd: 5 } },
  { questionId: 'paper:q3', sourceRef: { paperId: 'paper', pageStart: 6, pageEnd: 6 } },
])
assert.deepEqual(rangeCandidates.map((candidate) => candidate.questionId), ['paper:q1'], 'a page gap before the next question is an explicit review candidate')

const mixedUnit = {
  routeId: 'cie-9702-as-physics',
  stage: 'AS',
  parts: [
    { id: 'q1', marks: 1, answerType: 'multiple-choice', answerKey: 'B', deterministicScoringAvailable: true },
    { id: 'q2', marks: 2, answerType: 'written', reviewStatus: 'reviewed', aiAssistedMarkingAvailable: true, markSchemePoints: ['method', 'result'] },
  ],
}
assert.equal(markingCapabilityForUnit(mixedUnit).mode, 'mixed', 'objective and reviewed written parts must expose mixed marking')
const imageOnlyLifecycle = buildPartMarkingLifecycle(
  { ...mixedUnit, parts: [mixedUnit.parts[1]] },
  {},
  0,
  { q2: {
    status: 'success', rawMarks: 1, maxMarks: 2, confidence: 0.9, reviewRequired: false,
    markPoints: [{ id: 'm1', awarded: true, reason: 'method' }, { id: 'm2', awarded: false, reason: 'result' }],
  } },
  { q2: { dataUrl: 'data:image/png;base64,fixture' } },
)
assert.equal(imageOnlyLifecycle.partStates.q2.status, 'ai-scored', 'an image-only response must be eligible for AI scoring')
assert.equal(imageOnlyLifecycle.provisionalRawMarks, 1)

const reviewedSet = buildSyllabusPracticeSet({
  routeId: 'cie-9702-as-physics',
  syllabusTopicIds: ['physics-9702-topic-01'],
  questionCount: 1,
  components: [1],
  questionBank: unifiedQuestionBank,
})
assert.ok(reviewedSet.questionGroups[0].parts.every((item) => item.aiAssistedMarkingAvailable === true), 'fresh reviewed syllabus groups must carry AI capability into the new attempt')

const metrics = practiceUnitMetrics({
  parts: [
    { sourceQuestionId: 'paper:q1', questionPartId: 'a', marks: 2, deterministicScoringAvailable: true },
    { sourceQuestionId: 'paper:q1', questionPartId: 'b', marks: 3, deterministicScoringAvailable: true },
    { sourceQuestionId: 'paper:q2', questionPartId: 'a', marks: 1, aiAssistedMarkingAvailable: true, reviewStatus: 'reviewed' },
  ],
})
assert.deepEqual({ sourceQuestionCount: metrics.sourceQuestionCount, answerPartCount: metrics.answerPartCount, totalMarks: metrics.totalMarks }, {
  sourceQuestionCount: 2,
  answerPartCount: 3,
  totalMarks: 6,
}, 'practice metrics must distinguish whole questions from answer parts')

console.log('Question-group integrity and AI-first lifecycle regressions passed.')
