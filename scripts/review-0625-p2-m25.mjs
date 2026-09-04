import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { CAMBRIDGE_0625_IGCSE_SYLLABUS } from '../src/data/syllabus/cambridge-0625-igcse-2026-2028.js'
import {
  CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER,
  CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER_SCHEMA_VERSION,
} from '../src/data/reviewedQuestionSets/cambridge-0625-p2-m25-review-ledger.js'
import {
  CAMBRIDGE_0625_P2_S25_21_REVIEW_LEDGER,
  CAMBRIDGE_0625_P2_S25_21_REVIEW_LEDGER_SCHEMA_VERSION,
} from '../src/data/reviewedQuestionSets/cambridge-0625-p2-s25-21-review-ledger.js'
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
  return { assetUrl, assetSha256: sha256File(assetPath(assetUrl)) }
}

function sourceRecord(index, paperId) {
  const questions = index.questions
    .filter((question) => question.sourceRef?.paperId === paperId)
    .toSorted((left, right) => questionNumber(left) - questionNumber(right))
  const answers = new Map(index.answers.map((answer) => [answer.answerId, answer]))
  const bindings = new Map(index.bindings.map((binding) => [binding.questionId, binding]))
  return { questions, answers, bindings }
}

function reviewedQuestion({ question, answer, binding, review, paperSource }) {
  assert.ok(question, `Q${review.questionNumber}: source question is missing`)
  assert.ok(answer, `${question.questionId}: paired answer is missing`)
  assert.ok(binding, `${question.questionId}: source binding is missing`)
  assert.equal(question.questionId, `${paperSource.questionPaper.id}:q${review.questionNumber}`, `${question.questionId}: stable question ID mismatch`)
  assert.equal(question.answerId, answer.answerId, `${question.questionId}: question/answer linkage mismatch`)
  assert.equal(question.answerType, 'multiple-choice', `${question.questionId}: 0625 P2 must remain MCQ`)
  assert.equal(question.totalMarks, 1, `${question.questionId}: official MCQ mark count must be one`)
  assert.equal(question.parts?.length, 1, `${question.questionId}: MCQ must have one part`)
  assert.equal(answer.answerParts?.length, 1, `${question.questionId}: answer must have one part`)
  assert.equal(answer.exactAnswer, review.correctOption, `${question.questionId}: MS answer key mismatch`)
  assert.equal(question.sourceRef?.sha256, paperSource.questionPaper.sha256, `${question.questionId}: QP checksum mismatch`)
  assert.equal(answer.answerRef?.sha256, paperSource.markScheme.sha256, `${question.questionId}: MS checksum mismatch`)
  assert.equal(question.parts[0].sourcePage, review.questionPaperPage, `${question.questionId}: indexed QP page mismatch`)
  assert.equal(answer.answerParts[0].sourcePage, review.markSchemePage, `${question.questionId}: indexed MS page mismatch`)
  assert.equal(question.sourceRef?.pageStart, review.questionPaperPage, `${question.questionId}: source range start mismatch`)
  assert.equal(question.sourceRef?.pageEnd, review.questionPaperPage, `${question.questionId}: MCQ source range must be one page`)
  assert.ok(review.syllabusPointIds.every((id) => CAMBRIDGE_0625_IGCSE_SYLLABUS.points.some((point) => point.id === id)), `${question.questionId}: unknown official syllabus point`)
  assert.ok(['machine-indexed', 'reviewed'].includes(binding.verificationStatus), `${question.questionId}: unexpected source binding state`)

  const sourceAsset = sourceAssetForPage(question.sourceRef.assetUrls, review.questionPaperPage, question.questionId)
  const markSchemeAsset = sourceAssetForPage(answer.answerRef.assetUrls, review.markSchemePage, question.questionId)
  const partId = question.parts[0].partId
  const markSchemeText = `Paired Cambridge 0625/22 mark-scheme table: Q${review.questionNumber} = ${review.correctOption} (1 mark).`

  const nextQuestion = {
    ...structuredClone(question),
    knowledgeGroupId: review.primaryTopicId,
    topicId: review.primaryTopicId,
    topicTags: [...new Set([review.primaryTopicId, ...(question.topicTags || [])])],
    questionGroupStatus: 'verified',
    sourceContentComplete: true,
    syllabusMapping: {
      ...(question.syllabusMapping || {}),
      schemaVersion: 'question-syllabus-mapping-v1',
      specificationId: 'cambridge-0625-2026-2028',
      syllabusUrl: CAMBRIDGE_0625_IGCSE_SYLLABUS.officialUrl,
      primaryTopicId: review.primaryTopicId,
      secondaryTopicIds: [...review.secondaryTopicIds],
      syllabusPointIds: [...review.syllabusPointIds],
      confidence: 1,
      mappingMethod: 'manual',
      reviewStatus: 'reviewed',
      reviewedBy: paperSource.reviewedBy,
      reviewedAt: paperSource.reviewedAt,
      reviewEvidence: {
        method: paperSource.reviewMethod,
        syllabusUrl: CAMBRIDGE_0625_IGCSE_SYLLABUS.officialUrl,
        questionPaperId: paperSource.questionPaper.id,
        markSchemeId: paperSource.markScheme.id,
        questionPage: review.questionPaperPage,
        markSchemePage: review.markSchemePage,
        sourcePolicy: paperSource.sourcePolicy,
      },
    },
    provenance: {
      ...(question.provenance || {}),
      reviewPolicy: paperSource.sourcePolicy,
      sourceReviewLedger: CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER_SCHEMA_VERSION,
      syllabusSourceUrl: CAMBRIDGE_0625_IGCSE_SYLLABUS.officialUrl,
    },
    parts: [(() => {
      const {
        answerKey: _answerKey,
        answerText: _answerText,
        markSchemePoints: _markSchemePoints,
        markSchemeEvidence: _markSchemeEvidence,
        answerSourcePage: _answerSourcePage,
        ...questionPart
      } = structuredClone(question.parts[0])
      return {
        ...questionPart,
      sourcePage: review.questionPaperPage,
      sourceEvidence: [{
        documentSha256: question.sourceRef.sha256,
        page: review.questionPaperPage,
        assetUrl: sourceAsset.assetUrl,
        assetSha256: sourceAsset.assetSha256,
      }],
      }
    })()],
    sourceRef: {
      ...structuredClone(question.sourceRef),
      pageStart: review.questionPaperPage,
      pageEnd: review.questionPaperPage,
      assetUrls: [sourceAsset.assetUrl],
    },
  }

  const nextAnswer = {
    ...structuredClone(answer),
    answerKey: review.correctOption,
    exactAnswer: review.correctOption,
    answerParts: [{
      ...structuredClone(answer.answerParts[0]),
      answerKey: review.correctOption,
      sourcePage: review.markSchemePage,
      answerText: review.correctOption,
      markSchemePoints: [markSchemeText],
      markSchemeEvidence: [{
        documentSha256: answer.answerRef.sha256,
        sourcePage: review.markSchemePage,
        assetUrl: markSchemeAsset.assetUrl,
        assetSha256: markSchemeAsset.assetSha256,
        text: markSchemeText,
      }],
    }],
    answerRef: {
      ...structuredClone(answer.answerRef),
      pageStart: review.markSchemePage,
      pageEnd: review.markSchemePage,
      assetUrls: [markSchemeAsset.assetUrl],
    },
  }

  return {
    question: nextQuestion,
    answer: nextAnswer,
    binding: {
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
        questionPaper: { file: nextQuestion.sourceRef.paper, sha256: nextQuestion.sourceRef.sha256, sourceUrl: paperSource.questionPaper.sourceUrl },
        markScheme: { file: nextAnswer.answerRef.file, sha256: nextAnswer.answerRef.sha256, sourceUrl: paperSource.markScheme.sourceUrl },
        partAllocations: [{
          partId,
          marks: 1,
          questionPage: review.questionPaperPage,
          questionRegion: [0, 0, 1, 1],
          markSchemePage: review.markSchemePage,
          markSchemeRegion: [0, 0, 1, 1],
          markPointCount: 1,
          markSchemeEvidence: [markSchemeText],
        }],
      },
    },
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
  assert.ok(fs.existsSync(filePath), `Missing generated artifact ${filePath}; run npm run questions:review-0625-p2`)
  assert.equal(canonicalUtf8LfText(fs.readFileSync(filePath, 'utf8')), content, `Stale generated artifact ${filePath}; run npm run questions:review-0625-p2`)
}

function mergedIndex(index, reviewed) {
  const questionIds = new Set(reviewed.questions.map((question) => question.questionId))
  const answerIds = new Set(reviewed.answers.map((answer) => answer.answerId))
  return {
    ...index,
    questions: [...index.questions.filter((question) => !questionIds.has(question.questionId)), ...reviewed.questions].toSorted((left, right) => stableSort(left.questionId, right.questionId)),
    answers: [...index.answers.filter((answer) => !answerIds.has(answer.answerId)), ...reviewed.answers].toSorted((left, right) => stableSort(left.answerId, right.answerId)),
    bindings: [...index.bindings.filter((binding) => !questionIds.has(binding.questionId)), ...reviewed.bindings].toSorted((left, right) => stableSort(left.questionId, right.questionId)),
  }
}

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
const paperCatalog = JSON.parse(fs.readFileSync(paperCatalogPath, 'utf8'))
const catalogById = new Map((paperCatalog.items || []).map((item) => [item.id, item]))
const reviewSources = new Map([
  [CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER.paperId, {
    ledger: CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER,
    schemaVersion: CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER_SCHEMA_VERSION,
    ledgerFile: 'cambridge-0625-p2-m25-review-ledger.js',
  }],
  [CAMBRIDGE_0625_P2_S25_21_REVIEW_LEDGER.paperId, {
    ledger: CAMBRIDGE_0625_P2_S25_21_REVIEW_LEDGER,
    schemaVersion: CAMBRIDGE_0625_P2_S25_21_REVIEW_LEDGER_SCHEMA_VERSION,
    ledgerFile: 'cambridge-0625-p2-s25-21-review-ledger.js',
  }],
])
const requestedPaperId = process.argv.find((value) => value.startsWith('--paper='))?.slice('--paper='.length)
const source = reviewSources.get(requestedPaperId || CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER.paperId)
assert.ok(source, `Unknown 0625 P2 review ledger: ${requestedPaperId}`)
const { ledger } = source
const { questions, answers, bindings } = sourceRecord(index, ledger.paperId)
assert.equal(questions.length, ledger.expectedQuestionCount, '0625/22 source index must contain Q1-Q40')
assert.deepEqual(ledger.questions.map((review) => review.questionNumber), Array.from({ length: 40 }, (_value, index) => index + 1), '0625/22 ledger must cover Q1-Q40')

const questionPaper = catalogById.get(ledger.paperId)
assert.ok(questionPaper, '0625/22 QP catalog record is missing')
const markScheme = catalogById.get(questionPaper.markSchemeId)
assert.ok(markScheme, '0625/22 paired MS catalog record is missing')
assert.equal(questionPaper.file, ledger.questionPaperFile)
assert.equal(markScheme.file, ledger.markSchemeFile)
assert.equal(questionPaper.governance?.state, 'active')
assert.equal(questionPaper.governance?.accessPolicyId, 'personal-study-restricted-v1')

const answersById = answers
const bindingsById = bindings
const byNumber = new Map(questions.map((question) => [questionNumber(question), question]))
const paperSource = {
  reviewedAt: ledger.reviewedAt,
  reviewedBy: ledger.reviewedBy,
  reviewMethod: ledger.reviewMethod,
  sourcePolicy: ledger.sourcePolicy,
  questionPaper,
  markScheme,
}
const reviewed = ledger.questions.map((review) => reviewedQuestion({
  question: byNumber.get(review.questionNumber),
  answer: answersById.get(byNumber.get(review.questionNumber)?.answerId),
  binding: bindingsById.get(byNumber.get(review.questionNumber)?.questionId),
  review,
  paperSource,
}))
assert.equal(reviewed.reduce((sum, item) => sum + item.question.totalMarks, 0), ledger.expectedTotalMarks)
assert.equal(new Set(reviewed.map((item) => item.question.questionId)).size, 40)

const reviewedSet = {
  schemaVersion: 'reviewed-question-set.v1',
  generatedAt: ledger.reviewedAt,
  paperId: ledger.paperId,
  questionCount: reviewed.length,
  totalMarks: ledger.expectedTotalMarks,
  sourceFragments: [{
    file: source.ledgerFile,
    sha256: canonicalTextFileSha256(path.join(reviewedSetsRoot, source.ledgerFile)),
  }],
  sourceMaterials: {
    questionPaper: { id: questionPaper.id, file: questionPaper.file, sha256: questionPaper.sha256, sourceUrl: questionPaper.sourceUrl, governance: questionPaper.governance },
    markScheme: { id: markScheme.id, file: markScheme.file, sha256: markScheme.sha256, sourceUrl: markScheme.sourceUrl, governance: markScheme.governance },
  },
  questions: reviewed.map((item) => item.question),
  answers: reviewed.map((item) => item.answer),
  bindings: reviewed.map((item) => item.binding),
}
const nextIndex = mergedIndex(index, reviewedSet)
fs.mkdirSync(reviewedSetsRoot, { recursive: true })
assertOrWrite(path.join(reviewedSetsRoot, `${ledger.paperId}.json`), serialise(reviewedSet))
assertOrWrite(indexPath, serialise(nextIndex))

if (write) {
  const result = spawnSync(process.execPath, [auditScript, '--write-manifest'], { cwd: root, encoding: 'utf8', shell: false })
  assert.equal(result.status, 0, `Could not refresh source manifest:\n${result.stdout}\n${result.stderr}`)
}

console.log(JSON.stringify({
  status: write ? 'written' : 'current',
  schemaVersion: source.schemaVersion,
  paperId: ledger.paperId,
  questionCount: reviewedSet.questionCount,
  totalMarks: reviewedSet.totalMarks,
  topicCounts: Object.fromEntries(Object.entries(Object.groupBy(reviewed.map((item) => item.question), (question) => question.syllabusMapping.primaryTopicId)).map(([topicId, items]) => [topicId, items.length]).toSorted(([left], [right]) => left.localeCompare(right))),
}, null, 2))
