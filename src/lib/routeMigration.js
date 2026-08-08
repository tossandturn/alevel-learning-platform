export const LEGACY_UNSCOPED_ROUTE_ID = 'legacy-unscoped'
export const ROUTE_MIGRATION_VERSION = 1

const ACADEMIC_STAGES = new Map([
  ['igcse', 'IGCSE'],
  ['as', 'AS'],
  ['as level', 'AS'],
  ['a2', 'A2'],
  ['year 2', 'A2'],
  ['a level year 2', 'A2'],
  ['admissions', 'Admissions'],
  ['competition', 'Competition'],
])

export function normalizeAcademicStage(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return ACADEMIC_STAGES.get(normalized) || null
}

function normalized(value) {
  return String(value || '').trim().toLowerCase()
}

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value]
}

function explicitRouteIds(value) {
  return [
    value?.routeId,
    value?.contentScope?.routeId,
    value?.scoreResult?.routeId,
    value?.sourcePaper?.routeId,
    value?.sourceRef?.routeId,
    ...asArray(value?.questionIds).flatMap((question) => typeof question === 'object' ? [question.routeId] : []),
    ...asArray(value?.questions).map((question) => question?.routeId),
    ...asArray(value?.parts).map((part) => part?.routeId),
    ...asArray(value?.sourcePaper?.routeIds),
    ...asArray(value?.sourceRef?.routeIds),
  ].filter((routeId) => typeof routeId === 'string' && routeId.trim() && routeId !== LEGACY_UNSCOPED_ROUTE_ID).map((routeId) => routeId.trim())
}

function routeIdOf(route) {
  return String(route?.routeId || route?.id || '').trim()
}

function metadataFor(value, unit) {
  const rawStage = value?.courseStage || value?.academicStage || (value?.stage === 'result' ? null : value?.stage) || unit?.courseStage || unit?.academicStage || (unit?.stage === 'result' ? null : unit?.stage)
  const syllabusTopics = [
    value?.syllabusTopic,
    value?.contentScope?.syllabusTopic,
    value?.syllabusTopic ? value?.topic : null,
    unit?.syllabusTopic,
    unit?.syllabusTopic ? unit?.topic : null,
  ].filter(Boolean)
  return {
    stage: normalizeAcademicStage(rawStage),
    qualification: value?.qualification || value?.contentScope?.qualification || unit?.qualification || null,
    subject: value?.subject || value?.contentScope?.subject || unit?.subject || null,
    subjectId: value?.subjectId || value?.contentScope?.subjectId || unit?.subjectId || null,
    paperComponent: value?.paperComponent || value?.contentScope?.paperComponent || unit?.paperComponent || null,
    syllabusTopics,
  }
}

function qualificationFamily(value) {
  const key = normalized(value)
  if (key.includes('igcse')) return 'igcse'
  if (key.includes('a-level') || key.includes('a level') || key.includes('as & a')) return 'a-level'
  if (key.includes('admission') || key.includes('competition')) return 'admissions'
  return key
}

function subjectMatches(route, value) {
  if (!value) return true
  const evidence = normalized(value).replace(/[^a-z0-9]/g, '')
  const evidenceCode = evidence.match(/(?:0580|0606|0610|0625|9700|9701|9702|9708|9709|9231)/)?.[0]
  if (evidenceCode) return String(route.subjectCode || '').trim() === evidenceCode
  const candidates = [route.subject, route.subjectId, route.subjectCode]
    .filter(Boolean)
    .map((candidate) => normalized(candidate).replace(/[^a-z0-9]/g, ''))
  return candidates.some((candidate) => evidence === candidate || (candidate.length >= 4 && evidence.includes(candidate)) || (evidence.length >= 4 && candidate.includes(evidence)))
}

function componentKey(value) {
  return normalized(value).replace(/^paper\s*/, '').replace(/^p(?=\d)/, '')
}

function topicKeys(route) {
  return asArray(route.syllabusTopics || route.syllabusTopic || route.syllabus?.topics).flatMap((topic) => {
    if (topic && typeof topic === 'object') return [topic.id, topic.title, topic.name].filter(Boolean).map(normalized)
    return [normalized(topic)]
  })
}

function canonicalTopic(value) {
  return normalized(value).replace(/^\d+[\s._:-]*/, '')
}

function hasRouteMetadata(metadata) {
  return Boolean(metadata.stage || metadata.qualification || metadata.subject || metadata.subjectId || metadata.paperComponent || metadata.syllabusTopics?.length)
}

function routeMatchesMetadata(route, metadata) {
  if (metadata.stage && normalizeAcademicStage(route.stage) !== metadata.stage) return false
  if (metadata.qualification && qualificationFamily(route.qualification) !== qualificationFamily(metadata.qualification)) return false
  if (!subjectMatches(route, metadata.subject) || !subjectMatches(route, metadata.subjectId)) return false
  if (metadata.paperComponent) {
    const components = asArray(route.paperComponents || route.paperComponent).map(componentKey)
    const requested = asArray(metadata.paperComponent).map(componentKey)
    if (components.length && !requested.every((component) => components.includes(component))) return false
  }
  if (metadata.syllabusTopics?.length) {
    const topics = topicKeys(route)
    const requested = metadata.syllabusTopics.map(normalized)
    const matchesTopic = requested.some((topic) => topics.includes(topic) || topics.map(canonicalTopic).includes(canonicalTopic(topic)))
    if (topics.length && !matchesTopic) return false
  }
  return hasRouteMetadata(metadata)
}

/**
 * Resolves a route only from explicit IDs, a route-bound unit, or a unique
 * registry match. stageTags are deliberately ignored.
 */
export function resolveRouteBinding(value = {}, { unit = null, routes = [] } = {}) {
  const candidates = new Set([...explicitRouteIds(value), ...explicitRouteIds(unit)])
  if (candidates.size === 1) {
    const routeId = [...candidates][0]
    const registryRoute = routes.find((route) => routeIdOf(route) === routeId)
    const metadata = metadataFor(value, unit)
    if (!routes.length) {
      return { routeId: LEGACY_UNSCOPED_ROUTE_ID, stage: null, reason: 'route-registry-required' }
    }
    if (!registryRoute) {
      return { routeId: LEGACY_UNSCOPED_ROUTE_ID, stage: null, reason: 'unknown-explicit-route' }
    }
    const registryStage = normalizeAcademicStage(registryRoute?.stage)
    if (registryRoute && hasRouteMetadata(metadata) && !routeMatchesMetadata(registryRoute, metadata)) {
      return { routeId: LEGACY_UNSCOPED_ROUTE_ID, stage: null, reason: 'conflicting-route-metadata' }
    }
    return { routeId, stage: metadata.stage || registryStage, reason: 'explicit' }
  }
  if (candidates.size > 1) return { routeId: LEGACY_UNSCOPED_ROUTE_ID, stage: null, reason: 'ambiguous-route-ids' }

  const metadata = metadataFor(value, unit)
  const matches = routes.filter((route) => routeIdOf(route) && routeMatchesMetadata(route, metadata))
  if (matches.length === 1) {
    return {
      routeId: routeIdOf(matches[0]),
      stage: normalizeAcademicStage(matches[0].stage) || metadata.stage,
      reason: 'unique-metadata-match',
    }
  }
  return { routeId: LEGACY_UNSCOPED_ROUTE_ID, stage: null, reason: matches.length ? 'ambiguous-metadata' : 'insufficient-metadata' }
}

function migrateRecord(record, context) {
  if (!record || typeof record !== 'object') return record
  const unitId = record.unitId || record.contentUnitId || record.questionSetId
  const unit = context.unitsById.get(unitId)
  if (context.deferMissingUnits && unitId && !unit && explicitRouteIds(record).length === 0) {
    return {
      ...record,
      routeMigration: {
        version: ROUTE_MIGRATION_VERSION,
        status: 'deferred',
        reason: 'missing-unit-context',
      },
    }
  }
  const binding = resolveRouteBinding(record, { unit, routes: context.routes })
  const oldLifecycleStage = record.stage === 'result' ? 'result' : null
  const routeMigration = record.routeMigration?.version === ROUTE_MIGRATION_VERSION && record.routeId === binding.routeId
    ? record.routeMigration
    : {
        version: ROUTE_MIGRATION_VERSION,
        status: binding.routeId === LEGACY_UNSCOPED_ROUTE_ID ? 'legacy-unscoped' : 'scoped',
        reason: binding.reason,
      }
  const migrated = {
    ...record,
    routeId: binding.routeId,
    stage: binding.stage,
    routeMigration,
  }
  if (oldLifecycleStage && !migrated.attemptStatus) migrated.attemptStatus = oldLifecycleStage
  if (record.scoreResult) migrated.scoreResult = { ...record.scoreResult, routeId: binding.routeId, stage: binding.stage }
  return migrated
}

/**
 * Idempotently migrates persisted learning records without deleting history.
 * Ambiguous records are retained but excluded by route-bound aggregators.
 */
export function migrateLearningState(state, { units = [], routes = [], deferMissingUnits = false } = {}) {
  if (!state || typeof state !== 'object') return state
  const context = { unitsById: new Map(units.map((unit) => [unit.id, unit])), routes, deferMissingUnits }
  const migrateArray = (value) => Array.isArray(value) ? value.map((record) => migrateRecord(record, context)) : value
  return {
    ...state,
    attempts: migrateArray(state.attempts),
    masterySnapshots: migrateArray(state.masterySnapshots),
    completionRecords: migrateArray(state.completionRecords),
    recommendations: migrateArray(state.recommendations),
    routeMigration: {
      version: ROUTE_MIGRATION_VERSION,
      migratedAt: state.routeMigration?.version === ROUTE_MIGRATION_VERSION && state.routeMigration.migratedAt
        ? state.routeMigration.migratedAt
        : new Date().toISOString(),
    },
  }
}

/**
 * Migrates one localStorage document in place. Callers must supply the same
 * route registry and route-bound units used by the current application.
 */
export function migrateLocalStorageLearningState({
  storage = typeof window !== 'undefined' ? window.localStorage : null,
  storageKey = 'alevel-learning-platform-v2',
  units = [],
  routes = [],
} = {}) {
  if (!storage) return { changed: false, state: null, reason: 'storage-unavailable' }
  const raw = storage.getItem(storageKey)
  if (!raw) return { changed: false, state: null, reason: 'missing-state' }
  let state
  try {
    state = JSON.parse(raw)
  } catch {
    return { changed: false, state: null, reason: 'invalid-json' }
  }
  const migrated = migrateLearningState(state, { units, routes })
  const serialized = JSON.stringify(migrated)
  const changed = serialized !== raw
  if (changed) storage.setItem(storageKey, serialized)
  const records = ['attempts', 'masterySnapshots', 'completionRecords', 'recommendations'].flatMap((key) => migrated[key] || [])
  return {
    changed,
    state: migrated,
    scoped: records.filter((record) => record?.routeId && record.routeId !== LEGACY_UNSCOPED_ROUTE_ID).length,
    legacyUnscoped: records.filter((record) => record?.routeId === LEGACY_UNSCOPED_ROUTE_ID).length,
  }
}
