import crypto from 'node:crypto'

export const MEMBERSHIP_PROTOCOL = 'stemist-membership-v1'
export const MEMBERSHIP_FEATURE = 'stem.all-access'
const DEFAULT_ORIGIN = 'http://127.0.0.1:4321'
const CACHE_MS = 30_000

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

export function membershipEnforcementEnabled(env = {}) {
  return enabled(env.STEM_MEMBERSHIP_ENFORCEMENT_ENABLED) && enabled(env.STEM_MEMBERSHIP_ENFORCEMENT_READY)
}

function authorityUrl(env, pathname) {
  const configured = String(env.STEM_AUTH_INTERNAL_ORIGIN || DEFAULT_ORIGIN).trim()
  let url
  try { url = new URL(configured) } catch { throw Object.assign(new Error('Membership authority is unavailable.'), { statusCode: 503, code: 'membership_authority_unavailable' }) }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== 'http:' || !['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw Object.assign(new Error('Membership authority is unavailable.'), { statusCode: 503, code: 'membership_authority_unavailable' })
  }
  url.pathname = pathname; url.search = ''; url.hash = ''
  return url.toString()
}

function signedRequest({ pathname, payload, env }) {
  const key = String(env.STEM_INTERNAL_AUTH_KEY || env.STEM_IDENTITY_SIGNING_KEY || '')
  if (!key) throw Object.assign(new Error('Membership authority is unavailable.'), { statusCode: 503, code: 'membership_authority_unavailable' })
  const body = JSON.stringify(payload)
  const timestamp = String(Date.now())
  const digest = crypto.createHash('sha256').update(body).digest('hex')
  const signature = crypto.createHmac('sha256', key).update(`${timestamp}.${digest}`).digest('base64url')
  return {
    url: authorityUrl(env, pathname),
    body,
    headers: {
      'content-type': 'application/json',
      'x-stem-auth-timestamp': timestamp,
      'x-stem-auth-signature': signature,
    },
  }
}

async function postAuthority({ pathname, payload, env, fetchImpl, timeoutMs = 5000 }) {
  const request = signedRequest({ pathname, payload, env })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(request.url, {
      method: 'POST', headers: request.headers, body: request.body, signal: controller.signal,
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const statusCode = [400, 401, 403, 404, 409].includes(response.status) ? response.status : 503
      throw Object.assign(new Error(String(body.error || 'Membership authority is unavailable.')), {
        statusCode,
        code: String(body.code || (statusCode === 503 ? 'membership_authority_unavailable' : 'membership_request_rejected')),
      })
    }
    return body
  } catch (error) {
    if (error?.statusCode) throw error
    throw Object.assign(new Error('Membership authority is unavailable.'), { statusCode: 503, code: 'membership_authority_unavailable' })
  } finally {
    clearTimeout(timeout)
  }
}

function validateEntitlement(payload, expectedUserId, featureId) {
  if (!payload || payload.protocol !== MEMBERSHIP_PROTOCOL || payload.authority !== 'ieltsist-membership'
      || payload.userId !== expectedUserId || !payload.entitlement || !payload.enforcement
      || !payload.features || typeof payload.features[featureId]?.allowed !== 'boolean'
      || !Number.isFinite(Date.parse(payload.checkedAt)) || payload.maxAgeSeconds !== 30) {
    throw Object.assign(new Error('Membership authority returned an invalid decision.'), { statusCode: 503, code: 'membership_authority_invalid' })
  }
  return payload
}

export function membershipFeatureForRequest(method, pathname) {
  const normalizedMethod = String(method || 'GET').toUpperCase()
  const path = String(pathname || '')
  if (!path.startsWith('/api/stem/')) return null
  if (path.startsWith('/api/stem/announcements')) return null
  if (path === '/api/stem/profile') return null
  if (normalizedMethod === 'GET' && [
    '/api/stem/paper-catalog', '/api/stem/curriculum-papers', '/api/stem/workspace',
    '/api/stem/attempts',
  ].includes(path)) return null
  if (normalizedMethod === 'GET' && path.startsWith('/api/stem/notebook/notes')) return null
  if (normalizedMethod === 'DELETE' && path.startsWith('/api/stem/notebook/notes/')) return null
  if (normalizedMethod === 'GET' && path === '/api/stem/coach/conversations') return null
  if (normalizedMethod === 'GET' && /^\/api\/stem\/routes\/[^/]+\/syllabus-topics$/.test(path)) return null
  if (normalizedMethod === 'GET' && path.startsWith('/api/stem/paper-marking-jobs')) return null
  return MEMBERSHIP_FEATURE
}

export function membershipFeatureForAiRequest(method, pathname) {
  const path = String(pathname || '')
  if (!path.startsWith('/api/ai/')) return null
  if (String(method || 'GET').toUpperCase() === 'GET'
      && (path === '/api/ai/status' || path.startsWith('/api/ai/image/'))) return null
  if (String(method || 'GET').toUpperCase() === 'GET'
      && path.startsWith('/api/ai/tavern/conversations/') && path.endsWith('/messages')) return null
  if (String(method || 'GET').toUpperCase() === 'DELETE'
      && path.startsWith('/api/ai/tavern/conversations/')) return null
  return MEMBERSHIP_FEATURE
}

export function membershipFeatureForProtectedAsset(pathname) {
  let path
  try { path = decodeURIComponent(String(pathname || '')).toLowerCase() } catch { return null }
  if (path.startsWith('/data/study-question-index/')
      || path.startsWith('/question-assets/')
      || path.startsWith('/local-pdf/')) return MEMBERSHIP_FEATURE
  return null
}

export function membershipIdentityForRequest(request, { bearerIdentity, nativeIdentity }) {
  if (request?.headers?.authorization) return bearerIdentity(request)
  return nativeIdentity(request)
}

export function membershipProtectedCacheControl(protectedAccess, fallback) {
  return protectedAccess === true ? 'private, no-store' : fallback
}

export function createMembershipAccessController({ env = {}, fetchImpl = fetch, clock = () => Date.now() } = {}) {
  const cache = new Map()
  const enforcementEnabled = () => membershipEnforcementEnabled(env)

  async function entitlement(userId, featureId = MEMBERSHIP_FEATURE) {
    const normalizedUserId = String(userId || '')
    if (!/^ielts:\d+$/.test(normalizedUserId)) throw Object.assign(new Error('Sign in to continue.'), { statusCode: 401, code: 'identity_required' })
    if (!enforcementEnabled()) {
      return {
        protocol: MEMBERSHIP_PROTOCOL,
        authority: 'local-safe-off',
        userId: normalizedUserId,
        entitlement: { active: false, planId: null, startsAt: null, expiresAt: null, version: null },
        enforcement: { enabled: false, appliesToExistingUsers: true },
        features: { [featureId]: { allowed: true, reason: 'enforcement_disabled' } },
        checkedAt: new Date(clock()).toISOString(), maxAgeSeconds: 30,
      }
    }
    const cacheKey = `${normalizedUserId}:${featureId}`
    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > clock()) return cached.value
    const payload = validateEntitlement(await postAuthority({
      pathname: '/api/stem/internal/entitlements',
      payload: { userId: normalizedUserId, featureIds: [featureId] },
      env, fetchImpl,
    }), normalizedUserId, featureId)
    if (payload.enforcement.enabled !== true) {
      throw Object.assign(new Error('Membership enforcement configuration is inconsistent.'), { statusCode: 503, code: 'membership_authority_mismatch' })
    }
    if (payload.entitlement.active === true && payload.features[featureId].allowed === true) {
      const entitlementExpiry = Date.parse(payload.entitlement.expiresAt)
      if (!Number.isFinite(entitlementExpiry) || entitlementExpiry <= clock()) {
        throw Object.assign(new Error('An active membership is required.'), { statusCode: 403, code: 'membership_required', entitlement: payload.entitlement })
      }
      cache.set(cacheKey, {
        value: payload,
        expiresAt: Math.min(clock() + Math.min(CACHE_MS, payload.maxAgeSeconds * 1000), entitlementExpiry),
      })
    }
    return payload
  }

  async function requireFeature(user, featureId = MEMBERSHIP_FEATURE) {
    const decision = await entitlement(user?.id, featureId)
    if (decision.enforcement.enabled === false) return decision
    if (decision.features[featureId].allowed !== true || decision.entitlement.active !== true
        || !Number.isFinite(Date.parse(decision.entitlement.expiresAt)) || Date.parse(decision.entitlement.expiresAt) <= clock()) {
      throw Object.assign(new Error('An active membership is required.'), { statusCode: 403, code: 'membership_required', entitlement: decision.entitlement })
    }
    return decision
  }

  async function membershipRequest({ action, userId = '', orderId = '', payload = {} }) {
    return postAuthority({
      pathname: '/api/stem/internal/membership',
      payload: { action, ...(userId ? { userId } : {}), ...(orderId ? { orderId } : {}), ...(payload && Object.keys(payload).length ? { payload } : {}) },
      env, fetchImpl,
      timeoutMs: 12_000,
    })
  }

  return { entitlement, enforcementEnabled, membershipRequest, requireFeature };
}
