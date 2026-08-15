import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { CAMBRIDGE_0606_IGCSE_SYLLABUS } from '../src/data/syllabus/cambridge-0606-igcse-2025-2027.js'
import {
  CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER,
  CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER_SCHEMA_VERSION,
} from '../src/data/reviewedQuestionSets/cambridge-0606-p1-m25-review-ledger.js'
import { canonicalTextFileSha256, canonicalUtf8LfText } from './canonical-text.mjs'

const root = path.resolve(import.meta.dirname, '..')
const indexPath = path.join(root, 'src', 'data', 'importedQuestionIndex.json')
const paperCatalogPath = path.join(root, 'public', 'data', 'papers.json')
const reviewedSetsRoot = path.join(root, 'src', 'data', 'reviewedQuestionSets')
const auditScript = path.join(root, 'scripts', 'audit-question-bank.mjs')
const write = process.argv.includes('--write')

function serialise(value) {
  return canonicalUtf8LfText(`${JSON.stringify(value, null, 2)}\n`)
}

function assertOrWrite(filePath, content) {
  if (write) {
    fs.writeFileSync(filePath, content, 'utf8')
    return
  }
  assert.ok(fs.existsSync(filePath), `Missing generated review artifact ${filePath}; run npm run questions:review-0606-p1`)
  assert.equal(canonicalUtf8LfText(fs.readFileSync(filePath, 'utf8')), content, `Stale generated review artifact ${filePath}; run npm run questions:review-0606-p1`)
}

function questionNumber(question) {
  return Number(String(question?.sourceRef?.question || '').match(/\d+/)?.[0] || 0)
}

function assetUrl(paperId, kind, page) {
  return `/question-assets/${paperId}/${kind}-${String(page).padStart(2, '0')}.jpg`
}

function assetPath(url) {
  const parsed = new URL(url, 'https://review.invalid')
  const parts = parsed.pathname.slice('/question-assets/'.length).split('/')
  assert.equal(parts.length, 2, `Unexpected asset path ${url}`)
  assert.ok(parts.every((part) => part && part !== '.' && part !== '..'), `Unsafe asset path ${url}`)
  return path.join(root, 'public', 'question-assets', ...parts)
}

function assetEvidence(url, page, documentSha256, text = '') {
  const filePath = assetPath(url)
  assert.ok(fs.existsSync(filePath), `Missing reviewed asset ${filePath}`)
  const bytes = fs.readFileSync(filePath)
  assert.ok(bytes.length > 0, `Empty reviewed asset ${filePath}`)
  return {
    documentSha256,
    sourcePage: page,
    page,
    assetUrl: url,
    assetSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    text,
  }
}

function sourceRecord(index) {
  const questions = index.questions.filter((question) => question.sourceRef?.paperId === CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.paperId)
  const answers = new Map(index.answers.map((answer) => [answer.answerId, answer]))
  const bindings = new Map(index.bindings.map((binding) => [binding.questionId, binding]))
  return { questions, answers, bindings }
}

function reviewedQuestion({ rawQuestion, rawAnswer, rawBinding, row, questionPaper, markScheme }) {
  assert.ok(rawQuestion && rawAnswer && rawBinding, `Q${row.questionNumber}: incomplete source index record`)
  assert.equal(questionNumber(rawQuestion), row.questionNumber, `Q${row.questionNumber}: question number mismatch`)
  assert.equal(rawQuestion.sourceRef.paperId, CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.paperId)
  assert.equal(rawQuestion.sourceRef.component, 1)
  assert.equal(rawQuestion.sourceRef.sha256, questionPaper.sha256, `Q${row.questionNumber}: QP checksum mismatch`)
  assert.equal(rawAnswer.answerRef.documentId, markScheme.id, `Q${row.questionNumber}: MS pairing mismatch`)
  assert.equal(rawAnswer.answerRef.sha256, markScheme.sha256, `Q${row.questionNumber}: MS checksum mismatch`)

  const qpPages = [...new Set(row.parts.map((part) => Number(part.questionPage)))].toSorted((a, b) => a - b)
  assert.ok(qpPages.length > 0, `Q${row.questionNumber}: missing QP pages`)
  const msPage = Number(row.markSchemePage)
  assert.ok(Number.isInteger(msPage) && msPage > 0, `Q${row.questionNumber}: missing MS page`)
  const qpAssets = qpPages.map((page) => assetUrl(row.paperId, 'qp', page))
  const msAsset = assetUrl(row.paperId, 'ms', msPage)
  const totalMarks = row.parts.reduce((sum, part) => sum + Number(part.marks), 0)
  assert.ok(totalMarks > 0, `Q${row.questionNumber}: missing marks`)

  const nextQuestion = {
    ...structuredClone(rawQuestion),
    prompt: row.parts.map((part) => part.promptFragment).join('\n\n'),
    knowledgeGroupId: row.topicId,
    topicId: row.topicId,
    topicTags: [...new Set([row.topicId, ...(rawQuestion.topicTags || [])])],
    questionGroupStatus: 'verified',
    totalMarks,
    marks: totalMarks,
    syllabusMapping: {
      ...(rawQuestion.syllabusMapping || {}),
      schemaVersion: 'question-syllabus-mapping-v1',
      specificationId: 'cambridge-0606-2025-2027',
      syllabusUrl: CAMBRIDGE_0606_IGCSE_SYLLABUS.officialUrl,
      knowledgeGroupId: row.topicId,
      primaryTopicId: row.topicId,
      secondaryTopicIds: [],
      syllabusPointIds: [row.pointId],
      confidence: 1,
      mappingMethod: 'manual',
      reviewStatus: 'reviewed',
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      reviewEvidence: {
        method: CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.reviewMethod,
        questionPaperId: questionPaper.id,
        markSchemeId: markScheme.id,
        questionPages: qpPages,
        markSchemePage: msPage,
        sourcePolicy: CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.sourcePolicy,
        sourceUrl: questionPaper.sourceUrl,
      },
    },
    provenance: {
      ...(rawQuestion.provenance || {}),
      reviewPolicy: CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.sourcePolicy,
      sourceReviewLedger: CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER_SCHEMA_VERSION,
    },
    sourceRef: {
      ...structuredClone(rawQuestion.sourceRef),
      pageStart: qpPages[0],
      pageEnd: qpPages.at(-1),
      assetUrls: qpAssets,
    },
    parts: row.parts.map((part, index) => {
      const partId = `${rawQuestion.questionId}:part-${part.label}`
      const sourcePage = Number(part.questionPage)
      return {
        partId,
        label: part.label,
        promptFragment: part.promptFragment,
        marks: Number(part.marks),
        answerArea: { type: 'handwritten', input: 'ink-or-photo' },
        sourcePage,
        sourceEvidence: [assetEvidence(assetUrl(row.paperId, 'qp', sourcePage), sourcePage, questionPaper.sha256)],
        sourcePartOrder: index + 1,
      }
    }),
  }

  const nextAnswer = {
    ...structuredClone(rawAnswer),
    answerRef: {
      ...structuredClone(rawAnswer.answerRef),
      pageStart: msPage,
      pageEnd: msPage,
      assetUrls: [msAsset],
    },
    answer: rawAnswer.exactAnswer,
    answerKey: rawAnswer.exactAnswer,
    answerParts: row.parts.map((part) => {
      const partId = `${rawQuestion.questionId}:part-${part.label}`
      const markSchemeText = part.markSchemePoints.join(' ')
      return {
        partId,
        label: part.label,
        marks: Number(part.marks),
        markSchemePoints: [...part.markSchemePoints],
        answerKey: null,
        answerText: markSchemeText,
        sourcePage: msPage,
        markSchemeEvidence: [assetEvidence(msAsset, msPage, markScheme.sha256, markSchemeText)],
      }
    }),
  }

  const binding = {
    questionId: nextQuestion.questionId,
    answerId: nextAnswer.answerId,
    verificationStatus: 'reviewed',
    questionDocumentSha256: questionPaper.sha256,
    answerDocumentSha256: markScheme.sha256,
    reviewedAt: row.reviewedAt,
    reviewedBy: row.reviewedBy,
    reviewEvidence: {
      method: CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.reviewMethod,
      sourcePolicy: CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.sourcePolicy,
      questionPaper: { file: questionPaper.file, sha256: questionPaper.sha256, sourceUrl: questionPaper.sourceUrl },
      markScheme: { file: markScheme.file, sha256: markScheme.sha256, sourceUrl: markScheme.sourceUrl },
      partAllocations: row.parts.map((part) => ({
        partId: `${rawQuestion.questionId}:part-${part.label}`,
        marks: Number(part.marks),
        questionPage: Number(part.questionPage),
        questionRegion: [0, 0, 1, 1],
        markSchemePage: msPage,
        markSchemeRegion: [0, 0, 1, 1],
        markPointCount: part.markSchemePoints.length,
        markSchemeEvidence: [...part.markSchemePoints],
      })),
    },
  }
  return { question: nextQuestion, answer: nextAnswer, binding }
}

function mergedIndex(index, reviewed) {
  const ids = new Set(reviewed.map((item) => item.question.questionId))
  const answerIds = new Set(reviewed.map((item) => item.answer.answerId))
  return {
    ...index,
    questions: [...index.questions.filter((question) => !ids.has(question.questionId)), ...reviewed.map((item) => item.question)].toSorted((a, b) => a.questionId.localeCompare(b.questionId)),
    answers: [...index.answers.filter((answer) => !answerIds.has(answer.answerId)), ...reviewed.map((item) => item.answer)].toSorted((a, b) => a.answerId.localeCompare(b.answerId)),
    bindings: [...index.bindings.filter((binding) => !ids.has(binding.questionId)), ...reviewed.map((item) => item.binding)].toSorted((a, b) => a.questionId.localeCompare(b.questionId)),
  }
}

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
const catalog = JSON.parse(fs.readFileSync(paperCatalogPath, 'utf8'))
const catalogById = new Map((catalog.items || []).map((item) => [item.id, item]))
const questionPaper = catalogById.get(CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.paperId)
const markScheme = questionPaper && catalogById.get(questionPaper.markSchemeId)
assert.ok(questionPaper && markScheme, '0606 M25 P1 requires an active QP/MS pair')
assert.equal(questionPaper.governance?.state, 'active')
assert.equal(markScheme.governance?.state, 'active')

const { questions, answers, bindings } = sourceRecord(index)
assert.equal(questions.length, CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.questionCount, '0606 M25 P1 must contain Q1-Q12')
const answersById = new Map(answers)
const bindingsById = new Map(bindings)
const reviewed = CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.rows.map((row) => {
  const question = questions.find((candidate) => questionNumber(candidate) === row.questionNumber)
  assert.ok(question, `0606 M25 P1 Q${row.questionNumber} missing`)
  return reviewedQuestion({
    rawQuestion: question,
    rawAnswer: answersById.get(question.answerId),
    rawBinding: bindingsById.get(question.questionId),
    row: { ...row, paperId: CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.paperId },
    questionPaper,
    markScheme,
  })
})
assert.equal(reviewed.reduce((sum, item) => sum + item.question.totalMarks, 0), CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.totalMarks)

const reviewedSet = {
  schemaVersion: 'reviewed-question-set.v1',
  generatedAt: CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.reviewedAt,
  paperId: CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.paperId,
  questionCount: reviewed.length,
  totalMarks: CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.totalMarks,
  sourceFragments: [{
    file: 'cambridge-0606-p1-m25-review-ledger.js',
    sha256: canonicalTextFileSha256(path.join(root, 'src', 'data', 'reviewedQuestionSets', 'cambridge-0606-p1-m25-review-ledger.js')),
  }],
  sourceMaterials: {
    questionPaper: { id: questionPaper.id, file: questionPaper.file, sha256: questionPaper.sha256, sourceUrl: questionPaper.sourceUrl, governance: questionPaper.governance },
    markScheme: { id: markScheme.id, file: markScheme.file, sha256: markScheme.sha256, sourceUrl: markScheme.sourceUrl, governance: markScheme.governance },
  },
  questions: reviewed.map((item) => item.question),
  answers: reviewed.map((item) => item.answer),
  bindings: reviewed.map((item) => item.binding),
}

fs.mkdirSync(reviewedSetsRoot, { recursive: true })
assertOrWrite(path.join(reviewedSetsRoot, `${CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.paperId}.json`), serialise(reviewedSet))
assertOrWrite(indexPath, serialise(mergedIndex(index, reviewed)))

if (write) {
  const result = spawnSync(process.execPath, [auditScript, '--write-manifest'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, `Could not refresh source manifest:\n${result.stdout}\n${result.stderr}`)
}

console.log(JSON.stringify({
  status: write ? 'written' : 'current',
  schemaVersion: CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER_SCHEMA_VERSION,
  paperId: CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.paperId,
  questionCount: reviewed.length,
  totalMarks: CAMBRIDGE_0606_P1_M25_REVIEW_LEDGER.totalMarks,
  topicCounts: Object.fromEntries(Object.entries(Object.groupBy(reviewed, (item) => item.question.syllabusMapping.primaryTopicId)).map(([key, value]) => [key, value.length])),
}))
