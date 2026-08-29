const ROUTE_ID = 'cie-0580-igcse-mathematics'
const PAPER_ID = 'cie-0580-0580_m25_qp_12'
const REVIEWED_AT = '2026-08-28T02:08:54.734Z'
const REVIEWED_BY = 'codex-ai-syllabus-review-v1'

function point(sectionCode) {
  return `math-0580-point-${sectionCode.replace('.', '-')}`
}

function row(questionNumber, primaryTopicId, sectionCodes, secondaryTopicIds = []) {
  return Object.freeze({
    questionId: `${PAPER_ID}:q${questionNumber}`,
    routeId: ROUTE_ID,
    primaryTopicId,
    secondaryTopicIds: Object.freeze(secondaryTopicIds),
    syllabusPointIds: Object.freeze(sectionCodes.map(point)),
    confidence: 1,
    mappingMethod: 'independent-ai-syllabus-review',
    reviewStatus: 'reviewed',
    reviewedBy: REVIEWED_BY,
    reviewedAt: REVIEWED_AT,
  })
}

export const CAMBRIDGE_0580_P1_M25_SYLLABUS_REVIEW = Object.freeze({
  schemaVersion: 'cambridge-0580-p1-m25-syllabus-review.v1',
  routeId: ROUTE_ID,
  paperId: PAPER_ID,
  specificationId: 'cambridge-0580-2025-2027',
  syllabusUrl: 'https://www.cambridgeinternational.org/Images/662466-2025-2027-syllabus.pdf',
  reviewedAt: REVIEWED_AT,
  reviewedBy: REVIEWED_BY,
  reviewMethod: 'Prompt, whole-question structure, existing QP/MS evidence, and official syllabus point reconciliation.',
  rows: Object.freeze([
    row(1, '0580-igcse-topic-01', ['C1.1']),
    row(2, '0580-igcse-topic-01', ['C1.4', 'C1.8']),
    row(3, '0580-igcse-topic-01', ['C1.1']),
    row(4, '0580-igcse-topic-01', ['C1.3', 'C1.7']),
    row(5, '0580-igcse-topic-04', ['C4.5']),
    row(6, '0580-igcse-topic-01', ['C1.6']),
    row(7, '0580-igcse-topic-01', ['C1.6']),
    row(8, '0580-igcse-topic-01', ['C1.5']),
    row(9, '0580-igcse-topic-01', ['C1.15']),
    row(10, '0580-igcse-topic-05', ['C5.2', 'C1.13'], ['0580-igcse-topic-01']),
    row(11, '0580-igcse-topic-01', ['C1.6']),
    row(12, '0580-igcse-topic-02', ['C2.2', 'C5.4'], ['0580-igcse-topic-05']),
    row(13, '0580-igcse-topic-05', ['C5.1']),
    row(14, '0580-igcse-topic-05', ['C5.4', 'C4.1', 'C6.1'], ['0580-igcse-topic-04', '0580-igcse-topic-06']),
    row(15, '0580-igcse-topic-04', ['C4.1', 'C4.6']),
    row(16, '0580-igcse-topic-09', ['C9.5']),
    row(17, '0580-igcse-topic-03', ['C3.3', 'C3.5']),
    row(18, '0580-igcse-topic-02', ['C2.10']),
    row(19, '0580-igcse-topic-02', ['C2.6', 'C1.1'], ['0580-igcse-topic-01']),
    row(20, '0580-igcse-topic-01', ['C1.10']),
    row(21, '0580-igcse-topic-02', ['C2.1', 'C2.2']),
    row(22, '0580-igcse-topic-01', ['C1.4', 'C1.6']),
    row(23, '0580-igcse-topic-08', ['C8.2', 'C8.3']),
    row(24, '0580-igcse-topic-05', ['C5.2', 'C5.3']),
    row(25, '0580-igcse-topic-04', ['C4.4']),
    row(26, '0580-igcse-topic-02', ['C2.5']),
  ]),
})

export const CAMBRIDGE_0580_P1_M25_SYLLABUS_REVIEW_BY_QUESTION_ID = Object.freeze(
  Object.fromEntries(CAMBRIDGE_0580_P1_M25_SYLLABUS_REVIEW.rows.map((entry) => [entry.questionId, entry])),
)
