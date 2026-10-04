import { createHash } from 'node:crypto'

import { hasValidAiStudentStudyRelease } from '../scripts/ai-pdf-ingestion/contract.mjs'

// Server-only capability. Keys never become serializable question fields, API
// DTOs or persisted student snapshots. Cloning a question grants no authority.
const keys = new WeakMap()
const labels = ['A', 'B', 'C', 'D']

export function registerAiStudyObjectiveKey(question, artifact, candidate) {
  if (!Object.isFrozen(question) || !hasValidAiStudentStudyRelease(artifact)
    || artifact.studentRelease?.review?.independentPassCount !== 2
    || artifact.studentRelease?.review?.method !== 'single-model-plus-independent-source-review'
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
    || question.studentRelease?.review?.independentPassCount !== 2
    || question.studentRelease?.review?.method !== 'single-model-plus-independent-source-review'
    || question.studentRelease?.contentBinding?.sha256 !== key.releaseDigest) return null
  return key
}
