import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import importedQuestionIndex from '../src/data/importedQuestionIndex.json' with { type: 'json' }
import { paperQuestionMarkingMetadata } from '../src/data/questionBank.js'
import { normaliseQuestionGroup } from '../src/data/questionParts.js'
import { buildSharedMarkingSubmission } from '../src/lib/paperMarking.js'
import { sourceContentStatus } from '../src/lib/questionContent.js'

const paperId = 'cie-0580-0580_m25_qp_12'
const tuple = {
  routeId: 'cie-0580-igcse-mathematics',
  qualification: 'IGCSE',
  specificationVersion: 'cambridge-0580-2025-2027',
  paperId,
}
const libraryRoot = process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf'
const qpPath = path.join(libraryRoot, '0580', '0580_m25_qp_12.pdf')
const msPath = path.join(libraryRoot, '0580', '0580_m25_ms_12.pdf')

function sha256File(filePath) {
  assert.ok(fs.existsSync(filePath), `Missing local source PDF ${filePath}`)
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

assert.equal(sha256File(qpPath), 'bb8bebf6fabb2cb1a4dd0ff5387bdb6407ba2934046974312d9aed88b3cdfc26')
assert.equal(sha256File(msPath), '5d98f30296127753df1b0d7b10f244d29103c199fd198574c007d750308714a5')

const questions = importedQuestionIndex.questions.filter((question) => question.sourceRef?.paperId === paperId)
const answersById = new Map(importedQuestionIndex.answers.map((answer) => [answer.answerId, answer]))
const bindingsByQuestionId = new Map(importedQuestionIndex.bindings.map((binding) => [binding.questionId, binding]))
const numbers = questions.map((question) => Number(question.sourceRef.question.slice(1))).sort((left, right) => left - right)
assert.deepEqual(numbers, Array.from({ length: 26 }, (_, index) => index + 1))
assert.equal(questions.reduce((sum, question) => sum + question.totalMarks, 0), 80)
assert.equal(questions.reduce((sum, question) => sum + question.parts.length, 0), 46)

for (const question of questions) {
  const binding = bindingsByQuestionId.get(question.questionId)
  const answer = answersById.get(binding?.answerId)
  const sourceContent = sourceContentStatus({ ...question, answerBinding: binding, answerParts: answer?.answerParts, answerRef: answer?.answerRef })
  assert.equal(binding?.verificationStatus, 'reviewed', `${question.questionId} must be human reviewed`)
  assert.match(binding.reviewedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.ok(binding.reviewedBy)
  assert.equal(binding.reviewEvidence?.method, 'paired-qp-ms-page-review')
  assert.equal(sourceContent.semanticStatus, 'verified-complete', `${question.questionId} must have a complete human semantic review`)
  assert.equal(sourceContent.complete, true, `${question.questionId} must pass the effective source completeness gate`)
  assert.equal(binding.reviewEvidence.questionPaper.sha256, question.sourceRef.sha256)
  assert.equal(binding.reviewEvidence.markScheme.sha256, answer.answerRef.sha256)
  const group = normaliseQuestionGroup(question, answer)
  assert.equal(group.status, 'verified', `${question.questionId} must reconcile with its mark scheme`)
  assert.equal(group.totalMarks, question.totalMarks)
  assert.equal(binding.reviewEvidence.partAllocations.length, group.parts.length)
  for (const part of group.parts) {
    const allocation = binding.reviewEvidence.partAllocations.find((item) => item.partId === part.partId)
    const answerPart = answer.answerParts.find((item) => item.partId === part.partId)
    assert.ok(allocation && answerPart, `Missing reviewed evidence for ${part.partId}`)
    assert.equal(allocation.marks, part.marks)
    assert.equal(allocation.questionPage, part.sourcePage)
    assert.equal(allocation.markSchemePage, part.answerSourcePage)
    assert.ok(answerPart.markSchemeEvidence.length)
    assert.equal(allocation.markPointCount, answerPart.markSchemeEvidence.length)
    assert.deepEqual(allocation.markSchemeEvidence, answerPart.markSchemeEvidence.map((item) => item.text))
  }
}

const metadataByQuestion = paperQuestionMarkingMetadata({ paperId, routeId: tuple.routeId })
assert.deepEqual(Object.keys(metadataByQuestion).map(Number).sort((left, right) => left - right), numbers)
assert.equal(Object.values(metadataByQuestion).reduce((sum, metadata) => sum + metadata.maxMarks, 0), 80)
assert.equal(Object.values(metadataByQuestion).flatMap((metadata) => metadata.parts).length, 46)
assert.equal(metadataByQuestion[14].parts.find((part) => part.label === 'c').sourcePage, 9)
assert.match(metadataByQuestion[22].expectedMarkPoints.map((point) => point.point).join(' '), /7\/15 \+ 1\/5/)
assert.doesNotMatch(metadataByQuestion[22].expectedMarkPoints.map((point) => point.point).join(' '), /7\/15 \+ 1\/3/)
assert.match(metadataByQuestion[26].prompt, /4t - 3w = 11/)

const fullSubmission = buildSharedMarkingSubmission({
  attemptId: 'reviewed-full-paper-attempt',
  ...tuple,
  responses: numbers.map((questionNumber) => ({ questionNumber, typedText: 'full paper fixture', questionMetadata: metadataByQuestion[questionNumber] })),
})
assert.equal(fullSubmission.ok, true)
assert.deepEqual(fullSubmission.missingQuestionNumbers, [])
assert.equal(fullSubmission.payload.questions.length, 46)
assert.equal(fullSubmission.payload.questions.reduce((sum, question) => sum + question.availableMarks, 0), 80)

console.log('Reviewed STEM marking contract passed for Q1-Q26 (46 parts, 80 marks).')
