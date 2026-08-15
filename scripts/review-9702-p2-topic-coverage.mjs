import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { CAMBRIDGE_9702_AS_SYLLABUS } from '../src/data/syllabus/cambridge-9702-as-2025-2027.js'
import {
  CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_LEDGERS,
  CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_SCHEMA_VERSION,
} from '../src/data/reviewedQuestionSets/cambridge-9702-p2-topic-coverage-review-ledger.js'
import { canonicalTextFileSha256, canonicalUtf8LfText } from './canonical-text.mjs'

const root = path.resolve(import.meta.dirname, '..')
const indexPath = path.join(root, 'src', 'data', 'importedQuestionIndex.json')
const paperCatalogPath = path.join(root, 'public', 'data', 'papers.json')
const reviewedSetsRoot = path.join(root, 'src', 'data', 'reviewedQuestionSets')
const ledgerFile = 'cambridge-9702-p2-topic-coverage-review-ledger.js'
const ledgerPath = path.join(reviewedSetsRoot, ledgerFile)
const auditScript = path.join(root, 'scripts', 'audit-question-bank.mjs')
const write = process.argv.includes('--write')

function stableSort(left, right) {
  return String(left).localeCompare(String(right), undefined, { numeric: true })
}

function canonicalLabel(value) {
  return String(value || '').trim().toLowerCase().replaceAll(' ', '')
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
  const bytes = fs.readFileSync(filePath)
  assert.ok(bytes.length > 0, `Empty rendered ${prefix.toUpperCase()} asset ${assetUrl}`)
  return Object.freeze({
    documentSha256,
    page,
    assetUrl,
    assetSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  })
}

function sourceRecord(index, paperId) {
  const questions = index.questions.filter((question) => question.sourceRef?.paperId === paperId)
  const answers = new Map(index.answers.map((answer) => [answer.answerId, answer]))
  const bindings = new Map(index.bindings.map((binding) => [binding.questionId, binding]))
  return { questions, answers, bindings }
}

function privateMarkSchemePoints(sourceAnswerPart, reviewedPart) {
  const reviewed = [...(reviewedPart.markSchemePoints || [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  if (reviewed.length) {
    assert.equal(reviewed.length, reviewedPart.marks, `${reviewedPart.label}: reviewed mark-scheme evidence must close to reviewed marks`)
    return reviewed
  }
  const raw = [...(sourceAnswerPart?.markSchemePoints || [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  assert.ok(raw.length >= reviewedPart.marks, `${reviewedPart.label}: paired mark-scheme evidence has ${raw.length} criteria for ${reviewedPart.marks} marks`)
  if (reviewedPart.marks === 1) return [raw.join(' / ')]
  return [
    ...raw.slice(0, reviewedPart.marks - 1),
    raw.slice(reviewedPart.marks - 1).join(' / '),
  ]
}

function reviewQuestion({ question, answer, binding, review, paperSource }) {
  assert.ok(question, `${paperSource.questionPaper.id} Q${review.questionNumber}: source question is missing`)
  assert.ok(answer, `${question.questionId}: paired answer is missing`)
  assert.ok(binding, `${question.questionId}: source binding is missing`)
  assert.equal(question.questionId, `${paperSource.questionPaper.id}:q${review.questionNumber}`, `${question.questionId}: stable question ID mismatch`)
  assert.equal(binding.answerId, answer.answerId, `${question.questionId}: question/answer linkage mismatch`)
  assert.equal(question.sourceRef?.sha256, paperSource.questionPaper.sha256, `${question.questionId}: QP checksum mismatch`)
  assert.equal(answer.answerRef?.sha256, paperSource.markScheme.sha256, `${question.questionId}: MS checksum mismatch`)
  assert.equal(review.parts.reduce((sum, part) => sum + part.marks, 0), review.totalMarks, `${question.questionId}: reviewed marks do not close`)

  const questionAssetsByPage = new Map(review.questionPages.map((page) => [
    page,
    assetEvidence(paperSource.questionPaper.id, 'qp', page, paperSource.questionPaper.sha256),
  ]))
  const markSchemeAssetsByPage = new Map(review.markSchemePages.map((page) => [
    page,
    assetEvidence(paperSource.questionPaper.id, 'ms', page, paperSource.markScheme.sha256),
  ]))
  const sourcePartsByLabel = new Map((question.parts || []).map((part) => [canonicalLabel(part.label), part]))
  const sourceAnswerPartsByLabel = new Map((answer.answerParts || []).map((part) => [canonicalLabel(part.label), part]))

  const parts = review.parts.map((reviewedPart) => {
    const sourcePart = sourcePartsByLabel.get(canonicalLabel(reviewedPart.label))
    const sourceAnswerPart = sourceAnswerPartsByLabel.get(canonicalLabel(reviewedPart.label))
    assert.ok(sourcePart, `${question.questionId}: reviewed part ${reviewedPart.label} is missing from the source question`)
    assert.ok(sourceAnswerPart, `${question.questionId}: reviewed part ${reviewedPart.label} is missing from the paired mark scheme`)
    const sourceEvidence = questionAssetsByPage.get(reviewedPart.questionPage)
    const markSchemeEvidence = markSchemeAssetsByPage.get(reviewedPart.markSchemePage)
    assert.ok(sourceEvidence && markSchemeEvidence, `${question.questionId}:${reviewedPart.label}: reviewed page evidence is missing`)
    const markSchemePoints = privateMarkSchemePoints(sourceAnswerPart, reviewedPart)
    assert.equal(markSchemePoints.length, reviewedPart.marks, `${question.questionId}:${reviewedPart.label}: private mark hints must close to reviewed marks`)
    const partId = `${question.questionId}:part-${reviewedPart.label}`
    return Object.freeze({
      partId,
      label: reviewedPart.label,
      promptFragment: String(sourcePart.promptFragment || '').trim(),
      marks: reviewedPart.marks,
      answerArea: { type: 'handwritten', input: 'handwriting' },
      sourcePage: reviewedPart.questionPage,
      sourceEvidence: [sourceEvidence],
      markSchemePoints,
      answerText: markSchemePoints.join('\n'),
      answerSourcePage: reviewedPart.markSchemePage,
      markSchemeEvidence: markSchemePoints.map((text) => ({
        documentSha256: markSchemeEvidence.documentSha256,
        sourcePage: markSchemeEvidence.page,
        assetUrl: markSchemeEvidence.assetUrl,
        assetSha256: markSchemeEvidence.assetSha256,
        text,
      })),
    })
  })

  assert.equal(sourcePartsByLabel.size, parts.length, `${question.questionId}: reviewed part list must cover the complete imported question group`)
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
  const { answer: _answer, answerKey: _answerKey, markPoints: _markPoints, ...questionBase } = structuredClone(question)
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
        studentPromptPolicy: 'official-source-image',
        privateTextPolicy: 'hidden-indexing-and-marking-context',
      },
    },
    provenance: {
      ...(question.provenance || {}),
      reviewPolicy: paperSource.sourcePolicy,
      sourceReviewLedger: CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_SCHEMA_VERSION,
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
      reviewProtocolVersion: CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_SCHEMA_VERSION,
      sourcePolicy: paperSource.sourcePolicy,
      manualVisualReview: paperSource.manualVisualReview === true,
      studentPromptPolicy: 'official-source-image',
      privateTextPolicy: 'hidden-indexing-and-marking-context',
      completeQuestionPageReview: true,
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
  const source = sourceRecord(index, review.paperId)
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
  const byNumber = new Map(source.questions.map((question) => [Number(String(question.sourceRef?.question || '').replace(/\D/g, '')), question]))
  const paperSource = { ...review, questionPaper, markScheme }
  const reviewed = review.questions.map((questionReview) => {
    assert.ok(topicIds.has(questionReview.primaryTopicId), `${review.paperId} Q${questionReview.questionNumber}: unknown primary syllabus topic`)
    assert.ok(questionReview.secondaryTopicIds.every((topicId) => topicIds.has(topicId)), `${review.paperId} Q${questionReview.questionNumber}: unknown secondary syllabus topic`)
    assert.ok(questionReview.syllabusPointIds.every((pointId) => pointIds.has(pointId)), `${review.paperId} Q${questionReview.questionNumber}: unknown syllabus point`)
    const question = byNumber.get(questionReview.questionNumber)
    const binding = source.bindings.get(question?.questionId)
    const answer = source.answers.get(binding?.answerId)
    return reviewQuestion({ question, answer, binding, review: questionReview, paperSource })
  })
  return {
    schemaVersion: 'reviewed-question-set.v1',
    generatedAt: review.reviewedAt,
    paperId: review.paperId,
    questionCount: reviewed.length,
    totalMarks: reviewed.reduce((sum, item) => sum + item.question.totalMarks, 0),
    sourceFragments: [{ file: ledgerFile, sha256: canonicalTextFileSha256(ledgerPath) }],
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

function mergedIndex(index, reviewedSets) {
  const reviewedQuestions = reviewedSets.flatMap((set) => set.questions)
  const reviewedAnswers = reviewedSets.flatMap((set) => set.answers)
  const reviewedBindings = reviewedSets.flatMap((set) => set.bindings)
  const questionIds = new Set(reviewedQuestions.map((question) => question.questionId))
  const answerIds = new Set(reviewedAnswers.map((answer) => answer.answerId))
  return {
    ...index,
    questions: [...index.questions.filter((question) => !questionIds.has(question.questionId)), ...reviewedQuestions]
      .toSorted((left, right) => stableSort(left.questionId, right.questionId)),
    answers: [...index.answers.filter((answer) => !answerIds.has(answer.answerId)), ...reviewedAnswers]
      .toSorted((left, right) => stableSort(left.answerId, right.answerId)),
    bindings: [...index.bindings.filter((binding) => !questionIds.has(binding.questionId)), ...reviewedBindings]
      .toSorted((left, right) => stableSort(left.questionId, right.questionId)),
  }
}

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
const paperCatalog = JSON.parse(fs.readFileSync(paperCatalogPath, 'utf8'))
const catalogById = new Map((paperCatalog.items || []).map((item) => [item.id, item]))
const reviewedSets = CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_LEDGERS.map((review) => reviewedPaper(index, catalogById, review))
const nextIndex = mergedIndex(index, reviewedSets)

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

console.log(JSON.stringify({
  status: write ? 'written' : 'current',
  schemaVersion: CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_SCHEMA_VERSION,
  paperCount: reviewedSets.length,
  questionCount: reviewedSets.reduce((sum, set) => sum + set.questionCount, 0),
  topicCounts: Object.fromEntries(CAMBRIDGE_9702_AS_SYLLABUS.topics.map((topic) => [
    topic.id,
    reviewedSets.flatMap((set) => set.questions).filter((question) => question.syllabusMapping.primaryTopicId === topic.id).length,
  ])),
}, null, 2))
