import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import index from '../src/data/importedQuestionIndex.json' with { type: 'json' }
import manifest from '../src/data/sourceContentManifest.json' with { type: 'json' }
import { unifiedQuestionBank } from '../src/data/questionBank.js'
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
const reviewedIds = []

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
assert.equal(CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_LEDGERS.reduce((sum, paper) => sum + paper.questions.length, 0), 25)

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
    reviewedIds.push(questionId)
    const question = questionById.get(questionId)
    const binding = bindingById.get(questionId)
    const answer = answerById.get(binding?.answerId)
    const artifactQuestion = artifact.questions.find((candidate) => candidate.questionId === questionId)
    const artifactAnswer = artifact.answers.find((candidate) => candidate.answerId === binding?.answerId)
    assert.ok(question && answer && binding && artifactQuestion && artifactAnswer, `${questionId}: reviewed entities must exist`)
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

assert.equal(new Set(reviewedIds).size, 25, 'supplemental review IDs must be unique')
assert.equal(unifiedQuestionBank.filter((question) => reviewedIds.includes(question.sourceQuestionId)).length, 25, 'every supplemental group must enter the canonical gated bank')

const inventory = syllabusTopicsInventory({ routeId: 'cie-9702-as-physics', questionBank: unifiedQuestionBank })
assert.equal(inventory.verifiedQuestionGroupCount, 112)
assert.deepEqual(inventory.topics.map((topic) => topic.verifiedQuestionCount), [10, 10, 10, 10, 10, 10, 12, 10, 10, 10, 10])
assert.equal(inventory.topics.filter((topic) => topic.ready && topic.ctaPolicy === 'start').length, 1)
assert.equal(inventory.topics.filter((topic) => !topic.ready && topic.ctaPolicy === 'hidden').length, 10)
assert.equal(inventory.ready, false, 'a route remains unavailable until every official topic can supply two six-question tests')
assert.deepEqual(
  inventory.topics.find((topic) => topic.id === 'physics-9702-topic-07')?.availableSetSizes,
  [6, 10],
  'only the current twelve-group positive fixture may advertise startable test sizes',
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
}

const workspaceSource = fs.readFileSync(path.join(root, 'src', 'components', 'PracticeWorkspace.jsx'), 'utf8')
assert.match(workspaceSource, /!activePart\.sourceRef\?\.paperId && <h2>/, 'official source questions must show page images instead of imported OCR text')

console.log(JSON.stringify({
  status: 'passed',
  supplementalReviewedGroups: reviewedIds.length,
  verifiedQuestionGroups: inventory.verifiedQuestionGroupCount,
  verifiedByTopic: Object.fromEntries(inventory.topics.map((topic) => [topic.id, topic.verifiedQuestionCount])),
}, null, 2))
