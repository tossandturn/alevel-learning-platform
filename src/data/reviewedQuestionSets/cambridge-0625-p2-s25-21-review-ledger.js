/* Source-semantic review ledger for Cambridge IGCSE Physics 0625/21, S25. */

export const CAMBRIDGE_0625_P2_S25_21_REVIEW_LEDGER_SCHEMA_VERSION = 'cambridge-0625-p2-s25-21-review-ledger.v1'

const REVIEWED_AT = '2026-08-15T12:00:00+08:00'
const REVIEWED_BY = 'Codex source-semantic-review / 0625-P2-S25-21'

const TOPIC_IDS = Object.freeze({
  forces: '0625-igcse-topic-01',
  thermal: '0625-igcse-topic-02',
  waves: '0625-igcse-topic-03',
  electricity: '0625-igcse-topic-04',
  nuclear: '0625-igcse-topic-05',
  space: '0625-igcse-topic-06',
})

const POINT_IDS = Object.freeze({
  forces: 'physics-0625-point-1-1-01',
  thermalKinetic: 'physics-0625-point-2-1-01',
  thermalTemperature: 'physics-0625-point-2-2-01',
  thermalTransfer: 'physics-0625-point-2-3-01',
  wavesGeneral: 'physics-0625-point-3-1-01',
  wavesOptics: 'physics-0625-point-3-2-01',
  wavesSound: 'physics-0625-point-3-3-01',
  electricityMagnetic: 'physics-0625-point-4-1-01',
  electricityQuantities: 'physics-0625-point-4-2-01',
  electricityCircuits: 'physics-0625-point-4-3-01',
  electricityEffects: 'physics-0625-point-4-4-01',
  nuclearAtomic: 'physics-0625-point-5-1-01',
  nuclearRadiation: 'physics-0625-point-5-2-01',
  spaceEarth: 'physics-0625-point-6-1-01',
  spaceUniverse: 'physics-0625-point-6-3-01',
})

function row(questionNumber, correctOption, topic, syllabusPointIds, questionPaperPage, markSchemePage) {
  return Object.freeze({
    questionNumber,
    correctOption,
    primaryTopicId: TOPIC_IDS[topic],
    secondaryTopicIds: Object.freeze([]),
    syllabusPointIds: Object.freeze(syllabusPointIds.map((id) => POINT_IDS[id])),
    questionPaperPage,
    markSchemePage,
  })
}

export const CAMBRIDGE_0625_P2_S25_21_REVIEW_LEDGER = Object.freeze({
  paperId: 'cie-0625-0625_s25_qp_21',
  questionPaperFile: '0625_s25_qp_21.pdf',
  markSchemeFile: '0625_s25_ms_21.pdf',
  component: 2,
  expectedQuestionCount: 40,
  expectedTotalMarks: 40,
  reviewedAt: REVIEWED_AT,
  reviewedBy: REVIEWED_BY,
  reviewMethod: 'paired-qp-ms-page-review',
  sourcePolicy: 'personal-study-restricted',
  sourcePagePolicy: 'complete-official-page-fallback',
  questions: Object.freeze([
    row(1, 'C', 'forces', ['forces'], 2, 2),
    row(2, 'B', 'forces', ['forces'], 2, 2),
    row(3, 'D', 'forces', ['forces'], 3, 2),
    row(4, 'C', 'forces', ['forces'], 3, 2),
    row(5, 'B', 'forces', ['forces'], 3, 2),
    row(6, 'D', 'forces', ['forces'], 4, 2),
    row(7, 'C', 'forces', ['forces'], 4, 2),
    row(8, 'A', 'forces', ['forces'], 4, 2),
    row(9, 'D', 'forces', ['forces'], 5, 2),
    row(10, 'A', 'thermal', ['thermalKinetic'], 5, 2),
    row(11, 'B', 'thermal', ['thermalKinetic'], 5, 2),
    row(12, 'C', 'thermal', ['thermalTemperature'], 6, 2),
    row(13, 'B', 'thermal', ['thermalTemperature'], 6, 2),
    row(14, 'A', 'thermal', ['thermalKinetic'], 6, 2),
    row(15, 'A', 'thermal', ['thermalTransfer'], 6, 2),
    row(16, 'A', 'thermal', ['thermalTransfer'], 7, 2),
    row(17, 'B', 'waves', ['wavesGeneral'], 8, 2),
    row(18, 'D', 'waves', ['wavesOptics'], 8, 2),
    row(19, 'B', 'waves', ['wavesOptics'], 9, 2),
    row(20, 'B', 'waves', ['wavesOptics'], 9, 2),
    row(21, 'B', 'waves', ['wavesSound'], 9, 2),
    row(22, 'D', 'waves', ['wavesSound'], 9, 2),
    row(23, 'D', 'waves', ['wavesSound'], 10, 2),
    row(24, 'A', 'electricity', ['electricityMagnetic'], 10, 2),
    row(25, 'A', 'electricity', ['electricityMagnetic'], 11, 2),
    row(26, 'D', 'electricity', ['electricityQuantities'], 11, 2),
    row(27, 'C', 'electricity', ['electricityCircuits'], 11, 2),
    row(28, 'C', 'electricity', ['electricityCircuits'], 12, 2),
    row(29, 'C', 'electricity', ['electricityEffects'], 12, 3),
    row(30, 'B', 'electricity', ['electricityEffects'], 12, 3),
    row(31, 'A', 'electricity', ['electricityMagnetic'], 13, 3),
    row(32, 'D', 'electricity', ['electricityEffects'], 13, 3),
    row(33, 'A', 'nuclear', ['nuclearAtomic'], 13, 3),
    row(34, 'B', 'nuclear', ['nuclearAtomic'], 14, 3),
    row(35, 'C', 'nuclear', ['nuclearRadiation'], 14, 3),
    row(36, 'A', 'nuclear', ['nuclearRadiation'], 14, 3),
    row(37, 'D', 'nuclear', ['nuclearRadiation'], 14, 3),
    row(38, 'B', 'space', ['spaceEarth'], 15, 3),
    row(39, 'C', 'space', ['spaceUniverse'], 15, 3),
    row(40, 'C', 'space', ['spaceUniverse'], 15, 3),
  ]),
})
