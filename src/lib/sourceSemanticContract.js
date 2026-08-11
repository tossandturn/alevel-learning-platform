import { sourcePartPages, sourceQuestionId } from './sourceContentContract.js'

export const SOURCE_SEMANTIC_REVIEW_SCHEMA_VERSION = 'source-semantic-review-v1'

// These records were found by visual review of the official BPhO IPC source.
// They remain excluded until a reviewer creates a complete, part-level binding.
export const SEMANTIC_REVIEW_FIXTURES = Object.freeze({
  'bpho-2025_IPC:q13': Object.freeze({
    reason: 'question-group-truncated:official-q13-continues-on-pages-12-15',
    questionPages: Object.freeze([11, 12, 13, 14, 15]),
    partLabels: Object.freeze(['a', 'b', 'c', 'd', 'e', 'f']),
    partMarks: Object.freeze([1, 2, 3, 2, 4, 3]),
    totalMarks: 15,
    markSchemePages: Object.freeze([4]),
  }),
  'bpho-2025_IPC:q14': Object.freeze({
    reason: 'question-group-truncated:official-q14-task-and-graph-continue-on-pages-17-19',
    questionPages: Object.freeze([16, 17, 18, 19]),
    partLabels: Object.freeze(['a', 'b', 'c', 'd', 'e']),
    partMarks: Object.freeze([3, 3, 3, 3, 3]),
    totalMarks: 15,
    markSchemePages: Object.freeze([4, 5]),
  }),
  'cie-0580-0580_m25_qp_22:q11': Object.freeze({
    reason: 'question-group-truncated:official-q11-continues-on-page-9-with-parts-a-to-d',
    questionPages: Object.freeze([8, 9]),
    partLabels: Object.freeze(['a', 'b', 'c', 'd']),
    totalMarks: 10,
  }),
  'cie-0580-0580_s25_qp_21:q12': Object.freeze({
    reason: 'question-group-truncated:official-q12-omits-part-b-and-required-task',
    questionPages: Object.freeze([9]),
    partLabels: Object.freeze(['a', 'b']),
    totalMarks: 4,
  }),
  'cie-0625-0625_m25_qp_42:q6': Object.freeze({
    reason: 'question-group-truncated:official-q6-continues-on-page-11-with-part-a-iv-and-b',
    questionPages: Object.freeze([10, 11]),
    partLabels: Object.freeze(['a(i)', 'a(ii)', 'a(iii)', 'a(iv)', 'b']),
    totalMarks: 9,
  }),
  'cie-9701-9701_m25_qp_22:q4': Object.freeze({
    reason: 'question-group-truncated:official-q4-continues-on-page-11-with-parts-a-and-b',
    questionPages: Object.freeze([10, 11]),
    partLabels: Object.freeze(['a', 'b(i)', 'b(ii)', 'b(iii)']),
    totalMarks: 11,
  }),
  'cie-9709-9709_m25_qp_32:q8': Object.freeze({
    reason: 'question-group-truncated:official-q8-continues-on-page-13-with-part-b',
    questionPages: Object.freeze([12, 13]),
    partLabels: Object.freeze(['a', 'b']),
    totalMarks: 8,
  }),
  'amc12-amc12-2025A-exam:q12': Object.freeze({
    reason: 'mark-scheme-source-contaminated:question-assets-mix-neighbouring-question-pages',
  }),
  'amc12-amc12-2025A-exam:q15': Object.freeze({
    reason: 'mark-scheme-key-mismatch:stored-answer-b-conflicts-with-official-answer-c',
  }),
  'amc12-amc12-2025A-exam:q24': Object.freeze({
    reason: 'mark-scheme-source-contaminated:question-assets-mix-neighbouring-question-pages',
  }),
  'tmua-TMUA-2023-paper-2:q18': Object.freeze({
    reason: 'mark-scheme-key-mismatch:stored-answer-b-conflicts-with-official-answer-d',
  }),
})

// These are reviewed high-priority page-range candidates. They are not proof
// that every intermediate page belongs to the preceding question, but they
// remain unavailable until a semantic reviewer resolves that question group.
export const HIGH_PRIORITY_SOURCE_RANGE_REVIEW_IDS = Object.freeze([
  'bpho-2025_IPC:q13',
  'cie-0625-0625_m25_qp_42:q6',
  'cie-9231-9231_s25_qp_13:q2',
  'cie-9231-9231_s25_qp_14:q2',
  'cie-9231-9231_s25_qp_22:q3',
  'cie-9231-9231_s25_qp_22:q5',
  'cie-9231-9231_s25_qp_22:q7',
  'cie-9709-9709_m25_qp_32:q2',
  'cie-9709-9709_m25_qp_32:q8',
  'esat-ENGAA_2023_S1_QuestionPaper:q20',
  'esat-ENGAA_2023_S1_QuestionPaper:q33',
  'esat-ENGAA_2023_S1_QuestionPaper:q37',
  'esat-NSAA_2023_S1_QuestionPaper:q40',
  'esat-NSAA_2023_S1_QuestionPaper:q60',
])

// A page gap does not automatically mean missing source content. These cases
// were visually checked: the omitted page is blank or carries only additional
// answer lines. They remain unreviewed, but are not semantic-range failures.
export const RESOLVED_NON_CONTENT_PAGE_GAPS = Object.freeze({
  'cie-9702-9702_m25_qp_42:q2': Object.freeze({
    sourceContentPages: Object.freeze([6, 7]),
    ignoredPage: 8,
    reason: 'blank-page-after-complete-q2',
  }),
  'cie-9702-9702_m25_qp_42:q9': Object.freeze({
    sourceContentPages: Object.freeze([22, 23, 24]),
    ignoredPage: 25,
    reason: 'blank-page-after-complete-q9',
  }),
  'cie-9231-9231_s25_qp_21:q3': Object.freeze({ reason: 'working-space-only-after-complete-q3' }),
  'cie-9231-9231_s25_qp_21:q5': Object.freeze({ reason: 'working-space-only-after-complete-q5' }),
  'cie-9231-9231_s25_qp_21:q7': Object.freeze({ reason: 'working-space-only-after-complete-q7' }),
})

function asInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function answerPartsFor(question, answer) {
  return Array.isArray(answer?.answerParts)
    ? answer.answerParts
    : Array.isArray(question?.answerParts)
      ? question.answerParts
      : []
}

function semanticQuarantine(questionId, reasons) {
  return Object.freeze({
    status: 'semantic-quarantined',
    reasons: Object.freeze([...new Set(Array.isArray(reasons) ? reasons : [reasons])]),
  })
}

function canonicalPartLabel(value) {
  return String(value || '').trim().toLowerCase().replace(/^\(|\)$/g, '')
}

function explicitPartLabels(value) {
  const labels = new Set()
  const pattern = /(?:^|[\r\n])\s*\(?([a-z])\)?[):](?=\s|$)/gim
  let match = pattern.exec(String(value || ''))
  while (match) {
    labels.add(match[1].toLowerCase())
    match = pattern.exec(String(value || ''))
  }
  return labels
}

/**
 * This does not try to infer missing answers. It only identifies records whose
 * declared QuestionGroup contradicts their own structured QP/MS data so they
 * can be explicitly reviewed or quarantined.
 */
export function sourceStructuralConsistencyIssues(question = {}, answer = null) {
  const questionParts = Array.isArray(question.parts) ? question.parts : []
  const answerParts = answerPartsFor(question, answer)
  const reasons = []
  const questionMarks = questionParts.reduce((sum, part) => sum + (asInteger(part?.marks) || 0), 0)
  const answerMarks = answerParts.reduce((sum, part) => sum + (asInteger(part?.marks) || 0), 0)
  const totalMarks = asInteger(question.totalMarks ?? question.marks)
  const questionLabels = new Set(questionParts.map((part) => canonicalPartLabel(part?.label || part?.partId?.split(':part-')[1])).filter(Boolean))
  const answerLabels = new Set(answerParts.map((part) => canonicalPartLabel(part?.label || part?.partId?.split(':part-')[1])).filter(Boolean))
  const explicitLabels = explicitPartLabels(answer?.exactAnswer || answer?.answer || '')

  if (totalMarks && questionMarks !== totalMarks) reasons.push(`question-part-marks-do-not-sum-to-total:${questionMarks}/${totalMarks}`)
  if (totalMarks && answerParts.length && answerMarks !== totalMarks) reasons.push(`mark-scheme-part-marks-do-not-sum-to-total:${answerMarks}/${totalMarks}`)
  if (questionParts.length !== answerParts.length) reasons.push(`question-mark-scheme-part-count-mismatch:${questionParts.length}/${answerParts.length}`)
  for (const label of questionLabels) {
    if (!answerLabels.has(label)) reasons.push(`mark-scheme-part-label-missing:${label}`)
  }
  for (const label of answerLabels) {
    if (!questionLabels.has(label)) reasons.push(`question-part-label-missing:${label}`)
  }
  const missingExplicitLabels = [...explicitLabels].filter((label) => !questionLabels.has(label))
  if (missingExplicitLabels.length) reasons.push(`answer-text-has-unbound-part-labels:${missingExplicitLabels.join(',')}`)

  return Object.freeze([...new Set(reasons)])
}

/**
 * File and range checks cannot prove that an OCR question group contains every
 * page, shared stimulus, and part. Only a paired human QP/MS review with
 * part-level evidence may make an imported group practice-available.
 */
export function sourceSemanticVerificationStatus(question = {}, { binding = question.answerBinding || null, answer = null } = {}) {
  const questionId = sourceQuestionId(question)
  const override = SEMANTIC_REVIEW_FIXTURES[questionId]
  const structuralIssues = sourceStructuralConsistencyIssues(question, answer)
  if (override) return semanticQuarantine(questionId, [override.reason, ...structuralIssues])

  if (binding?.verificationStatus === 'quarantined' || question.questionGroupStatus === 'quarantined') {
    return semanticQuarantine(questionId, ['index-quarantined', ...structuralIssues])
  }
  if (structuralIssues.length) {
    return semanticQuarantine(questionId, structuralIssues)
  }
  if (binding?.verificationStatus !== 'reviewed') {
    return Object.freeze({
      status: 'unreviewed',
      reasons: Object.freeze(['human-semantic-review-required']),
    })
  }

  const parts = sourcePartPages(question)
  const answerParts = answerPartsFor(question, answer)
  const evidence = binding.reviewEvidence || {}
  const allocations = new Map((evidence.partAllocations || []).map((allocation) => [String(allocation?.partId || ''), allocation]))
  const answerPartsById = new Map(answerParts.map((part) => [String(part?.partId || ''), part]))
  const reasons = []

  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(binding.reviewedAt || ''))) reasons.push('semantic-review-missing-timestamp')
  if (!String(binding.reviewedBy || '').trim()) reasons.push('semantic-review-missing-reviewer')
  if (evidence.method !== 'paired-qp-ms-page-review') reasons.push('semantic-review-unsupported-method')
  if (evidence.questionPaper?.sha256 !== question.sourceRef?.sha256) reasons.push('semantic-review-question-checksum-mismatch')
  if (evidence.markScheme?.sha256 !== (answer?.answerRef || question.answerRef)?.sha256) reasons.push('semantic-review-mark-scheme-checksum-mismatch')
  if (!parts.length) reasons.push('semantic-review-missing-question-parts')
  if (allocations.size !== parts.length) reasons.push('semantic-review-part-allocation-count-mismatch')

  for (const part of parts) {
    const allocation = allocations.get(part.partId)
    const answerPart = answerPartsById.get(part.partId)
    if (!allocation) {
      reasons.push(`semantic-review-missing-part:${part.partId || 'unknown'}`)
      continue
    }
    if (asInteger(allocation.marks) !== asInteger((question.parts || []).find((candidate) => String(candidate?.partId || candidate?.id || candidate?.label || '') === part.partId)?.marks)) {
      reasons.push(`semantic-review-part-marks-mismatch:${part.partId || 'unknown'}`)
    }
    if (asInteger(allocation.questionPage) !== part.page) reasons.push(`semantic-review-question-page-mismatch:${part.partId || 'unknown'}`)
    if (!Array.isArray(allocation.questionRegion) || allocation.questionRegion.length !== 4) reasons.push(`semantic-review-question-region-missing:${part.partId || 'unknown'}`)
    if (!answerPart) {
      reasons.push(`semantic-review-answer-part-missing:${part.partId || 'unknown'}`)
      continue
    }
    if (!asInteger(answerPart.sourcePage ?? answerPart.page)) reasons.push(`semantic-review-mark-scheme-page-missing:${part.partId || 'unknown'}`)
    if (asInteger(allocation.markSchemePage) !== asInteger(answerPart.sourcePage ?? answerPart.page)) reasons.push(`semantic-review-mark-scheme-page-mismatch:${part.partId || 'unknown'}`)
    if (!Array.isArray(allocation.markSchemeRegion) || allocation.markSchemeRegion.length !== 4) reasons.push(`semantic-review-mark-scheme-region-missing:${part.partId || 'unknown'}`)
    if (!Array.isArray(allocation.markSchemeEvidence) || !allocation.markSchemeEvidence.length) reasons.push(`semantic-review-mark-scheme-evidence-missing:${part.partId || 'unknown'}`)
  }

  if (reasons.length) return Object.freeze({ status: 'semantic-quarantined', reasons: Object.freeze([...new Set(reasons)]) })
  return Object.freeze({ status: 'verified-complete', reasons: Object.freeze([]) })
}

export function knownSemanticQuarantine(question = {}) {
  return SEMANTIC_REVIEW_FIXTURES[sourceQuestionId(question)] || null
}
