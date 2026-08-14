import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { CAMBRIDGE_9702_AS_SYLLABUS } from '../src/data/syllabus/cambridge-9702-as-2025-2027.js'
import {
  CAMBRIDGE_9702_P1_2025_REVIEW_LEDGER,
  CAMBRIDGE_9702_P1_REVIEW_LEDGER_SCHEMA_VERSION,
} from '../src/data/reviewedQuestionSets/cambridge-9702-p1-2025-review-ledger.js'
import { canonicalTextFileSha256, canonicalUtf8LfText } from './canonical-text.mjs'

const root = path.resolve(import.meta.dirname, '..')
const indexPath = path.join(root, 'src', 'data', 'importedQuestionIndex.json')
const paperCatalogPath = path.join(root, 'public', 'data', 'papers.json')
const reviewedSetsRoot = path.join(root, 'src', 'data', 'reviewedQuestionSets')
const auditScript = path.join(root, 'scripts', 'audit-question-bank.mjs')
const write = process.argv.includes('--write')

function questionNumber(question) {
  const match = String(question?.sourceRef?.question || '').match(/\d+/)
  return match ? Number(match[0]) : null
}

function assetPage(url) {
  const match = String(url || '').match(/\/(?:qp|ms)-(\d+)\.(?:png|jpe?g|webp)$/i)
  return match ? Number(match[1]) : null
}

function assetPath(url) {
  const pathname = new URL(String(url), 'https://review.invalid').pathname
  assert.ok(pathname.startsWith('/question-assets/'), `Untrusted review asset ${url}`)
  const parts = pathname.slice('/question-assets/'.length).split('/').map(decodeURIComponent)
  assert.ok(parts.length === 2 && parts.every((part) => part && part !== '.' && part !== '..'), `Unsafe review asset ${url}`)
  return path.join(root, 'public', 'question-assets', ...parts)
}

function sha256File(filePath) {
  assert.ok(fs.existsSync(filePath), `Missing review asset ${filePath}`)
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function sourceAssetForPage(assetUrls, page, label) {
  const assetUrl = (assetUrls || []).find((candidate) => assetPage(candidate) === page)
  assert.ok(assetUrl, `${label}: missing rendered asset for page ${page}`)
  return {
    assetUrl,
    assetSha256: sha256File(assetPath(assetUrl)),
  }
}

function stableSort(left, right) {
  return String(left).localeCompare(String(right), undefined, { numeric: true })
}

function sourceRecord(index, paperId) {
  const questions = index.questions
    .filter((question) => question.sourceRef?.paperId === paperId)
    .toSorted((left, right) => questionNumber(left) - questionNumber(right))
  const answers = new Map(index.answers.map((answer) => [answer.answerId, answer]))
  const bindings = new Map(index.bindings.map((binding) => [binding.questionId, binding]))
  return { questions, answers, bindings }
}

function optionText(question, option) {
  const match = (question.options || []).find((value) => new RegExp(`^${option}\\b`).test(String(value || '').trim()))
  assert.ok(match, `${question.questionId}: option ${option} is missing`)
  return String(match).trim()
}

function reviewedQuestion({ question, answer, review, paperSource }) {
  const number = questionNumber(question)
  assert.equal(question.answerType, 'multiple-choice', `${question.questionId}: P1 review expects MCQ`)
  assert.equal(question.totalMarks, 1, `${question.questionId}: P1 question must be worth one mark`)
  assert.equal(question.parts?.length, 1, `${question.questionId}: P1 question must have one part`)
  assert.equal(answer.answerParts?.length, 1, `${question.questionId}: P1 answer must have one part`)
  assert.equal(String(answer.exactAnswer || '').trim(), review.correctOption, `${question.questionId}: reviewed option does not match paired mark scheme`)
  assert.equal(Number(question.parts[0].sourcePage), Number(question.sourceRef?.pageStart), `${question.questionId}: P1 source page mismatch`)
  assert.equal(Number(answer.answerParts[0].sourcePage), Number(answer.answerRef?.pageStart), `${question.questionId}: P1 mark-scheme page mismatch`)

  const sourcePage = Number(review.questionPaperPage)
  const markSchemePage = Number(review.markSchemePage)
  assert.equal(Number(question.parts[0].sourcePage), sourcePage, `${question.questionId}: indexed QP page disagrees with reviewed evidence`)
  assert.equal(Number(answer.answerParts[0].sourcePage), markSchemePage, `${question.questionId}: indexed MS page disagrees with reviewed evidence`)
  assert.equal(review.reviewedBy, paperSource.reviewedBy, `${question.questionId}: reviewer identity must be explicit and stable`)
  assert.equal(review.reviewedAt, paperSource.reviewedAt, `${question.questionId}: review timestamp must be explicit and stable`)
  const sourceAsset = sourceAssetForPage(question.sourceRef?.assetUrls, sourcePage, question.questionId)
  const markSchemeAsset = sourceAssetForPage(answer.answerRef?.assetUrls, markSchemePage, question.questionId)
  const answerText = optionText(question, review.correctOption)
  const markSchemeText = `Paired Cambridge mark-scheme table: Q${number} = ${review.correctOption} (1 mark).`
  const partId = question.parts[0].partId

  const nextQuestion = {
    ...structuredClone(question),
    knowledgeGroupId: review.primaryTopicId,
    topicId: review.primaryTopicId,
    topicTags: [...new Set([review.primaryTopicId, ...(question.topicTags || [])])],
    questionGroupStatus: 'verified',
    syllabusMapping: {
      ...(question.syllabusMapping || {}),
      schemaVersion: 'question-syllabus-mapping-v1',
      specificationId: CAMBRIDGE_9702_AS_SYLLABUS.syllabusVersion ? 'cambridge-9702-2025-2027' : question.specificationId,
      primaryTopicId: review.primaryTopicId,
      secondaryTopicIds: [...review.secondaryTopicIds],
      syllabusPointIds: [...review.syllabusPointIds],
      confidence: review.mappingConfidence,
      mappingMethod: review.mappingMethod,
      reviewStatus: 'reviewed',
      reviewedBy: review.reviewedBy,
      reviewedAt: review.reviewedAt,
      reviewEvidence: {
        method: paperSource.reviewMethod,
        questionPaperId: question.sourceRef.paperId,
        markSchemeId: answer.answerRef.documentId,
        questionPage: sourcePage,
        markSchemePage,
        sourcePolicy: paperSource.sourcePolicy,
        sourceUrl: paperSource.questionPaper.sourceUrl,
      },
    },
    provenance: {
      ...(question.provenance || {}),
      reviewPolicy: paperSource.sourcePolicy,
      sourceReviewLedger: CAMBRIDGE_9702_P1_REVIEW_LEDGER_SCHEMA_VERSION,
    },
    parts: [{
      ...structuredClone(question.parts[0]),
      sourceEvidence: [{
        documentSha256: question.sourceRef.sha256,
        page: sourcePage,
        assetUrl: sourceAsset.assetUrl,
        assetSha256: sourceAsset.assetSha256,
      }],
    }],
  }

  const nextAnswer = {
    ...structuredClone(answer),
    answerKey: review.correctOption,
    exactAnswer: review.correctOption,
    answerParts: [{
      ...structuredClone(answer.answerParts[0]),
      answerKey: review.correctOption,
      answerText,
      sourcePage: markSchemePage,
      markSchemePoints: [markSchemeText],
      markSchemeEvidence: [{
        documentSha256: answer.answerRef.sha256,
        sourcePage: markSchemePage,
        assetUrl: markSchemeAsset.assetUrl,
        assetSha256: markSchemeAsset.assetSha256,
        text: markSchemeText,
      }],
    }],
  }

  const binding = {
    questionId: nextQuestion.questionId,
    answerId: nextAnswer.answerId,
    verificationStatus: 'reviewed',
    questionDocumentSha256: nextQuestion.sourceRef.sha256,
    answerDocumentSha256: nextAnswer.answerRef.sha256,
    reviewedAt: review.reviewedAt,
    reviewedBy: review.reviewedBy,
    reviewEvidence: {
      method: paperSource.reviewMethod,
      sourcePolicy: paperSource.sourcePolicy,
      questionPaper: {
        file: nextQuestion.sourceRef.paper,
        sha256: nextQuestion.sourceRef.sha256,
        sourceUrl: paperSource.questionPaper.sourceUrl,
      },
      markScheme: {
        file: nextAnswer.answerRef.file,
        sha256: nextAnswer.answerRef.sha256,
        sourceUrl: paperSource.markScheme.sourceUrl,
      },
      partAllocations: [{
        partId,
        marks: 1,
        questionPage: sourcePage,
        // Full-page evidence is deliberate: all four options and source
        // diagrams remain visible until a separately reviewed crop exists.
        questionRegion: [0, 0, 1, 1],
        markSchemePage,
        markSchemeRegion: [0, 0, 1, 1],
        markPointCount: 1,
        markSchemeEvidence: [markSchemeText],
      }],
    },
  }

  return { question: nextQuestion, answer: nextAnswer, binding }
}

function reviewPaper({ index, catalogById, review }) {
  const { questions, answers, bindings } = sourceRecord(index, review.paperId)
  assert.equal(questions.length, review.expectedQuestionCount, `${review.paperId}: source index does not contain the complete P1 question set`)
  assert.equal(review.rows.length, review.expectedQuestionCount, `${review.paperId}: review ledger does not cover every question`)
  assert.equal(new Set(review.rows.map((row) => row.questionNumber)).size, review.rows.length, `${review.paperId}: duplicate review rows`)
  assert.deepEqual(review.rows.map((row) => row.questionNumber).toSorted((left, right) => left - right), Array.from({ length: review.expectedQuestionCount }, (_value, index) => index + 1), `${review.paperId}: review ledger must list Q1-Q40`)

  const questionPaper = catalogById.get(review.paperId)
  assert.ok(questionPaper, `${review.paperId}: missing paper catalog record`)
  const markScheme = catalogById.get(questionPaper.markSchemeId)
  assert.ok(markScheme, `${review.paperId}: missing paired mark scheme catalog record`)
  assert.equal(questionPaper.file, review.questionPaperFile, `${review.paperId}: QP filename mismatch`)
  assert.equal(markScheme.file, review.markSchemeFile, `${review.paperId}: MS filename mismatch`)
  assert.equal(questionPaper.governance?.state, 'active', `${review.paperId}: paper governance is not active`)
  assert.equal(questionPaper.governance?.accessPolicyId, 'personal-study-restricted-v1', `${review.paperId}: unexpected source access policy`)

  const points = new Set(CAMBRIDGE_9702_AS_SYLLABUS.points.map((point) => point.id))
  const topics = new Set(CAMBRIDGE_9702_AS_SYLLABUS.topics.map((topic) => topic.id))
  const paperSource = {
    reviewedAt: review.reviewedAt,
    reviewedBy: review.reviewedBy,
    reviewMethod: review.reviewMethod,
    sourcePolicy: review.sourcePolicy,
    questionPaper,
    markScheme,
  }
  const rowsByNumber = new Map(review.rows.map((row) => [row.questionNumber, row]))
  const reviewed = questions.map((question) => {
    const row = rowsByNumber.get(questionNumber(question))
    assert.ok(row, `${question.questionId}: missing manual review row`)
    assert.ok(topics.has(row.primaryTopicId), `${question.questionId}: unknown official syllabus topic`)
    assert.ok(row.syllabusPointIds.every((id) => points.has(id)), `${question.questionId}: unknown official syllabus point`)
    const answer = answers.get(question.answerId)
    assert.ok(answer, `${question.questionId}: missing paired answer`)
    assert.ok(
      ['machine-indexed', 'reviewed'].includes(bindings.get(question.questionId)?.verificationStatus),
      `${question.questionId}: source record has an unexpected review state`,
    )
    return reviewedQuestion({ question, answer, review: row, paperSource })
  })
  assert.equal(reviewed.reduce((sum, item) => sum + item.question.totalMarks, 0), review.expectedTotalMarks, `${review.paperId}: total marks mismatch`)

  return {
    paperId: review.paperId,
    generatedAt: review.reviewedAt,
    sourceMaterials: {
      questionPaper: {
        id: questionPaper.id,
        file: questionPaper.file,
        sha256: questionPaper.sha256,
        sourceUrl: questionPaper.sourceUrl,
        governance: questionPaper.governance,
      },
      markScheme: {
        id: markScheme.id,
        file: markScheme.file,
        sha256: markScheme.sha256,
        sourceUrl: markScheme.sourceUrl,
        governance: markScheme.governance,
      },
    },
    questions: reviewed.map((item) => item.question),
    answers: reviewed.map((item) => item.answer),
    bindings: reviewed.map((item) => item.binding),
  }
}

function reviewedSetPayload(reviewedPaper) {
  return {
    schemaVersion: 'reviewed-question-set.v1',
    generatedAt: reviewedPaper.generatedAt,
    paperId: reviewedPaper.paperId,
    questionCount: reviewedPaper.questions.length,
    totalMarks: reviewedPaper.questions.reduce((sum, question) => sum + Number(question.totalMarks || 0), 0),
    sourceFragments: [{
      file: 'cambridge-9702-p1-2025-review-ledger.js',
      sha256: canonicalTextFileSha256(path.join(reviewedSetsRoot, 'cambridge-9702-p1-2025-review-ledger.js')),
    }],
    sourceMaterials: reviewedPaper.sourceMaterials,
    questions: [...reviewedPaper.questions].toSorted((left, right) => questionNumber(left) - questionNumber(right)),
    answers: [...reviewedPaper.answers].toSorted((left, right) => stableSort(left.answerId, right.answerId)),
    bindings: [...reviewedPaper.bindings].toSorted((left, right) => stableSort(left.questionId, right.questionId)),
  }
}

function mergedIndex(index, reviewedPapers) {
  const reviewedPaperIds = new Set(reviewedPapers.map((paper) => paper.paperId))
  const questionIds = new Set(reviewedPapers.flatMap((paper) => paper.questions.map((question) => question.questionId)))
  const answerIds = new Set(reviewedPapers.flatMap((paper) => paper.answers.map((answer) => answer.answerId)))
  return {
    ...index,
    questions: [
      ...index.questions.filter((question) => !reviewedPaperIds.has(question.sourceRef?.paperId)),
      ...reviewedPapers.flatMap((paper) => paper.questions),
    ].toSorted((left, right) => stableSort(left.questionId, right.questionId)),
    answers: [
      ...index.answers.filter((answer) => !answerIds.has(answer.answerId)),
      ...reviewedPapers.flatMap((paper) => paper.answers),
    ].toSorted((left, right) => stableSort(left.answerId, right.answerId)),
    bindings: [
      ...index.bindings.filter((binding) => !questionIds.has(binding.questionId)),
      ...reviewedPapers.flatMap((paper) => paper.bindings),
    ].toSorted((left, right) => stableSort(left.questionId, right.questionId)),
  }
}

function serialise(value) {
  return canonicalUtf8LfText(`${JSON.stringify(value, null, 2)}\n`)
}

function assertOrWrite(filePath, content) {
  if (write) {
    fs.writeFileSync(filePath, content, 'utf8')
    return
  }
  assert.ok(fs.existsSync(filePath), `Missing generated review artifact ${filePath}; run npm run questions:review-9702-p1`)
  assert.equal(canonicalUtf8LfText(fs.readFileSync(filePath, 'utf8')), content, `Stale generated review artifact ${filePath}; run npm run questions:review-9702-p1`)
}

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
const paperCatalog = JSON.parse(fs.readFileSync(paperCatalogPath, 'utf8'))
const catalogById = new Map((paperCatalog.items || []).map((item) => [item.id, item]))
const reviewedPapers = CAMBRIDGE_9702_P1_2025_REVIEW_LEDGER.map((review) => reviewPaper({ index, catalogById, review }))
const nextIndex = mergedIndex(index, reviewedPapers)
const reviewedSets = reviewedPapers.map(reviewedSetPayload)

assert.equal(reviewedPapers.reduce((sum, paper) => sum + paper.questions.length, 0), 80, 'The manual P1 review must contain exactly 80 question groups')
assert.equal(reviewedPapers.reduce((sum, paper) => sum + paper.questions.reduce((total, question) => total + question.totalMarks, 0), 0), 80, 'The manual P1 review must contain exactly 80 marks')
assert.equal(new Set(reviewedPapers.flatMap((paper) => paper.questions.map((question) => question.questionId))).size, 80, 'Review IDs must be unique')

fs.mkdirSync(reviewedSetsRoot, { recursive: true })
for (const reviewedSet of reviewedSets) {
  assertOrWrite(path.join(reviewedSetsRoot, `${reviewedSet.paperId}.json`), serialise(reviewedSet))
}
assertOrWrite(indexPath, serialise(nextIndex))

if (write) {
  const result = spawnSync(process.execPath, [auditScript, '--write-manifest'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  })
  assert.equal(result.status, 0, `Could not refresh source manifest:\n${result.stdout}\n${result.stderr}`)
}

const byTopic = Object.groupBy(
  reviewedPapers.flatMap((paper) => paper.questions),
  (question) => question.syllabusMapping.primaryTopicId,
)
console.log(JSON.stringify({
  status: write ? 'written' : 'current',
  schemaVersion: CAMBRIDGE_9702_P1_REVIEW_LEDGER_SCHEMA_VERSION,
  papers: reviewedSets.map((set) => ({
    paperId: set.paperId,
    questionCount: set.questionCount,
    totalMarks: set.totalMarks,
  })),
  topicCounts: Object.fromEntries(Object.entries(byTopic).map(([topicId, questions]) => [topicId, questions.length]).toSorted(([left], [right]) => left.localeCompare(right))),
}, null, 2))
