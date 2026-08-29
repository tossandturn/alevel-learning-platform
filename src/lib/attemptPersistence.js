function compactAttemptValue(value, key = '', depth = 0) {
  const normalizedKey = String(key || '').toLowerCase()
  if (normalizedKey && /(authorization|cookie|token|secret|password|user.?id|owner.?id|data.?url|preview.?url|blob|base64|ink.?data)/i.test(normalizedKey)) return undefined
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    const text = value.replaceAll(String.fromCharCode(0), '').trim()
    if (/data:[^,]*;base64,/i.test(text) || /^[A-Za-z0-9+/]{96,}={0,2}$/.test(text)) return undefined
    return text.slice(0, 20_000)
  }
  if (depth >= 7 || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    return value.slice(0, 160)
      .map((item) => compactAttemptValue(item, '', depth + 1))
      .filter((item) => item !== undefined)
  }
  const result = {}
  for (const [childKey, childValue] of Object.entries(value).slice(0, 160)) {
    const compact = compactAttemptValue(childValue, childKey, depth + 1)
    if (compact !== undefined) result[childKey] = compact
  }
  return result
}

export function sourceMarkingPartsForUnit(unit = {}) {
  return (unit.parts || []).flatMap((part) => {
    const provenance = part?.markingProvenance || part?.sourceBindingProvenance
    if (!provenance?.sourceQuestionId || !provenance?.questionPartId) return []
    return [{ provenance: { routeId: unit.routeId || part.routeId || provenance.routeId || '', ...provenance } }]
  })
}

export function projectServerResultAuthority(source = {}, fallbackStatus = 'marking-pending') {
  const hasClientReportedResult = (source.scoreResult && typeof source.scoreResult === 'object' && !Array.isArray(source.scoreResult))
    || (source.selfMarks && typeof source.selfMarks === 'object' && !Array.isArray(source.selfMarks))
    || (source.aiMarks && typeof source.aiMarks === 'object' && !Array.isArray(source.aiMarks))
  return {
    attemptStatus: hasClientReportedResult ? 'provisional-result' : String(source.attemptStatus || fallbackStatus),
    formalResult: false,
    ...(hasClientReportedResult ? { resultAuthority: 'client-reported' } : {}),
  }
}

export function applyServerResultAuthority(localAttempt = {}, persistedAttempt = null) {
  const source = persistedAttempt && typeof persistedAttempt === 'object' && !Array.isArray(persistedAttempt)
    ? persistedAttempt
    : localAttempt
  const projected = {
    ...localAttempt,
    ...projectServerResultAuthority(source, localAttempt.attemptStatus || 'marking-pending'),
  }
  if (projected.resultAuthority === 'client-reported') delete projected.learningSignal
  return projected
}

export function buildStudentAttemptPersistencePayload({ attempt, mode, routeId, stage, paperId = '', markingParts = [], allowDraft = false } = {}) {
  const attemptId = String(attempt?.id || attempt?.attemptId || '').trim()
  if (!attemptId) throw Object.assign(new Error('A valid attemptId is required before saving.'), { code: 'attempt_invalid' })
  const compactAttempt = compactAttemptValue({
    ...attempt,
    id: attemptId,
    attemptId,
    routeId,
    stage,
    paperId,
  })
  return {
    attemptId,
    mode: String(mode || '').trim(),
    routeId: String(routeId || '').trim(),
    stage: String(stage || '').trim(),
    paperId: String(paperId || '').trim(),
    submittedAt: allowDraft
      ? (Object.hasOwn(attempt || {}, 'submittedAt') ? attempt.submittedAt : null)
      : attempt?.submittedAt || new Date().toISOString(),
    markingParts: compactAttemptValue(markingParts) || [],
    attempt: compactAttempt,
  }
}

export class StudentAttemptPersistenceError extends Error {
  constructor(code, message, { retryable = false, loginRequired = false } = {}) {
    super(message)
    this.name = 'StudentAttemptPersistenceError'
    this.code = code
    this.retryable = retryable
    this.loginRequired = loginRequired
  }
}

export async function persistStudentAttempt({ token, attempt, mode, routeId, stage, paperId = '', markingParts = [], allowDraft = false, fetchImpl = fetch } = {}) {
  if (!token) throw new StudentAttemptPersistenceError('identity_required', 'Sign in to STEM before saving a submitted attempt.', { loginRequired: true })
  const body = buildStudentAttemptPersistencePayload({ attempt, mode, routeId, stage, paperId, markingParts, allowDraft })
  let response
  try {
    response = await fetchImpl('/api/stem/attempts', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new StudentAttemptPersistenceError('attempt_persistence_unavailable', 'The submitted attempt could not be saved on the server. Your work remains on this device.', { retryable: true })
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new StudentAttemptPersistenceError(
      payload.code || 'attempt_persistence_rejected',
      payload.error || 'The submitted attempt could not be saved on the server.',
      { loginRequired: response.status === 401 || response.status === 403, retryable: response.status >= 500 },
    )
  }
  if (!payload.attempt || String(payload.attempt.attemptId || '') !== body.attemptId) {
    throw new StudentAttemptPersistenceError('attempt_persistence_invalid', 'The server returned an invalid submitted attempt.', { retryable: true })
  }
  return payload
}

export async function readStudentAttempts({ token, fetchImpl = fetch } = {}) {
  if (!token) throw new StudentAttemptPersistenceError('identity_required', 'Sign in to STEM before loading attempt history.', { loginRequired: true })
  let response
  try {
    response = await fetchImpl('/api/stem/attempts', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new StudentAttemptPersistenceError('attempt_history_unavailable', 'Submitted attempt history is temporarily unavailable.', { retryable: true })
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new StudentAttemptPersistenceError(payload.code || 'attempt_history_rejected', payload.error || 'Submitted attempt history could not be loaded.', { loginRequired: response.status === 401 || response.status === 403, retryable: response.status >= 500 })
  if (!Array.isArray(payload.attempts)) throw new StudentAttemptPersistenceError('attempt_history_invalid', 'The server returned an invalid attempt history.', { retryable: true })
  return payload.attempts
}
