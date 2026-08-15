/*
 * Manual source-semantic review ledger for the 9702 AS Paper 2 question
 * groups used to bring every official syllabus topic to ten reviewed groups.
 *
 * Each entry was checked against every listed QP page and the paired MS page.
 * The generated student record shows the official page images; imported OCR is
 * retained only as private indexing/marking context and is not the question UI.
 */

export const CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_SCHEMA_VERSION = 'cambridge-9702-p2-topic-coverage-review.v1'

const REVIEWED_AT = '2026-08-15T18:30:00+08:00'
const REVIEWED_BY = 'Codex manual QP/MS visual review / 9702-P2-topic-coverage'

function topicId(code) {
  return `physics-9702-topic-${String(code).padStart(2, '0')}`
}

function syllabusPointId(sectionCode, outcomeNumber) {
  return `physics-9702-point-${sectionCode.replace('.', '-')}-${String(outcomeNumber).padStart(2, '0')}`
}

function part(label, marks, questionPage, markSchemePage, markSchemePoints = []) {
  if (markSchemePoints.length && (
    markSchemePoints.length !== marks
    || !markSchemePoints.every((point) => String(point || '').trim())
  )) {
    throw new Error(`${label}: reviewed mark-scheme points must close to ${marks} marks`)
  }
  return Object.freeze({
    label,
    marks,
    questionPage,
    markSchemePage,
    markSchemePoints: Object.freeze(markSchemePoints.map((point) => String(point).trim())),
  })
}

function question({
  questionNumber,
  primaryTopicCode,
  secondaryTopicCodes = [],
  syllabusPoints,
  questionPages,
  markSchemePages,
  parts,
}) {
  const totalMarks = parts.reduce((sum, item) => sum + item.marks, 0)
  if (!parts.length || !questionPages.length || !markSchemePages.length) {
    throw new Error(`Q${questionNumber}: reviewed parts and pages are required`)
  }
  if (!parts.every((item) => questionPages.includes(item.questionPage) && markSchemePages.includes(item.markSchemePage))) {
    throw new Error(`Q${questionNumber}: every part must bind to a reviewed QP and MS page`)
  }
  return Object.freeze({
    questionNumber,
    primaryTopicId: topicId(primaryTopicCode),
    secondaryTopicIds: Object.freeze(secondaryTopicCodes.map(topicId)),
    syllabusPointIds: Object.freeze(syllabusPoints.map(([sectionCode, outcomeNumber]) => syllabusPointId(sectionCode, outcomeNumber))),
    mappingMethod: 'manual',
    mappingConfidence: 1,
    questionPages: Object.freeze([...questionPages]),
    markSchemePages: Object.freeze([...markSchemePages]),
    totalMarks,
    parts: Object.freeze([...parts]),
  })
}

function paper({ paperId, questionPaperFile, markSchemeFile, questions }) {
  return Object.freeze({
    paperId,
    questionPaperFile,
    markSchemeFile,
    component: 2,
    reviewScope: 'selected-question-groups',
    reviewedAt: REVIEWED_AT,
    reviewedBy: REVIEWED_BY,
    reviewMethod: 'paired-qp-ms-page-review',
    manualVisualReview: true,
    sourcePolicy: 'personal-study-restricted',
    sourcePagePolicy: 'complete-official-question-pages',
    questions: Object.freeze([...questions]),
  })
}

export const CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_LEDGERS = Object.freeze([
  paper({
    paperId: 'cie-9702-9702_m24_qp_22',
    questionPaperFile: '9702_m24_qp_22.pdf',
    markSchemeFile: '9702_m24_ms_22.pdf',
    questions: [
      question({
        questionNumber: 1,
        primaryTopicCode: 1,
        secondaryTopicCodes: [7],
        syllabusPoints: [['1.2', 1], ['1.2', 2], ['7.1', 7]],
        questionPages: [4],
        markSchemePages: [6],
        parts: [
          part('a', 1, 4, 6),
          part('b', 2, 4, 6),
          part('c', 3, 4, 6, [
            'power = intensity x area',
            'power = 950 x 2.2 x 10^-4',
            'power = 0.21 W',
          ]),
        ],
      }),
      question({
        questionNumber: 6,
        primaryTopicCode: 8,
        secondaryTopicCodes: [7],
        syllabusPoints: [['8.1', 3], ['8.3', 1], ['8.3', 3], ['8.3', 4]],
        questionPages: [12, 13],
        markSchemePages: [11],
        parts: [
          part('a(i)', 3, 12, 11), part('a(ii)', 3, 12, 11), part('a(iii)', 1, 13, 11),
          part('b(i)', 1, 13, 11), part('b(ii)', 1, 13, 11), part('b(iii)', 1, 13, 11),
        ],
      }),
    ],
  }),
  paper({
    paperId: 'cie-9702-9702_s25_qp_21',
    questionPaperFile: '9702_s25_qp_21.pdf',
    markSchemeFile: '9702_s25_ms_21.pdf',
    questions: [
      question({
        questionNumber: 1,
        primaryTopicCode: 2,
        syllabusPoints: [['2.1', 1], ['2.1', 7], ['2.1', 9]],
        questionPages: [4, 5],
        markSchemePages: [8, 9],
        parts: [part('a', 1, 4, 8), part('b(i)', 2, 4, 8), part('b(ii)', 2, 4, 8), part('c(i)', 2, 5, 9), part('c(ii)', 2, 5, 9)],
      }),
      question({
        questionNumber: 6,
        primaryTopicCode: 9,
        secondaryTopicCodes: [10],
        syllabusPoints: [['9.1', 4], ['9.3', 2], ['9.3', 6]],
        questionPages: [14, 15],
        markSchemePages: [13],
        parts: [part('a(i)', 1, 14, 13), part('a(ii)', 2, 14, 13), part('a(iii)', 3, 14, 13), part('b(i)', 2, 15, 13), part('b(ii)', 1, 15, 13)],
      }),
    ],
  }),
  paper({
    paperId: 'cie-9702-9702_s25_qp_22',
    questionPaperFile: '9702_s25_qp_22.pdf',
    markSchemeFile: '9702_s25_ms_22.pdf',
    questions: [
      question({
        questionNumber: 4,
        primaryTopicCode: 3,
        secondaryTopicCodes: [5],
        syllabusPoints: [['3.1', 3], ['3.1', 4], ['3.3', 3], ['5.2', 4]],
        questionPages: [10, 11],
        markSchemePages: [11, 12],
        parts: [part('a', 1, 10, 11), part('b(i)', 2, 10, 11), part('b(ii)', 2, 10, 11), part('c', 3, 11, 12)],
      }),
      question({
        questionNumber: 5,
        primaryTopicCode: 6,
        syllabusPoints: [['6.1', 5], ['6.2', 2], ['6.2', 4]],
        questionPages: [12, 13],
        markSchemePages: [12, 13],
        parts: [part('a', 1, 12, 12), part('b(i)', 3, 12, 12), part('b(ii)', 3, 13, 13)],
      }),
    ],
  }),
  paper({
    paperId: 'cie-9702-9702_s25_qp_23',
    questionPaperFile: '9702_s25_qp_23.pdf',
    markSchemeFile: '9702_s25_ms_23.pdf',
    questions: [question({
      questionNumber: 1,
      primaryTopicCode: 2,
      syllabusPoints: [['2.1', 1], ['2.1', 7], ['2.1', 9]],
      questionPages: [4, 5],
      markSchemePages: [8],
      parts: [part('a', 1, 4, 8), part('b', 3, 4, 8), part('c(i)', 2, 5, 8), part('c(ii)', 2, 5, 8)],
    })],
  }),
  paper({
    paperId: 'cie-9702-9702_s25_qp_24',
    questionPaperFile: '9702_s25_qp_24.pdf',
    markSchemeFile: '9702_s25_ms_24.pdf',
    questions: [question({
      questionNumber: 5,
      primaryTopicCode: 9,
      secondaryTopicCodes: [10],
      syllabusPoints: [['9.1', 4], ['9.2', 3], ['9.3', 3], ['9.3', 4]],
      questionPages: [10, 11],
      markSchemePages: [12],
      parts: [
        part('a(i)', 1, 10, 12),
        part('a(ii)', 2, 10, 12),
        part('b(i)', 2, 11, 12),
        part('b(ii)', 3, 11, 12, [
          'current in metal wire = 3.3 - 1.5 = 1.8 A',
          'I = Anvq; 1.8 = 1.4 x 10^-9 x 3.4 x 10^28 x v x 1.6 x 10^-19',
          'v = 0.24 m s^-1',
        ]),
      ],
    })],
  }),
  paper({
    paperId: 'cie-9702-9702_w25_qp_21',
    questionPaperFile: '9702_w25_qp_21.pdf',
    markSchemeFile: '9702_w25_ms_21.pdf',
    questions: [
      question({
        questionNumber: 1,
        primaryTopicCode: 2,
        secondaryTopicCodes: [5],
        syllabusPoints: [['2.1', 1], ['2.1', 2], ['2.1', 3], ['5.1', 6], ['5.2', 2], ['5.2', 4]],
        questionPages: [4, 5], markSchemePages: [8],
        parts: [part('a', 1, 4, 8), part('b(i)', 1, 4, 8), part('b(ii)', 2, 4, 8), part('c(i)', 2, 5, 8), part('c(ii)', 2, 5, 8), part('c(iii)', 2, 5, 8)],
      }),
      question({
        questionNumber: 2,
        primaryTopicCode: 4,
        secondaryTopicCodes: [3],
        syllabusPoints: [['3.2', 3], ['4.3', 2], ['4.3', 5], ['4.3', 6]],
        questionPages: [6, 7], markSchemePages: [9],
        parts: [
          part('a(i)', 1, 6, 9),
          part('a(ii)', 2, 6, 9, [
            'a pressure difference exists between the top and bottom of the ball because their depths differ',
            'the greater pressure at the bottom gives a greater upward force than the downward force at the top, so the resultant force is upwards',
          ]),
          part('b(i)', 3, 6, 9, [
            'arrow vertically downwards labelled weight',
            'arrow vertically upwards labelled upthrust',
            'arrow vertically upwards labelled viscous drag',
          ]),
          part('b(ii)', 2, 7, 9),
          part('c(i)', 1, 7, 9),
          part('c(ii)', 3, 7, 9, [
            'at terminal speed, weight = drag + upthrust',
            '2.4 x 10^-3 x 9.81 = 2.8 x 10^-3 + 6pi x 4.7 x 4.2 x 10^-3 x v',
            'v = 0.056 m s^-1',
          ]),
        ],
      }),
      question({
        questionNumber: 3,
        primaryTopicCode: 6,
        secondaryTopicCodes: [9],
        syllabusPoints: [['6.1', 4], ['6.1', 5], ['9.3', 6]],
        questionPages: [8, 9], markSchemePages: [10],
        parts: [part('a', 1, 8, 10), part('b(i)', 1, 8, 10), part('b(ii)', 2, 8, 10), part('c(i)', 1, 8, 10), part('c(ii)', 1, 9, 10), part('d(i)', 1, 9, 10), part('d(ii)', 2, 9, 10)],
      }),
      question({
        questionNumber: 4,
        primaryTopicCode: 8,
        secondaryTopicCodes: [7],
        syllabusPoints: [['7.5', 2], ['8.2', 1], ['8.4', 1]],
        questionPages: [10, 11], markSchemePages: [11],
        parts: [part('a', 2, 10, 11), part('b(i)', 2, 10, 11), part('b(ii)', 1, 11, 11), part('b(iii)', 3, 11, 11), part('c', 2, 11, 11)],
      }),
      question({
        questionNumber: 5,
        primaryTopicCode: 10,
        secondaryTopicCodes: [9],
        syllabusPoints: [['9.3', 8], ['10.1', 5], ['10.2', 1], ['10.3', 4]],
        questionPages: [12, 13], markSchemePages: [12],
        parts: [
          part('a', 1, 12, 12),
          part('b(i)', 2, 12, 12),
          part('b(ii)', 3, 13, 12, [
            'the resistance of T decreases, so the total resistance of the circuit decreases',
            'the current in the cell increases, so the potential difference across the internal resistance increases',
            'the terminal potential difference decreases and, because the resistance of R is constant, the current in R decreases',
          ]),
          part('c(i)', 2, 13, 12),
          part('c(ii)', 2, 13, 12),
        ],
      }),
      question({
        questionNumber: 6,
        primaryTopicCode: 11,
        syllabusPoints: [['11.1', 2], ['11.1', 9], ['11.1', 11], ['11.2', 3]],
        questionPages: [14, 15], markSchemePages: [13],
        parts: [part('a(i)', 2, 14, 13), part('a(ii)', 2, 14, 13), part('b(i)', 2, 14, 13), part('b(ii)', 1, 14, 13), part('c', 2, 15, 13)],
      }),
    ],
  }),
  paper({
    paperId: 'cie-9702-9702_w25_qp_22',
    questionPaperFile: '9702_w25_qp_22.pdf',
    markSchemeFile: '9702_w25_ms_22.pdf',
    questions: [
      question({
        questionNumber: 1,
        primaryTopicCode: 1,
        secondaryTopicCodes: [4],
        syllabusPoints: [['1.2', 1], ['1.3', 3], ['1.4', 1], ['4.3', 6]],
        questionPages: [4, 5], markSchemePages: [8],
        parts: [
          part('a', 2, 4, 8, [
            'air temperature: K; air pressure: kg m^-1 s^-2',
            'scalar is selected for both air temperature and air pressure',
          ]),
          part('b(i)', 2, 4, 8),
          part('b(ii)', 2, 4, 8),
          part('b(iii)', 3, 5, 8),
          part('c', 2, 5, 8),
        ],
      }),
      question({
        questionNumber: 5,
        primaryTopicCode: 10,
        secondaryTopicCodes: [9],
        syllabusPoints: [['9.2', 3], ['9.3', 7], ['10.1', 5], ['10.2', 1]],
        questionPages: [14, 15], markSchemePages: [13, 14],
        parts: [part('a', 1, 15, 13), part('b(i)', 2, 15, 13), part('b(ii)', 3, 15, 13), part('b(iii)', 2, 15, 14), part('b(iv)', 3, 15, 14)],
      }),
      question({
        questionNumber: 6,
        primaryTopicCode: 11,
        secondaryTopicCodes: [5],
        syllabusPoints: [['5.2', 4], ['11.1', 5], ['11.1', 11], ['11.2', 1], ['11.2', 4]],
        questionPages: [16], markSchemePages: [15],
        parts: [
          part('a', 1, 16, 15),
          part('b(i)', 2, 16, 15),
          part('b(ii)', 3, 16, 15, [
            'E_k = 1/2 mv^2',
            '2.1 x 10^-16 = 1/2 x 0.67 x 1.66 x 10^-27 x v^2',
            'v = 6.1 x 10^5 m s^-1',
          ]),
          part('c(i)', 1, 16, 15),
          part('c(ii)', 2, 16, 15, [
            'number of nucleons = 228 - 5 x 4 = 208; number of protons = 88 - 5 x 2 + 4 = 82',
            'number of neutrons = 208 - 82 = 126',
          ]),
        ],
      }),
    ],
  }),
  paper({
    paperId: 'cie-9702-9702_w25_qp_23',
    questionPaperFile: '9702_w25_qp_23.pdf',
    markSchemeFile: '9702_w25_ms_23.pdf',
    questions: [
      question({
        questionNumber: 1,
        primaryTopicCode: 2,
        secondaryTopicCodes: [5],
        syllabusPoints: [['2.1', 1], ['2.1', 2], ['2.1', 3], ['5.1', 6], ['5.2', 2], ['5.2', 4]],
        questionPages: [4, 5], markSchemePages: [8],
        parts: [part('a', 1, 4, 8), part('b(i)', 1, 4, 8), part('b(ii)', 2, 4, 8), part('c(i)', 2, 5, 8), part('c(ii)', 2, 5, 8), part('c(iii)', 2, 5, 8)],
      }),
      question({
        questionNumber: 3,
        primaryTopicCode: 6,
        secondaryTopicCodes: [9],
        syllabusPoints: [['6.1', 4], ['6.1', 5], ['9.3', 6]],
        questionPages: [8, 9], markSchemePages: [10],
        parts: [part('a', 1, 8, 10), part('b(i)', 1, 8, 10), part('b(ii)', 2, 8, 10), part('c(i)', 1, 8, 10), part('c(ii)', 1, 9, 10), part('d(i)', 1, 9, 10), part('d(ii)', 2, 9, 10)],
      }),
      question({
        questionNumber: 4,
        primaryTopicCode: 8,
        secondaryTopicCodes: [7],
        syllabusPoints: [['7.5', 2], ['8.2', 1], ['8.4', 1]],
        questionPages: [10, 11], markSchemePages: [11],
        parts: [part('a', 2, 10, 11), part('b(i)', 2, 10, 11), part('b(ii)', 1, 11, 11), part('b(iii)', 3, 11, 11), part('c', 2, 11, 11)],
      }),
      question({
        questionNumber: 5,
        primaryTopicCode: 10,
        secondaryTopicCodes: [9],
        syllabusPoints: [['9.3', 8], ['10.1', 5], ['10.2', 1], ['10.3', 4]],
        questionPages: [12, 13], markSchemePages: [12],
        parts: [part('a', 1, 12, 12), part('b(i)', 2, 12, 12), part('b(ii)', 3, 13, 12), part('c(i)', 2, 13, 12), part('c(ii)', 2, 13, 12)],
      }),
    ],
  }),
  paper({
    paperId: 'cie-9702-9702_w25_qp_24',
    questionPaperFile: '9702_w25_qp_24.pdf',
    markSchemeFile: '9702_w25_ms_24.pdf',
    questions: [
      question({
        questionNumber: 1,
        primaryTopicCode: 2,
        secondaryTopicCodes: [3],
        syllabusPoints: [['2.1', 2], ['2.1', 9], ['3.1', 3], ['3.1', 4]],
        questionPages: [4, 5], markSchemePages: [8, 9],
        parts: [
          part('a(i)', 2, 4, 8, [
            'horizontal velocity = 28 cos 34 degrees = 23 m s^-1',
            'vertical velocity = 28 sin 34 degrees = 16 m s^-1',
          ]),
          part('a(ii)', 1, 4, 8),
          part('a(iii)', 1, 5, 8),
          part('a(iv)', 3, 5, 8, [
            'straight diagonal line from t = 0 to t = 3.2 s, starting at positive velocity and crossing the time axis',
            'line starts at v = 16 m s^-1 and ends at v = -16 m s^-1',
            'line passes through v = 0 at t = 1.6 s',
          ]),
          part('b(i)', 1, 5, 8),
          part('b(ii)', 2, 5, 8),
          part('b(iii)', 1, 5, 9),
        ],
      }),
      question({
        questionNumber: 3,
        primaryTopicCode: 6,
        secondaryTopicCodes: [5],
        syllabusPoints: [['5.2', 2], ['6.1', 3], ['6.1', 4], ['6.2', 2], ['6.2', 4]],
        questionPages: [8, 9], markSchemePages: [11],
        parts: [
          part('a', 1, 8, 11),
          part('b(i)', 1, 9, 11),
          part('b(ii)', 2, 9, 11),
          part('c(i)', 2, 9, 11),
          part('c(ii)', 2, 9, 11),
          part('d', 2, 9, 11, [
            'all gravitational potential energy has been converted to, or is equal to, elastic potential energy, so there is no kinetic energy',
            'kinetic energy is zero, so speed is zero',
          ]),
        ],
      }),
      question({
        questionNumber: 5,
        primaryTopicCode: 9,
        secondaryTopicCodes: [1],
        syllabusPoints: [['1.3', 3], ['9.3', 1], ['9.3', 3], ['9.3', 6]],
        questionPages: [12, 13], markSchemePages: [13],
        parts: [part('a(i)', 1, 12, 13), part('a(ii)', 2, 12, 13), part('b(i)', 1, 12, 13), part('b(ii)', 3, 13, 13), part('b(iii)', 2, 13, 13), part('b(iv)', 1, 13, 13)],
      }),
      question({
        questionNumber: 6,
        primaryTopicCode: 11,
        syllabusPoints: [['11.1', 1], ['11.1', 7], ['11.2', 2], ['11.2', 4]],
        questionPages: [14, 15], markSchemePages: [14],
        parts: [part('a(i)', 3, 14, 14), part('a(ii)', 1, 14, 14), part('a(iii)', 1, 14, 14), part('b', 2, 15, 14), part('c(i)', 1, 15, 14), part('c(ii)', 2, 15, 14)],
      }),
    ],
  }),
])
