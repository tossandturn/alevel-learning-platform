import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import index from '../src/data/importedQuestionIndex.json' with { type: 'json' }
import manifest from '../src/data/sourceContentManifest.json' with { type: 'json' }
import { isHumanReviewedPastPaperItem, unifiedQuestionBank } from '../src/data/questionBank.js'
import { topicPracticeEligibility } from '../src/lib/practiceConstants.js'
import { buildSyllabusPracticeSet, syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import {
  CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_LEDGERS,
  CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_SCHEMA_VERSION,
} from '../src/data/reviewedQuestionSets/cambridge-9702-p2-topic-coverage-review-ledger.js'
import { canonicalTextFileSha256 } from './canonical-text.mjs'

const root = path.resolve(import.meta.dirname, '..')
const reviewedSetsRoot = path.join(root, 'src', 'data', 'reviewedQuestionSets')
const ledgerPath = path.join(reviewedSetsRoot, 'cambridge-9702-p2-topic-coverage-review-ledger.js')
const ledgerSha256 = canonicalTextFileSha256(ledgerPath)
const questionById = new Map(index.questions.map((question) => [question.questionId, question]))
const answerById = new Map(index.answers.map((answer) => [answer.answerId, answer]))
const bindingById = new Map(index.bindings.map((binding) => [binding.questionId, binding]))
const heldCorrectionId = 'cie-9702-9702_s25_qp_22:q1'
const heldCorrection = Object.freeze({
  totalMarks: 10,
  partMarks: [2, 3, 1, 3, 1],
  reviewedAt: '2026-09-25T15:18:38+08:00',
})
const exactReviewedMarkPoints = new Map([
  ['cie-9702-9702_m24_qp_22:q1:part-c', ['power = intensity x area', 'power = 950 x 2.2 x 10^-4', 'power = 0.21 W']],
  ['cie-9702-9702_s25_qp_24:q5:part-b(ii)', ['current in metal wire = 3.3 - 1.5 = 1.8 A', 'I = Anvq; 1.8 = 1.4 x 10^-9 x 3.4 x 10^28 x v x 1.6 x 10^-19', 'v = 0.24 m s^-1']],
  ['cie-9702-9702_w25_qp_21:q2:part-a(ii)', ['a pressure difference exists between the top and bottom of the ball because their depths differ', 'the greater pressure at the bottom gives a greater upward force than the downward force at the top, so the resultant force is upwards']],
  ['cie-9702-9702_w25_qp_21:q2:part-b(i)', ['arrow vertically downwards labelled weight', 'arrow vertically upwards labelled upthrust', 'arrow vertically upwards labelled viscous drag']],
  ['cie-9702-9702_w25_qp_21:q2:part-c(ii)', ['at terminal speed, weight = drag + upthrust', '2.4 x 10^-3 x 9.81 = 2.8 x 10^-3 + 6pi x 4.7 x 4.2 x 10^-3 x v', 'v = 0.056 m s^-1']],
  ['cie-9702-9702_w25_qp_21:q5:part-b(ii)', ['the resistance of T decreases, so the total resistance of the circuit decreases', 'the current in the cell increases, so the potential difference across the internal resistance increases', 'the terminal potential difference decreases and, because the resistance of R is constant, the current in R decreases']],
  ['cie-9702-9702_w25_qp_22:q1:part-a', ['air temperature: K; air pressure: kg m^-1 s^-2', 'scalar is selected for both air temperature and air pressure']],
  ['cie-9702-9702_w25_qp_22:q6:part-b(ii)', ['E_k = 1/2 mv^2', '2.1 x 10^-16 = 1/2 x 0.67 x 1.66 x 10^-27 x v^2', 'v = 6.1 x 10^5 m s^-1']],
  ['cie-9702-9702_w25_qp_22:q6:part-c(ii)', ['number of nucleons = 228 - 5 x 4 = 208; number of protons = 88 - 5 x 2 + 4 = 82', 'number of neutrons = 208 - 82 = 126']],
  ['cie-9702-9702_w25_qp_24:q1:part-a(i)', ['horizontal velocity = 28 cos 34 degrees = 23 m s^-1', 'vertical velocity = 28 sin 34 degrees = 16 m s^-1']],
  ['cie-9702-9702_w25_qp_24:q1:part-a(iv)', ['straight diagonal line from t = 0 to t = 3.2 s, starting at positive velocity and crossing the time axis', 'line starts at v = 16 m s^-1 and ends at v = -16 m s^-1', 'line passes through v = 0 at t = 1.6 s']],
  ['cie-9702-9702_w25_qp_24:q3:part-d', ['all gravitational potential energy has been converted to, or is equal to, elastic potential energy, so there is no kinetic energy', 'kinetic energy is zero, so speed is zero']],
])
const newlyReviewedGroups = new Map([
  ['cie-9702-9702_m24_qp_22:q2', { totalMarks: 11, primaryTopicId: 'physics-9702-topic-02', secondaryTopicIds: ['physics-9702-topic-04'], reviewedAt: '2026-09-02T17:41:59+08:00' }],
  ['cie-9702-9702_s25_qp_21:q4', { totalMarks: 8, primaryTopicId: 'physics-9702-topic-08', secondaryTopicIds: ['physics-9702-topic-07'], reviewedAt: '2026-09-02T17:41:59+08:00' }],
  ['cie-9702-9702_s25_qp_23:q6', { totalMarks: 8, primaryTopicId: 'physics-9702-topic-08', secondaryTopicIds: ['physics-9702-topic-07'], reviewedAt: '2026-09-02T17:41:59+08:00' }],
  ['cie-9702-9702_m24_qp_22:q4', { totalMarks: 6, primaryTopicId: 'physics-9702-topic-11', secondaryTopicIds: [], reviewedAt: '2026-09-02T17:41:59+08:00' }],
  ['cie-9702-9702_m24_qp_22:q8', { totalMarks: 6, primaryTopicId: 'physics-9702-topic-11', secondaryTopicIds: [], reviewedAt: '2026-09-02T17:41:59+08:00' }],
  ['cie-9702-9702_s25_qp_23:q2', { totalMarks: 9, primaryTopicId: 'physics-9702-topic-06', secondaryTopicIds: ['physics-9702-topic-04'], reviewedAt: '2026-09-02T19:03:24+08:00' }],
  ['cie-9702-9702_w25_qp_22:q3', { totalMarks: 9, primaryTopicId: 'physics-9702-topic-06', secondaryTopicIds: ['physics-9702-topic-04', 'physics-9702-topic-05'], reviewedAt: '2026-09-02T19:03:24+08:00' }],
])
const historicalReviewedIds = []
const eligibleReviewedIds = []

function assetFile(url) {
  const pathname = new URL(String(url), 'https://test.invalid').pathname
  assert.ok(pathname.startsWith('/question-assets/'))
  return path.join(root, 'public', ...pathname.split('/').filter(Boolean))
}

function actualAssetSha256(url) {
  const filePath = assetFile(url)
  assert.ok(fs.existsSync(filePath), `reviewed source asset is missing: ${url}`)
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

assert.equal(CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_SCHEMA_VERSION, 'cambridge-9702-p2-topic-coverage-review.v1')
assert.equal(CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_LEDGERS.length, 9)
assert.equal(CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_LEDGERS.reduce((sum, paper) => sum + paper.questions.length, 0), 33)

for (const paperReview of CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_LEDGERS) {
  assert.equal(paperReview.component, 2, `${paperReview.paperId}: supplemental Topic coverage must remain Paper 2 theory`)
  assert.equal(paperReview.manualVisualReview, true, `${paperReview.paperId}: review ledger must record the visual review procedure`)
  const artifactPath = path.join(reviewedSetsRoot, `${paperReview.paperId}.json`)
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  assert.equal(artifact.schemaVersion, 'reviewed-question-set.v1')
  assert.equal(artifact.paperId, paperReview.paperId)
  assert.equal(artifact.questionCount, paperReview.questions.length)
  assert.equal(artifact.sourceFragments[0].sha256, ledgerSha256, `${paperReview.paperId}: generated artifact must pin the review ledger`)

  for (const reviewedQuestion of paperReview.questions) {
    const questionId = `${paperReview.paperId}:q${reviewedQuestion.questionNumber}`
    historicalReviewedIds.push(questionId)
    const question = questionById.get(questionId)
    const binding = bindingById.get(questionId)
    const answer = answerById.get(binding?.answerId)
    const artifactQuestion = artifact.questions.find((candidate) => candidate.questionId === questionId)
    const artifactAnswer = artifact.answers.find((candidate) => candidate.answerId === binding?.answerId)
    assert.ok(question && answer && binding && artifactQuestion && artifactAnswer, `${questionId}: reviewed entities must exist`)
    if (questionId === heldCorrectionId) {
      assert.equal(reviewedQuestion.totalMarks, 17, `${questionId}: the historical visual-review ledger must remain an auditable superseded snapshot`)
      assert.equal(artifactQuestion.totalMarks, reviewedQuestion.totalMarks, `${questionId}: the generated historical review artifact must remain pinned to its ledger`)
      assert.equal(question.questionGroupStatus, 'quarantined', `${questionId}: the corrected record must fail closed without human re-approval`)
      assert.equal(question.totalMarks, heldCorrection.totalMarks, `${questionId}: OR alternatives must not be added as separate marks`)
      assert.equal(question.marks, heldCorrection.totalMarks)
      assert.deepEqual(question.parts.map((part) => part.marks), heldCorrection.partMarks, `${questionId}: corrected part allocations must sum to the official ten marks`)
      assert.equal(question.parts.reduce((sum, part) => sum + part.marks, 0), heldCorrection.totalMarks)
      assert.equal(answer.answerParts.reduce((sum, part) => sum + part.marks, 0), heldCorrection.totalMarks)
      assert.equal(answer.markPoints.length, heldCorrection.totalMarks)
      assert.equal(question.studentStudyEligible, false)
      assert.equal(question.formalProgressEligible, false)
      assert.equal(question.syllabusMapping.mappingMethod, 'ai-source-correction')
      assert.equal(question.syllabusMapping.reviewStatus, 'quarantined')
      assert.equal(question.syllabusMapping.reviewedAt, heldCorrection.reviewedAt)
      assert.equal(binding.verificationStatus, 'quarantined')
      assert.equal(binding.reviewedAt, heldCorrection.reviewedAt)
      assert.equal(binding.reviewEvidence?.manualVisualReview, false)
      assert.equal(binding.reviewEvidence?.correctionAuthority, 'AI source review; not human approval')
      assert.match(binding.reviewEvidence?.correctionReason || '', /OR alternatives are not additive marks/)
      assert.deepEqual(
        question.sourceRef.assetUrls.map((url) => Number(url.match(/qp-(\d+)\./)?.[1])),
        reviewedQuestion.questionPages,
        `${questionId}: the correction must retain its QP pages`,
      )
      assert.deepEqual(
        answer.answerRef.assetUrls.map((url) => Number(url.match(/ms-(\d+)\./)?.[1])),
        reviewedQuestion.markSchemePages,
        `${questionId}: the correction must retain its MS pages`,
      )
      assert.ok(question.parts.every((part) => {
        const answerPart = answer.answerParts.find((candidate) => candidate.partId === part.partId)
        const allocation = binding.reviewEvidence.partAllocations.find((candidate) => candidate.partId === part.partId)
        const questionEvidence = part.sourceEvidence[0]
        return questionEvidence?.assetSha256 === actualAssetSha256(questionEvidence.assetUrl)
          && answerPart?.markSchemeEvidence?.length === part.marks
          && answerPart.markSchemeEvidence.every((evidence) => evidence.assetSha256 === actualAssetSha256(evidence.assetUrl))
          && allocation?.markPointCount === part.marks
          && allocation?.markSchemeEvidence?.length === part.marks
      }), `${questionId}: corrected marks must retain byte-verified QP/MS evidence`)
      assert.equal(manifest.items[questionId]?.fileComplete, true)
      assert.equal(manifest.items[questionId]?.complete, false)
      assert.equal(manifest.items[questionId]?.semanticStatus, 'semantic-quarantined')
      assert.ok(manifest.items[questionId]?.reasons?.includes('index-quarantined'))
      assert.equal(unifiedQuestionBank.some((candidate) => candidate.sourceQuestionId === questionId), false, `${questionId}: quarantined correction must not enter the formal runtime bank`)
      continue
    }
    eligibleReviewedIds.push(questionId)
    assert.deepEqual(question, artifactQuestion, `${questionId}: generated question must be canonical`)
    assert.deepEqual(answer, artifactAnswer, `${questionId}: generated answer must be canonical`)
    assert.equal(binding.verificationStatus, 'reviewed')
    assert.equal(binding.reviewEvidence?.method, 'paired-qp-ms-page-review')
    assert.equal(binding.reviewEvidence?.manualVisualReview, true)
    assert.equal(binding.reviewEvidence?.studentPromptPolicy, 'official-source-image')
    assert.equal(binding.reviewEvidence?.privateTextPolicy, 'hidden-indexing-and-marking-context')
    assert.equal(question.sourceRef.component, 2, `${questionId}: P2 must not be relabelled as P1 or P3`)
    assert.equal(question.questionGroupStatus, 'verified')
    assert.equal(question.totalMarks, reviewedQuestion.totalMarks)
    assert.equal(question.syllabusMapping.reviewStatus, 'reviewed')
    assert.equal(question.syllabusMapping.primaryTopicId, reviewedQuestion.primaryTopicId)
    assert.deepEqual(question.syllabusMapping.syllabusPointIds, reviewedQuestion.syllabusPointIds)
    const newlyReviewed = newlyReviewedGroups.get(questionId)
    if (newlyReviewed) {
      assert.equal(question.totalMarks, newlyReviewed.totalMarks, `${questionId}: official QP total marks must override the incomplete machine segmentation`)
      assert.equal(question.topicId, newlyReviewed.primaryTopicId, `${questionId}: top-level topic must match the reviewed primary topic`)
      assert.equal(question.knowledgeGroupId, newlyReviewed.primaryTopicId, `${questionId}: knowledge-group topic must match the reviewed primary topic`)
      assert.equal(question.syllabusMapping.knowledgeGroupId, newlyReviewed.primaryTopicId, `${questionId}: mapping knowledge-group topic must match the reviewed primary topic`)
      assert.deepEqual(question.syllabusMapping.secondaryTopicIds, newlyReviewed.secondaryTopicIds, `${questionId}: secondary topic memberships must remain explicit`)
      assert.equal(question.syllabusMapping.reviewedAt, newlyReviewed.reviewedAt, `${questionId}: review timestamp must reflect the current visual review`)
    }
    assert.deepEqual(
      question.sourceRef.assetUrls.map((url) => Number(url.match(/qp-(\d+)\./)?.[1])),
      reviewedQuestion.questionPages,
      `${questionId}: every reviewed QP page must remain attached`,
    )
    assert.deepEqual(
      answer.answerRef.assetUrls.map((url) => Number(url.match(/ms-(\d+)\./)?.[1])),
      reviewedQuestion.markSchemePages,
      `${questionId}: every reviewed MS page must remain attached`,
    )
    assert.deepEqual(
      question.parts.map((part) => {
        const answerPart = answer.answerParts.find((candidate) => candidate.partId === part.partId)
        return [part.label, part.marks, part.sourcePage, answerPart?.sourcePage]
      }),
      reviewedQuestion.parts.map((part) => [part.label, part.marks, part.questionPage, part.markSchemePage]),
      `${questionId}: parts, marks and QP/MS pages must match the visual review ledger`,
    )
    assert.ok(answer.answerParts.every((part) => !(part.markSchemePoints || []).some((point) => /criterion \d+ of \d+; inspect the hash-bound mark-scheme image/i.test(point))), `${questionId}: reviewed marking evidence must never contain synthetic fallback criteria`)
    for (const part of answer.answerParts) {
      const expected = exactReviewedMarkPoints.get(part.partId)
      if (expected) assert.deepEqual(part.markSchemePoints, expected, `${part.partId}: exact visually reviewed mark-scheme points must remain canonical`)
    }
    assert.ok(question.parts.every((part) => {
      const answerPart = answer.answerParts.find((candidate) => candidate.partId === part.partId)
      const allocation = binding.reviewEvidence.partAllocations.find((candidate) => candidate.partId === part.partId)
      const questionEvidence = part.sourceEvidence[0]
      const answerEvidence = answerPart?.markSchemeEvidence || []
      return questionEvidence?.assetSha256 === actualAssetSha256(questionEvidence.assetUrl)
        && answerEvidence.length === part.marks
        && answerEvidence.every((evidence) => evidence.assetSha256 === actualAssetSha256(evidence.assetUrl))
        && answerPart.sourcePage > 0
        && allocation?.markSchemePage === answerPart.sourcePage
        && allocation?.markPointCount === part.marks
        && allocation?.markSchemeEvidence?.length === part.marks
    }), `${questionId}: every part must retain byte-verified QP/MS evidence`)
    assert.equal(manifest.items[questionId]?.complete, true, `${questionId}: runtime manifest must include the reviewed question`)
    assert.equal(manifest.items[questionId]?.semanticStatus, 'verified-complete')
  }
}

assert.equal(new Set(historicalReviewedIds).size, 33, 'historical supplemental review IDs must remain unique')
assert.equal(eligibleReviewedIds.length, 32, 'the one superseded AI correction must remain excluded until renewed human review')
assert.equal(unifiedQuestionBank.filter((question) => eligibleReviewedIds.includes(question.sourceQuestionId)).length, eligibleReviewedIds.length, 'every still-valid supplemental group must enter the canonical gated bank')

const inventory = syllabusTopicsInventory({ routeId: 'cie-9702-as-physics', questionBank: unifiedQuestionBank })
const formallyEligibleQuestions = unifiedQuestionBank.filter((question) => (
  question.routeId === inventory.routeId && isHumanReviewedPastPaperItem(question)
))
const formallyEligibleIds = new Set(formallyEligibleQuestions.map((question) => question.sourceQuestionId))
const mappedTopicIds = (question) => new Set([
  question.syllabusMapping?.primaryTopicId,
  ...(question.syllabusMapping?.secondaryTopicIds || []),
  ...(question.syllabusMapping?.topicIds || []),
].filter(Boolean))
assert.equal(inventory.verifiedQuestionGroupCount, formallyEligibleIds.size)
assert.equal(formallyEligibleIds.has(heldCorrectionId), false)
for (const topic of inventory.topics) {
  const expectedIds = new Set(formallyEligibleQuestions
    .filter((question) => mappedTopicIds(question).has(topic.id))
    .map((question) => question.sourceQuestionId))
  assert.equal(topic.verifiedQuestionCount, expectedIds.size, `${topic.id}: inventory must deduplicate current eligible primary and secondary memberships`)
  const expectedPolicy = topicPracticeEligibility({
    verifiedQuestionCount: expectedIds.size,
    availableQuestionCount: expectedIds.size,
  })
  assert.equal(topic.ready, expectedPolicy.ready)
  assert.equal(topic.ctaPolicy, expectedPolicy.ctaPolicy)
  assert.deepEqual(topic.availableSetSizes, expectedPolicy.availableSetSizes)
}
assert.equal(inventory.topics.find((topic) => topic.id === 'physics-9702-topic-01')?.verifiedQuestionCount, 11, 'the held secondary membership must no longer satisfy formal Topic 1 readiness')
assert.equal(inventory.topics.find((topic) => topic.id === 'physics-9702-topic-05')?.verifiedQuestionCount, 17, 'the held primary membership must no longer inflate Topic 5')
assert.equal(inventory.topics.filter((topic) => topic.ready && topic.ctaPolicy === 'start').length, 10)
assert.equal(inventory.topics.filter((topic) => !topic.ready && topic.ctaPolicy === 'start-study').length, 1)
assert.equal(inventory.ready, false, 'the route must remain formally blocked while any official topic is below twelve reviewed groups')
assert.deepEqual(
  inventory.topics.find((topic) => topic.id === 'physics-9702-topic-07')?.availableSetSizes,
  [6, 10, 15],
  'every topic with at least twelve reviewed groups may advertise its available formal set sizes',
)

for (const topic of inventory.topics) {
  const set = buildSyllabusPracticeSet({
    routeId: inventory.routeId,
    syllabusTopicIds: [topic.id],
    questionCount: 10,
    components: [1, 2],
    seed: 20260815,
    questionBank: unifiedQuestionBank,
  })
  assert.equal(set.questionCount, 10, `${topic.id}: reviewed P1/P2 inventory must build a ten-question set`)
  assert.ok(set.questionGroups.every((group) => [1, 2].includes(group.paperComponent)), `${topic.id}: P3 practical questions must remain outside theory Topic Drill`)
  assert.equal(set.questionGroups.some((group) => group.paperComponent === 3), false)
  assert.equal(set.questionGroups.some((group) => group.id === heldCorrectionId), false, `${topic.id}: no formal set may contain the held correction`)
}

const workspaceSource = fs.readFileSync(path.join(root, 'src', 'components', 'PracticeWorkspace.jsx'), 'utf8')
assert.match(workspaceSource, /!activePart\.sourceRef\?\.paperId && <h2>/, 'official source questions must show page images instead of imported OCR text')

console.log(JSON.stringify({
  status: 'passed',
  supplementalReviewedGroups: eligibleReviewedIds.length,
  verifiedQuestionGroups: inventory.verifiedQuestionGroupCount,
  verifiedByTopic: Object.fromEntries(inventory.topics.map((topic) => [topic.id, topic.verifiedQuestionCount])),
}, null, 2))
