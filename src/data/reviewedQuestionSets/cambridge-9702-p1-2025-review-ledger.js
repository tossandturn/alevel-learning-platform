/*
 * Source-of-truth review ledger for two complete Cambridge 9702 Paper 1
 * QP/MS pairs. Each row records the rendered QP page, paired mark-scheme
 * page and reviewer metadata used for semantic release. It is intentionally
 * explicit: this is not a bulk promotion of machine-indexed candidates.
 */

export const CAMBRIDGE_9702_P1_REVIEW_LEDGER_SCHEMA_VERSION = 'cambridge-9702-p1-review-ledger.v1'

const REVIEWED_AT = '2026-08-14T15:30:00+08:00'
const REVIEWED_BY = 'Codex source-semantic-review / 9702-P1-2025'

function topicId(code) {
  return `physics-9702-topic-${String(code).padStart(2, '0')}`
}

function syllabusPointId(sectionCode, outcomeNumber) {
  return `physics-9702-point-${sectionCode.replace('.', '-')}-${String(outcomeNumber).padStart(2, '0')}`
}

function row(questionNumber, correctOption, topicCode, sectionCode, outcomeNumber) {
  return Object.freeze({
    questionNumber,
    correctOption,
    primaryTopicId: topicId(topicCode),
    secondaryTopicIds: Object.freeze([]),
    syllabusPointIds: Object.freeze([syllabusPointId(sectionCode, outcomeNumber)]),
    mappingMethod: 'manual',
    mappingConfidence: 1,
  })
}

function paperReview({
  paperId,
  questionPaperFile,
  markSchemeFile,
  questionPaperPages,
  markSchemePageRanges,
  rows,
}) {
  if (questionPaperPages.length !== 40) throw new Error(`${paperId}: expected one reviewed QP page per question`)
  const reviewedRows = rows.map((entry) => {
    const questionPaperPage = questionPaperPages[entry.questionNumber - 1]
    const markSchemePage = markSchemePageRanges.find((range) => (
      entry.questionNumber >= range.start && entry.questionNumber <= range.end
    ))?.page
    if (!Number.isInteger(questionPaperPage) || !Number.isInteger(markSchemePage)) {
      throw new Error(`${paperId}: Q${entry.questionNumber} is missing reviewed QP/MS page evidence`)
    }
    return Object.freeze({
      ...entry,
      questionPaperPage,
      markSchemePage,
      reviewedBy: REVIEWED_BY,
      reviewedAt: REVIEWED_AT,
    })
  })
  return Object.freeze({
    paperId,
    questionPaperFile,
    markSchemeFile,
    component: 1,
    expectedQuestionCount: 40,
    expectedTotalMarks: 40,
    reviewedAt: REVIEWED_AT,
    reviewedBy: REVIEWED_BY,
    reviewMethod: 'paired-qp-ms-page-review',
    sourcePolicy: 'personal-study-restricted',
    sourcePagePolicy: 'complete-official-page-fallback',
    rows: Object.freeze(reviewedRows),
  })
}

export const CAMBRIDGE_9702_P1_2025_REVIEW_LEDGER = Object.freeze([
  paperReview({
    paperId: 'cie-9702-9702_m25_qp_12',
    questionPaperFile: '9702_m25_qp_12.pdf',
    markSchemeFile: '9702_m25_ms_12.pdf',
    questionPaperPages: Object.freeze([
      3, 3, 3, 3, 4, 4, 4, 5, 5, 5,
      6, 6, 7, 7, 8, 8, 8, 9, 9, 9,
      10, 10, 11, 11, 11, 12, 12, 12, 13, 13,
      13, 14, 14, 14, 15, 15, 15, 16, 16, 16,
    ]),
    markSchemePageRanges: Object.freeze([
      Object.freeze({ start: 1, end: 28, page: 2 }),
      Object.freeze({ start: 29, end: 40, page: 3 }),
    ]),
    rows: [
      row(1, 'D', 1, '1.4', 1),
      row(2, 'D', 1, '1.3', 1),
      row(3, 'C', 3, '3.1', 2),
      row(4, 'A', 2, '2.1', 7),
      row(5, 'A', 2, '2.1', 9),
      row(6, 'C', 3, '3.3', 1),
      row(7, 'B', 3, '3.3', 2),
      row(8, 'B', 3, '3.1', 2),
      row(9, 'A', 4, '4.1', 1),
      row(10, 'A', 4, '4.3', 6),
      row(11, 'C', 4, '4.2', 2),
      row(12, 'D', 1, '1.3', 3),
      row(13, 'D', 4, '4.2', 2),
      row(14, 'A', 5, '5.1', 7),
      row(15, 'B', 5, '5.2', 4),
      row(16, 'A', 5, '5.1', 1),
      row(17, 'B', 5, '5.2', 2),
      row(18, 'A', 5, '5.2', 4),
      row(19, 'D', 6, '6.2', 1),
      row(20, 'D', 6, '6.1', 5),
      row(21, 'B', 6, '6.2', 3),
      row(22, 'A', 7, '7.4', 1),
      row(23, 'D', 7, '7.4', 2),
      row(24, 'C', 7, '7.3', 1),
      row(25, 'B', 7, '7.1', 2),
      row(26, 'A', 7, '7.5', 2),
      row(27, 'C', 8, '8.3', 1),
      row(28, 'C', 8, '8.2', 1),
      row(29, 'C', 8, '8.4', 1),
      row(30, 'D', 9, '9.1', 4),
      row(31, 'C', 9, '9.3', 6),
      row(32, 'A', 9, '9.3', 8),
      row(33, 'C', 9, '9.1', 3),
      row(34, 'B', 10, '10.1', 1),
      row(35, 'C', 10, '10.2', 1),
      row(36, 'B', 10, '10.1', 5),
      row(37, 'B', 11, '11.2', 4),
      row(38, 'B', 3, '3.1', 3),
      row(39, 'D', 11, '11.1', 10),
      row(40, 'D', 11, '11.2', 2),
    ],
  }),
  paperReview({
    paperId: 'cie-9702-9702_s25_qp_11',
    questionPaperFile: '9702_s25_qp_11.pdf',
    markSchemeFile: '9702_s25_ms_11.pdf',
    questionPaperPages: Object.freeze([
      3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 7,
      7, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11,
      11, 11, 12, 12, 12, 12, 12, 12, 13, 13, 14, 14,
      15, 15, 16, 16,
    ]),
    markSchemePageRanges: Object.freeze([
      Object.freeze({ start: 1, end: 28, page: 2 }),
      Object.freeze({ start: 29, end: 40, page: 3 }),
    ]),
    rows: [
      row(1, 'C', 1, '1.4', 1),
      row(2, 'D', 1, '1.3', 2),
      row(3, 'B', 1, '1.3', 3),
      row(4, 'B', 1, '1.4', 2),
      row(5, 'D', 2, '2.1', 7),
      row(6, 'D', 7, '7.4', 1),
      row(7, 'C', 2, '2.1', 6),
      row(8, 'A', 2, '2.1', 9),
      row(9, 'B', 3, '3.3', 3),
      row(10, 'C', 3, '3.1', 5),
      row(11, 'C', 3, '3.1', 4),
      row(12, 'D', 5, '5.1', 7),
      row(13, 'B', 4, '4.1', 3),
      row(14, 'A', 4, '4.3', 6),
      row(15, 'B', 4, '4.2', 2),
      row(16, 'C', 4, '4.3', 4),
      row(17, 'D', 5, '5.2', 2),
      row(18, 'A', 5, '5.1', 1),
      row(19, 'A', 5, '5.2', 4),
      row(20, 'B', 5, '5.1', 2),
      row(21, 'D', 6, '6.1', 4),
      row(22, 'C', 6, '6.2', 2),
      row(23, 'D', 6, '6.1', 5),
      row(24, 'C', 7, '7.3', 2),
      row(25, 'C', 7, '7.2', 1),
      row(26, 'A', 7, '7.1', 2),
      row(27, 'C', 7, '7.4', 3),
      row(28, 'B', 7, '7.5', 1),
      row(29, 'B', 8, '8.1', 1),
      row(30, 'D', 8, '8.4', 1),
      row(31, 'A', 8, '8.1', 2),
      row(32, 'C', 9, '9.3', 1),
      row(33, 'D', 9, '9.3', 3),
      row(34, 'D', 10, '10.2', 4),
      row(35, 'A', 10, '10.3', 4),
      row(36, 'B', 10, '10.2', 6),
      row(37, 'C', 10, '10.1', 5),
      row(38, 'D', 11, '11.2', 1),
      row(39, 'C', 11, '11.1', 10),
      row(40, 'B', 11, '11.2', 2),
    ],
  }),
])
