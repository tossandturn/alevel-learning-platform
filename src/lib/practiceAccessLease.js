export const MAX_PRACTICE_ACCESS_LEASE_MS = 30_000
const SAFE_ATTEMPT_ID = /^[A-Za-z0-9._:@-]{1,320}$/

function accessFailure() {
  return Object.assign(new Error('Account changed while protected practice content was loading.'), {
    code: 'account_changed',
    statusCode: 409,
  })
}

export function createPracticeAccessSnapshot(accessKey, generation = 0) {
  const key = String(accessKey || '')
  const normalizedGeneration = Number.isSafeInteger(generation) && generation >= 0 ? generation : 0
  const ownerId = key.split('\n', 1)[0] || 'guest'
  return Object.freeze({
    key,
    generation: normalizedGeneration,
    // Route-fragment caches need owner/token invalidation without retaining the
    // bearer itself as a long-lived cache key.
    cacheKey: `${ownerId}\n${normalizedGeneration}`,
  })
}

export function assertPracticeAccessCurrent(expected, current) {
  if (!expected || !current || expected.key !== current.key || expected.generation !== current.generation) throw accessFailure()
  return true
}

export function createProtectedContentLease(access, now = Date.now) {
  const validatedAt = Number(now())
  if (!access || !Number.isFinite(validatedAt)) throw Object.assign(new Error('Protected practice access lease is invalid.'), { code: 'protected_practice_invalid' })
  return Object.freeze({ key: access.key, generation: access.generation, validatedAt })
}

export function protectedUnitNeedsAccessRefresh(unit, lease, currentAccess, { now = Date.now, maxAgeMs = MAX_PRACTICE_ACCESS_LEASE_MS } = {}) {
  const protectedUnit = Array.isArray(unit?.parts)
    && unit.parts.some((part) => part?.sourceKind === 'past-paper')
    && ['server-syllabus', 'server-verified'].includes(unit?.sourceAuthority)
  if (!protectedUnit) return false
  const time = Number(now())
  const boundedAge = Math.min(MAX_PRACTICE_ACCESS_LEASE_MS, Math.max(0, Number(maxAgeMs) || 0))
  const age = time - Number(lease?.validatedAt)
  return !lease || !currentAccess || lease.key !== currentAccess.key || lease.generation !== currentAccess.generation
    || !Number.isFinite(time) || !Number.isFinite(age) || age < 0 || age > boundedAge
}

export function practiceDraftFromAttempt(attempt, { updatedAt = new Date().toISOString() } = {}) {
  const attemptId = String(attempt?.id || '')
  if (!SAFE_ATTEMPT_ID.test(attemptId) || !String(attempt?.unitId || '') || !String(attempt?.routeId || '')) {
    throw Object.assign(new Error('Practice draft binding is invalid.'), { code: 'practice_draft_binding_mismatch' })
  }
  return {
    attemptId,
    startedAt: String(attempt.startedAt || ''),
    routeId: String(attempt.routeId),
    stage: String(attempt.stage || ''),
    answers: attempt.answers && typeof attempt.answers === 'object' ? attempt.answers : {},
    working: attempt.working && typeof attempt.working === 'object' ? attempt.working : {},
    evidence: attempt.evidence && typeof attempt.evidence === 'object' ? attempt.evidence : {},
    elapsedSec: Math.max(0, Number(attempt.elapsedSec) || 0),
    activePartId: String(attempt.activePartId || ''),
    settings: attempt.settings && typeof attempt.settings === 'object' ? attempt.settings : {},
    updatedAt: String(updatedAt),
  }
}

export function resolveStoredPracticeAttemptId({ draft, navigationAttemptId = '', unit, knownBindings = [] } = {}) {
  const routeId = String(unit?.routeId || '')
  const draftRouteId = String(draft?.routeId || '')
  const stored = String(draft?.attemptId || '')
  const requested = String(navigationAttemptId || '')
  if (!draft || !String(unit?.id || '') || !routeId || draftRouteId !== routeId
      || stored && !SAFE_ATTEMPT_ID.test(stored) || requested && !SAFE_ATTEMPT_ID.test(requested)
      || stored && requested && stored !== requested) {
    throw Object.assign(new Error('The saved practice draft does not match this route or attempt binding.'), { code: 'practice_draft_binding_mismatch' })
  }
  const attemptId = stored || requested
  if (!attemptId) throw Object.assign(new Error('The saved practice draft is missing its attempt binding.'), { code: 'practice_draft_binding_missing' })
  const conflict = (Array.isArray(knownBindings) ? knownBindings : []).some((binding) => (
    String(binding?.attemptId || '') === attemptId && String(binding?.unitId || '') !== String(unit.id)
  ))
  if (conflict) throw Object.assign(new Error('The saved practice attempt is already bound to another question set.'), { code: 'practice_draft_binding_mismatch' })
  return attemptId
}

export async function resolveProtectedUnits(units, load, { expectedAccess, currentAccess } = {}) {
  if (!Array.isArray(units) || units.length > 100 || typeof load !== 'function' || typeof currentAccess !== 'function') {
    throw Object.assign(new Error('Protected practice recovery input is invalid.'), { code: 'protected_practice_invalid' })
  }
  assertPracticeAccessCurrent(expectedAccess, currentAccess())
  const entries = await Promise.all(units.map(async (unit) => {
    const id = String(unit?.id || '')
    if (!id) throw Object.assign(new Error('Protected practice recovery input is invalid.'), { code: 'protected_practice_invalid' })
    let rebound
    try {
      rebound = await load(unit)
    } catch (error) {
      assertPracticeAccessCurrent(expectedAccess, currentAccess())
      throw error
    }
    assertPracticeAccessCurrent(expectedAccess, currentAccess())
    if (!rebound || rebound.id !== id) throw Object.assign(new Error('Protected practice recovery response is invalid.'), { code: 'protected_practice_invalid' })
    return [id, rebound]
  }))
  assertPracticeAccessCurrent(expectedAccess, currentAccess())
  return new Map(entries)
}
