import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import index from '../src/data/importedQuestionIndex.json' with { type: 'json' }
import manifest from '../src/data/sourceContentManifest.json' with { type: 'json' }
import reviewedSet from '../src/data/reviewedQuestionSets/cie-0625-0625_m25_qp_22.json' with { type: 'json' }
import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { scorePaperMultipleChoice } from '../src/lib/paperMarking.js'
import { syllabusTopicsInventory, buildSyllabusPracticeSet } from '../src/lib/syllabusPractice.js'
import {
  CAMBRIDGE_0625_IGCSE_SYLLABUS,
} from '../src/data/syllabus/cambridge-0625-igcse-2026-2028.js'
import {
  CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER,
  CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER_SCHEMA_VERSION,
} from '../src/data/reviewedQuestionSets/cambridge-0625-p2-m25-review-ledger.js'
import { canonicalTextFileSha256 } from './canonical-text.mjs'

const root = path.resolve(import.meta.dirname, '..')
const ledgerPath = path.join(root, 'src', 'data', 'reviewedQuestionSets', 'cambridge-0625-p2-m25-review-ledger.js')
const paperId = CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER.paperId
const questionById = new Map(index.questions.map((question) => [question.questionId, question]))
const answerById = new Map(index.answers.map((answer) => [answer.answerId, answer]))
const bindingById = new Map(index.bindings.map((binding) => [binding.questionId, binding]))
const reviewedAnswers = new Map(reviewedSet.answers.map((answer) => [answer.answerId, answer]))

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function assetPath(url) {
  const pathname = new URL(String(url), 'https://review.invalid').pathname
  assert.ok(pathname.startsWith('/question-assets/'), `unexpected source asset ${url}`)
  return path.join(root, 'public', pathname.slice(1))
}

assert.equal(CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER_SCHEMA_VERSION, 'cambridge-0625-p2-m25-review-ledger.v1')
assert.equal(reviewedSet.schemaVersion, 'reviewed-question-set.v1')
assert.equal(reviewedSet.questionCount, 40)
assert.equal(reviewedSet.totalMarks, 40)
assert.equal(reviewedSet.sourceFragments[0].sha256, canonicalTextFileSha256(ledgerPath))
assert.equal(CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER.questions.length, 40)
assert.equal(new Set(CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER.questions.map((row) => row.questionNumber)).size, 40)

const inventory = syllabusTopicsInventory({ routeId: 'cie-0625-igcse-physics', questionBank: unifiedQuestionBank })
assert.deepEqual(inventory.topics.map((topic) => topic.id), [
  '0625-igcse-topic-01',
  '0625-igcse-topic-02',
  '0625-igcse-topic-03',
  '0625-igcse-topic-04',
  '0625-igcse-topic-05',
  '0625-igcse-topic-06',
])
assert.deepEqual(inventory.topics.map((topic) => topic.verifiedQuestionCount), [20, 14, 12, 19, 10, 5])
assert.equal(inventory.verifiedQuestionGroupCount, 80)
const electricitySet = buildSyllabusPracticeSet({
  routeId: 'cie-0625-igcse-physics',
  syllabusTopicIds: ['0625-igcse-topic-04'],
  questionCount: 5,
  components: [2],
  seed: 20260814,
  questionBank: unifiedQuestionBank,
})
assert.equal(electricitySet.questionCount, 5)
assert.ok(electricitySet.questionGroups.every((question) => question.routeId === 'cie-0625-igcse-physics' && question.paperComponent === 2))

const reviewedIds = []
for (const row of CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER.questions) {
  const questionId = `${paperId}:q${row.questionNumber}`
  const question = questionById.get(questionId)
  const answer = answerById.get(question?.answerId)
  const binding = bindingById.get(questionId)
  const artifactAnswer = reviewedAnswers.get(question?.answerId)
  assert.ok(question && answer && binding && artifactAnswer, `${questionId}: reviewed QP/MS record is missing`)
  assert.equal(binding.verificationStatus, 'reviewed')
  assert.equal(question.questionGroupStatus, 'verified')
  assert.equal(question.sourceContentComplete, true)
  assert.equal(question.syllabusMapping?.reviewStatus, 'reviewed')
  assert.equal(question.syllabusMapping.primaryTopicId, row.primaryTopicId)
  assert.deepEqual(question.syllabusMapping.syllabusPointIds, [...row.syllabusPointIds])
  assert.ok(question.syllabusMapping.syllabusPointIds.every((id) => CAMBRIDGE_0625_IGCSE_SYLLABUS.points.some((point) => point.id === id)))
  assert.equal(question.parts.length, 1)
  assert.equal(question.parts[0].sourcePage, row.questionPaperPage)
  assert.equal(answer.answerParts.length, 1)
  assert.equal(answer.answerParts[0].sourcePage, row.markSchemePage)
  assert.equal(answer.answerKey, row.correctOption)
  assert.equal(answer.exactAnswer, row.correctOption)
  assert.deepEqual(answer, artifactAnswer)

  const qpEvidence = question.parts[0].sourceEvidence
  const msEvidence = answer.answerParts[0].markSchemeEvidence
  assert.equal(qpEvidence.length, 1)
  assert.equal(msEvidence.length, 1)
  assert.equal(sha256File(assetPath(qpEvidence[0].assetUrl)), qpEvidence[0].assetSha256)
  assert.equal(sha256File(assetPath(msEvidence[0].assetUrl)), msEvidence[0].assetSha256)
  assert.equal(manifest.items[questionId]?.complete, true)
  assert.equal(manifest.items[questionId]?.semanticStatus, 'verified-complete')

  const score = scorePaperMultipleChoice({ answer: { choice: row.correctOption === 'A' ? 'B' : 'A' }, answerKey: row.correctOption, marks: 1 })
  assert.equal(score.awarded, 0, `${questionId}: an incorrect option must be deterministically scored as zero`)
  const correct = scorePaperMultipleChoice({ answer: { choice: row.correctOption }, answerKey: row.correctOption, marks: 1 })
  assert.equal(correct.awarded, 1, `${questionId}: the reviewed option must score one mark`)
  reviewedIds.push(questionId)
}

assert.equal(reviewedIds.length, 40)
assert.equal(new Set(reviewedIds).size, 40)
const canonical = unifiedQuestionBank.filter((question) => reviewedIds.includes(question.sourceQuestionId))
assert.equal(canonical.length, 40, 'all reviewed 0625 groups must enter the canonical practice bank')
assert.ok(canonical.every((question) => question.routeId === 'cie-0625-igcse-physics'))
assert.ok(canonical.every((question) => question.stage === 'IGCSE'))
assert.ok(canonical.every((question) => question.paperComponent === 2))
assert.ok(canonical.every((question) => question.answerType === 'multiple-choice' && question.answerKey))
assert.ok(canonical.every((question) => question.sourceContent?.complete === true || question.sourceContentComplete === true))

console.log(JSON.stringify({
  status: 'passed',
  paperId,
  questionCount: reviewedIds.length,
  topicCounts: Object.fromEntries(Object.entries(Object.groupBy(canonical, (question) => question.knowledgeGroupId)).map(([topicId, questions]) => [topicId, questions.length]).toSorted(([left], [right]) => left.localeCompare(right))),
  route: 'cie-0625-igcse-physics',
}, null, 2))
