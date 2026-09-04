import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { CAMBRIDGE_9702_AS_SYLLABUS } from '../src/data/syllabus/cambridge-9702-as-2025-2027.js'
import {
  CAMBRIDGE_9702_P2_M25_REVIEW_LEDGER,
  CAMBRIDGE_9702_P2_M25_REVIEW_LEDGER_SCHEMA_VERSION,
} from '../src/data/reviewedQuestionSets/cambridge-9702-p2-m25-review-ledger.js'
import { canonicalTextFileSha256, canonicalUtf8LfText } from './canonical-text.mjs'

const root = path.resolve(import.meta.dirname, '..')
const indexPath = path.join(root, 'src', 'data', 'importedQuestionIndex.json')
const paperCatalogPath = path.join(root, 'public', 'data', 'papers.json')
const reviewedSetsRoot = path.join(root, 'src', 'data', 'reviewedQuestionSets')
const auditScript = path.join(root, 'scripts', 'audit-question-bank.mjs')
const write = process.argv.includes('--write')

function stableSort(left, right) {
  return String(left).localeCompare(String(right), undefined, { numeric: true })
}

function sourceAssetUrl(paperId, prefix, page) {
  return `/question-assets/${paperId}/${prefix}-${String(page).padStart(2, '0')}.jpg`
}

function assetPath(url) {
  const pathname = new URL(String(url), 'https://review.invalid').pathname
  assert.ok(pathname.startsWith('/question-assets/'), `Untrusted review asset ${url}`)
  const parts = pathname.slice('/question-assets/'.length).split('/').map(decodeURIComponent)
  assert.ok(parts.length === 2 && parts.every((part) => part && part !== '.' && part !== '..'), `Unsafe review asset ${url}`)
  return path.join(root, 'public', 'question-assets', ...parts)
}

function assetEvidence(paperId, prefix, page, documentSha256) {
  const assetUrl = sourceAssetUrl(paperId, prefix, page)
  const filePath = assetPath(assetUrl)
  assert.ok(fs.existsSync(filePath), `Missing rendered ${prefix.toUpperCase()} asset ${assetUrl}`)
  const assetSha256 = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
  return Object.freeze({ documentSha256, page, assetUrl, assetSha256 })
}

function sourceRecord(index, paperId) {
  const questions = index.questions
    .filter((question) => question.sourceRef?.paperId === paperId)
    .toSorted((left, right) => Number(String(left.sourceRef?.question || '').replace(/\D/g, '')) - Number(String(right.sourceRef?.question || '').replace(/\D/g, '')))
  const answers = new Map(index.answers.map((answer) => [answer.answerId, answer]))
  const bindings = new Map(index.bindings.map((binding) => [binding.questionId, binding]))
  return { questions, answers, bindings }
}

function reviewQuestion({ question, answer, binding, review, paperSource }) {
  assert.ok(question, `Q${review.questionNumber}: source question is missing`)
  assert.ok(answer, `${question.questionId}: paired answer is missing`)
  assert.ok(binding, `${question.questionId}: source binding is missing`)
  assert.equal(question.questionId, `${paperSource.questionPaper.id}:q${review.questionNumber}`, `Q${review.questionNumber}: stable question ID mismatch`)
  assert.equal(question.answerId, answer.answerId, `${question.questionId}: question/answer linkage mismatch`)
  assert.equal(question.sourceRef?.sha256, paperSource.questionPaper.sha256, `${question.questionId}: QP checksum mismatch`)
  assert.equal(answer.answerRef?.sha256, paperSource.markScheme.sha256, `${question.questionId}: MS checksum mismatch`)
  assert.equal(review.parts.reduce((sum, part) => sum + part.marks, 0), review.totalMarks, `${question.questionId}: reviewed parts do not close to the official total`)
  assert.ok(review.questionPages.every((page) => Number.isInteger(page) && page > 0), `${question.questionId}: invalid QP page`)
  assert.ok(review.markSchemePages.every((page) => Number.isInteger(page) && page > 0), `${question.questionId}: invalid MS page`)
  assert.ok(review.parts.every((part) => review.questionPages.includes(part.questionPage) && review.markSchemePages.includes(part.markSchemePage)), `${question.questionId}: part page must be within the reviewed group ranges`)

  const questionAssetsByPage = new Map(review.questionPages.map((page) => {
    const evidence = assetEvidence(paperSource.questionPaper.id, 'qp', page, paperSource.questionPaper.sha256)
    return [page, evidence]
  }))
  const markSchemeAssetsByPage = new Map(review.markSchemePages.map((page) => {
    const evidence = assetEvidence(paperSource.questionPaper.id, 'ms', page, paperSource.markScheme.sha256)
    return [page, evidence]
  }))

  const parts = review.parts.map((part) => {
    const sourceEvidence = questionAssetsByPage.get(part.questionPage)
    const markSchemeEvidence = markSchemeAssetsByPage.get(part.markSchemePage)
    const partId = `${question.questionId}:part-${part.label}`
    return Object.freeze({
      partId,
      label: part.label,
      promptFragment: part.promptFragment,
      marks: part.marks,
      answerArea: { type: 'handwritten', input: 'handwriting' },
      sourcePage: part.questionPage,
      sourceEvidence: [sourceEvidence],
      markSchemePoints: [...part.markSchemePoints],
      answerText: part.markSchemePoints.join('\n'),
      answerSourcePage: part.markSchemePage,
      markSchemeEvidence: part.markSchemePoints.map((text) => ({
        documentSha256: markSchemeEvidence.documentSha256,
        sourcePage: markSchemeEvidence.page,
        assetUrl: markSchemeEvidence.assetUrl,
        assetSha256: markSchemeEvidence.assetSha256,
        text,
      })),
    })
  })
  const questionParts = parts.map((part) => {
    const {
      markSchemePoints: _markSchemePoints,
      answerText: _answerText,
      answerSourcePage: _answerSourcePage,
      markSchemeEvidence: _markSchemeEvidence,
      ...questionPart
    } = part
    return questionPart
  })
  const {
    answer: _answer,
    answerKey: _answerKey,
    markPoints: _markPoints,
    ...questionBase
  } = structuredClone(question)

  const nextQuestion = {
    ...questionBase,
    answerType: 'structured',
    prompt: questionParts.map((part) => `(${part.label}) ${part.promptFragment}`).join('\n\n'),
    options: undefined,
    questionGroupId: question.questionId,
    questionGroupStatus: 'verified',
    totalMarks: review.totalMarks,
    marks: review.totalMarks,
    parts: questionParts,
    sourceRef: {
      ...structuredClone(question.sourceRef),
      pageStart: review.questionPages[0],
      pageEnd: review.questionPages.at(-1),
      assetUrls: review.questionPages.map((page) => questionAssetsByPage.get(page).assetUrl),
    },
    topicId: review.primaryTopicId,
    knowledgeGroupId: review.primaryTopicId,
    topicTags: [...new Set([review.primaryTopicId, ...review.secondaryTopicIds, ...(question.topicTags || [])])],
    syllabusMapping: {
      ...(question.syllabusMapping || {}),
      schemaVersion: 'question-syllabus-mapping-v1',
      specificationId: 'cambridge-9702-2025-2027',
      primaryTopicId: review.primaryTopicId,
      secondaryTopicIds: [...review.secondaryTopicIds],
      syllabusPointIds: [...review.syllabusPointIds],
      confidence: review.mappingConfidence,
      mappingMethod: review.mappingMethod,
      reviewStatus: 'reviewed',
      reviewedBy: paperSource.reviewedBy,
      reviewedAt: paperSource.reviewedAt,
      reviewEvidence: {
        method: paperSource.reviewMethod,
        questionPaperId: paperSource.questionPaper.id,
        markSchemeId: paperSource.markScheme.id,
        questionPages: [...review.questionPages],
        markSchemePages: [...review.markSchemePages],
        sourcePolicy: paperSource.sourcePolicy,
        sourceUrl: paperSource.questionPaper.sourceUrl,
      },
    },
    provenance: {
      ...(question.provenance || {}),
      reviewPolicy: paperSource.sourcePolicy,
      sourceReviewLedger: CAMBRIDGE_9702_P2_M25_REVIEW_LEDGER_SCHEMA_VERSION,
    },
  }

  const nextAnswer = {
    ...structuredClone(answer),
    answerKey: null,
    exactAnswer: parts.map((part) => `(${part.label}) ${part.answerText}`).join('\n\n'),
    markPoints: parts.flatMap((part) => part.markSchemePoints),
    answerRef: {
      ...structuredClone(answer.answerRef),
      pageStart: review.markSchemePages[0],
      pageEnd: review.markSchemePages.at(-1),
      assetUrls: review.markSchemePages.map((page) => markSchemeAssetsByPage.get(page).assetUrl),
    },
    answerParts: parts.map((part) => ({
      partId: part.partId,
      label: part.label,
      marks: part.marks,
      markSchemePoints: [...part.markSchemePoints],
      answerKey: null,
      answerText: part.answerText,
      sourcePage: part.answerSourcePage,
      markSchemeEvidence: [...part.markSchemeEvidence],
    })),
  }

  const nextBinding = {
    questionId: nextQuestion.questionId,
    answerId: nextAnswer.answerId,
    verificationStatus: 'reviewed',
    questionDocumentSha256: nextQuestion.sourceRef.sha256,
    answerDocumentSha256: nextAnswer.answerRef.sha256,
    reviewedAt: paperSource.reviewedAt,
    reviewedBy: paperSource.reviewedBy,
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
      partAllocations: parts.map((part) => ({
        partId: part.partId,
        marks: part.marks,
        questionPage: part.sourcePage,
        // Full pages retain every figure, table, equation and shared stem.
        questionRegion: [0, 0, 1, 1],
        markSchemePage: part.answerSourcePage,
        markSchemeRegion: [0, 0, 1, 1],
        markPointCount: part.markSchemePoints.length,
        markSchemeEvidence: part.markSchemeEvidence.map((evidence) => evidence.text),
      })),
    },
  }

  return { question: nextQuestion, answer: nextAnswer, binding: nextBinding }
}

function reviewedPaper(index, catalogById, review) {
  const { questions, answers, bindings } = sourceRecord(index, review.paperId)
  assert.equal(questions.length, review.expectedQuestionCount, `${review.paperId}: source index must contain the seven printed P2 groups`)
  assert.equal(review.questions.length, review.expectedQuestionCount, `${review.paperId}: ledger must cover Q1-Q7`)
  assert.deepEqual(review.questions.map((item) => item.questionNumber), [1, 2, 3, 4, 5, 6, 7], `${review.paperId}: review order must match the official paper`)
  assert.equal(review.questions.reduce((sum, item) => sum + item.totalMarks, 0), review.expectedTotalMarks, `${review.paperId}: official total must be 60 marks`)

  const questionPaper = catalogById.get(review.paperId)
  assert.ok(questionPaper, `${review.paperId}: missing question-paper catalog record`)
  const markScheme = catalogById.get(questionPaper.markSchemeId)
  assert.ok(markScheme, `${review.paperId}: missing paired mark-scheme catalog record`)
  assert.equal(questionPaper.file, review.questionPaperFile, `${review.paperId}: QP filename mismatch`)
  assert.equal(markScheme.file, review.markSchemeFile, `${review.paperId}: MS filename mismatch`)
  assert.equal(questionPaper.governance?.state, 'active', `${review.paperId}: paper governance is not active`)
  assert.equal(questionPaper.governance?.accessPolicyId, 'personal-study-restricted-v1', `${review.paperId}: unexpected source access policy`)

  const topicIds = new Set(CAMBRIDGE_9702_AS_SYLLABUS.topics.map((topic) => topic.id))
  const pointIds = new Set(CAMBRIDGE_9702_AS_SYLLABUS.points.map((point) => point.id))
  const paperSource = {
    reviewedAt: review.reviewedAt,
    reviewedBy: review.reviewedBy,
    reviewMethod: review.reviewMethod,
    sourcePolicy: review.sourcePolicy,
    questionPaper,
    markScheme,
  }
  const byNumber = new Map(questions.map((question) => [Number(String(question.sourceRef?.question || '').replace(/\D/g, '')), question]))
  const reviewed = review.questions.map((questionReview) => {
    assert.ok(topicIds.has(questionReview.primaryTopicId), `Q${questionReview.questionNumber}: unknown primary syllabus topic`)
    assert.ok(questionReview.secondaryTopicIds.every((topicId) => topicIds.has(topicId)), `Q${questionReview.questionNumber}: unknown secondary syllabus topic`)
    assert.ok(questionReview.syllabusPointIds.every((pointId) => pointIds.has(pointId)), `Q${questionReview.questionNumber}: unknown syllabus point`)
    const question = byNumber.get(questionReview.questionNumber)
    const answer = answers.get(question?.answerId)
    const binding = bindings.get(question?.questionId)
    return reviewQuestion({ question, answer, binding, review: questionReview, paperSource })
  })

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

function serialise(value) {
  return canonicalUtf8LfText(`${JSON.stringify(value, null, 2)}\n`)
}

function assertOrWrite(filePath, content) {
  if (write) {
    fs.writeFileSync(filePath, content, 'utf8')
    return
  }
  assert.ok(fs.existsSync(filePath), `Missing generated review artifact ${filePath}; run npm run questions:review-9702-p2`)
  assert.equal(canonicalUtf8LfText(fs.readFileSync(filePath, 'utf8')), content, `Stale generated review artifact ${filePath}; run npm run questions:review-9702-p2`)
}

function mergedIndex(index, reviewed) {
  const questionIds = new Set(reviewed.questions.map((question) => question.questionId))
  const answerIds = new Set(reviewed.answers.map((answer) => answer.answerId))
  return {
    ...index,
    questions: [
      ...index.questions.filter((question) => !questionIds.has(question.questionId)),
      ...reviewed.questions,
    ].toSorted((left, right) => stableSort(left.questionId, right.questionId)),
    answers: [
      ...index.answers.filter((answer) => !answerIds.has(answer.answerId)),
      ...reviewed.answers,
    ].toSorted((left, right) => stableSort(left.answerId, right.answerId)),
    bindings: [
      ...index.bindings.filter((binding) => !questionIds.has(binding.questionId)),
      ...reviewed.bindings,
    ].toSorted((left, right) => stableSort(left.questionId, right.questionId)),
  }
}

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
const paperCatalog = JSON.parse(fs.readFileSync(paperCatalogPath, 'utf8'))
const catalogById = new Map((paperCatalog.items || []).map((item) => [item.id, item]))
const reviewed = reviewedPaper(index, catalogById, CAMBRIDGE_9702_P2_M25_REVIEW_LEDGER)
const reviewedSet = {
  schemaVersion: 'reviewed-question-set.v1',
  generatedAt: reviewed.generatedAt,
  paperId: reviewed.paperId,
  questionCount: reviewed.questions.length,
  totalMarks: reviewed.questions.reduce((sum, question) => sum + Number(question.totalMarks || 0), 0),
  sourceFragments: [{
    file: 'cambridge-9702-p2-m25-review-ledger.js',
    sha256: canonicalTextFileSha256(path.join(reviewedSetsRoot, 'cambridge-9702-p2-m25-review-ledger.js')),
  }],
  sourceMaterials: reviewed.sourceMaterials,
  questions: [...reviewed.questions],
  answers: [...reviewed.answers],
  bindings: [...reviewed.bindings],
}
const nextIndex = mergedIndex(index, reviewed)

assert.equal(reviewedSet.questionCount, 7, 'The P2 review must cover Q1-Q7 exactly')
assert.equal(reviewedSet.totalMarks, 60, 'The P2 review must reconcile to the official 60 marks')

fs.mkdirSync(reviewedSetsRoot, { recursive: true })
assertOrWrite(path.join(reviewedSetsRoot, `${reviewed.paperId}.json`), serialise(reviewedSet))
assertOrWrite(indexPath, serialise(nextIndex))

if (write) {
  const result = spawnSync(process.execPath, [auditScript, '--write-manifest'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  })
  assert.equal(result.status, 0, `Could not refresh source manifest:\n${result.stdout}\n${result.stderr}`)
}

console.log(JSON.stringify({
  status: write ? 'written' : 'current',
  schemaVersion: CAMBRIDGE_9702_P2_M25_REVIEW_LEDGER_SCHEMA_VERSION,
  paperId: reviewed.paperId,
  questionCount: reviewedSet.questionCount,
  totalMarks: reviewedSet.totalMarks,
  topicIds: reviewed.questions.map((question) => question.syllabusMapping.primaryTopicId),
}, null, 2))
