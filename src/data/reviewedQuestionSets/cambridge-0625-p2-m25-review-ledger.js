/* Source-semantic review ledger for Cambridge IGCSE Physics 0625/22, M25. */

export const CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER_SCHEMA_VERSION = 'cambridge-0625-p2-m25-review-ledger.v1'

const REVIEWED_AT = '2026-08-14T18:00:00+08:00'
const REVIEWED_BY = 'Codex source-semantic-review / 0625-P2-M25'

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

export const CAMBRIDGE_0625_P2_M25_REVIEW_LEDGER = Object.freeze({
  paperId: 'cie-0625-0625_m25_qp_22',
  questionPaperFile: '0625_m25_qp_22.pdf',
  markSchemeFile: '0625_m25_ms_22.pdf',
  component: 2,
  expectedQuestionCount: 40,
  expectedTotalMarks: 40,
  reviewedAt: REVIEWED_AT,
  reviewedBy: REVIEWED_BY,
  reviewMethod: 'paired-qp-ms-page-review',
  sourcePolicy: 'personal-study-restricted',
  sourcePagePolicy: 'complete-official-page-fallback',
  questions: Object.freeze([
    row(1, 'B', 'forces', ['forces'], 2, 2),
    row(2, 'B', 'forces', ['forces'], 2, 2),
    row(3, 'C', 'forces', ['forces'], 2, 2),
    row(4, 'D', 'forces', ['forces'], 3, 2),
    row(5, 'A', 'forces', ['forces'], 3, 2),
    row(6, 'C', 'forces', ['forces'], 3, 2),
    row(7, 'B', 'forces', ['forces'], 4, 2),
    row(8, 'A', 'forces', ['forces'], 4, 2),
    row(9, 'D', 'forces', ['forces'], 5, 2),
    row(10, 'B', 'forces', ['forces'], 5, 2),
    row(11, 'A', 'thermal', ['thermalTransfer'], 5, 2),
    row(12, 'D', 'forces', ['forces'], 5, 2),
    row(13, 'A', 'thermal', ['thermalKinetic'], 6, 2),
    row(14, 'D', 'thermal', ['thermalTemperature'], 6, 2),
    row(15, 'A', 'thermal', ['thermalTemperature'], 6, 2),
    row(16, 'B', 'thermal', ['thermalKinetic'], 6, 2),
    row(17, 'C', 'thermal', ['thermalKinetic', 'thermalTransfer'], 7, 2),
    row(18, 'D', 'thermal', ['thermalTransfer'], 7, 2),
    row(19, 'D', 'waves', ['wavesGeneral'], 7, 2),
    row(20, 'A', 'waves', ['wavesSound'], 7, 2),
    row(21, 'A', 'waves', ['wavesOptics'], 8, 2),
    row(22, 'D', 'waves', ['wavesOptics'], 8, 2),
    row(23, 'A', 'waves', ['wavesOptics'], 8, 2),
    row(24, 'B', 'electricity', ['electricityQuantities'], 9, 2),
    row(25, 'A', 'electricity', ['electricityQuantities'], 9, 2),
    row(26, 'A', 'electricity', ['electricityQuantities'], 9, 2),
    row(27, 'D', 'electricity', ['electricityQuantities'], 9, 2),
    row(28, 'C', 'electricity', ['electricityCircuits'], 10, 2),
    row(29, 'D', 'electricity', ['electricityCircuits'], 11, 3),
    row(30, 'C', 'electricity', ['electricityEffects'], 12, 3),
    row(31, 'B', 'electricity', ['electricityEffects'], 12, 3),
    row(32, 'C', 'electricity', ['electricityEffects'], 13, 3),
    row(33, 'C', 'electricity', ['electricityEffects'], 13, 3),
    row(34, 'C', 'nuclear', ['nuclearAtomic'], 13, 3),
    row(35, 'A', 'nuclear', ['nuclearAtomic'], 14, 3),
    row(36, 'A', 'nuclear', ['nuclearRadiation'], 14, 3),
    row(37, 'D', 'nuclear', ['nuclearRadiation'], 14, 3),
    row(38, 'D', 'nuclear', ['nuclearAtomic'], 15, 3),
    row(39, 'C', 'space', ['spaceEarth'], 15, 3),
    row(40, 'A', 'space', ['spaceUniverse'], 16, 3),
  ]),
})
