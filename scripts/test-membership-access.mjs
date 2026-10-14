import assert from 'node:assert/strict'
import {
  createMembershipAccessController,
  classifyMembershipProtectedAsset,
  membershipFeatureForAiRequest,
  membershipFeatureForProtectedAsset,
  membershipFeatureForRequest,
  membershipIdentityForRequest,
  membershipProtectedCacheControl,
} from '../server/membershipAccess.js'

const signingKey = 'membership-access-test-key'
const user = { id: 'ielts:42' }
let calls = 0
let mode = 'active'

const fetchImpl = async (url, options) => {
  calls += 1
  assert.equal(String(url), 'http://127.0.0.1:4321/api/stem/internal/entitlements')
  assert.match(String(options.headers['x-stem-auth-signature'] || ''), /^[A-Za-z0-9_-]+$/)
  const request = JSON.parse(options.body)
  assert.deepEqual(request, { userId: user.id, featureIds: ['stem.all-access'] })
  if (mode === 'unavailable') throw new Error('offline')
  const active = mode === 'active'
  return new Response(JSON.stringify({
    protocol: 'stemist-membership-v1',
    authority: 'ieltsist-membership',
    userId: user.id,
    entitlement: { active, planId: active ? 'all-access-month' : null, startsAt: active ? '2026-10-14T00:00:00.000Z' : null, expiresAt: active ? '2026-11-13T00:00:00.000Z' : null, version: active ? 'v1' : null },
    enforcement: { enabled: mode !== 'mismatch', appliesToExistingUsers: true },
    features: { 'stem.all-access': { allowed: active, reason: active ? 'membership_active' : 'membership_required' } },
    checkedAt: new Date().toISOString(),
    maxAgeSeconds: 30,
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

const safeOff = createMembershipAccessController({
  env: { STEM_INTERNAL_AUTH_KEY: signingKey },
  fetchImpl: async () => { throw new Error('safe-off must not call the authority') },
})
const safeDecision = await safeOff.requireFeature(user)
assert.equal(safeDecision.enforcement.enabled, false)
assert.equal(safeDecision.features['stem.all-access'].allowed, true)

const env = {
  STEM_INTERNAL_AUTH_KEY: signingKey,
  STEM_MEMBERSHIP_ENFORCEMENT_ENABLED: '1',
  STEM_MEMBERSHIP_ENFORCEMENT_READY: '1',
}
const controller = createMembershipAccessController({ env, fetchImpl })
await controller.requireFeature(user)
await controller.requireFeature(user)
assert.equal(calls, 1, 'a verified positive decision may be cached for at most the authority TTL')

mode = 'inactive'
const inactiveController = createMembershipAccessController({ env, fetchImpl })
await assert.rejects(() => inactiveController.requireFeature(user), (error) => error.statusCode === 403 && error.code === 'membership_required')
await assert.rejects(() => inactiveController.requireFeature(user), (error) => error.statusCode === 403 && error.code === 'membership_required')
assert.equal(calls, 3, 'negative authority decisions must not be cached')

mode = 'unavailable'
const unavailableController = createMembershipAccessController({ env, fetchImpl })
await assert.rejects(() => unavailableController.requireFeature(user), (error) => error.statusCode === 503 && error.code === 'membership_authority_unavailable')

mode = 'mismatch'
const mismatchController = createMembershipAccessController({ env, fetchImpl })
await assert.rejects(() => mismatchController.requireFeature(user), (error) => error.statusCode === 503 && error.code === 'membership_authority_mismatch')

let shortClock = Date.parse('2026-10-14T00:00:00.000Z')
let shortCalls = 0
const shortExpiryController = createMembershipAccessController({
  env,
  clock: () => shortClock,
  fetchImpl: async () => {
    shortCalls += 1
    if (shortCalls > 1) throw new Error('authority unavailable after entitlement expiry')
    return new Response(JSON.stringify({
      protocol: 'stemist-membership-v1', authority: 'ieltsist-membership', userId: user.id,
      entitlement: { active: true, planId: 'all-access-month', startsAt: '2026-10-13T00:00:00.000Z', expiresAt: '2026-10-14T00:00:00.500Z', version: 'short' },
      enforcement: { enabled: true, appliesToExistingUsers: true },
      features: { 'stem.all-access': { allowed: true, reason: 'membership_active' } },
      checkedAt: '2026-10-14T00:00:00.000Z', maxAgeSeconds: 30,
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  },
})
await shortExpiryController.requireFeature(user)
shortClock += 1_000
await assert.rejects(() => shortExpiryController.requireFeature(user), (error) => error.statusCode === 503 && error.code === 'membership_authority_unavailable')
assert.equal(shortCalls, 2, 'positive cache must never outlive the actual entitlement expiry')

assert.equal(membershipFeatureForRequest('GET', '/api/stem/paper-catalog'), null)
assert.equal(membershipFeatureForRequest('GET', '/api/stem/verified-practice/catalog'), null)
assert.equal(membershipFeatureForRequest('GET', '/api/stem/verified-practice/units/example'), 'stem.all-access')
assert.equal(membershipFeatureForRequest('POST', '/api/stem/verified-practice/generate'), 'stem.all-access')
assert.equal(membershipFeatureForRequest('GET', '/api/stem/study-question-index/cie-9702-as-physics'), 'stem.all-access')
assert.equal(membershipFeatureForRequest('GET', '/api/stem/curriculum-practice/catalog'), null)
assert.equal(membershipFeatureForRequest('GET', '/api/stem/curriculum-practice/catalog/extra'), 'stem.all-access')
assert.equal(membershipFeatureForRequest('GET', '/api/stem/curriculum-practice/history'), null)
assert.equal(membershipFeatureForRequest('POST', '/api/stem/curriculum-practice/history'), 'stem.all-access')
assert.equal(membershipFeatureForRequest('GET', '/api/stem/curriculum-practice/sessions/cps_12345678'), null)
assert.equal(membershipFeatureForRequest('GET', '/api/stem/curriculum-practice/sessions/cps_12345678/submit'), 'stem.all-access')
assert.equal(membershipFeatureForRequest('GET', '/api/stem/curriculum-practice/questions/q1'), 'stem.all-access')
assert.equal(membershipFeatureForRequest('HEAD', '/api/stem/curriculum-practice/source/q/a/hash.png'), 'stem.all-access')
assert.equal(membershipFeatureForRequest('POST', '/api/stem/curriculum-practice/sessions'), 'stem.all-access')
assert.equal(membershipFeatureForRequest('GET', '/api/stem/routes/cie-9702-as-physics/syllabus-topics'), null)
assert.equal(membershipFeatureForRequest('GET', '/api/stem/announcements'), null)
assert.equal(membershipFeatureForRequest('GET', '/api/stem/profile'), null)
assert.equal(membershipFeatureForRequest('GET', '/api/stem/workspace'), null)
assert.equal(membershipFeatureForRequest('GET', '/api/stem/attempts'), null)
assert.equal(membershipFeatureForRequest('GET', '/api/stem/coach/conversations'), null)
assert.equal(membershipFeatureForRequest('DELETE', '/api/stem/notebook/notes/cie-9702'), null)
assert.equal(membershipFeatureForRequest('PUT', '/api/stem/notebook/notes/cie-9702'), 'stem.all-access')
assert.equal(membershipFeatureForRequest('POST', '/api/stem/practice-sets'), 'stem.all-access')
assert.equal(membershipFeatureForRequest('GET', '/api/stem/practice-source-image'), 'stem.all-access')
assert.equal(membershipFeatureForRequest('POST', '/api/stem/original-foundation/submit'), 'stem.all-access')
assert.equal(membershipFeatureForRequest('POST', '/api/stem/paper-marking-jobs'), 'stem.all-access')
assert.equal(membershipFeatureForAiRequest('GET', '/api/ai/status'), null)
assert.equal(membershipFeatureForAiRequest('GET', '/api/ai/image/server-token'), null)
assert.equal(membershipFeatureForAiRequest('POST', '/api/ai/coach'), 'stem.all-access')
assert.equal(membershipFeatureForAiRequest('POST', '/api/ai/coach/stream'), 'stem.all-access')
assert.equal(membershipFeatureForAiRequest('POST', '/api/ai/mark-handwriting'), 'stem.all-access')
assert.equal(membershipFeatureForAiRequest('GET', '/api/ai/tavern/conversations/id/messages'), null)
assert.equal(membershipFeatureForAiRequest('DELETE', '/api/ai/tavern/conversations/id'), null)
assert.equal(membershipFeatureForAiRequest('POST', '/api/ai/tavern/conversations/resume'), 'stem.all-access')
assert.equal(membershipFeatureForProtectedAsset('/data/study-question-index/cie-9702-as-physics.json'), 'stem.all-access')
assert.equal(membershipFeatureForProtectedAsset('/data/study-question-index/manifest.json'), null)
assert.equal(membershipFeatureForProtectedAsset('/question-assets/cie/diagram.png'), 'stem.all-access')
assert.equal(membershipFeatureForProtectedAsset('/local-pdf/9702/paper.pdf'), 'stem.all-access')
assert.equal(membershipFeatureForProtectedAsset('/%71uestion-assets/cie/diagram.png'), 'stem.all-access')
assert.equal(membershipFeatureForProtectedAsset('/LOCAL-PDF/9702/paper.pdf'), 'stem.all-access')
assert.deepEqual(classifyMembershipProtectedAsset('/%71uestion-assets/cie/diagram.png'), { feature: 'stem.all-access', invalid: false })
assert.deepEqual(classifyMembershipProtectedAsset('/%2571uestion-assets/cie/diagram.png'), { feature: null, invalid: true })
assert.deepEqual(classifyMembershipProtectedAsset('/question-assets/%252e%252e/private.png'), { feature: null, invalid: true })
assert.deepEqual(classifyMembershipProtectedAsset('/question-assets%255cprivate.png'), { feature: null, invalid: true })
assert.deepEqual(classifyMembershipProtectedAsset('/data/product-config.json'), { feature: null, invalid: false })
assert.equal(membershipFeatureForProtectedAsset('/data/product-config.json'), null)
assert.equal(membershipProtectedCacheControl(true, 'public, max-age=31536000, immutable'), 'private, no-store')
assert.equal(membershipProtectedCacheControl(false, 'public, max-age=31536000, immutable'), 'public, max-age=31536000, immutable')
assert.deepEqual(membershipIdentityForRequest({ headers: { authorization: 'Bearer x' } }, {
  bearerIdentity: () => ({ id: 'ielts:42', source: 'bearer' }),
  nativeIdentity: () => { throw new Error('native identity should not run when a bearer is present') },
}), { id: 'ielts:42', source: 'bearer' })
assert.deepEqual(membershipIdentityForRequest({ headers: { cookie: 'stem_session=native' } }, {
  bearerIdentity: () => { throw new Error('bearer identity should not run for a cookie-only request') },
  nativeIdentity: () => ({ id: 'ielts:42', source: 'native-cookie' }),
}), { id: 'ielts:42', source: 'native-cookie' })

console.log('STEM membership authority fail-closed and route policy checks passed')
