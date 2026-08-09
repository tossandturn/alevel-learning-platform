import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const index = JSON.parse(fs.readFileSync(path.join(root, 'src', 'data', 'importedQuestionIndex.json'), 'utf8'))
const requestedPaperId = process.argv.find((value) => value.startsWith('--paper='))?.slice('--paper='.length)
const expectedQuestionCounts = Object.freeze({
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
  const sourceAvailable = Boolean(question.prompt?.trim() && answer)
  const quarantined = reviewStatus === 'quarantined' || question.questionGroupStatus === 'quarantined'
  const practiceAvailable = sourceAvailable && !quarantined
  const aiAssistedMarking = reviewStatus === 'reviewed'
  return {
    questionNumber: printedNumber(question),
    questionId: question.questionId,
    marks: Number(question.marks) || null,
    questionPaperPage: question.sourceRef?.pageStart || null,
    markSchemePage: answer?.answerRef?.pageStart || null,
    reviewStatus,
    sourceAvailable,
    practiceAvailable,
    deterministicScoring: practiceAvailable && Boolean(question.answerKey),
    aiAssistedMarking,
    scoringPolicy: !practiceAvailable ? 'quarantined-or-unindexed' : aiAssistedMarking ? 'reviewed-ai-assisted' : 'self-mark-only',
  }
}

const papers = [...new Set(index.questions.map((question) => question.sourceRef?.paperId).filter(Boolean))]
const paperIds = requestedPaperId ? [requestedPaperId] : papers
const coverage = paperIds.map((paperId) => {
  const indexed = index.questions.filter((question) => question.sourceRef?.paperId === paperId).map(rowFor)
  const expectedCount = expectedQuestionCounts[paperId] || Math.max(0, ...indexed.map((row) => row.questionNumber || 0))
  const byNumber = new Map(indexed.map((row) => [row.questionNumber, row]))
  const rows = Array.from({ length: expectedCount }, (_, index) => byNumber.get(index + 1) || ({
    questionNumber: index + 1,
    questionId: null,
    marks: null,
    questionPaperPage: null,
    markSchemePage: null,
    reviewStatus: 'unindexed',
    sourceAvailable: false,
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
      sourceAvailable: rows.filter((row) => row.sourceAvailable).length,
      practiceAvailable: rows.filter((row) => row.practiceAvailable).length,
      deterministicScoring: rows.filter((row) => row.deterministicScoring).length,
      aiAssistedMarking: rows.filter((row) => row.aiAssistedMarking).length,
      machineIndexed: rows.filter((row) => row.reviewStatus === 'machine-indexed').length,
      quarantined: rows.filter((row) => row.reviewStatus === 'quarantined').length,
      unindexed: rows.filter((row) => row.reviewStatus === 'unindexed').length,
    },
    questions: rows,
  }
})

console.log(JSON.stringify({ schemaVersion: 'question-coverage-matrix.v1', coverage }, null, 2))
