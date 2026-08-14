import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import index from '../src/data/importedQuestionIndex.json' with { type: 'json' }
import manifest from '../src/data/sourceContentManifest.json' with { type: 'json' }
import reviewedSet from '../src/data/reviewedQuestionSets/cie-9702-9702_m25_qp_22.json' with { type: 'json' }
import {
  CAMBRIDGE_9702_P2_M25_REVIEW_LEDGER,
  CAMBRIDGE_9702_P2_M25_REVIEW_LEDGER_SCHEMA_VERSION,
} from '../src/data/reviewedQuestionSets/cambridge-9702-p2-m25-review-ledger.js'
import { canonicalTextFileSha256 } from './canonical-text.mjs'

const root = path.resolve(import.meta.dirname, '..')
const ledgerPath = path.join(root, 'src', 'data', 'reviewedQuestionSets', 'cambridge-9702-p2-m25-review-ledger.js')
const questionById = new Map(index.questions.map((question) => [question.questionId, question]))
const answerById = new Map(index.answers.map((answer) => [answer.answerId, answer]))
const bindingById = new Map(index.bindings.map((binding) => [binding.questionId, binding]))
const reviewedAnswerById = new Map(reviewedSet.answers.map((answer) => [answer.answerId, answer]))

assert.equal(reviewedSet.schemaVersion, 'reviewed-question-set.v1')
assert.equal(reviewedSet.paperId, 'cie-9702-9702_m25_qp_22')
assert.equal(reviewedSet.questionCount, 7)
assert.equal(reviewedSet.totalMarks, 60)
assert.equal(reviewedSet.sourceFragments[0].file, 'cambridge-9702-p2-m25-review-ledger.js')
assert.equal(reviewedSet.sourceFragments[0].sha256, canonicalTextFileSha256(ledgerPath), 'generated review artifact must pin the ledger checksum')
assert.equal(CAMBRIDGE_9702_P2_M25_REVIEW_LEDGER_SCHEMA_VERSION, 'cambridge-9702-p2-m25-review-ledger.v1')
assert.equal(CAMBRIDGE_9702_P2_M25_REVIEW_LEDGER.questions.length, 7)
assert.equal(CAMBRIDGE_9702_P2_M25_REVIEW_LEDGER.questions.reduce((sum, question) => sum + question.totalMarks, 0), 60)

for (const question of reviewedSet.questions) {
  const currentQuestion = questionById.get(question.questionId)
  const currentAnswer = answerById.get(question.answerId)
  const currentBinding = bindingById.get(question.questionId)
  const artifactAnswer = reviewedAnswerById.get(question.answerId)
  assert.deepEqual(currentQuestion, question, `${question.questionId}: generated review artifact must be in the canonical index`)
  assert.deepEqual(currentAnswer, artifactAnswer, `${question.questionId}: generated answer artifact must be in the canonical index`)
  assert.equal(currentBinding?.verificationStatus, 'reviewed', `${question.questionId}: answer binding must be reviewed`)
  assert.equal(question.questionGroupStatus, 'verified')
  assert.equal(question.sourceRef.pageEnd >= question.sourceRef.pageStart, true)
  assert.equal(question.answerType, 'structured')
  assert.ok(question.parts.length > 0)
  assert.equal(question.totalMarks, question.parts.reduce((sum, part) => sum + part.marks, 0))
  assert.ok(question.parts.every((part) => (
    part.sourceEvidence.length > 0
    && part.sourceEvidence.every((evidence) => evidence.assetSha256 && evidence.documentSha256 && evidence.assetUrl)
    && !('markSchemePoints' in part)
    && !('answerText' in part)
    && !('markSchemeEvidence' in part)
  )), `${question.questionId}: every part must retain QP evidence and one MS point per mark`)
  assert.equal(question.parts.length, artifactAnswer.answerParts.length)
  assert.ok(artifactAnswer.answerParts.every((part) => (
    part.markSchemePoints.length === part.marks
    && part.answerText
    && part.markSchemeEvidence.length === part.marks
    && part.markSchemeEvidence.every((evidence) => evidence.assetSha256 && evidence.documentSha256 && evidence.assetUrl)
  )), `${question.questionId}: every answer part must retain hash-bound MS evidence`)
  assert.ok(currentBinding.reviewEvidence.partAllocations.every((allocation) => (
    allocation.markPointCount === allocation.marks
    && allocation.markSchemeEvidence.length === allocation.marks
  )), `${question.questionId}: reviewer allocations must cover each mark point`)
  const manifestItem = manifest.items[question.questionId]
  assert.equal(manifestItem?.complete, true, `${question.questionId}: runtime source manifest must remain complete`)
  assert.equal(manifestItem?.semanticStatus, 'verified-complete', `${question.questionId}: runtime source manifest must remain semantically reviewed`)
}

const sourceIndexSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'src', 'data', 'importedQuestionIndex.json'))).digest('hex')
assert.ok(sourceIndexSha.length === 64)

console.log(JSON.stringify({
  status: 'passed',
  paperId: reviewedSet.paperId,
  questionCount: reviewedSet.questionCount,
  totalMarks: reviewedSet.totalMarks,
  reviewer: CAMBRIDGE_9702_P2_M25_REVIEW_LEDGER.reviewedBy,
}))
