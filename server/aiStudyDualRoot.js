import { isDeepStrictEqual } from 'node:util'

import { courseRoutes, routeById, routesForSubject } from '../src/data/routeRegistry.js'
import { aiStudyObjectiveKey } from './aiStudyObjectiveKeys.js'

const INVALID = 'AI_STUDY_PROMOTION_INVALID'
const REQUIRED = 'AI_STUDY_PROMOTION_REQUIRED'
const BLOCKED = 'AI_STUDY_CANDIDATE_BLOCKED'
const SHA256 = /^[a-f0-9]{64}$/i

function promotionError(code = INVALID) {
  return Object.assign(new Error('The AI study candidate is not authorized for this catalog.'), {
    code,
    statusCode: 503,
  })
}

function candidateErrorCode(error) {
  return [REQUIRED, INVALID, BLOCKED].includes(error?.code) ? error.code : INVALID
}

function nonemptyText(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}

function candidateScope(routeIds) {
  if (!Array.isArray(routeIds) || routeIds.length === 0) return null
  const ids = new Set()
  const subjects = new Set()
  for (const id of routeIds) {
    const route = nonemptyText(id) ? routeById(id) : null
    if (!route || !nonemptyText(route.subjectCode) || ids.has(id)) return null
    ids.add(id)
    subjects.add(route.subjectCode)
  }
  return { ids, subjects }
}

function isAffectedRequest({ routeId, subject }, scope) {
  const routeSpecified = routeId !== ''
  const subjectSpecified = subject !== ''
  if (!routeSpecified && !subjectSpecified) return false
  if (!scope) return true

  if (routeSpecified) {
    if (!nonemptyText(routeId) || !routeById(routeId)) return true
    if (scope.ids.has(routeId)) return true
  }
  if (subjectSpecified) {
    if (!nonemptyText(subject)) return true
    const normalized = subject.toLowerCase()
    const routes = new Set([
      ...routesForSubject(subject),
      ...courseRoutes.filter((route) => [route.subjectCode, route.subjectId, route.subject]
        .some((value) => typeof value === 'string' && value.toLowerCase() === normalized)),
    ])
    if (!routes.size) return true
    if ([...routes].some((route) => scope.subjects.has(route.subjectCode))) return true
  }
  return false
}

function sameGroup(left, right) {
  return isDeepStrictEqual(left, right) && JSON.stringify(left) === JSON.stringify(right)
    && (aiStudyObjectiveKey(left)?.fingerprint || null) === (aiStudyObjectiveKey(right)?.fingerprint || null)
}

function sameDocument(left, right) {
  return typeof left?.sha256 === 'string' && SHA256.test(left.sha256)
    && left.sha256.toLowerCase() === right.sha256.toLowerCase()
    && left.bytes === right.bytes
}

function recordsByKey(records, keyFor) {
  const index = new Map()
  for (const record of records) {
    const key = keyFor(record)
    if (key === null) continue
    const existing = index.get(key) || []
    existing.push(record)
    index.set(key, existing)
  }
  return index
}

function groupKey(group) {
  return nonemptyText(group?.routeId) && nonemptyText(group?.sourceQuestionId)
    ? JSON.stringify([group.routeId, group.sourceQuestionId]) : null
}

function documentKey(document) {
  return nonemptyText(document?.subject) && nonemptyText(document?.file)
    ? JSON.stringify([document.subject, document.file]) : null
}

function validateCandidateGroup(group, scope) {
  const route = nonemptyText(group?.routeId) ? routeById(group.routeId) : null
  if (!group || typeof group !== 'object' || Array.isArray(group)
    || !route || !scope.ids.has(route.routeId) || !groupKey(group)) throw promotionError()
  for (const field of ['subjectCode', 'subjectId', 'subject']) {
    if (group[field] !== undefined && (typeof group[field] !== 'string'
      || group[field].trim().toLowerCase() !== route[field].toLowerCase())) throw promotionError()
  }
}

function validateCandidateDocument(document, scope) {
  if (!document || typeof document !== 'object' || Array.isArray(document)
    || !documentKey(document) || !scope.subjects.has(document.subject)
    || document.file === '.' || document.file === '..' || /[/\\]/.test(document.file)
    || typeof document.sha256 !== 'string' || !SHA256.test(document.sha256)
    || !Number.isSafeInteger(document.bytes) || document.bytes <= 0) throw promotionError()
}

function appendCandidate(legacy, candidate, scope, protectedByKey) {
  if (!candidate || typeof candidate !== 'object') throw promotionError()
  if ((candidate.complete !== undefined && candidate.complete !== true) || candidate.candidateErrorCode != null) {
    throw promotionError(candidateErrorCode({ code: candidate.candidateErrorCode }))
  }
  if (!Array.isArray(candidate.groups) || !candidate.groups.length
    || !Array.isArray(candidate.documents) || !candidate.documents.length) throw promotionError()

  const groups = [...legacy.groups]
  const documents = [...legacy.documents]
  const legacyGroups = recordsByKey(legacy.groups, groupKey)
  const legacyDocuments = recordsByKey(legacy.documents, documentKey)
  const candidateGroups = new Set()
  const candidateDocuments = new Set()

  for (const group of candidate.groups) {
    validateCandidateGroup(group, scope)
    const key = groupKey(group)
    if (candidateGroups.has(key)) throw promotionError()
    candidateGroups.add(key)
    const existing = legacyGroups.get(key) || []
    const protectedRecords = protectedByKey.get(key) || []
    if ([...existing, ...protectedRecords].some((record) => !sameGroup(record, group))) throw promotionError()
    if (!existing.length && !protectedRecords.length) groups.push(group)
  }

  for (const document of candidate.documents) {
    validateCandidateDocument(document, scope)
    const key = documentKey(document)
    if (candidateDocuments.has(key)) throw promotionError()
    candidateDocuments.add(key)
    const existing = legacyDocuments.get(key) || []
    if (existing.some((record) => !sameDocument(record, document))) throw promotionError()
    if (!existing.length) documents.push(document)
  }
  return { groups, documents }
}

export function createAiStudyDualRootLoader({ legacyLoader, candidateLoader = null, candidateRouteIds = [], protectedGroups = [] } = {}) {
  if (typeof legacyLoader !== 'function') throw new TypeError('A legacy AI study loader is required.')
  if (!Array.isArray(protectedGroups)) throw new TypeError('Protected study groups must be an array.')
  const scope = candidateScope(candidateRouteIds)
  const protectedByKey = recordsByKey(protectedGroups, groupKey)

  return function load({ routeId = '', subject = '' } = {}) {
    // Preserve legacy caching; the candidate loader must revalidate on refresh.
    const legacy = legacyLoader()
    if (!legacy || !Array.isArray(legacy.groups) || !Array.isArray(legacy.documents)) {
      throw new TypeError('The legacy AI study snapshot is invalid.')
    }
    if (candidateLoader === null) {
      return { groups: [...legacy.groups], documents: [...legacy.documents], complete: true, candidateErrorCode: null }
    }

    try {
      if (!scope || typeof candidateLoader !== 'function') throw promotionError()
      const merged = appendCandidate(legacy, candidateLoader({ refresh: true }), scope, protectedByKey)
      return { ...merged, complete: true, candidateErrorCode: null }
    } catch (error) {
      const code = candidateErrorCode(error)
      if (isAffectedRequest({ routeId, subject }, scope)) throw promotionError(code)
      return { groups: [...legacy.groups], documents: [...legacy.documents], complete: false, candidateErrorCode: code }
    }
  }
}
