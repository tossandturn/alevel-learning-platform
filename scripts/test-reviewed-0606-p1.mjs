import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import index from '../src/data/importedQuestionIndex.json' with { type: 'json' }
import manifest from '../src/data/sourceContentManifest.json' with { type: 'json' }
import reviewedSet from '../src/data/reviewedQuestionSets/cie-0606-0606_m25_qp_12.json' with { type: 'json' }
import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { syllabusTopicsInventory, buildSyllabusPracticeSet } from '../src/lib/syllabusPractice.js'
import { CAMBRIDGE_0606_IGCSE_SYLLABUS } from '../src/data/syllabus/cambridge-0606-igcse-2025-2027.js'
import {
  CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER,
  CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER_SCHEMA_VERSION,
} from '../src/data/reviewedQuestionSets/cambridge-0606-p1-m25-review-ledger.js'
import { canonicalTextFileSha256 } from './canonical-text.mjs'

const root = path.resolve(import.meta.dirname, '..')
const paperId = CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.paperId
const ledgerPath = path.join(root, 'src', 'data', 'reviewedQuestionSets', 'cambridge-0606-p1-m25-review-ledger.js')
const questionById = new Map(index.questions.map((question) => [question.questionId, question]))
const answerById = new Map(index.answers.map((answer) => [answer.answerId, answer]))
const bindingById = new Map(index.bindings.map((binding) => [binding.questionId, binding]))
const artifactAnswers = new Map(reviewedSet.answers.map((answer) => [answer.answerId, answer]))

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function assetPath(url) {
  const pathname = new URL(String(url), 'https://review.invalid').pathname
  assert.ok(pathname.startsWith('/question-assets/'), `unexpected source asset ${url}`)
  return path.join(root, 'public', pathname.slice(1))
}

function pagesFromAssets(urls, prefix) {
  return [...new Set(urls.map((url) => Number(String(url).match(new RegExp(`${prefix}-(\\d+)\\.`))?.[1])))].toSorted((a, b) => a - b)
}

assert.equal(CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER_SCHEMA_VERSION, 'cambridge-0606-p1-m25-review-ledger.v1')
assert.equal(reviewedSet.schemaVersion, 'reviewed-question-set.v1')
assert.equal(reviewedSet.sourceFragments[0].sha256, canonicalTextFileSha256(ledgerPath))
assert.equal(reviewedSet.questionCount, 12)
assert.equal(reviewedSet.totalMarks, 80)
assert.deepEqual(CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.rows.map((row) => row.questionNumber), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

const inventory = syllabusTopicsInventory({ routeId: CAMBRIDGE_0606_IGCSE_SYLLABUS.routeId, questionBank: unifiedQuestionBank })
assert.equal(inventory.verifiedQuestionGroupCount, 12)
assert.ok(inventory.topics.every((topic) => topic.ready === false), 'one paper must not claim a ten-question topic drill')
assert.ok(inventory.topics.every((topic) => topic.ctaPolicy !== 'start'), 'below-threshold 0606 topics must not expose Start')

const rowsByQuestion = new Map(CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.rows.map((row) => [row.questionNumber, row]))
const reviewedIds = []
for (const questionNumber of CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.rows.map((row) => row.questionNumber)) {
  const questionId = `${paperId}:q${questionNumber}`
  const question = questionById.get(questionId)
  const answer = answerById.get(question?.answerId)
  const binding = bindingById.get(questionId)
  const artifactAnswer = artifactAnswers.get(question?.answerId)
  const row = rowsByQuestion.get(questionNumber)
  assert.ok(question && answer && binding && artifactAnswer, `${questionId}: reviewed QP/MS record is missing`)
  assert.equal(binding.verificationStatus, 'reviewed')
  assert.equal(question.questionGroupStatus, 'verified')
  assert.equal(manifest.items[questionId]?.complete, true)
  assert.equal(manifest.items[questionId]?.semanticStatus, 'verified-complete')
  assert.equal(question.syllabusMapping?.reviewStatus, 'reviewed')
  assert.equal(question.syllabusMapping.primaryTopicId, row.topicId)
  assert.deepEqual(question.syllabusMapping.syllabusPointIds, [row.pointId])
  assert.ok(CAMBRIDGE_0606_IGCSE_SYLLABUS.points.some((point) => point.id === row.pointId))
  assert.equal(question.totalMarks, row.parts.reduce((sum, part) => sum + part.marks, 0))
  assert.equal(question.parts.length, row.parts.length)
  assert.equal(answer.answerParts.length, row.parts.length)
  assert.deepEqual(answer, artifactAnswer)

  const qpPages = pagesFromAssets(question.sourceRef.assetUrls, 'qp')
  const msPages = pagesFromAssets(answer.answerRef.assetUrls, 'ms')
  assert.deepEqual(qpPages, [...new Set(row.parts.map((part) => part.questionPage))].toSorted((a, b) => a - b), `${questionId}: QP pages must match reviewed parts`)
  assert.deepEqual(msPages, [row.markSchemePage], `${questionId}: MS page must match reviewed evidence`)
  assert.equal(question.sourceRef.pageStart, qpPages[0])
  assert.equal(question.sourceRef.pageEnd, qpPages.at(-1))
  for (const part of question.parts) {
    assert.ok(qpPages.includes(part.sourcePage), `${questionId}:${part.label}: QP part page is not bound`)
    for (const evidence of part.sourceEvidence) {
      assert.equal(evidence.sourcePage, part.sourcePage)
      assert.equal(sha256File(assetPath(evidence.assetUrl)), evidence.assetSha256, `${questionId}:${part.label}: QP asset hash mismatch`)
      assert.equal(fs.statSync(assetPath(evidence.assetUrl)).size > 0, true)
    }
  }
  for (const part of answer.answerParts) {
    assert.equal(part.sourcePage, row.markSchemePage)
    for (const evidence of part.markSchemeEvidence) {
      assert.equal(evidence.sourcePage, row.markSchemePage)
      assert.equal(sha256File(assetPath(evidence.assetUrl)), evidence.assetSha256, `${questionId}:${part.label}: MS asset hash mismatch`)
    }
  }
  reviewedIds.push(questionId)
}

assert.deepEqual(pagesFromAssets(questionById.get(`${paperId}:q7`).sourceRef.assetUrls, 'qp'), [8, 9], 'Q7 must retain both QP pages')
assert.deepEqual(pagesFromAssets(questionById.get(`${paperId}:q11`).sourceRef.assetUrls, 'qp'), [14, 15], 'Q11 must retain both QP pages')
assert.deepEqual(pagesFromAssets(questionById.get(`${paperId}:q10`).sourceRef.assetUrls, 'qp'), [12], 'Q10 must exclude page 13 working space')
assert.deepEqual(pagesFromAssets(questionById.get(`${paperId}:q12`).sourceRef.assetUrls, 'qp'), [16], 'Q12 must exclude the preceding question page')

const canonical = unifiedQuestionBank.filter((question) => reviewedIds.includes(question.sourceQuestionId))
assert.equal(canonical.length, 12, 'all reviewed 0606 groups must enter the canonical practice bank')
assert.ok(canonical.every((question) => question.routeId === CAMBRIDGE_0606_IGCSE_SYLLABUS.routeId))
assert.ok(canonical.every((question) => question.stage === 'IGCSE'))
assert.ok(canonical.every((question) => [1, 2].includes(question.paperComponent)))
assert.ok(canonical.every((question) => question.sourceContent?.complete === true))

const shortSet = buildSyllabusPracticeSet({
  routeId: CAMBRIDGE_0606_IGCSE_SYLLABUS.routeId,
  syllabusTopicIds: ['math-0606-calculus'],
  questionCount: 5,
  components: [1],
  seed: 20260815,
  questionBank: unifiedQuestionBank,
})
assert.equal(shortSet.questionCount, 3, '0606 topic practice must return the available count, not fabricate five groups')
assert.equal(shortSet.availableCount, 3)
assert.ok(shortSet.questionGroups.every((question) => question.questionGroupId.startsWith(`${paperId}:`)))

console.log(JSON.stringify({
  status: 'passed',
  paperId,
  questionCount: reviewedIds.length,
  totalMarks: reviewedSet.totalMarks,
  topicCounts: Object.fromEntries(Object.entries(Object.groupBy(canonical, (question) => question.knowledgeGroupId)).map(([topicId, questions]) => [topicId, questions.length]).toSorted(([left], [right]) => left.localeCompare(right))),
}, null, 2))
