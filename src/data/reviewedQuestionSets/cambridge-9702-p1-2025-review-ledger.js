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

function focusRegion(top, bottom) {
  if (!Number.isInteger(top) || !Number.isInteger(bottom) || top < 40 || bottom <= top || bottom > 1260) {
    throw new Error(`Invalid 9702 reviewed focus bounds: ${top},${bottom}`)
  }
  return Object.freeze({
    coordinateSpace: 'pixel-xyxy',
    imageSize: Object.freeze([1020, 1320]),
    region: Object.freeze([80, top, 950, bottom]),
    safetyMargin: Object.freeze([20, 20, 20, 20]),
    safetyStatus: 'reviewed-display-bounds-v1',
  })
}

// These bounds were checked against the rendered official QP pages. The
// horizontal margin keeps labels/diagrams inside the crop; the vertical gaps
// keep adjacent printed questions out. A missing bound is a review failure.
const M25_FOCUS_REGIONS = Object.freeze({
  1: focusRegion(80, 275), 2: focusRegion(280, 485), 3: focusRegion(490, 915), 4: focusRegion(920, 1095),
  5: focusRegion(80, 410), 6: focusRegion(415, 555), 7: focusRegion(570, 1070),
  8: focusRegion(80, 255), 9: focusRegion(260, 780), 10: focusRegion(785, 1060),
  11: focusRegion(80, 620), 12: focusRegion(630, 900),
  13: focusRegion(80, 710), 14: focusRegion(720, 1010),
  15: focusRegion(80, 390), 16: focusRegion(390, 920), 17: focusRegion(925, 1100),
  18: focusRegion(80, 270), 19: focusRegion(280, 570), 20: focusRegion(590, 850),
  21: focusRegion(80, 740), 22: focusRegion(750, 1060),
  23: focusRegion(80, 280), 24: focusRegion(290, 780), 25: focusRegion(790, 1010),
  26: focusRegion(80, 300), 27: focusRegion(310, 560), 28: focusRegion(570, 1080),
  29: focusRegion(80, 280), 30: focusRegion(290, 700), 31: focusRegion(710, 1030),
  32: focusRegion(80, 650), 33: focusRegion(660, 970), 34: focusRegion(980, 1110),
  35: focusRegion(80, 550), 36: focusRegion(560, 920), 37: focusRegion(930, 1120),
  38: focusRegion(80, 360), 39: focusRegion(370, 730), 40: focusRegion(740, 1020),
})

const S25_FOCUS_REGIONS = Object.freeze({
  1: focusRegion(80, 270), 2: focusRegion(280, 660), 3: focusRegion(670, 870),
  4: focusRegion(80, 820), 5: focusRegion(830, 1040), 6: focusRegion(1050, 1220),
  7: focusRegion(80, 330), 8: focusRegion(340, 900), 9: focusRegion(910, 1120),
  10: focusRegion(80, 650), 11: focusRegion(660, 1110),
  12: focusRegion(80, 590), 13: focusRegion(600, 900),
  14: focusRegion(80, 550), 15: focusRegion(560, 900), 16: focusRegion(910, 1210),
  17: focusRegion(80, 300), 18: focusRegion(310, 930), 19: focusRegion(990, 1210),
  20: focusRegion(80, 300), 21: focusRegion(310, 790), 22: focusRegion(800, 1080),
  23: focusRegion(80, 300), 24: focusRegion(310, 750), 25: focusRegion(760, 1030), 26: focusRegion(1040, 1250),
  27: focusRegion(80, 210), 28: focusRegion(220, 390), 29: focusRegion(400, 640), 30: focusRegion(650, 800),
  31: focusRegion(810, 1035), 32: focusRegion(1040, 1220),
  33: focusRegion(80, 450), 34: focusRegion(460, 1100),
  35: focusRegion(80, 610), 36: focusRegion(620, 980),
  37: focusRegion(80, 880), 38: focusRegion(890, 1100),
  39: focusRegion(80, 400), 40: focusRegion(410, 700),
})

function paperReview({
  paperId,
  questionPaperFile,
  markSchemeFile,
  questionPaperPages,
  markSchemePageRanges,
  focusRegions,
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
    const focus = focusRegions?.[entry.questionNumber]
    if (!focus) throw new Error(`${paperId}: Q${entry.questionNumber} is missing reviewed display bounds`)
    return Object.freeze({
      ...entry,
      questionPaperPage,
      markSchemePage,
      focus,
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
    focusRegions: M25_FOCUS_REGIONS,
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
    focusRegions: S25_FOCUS_REGIONS,
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
