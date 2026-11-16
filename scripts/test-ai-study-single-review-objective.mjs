import assert from 'node:assert/strict'
import { artifactId, buildAiStudentStudyRelease, sourceReviewInputSha256 } from './ai-pdf-ingestion/contract.mjs'
import { registerAiStudyObjectiveKey } from '../server/aiStudyObjectiveKeys.js'
import { scoreObjectiveQuestion } from '../server/objectiveAnswers.js'

const paperId = 'cie-9708-9708_m25_qp_12', routeId = 'cie-9708-as-economics'
const questionId = `${paperId}:q3`, qp = 'a'.repeat(64), ms = 'b'.repeat(64)
const qpPage = 'c'.repeat(64), msPage = 'd'.repeat(64), output = 'e'.repeat(64)
function fixture() {
  const question = { questionNumber: '3', sourceQuestionId: questionId, totalMarks: 1,
    regions: [{ page: 2, pageImageSha256: qpPage, x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }], diagramRegions: [],
    markSchemeEvidence: [{ page: 2, pageImageSha256: msPage }],
    parts: [{ label: 'whole', marks: 1, answerArea: { type: 'multiple-choice', input: 'choice' },
      options: ['A', 'B', 'C', 'D'], answerKey: 'B' }],
    tags: { primaryTopicId: '9708-as-topic-1-5', secondaryTopicIds: [], syllabusPointIds: [] } }
  const artifact = { status: 'ai-verified', artifactId: artifactId({ paperId, questionPdfSha256: qp, markSchemePdfSha256: ms }),
    paperId, syllabusRouteId: routeId, source: { questionPdfSha256: qp, markSchemePdfSha256: ms, markSchemePageHashes: { 2: msPage } },
    candidate: { questions: [question] }, verification: { questions: [structuredClone(question)] },
    sourceReview: { schemaVersion: 'ai-source-semantic-review.v1', decision: 'accept', provider: 'fixture', model: 'reviewer',
      reviewedAt: '2026-11-16T00:00:00Z', reviewNote: 'A synthetic reviewer checked this whole question and its mark-scheme answer.',
      confirmations: Object.fromEntries(['sourceBindingConfirmed', 'wholeQuestionConfirmed', 'partStructureConfirmed',
        'marksConfirmed', 'markSchemeEvidenceConfirmed', 'topicMappingConfirmed'].map((name) => [name, true])),
      evidence: [{ document: 'qp', page: 2, pageImageSha256: qpPage }, { document: 'ms', page: 2, pageImageSha256: msPage }],
      runtimeAttestation: { sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', turnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        modelProvider: 'fixture', model: 'reviewer', sessionLogSha256: 'f'.repeat(64), outputSha256: output },
      objectiveKeyEvidence: { schemaVersion: 'stem-ai-single-review-objective-key.v1', sourceQuestionId: questionId,
        questionPdfSha256: qp, markSchemePdfSha256: ms, markSchemePage: 2, markSchemePageSha256: msPage,
        answer: 'B', markSchemeAnswer: 'B', derivedAnswer: 'B', reviewOutputSha256: output } } }
  artifact.sourceReview.inputSha256 = sourceReviewInputSha256(artifact)
  return artifact
}
function register(artifact, overrides = {}) {
  artifact.studentRelease = buildAiStudentStudyRelease({ ...artifact, routeId })
  const question = artifact.candidate.questions[0]
  const group = Object.freeze({ routeId, sourceQuestionId: questionId, studentStudyEligible: true, formalProgressEligible: false,
    studentRelease: artifact.studentRelease, paperId, subjectCode: '9708', paperComponent: 1,
    sourceRef: { paperId, sha256: qp }, answerRef: { sha256: ms }, totalMarks: 1,
    parts: [{ partId: `${questionId}:part-whole`, label: 'whole', marks: 1 }], ...overrides })
  registerAiStudyObjectiveKey(group, artifact, question)
  return group
}
const group = register(fixture())
const correct = scoreObjectiveQuestion({ question: group, selectedOption: 'B', mode: 'topic' })
assert.equal(correct.score, 1)
assert.equal(correct.formalProgressEligible, false)
assert.equal(scoreObjectiveQuestion({ question: group, selectedOption: 'A', mode: 'topic' }).score, 0)
assert.equal(scoreObjectiveQuestion({ question: group, selectedOption: 'E', mode: 'topic' }).available, false)
assert.equal(scoreObjectiveQuestion({ question: group, selectedOption: 'B', mode: 'full-paper' }).available, false)
assert.equal(scoreObjectiveQuestion({ question: structuredClone(group), selectedOption: 'B', mode: 'topic' }).available, false)
assert.equal(scoreObjectiveQuestion({ question: register(fixture(), { sourceRef: { paperId, sha256: '0'.repeat(64) } }),
  selectedOption: 'B', mode: 'topic' }).available, false, 'a substituted question source must not score')
assert.equal(scoreObjectiveQuestion({ question: register(fixture(), { answerRef: { sha256: '0'.repeat(64) } }),
  selectedOption: 'B', mode: 'topic' }).available, false, 'a substituted mark-scheme source must not score')
const revoked = fixture(); revoked.status = 'quarantined'
assert.equal(scoreObjectiveQuestion({ question: register(revoked), selectedOption: 'B', mode: 'topic' }).available, false)
assert.doesNotMatch(JSON.stringify(group), /"correctOption"|"answerKey"/)
for (const mutate of [
  (a) => { delete a.sourceReview.objectiveKeyEvidence },
  (a) => { a.sourceReview.objectiveKeyEvidence.answer = 'A' },
  (a) => { a.sourceReview.objectiveKeyEvidence.sourceQuestionId = `${paperId}:q4` },
  (a) => { a.sourceReview.objectiveKeyEvidence.questionPdfSha256 = '0'.repeat(64) },
  (a) => { a.sourceReview.objectiveKeyEvidence.markSchemePdfSha256 = '0'.repeat(64) },
  (a) => { a.sourceReview.objectiveKeyEvidence.markSchemePageSha256 = '0'.repeat(64) },
  (a) => { a.sourceReview.objectiveKeyEvidence.markSchemePage = 3 },
  (a) => { a.sourceReview.objectiveKeyEvidence.derivedAnswer = 'A' },
  (a) => { a.sourceReview.objectiveKeyEvidence.markSchemeAnswer = 'A' },
  (a) => { a.sourceReview.objectiveKeyEvidence.reviewOutputSha256 = '0'.repeat(64) },
  (a) => { a.sourceReview.runtimeAttestation.model = 'other-model' },
  (a) => { a.sourceReview.runtimeAttestation.sessionId = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] },
  (a) => { delete a.sourceReview.runtimeAttestation },
  (a) => { a.verification.questions[0].parts[0].answerKey = 'A'; a.sourceReview.inputSha256 = sourceReviewInputSha256(a) },
  (a) => { a.verification.questions[0].questionNumber = '4'; a.sourceReview.inputSha256 = sourceReviewInputSha256(a) },
  (a) => { a.candidate.questions.push(structuredClone(a.candidate.questions[0])); a.sourceReview.inputSha256 = sourceReviewInputSha256(a) },
  (a) => { a.candidate.questions[0].parts[0].options = ['A', 'B', 'C']; a.sourceReview.inputSha256 = sourceReviewInputSha256(a) },
]) {
  const artifact = fixture(); mutate(artifact)
  assert.equal(scoreObjectiveQuestion({ question: register(artifact), selectedOption: 'B', mode: 'topic' }).available, false,
    'a missing or mismatched source-review key binding must fail closed')
}
console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'single-reviewed-objective-key', negativeCases: 20 }))
