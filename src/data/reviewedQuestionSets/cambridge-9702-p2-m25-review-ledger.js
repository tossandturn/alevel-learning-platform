/*
 * Source-of-truth semantic review ledger for Cambridge 9702/22
 * February/March 2025. The original machine index retained the source
 * PDFs but dropped every structured part; this ledger reconstructs only
 * the seven printed question groups from paired QP/MS page evidence.
 */

export const CAMBRIDGE_9702_P2_M25_REVIEW_LEDGER_SCHEMA_VERSION = 'cambridge-9702-p2-m25-review-ledger.v1'

const REVIEWED_AT = '2026-08-14T17:00:00+08:00'
const REVIEWED_BY = 'Codex source-semantic-review / 9702-P2-M25'

function topicId(code) {
  return `physics-9702-topic-${String(code).padStart(2, '0')}`
}

function syllabusPointId(sectionCode, outcomeNumber) {
  return `physics-9702-point-${sectionCode.replace('.', '-')}-${String(outcomeNumber).padStart(2, '0')}`
}

function reviewPart(label, marks, questionPage, markSchemePage, promptFragment, markSchemePoints) {
  if (!Array.isArray(markSchemePoints) || markSchemePoints.length !== marks) {
    throw new Error(`${label}: mark-scheme points must close to the official part marks`)
  }
  return Object.freeze({
    label,
    marks,
    questionPage,
    markSchemePage,
    promptFragment,
    markSchemePoints: Object.freeze([...markSchemePoints]),
  })
}

function reviewedQuestion({
  questionNumber,
  primaryTopicCode,
  secondaryTopicCodes = [],
  syllabusPoints,
  questionPages,
  markSchemePages,
  parts,
}) {
  const totalMarks = parts.reduce((sum, part) => sum + part.marks, 0)
  if (!questionPages.length || !markSchemePages.length || !parts.length) {
    throw new Error(`Q${questionNumber}: pages and parts are required`)
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

export const CAMBRIDGE_9702_P2_M25_REVIEW_LEDGER = Object.freeze({
  paperId: 'cie-9702-9702_m25_qp_22',
  questionPaperFile: '9702_m25_qp_22.pdf',
  markSchemeFile: '9702_m25_ms_22.pdf',
  component: 2,
  expectedQuestionCount: 7,
  expectedTotalMarks: 60,
  reviewedAt: REVIEWED_AT,
  reviewedBy: REVIEWED_BY,
  reviewMethod: 'paired-qp-ms-page-review',
  sourcePolicy: 'personal-study-restricted',
  sourcePagePolicy: 'complete-official-page-fallback',
  questions: Object.freeze([
    reviewedQuestion({
      questionNumber: 1,
      primaryTopicCode: 1,
      secondaryTopicCodes: [4],
      syllabusPoints: [['1.3', 2], ['1.3', 3], ['4.3', 1]],
      questionPages: [3],
      markSchemePages: [7],
      parts: [
        reviewPart('a', 1, 3, 7, 'Explain what is meant by the accuracy of a measured value.', [
          'Measured value is close to the true value of the quantity.',
        ]),
        reviewPart('b-i', 2, 3, 7, 'Show that the calculated density of cube A is 8.7 x 10^3 kg m^-3.', [
          'Use density = mass / volume.',
          'Calculate 8.7 x 10^3 kg m^-3.',
        ]),
        reviewPart('b-ii', 2, 3, 7, 'Calculate the percentage uncertainty in the density of cube A.', [
          'Use the stated mass or length fractional uncertainty.',
          'Calculate 4%.',
        ]),
        reviewPart('b-iii', 2, 3, 7, 'State and explain whether cubes A and B could be made from the same material.', [
          'Identify that the density ranges overlap or are within uncertainty.',
          'Conclude that the cubes could be the same material.',
        ]),
      ],
    }),
    reviewedQuestion({
      questionNumber: 2,
      primaryTopicCode: 4,
      syllabusPoints: [['4.2', 1], ['4.3', 3], ['4.3', 5], ['4.3', 6]],
      questionPages: [4, 5, 6],
      markSchemePages: [7, 8],
      parts: [
        reviewPart('a', 2, 4, 7, 'State the principle of moments.', [
          'State rotational equilibrium.',
          'State that total clockwise moments equal total anticlockwise moments about the same point.',
        ]),
        reviewPart('b-i', 3, 4, 7, 'By taking moments about A, determine the distance x from A to P in Fig. 2.1.', [
          'Set up moments about A using the beam, person and cylinder forces.',
          'Use a second correct moment magnitude.',
          'Calculate x = 2.1 m.',
        ]),
        reviewPart('b-ii', 1, 5, 8, 'Show that the upthrust acting on the cylinder is 1400 N.', [
          'Calculate upthrust as 11 x 9.81 + 1300 = 1400 N.',
        ]),
        reviewPart('b-iii', 2, 5, 8, 'Calculate the depth y of the bottom of the cylinder in the water.', [
          'Use upthrust = density x g x area x depth.',
          'Calculate y = 0.30 m.',
        ]),
        reviewPart('b-iv', 2, 6, 8, 'Sketch the variation of cylinder-bottom depth with the person distance from A on Fig. 2.3.', [
          'Start at a non-zero depth when distance is zero.',
          'Draw a line with positive gradient to 6.0 m.',
        ]),
      ],
    }),
    reviewedQuestion({
      questionNumber: 3,
      primaryTopicCode: 3,
      secondaryTopicCodes: [2, 5],
      syllabusPoints: [['2.1', 7], ['3.1', 2], ['3.1', 4], ['5.2', 4]],
      questionPages: [7, 8, 9],
      markSchemePages: [9, 10],
      parts: [
        reviewPart('a-i', 2, 7, 9, 'Calculate the acceleration of truck R between A and B.', [
          'Use a valid constant-acceleration equation.',
          'Calculate 0.88 m s^-2.',
        ]),
        reviewPart('a-ii', 3, 7, 9, 'Determine the gain in kinetic energy of truck R between A and B.', [
          'Use the kinetic-energy change expression.',
          'Substitute the stated mass and speeds.',
          'Calculate 1.5 x 10^6 J.',
        ]),
        reviewPart('b-i', 1, 8, 9, 'Define force.', [
          'Force is the rate of change of momentum.',
        ]),
        reviewPart('b-ii', 1, 8, 9, 'Show that the average resultant force F on truck R between t = 0 and t = 15 s is -1.2 x 10^4 N.', [
          'Calculate the stated average force from the momentum change.',
        ]),
        reviewPart('b-iii', 3, 9, 10, 'State and explain whether identical truck S takes more, less or the same time to stop as truck R.', [
          'Identify that the stopping momentum change is the same.',
          'Compare the average braking force with F.',
          'Conclude that S stops in less time than R.',
        ]),
      ],
    }),
    reviewedQuestion({
      questionNumber: 4,
      primaryTopicCode: 8,
      syllabusPoints: [['8.1', 1], ['8.1', 2], ['8.1', 3], ['8.1', 4]],
      questionPages: [10, 11],
      markSchemePages: [10, 11],
      parts: [
        reviewPart('a', 4, 10, 10, 'Explain how the stationary microwave wave, including nodes and antinodes, is formed.', [
          'State that the microwave reflects from the metal sheet.',
          'State that incident and reflected waves superpose.',
          'State that amplitude is maximum at an antinode.',
          'State that amplitude is minimum or zero at a node.',
        ]),
        reviewPart('b-i', 2, 10, 10, 'Calculate the wavelength of the microwaves.', [
          'Use wavelength = c / f.',
          'Calculate 0.048 m.',
        ]),
        reviewPart('b-ii', 1, 11, 10, 'Determine the distance between P and Q.', [
          'Calculate PQ = one quarter wavelength = 0.012 m.',
        ]),
        reviewPart('b-iii', 1, 11, 11, 'State and explain whether QR is greater than, less than or the same as PQ when intensity increases but frequency is unchanged.', [
          'State QR is the same as PQ because wavelength and node-antinode spacing are unchanged.',
        ]),
      ],
    }),
    reviewedQuestion({
      questionNumber: 5,
      primaryTopicCode: 7,
      syllabusPoints: [['7.1', 3], ['7.1', 4], ['7.3', 2]],
      questionPages: [12],
      markSchemePages: [11],
      parts: [
        reviewPart('a', 3, 12, 11, 'Use the CRO trace and time-base to determine the wavelength of the sound.', [
          'Determine the period T = 2.9 x 10^-3 s.',
          'Use wavelength = speed x period or equivalent.',
          'Calculate 0.96 m.',
        ]),
        reviewPart('b', 2, 12, 11, 'Describe the motion of the loudspeaker when the CRO period increases continuously.', [
          'State that the loudspeaker moves away from the microphone.',
          'State that its speed increases or that it accelerates.',
        ]),
      ],
    }),
    reviewedQuestion({
      questionNumber: 6,
      primaryTopicCode: 9,
      syllabusPoints: [['9.1', 4], ['9.3', 2], ['9.3', 6]],
      questionPages: [13, 14, 15],
      markSchemePages: [11, 12],
      parts: [
        reviewPart('a', 2, 13, 11, 'Calculate the potential difference between the ends of copper wire P.', [
          'Use V = IR.',
          'Calculate 2.8 x 10^-3 V.',
        ]),
        reviewPart('b-i', 2, 13, 11, 'Show that the cross-sectional area of wire P is 1.3 x 10^-6 m^2.', [
          'Use A = rho L / R.',
          'Calculate 1.3 x 10^-6 m^2.',
        ]),
        reviewPart('b-ii', 1, 13, 11, 'Show that the number density of charge carriers in wire P is 8.3 x 10^28 m^-3.', [
          'Calculate 8.3 x 10^28 m^-3 from the stated carrier count, area and length.',
        ]),
        reviewPart('b-iii', 2, 13, 12, 'Calculate the average drift speed of charge carriers in wire P.', [
          'Use I = Anvq or the equivalent carrier-count relation.',
          'Calculate 4.9 x 10^-5 m s^-1.',
        ]),
        reviewPart('c-i', 4, 14, 12, 'State and explain how the resistance of wire Q compares with wire P.', [
          'State that Q has greater length than P.',
          'State that Q has lower average cross-sectional area than P.',
          'State that resistance is proportional to length divided by area.',
          'Conclude that Q has greater resistance.',
        ]),
        reviewPart('c-ii', 2, 15, 12, 'Sketch average drift speed against distance from X for wire Q on Fig. 6.3.', [
          'Start at non-zero drift speed at distance zero.',
          'Draw a line with increasing positive gradient.',
        ]),
      ],
    }),
    reviewedQuestion({
      questionNumber: 7,
      primaryTopicCode: 11,
      secondaryTopicCodes: [3],
      syllabusPoints: [['3.3', 2], ['11.1', 5], ['11.1', 6], ['11.1', 11]],
      questionPages: [16],
      markSchemePages: [12, 13],
      parts: [
        reviewPart('a', 1, 16, 12, 'Complete the alpha-decay equation for nucleus Q.', [
          'Give nucleon number 226 for Q and proton number 86 for R.',
        ]),
        reviewPart('b', 3, 16, 12, 'By considering momentum, calculate the speed of nucleus R after the decay.', [
          'Set the alpha and R momentum magnitudes equal.',
          'Rearrange for the speed of R.',
          'Calculate 2.7 x 10^5 m s^-1.',
        ]),
        reviewPart('c', 3, 16, 13, 'State three quantities that are conserved during the decay.', [
          'State one accepted conserved quantity.',
          'State a second accepted conserved quantity.',
          'State a third accepted conserved quantity.',
        ]),
      ],
    }),
  ]),
})
