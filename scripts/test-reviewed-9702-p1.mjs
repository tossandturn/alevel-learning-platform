import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import importedQuestionIndex from '../src/data/importedQuestionIndex.json' with { type: 'json' }
import sourceContentManifest from '../src/data/sourceContentManifest.json' with { type: 'json' }
import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { buildSyllabusPracticeSet, syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { reviewedSourceFocusBinding } from '../src/lib/questionContent.js'
import { CAMBRIDGE_9702_P1_2025_REVIEW_LEDGER } from '../src/data/reviewedQuestionSets/cambridge-9702-p1-2025-review-ledger.js'

const root = path.resolve(import.meta.dirname, '..')
const routeId = 'cie-9702-as-physics'
const answerById = new Map(importedQuestionIndex.answers.map((answer) => [answer.answerId, answer]))
const bindingByQuestionId = new Map(importedQuestionIndex.bindings.map((binding) => [binding.questionId, binding]))
const questionById = new Map(importedQuestionIndex.questions.map((question) => [question.questionId, question]))

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function assetPath(url) {
  const pathname = new URL(String(url), 'https://review.invalid').pathname
  assert.ok(pathname.startsWith('/question-assets/'), `Untrusted review asset ${url}`)
  return path.join(root, 'public', pathname.slice(1))
}

const reviewedIds = []
for (const paper of CAMBRIDGE_9702_P1_2025_REVIEW_LEDGER) {
  assert.equal(paper.rows.length, 40, `${paper.paperId}: manual review must contain all 40 questions`)
  assert.deepEqual(paper.rows.map((row) => row.questionNumber), Array.from({ length: 40 }, (_value, index) => index + 1), `${paper.paperId}: review rows must remain in official printed order`)

  for (const row of paper.rows) {
    const questionId = `${paper.paperId}:q${row.questionNumber}`
    const question = questionById.get(questionId)
    const answer = answerById.get(question?.answerId)
    const binding = bindingByQuestionId.get(questionId)
    assert.ok(question && answer && binding, `${questionId}: reviewed QP/MS record is missing`)
    assert.equal(binding.verificationStatus, 'reviewed', `${questionId}: manual review must be retained`)
    assert.equal(question.syllabusMapping?.reviewStatus, 'reviewed', `${questionId}: manual syllabus mapping must be retained`)
    assert.equal(question.syllabusMapping?.primaryTopicId, row.primaryTopicId, `${questionId}: primary syllabus topic changed`)
    assert.deepEqual(question.syllabusMapping?.syllabusPointIds, [...row.syllabusPointIds], `${questionId}: official syllabus point changed`)
    assert.equal(question.parts[0].sourcePage, row.questionPaperPage, `${questionId}: reviewed QP page changed`)
    assert.equal(answer.answerParts[0].sourcePage, row.markSchemePage, `${questionId}: reviewed MS page changed`)
    assert.equal(question.syllabusMapping?.reviewedBy, row.reviewedBy, `${questionId}: reviewer identity changed`)
    assert.equal(question.syllabusMapping?.reviewedAt, row.reviewedAt, `${questionId}: reviewer timestamp changed`)
    assert.equal(answer.answerKey, row.correctOption, `${questionId}: paired mark-scheme option changed`)
    assert.equal(answer.exactAnswer, row.correctOption, `${questionId}: exact reviewed mark-scheme option changed`)
    assert.equal(question.parts.length, 1, `${questionId}: P1 must remain a single question-part group`)
    assert.equal(answer.answerParts.length, 1, `${questionId}: P1 answer must remain one part`)

    const sourceEvidence = question.parts[0].sourceEvidence
    const markSchemeEvidence = answer.answerParts[0].markSchemeEvidence
    assert.equal(sourceEvidence.length, 1, `${questionId}: QP asset evidence is required`)
    assert.equal(markSchemeEvidence.length, 1, `${questionId}: MS asset evidence is required`)
    assert.equal(sha256File(assetPath(sourceEvidence[0].assetUrl)), sourceEvidence[0].assetSha256, `${questionId}: QP asset bytes changed`)
    assert.equal(sha256File(assetPath(markSchemeEvidence[0].assetUrl)), markSchemeEvidence[0].assetSha256, `${questionId}: MS asset bytes changed`)
    assert.equal(sourceEvidence[0].coordinateSpace, 'pixel-xyxy', `${questionId}: reviewed crop must declare pixel coordinates`)
    assert.deepEqual(sourceEvidence[0].imageSize, [1020, 1320], `${questionId}: reviewed crop image size must match the official render`)
    assert.deepEqual(sourceEvidence[0].region, binding.reviewEvidence.partAllocations[0].questionRegion, `${questionId}: crop and allocation bounds must match`)
    assert.equal(sourceEvidence[0].safetyStatus, 'reviewed-display-bounds-v1', `${questionId}: crop safety review is required`)
    assert.ok(sourceEvidence[0].safetyMargin.every((value) => Number(value) >= 12), `${questionId}: crop safety margin is too small`)
    const focusQuestion = unifiedQuestionBank.find((candidate) => candidate.sourceQuestionId === questionId)
    const focus = reviewedSourceFocusBinding(focusQuestion)
    assert.equal(focus.complete, true, `${questionId}: reviewed QP crop must be available at runtime`)
    assert.ok(focus.pages.every((page) => page.region[0] >= 0 && page.region[1] >= 0 && page.region[2] <= 1020 && page.region[3] <= 1320), `${questionId}: crop must stay inside the QP image`)
    assert.equal(question.contentAnalysis?.status, 'reviewed', `${questionId}: reviewed content analysis is required`)
    assert.equal(question.contentAnalysis?.syllabusTopicId, row.primaryTopicId, `${questionId}: content analysis topic must match the syllabus mapping`)
    assert.equal(sourceContentManifest.items[questionId]?.complete, true, `${questionId}: runtime source gate must allow the reviewed QP/MS pair`)
    assert.equal(sourceContentManifest.items[questionId]?.semanticStatus, 'verified-complete', `${questionId}: semantic source review must remain complete`)
    reviewedIds.push(questionId)
  }
}

const focusTamperFixture = structuredClone(unifiedQuestionBank.find((question) => question.sourceQuestionId === reviewedIds[0]))
focusTamperFixture.parts[0].sourceEvidence[0].region = [80, 0, 950, 275]
assert.equal(reviewedSourceFocusBinding(focusTamperFixture).complete, false, 'tampered crop evidence must fail closed')

const reviewedS25Q18 = unifiedQuestionBank.find((question) => question.sourceQuestionId === 'cie-9702-9702_s25_qp_11:q18')
const reviewedS25Q18Focus = reviewedSourceFocusBinding(reviewedS25Q18)
assert.equal(reviewedS25Q18Focus.complete, true, 'S25 Q18 must retain a reviewed focus crop')
assert.deepEqual(reviewedS25Q18Focus.pages[0].region, [80, 310, 950, 930], 'S25 Q18 focus crop must stop before adjacent Q19')
assert.ok(reviewedS25Q18Focus.pages[0].safetyMargin.every((value) => value >= 20), 'S25 Q18 focus crop must retain its reviewed safety margin')

const workspaceSource = fs.readFileSync(path.join(root, 'src', 'components', 'PracticeWorkspace.jsx'), 'utf8')
assert.match(workspaceSource, /!activePart\.sourceRef\?\.paperId && <h2>/, 'official past-paper OCR must not be rendered as duplicate student prompt text')

assert.equal(reviewedIds.length, 80, 'two full P1 reviews must produce exactly 80 reviewed groups')
assert.equal(new Set(reviewedIds).size, 80, 'reviewed P1 group IDs must be unique')
assert.equal(
  unifiedQuestionBank.filter((question) => reviewedIds.includes(question.sourceQuestionId)).length,
  80,
  'every reviewed P1 group must be in the canonical practice bank',
)

const inventory = syllabusTopicsInventory({ routeId, questionBank: unifiedQuestionBank })
assert.equal(inventory.verifiedQuestionGroupCount, 112, '9702 AS inventory must expose the reviewed P1 and P2 source batches')
assert.ok(inventory.topics.every((topic) => topic.verifiedQuestionCount >= 10), 'every official 9702 AS topic requires at least ten reviewed groups before release')

for (const topic of inventory.topics) {
  const set = buildSyllabusPracticeSet({
    routeId,
    syllabusTopicIds: [topic.id],
    questionCount: 5,
    components: [1],
    seed: 20260814,
    questionBank: unifiedQuestionBank,
  })
  assert.equal(set.questionCount, 5, `${topic.id}: coverage must support a five-question AS Paper 1 drill`)
  assert.ok(set.questionGroups.every((question) => question.paperComponent === 1), `${topic.id}: P1 topic drill must not mix components`)
  assert.ok(set.questionGroups.every((question) => reviewedIds.includes(question.id)), `${topic.id}: only reviewed P1 groups may enter the coverage drill`)

  const attemptedId = set.questionGroups[0].id
  const unseenFirst = buildSyllabusPracticeSet({
    routeId,
    syllabusTopicIds: [topic.id],
    questionCount: 1,
    components: [1],
    attemptedQuestionIds: [attemptedId],
    excludeAttempted: true,
    seed: 20260814,
    questionBank: unifiedQuestionBank,
  })
  assert.notEqual(unseenFirst.questionGroups[0].id, attemptedId, `${topic.id}: Topic Drill must prefer a question the student has not attempted`)
}

console.log(JSON.stringify({
  status: 'passed',
  reviewedQuestionGroups: reviewedIds.length,
  verifiedByTopic: Object.fromEntries(inventory.topics.map((topic) => [topic.id, topic.verifiedQuestionCount])),
}, null, 2))
