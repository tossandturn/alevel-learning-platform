const FAMILY_BY_STAGE = Object.freeze({
  IGCSE: 'exam',
  AS: 'exam',
  A2: 'exam',
  Competition: 'competition',
  Admissions: 'admissions',
})

const VOCABULARY_FAMILIES = Object.freeze(['exam', 'competition', 'admissions'])
const VOCABULARY_SOURCE_STATUSES = Object.freeze(['taxonomy-mapped', 'source-backed', 'pending'])
const VOCABULARY_INVENTORY_STATUSES = Object.freeze(['not-imported', 'imported', 'pending'])

const MATH_9709_PURE_TERM_IDS = Object.freeze([
  'stem.math.algebra',
  'stem.math.algebra-graphs',
  'stem.math.powers-roots',
  'stem.math.functions',
  'stem.math.trigonometry',
  'stem.math.calculus',
  'stem.math.sequences-series',
])
const MATH_9709_MECHANICS_TERM_IDS = Object.freeze(['stem.math.mechanics'])
const MATH_9709_STATISTICS_TERM_IDS = Object.freeze(['stem.math.statistics', 'stem.math.probability'])

const MAPPED_TERM_IDS_BY_ROUTE = Object.freeze({
  'cie-9702-as-physics': ['stem.physics.dynamics', 'stem.physics.electricity', 'stem.physics.waves'],
  'cie-9702-a2-physics': ['stem.physics.electric-fields', 'stem.physics.gravitational-fields', 'stem.physics.waves'],
  'cie-0580-igcse-mathematics': ['stem.math.number', 'stem.math.algebra', 'stem.math.algebra-graphs'],
  'cie-9709-as-p1-p2': [...MATH_9709_PURE_TERM_IDS],
  'cie-9709-as-p1-p4': [...MATH_9709_PURE_TERM_IDS, ...MATH_9709_MECHANICS_TERM_IDS],
  'cie-9709-as-p1-p5': [...MATH_9709_PURE_TERM_IDS, ...MATH_9709_STATISTICS_TERM_IDS],
  'cie-9709-a2-after-p1-p5-p3-p4': [...MATH_9709_PURE_TERM_IDS, ...MATH_9709_MECHANICS_TERM_IDS],
  'cie-9709-a2-after-p1-p5-p3-p6': [...MATH_9709_PURE_TERM_IDS, ...MATH_9709_STATISTICS_TERM_IDS],
  'cie-9709-a2-after-p1-p4-p3-p5': [...MATH_9709_PURE_TERM_IDS, ...MATH_9709_STATISTICS_TERM_IDS],
  'bpho-admissions-physics': ['stem.physics.mechanics', 'stem.physics.dynamics', 'stem.physics.waves'],
  'maa-amc12-admissions-mathematics': ['stem.math.algebra', 'stem.math.number'],
  'uatuk-esat-admissions': ['stem.physics.mechanics', 'stem.math.algebra'],
  'uatuk-tmua-admissions': ['stem.math.algebra', 'stem.math.algebra-graphs'],
})

function clean(value, fallback = '') {
  return String(value || fallback).trim()
}

export const STEM_VOCABULARY_CONTRACT_VERSION = 'stem-vocabulary-context-v1'

export { VOCABULARY_FAMILIES, VOCABULARY_SOURCE_STATUSES, VOCABULARY_INVENTORY_STATUSES }

export const STEM_VOCABULARY_TAXONOMY = Object.freeze({
  exam: Object.freeze({
    label: 'Exam vocabulary',
    description: 'Cambridge command words, subject terms and paper-specific language.',
    sourcePolicy: 'Syllabus and reviewed question provenance only.',
  }),
  competition: Object.freeze({
    label: 'Competition vocabulary',
    description: 'Olympiad and contest terminology grouped by route and round.',
    sourcePolicy: 'Official competition archive and reviewed source questions only.',
  }),
  admissions: Object.freeze({
    label: 'Admissions vocabulary',
    description: 'Admissions-test terminology grouped by module and paper.',
    sourcePolicy: 'Official admissions preparation material only.',
  }),
})

export function vocabularyCoverageForRoute(route, { topicId = '', termIds = [] } = {}) {
  const family = FAMILY_BY_STAGE[route?.stage] || 'exam'
  const taxonomy = STEM_VOCABULARY_TAXONOMY[family]
  const routeId = clean(route?.routeId)
  const mappedTermIds = [...new Set([
    ...(MAPPED_TERM_IDS_BY_ROUTE[routeId] || []),
    ...(Array.isArray(termIds) ? termIds : []),
  ].map((value) => clean(value)).filter(Boolean))]
  return Object.freeze({
    contractVersion: STEM_VOCABULARY_CONTRACT_VERSION,
    family,
    taxonomyId: `${family}.${clean(route?.subjectCode, 'stem').toLowerCase()}.${clean(route?.stage, 'route').toLowerCase()}`,
    routeId,
    subject: clean(route?.subject),
    subjectCode: clean(route?.subjectCode).toUpperCase(),
    stage: clean(route?.stage),
    topicId: clean(topicId),
    mappedTermIds: Object.freeze(mappedTermIds),
    source: clean(route?.syllabus?.url || route?.syllabus?.board || 'source registry'),
    sourceStatus: 'taxonomy-mapped',
    // Machine-readable state; IELTSist owns the glossary and supplies the
    // human-facing "IELTSist glossary sync pending" label.
    termInventoryStatus: 'not-imported',
    availableCount: null,
    coverageNote: 'No local term count is reported until the shared glossary import provides source-backed entries.',
    label: taxonomy?.label || 'Vocabulary',
    description: taxonomy?.description || 'Route vocabulary',
    termInventoryStatusLabel: 'IELTSist glossary sync pending',
  })
}

export function buildStemVocabularyContext({ route, topicId = '', termIds = [], attemptId = '', returnTo = '' } = {}) {
  const coverage = vocabularyCoverageForRoute(route, { topicId, termIds })
  return Object.freeze({
    contractVersion: STEM_VOCABULARY_CONTRACT_VERSION,
    family: coverage.family,
    taxonomyId: coverage.taxonomyId,
    routeId: coverage.routeId,
    subject: coverage.subject,
    subjectCode: coverage.subjectCode,
    stage: coverage.stage,
    topicId: coverage.topicId,
    termIds: coverage.mappedTermIds,
    attemptId: clean(attemptId),
    returnTo: clean(returnTo),
    source: coverage.source,
    sourceStatus: coverage.sourceStatus,
    termInventoryStatus: coverage.termInventoryStatus,
    availableCount: coverage.availableCount,
  })
}
