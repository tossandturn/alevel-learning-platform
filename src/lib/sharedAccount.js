import { enqueueSharedSync, listPendingSharedSync, markSharedSyncAttempt, markSharedSyncComplete } from './storage.js'
import { SHARED_IDENTITY_ORIGIN } from './identityOrigin.js'
import { applyProductContext, termIdsForStemContext } from './productContext.js'

const IDENTITY_ORIGIN = SHARED_IDENTITY_ORIGIN
const IDENTITY_TIMEOUT_MS = 12_000

export class SharedAccountError extends Error {
  constructor(code, message, { retryable = false, loginRequired = false, cause } = {}) {
    super(message)
    this.name = 'SharedAccountError'
    this.code = code
    this.retryable = retryable
    this.loginRequired = loginRequired
    this.cause = cause
  }
}

function responseError(response, payload, fallback) {
  if (response.status === 401 || response.status === 403) return new SharedAccountError('session_expired', 'Your STEM session has expired. Sign in here to continue.', { loginRequired: true })
  if (response.status === 429 || response.status >= 500) {
    const code = ['native_auth_not_configured', 'native_auth_bridge_rejected', 'native_auth_bridge_unavailable'].includes(payload?.code)
      ? payload.code
      : 'service_unavailable'
    return new SharedAccountError(code, payload?.error || fallback, { retryable: true })
  }
  return new SharedAccountError('request_rejected', payload?.error || fallback)
}

function isTransient(error) {
  return error instanceof TypeError || error?.name === 'AbortError' || error?.retryable
}

function parseIdentity(payload) {
  const token = String(payload?.accessToken || '')
  const expiresAt = String(payload?.expiresAt || '')
  const expiry = Date.parse(expiresAt)
  if (token.length < 32 || !Number.isFinite(expiry) || expiry <= Date.now() + 15_000) {
    throw new SharedAccountError('invalid_identity', 'The shared sign-in response was incomplete. Sign in again to continue.', { loginRequired: true })
  }
  const identityId = String(payload?.identity?.id || '').trim()
  if (!identityId) {
    throw new SharedAccountError('invalid_identity', 'The shared sign-in response did not identify a STEM account. Sign in again to continue.', { loginRequired: true })
  }
  return {
    token,
    expiresAt,
    identity: payload?.identity && typeof payload.identity === 'object'
      ? {
          id: identityId,
          username: String(payload.identity.username || ''),
          avatarDataUrl: String(payload.identity.avatarDataUrl || ''),
          roles: Array.isArray(payload.identity.roles) ? payload.identity.roles.map(String) : [],
        }
      : null,
  }
}

async function jsonFetch(url, options = {}, timeoutMs = IDENTITY_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const payload = await response.json().catch(() => ({}))
    return { response, payload }
  } catch (error) {
    if (error?.name === 'AbortError') throw new SharedAccountError('network_timeout', 'The STEM account service took too long to respond. Your work remains on this device.', { retryable: true, cause: error })
    throw new SharedAccountError('network_unavailable', 'The STEM account service is unavailable. Your work remains on this device.', { retryable: true, cause: error })
  } finally {
    window.clearTimeout(timer)
  }
}

function requestIdempotencyKey(options) {
  if (options.headers?.['Idempotency-Key'] || options.headers?.['idempotency-key']) return options.headers['Idempotency-Key'] || options.headers['idempotency-key']
  try {
    return JSON.parse(options.body || '{}').idempotencyKey || ''
  } catch {
    return ''
  }
}

function canQueue(resource, options) {
  return options.method === 'POST' && /^\/api\/stem\/assignments\/[^/]+\/submissions$/.test(resource) && Boolean(requestIdempotencyKey(options))
}

function queueSubmission(resource, options, error, userId = '') {
  if (!canQueue(resource, options) || options.skipSyncQueue) return null
  try {
    const payload = JSON.parse(options.body)
    return enqueueSharedSync({
      resource,
      method: 'POST',
      idempotencyKey: requestIdempotencyKey(options),
      attemptId: String(payload.attemptId || ''),
      body: {
        idempotencyKey: String(payload.idempotencyKey || ''),
        attemptId: String(payload.attemptId || ''),
        routeId: String(payload.routeId || ''),
        stage: String(payload.stage || ''),
        rawMarks: Number(payload.rawMarks),
        maxMarks: Number(payload.maxMarks),
        percentage: Number(payload.percentage),
        elapsedSeconds: Number(payload.elapsedSeconds) || 0,
        markingMode: String(payload.markingMode || 'assisted'),
        reviewRequired: Boolean(payload.reviewRequired),
      },
      error: error?.message || 'Network unavailable',
    }, { userId })
  } catch {
    return null
  }
}

async function hydrateNativeAccount(payload, { flushPending = true } = {}) {
  const identity = parseIdentity(payload)
  const workspace = {
    identity: identity.identity,
    classrooms: Array.isArray(payload?.classrooms) ? payload.classrooms : [],
    assignments: Array.isArray(payload?.assignments) ? payload.assignments : [],
  }
  const sync = flushPending
    ? await flushPendingSharedSync(identity.token, { userId: identity.identity.id })
    : { synced: [], pending: listPendingSharedSync({ userId: identity.identity.id }).length }
  return { ...identity, workspace, sync }
}

/** Restores the STEM-origin browser session. No browser request is sent to IELTSist. */
export async function requestSharedAccount({ flushPending = true } = {}) {
  const { response, payload } = await jsonFetch('/api/auth/status', { credentials: 'same-origin', redirect: 'error' })
  if (!response.ok) throw responseError(response, payload, 'Sign in to STEM to use shared classes and notes.')
  return hydrateNativeAccount(payload, { flushPending })
}

/** Reads public, non-secret native STEM account readiness before credentials are sent. */
export async function requestNativeAccountReadiness() {
  const { response, payload } = await jsonFetch('/api/auth/config', { credentials: 'same-origin', redirect: 'error' })
  if (!response.ok) throw responseError(response, payload, 'STEM account sign-in status is unavailable.')
  const readiness = payload?.readiness
  if (!readiness || typeof readiness !== 'object') {
    // Older deployments did not expose readiness. Preserve sign-in compatibility
    // while the server remains responsible for rejecting an invalid request.
    return { known: false, nativeLoginConfigured: true }
  }
  return {
    known: true,
    nativeLoginConfigured: Boolean(readiness.nativeLoginConfigured),
    nativeLoginReady: readiness.nativeLoginReady == null
      ? Boolean(readiness.nativeLoginConfigured)
      : Boolean(readiness.nativeLoginReady),
    bridgeStatus: String(readiness?.bridge?.status || ''),
  }
}

/**
 * STEM owns the browser form and cookie. Its server verifies the credentials
 * against the shared IELTSist account database over a signed local channel.
 */
export async function signInSharedAccount({ mode = 'login', username, password, flushPending = true } = {}) {
  const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login'
  const { response, payload } = await jsonFetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: String(username || '').trim(), password: String(password || '') }),
  })
  if (!response.ok) throw responseError(response, payload, 'STEM could not sign in with this shared account.')
  return hydrateNativeAccount(payload, { flushPending })
}

export async function signOutSharedAccount() {
  const { response, payload } = await jsonFetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
  if (!response.ok) throw responseError(response, payload, 'STEM could not sign out.')
  return payload
}

export async function sharedAccountRequest(token, resource, options = {}) {
  if (!token) throw new SharedAccountError('session_missing', 'Sign in to STEM to continue.', { loginRequired: true })
  const { storageUserId = '', ...requestOptions } = options
  const method = (requestOptions.method || 'GET').toUpperCase()
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
    ...(requestOptions.headers || {}),
  }
  const run = async () => {
    const { response, payload } = await jsonFetch(resource, { ...requestOptions, method, headers, credentials: 'same-origin' })
    if (!response.ok) throw responseError(response, payload, 'The shared workspace could not complete that action.')
    return payload
  }
  try {
    return await run()
  } catch (error) {
    // GETs are safe to retry. Submission POSTs rely on their server idempotency key.
    const safeRetry = method === 'GET' || Boolean(requestIdempotencyKey(requestOptions))
    if (isTransient(error) && safeRetry && !requestOptions.noRetry) {
      await new Promise((resolve) => window.setTimeout(resolve, 350))
      try {
        return await run()
      } catch (retryError) {
        const queued = queueSubmission(resource, requestOptions, retryError, storageUserId)
        if (queued) retryError.syncQueued = true
        throw retryError
      }
    }
    const queued = isTransient(error) ? queueSubmission(resource, requestOptions, error, storageUserId) : null
    if (queued) error.syncQueued = true
    throw error
  }
}

export async function requestSyllabusPracticeSet(token, selection) {
  const options = {
    method: 'POST',
    body: JSON.stringify(selection),
  }
  if (token) return sharedAccountRequest(token, '/api/stem/practice-sets', options)
  const { response, payload } = await jsonFetch('/api/stem/practice-sets', {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) throw responseError(response, payload, 'The syllabus practice set could not be generated.')
  return payload
}

export async function requestSyllabusPracticeRebind(token, unit) {
  const options = {
    method: 'POST',
    body: JSON.stringify({ unit }),
  }
  if (token) return sharedAccountRequest(token, '/api/stem/practice-sets/rebind', options)
  const { response, payload } = await jsonFetch('/api/stem/practice-sets/rebind', {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) throw responseError(response, payload, 'This saved syllabus set could not be verified against the current source catalog.')
  return payload
}

/** Replays only submission summaries. It never uploads answers, handwriting, or Coach messages. */
export async function flushPendingSharedSync(token, { userId = '' } = {}) {
  const pending = listPendingSharedSync({ userId })
  const synced = []
  for (const item of pending) {
    try {
      const result = await sharedAccountRequest(token, item.resource, {
        method: item.method,
        body: JSON.stringify(item.body),
        headers: { 'Idempotency-Key': item.idempotencyKey },
        skipSyncQueue: true,
        noRetry: true,
        storageUserId: userId,
      })
      markSharedSyncComplete(item.id, { attemptId: item.attemptId, eventId: result.eventId, occurredAt: result.occurredAt }, { userId })
      synced.push({ id: item.id, attemptId: item.attemptId, duplicate: Boolean(result.duplicate) })
    } catch (error) {
      markSharedSyncAttempt(item.id, error?.message || 'Retry failed', { userId })
      if (error?.loginRequired) break
    }
  }
  return { synced, pending: listPendingSharedSync({ userId }).length }
}

export async function requestSharedWorkspace(token) {
  const workspace = await sharedAccountRequest(token, '/api/stem/workspace')
  const accessibleClasses = (workspace.classrooms || []).filter((classroom) => ['owner', 'teacher', 'school'].includes(classroom.role))
  const summaries = await Promise.all(accessibleClasses.map(async (classroom) => {
    try {
      const result = await sharedAccountRequest(token, `/api/stem/classrooms/${encodeURIComponent(classroom.id)}/summary`)
      return [classroom.id, result.summary]
    } catch {
      return [classroom.id, null]
    }
  }))
  const submissions = await Promise.all(accessibleClasses.map(async (classroom) => {
    try {
      const result = await sharedAccountRequest(token, `/api/stem/classrooms/${encodeURIComponent(classroom.id)}/submissions`)
      return result.submissions || []
    } catch {
      return []
    }
  }))
  return { ...workspace, serverSummaries: Object.fromEntries(summaries.filter(([, summary]) => summary)), submissions: submissions.flat() }
}

const TRANSIENT_RETURN_PARAMS = new Set(['from', 'focus', 'returnto', 'return_to', 'auth', 'bridge', 'token', 'access_token', 'id_token', 'refresh_token', 'code', 'state', 'session', 'callback', 'redirect'])
const RETURN_URL_LIMIT = 1_200
const SAFE_RETURN_HASH = /^#(?:today|practice|papers|progress|notebook|session|attempt|mine|vocabulary)(?:\/[a-z0-9_-]{1,80}){0,2}$/i

function allowedReturnOrigin(url, current) {
  if (!/^https?:$/.test(url.protocol)) return false
  const hostname = url.hostname.toLowerCase()
  if (['ieltsist.com', 'stem.ieltsist.com'].includes(hostname) && url.protocol === 'https:') return true
  return ['localhost', '127.0.0.1'].includes(current.hostname.toLowerCase()) && url.origin === current.origin
}

function sanitizedReturnTarget(target) {
  const clean = new URL(target.origin + target.pathname)
  const safePath = clean.href.length <= RETURN_URL_LIMIT ? clean.href : `${clean.origin}/`
  let retained = 0
  for (const [key, value] of target.searchParams) {
    if (TRANSIENT_RETURN_PARAMS.has(key.toLowerCase()) || retained >= 20) continue
    clean.searchParams.append(key.slice(0, 80), value.slice(0, 240))
    retained += 1
  }
  if (SAFE_RETURN_HASH.test(target.hash)) clean.hash = target.hash
  return clean.href.length <= RETURN_URL_LIMIT ? clean.href : safePath
}

export function canonicalReturnUrl(value, currentHref = typeof window !== 'undefined' ? window.location.href : 'https://stem.ieltsist.com/') {
  const current = new URL(currentHref, 'https://stem.ieltsist.com/')
  const safeCurrent = allowedReturnOrigin(current, current) ? sanitizedReturnTarget(current) : 'https://stem.ieltsist.com/'
  try {
    const target = new URL(value || safeCurrent, current.origin)
    return allowedReturnOrigin(target, current) ? sanitizedReturnTarget(target) : safeCurrent
  } catch {
    return safeCurrent
  }
}

export function professionalTermsUrl({ subject = '', subjectCode = '', stage = '', topic = '', routeId = '', taxonomyId = '', topicId = '', termIds = [], attemptId = '', returnTo = window.location.href, source = 'stem-reviewed-glossary', sourceStatus = 'taxonomy-mapped', termInventoryStatus = 'not-imported', availableCount = null } = {}) {
  const url = new URL('/', IDENTITY_ORIGIN)
  const normalizedStage = String(stage || '').trim()
  const family = normalizedStage === 'Competition' ? 'competition' : normalizedStage === 'Admissions' ? 'admissions' : 'exam'
  const normalizedSubjectCode = String(subjectCode || subject || '').trim()
  const normalizedTaxonomyId = String(taxonomyId || `${family}.${normalizedSubjectCode.toLowerCase()}.${normalizedStage.toLowerCase() || 'route'}`).trim()
  url.searchParams.set('from', 'stem')
  url.searchParams.set('focus', 'language')
  url.searchParams.set('contractVersion', 'stem-vocabulary-context-v1')
  url.searchParams.set('family', family)
  url.searchParams.set('taxonomyId', normalizedTaxonomyId)
  url.searchParams.set('subjectCode', normalizedSubjectCode)
  url.searchParams.set('stage', normalizedStage)
  url.searchParams.set('source', String(source || 'stem-reviewed-glossary').trim())
  url.searchParams.set('sourceStatus', String(sourceStatus || 'taxonomy-mapped').trim().toLowerCase())
  url.searchParams.set('termInventoryStatus', String(termInventoryStatus || 'not-imported').trim().toLowerCase())
  if (String(sourceStatus || '').trim().toLowerCase() === 'source-backed' && Number.isFinite(Number(availableCount)) && Number(availableCount) >= 0) {
    url.searchParams.set('availableCount', String(Math.floor(Number(availableCount))))
  }
  if (subject) url.searchParams.set('subject', String(subject))
  if (topic) url.searchParams.set('topic', String(topic))
  applyProductContext(url, {
    routeId,
    topicId,
    termIds: termIds.length ? termIds : termIdsForStemContext({ topicId }),
    attemptId,
    returnTo: canonicalReturnUrl(returnTo),
    subject,
  })
  url.hash = 'vocabulary'
  return url.href
}
