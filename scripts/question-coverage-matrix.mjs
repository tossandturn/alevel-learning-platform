import fs from 'node:fs'
import path from 'node:path'
import { sourceContentStatus } from '../src/lib/questionContent.js'

const root = path.resolve(import.meta.dirname, '..')
const index = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'importedQuestionIndex.json'), 'utf8'))
const requestedPaperId = process.argv.find((value) => value.startsWith('--paper='))?.slice('--paper='.length)
const expectedQuestionCounts = Object.freeze({
  // The official 0580 March 2025 Paper 1 paper has Q1-Q26.
  'cie-0580-0580_m25_qp_12': 26,
  // The official 9709 March 2025 P1 paper has 11 printed questions.
  'cie-9709-9709_m25_qp_12': 11,
})

const answers = new Map(index.answers.map((answer) => [answer.answerId, answer]))
const bindings = new Map(index.bindings.map((binding) => [binding.questionId, binding]))

function printedNumber(question) {
  const match = String(question?.sourceRef?.question || '').match(/\d+/)
  return match ? Number(match[0]) : null
}

function rowFor(question) {
  const binding = bindings.get(question.questionId)
  const answer = answers.get(binding?.answerId)
  const reviewStatus = binding?.verificationStatus || 'unindexed'
  const sourceContent = sourceContentStatus({
    ...question,
    answerBinding: binding,
    answerParts: answer?.answerParts || question.answerParts,
    answerRef: answer?.answerRef || question.answerRef,
  })
  const sourceBound = Boolean(question.prompt?.trim() && answer)
  const indexQuarantined = reviewStatus === 'quarantined' || question.questionGroupStatus === 'quarantined'
  const sourceAdditionalQuarantine = !indexQuarantined && sourceContent.fileComplete === false
  const effectiveQuarantined = indexQuarantined || !sourceContent.complete
  const practiceAvailable = sourceBound && !effectiveQuarantined
  const aiAssistedMarking = practiceAvailable && reviewStatus === 'reviewed' && sourceContent.semanticStatus === 'verified-complete'
  return {
    questionNumber: printedNumber(question),
    questionId: question.questionId,
    paperId: question.sourceRef?.paperId || null,
    marks: Number(question.marks) || null,
    questionPaperPage: question.sourceRef?.pageStart || null,
    markSchemePage: answer?.answerRef?.pageStart || null,
    reviewStatus,
    sourceBound,
    sourceFileComplete: sourceContent.fileComplete,
    semanticVerificationStatus: sourceContent.semanticStatus,
    sourceIncompleteReasons: sourceContent.reasons,
    indexQuarantined,
    sourceAdditionalQuarantine,
    effectiveQuarantined,
    practiceAvailable,
    deterministicScoring: practiceAvailable && Boolean(question.answerKey),
    aiAssistedMarking,
    scoringPolicy: !practiceAvailable ? 'source-incomplete-or-unreviewed' : aiAssistedMarking ? 'reviewed-ai-assisted' : 'verified-deterministic',
  }
}

const indexedRows = index.questions.map(rowFor)
const indexQuarantinedCount = indexedRows.filter((row) => row.indexQuarantined).length
const sourceAdditionalQuarantinedCount = indexedRows.filter((row) => row.sourceAdditionalQuarantine).length
const fileGateEffectiveQuarantined = indexQuarantinedCount + sourceAdditionalQuarantinedCount
const semanticVerificationCoverage = indexedRows.reduce((result, row) => ({
  ...result,
  [row.semanticVerificationStatus]: (result[row.semanticVerificationStatus] || 0) + 1,
}), {})

const papers = [...new Set(index.questions.map((question) => question.sourceRef?.paperId).filter(Boolean))]
const paperIds = requestedPaperId ? [requestedPaperId] : papers
const coverage = paperIds.map((paperId) => {
  const indexed = indexedRows.filter((question) => question.paperId === paperId)
  const expectedCount = expectedQuestionCounts[paperId] || Math.max(0, ...indexed.map((row) => row.questionNumber || 0))
  const byNumber = new Map(indexed.map((row) => [row.questionNumber, row]))
  const rows = Array.from({ length: expectedCount }, (_, index) => byNumber.get(index + 1) || ({
    questionNumber: index + 1,
    questionId: null,
    marks: null,
    questionPaperPage: null,
    markSchemePage: null,
    reviewStatus: 'unindexed',
    sourceBound: false,
    sourceFileComplete: false,
    semanticVerificationStatus: 'unindexed',
    sourceIncompleteReasons: ['unindexed-question'],
    indexQuarantined: false,
    sourceAdditionalQuarantine: false,
    effectiveQuarantined: true,
    practiceAvailable: false,
    deterministicScoring: false,
    aiAssistedMarking: false,
    scoringPolicy: 'self-mark-only',
  }))
  return {
    paperId,
    expectedQuestionCount: expectedCount,
    indexedQuestionCount: indexed.length,
    totals: {
      sourceBound: rows.filter((row) => row.sourceBound).length,
      sourceFileComplete: rows.filter((row) => row.sourceFileComplete).length,
      practiceAvailable: rows.filter((row) => row.practiceAvailable).length,
      deterministicScoring: rows.filter((row) => row.deterministicScoring).length,
      aiAssistedMarking: rows.filter((row) => row.aiAssistedMarking).length,
      machineIndexed: rows.filter((row) => row.reviewStatus === 'machine-indexed').length,
      indexQuarantined: rows.filter((row) => row.indexQuarantined).length,
      sourceAdditionalQuarantined: rows.filter((row) => row.sourceAdditionalQuarantine).length,
      effectiveQuarantined: rows.filter((row) => row.effectiveQuarantined).length,
      unindexed: rows.filter((row) => row.reviewStatus === 'unindexed').length,
    },
    questions: rows,
  }
})

console.log(JSON.stringify({
  schemaVersion: 'question-coverage-matrix.v2',
  inventory: {
    questions: indexedRows.length,
    fileGate: {
      indexQuarantined: indexQuarantinedCount,
      sourceAdditionalQuarantined: sourceAdditionalQuarantinedCount,
      effectiveQuarantined: fileGateEffectiveQuarantined,
      effectiveAvailable: indexedRows.length - fileGateEffectiveQuarantined,
    },
    semanticVerificationCoverage: Object.fromEntries(Object.entries(semanticVerificationCoverage).sort(([left], [right]) => left.localeCompare(right))),
    effectivePracticeGate: {
      effectiveQuarantined: indexedRows.filter((row) => row.effectiveQuarantined).length,
      effectiveAvailable: indexedRows.filter((row) => row.practiceAvailable).length,
    },
  },
  coverage,
}, null, 2))
