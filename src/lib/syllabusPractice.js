import importedQuestionIndex from '../data/importedQuestionIndex.json' with { type: 'json' }
import paperCatalog from '../../public/data/papers.json' with { type: 'json' }
import { CAMBRIDGE_9702_AS_SYLLABUS } from '../data/syllabus/cambridge-9702-as-2025-2027.js'
import { CAMBRIDGE_9702_A2_SYLLABUS } from '../data/syllabus/cambridge-9702-a2-2025-2027.js'
import { CAMBRIDGE_0580_IGCSE_SYLLABUS } from '../data/syllabus/cambridge-0580-igcse-2025-2027.js'
import { CAMBRIDGE_0625_IGCSE_SYLLABUS } from '../data/syllabus/cambridge-0625-igcse-2026-2028.js'
import { CAMBRIDGE_0606_IGCSE_SYLLABUS } from '../data/syllabus/cambridge-0606-igcse-2025-2027.js'
import { CAMBRIDGE_9709_AS_P1_S1_SYLLABUS } from '../data/syllabus/cambridge-9709-as-p1-s1-2026-2027.js'
import { isAiMarkablePastPaperItem, isHumanReviewedPastPaperItem, isStudyOnlyPastPaperItem, normalizeImportedQuestion, studyQuestionBank, unifiedQuestionBank } from '../data/questionBank.js'
import { routeById } from '../data/routeRegistry.js'
import { canonicalAiMarkingProvenance, canonicalSourcePracticeProvenance } from './sourceContentContract.js'
import { canonicalSyllabusTopicIdForRoute, syllabusTopicScopeIdsForRoute } from './syllabusPracticeRoutes.js'
import { practiceUnitMetrics, withPracticePresentation } from './practicePresentation.js'

export { supportsSyllabusPracticeRoute } from './syllabusPracticeRoutes.js'

export const SYLLABUS_CATALOG_SCHEMA_VERSION = 'syllabus-catalog-v1'
export const SYLLABUS_MAPPING_SCHEMA_VERSION = 'question-syllabus-mapping-v1'

const SUPPORTED_9702_COMPONENTS = Object.freeze([1, 2])
const SUPPORTED_9702_A2_COMPONENTS = Object.freeze([4])
const SUPPORTED_0625_COMPONENTS = Object.freeze([2])
const SET_SIZES = Object.freeze([5, 10, 15])

function routeSyllabus(routeId, supportedComponents) {
  const route = routeById(routeId)
  const topics = route?.syllabus?.topics || []
  const components = supportedComponents || route?.paperComponents || []
  const syllabusVersion = route?.syllabus?.version || '2026-2027'
  const officialComponents = route?.syllabus?.assessmentComponents || []
  return Object.freeze({
    routeId,
    syllabusVersion,
    officialUrl: route?.syllabus?.url || '',
    componentScope: Object.freeze((route?.syllabus?.componentScope || [])
      .filter((scope) => components.includes(Number(scope.component)))
      .map((scope) => Object.freeze({
      ...scope,
      notes: Object.freeze(Array.isArray(scope.notes) ? scope.notes : []),
    }))),
    assessmentComponents: Object.freeze(components.map((component) => {
      const official = officialComponents.find((item) => Number(item.component) === Number(component))
      return Object.freeze({
        ...(official || {}),
        component,
        stage: official?.stage || route.stage,
        track: official?.track || 'theory',
        label: official?.label || `Paper ${component}`,
      })
    })),
    topics: Object.freeze(topics.map((topic, index) => Object.freeze({
      id: topic.id,
      routeId: topic.routeId || routeId,
      syllabusVersion: topic.syllabusVersion || syllabusVersion,
      code: String(topic.code || index + 1),
      name: String(topic.name || topic.title || '').replace(/^\d+(?:\.\d+)?\s+/, ''),
      order: Number(topic.order) || index + 1,
      officialPage: topic.officialPage ?? null,
      officialNotes: Object.freeze(Array.isArray(topic.officialNotes) ? topic.officialNotes : []),
      componentScope: topic.componentScope || null,
      points: Object.freeze(Array.isArray(topic.points) ? topic.points : []),
      component: topic.component || null,
    }))),
  })
}

function math9709Config(routeId, topicByComponent) {
  const route = routeById(routeId)
  return Object.freeze({
    syllabus: routeSyllabus(routeId),
    subjectCode: '9709',
    stage: route.stage,
    components: Object.freeze([...route.paperComponents]),
    topicByComponent: Object.freeze({ ...topicByComponent }),
  })
}

const CAMBRIDGE_0580_TOPIC_BY_LEGACY_ID = Object.freeze({
  'math-0580-number': '0580-igcse-topic-01',
  'math-0580-algebra': '0580-igcse-topic-02',
  'math-0580-coordinate': '0580-igcse-topic-03',
  'math-0580-geometry': '0580-igcse-topic-04',
  'math-0580-mensuration': '0580-igcse-topic-05',
  'math-0580-trigonometry': '0580-igcse-topic-06',
  'math-0580-transformations': '0580-igcse-topic-07',
  'math-0580-probability': '0580-igcse-topic-08',
  'math-0580-statistics': '0580-igcse-topic-09',
})

const SYLLABUS_CONFIGS = Object.freeze({
  [CAMBRIDGE_0580_IGCSE_SYLLABUS.routeId]: Object.freeze({
    syllabus: CAMBRIDGE_0580_IGCSE_SYLLABUS,
    subjectCode: '0580',
    stage: 'IGCSE',
    components: Object.freeze([1, 2, 3, 4]),
    topicByKnowledgeGroup: CAMBRIDGE_0580_TOPIC_BY_LEGACY_ID,
  }),
  [CAMBRIDGE_9702_AS_SYLLABUS.routeId]: Object.freeze({
    syllabus: CAMBRIDGE_9702_AS_SYLLABUS,
    subjectCode: '9702',
    stage: 'AS',
    components: SUPPORTED_9702_COMPONENTS,
  }),
  [CAMBRIDGE_9702_A2_SYLLABUS.routeId]: Object.freeze({
    syllabus: CAMBRIDGE_9702_A2_SYLLABUS,
    subjectCode: '9702',
    stage: 'A2',
    components: SUPPORTED_9702_A2_COMPONENTS,
  }),
  [CAMBRIDGE_0625_IGCSE_SYLLABUS.routeId]: Object.freeze({
    syllabus: CAMBRIDGE_0625_IGCSE_SYLLABUS,
    subjectCode: '0625',
    stage: 'IGCSE',
    components: SUPPORTED_0625_COMPONENTS,
  }),
  [CAMBRIDGE_0606_IGCSE_SYLLABUS.routeId]: Object.freeze({
    syllabus: CAMBRIDGE_0606_IGCSE_SYLLABUS,
    subjectCode: '0606',
    stage: 'IGCSE',
    components: Object.freeze([1, 2]),
  }),
  'cie-9709-as-p1-p2': math9709Config('cie-9709-as-p1-p2', { 1: '9709-p1-topic-01', 2: '9709-p2-topic-01' }),
  'cie-9709-as-p1-p4': math9709Config('cie-9709-as-p1-p4', { 1: '9709-p1-topic-01', 4: '9709-m1-topic-01' }),
  [CAMBRIDGE_9709_AS_P1_S1_SYLLABUS.routeId]: Object.freeze({
    syllabus: CAMBRIDGE_9709_AS_P1_S1_SYLLABUS,
    subjectCode: '9709',
    stage: 'AS',
    components: Object.freeze([1, 5]),
    topicByComponent: Object.freeze({ 1: '9709-p1-topic-01', 5: '9709-s1-topic-01' }),
  }),
  'cie-9709-a2-after-p1-p5-p3-p4': math9709Config('cie-9709-a2-after-p1-p5-p3-p4', { 3: '9709-p3-topic-01', 4: '9709-m1-topic-01' }),
  'cie-9709-a2-after-p1-p5-p3-p6': math9709Config('cie-9709-a2-after-p1-p5-p3-p6', { 3: '9709-p3-topic-01', 6: '9709-s2-topic-01' }),
  'cie-9709-a2-after-p1-p4-p3-p5': math9709Config('cie-9709-a2-after-p1-p4-p3-p5', { 3: '9709-p3-topic-01', 5: '9709-s1-topic-01' }),
})

function syllabusConfig(routeId) {
  return SYLLABUS_CONFIGS[routeId] || null
}

const MATH_9709_COMPONENT_DOMAIN = Object.freeze({
  1: 'pure',
  2: 'pure',
  3: 'pure',
  4: 'mechanics',
  5: 'statistics',
  6: 'statistics',
})

function routeTopicIdsFor9709(routeId, topicId, component = null) {
  const canonical = canonicalSyllabusTopicIdForRoute(routeId, topicId)
  const topic = syllabusConfig(routeId)?.syllabus.topics.find((item) => item.id === canonical)
  return topic && (component == null || Number(topic.component) === Number(component))
    ? [canonical]
    : []
}

const MATH_9709_TAG_TOPIC_BY_COMPONENT = Object.freeze({
  1: Object.freeze([
    [/quadratic|completing the square|discriminant|simultaneous equations/i, '9709-p1-topic-01'],
    [/\bfunctions?\b|one.?one|inverse function|composition of functions|range of function|transformations?/i, '9709-p1-topic-02'],
    [/coordinate geometry|straight.?line|intersection of line and circle|midpoint/i, '9709-p1-topic-03'],
    [/circular measure|radian|arc length|sector/i, '9709-p1-topic-04'],
    [/trigonometry|trigonometr|sine|cosine|tangent/i, '9709-p1-topic-05'],
    [/sequences? and series|progression|binomial theorem|binomial expansion/i, '9709-p1-topic-06'],
    [/differentiation|derivative|stationary points?|second derivative|related rates|rates of change|chain rule|dy\/dx/i, '9709-p1-topic-07'],
    [/integration|integral|area between curves|area under curve|volume of revolution/i, '9709-p1-topic-08'],
  ]),
  2: Object.freeze([
    [/algebra and functions|modulus|absolute value|polynomial division|factor theorem|remainder theorem/i, '9709-p2-topic-01'],
    [/logarithm|exponential|linear form/i, '9709-p2-topic-02'],
    [/trigonometry|trigonometr|secant|cosecant|cotangent|double.?angle/i, '9709-p2-topic-03'],
    [/differentiation|derivative|parametric differentiation|implicit differentiation|product rule|quotient rule|chain rule/i, '9709-p2-topic-04'],
    [/integration|integral|trapezium rule|area under curve/i, '9709-p2-topic-05'],
    [/numerical solution|iterative|iteration|sequence of approximations|searching for a sign change/i, '9709-p2-topic-06'],
  ]),
  3: Object.freeze([
    [/algebra and functions|modulus|absolute value|polynomial division|factor theorem|remainder theorem|partial fractions?|binomial series|binomial expansion/i, '9709-p3-topic-01'],
    [/logarithm|exponential|linear form/i, '9709-p3-topic-02'],
    [/trigonometry|trigonometr|secant|cosecant|cotangent|double.?angle/i, '9709-p3-topic-03'],
    [/differentiation|derivative|parametric equations?|implicit differentiation|product rule|quotient rule|chain rule/i, '9709-p3-topic-04'],
    [/integration|integral|integration by parts|substitution/i, '9709-p3-topic-05'],
    [/numerical solution|iterative|iteration|sequence of approximations|searching for a sign change/i, '9709-p3-topic-06'],
    [/\bvectors?\b|vector equations? of lines|scalar product|skew lines?/i, '9709-p3-topic-07'],
    [/differential equations?|separation of variables|initial conditions?/i, '9709-p3-topic-08'],
    [/complex numbers?|argand|polar form|conjugate pairs?|complex loci|real part condition/i, '9709-p3-topic-09'],
  ]),
  4: Object.freeze([
    [/forces? and equilibrium|\bequilibrium\b|friction|resultant force|resolution of forces|vector resolution|statics/i, '9709-m1-topic-01'],
    [/\bkinematics\b|motion in a straight line|moves in a straight line|travelling along a straight|displacement.?time|velocity.?time|constant acceleration/i, '9709-m1-topic-02'],
    [/\bmomentum\b|direct impact|collision|coalesce/i, '9709-m1-topic-03'],
    [/newton.?s? laws?|connected particles|inclined plane|tension|mass and weight/i, '9709-m1-topic-04'],
    [/work energy and power|energy method|kinetic energy|potential energy|\bpower\b/i, '9709-m1-topic-05'],
  ]),
  5: Object.freeze([
    [/representation of data|histogram|box.?and.?whisker|stem.?and.?leaf|cumulative frequency/i, '9709-s1-topic-01'],
    [/permutations? and combinations?|arrangements?|selections?/i, '9709-s1-topic-02'],
    [/\bprobability\b|conditional|independent events?|exclusive events?/i, '9709-s1-topic-03'],
    [/discrete distributions?|discrete random variables?|binomial distribution|geometric distribution|expectation|variance/i, '9709-s1-topic-04'],
    [/normal distribution|normal approximation|standardisation|standard normal|z.?score/i, '9709-s1-topic-05'],
  ]),
  6: Object.freeze([
    [/poisson|\bpo\s*\(/i, '9709-s2-topic-01'],
    [/linear combinations? of (?:normal |random )?variables?|expectation and variance/i, '9709-s2-topic-02'],
    [/continuous distributions?|continuous random variables?|probability density/i, '9709-s2-topic-03'],
    [/\bsampling\b|estimation|confidence interval|central limit|unbiased estimate/i, '9709-s2-topic-04'],
    [/hypothesis test|hypothesis testing|null hypothesis|alternative hypothesis|significance level|type i error|type ii error|rejection region|critical region/i, '9709-s2-topic-05'],
  ]),
})

function classificationTextFor9709(question) {
  const partText = (Array.isArray(question.parts) ? question.parts : []).flatMap((part) => [
    part?.prompt,
    part?.promptFragment,
    part?.questionText,
    part?.text,
  ])
  return [
    ...(Array.isArray(question.topicTags) ? question.topicTags : []),
    ...(Array.isArray(question.skillTags) ? question.skillTags : []),
    question.prompt,
    question.questionText,
    question.stem,
    question.title,
    ...partText,
  ].map((value) => String(value || '').trim()).filter(Boolean).join(' | ')
}

function tagTopicIdsFor9709(component, question, validTopics) {
  const mappings = MATH_9709_TAG_TOPIC_BY_COMPONENT[component] || []
  const text = classificationTextFor9709(question)
  const topicIds = []
  for (const [pattern, topicId] of mappings) {
    if (validTopics.has(topicId) && pattern.test(text) && !topicIds.includes(topicId)) topicIds.push(topicId)
  }
  return topicIds
}

function explicitTopicResolutionFor9709(question, config, component) {
  const suppliedMapping = question.syllabusMapping || {}
  const rawTopicIds = [suppliedMapping.primaryTopicId, ...(suppliedMapping.secondaryTopicIds || [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  const topicIds = []
  let invalid = false
  for (const rawTopicId of rawTopicIds) {
    const topicId = routeTopicIdsFor9709(config.syllabus.routeId, rawTopicId, component)[0]
    if (!topicId) {
      invalid = true
      continue
    }
    if (!topicIds.includes(topicId)) topicIds.push(topicId)
  }
  return { topicIds, invalid, supplied: rawTopicIds.length > 0 }
}

/**
 * Resolve chapter-level 9709 syllabus evidence without turning a broad legacy
 * domain into an arbitrary chapter. Reviewed mappings must be wholly valid for
 * the route and component; inferred mappings remain pending review.
 */
export function topicMembershipIdsForQuestion(question, { routeId = question?.routeId } = {}) {
  if (String(question?.subjectCode || '') !== '9709') return []
  const route = String(routeId || '')
  const config = syllabusConfig(route)
  if (!config) return []
  const component = Number(question.sourceRef?.component)
  const domain = MATH_9709_COMPONENT_DOMAIN[component]
  if (!domain) return []
  const validTopics = new Set(config.syllabus.topics.map((topic) => topic.id))
  const topicTags = new Set((Array.isArray(question.topicTags) ? question.topicTags : []).map((tag) => String(tag || '').trim()))
  const knowledgeGroup = String(question.knowledgeGroupId || question.topicId || '').split('@')[0]
  const explicit = explicitTopicResolutionFor9709(question, config, component)
  const suppliedStatus = String(question.syllabusMapping?.reviewStatus || '').toLowerCase()
  if (suppliedStatus === 'reviewed') {
    return explicit.supplied && !explicit.invalid ? explicit.topicIds : []
  }

  const memberships = []
  const add = (topicId) => {
    if (topicId && validTopics.has(topicId) && !memberships.includes(topicId)) memberships.push(topicId)
  }

  const canonicalDomainTag = 'math-9709-' + domain
  const hasDomainTag = knowledgeGroup === canonicalDomainTag || topicTags.has(canonicalDomainTag)
  if (hasDomainTag) {
    for (const topicId of tagTopicIdsFor9709(component, question, validTopics)) add(topicId)
  }
  for (const topicId of explicit.topicIds) add(topicId)

  return memberships
}

function officialFirstBatchPapers(config) {
  return (paperCatalog.items || []).filter((item) => (
    item.subject === config.subjectCode
    && item.kind === 'qp'
    && config.components.includes(Number(item.examProfile?.paperNumber ?? item.paperComponent))
    && item.markSchemeId
    && Number(item.year) >= 2023
    && Number(item.year) <= 2025
  ))
}

function joinedIndexItems(index) {
  if (Array.isArray(index.items)) return index.items
  const answers = new Map((index.answers || []).map((answer) => [answer.answerId, answer]))
  const bindings = new Map((index.bindings || []).map((binding) => [binding.questionId, binding]))
  return (index.questions || []).map((question) => {
    const binding = bindings.get(question.questionId)
    const answer = answers.get(binding?.answerId)
    return {
      ...question,
      ...(answer || {}),
      answerBinding: binding || null,
    }
  })
}

function rawSyllabusQuestionGroups(config) {
  const route = routeById(config.syllabus.routeId)
  return joinedIndexItems(importedQuestionIndex)
    .filter((question) => (
      question.subjectCode === config.subjectCode
      && config.components.includes(Number(question.sourceRef?.component))
      && question.sourceRef?.paperId
    ))
    .map((question) => {
      const answerRef = question.answerRef || {}
      const answerBinding = question.answerBinding || {}
      return normalizeImportedQuestion({
        ...question,
        answerBinding,
        answerRef,
        answerParts: question.answerParts || [],
        parts: question.parts || [],
      }, route)
    })
}

function syllabusPointResolutionFor9709(syllabus, topicIds, suppliedPointIds = []) {
  const requested = [...new Set((Array.isArray(suppliedPointIds) ? suppliedPointIds : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))]
  const validPointIds = new Set(syllabus.topics
    .filter((topic) => topicIds.includes(topic.id))
    .flatMap((topic) => topic.points || [])
    .map((point) => point.id))
  return {
    pointIds: requested.filter((pointId) => validPointIds.has(pointId)),
    invalid: requested.some((pointId) => !validPointIds.has(pointId)),
  }
}

function candidateMappingFor(question, syllabus, config = {}) {
  const component = Number(question.sourceRef?.component)
  const knowledgeGroupId = String(question.knowledgeGroupId || question.topicId || '')
  if (config.subjectCode === '9709') {
    const topicIds = topicMembershipIdsForQuestion(question, { routeId: syllabus.routeId })
    if (!topicIds.length) return null
    const suppliedMapping = question.syllabusMapping || {}
    const explicit = explicitTopicResolutionFor9709(question, config, component)
    const suppliedPrimary = routeTopicIdsFor9709(syllabus.routeId, suppliedMapping.primaryTopicId, component)[0]
    const primaryTopicId = suppliedPrimary && topicIds.includes(suppliedPrimary) ? suppliedPrimary : topicIds[0]
    const secondaryTopicIds = topicIds.filter((topicId) => topicId !== primaryTopicId)
    const suppliedStatus = String(suppliedMapping.reviewStatus || '').toLowerCase()
    const reviewed = suppliedStatus === 'reviewed' && explicit.supplied && !explicit.invalid && explicit.topicIds.length > 0
    if (suppliedStatus === 'reviewed' && !reviewed) return null
    const pointResolution = syllabusPointResolutionFor9709(syllabus, topicIds, suppliedMapping.syllabusPointIds)
    if (reviewed && pointResolution.invalid) return null
    return Object.freeze({
      schemaVersion: SYLLABUS_MAPPING_SCHEMA_VERSION,
      questionGroupId: question.sourceQuestionId || question.questionGroupId,
      primaryTopicId,
      secondaryTopicIds: Object.freeze(secondaryTopicIds),
      topicIds: Object.freeze(topicIds),
      syllabusPointIds: Object.freeze(pointResolution.pointIds),
      confidence: reviewed ? Number(suppliedMapping.confidence || 1) : 0.5,
      mappingMethod: reviewed ? 'manual' : 'rule',
      reviewStatus: reviewed ? 'reviewed' : 'pending',
      reviewedBy: reviewed ? suppliedMapping.reviewedBy || null : null,
      reviewedAt: reviewed ? suppliedMapping.reviewedAt || null : null,
      reviewReason: reviewed ? null : 'Machine-indexed topic tag is a review candidate, not publishable evidence.',
    })
  }
  const mappedTopicId = String(config.topicByComponent?.[component] || config.topicByKnowledgeGroup?.[knowledgeGroupId] || knowledgeGroupId)
  const topicId = canonicalSyllabusTopicIdForRoute(syllabus.routeId, mappedTopicId)
  const topic = syllabus.topics.find((item) => item.id === topicId)
  if (!topic) return null
  const suppliedStatus = String(question.syllabusMapping?.reviewStatus || '').toLowerCase()
  const reviewed = suppliedStatus === 'reviewed'
  return Object.freeze({
    schemaVersion: SYLLABUS_MAPPING_SCHEMA_VERSION,
    questionGroupId: question.sourceQuestionId || question.questionGroupId,
    primaryTopicId: topic.id,
    secondaryTopicIds: Object.freeze([]),
    topicIds: Object.freeze([topic.id]),
    syllabusPointIds: Object.freeze(question.syllabusMapping?.syllabusPointIds || []),
    confidence: reviewed ? Number(question.syllabusMapping?.confidence || 1) : 0.5,
    mappingMethod: reviewed ? 'manual' : 'rule',
    reviewStatus: reviewed ? 'reviewed' : 'pending',
    reviewedBy: reviewed ? question.syllabusMapping.reviewedBy || null : null,
    reviewedAt: reviewed ? question.syllabusMapping.reviewedAt || null : null,
    reviewReason: reviewed ? null : 'Machine-indexed topic tag is a review candidate, not publishable evidence.',
  })
}

function currentReviewedQuestionById(questionBank, routeId) {
  return new Map((Array.isArray(questionBank) ? questionBank : [])
    .filter((question) => question?.routeId === routeId)
    .map((question) => [question.sourceQuestionId || question.questionGroupId, question]))
}

function effectiveQuestionRecords(questionBank, config = SYLLABUS_CONFIGS[CAMBRIDGE_9702_AS_SYLLABUS.routeId]) {
  const reviewedById = currentReviewedQuestionById(questionBank, config.syllabus.routeId)
  const rawQuestions = rawSyllabusQuestionGroups(config)
  const rawQuestionIds = new Set(rawQuestions.map((question) => question.sourceQuestionId || question.questionGroupId).filter(Boolean))
  const currentQuestions = [
    ...rawQuestions.map((rawQuestion) => ({
      sourceQuestionId: rawQuestion.sourceQuestionId || rawQuestion.questionGroupId,
      question: reviewedById.get(rawQuestion.sourceQuestionId || rawQuestion.questionGroupId) || rawQuestion,
      suppliedByCurrentBank: reviewedById.has(rawQuestion.sourceQuestionId || rawQuestion.questionGroupId),
    })),
    ...[...reviewedById.entries()]
      .filter(([sourceQuestionId]) => !rawQuestionIds.has(sourceQuestionId))
      .map(([sourceQuestionId, question]) => ({ sourceQuestionId, question, suppliedByCurrentBank: true })),
  ]
  return currentQuestions.map(({ sourceQuestionId, question, suppliedByCurrentBank }) => {
    const mapping = candidateMappingFor(question, config.syllabus, config)
    const reviewed = Boolean(
      suppliedByCurrentBank
      && isHumanReviewedPastPaperItem(question)
      && mapping?.reviewStatus === 'reviewed',
    )
    const sourceBackedStudy = Boolean(
      suppliedByCurrentBank
      && !reviewed
      && question.studentStudyEligible !== false
      && mapping?.topicIds?.length
      && (isHumanReviewedPastPaperItem(question) || isStudyOnlyPastPaperItem(question)),
    )
    return Object.freeze({
      question,
      sourceQuestionId,
      questionGroupId: question.questionGroupId || sourceQuestionId,
      routeId: config.syllabus.routeId,
      stage: config.stage,
      subjectCode: config.subjectCode,
      paperComponent: Number(question.sourceRef?.component) || null,
      verificationStatus: question.answerBinding?.verificationStatus || 'machine-indexed',
      sourceContentComplete: question.sourceContent?.complete === true,
      sourceContentFileComplete: question.sourceContent?.fileComplete === true,
      semanticStatus: question.sourceContent?.semanticStatus || 'unreviewed',
      mapping: mapping || Object.freeze({
        schemaVersion: SYLLABUS_MAPPING_SCHEMA_VERSION,
        questionGroupId: sourceQuestionId,
        primaryTopicId: null,
        secondaryTopicIds: Object.freeze([]),
        topicIds: Object.freeze([]),
        syllabusPointIds: Object.freeze([]),
        confidence: 0,
        mappingMethod: 'rule',
        reviewStatus: 'rejected',
        reviewReason: `No canonical ${config.subjectCode} syllabus topic could be resolved.`,
      }),
      eligible: reviewed,
      studyEligible: sourceBackedStudy,
      studyOnly: sourceBackedStudy,
    })
  })
}

function topicRowsForRoute(routeId, questionBank, { includeStudyOnly = true } = {}) {
  const config = syllabusConfig(routeId)
  if (!config) {
    const route = routeById(routeId)
    return (route?.syllabus?.topics || []).map((topic, index) => ({
      id: topic.id,
      routeId,
      syllabusVersion: route.syllabus.version,
      code: String(index + 1),
      name: topic.title,
      order: index + 1,
      officialPage: null,
      points: [],
      verifiedQuestionCount: 0,
      studyQuestionCount: 0,
      availableQuestionCount: 0,
      indexedQuestionCount: 0,
      pendingReviewCount: 0,
      availableSetSizes: [],
      ready: false,
      ctaPolicy: 'hidden',
      sourceGap: 'This route has no syllabus-backed question mapping yet.',
    }))
  }

  const records = effectiveQuestionRecords(questionBank, config)
  return config.syllabus.topics.map((topic) => {
    const topicRecords = records.filter((record) => record.mapping.topicIds?.includes(topic.id))
    const eligible = topicRecords.filter((record) => record.eligible)
    const verifiedQuestionCount = eligible.length
    const studyQuestionCount = includeStudyOnly ? topicRecords.filter((record) => record.studyEligible).length : 0
    const availableQuestionCount = verifiedQuestionCount + studyQuestionCount
    const questionIdsByComponent = Object.fromEntries(config.components.map((component) => {
      const componentRecords = topicRecords.filter((record) => record.paperComponent === component)
      const componentIds = (filter) => componentRecords.filter(filter).map((record) => record.sourceQuestionId)
      return [component, {
        indexedQuestionIds: componentIds(() => true),
        verifiedQuestionIds: componentIds((record) => record.eligible),
        studyQuestionIds: componentIds((record) => includeStudyOnly && record.studyEligible),
        pendingReviewQuestionIds: componentIds((record) => !record.eligible),
      }]
    }))
    const componentCounts = Object.fromEntries(config.components.map((component) => {
      const componentRecords = topicRecords.filter((record) => record.paperComponent === component)
      const componentVerified = componentRecords.filter((record) => record.eligible).length
      const componentStudy = includeStudyOnly
        ? componentRecords.filter((record) => record.studyEligible).length
        : 0
      return [component, {
        verifiedQuestionCount: componentVerified,
        studyQuestionCount: componentStudy,
        availableQuestionCount: componentVerified + componentStudy,
      }]
    }))
    const indexedQuestionCount = topicRecords.length
    const pendingReviewCount = topicRecords.filter((record) => !record.eligible).length
    const ready = verifiedQuestionCount >= 10
    return {
      ...topic,
      verifiedQuestionCount,
      studyQuestionCount,
      availableQuestionCount,
      componentCounts,
      questionIdsByComponent,
      indexedQuestionCount,
      pendingReviewCount,
      availableSetSizes: SET_SIZES.filter((size) => size <= availableQuestionCount),
      ready,
      studyReady: availableQuestionCount > 0,
      ctaPolicy: ready ? 'start' : availableQuestionCount > 0 ? 'start-study' : 'hidden',
      sourceGap: ready
        ? null
        : availableQuestionCount > 0
          ? `Available for study: ${availableQuestionCount} complete source question${availableQuestionCount === 1 ? '' : 's'}; ${studyQuestionCount} stay outside formal mastery while source review is pending. Source-complete QP/MS items are AI-marked automatically.`
          : `Official QP/MS candidates indexed: ${indexedQuestionCount}; no complete source-backed question is available for this topic yet.`,
    }
  })
}

export function syllabusTopicsInventory({ routeId, questionBank = unifiedQuestionBank, includeStudyOnly = true } = {}) {
  const route = routeById(routeId)
  if (!route) {
    const error = new Error('routeId is not registered.')
    error.code = 'invalid_route'
    error.statusCode = 400
    throw error
  }
  const config = syllabusConfig(routeId)
  const topics = topicRowsForRoute(routeId, questionBank, { includeStudyOnly })
  const firstBatchPapers = config ? officialFirstBatchPapers(config) : []
  const effectiveRecords = config ? effectiveQuestionRecords(questionBank, config) : []
  const mappedRecords = effectiveRecords.filter((record) => record.mapping.topicIds?.length)
  const verifiedRecords = mappedRecords.filter((record) => record.eligible)
  const studyRecords = includeStudyOnly ? mappedRecords.filter((record) => record.studyEligible) : []
  const availableRecordIds = new Set([...verifiedRecords, ...studyRecords].map((record) => record.sourceQuestionId))
  return {
    schemaVersion: SYLLABUS_CATALOG_SCHEMA_VERSION,
    routeId,
    syllabusVersion: config
      ? config.syllabus.syllabusVersion
      : route.syllabus.version,
    syllabusUrl: config
      ? config.syllabus.officialUrl
      : route.syllabus.url,
    componentScope: config
      ? config.syllabus.componentScope || []
      : route.syllabus.componentScope || [],
    assessmentComponents: config
      ? config.syllabus.assessmentComponents.filter((item) => config.components.includes(Number(item.component)))
      : [],
    topics,
    ready: topics.some((topic) => topic.ready),
    officialPaperCount: firstBatchPapers.length,
    officialPairedPaperCount: firstBatchPapers.filter((paper) => Boolean(paper.markSchemeId)).length,
    indexedQuestionGroupCount: config ? effectiveRecords.length : topics.reduce((sum, topic) => sum + topic.indexedQuestionCount, 0),
    verifiedQuestionGroupCount: config ? verifiedRecords.length : topics.reduce((sum, topic) => sum + topic.verifiedQuestionCount, 0),
    studyQuestionGroupCount: config ? studyRecords.length : topics.reduce((sum, topic) => sum + topic.studyQuestionCount, 0),
    availableQuestionGroupCount: config ? availableRecordIds.size : topics.reduce((sum, topic) => sum + topic.availableQuestionCount, 0),
    unmappedQuestionGroupCount: effectiveRecords.filter((record) => !record.mapping.topicIds?.length).length,
    source: 'server-syllabus-catalog',
    gate: 'reviewed-or-source-backed-study-question',
  }
}

export function syllabusMappingCandidates({ questionBank = unifiedQuestionBank } = {}) {
  return effectiveQuestionRecords(questionBank).map((record) => ({
    schemaVersion: SYLLABUS_MAPPING_SCHEMA_VERSION,
    questionGroupId: record.questionGroupId,
    routeId: record.routeId,
    paperComponent: record.paperComponent,
    questionPaperId: record.question.sourceRef?.paperId || null,
    markSchemeId: record.question.answerRef?.documentId || null,
    primaryTopicId: record.mapping.primaryTopicId,
    secondaryTopicIds: record.mapping.secondaryTopicIds,
    topicIds: record.mapping.topicIds,
    syllabusPointIds: record.mapping.syllabusPointIds,
    confidence: record.mapping.confidence,
    mappingMethod: record.mapping.mappingMethod,
    reviewStatus: record.mapping.reviewStatus,
    reviewedBy: record.mapping.reviewedBy || null,
    reviewedAt: record.mapping.reviewedAt || null,
    sourceContentComplete: record.sourceContentComplete,
    verificationStatus: record.verificationStatus,
    semanticStatus: record.semanticStatus,
  }))
}

function seededRandom(seed) {
  let value = Number(seed) >>> 0
  return () => {
    value = (value + 0x6D2B79F5) >>> 0
    let result = value
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296
  }
}

function shuffle(items, random) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]]
  }
  return copy
}

function questionSortKey(question) {
  return [
    String(question.sourceRef?.paperId || ''),
    Number(question.sourceRef?.year) || 0,
    String(question.sourceRef?.question || ''),
  ].join('\u0000')
}

function selectBalancedQuestions(records, topicIds, requestedCount, attemptedIds, seed, components, includeStudyOnly = false) {
  const random = seededRandom(seed)
  const eligible = [...new Map(records.filter((record) => (
    (record.eligible || (includeStudyOnly && record.studyEligible))
    && topicIds.some((topicId) => record.mapping.topicIds?.includes(topicId))
    && components.includes(record.paperComponent)
  )).map((record) => [record.sourceQuestionId, record])).values()]
  const unseen = eligible.filter((record) => !attemptedIds.has(record.sourceQuestionId))
  const seen = eligible.filter((record) => attemptedIds.has(record.sourceQuestionId))
  const prioritizedPool = (items) => {
    const sortAndShuffle = (subset) => shuffle(
      [...subset].sort((left, right) => questionSortKey(left.question).localeCompare(questionSortKey(right.question))),
      random,
    )
    // A source-backed study item is a backfill, never a replacement for a
    // formal reviewed question in the same selected topic.
    return [
      ...sortAndShuffle(items.filter((record) => record.eligible)),
      ...sortAndShuffle(items.filter((record) => !record.eligible)),
    ]
  }
  const pools = new Map(topicIds.map((topicId) => [
    topicId,
    prioritizedPool(unseen.filter((record) => record.mapping.topicIds?.includes(topicId))),
  ]))
  const seenPools = new Map(topicIds.map((topicId) => [
    topicId,
    prioritizedPool(seen.filter((record) => record.mapping.topicIds?.includes(topicId))),
  ]))
  const selected = []
  const selectedIds = new Set()
  const takeUnique = (pool) => {
    while (pool?.length) {
      const next = pool.shift()
      if (!selectedIds.has(next.sourceQuestionId)) {
        selectedIds.add(next.sourceQuestionId)
        return next
      }
    }
    return null
  }
  while (selected.length < requestedCount) {
    let added = false
    for (const topicId of topicIds) {
      const pool = pools.get(topicId)
      const next = takeUnique(pool)
      if (next) {
        selected.push(next)
        added = true
        if (selected.length >= requestedCount) break
      }
    }
    if (selected.length >= requestedCount) break
    if (!added) {
      for (const topicId of topicIds) {
        const pool = seenPools.get(topicId)
        const next = takeUnique(pool)
        if (next) {
          selected.push(next)
          added = true
          if (selected.length >= requestedCount) break
        }
      }
    }
    if (!added) break
  }
  return selected
}

function selectExplicitQuestions(records, sourceQuestionIds, topicIds, components, includeStudyOnly = false) {
  const byId = new Map(records.filter((record) => (
    (record.eligible || (includeStudyOnly && record.studyEligible))
    && components.includes(record.paperComponent)
    && topicIds.some((topicId) => record.mapping.topicIds?.includes(topicId))
  )).map((record) => [record.sourceQuestionId, record]))
  const selected = []
  const missing = []
  for (const sourceQuestionId of sourceQuestionIds) {
    const record = byId.get(sourceQuestionId)
    if (!record) {
      missing.push(sourceQuestionId)
      continue
    }
    if (!selected.some((item) => item.sourceQuestionId === record.sourceQuestionId)) selected.push(record)
  }
  if (missing.length) {
    const error = new Error('Some selected source questions are no longer available in the current source catalog.')
    error.code = 'invalid_source_question_selection'
    error.statusCode = 409
    error.missingSourceQuestionIds = missing
    throw error
  }
  return selected
}

function sourceQuestionDisplayLabel(question, part) {
  const source = question.sourceRef || {}
  const paperMatch = String(source.paper || '').match(/(?:^|[_-])([msw]\d{2})[_-]qp[_-]?(\d{1,2})(?:$|[_.-])/i)
  const paperLabel = paperMatch ? `${paperMatch[1].toUpperCase()}/${paperMatch[2]}` : ''
  const questionLabel = String(source.question || 'Question').trim()
  const partLabel = String(part.label || '').trim()
  const questionPartLabel = partLabel && !questionLabel.endsWith(`(${partLabel})`)
    ? `${questionLabel}(${partLabel})`
    : questionLabel
  return paperLabel ? `${paperLabel} · ${questionPartLabel}` : questionPartLabel
}

function publicQuestionGroup(record) {
  const question = record.question
  return {
    id: record.sourceQuestionId,
    questionGroupId: record.questionGroupId,
    routeId: record.routeId,
    stage: record.stage,
    subjectCode: record.subjectCode,
    paperComponent: record.paperComponent,
    questionNumber: question.sourceRef?.question || null,
    totalMarks: Number(question.totalMarks || question.marks || 0),
    prompt: question.prompt || '',
    parts: (question.parts || []).map((part) => {
      const markingProvenance = canonicalAiMarkingProvenance(question, part)
      const sourceBindingProvenance = canonicalSourcePracticeProvenance(question, part)
      return {
        partId: part.partId,
        label: part.label,
        displayLabel: sourceQuestionDisplayLabel(question, part),
        marks: Number(part.marks || 0),
        promptFragment: part.promptFragment || '',
        answerArea: part.answerArea || null,
        options: part.options || [],
        answerKey: part.answerKey || null,
        markSchemePoints: part.markSchemePoints || [],
        sourcePage: part.sourcePage || question.sourceRef?.pageStart || null,
        answerSourcePage: part.answerSourcePage || question.answerRef?.pageStart || null,
        sourceEvidence: part.sourceEvidence || [],
        markSchemeEvidence: part.markSchemeEvidence || [],
        sourceFocus: part.sourceFocus || null,
        markingProvenance,
        sourceBindingProvenance,
        aiAssistedMarkingAvailable: Boolean(
          isAiMarkablePastPaperItem(question)
          && markingProvenance
          && sourceBindingProvenance,
        ),
      }
    }),
    sourceRef: question.sourceRef,
    answerRef: question.answerRef,
    reviewStatus: question.answerBinding?.verificationStatus || 'machine-indexed',
    studyOnly: record.studyOnly,
    sourceContent: {
      complete: question.sourceContent?.complete === true,
      fileComplete: question.sourceContent?.fileComplete === true,
      semanticStatus: question.sourceContent?.semanticStatus || 'unreviewed',
      studyOnly: record.studyOnly,
      pages: question.sourceContent?.sourcePages || [],
      assetUrls: question.sourceContent?.assetUrls || question.sourceRef?.assetUrls || [],
      bindingSignature: question.sourceContent?.bindingSignature || '',
    },
    syllabusMapping: record.mapping,
  }
}

function questionGroupSetMetrics(questionGroups) {
  const parts = questionGroups.flatMap((group) => (group.parts || []).map((part) => ({
    ...part,
    sourceQuestionId: group.id,
    questionGroupId: group.questionGroupId || group.id,
    sourceRef: group.sourceRef,
    paperComponent: group.paperComponent,
    reviewStatus: group.reviewStatus,
    studyOnly: group.studyOnly === true,
  })))
  return practiceUnitMetrics({ parts })
}

function samePracticeBinding(left, right) {
  return Boolean(left && right
    && left.sourceQuestionId === right.sourceQuestionId
    && left.questionPartId === right.questionPartId
    && left.bindingSignature === right.bindingSignature
    && left.reviewVersion === right.reviewVersion
    && left.sourceDocumentSha256 === right.sourceDocumentSha256
    && left.answerDocumentSha256 === right.answerDocumentSha256
    && left.sourceIndexSha256 === right.sourceIndexSha256
    && left.sourceManifestChecksum === right.sourceManifestChecksum)
}

function syllabusTopicsForPersistedUnit(unit, config) {
  const candidates = String(unit?.syllabusTopic || unit?.knowledgeGroupId || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const validTopicIds = new Set(config.syllabus.topics.map((topic) => topic.id))
  const topicIds = [...new Set(candidates.flatMap((topicId) => syllabusTopicScopeIdsForRoute(config.syllabus.routeId, topicId)))]
  return topicIds.length && topicIds.every((topicId) => validTopicIds.has(topicId)) ? topicIds : []
}

/**
 * Persisted server syllabus units are convenience references, not authority.
 * Rebuild the exact part scope from the current study pool and require every
 * persisted source identity to match before restoring a session or history.
 */
export function rebindSyllabusPracticeUnit(unit, { questionBank = studyQuestionBank, includeStudyOnly = true } = {}) {
  if (!unit || unit.sourceAuthority !== 'server-syllabus' || unit.sourceGateVersion !== 'server-syllabus-catalog-v2') return null
  const route = routeById(unit.routeId)
  const config = route && syllabusConfig(route.routeId)
  if (!route || !config || route.stage !== config.stage) return null

  const topicIds = syllabusTopicsForPersistedUnit(unit, config)
  const selectedComponents = [...new Set((Array.isArray(unit.paperComponent) ? unit.paperComponent : [unit.paperComponent])
    .map((value) => Number(value))
    .filter((value) => config.components.includes(value)))]
  const persistedParts = Array.isArray(unit.parts) ? unit.parts : []
  if (!topicIds.length || !selectedComponents.length || !persistedParts.length || persistedParts.length > 500) return null

  const recordsByQuestionId = new Map(effectiveQuestionRecords(questionBank, config)
    .filter((record) => (record.eligible || (includeStudyOnly && record.studyEligible))
      && topicIds.some((topicId) => record.mapping.topicIds?.includes(topicId))
      && selectedComponents.includes(record.paperComponent))
    .map((record) => [record.sourceQuestionId, record]))
  const uniquePartKeys = new Set()
  const reboundParts = []

  for (const persistedPart of persistedParts) {
    const sourceQuestionId = String(persistedPart?.sourceQuestionId || '').trim()
    const questionPartId = String(persistedPart?.questionPartId || persistedPart?.partId || '').trim()
    const key = `${sourceQuestionId}\u0000${questionPartId}`
    if (!sourceQuestionId || !questionPartId || uniquePartKeys.has(key)) return null
    uniquePartKeys.add(key)

    const record = recordsByQuestionId.get(sourceQuestionId)
    const group = record && publicQuestionGroup(record)
    const currentPart = group?.parts.find((part) => part.partId === questionPartId)
    const persistedBinding = persistedPart?.sourceBindingProvenance || persistedPart?.markingProvenance
    if (!record || !group || !currentPart || !samePracticeBinding(persistedBinding, currentPart.sourceBindingProvenance)) return null

    reboundParts.push(Object.freeze({
      ...currentPart,
      id: String(persistedPart.id || ''),
      sourceQuestionId,
      questionGroupId: group.questionGroupId || sourceQuestionId,
      questionPartId,
      sourceKind: 'past-paper',
      sourceRef: { ...group.sourceRef, questionPartId, page: currentPart.sourcePage || group.sourceRef?.pageStart },
      answerRef: { ...group.answerRef, questionPartId, page: currentPart.answerSourcePage || group.answerRef?.pageStart },
      sourceContentComplete: group.sourceContent.complete === true,
      sourceContentAvailable: group.sourceContent.fileComplete === true || group.sourceContent.complete === true,
      sourceContentReasons: group.sourceContent.reasons || [],
      sourceSemanticStatus: group.sourceContent.semanticStatus || 'unreviewed',
      sourcePages: group.sourceContent.pages || [],
      sourceAssetUrls: group.sourceContent.assetUrls || group.sourceRef?.assetUrls || [],
      reviewStatus: group.reviewStatus,
      studyOnly: group.studyOnly === true,
      practiceAvailable: true,
      deterministicScoringAvailable: Boolean(currentPart.answerKey),
      aiAssistedMarkingAvailable: Boolean(
        currentPart.aiAssistedMarkingAvailable
        && currentPart.markingProvenance
        && currentPart.sourceBindingProvenance,
      ),
      markPoints: currentPart.markSchemePoints || [],
      sourceAuthority: 'server-syllabus',
    }))
  }

  if (reboundParts.some((part) => !part.id)) return null
  const paperById = new Map()
  for (const part of reboundParts) {
    const source = part.sourceRef || {}
    if (source.paperId && !paperById.has(source.paperId)) {
      paperById.set(source.paperId, {
        id: source.paperId,
        file: source.paper,
        year: source.year,
        season: source.season,
        paperNumber: source.component,
        questionUrl: source.localUrl,
        markSchemeUrl: part.answerRef?.localUrl,
      })
    }
  }
  const hasStudyOnlyPart = reboundParts.some((part) => part.studyOnly)
  const selectedTopicNames = config.syllabus.topics
    .filter((topic) => topicIds.includes(topic.id))
    .map((topic) => topic.name)
  const topicLabel = selectedTopicNames.join(' + ') || 'Selected syllabus topic'
  return Object.freeze(withPracticePresentation({
    id: String(unit.id || ''),
    type: 'topic',
    agentGenerated: true,
    sourceAuthority: 'server-syllabus',
    routeId: route.routeId,
    qualification: route.qualification,
    subject: route.subject,
    subjectCode: config.subjectCode,
    subjectId: route.subjectId,
    qualificationId: `cambridge-${config.subjectCode}`,
    stage: route.stage,
    knowledgeGroupId: topicIds[0],
    topicId: topicIds[0],
    syllabusTopic: topicIds.join(','),
    topic: topicLabel,
    title: `${route.stage} ${route.subject} · ${topicLabel}`,
    paperComponent: selectedComponents,
    sourcePaper: [...paperById.values()].map((paper) => paper.file).filter(Boolean).join(', '),
    difficulty: 'Past paper',
    priority: 'Syllabus set',
    inventoryStatus: hasStudyOnlyPart ? 'study-source-inventory' : 'verified-source-inventory',
    parts: Object.freeze(reboundParts),
    questionGroupCount: new Set(reboundParts.map((part) => part.sourceQuestionId)).size,
    referencePapers: Object.freeze([...paperById.values()]),
    practiceMode: hasStudyOnlyPart ? 'study-only' : 'verified',
    sourceGateVersion: 'server-syllabus-catalog-v2',
    sourceGateStatus: 'current',
  }))
}

export function buildSyllabusPracticeSet({
  routeId,
  syllabusTopicIds = [],
  questionCount = 10,
  components,
  excludeAttempted = true,
  attemptedQuestionIds = [],
  sourceQuestionIds = [],
  seed = Date.now(),
  questionBank = unifiedQuestionBank,
  includeStudyOnly = false,
} = {}) {
  const config = syllabusConfig(routeId)
  if (!config) {
    const error = new Error('This syllabus practice-set route is not configured yet.')
    error.code = 'syllabus_route_not_configured'
    error.statusCode = 409
    throw error
  }
  const topicIds = [...new Set(syllabusTopicIds
    .flatMap((value) => syllabusTopicScopeIdsForRoute(routeId, String(value || '').trim()))
    .filter(Boolean))]
  const validTopicIds = new Set(config.syllabus.topics.map((topic) => topic.id))
  if (!topicIds.length || topicIds.some((topicId) => !validTopicIds.has(topicId))) {
    const error = new Error('Select one or more official syllabus topic IDs.')
    error.code = 'invalid_syllabus_topic'
    error.statusCode = 400
    throw error
  }
  const requestedCount = Math.min(15, Math.max(1, Number(questionCount) || 10))
  const requestedComponents = components === undefined
    ? [...config.components]
    : [...new Set((Array.isArray(components) ? components : [components]).map((value) => Number(value)))]
  const invalidComponents = requestedComponents.filter((value) => !config.components.includes(value))
  if (!requestedComponents.length || invalidComponents.length) {
    const error = new Error(config.syllabus.routeId === CAMBRIDGE_9702_AS_SYLLABUS.routeId
      ? 'Topic Drill uses AS Paper 1 and Paper 2 only. AS Paper 3 is the separate practical-skills track.'
      : 'This Topic Drill batch currently contains only the reviewed theory component.')
    error.code = 'invalid_paper_component'
    error.statusCode = 400
    throw error
  }
  const selectedComponents = requestedComponents
  const records = effectiveQuestionRecords(questionBank, config).filter((record) => selectedComponents.includes(record.paperComponent))
  const attemptedIds = new Set(attemptedQuestionIds.map((value) => String(value || '').trim()).filter(Boolean))
  const explicitSourceQuestionIds = [...new Set(sourceQuestionIds.map((value) => String(value || '').trim()).filter(Boolean))]
  if (explicitSourceQuestionIds.length && explicitSourceQuestionIds.length !== sourceQuestionIds.length) {
    const error = new Error('Selected source questions must be unique.')
    error.code = 'invalid_source_question_selection'
    error.statusCode = 400
    throw error
  }
  const availableRecords = records.filter((record) => (
    (record.eligible || (includeStudyOnly && record.studyEligible))
    && topicIds.some((topicId) => record.mapping.topicIds?.includes(topicId))
  ))
  const effectiveRequestedCount = explicitSourceQuestionIds.length || requestedCount
  const selected = explicitSourceQuestionIds.length
    ? selectExplicitQuestions(records, explicitSourceQuestionIds, topicIds, selectedComponents, includeStudyOnly)
    : selectBalancedQuestions(
        records,
        topicIds,
        requestedCount,
        excludeAttempted ? attemptedIds : new Set(),
        seed,
        selectedComponents,
        includeStudyOnly,
      )
  if (!selected.length) {
    const error = new Error(`No source-backed study questions are available for the selected syllabus topic${topicIds.length === 1 ? '' : 's'}.`)
    error.code = 'insufficient_verified_questions'
    error.statusCode = 409
    error.availableCount = 0
    error.indexedCount = records.filter((record) => topicIds.some((topicId) => record.mapping.topicIds?.includes(topicId))).length
    throw error
  }
  const metrics = questionGroupSetMetrics(selected.map(publicQuestionGroup))
  return {
    schemaVersion: 'syllabus-practice-set-v1',
    routeId,
    stage: config.stage,
    subjectCode: config.subjectCode,
    syllabusVersion: config.syllabus.syllabusVersion,
    syllabusTopicIds: topicIds,
    syllabusTopics: config.syllabus.topics
      .filter((topic) => topicIds.includes(topic.id))
      .map(({ id, code, name, order }) => ({ id, code, name, order })),
    components: selectedComponents,
    requestedCount: effectiveRequestedCount,
    availableCount: availableRecords.length,
    sourceQuestionCount: metrics.sourceQuestionCount,
    answerPartCount: metrics.answerPartCount,
    paperCount: metrics.paperCount,
    totalMarks: metrics.totalMarks,
    autoScoredPartCount: metrics.autoScoredPartCount,
    selfMarkPartCount: metrics.selfMarkPartCount,
    semanticReviewedPartCount: metrics.semanticReviewedPartCount,
    questionCount: metrics.sourceQuestionCount,
    practiceMode: selected.some((record) => record.studyOnly) ? 'study-only' : 'verified',
    partial: selected.length < effectiveRequestedCount,
    seed: Number(seed) >>> 0,
    sourceQuestionIds: selected.map((record) => record.sourceQuestionId),
    questionGroups: selected.map(publicQuestionGroup),
  }
}

export function ensureSyllabusTables(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS syllabus_topics (
      id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL,
      syllabus_version TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      official_page INTEGER,
      official_url TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS syllabus_points (
      id TEXT PRIMARY KEY,
      topic_id TEXT NOT NULL REFERENCES syllabus_topics(id) ON DELETE CASCADE,
      section_code TEXT NOT NULL,
      outcome_number INTEGER NOT NULL,
      official_text TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS question_groups (
      id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      subject_code TEXT NOT NULL,
      paper_component INTEGER,
      question_paper_id TEXT,
      mark_scheme_id TEXT,
      question_pages_json TEXT NOT NULL,
      mark_scheme_pages_json TEXT NOT NULL,
      total_marks INTEGER NOT NULL,
      source_content_complete INTEGER NOT NULL,
      study_eligible INTEGER NOT NULL DEFAULT 0,
      verification_status TEXT NOT NULL,
      source_json TEXT NOT NULL,
      answer_json TEXT NOT NULL,
      parts_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_question_groups_syllabus_gate
      ON question_groups(route_id, paper_component, source_content_complete, verification_status);
    CREATE TABLE IF NOT EXISTS question_syllabus_mapping (
      question_group_id TEXT PRIMARY KEY REFERENCES question_groups(id) ON DELETE CASCADE,
      primary_topic_id TEXT REFERENCES syllabus_topics(id),
      secondary_topic_ids_json TEXT NOT NULL,
      syllabus_point_ids_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      mapping_method TEXT NOT NULL,
      review_status TEXT NOT NULL,
      reviewed_by TEXT,
      reviewed_at TEXT,
      evidence_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_question_syllabus_mapping_gate
      ON question_syllabus_mapping(primary_topic_id, review_status);
    CREATE TABLE IF NOT EXISTS syllabus_route_topics (
      route_id TEXT NOT NULL,
      id TEXT NOT NULL,
      syllabus_version TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      official_page INTEGER,
      official_url TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (route_id, id)
    );
    CREATE TABLE IF NOT EXISTS syllabus_route_points (
      route_id TEXT NOT NULL,
      id TEXT NOT NULL,
      topic_id TEXT NOT NULL,
      section_code TEXT NOT NULL,
      outcome_number INTEGER NOT NULL,
      official_text TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (route_id, id),
      FOREIGN KEY (route_id, topic_id) REFERENCES syllabus_route_topics(route_id, id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS route_question_groups (
      route_id TEXT NOT NULL,
      id TEXT NOT NULL,
      stage TEXT NOT NULL,
      subject_code TEXT NOT NULL,
      paper_component INTEGER,
      question_paper_id TEXT,
      mark_scheme_id TEXT,
      question_pages_json TEXT NOT NULL,
      mark_scheme_pages_json TEXT NOT NULL,
      total_marks INTEGER NOT NULL,
      source_content_complete INTEGER NOT NULL,
      study_eligible INTEGER NOT NULL DEFAULT 0,
      verification_status TEXT NOT NULL,
      source_json TEXT NOT NULL,
      answer_json TEXT NOT NULL,
      parts_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (route_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_route_question_groups_syllabus_gate
      ON route_question_groups(route_id, paper_component, source_content_complete, verification_status);
    CREATE TABLE IF NOT EXISTS route_question_syllabus_mapping (
      route_id TEXT NOT NULL,
      question_group_id TEXT NOT NULL,
      primary_topic_id TEXT,
      secondary_topic_ids_json TEXT NOT NULL,
      syllabus_point_ids_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      mapping_method TEXT NOT NULL,
      review_status TEXT NOT NULL,
      reviewed_by TEXT,
      reviewed_at TEXT,
      evidence_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (route_id, question_group_id),
      FOREIGN KEY (route_id, question_group_id) REFERENCES route_question_groups(route_id, id) ON DELETE CASCADE,
      FOREIGN KEY (route_id, primary_topic_id) REFERENCES syllabus_route_topics(route_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_route_question_syllabus_mapping_gate
      ON route_question_syllabus_mapping(route_id, primary_topic_id, review_status);
  `)
  const groupColumns = database.prepare('PRAGMA table_info(question_groups)').all().map((column) => column.name)
  if (!groupColumns.includes('study_eligible')) {
    database.exec('ALTER TABLE question_groups ADD COLUMN study_eligible INTEGER NOT NULL DEFAULT 0')
  }
}

export function seedSyllabusTables(database, questionBank = []) {
  ensureSyllabusTables(database)
  const now = new Date().toISOString()
  const insertTopic = database.prepare(`
    INSERT INTO syllabus_route_topics (route_id, id, syllabus_version, code, name, order_index, official_page, official_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(route_id, id) DO UPDATE SET
      syllabus_version = excluded.syllabus_version,
      code = excluded.code,
      name = excluded.name,
      order_index = excluded.order_index,
      official_page = excluded.official_page,
      official_url = excluded.official_url,
      updated_at = excluded.updated_at
  `)
  const insertPoint = database.prepare(`
    INSERT INTO syllabus_route_points (route_id, id, topic_id, section_code, outcome_number, official_text, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(route_id, id) DO UPDATE SET
      topic_id = excluded.topic_id,
      section_code = excluded.section_code,
      outcome_number = excluded.outcome_number,
      official_text = excluded.official_text,
      updated_at = excluded.updated_at
  `)
  for (const config of Object.values(SYLLABUS_CONFIGS)) {
    for (const topic of config.syllabus.topics) {
      insertTopic.run(config.syllabus.routeId, topic.id, topic.syllabusVersion, topic.code, topic.name, topic.order, topic.officialPage, config.syllabus.officialUrl, now)
      for (const syllabusPoint of topic.points) {
        insertPoint.run(config.syllabus.routeId, syllabusPoint.id, topic.id, syllabusPoint.sectionCode, syllabusPoint.outcomeNumber, syllabusPoint.officialText, now)
      }
    }
  }

  const insertQuestion = database.prepare(`
    INSERT INTO route_question_groups (
      route_id, id, stage, subject_code, paper_component, question_paper_id, mark_scheme_id,
      question_pages_json, mark_scheme_pages_json, total_marks, source_content_complete, study_eligible,
      verification_status, source_json, answer_json, parts_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(route_id, id) DO UPDATE SET
      stage = excluded.stage,
      subject_code = excluded.subject_code,
      paper_component = excluded.paper_component,
      question_paper_id = excluded.question_paper_id,
      mark_scheme_id = excluded.mark_scheme_id,
      question_pages_json = excluded.question_pages_json,
      mark_scheme_pages_json = excluded.mark_scheme_pages_json,
      total_marks = excluded.total_marks,
      source_content_complete = excluded.source_content_complete,
      study_eligible = excluded.study_eligible,
      verification_status = excluded.verification_status,
      source_json = excluded.source_json,
      answer_json = excluded.answer_json,
      parts_json = excluded.parts_json,
      updated_at = excluded.updated_at
  `)
  const insertMapping = database.prepare(`
    INSERT INTO route_question_syllabus_mapping (
      route_id, question_group_id, primary_topic_id, secondary_topic_ids_json, syllabus_point_ids_json,
      confidence, mapping_method, review_status, reviewed_by, reviewed_at, evidence_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(route_id, question_group_id) DO UPDATE SET
      primary_topic_id = excluded.primary_topic_id,
      secondary_topic_ids_json = excluded.secondary_topic_ids_json,
      syllabus_point_ids_json = excluded.syllabus_point_ids_json,
      confidence = excluded.confidence,
      mapping_method = excluded.mapping_method,
      review_status = excluded.review_status,
      reviewed_by = excluded.reviewed_by,
      reviewed_at = excluded.reviewed_at,
      evidence_json = excluded.evidence_json,
      updated_at = excluded.updated_at
  `)
  const activeAiVerifiedQuestionGroupIds = new Set()
  for (const config of Object.values(SYLLABUS_CONFIGS)) {
    const records = effectiveQuestionRecords(questionBank, config)
    for (const record of records) {
    const question = record.question
    const answerRef = question.answerRef || {}
    const mapping = record.mapping
    if (record.verificationStatus === 'ai-verified') activeAiVerifiedQuestionGroupIds.add(`${record.routeId}\u0000${record.questionGroupId}`)
    insertQuestion.run(
      record.routeId,
      record.questionGroupId,
      record.stage,
      record.subjectCode,
      record.paperComponent,
      question.sourceRef?.paperId || null,
      answerRef.documentId || null,
      JSON.stringify(question.sourceContent?.sourcePages || []),
      JSON.stringify(answerRef.pageStart ? [answerRef.pageStart] : []),
      Number(question.totalMarks || question.marks || 0),
      record.sourceContentComplete ? 1 : 0,
      record.studyEligible ? 1 : 0,
      record.verificationStatus,
      JSON.stringify(question.sourceRef || {}),
      JSON.stringify(answerRef),
      JSON.stringify(question.parts || []),
      now,
    )
    insertMapping.run(
      record.routeId,
      record.questionGroupId,
      mapping.primaryTopicId,
      JSON.stringify(mapping.secondaryTopicIds || []),
      JSON.stringify(mapping.syllabusPointIds || []),
      Number(mapping.confidence || 0),
      mapping.mappingMethod,
      mapping.reviewStatus,
      mapping.reviewedBy || null,
      mapping.reviewedAt || null,
      JSON.stringify({ reason: mapping.reviewReason || null, officialUrl: config.syllabus.officialUrl }),
      now,
    )
    }
  }

  // Coordinate-only records are loaded only when their artifact and both
  // local PDFs still validate. Remove an earlier runtime copy when that guard
  // stops returning it, while leaving reviewed and machine-indexed rows intact.
  const existingAiVerified = database.prepare("SELECT route_id AS routeId, id FROM route_question_groups WHERE verification_status = 'ai-verified'").all()
  const deleteStaleAiVerified = database.prepare("DELETE FROM route_question_groups WHERE route_id = ? AND id = ? AND verification_status = 'ai-verified'")
  for (const row of existingAiVerified) {
    if (!activeAiVerifiedQuestionGroupIds.has(`${row.routeId}\u0000${row.id}`)) deleteStaleAiVerified.run(row.routeId, row.id)
  }
}

export function syllabusDatabaseInventory(database, routeId, { includeStudyOnly = true } = {}) {
  const config = syllabusConfig(routeId)
  const components = config?.components?.length ? config.components : [1, 2]
  const componentPlaceholders = components.map(() => '?').join(', ')
  const topics = database.prepare(`
    SELECT
      topics.id,
      topics.route_id AS routeId,
      topics.syllabus_version AS syllabusVersion,
      topics.code,
      topics.name,
      topics.order_index AS topicOrder,
      topics.official_page AS officialPage,
      COUNT(DISTINCT CASE
        WHEN groups.source_content_complete = 1
          AND groups.verification_status = 'reviewed'
          AND mapping.review_status = 'reviewed'
        THEN groups.id END
      ) AS verifiedQuestionCount,
      COUNT(DISTINCT CASE
        WHEN groups.study_eligible = 1
        THEN groups.id END
      ) AS studyQuestionCount,
      COUNT(DISTINCT groups.id) AS indexedQuestionCount,
      COUNT(DISTINCT CASE
        WHEN NOT (
          groups.source_content_complete = 1
          AND groups.verification_status = 'reviewed'
          AND mapping.review_status = 'reviewed'
        )
        THEN groups.id END
      ) AS pendingReviewCount
    FROM syllabus_route_topics AS topics
      LEFT JOIN route_question_syllabus_mapping AS mapping
        ON mapping.route_id = topics.route_id
        AND (
          mapping.primary_topic_id = topics.id
          OR EXISTS (
          SELECT 1
          FROM json_each(mapping.secondary_topic_ids_json)
          WHERE json_each.value = topics.id
          )
        )
    LEFT JOIN route_question_groups AS groups
      ON groups.route_id = mapping.route_id
      AND groups.id = mapping.question_group_id
      AND groups.paper_component IN (${componentPlaceholders})
    WHERE topics.route_id = ?
    GROUP BY topics.id
    ORDER BY topics.order_index ASC
  `).all(...components, routeId)
  return topics.map((topic) => {
    const verifiedQuestionCount = Number(topic.verifiedQuestionCount) || 0
    const studyQuestionCount = includeStudyOnly ? Number(topic.studyQuestionCount) || 0 : 0
    const availableQuestionCount = verifiedQuestionCount + studyQuestionCount
    const indexedQuestionCount = Number(topic.indexedQuestionCount) || 0
    const pendingReviewCount = Number(topic.pendingReviewCount) || 0
    const ready = verifiedQuestionCount >= 10
    return {
      ...topic,
      verifiedQuestionCount,
      studyQuestionCount,
      availableQuestionCount,
      indexedQuestionCount,
      pendingReviewCount,
      availableSetSizes: SET_SIZES.filter((size) => size <= availableQuestionCount),
      ready,
      studyReady: availableQuestionCount > 0,
      ctaPolicy: ready ? 'start' : availableQuestionCount > 0 ? 'start-study' : 'hidden',
      sourceGap: ready
        ? null
        : availableQuestionCount > 0
          ? `Available for study: ${availableQuestionCount} complete source question${availableQuestionCount === 1 ? '' : 's'}; ${studyQuestionCount} stay outside formal mastery while source review is pending.`
          : `Official QP/MS candidates indexed: ${indexedQuestionCount}; semantic-reviewed and mapped: ${verifiedQuestionCount}. ${pendingReviewCount} item(s) remain in review.`,
    }
  })
}
