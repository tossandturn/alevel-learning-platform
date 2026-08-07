import { enqueueSharedSync, listPendingSharedSync, markSharedSyncAttempt, markSharedSyncComplete } from './storage'

const IDENTITY_ORIGIN = configuredIdentityOrigin(import.meta.env.VITE_IELTSIST_ORIGIN || 'https://ieltsist.com')
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

function configuredIdentityOrigin(value) {
  try {
    const origin = new URL(value).origin
    if (origin.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)) return origin
  } catch {
    // Fall through to the production identity origin.
  }
  return 'https://ieltsist.com'
}

function responseError(response, payload, fallback) {
  if (response.status === 401 || response.status === 403) return new SharedAccountError('session_expired', 'Your IELTSist session has expired. Sign in again to continue.', { loginRequired: true })
  if (response.status === 429 || response.status >= 500) return new SharedAccountError('service_unavailable', payload?.error || fallback, { retryable: true })
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
  return { token, expiresAt }
}

async function jsonFetch(url, options = {}, timeoutMs = IDENTITY_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const payload = await response.json().catch(() => ({}))
    return { response, payload }
  } catch (error) {
    if (error?.name === 'AbortError') throw new SharedAccountError('network_timeout', 'The IELTSist account service took too long to respond. Your work remains on this device.', { retryable: true, cause: error })
    throw new SharedAccountError('network_unavailable', 'The IELTSist account service is unavailable. Your work remains on this device.', { retryable: true, cause: error })
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

function queueSubmission(resource, options, error) {
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
        rawMarks: Number(payload.rawMarks),
        maxMarks: Number(payload.maxMarks),
        percentage: Number(payload.percentage),
        elapsedSeconds: Number(payload.elapsedSeconds) || 0,
        markingMode: String(payload.markingMode || 'assisted'),
        reviewRequired: Boolean(payload.reviewRequired),
      },
      error: error?.message || 'Network unavailable',
    })
  } catch {
    return null
  }
}

/**
 * Exchanges an existing IELTSist browser session for a short-lived STEM session.
 * Tokens stay in memory; only non-sensitive sync metadata is persisted for retry.
 */
export async function requestSharedAccount({ flushPending = true } = {}) {
  const { response: identityResponse, payload: identityPayload } = await jsonFetch(`${IDENTITY_ORIGIN}/api/stem/identity`, { credentials: 'include', redirect: 'error' })
  if (!identityResponse.ok) throw responseError(identityResponse, identityPayload, 'Sign in to IELTSist to use shared STEM classes.')
  const identity = parseIdentity(identityPayload)
  const workspace = await sharedAccountRequest(identity.token, '/api/auth/status', { method: 'GET', skipSyncQueue: true })
  const sync = flushPending ? await flushPendingSharedSync(identity.token) : { synced: [], pending: listPendingSharedSync().length }
  return { ...identity, workspace, sync }
}

export async function sharedAccountRequest(token, resource, options = {}) {
  if (!token) throw new SharedAccountError('session_missing', 'Sign in with your IELTSist account to continue.', { loginRequired: true })
  const method = (options.method || 'GET').toUpperCase()
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  }
  const run = async () => {
    const { response, payload } = await jsonFetch(resource, { ...options, method, headers, credentials: 'same-origin' })
    if (!response.ok) throw responseError(response, payload, 'The shared workspace could not complete that action.')
    return payload
  }
  try {
    return await run()
  } catch (error) {
    // GETs are safe to retry. Submission POSTs rely on their server idempotency key.
    const safeRetry = method === 'GET' || Boolean(requestIdempotencyKey(options))
    if (isTransient(error) && safeRetry && !options.noRetry) {
      await new Promise((resolve) => window.setTimeout(resolve, 350))
      try {
        return await run()
      } catch (retryError) {
        const queued = queueSubmission(resource, options, retryError)
        if (queued) retryError.syncQueued = true
        throw retryError
      }
    }
    const queued = isTransient(error) ? queueSubmission(resource, options, error) : null
    if (queued) error.syncQueued = true
    throw error
  }
}

/** Replays only submission summaries. It never uploads answers, handwriting, or Coach messages. */
export async function flushPendingSharedSync(token) {
  const pending = listPendingSharedSync()
  const synced = []
  for (const item of pending) {
    try {
      const result = await sharedAccountRequest(token, item.resource, {
        method: item.method,
        body: JSON.stringify(item.body),
        headers: { 'Idempotency-Key': item.idempotencyKey },
        skipSyncQueue: true,
        noRetry: true,
      })
      markSharedSyncComplete(item.id, { attemptId: item.attemptId, eventId: result.eventId, occurredAt: result.occurredAt })
      synced.push({ id: item.id, attemptId: item.attemptId, duplicate: Boolean(result.duplicate) })
    } catch (error) {
      markSharedSyncAttempt(item.id, error?.message || 'Retry failed')
      if (error?.loginRequired) break
    }
  }
  return { synced, pending: listPendingSharedSync().length }
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

function safeReturnUrl(value = window.location.href) {
  const current = new URL(window.location.href)
  const target = new URL(value, current.origin)
  if (target.origin !== current.origin || !/^https?:$/.test(target.protocol)) return current.href
  return target.href
}

export function sharedLoginUrl(returnTo = window.location.href) {
  const url = new URL('/', IDENTITY_ORIGIN)
  url.searchParams.set('returnTo', safeReturnUrl(returnTo))
  url.searchParams.set('from', 'stem')
  return url.href
}

export function professionalTermsUrl({ subject = '', topic = '', termIds = [], returnTo = window.location.href } = {}) {
  const url = new URL('/', IDENTITY_ORIGIN)
  url.searchParams.set('from', 'stem')
  url.searchParams.set('focus', 'language')
  if (subject) url.searchParams.set('subject', String(subject))
  if (topic) url.searchParams.set('topic', String(topic))
  if (termIds.length) url.searchParams.set('term_ids', termIds.filter(Boolean).slice(0, 20).join(','))
  url.searchParams.set('return_to', safeReturnUrl(returnTo))
  url.hash = 'vocabulary'
  return url.href
}
