import { createHash } from 'node:crypto'

import { hasValidAiStudentStudyRelease } from '../scripts/ai-pdf-ingestion/contract.mjs'

// Server-only capability. Keys never become serializable question fields, API
// DTOs or persisted student snapshots. Cloning a question grants no authority.
const keys = new WeakMap()
const labels = ['A', 'B', 'C', 'D']
const sha256 = /^[a-f0-9]{64}$/i
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i

function singleReviewHasBoundObjectiveKey(artifact, candidate) {
  const review = artifact.sourceReview, evidence = review?.objectiveKeyEvidence, session = review?.runtimeAttestation
  const outputHash = session?.outputSha256 || session?.fullReviewSha256 || session?.questionReviewSha256 || session?.reviewBinding?.outputSha256
  const sessionHash = session?.sessionLogSha256 || session?.sessionLog?.sha256
  const answer = candidate?.parts?.[0]?.answerKey, verification = artifact.verification?.questions?.[0]
  return Boolean(artifact.candidate?.questions?.length === 1 && artifact.verification?.questions?.length === 1
    && verification?.questionNumber === candidate.questionNumber
    && (verification.sourceQuestionId == null || verification.sourceQuestionId === `${artifact.paperId}:q${candidate.questionNumber}`)
    && verification.parts?.length === 1 && verification.parts[0].label === candidate.parts?.[0]?.label
    && verification.parts[0].marks === 1 && (verification.parts[0].answerKey == null || verification.parts[0].answerKey === answer)
    && evidence?.schemaVersion === 'stem-ai-single-review-objective-key.v1'
    && evidence.sourceQuestionId === `${artifact.paperId}:q${candidate.questionNumber}`
    && evidence.questionPdfSha256 === artifact.source?.questionPdfSha256
    && evidence.markSchemePdfSha256 === artifact.source?.markSchemePdfSha256
    && Number.isInteger(evidence.markSchemePage) && evidence.markSchemePage > 0
    && sha256.test(String(evidence.markSchemePageSha256 || ''))
    && artifact.source?.markSchemePageHashes?.[evidence.markSchemePage] === evidence.markSchemePageSha256
    && candidate.markSchemeEvidence?.some((item) => item.page === evidence.markSchemePage && item.pageImageSha256 === evidence.markSchemePageSha256)
    && verification.markSchemeEvidence?.some((item) => item.page === evidence.markSchemePage && item.pageImageSha256 === evidence.markSchemePageSha256)
    && labels.includes(answer) && evidence.answer === answer && evidence.markSchemeAnswer === answer && evidence.derivedAnswer === answer
    && typeof session?.sessionId === 'string' && uuid.test(session.sessionId)
    && typeof session?.turnId === 'string' && uuid.test(session.turnId)
    && session.modelProvider === review.provider && session.model === review.model
    && sha256.test(String(sessionHash || '')) && sha256.test(String(outputHash || ''))
    && evidence.reviewOutputSha256 === outputHash)
}

function supportedReviewMethod(release) {
  const review = release?.review
  return (review?.independentPassCount === 2 && review?.method === 'single-model-plus-independent-source-review')
    || (review?.independentPassCount === 1 && review?.method === 'single-model-source-review')
}

export function registerAiStudyObjectiveKey(question, artifact, candidate) {
  if (!Object.isFrozen(question) || !hasValidAiStudentStudyRelease(artifact)
    || !supportedReviewMethod(artifact.studentRelease)
    || (artifact.studentRelease.review.method === 'single-model-source-review' && !singleReviewHasBoundObjectiveKey(artifact, candidate))
    || !artifact.candidate.questions.includes(candidate)
    || question.studentStudyEligible !== true || question.formalProgressEligible !== false
    || question.studentRelease !== artifact.studentRelease
    || question.routeId !== artifact.syllabusRouteId
    || question.sourceQuestionId !== `${artifact.paperId}:q${candidate.questionNumber}`
    || question.sourceRef?.sha256 !== artifact.source.questionPdfSha256
    || question.answerRef?.sha256 !== artifact.source.markSchemePdfSha256
    || candidate.parts?.length !== 1 || question.parts?.length !== 1
    || candidate.totalMarks !== 1 || question.totalMarks !== 1) return question
  const part = candidate.parts[0]
  const options = part.options?.map((option) => typeof option === 'string' ? option : option?.label)
  if (part.marks !== 1 || part.answerArea?.type !== 'multiple-choice'
    || part.answerArea?.input !== 'choice' || !labels.includes(part.answerKey)
    || JSON.stringify(options) !== JSON.stringify(labels)
    || question.parts[0].label !== part.label || question.parts[0].marks !== 1) return question
  keys.set(question, Object.freeze({
    correctOption: part.answerKey,
    questionPartId: question.parts[0].partId,
    releaseDigest: artifact.studentRelease.contentBinding.sha256,
    reviewMethod: artifact.studentRelease.review.method,
    fingerprint: createHash('sha256').update(JSON.stringify({
      id: question.sourceQuestionId,
      routeId: question.routeId,
      qp: question.sourceRef.sha256,
      ms: question.answerRef.sha256,
      label: part.label,
      answer: part.answerKey,
    })).digest('hex'),
  }))
  return question
}

export function aiStudyObjectiveKey(question) {
  const key = keys.get(question)
  if (!key || question.studentStudyEligible !== true || question.formalProgressEligible !== false
    || question.studentRelease?.status !== 'released'
    || question.studentRelease?.studentStudyEligible !== true
    || question.studentRelease?.formalProgressEligible !== false
    || !supportedReviewMethod(question.studentRelease)
    || question.studentRelease?.review?.method !== key.reviewMethod
    || question.studentRelease?.contentBinding?.sha256 !== key.releaseDigest) return null
  return key
}
