const FAMILY_BY_STAGE = Object.freeze({
  IGCSE: 'exam',
  AS: 'exam',
  A2: 'exam',
  Competition: 'competition',
  Admissions: 'admissions',
})

const MAPPED_TERM_IDS_BY_ROUTE = Object.freeze({
  'cie-9702-as-physics': ['stem.physics.dynamics', 'stem.physics.electricity', 'stem.physics.waves'],
  'cie-9702-a2-physics': ['stem.physics.electric-fields', 'stem.physics.gravitational-fields', 'stem.physics.waves'],
  'cie-0580-igcse-mathematics': ['stem.math.number', 'stem.math.algebra', 'stem.math.algebra-graphs'],
  'bpho-admissions-physics': ['stem.physics.mechanics', 'stem.physics.dynamics', 'stem.physics.waves'],
  'maa-amc12-admissions-mathematics': ['stem.math.algebra', 'stem.math.number'],
  'uatuk-esat-admissions': ['stem.physics.mechanics', 'stem.math.algebra'],
  'uatuk-tmua-admissions': ['stem.math.algebra', 'stem.math.algebra-graphs'],
})

function clean(value, fallback = '') {
  return String(value || fallback).trim()
}

export const STEM_VOCABULARY_CONTRACT_VERSION = 'stem-vocabulary-context-v1'

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
    subjectCode: clean(route?.subjectCode).toUpperCase(),
    stage: clean(route?.stage),
    topicId: clean(topicId),
    mappedTermIds: Object.freeze(mappedTermIds),
    source: clean(route?.syllabus?.url || route?.syllabus?.board || 'source registry'),
    sourceStatus: 'taxonomy-mapped',
    termInventoryStatus: 'IELTSist glossary sync pending',
    availableCount: null,
    coverageNote: 'No local term count is reported until the shared glossary import provides source-backed entries.',
    label: taxonomy?.label || 'Vocabulary',
    description: taxonomy?.description || 'Route vocabulary',
  })
}

export function buildStemVocabularyContext({ route, topicId = '', termIds = [], attemptId = '', returnTo = '' } = {}) {
  const coverage = vocabularyCoverageForRoute(route, { topicId, termIds })
  return Object.freeze({
    contractVersion: STEM_VOCABULARY_CONTRACT_VERSION,
    family: coverage.family,
    taxonomyId: coverage.taxonomyId,
    routeId: coverage.routeId,
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
