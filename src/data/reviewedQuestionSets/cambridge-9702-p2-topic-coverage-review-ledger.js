/*
 * Manual source-semantic review ledger for the 9702 AS Paper 2 question
 * groups used to bring every official syllabus topic to at least twelve
 * reviewed groups.
 *
 * Each entry was checked against every listed QP page and the paired MS page.
 * The generated student record shows the official page images; imported OCR is
 * retained only as private indexing/marking context and is not the question UI.
 */

export const CAMBRIDGE_9702_P2_TOPIC_COVERAGE_REVIEW_SCHEMA_VERSION = 'cambridge-9702-p2-topic-coverage-review.v1'

const REVIEWED_AT = '2026-08-15T18:30:00+08:00'
const REVIEWED_BY = 'Codex manual QP/MS visual review / 9702-P2-topic-coverage'
const ADDITIONAL_REVIEWED_AT = '2026-09-02T17:41:59+08:00'

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
  reviewedAt = null,
  reviewedBy = null,
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
    ...(reviewedAt ? { reviewedAt } : {}),
    ...(reviewedBy ? { reviewedBy } : {}),
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
      question({
        questionNumber: 2,
        primaryTopicCode: 2,
        secondaryTopicCodes: [4],
        reviewedAt: ADDITIONAL_REVIEWED_AT,
        syllabusPoints: [['2.1', 1], ['2.1', 6], ['2.1', 7], ['2.1', 9], ['4.3', 5], ['4.3', 6]],
        questionPages: [6, 7],
        markSchemePages: [7, 8],
        parts: [
          part('a', 1, 6, 7, [
            'rate of change of velocity',
          ]),
          part('b', 3, 6, 7, [
            '½ m(Δ)v² = mg(Δ)h',
            'v² = 5.9² + 2 × 9.81 × 7.8; v² = 188',
            'v = 14 m s⁻¹ OR by resolving components: v² = u² + 2as; vᵥ = 13.4; vₕ = 2.95; resultant velocity = √(13.4² + 2.95²) = 14 m s⁻¹',
          ]),
          part('c(i)', 2, 7, 7, [
            '(As the diver moves down their) speed decreases',
            '(So) viscous force / drag (force) decreases',
          ]),
          part('c(ii)', 1, 7, 7, [
            '(F = ) ρgV = 1000 × 9.81 × 7.5 × 10⁻² = 740 (N)',
          ]),
          part('c(iii)', 4, 7, 8, [
            'resultant force = 740 + 950 − (78 × 9.81) = 925',
            'acceleration = F / m',
            '= 925 / 78 = 12 m s⁻²',
            '(vertically) upwards',
          ]),
        ],
      }),
      question({
        questionNumber: 4,
        primaryTopicCode: 11,
        syllabusPoints: [['11.1', 3], ['11.1', 5], ['11.1', 6], ['11.1', 11]],
        reviewedAt: ADDITIONAL_REVIEWED_AT,
        questionPages: [10],
        markSchemePages: [10],
        parts: [
          part('a', 2, 10, 10, [
            '⁴₂α',
            '²¹¹₈₂Q',
          ]),
          part('b(i)', 2, 10, 10, [
            'sum / total momentum (of a system of bodies) is constant or sum / total momentum before = sum / total momentum after',
            'for an isolated system / no (resultant) external force',
          ]),
          part('b(ii)', 2, 10, 10, [
            'pα = pP − pQ; 4(u)v = 215(u) × 3.2 × 10⁵ (− 0)',
            'v = 215(u) × 3.2 × 10⁵ / 4(u) = 1.7 × 10⁷ m s⁻¹',
          ]),
        ],
      }),
      question({
        questionNumber: 8,
        primaryTopicCode: 11,
        syllabusPoints: [['11.1', 3], ['11.1', 7], ['11.2', 1], ['11.2', 2], ['11.2', 4], ['11.2', 6]],
        reviewedAt: ADDITIONAL_REVIEWED_AT,
        questionPages: [16],
        markSchemePages: [13],
        parts: [
          part('a', 1, 16, 13, ['lepton(s)']),
          part('b(i)', 1, 16, 13, ['up or top or charm']),
          part('b(ii)', 1, 16, 13, ['meson(s)']),
          part('c(i)', 1, 16, 13, ['β⁻ (particle) or electron']),
          part('c(ii)', 1, 16, 13, ['equal']),
          part('c(iii)', 1, 16, 13, ['(the charge of) R is greater (than Q)']),
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
      question({
        questionNumber: 4,
        primaryTopicCode: 8,
        secondaryTopicCodes: [7],
        reviewedAt: ADDITIONAL_REVIEWED_AT,
        syllabusPoints: [['7.1', 5], ['8.1', 1], ['8.3', 1], ['8.3', 3], ['8.3', 4]],
        questionPages: [10, 11],
        markSchemePages: [11, 12],
        parts: [
          part('a', 2, 10, 11, [
            '(when two or more) waves meet/overlap (at a point)',
            '(resultant) displacement is sum of the individual displacements',
          ]),
          part('b(i)', 3, 11, 11, [
            'Fringe width, x = 3.2 × 10⁻² / 8 = 4.0 × 10⁻³ (m)',
            'D = ax / λ = (4.0 × 10⁻³ × 0.16 × 10⁻³) / 7.2 × 10⁻⁷',
            '= 0.89 m',
          ]),
          part('b(ii)', 3, 11, 12, [
            'Curved line with a negative gradient of decreasing magnitude throughout, from slit separation 0.04 mm to 0.16 mm',
            'Line of negative gradient ending at (0.16, 0.4), from slit separation 0.04 mm',
            'Line of negative gradient passing through (0.08, 0.8) and (0.04, 1.6)',
          ]),
        ],
      }),
    ],
  }),
  paper({
    paperId: 'cie-9702-9702_s25_qp_22',
    questionPaperFile: '9702_s25_qp_22.pdf',
    markSchemeFile: '9702_s25_ms_22.pdf',
    questions: [
      question({
        questionNumber: 1,
        primaryTopicCode: 5,
        secondaryTopicCodes: [1],
        reviewedAt: ADDITIONAL_REVIEWED_AT,
        syllabusPoints: [['1.4', 1], ['5.1', 1], ['5.1', 5], ['5.1', 6], ['5.2', 3], ['5.2', 4]],
        questionPages: [4, 5],
        markSchemePages: [8, 9],
        parts: [
          part('a', 2, 4, 8, [
            'acceleration and displacement identified as vectors (and no others)',
            'speed, temperature and gravitational potential energy identified as scalars (and no others)',
          ]),
          part('b(i)', 10, 4, 8, [
            'W = Fs or W = mas',
            's = v² / 2a or a = v² / 2s or as = v² / 2',
            'W = ma(v² / 2a) or W = m(v² / 2s)s or W = m(v² / 2) and (so E_K )= ½mv²',
            'OR',
            'F = mv / t and s = ½vt',
            'W = mv / t × ½vt and (so E_K )= ½mv²',
            'a = v / t and s = ½vt',
            'W = m(v / t)(½vt) and (so E_K )= ½mv²',
            'a = v / t and s = ½at²',
            'W = m(v / t)(½ × (v / t) × t²) and (so E_K )= ½mv²',
          ]),
          part('b(ii)', 1, 4, 9, [
            'kinetic energy = ½ mv² = ½ × 920 × 17² = 1.3 × 10⁵ J',
          ]),
          part('b(iii)', 3, 5, 9, [
            'P = W / t',
            '= (4.7 × 10⁴ + 1.3 × 10⁵) / 5.8',
            '= 3.1 × 10⁴ W',
          ]),
          part('b(iv)', 1, 5, 9, [
            '(at/after t = 5.8 s) the kinetic energy of the car does not change / work is done only against resistive forces / no work is done to accelerate the car, so power output is less',
          ]),
        ],
      }),
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
    questions: [
      question({
        questionNumber: 1,
        primaryTopicCode: 2,
        syllabusPoints: [['2.1', 1], ['2.1', 7], ['2.1', 9]],
        questionPages: [4, 5],
        markSchemePages: [8],
        parts: [part('a', 1, 4, 8), part('b', 3, 4, 8), part('c(i)', 2, 5, 8), part('c(ii)', 2, 5, 8)],
      }),
      question({
        questionNumber: 6,
        primaryTopicCode: 8,
        secondaryTopicCodes: [7],
        reviewedAt: ADDITIONAL_REVIEWED_AT,
        syllabusPoints: [['7.1', 5], ['8.2', 1], ['8.4', 1], ['8.4', 2]],
        questionPages: [14, 15],
        markSchemePages: [12],
        parts: [
          part('a', 1, 14, 12, [
            'wave passes (through) an aperture and spreads or wave passes (by / through / around) an edge and spreads',
          ]),
          part('b(i)', 2, 14, 12, [
            'v = fλ',
            'f = 3.00 × 10⁸ / 720 × 10⁻⁹ = 4.2 × 10¹⁴ Hz',
          ]),
          part('b(ii)', 3, 15, 12, [
            'd = nλ / sin θ',
            'd = (2 × 720 × 10⁻⁹) / sin 26',
            'number of lines per m = 1 / (3.3 × 10⁻⁶) = 3.0 × 10⁵ m⁻¹',
          ]),
          part('b(iii)', 2, 15, 12, [
            'λ × 3 = 720 × 2 or 1 / (3.0 × 10⁵) sin 26 = 3λ',
            'λ = 480 nm',
          ]),
        ],
      }),
    ],
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
