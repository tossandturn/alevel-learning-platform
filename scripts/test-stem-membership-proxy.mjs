import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMembershipAccessController } from '../server/membershipAccess.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const signingKey = 'stem-membership-proxy-test-key'
const calls = []
const catalog = {
  protocol: 'stemist-membership-v1',
  plan: { id: 'all-access-month', priceFen: 2880, currency: 'CNY', durationDays: 30, autoRenew: false },
  commerce: {
    checkoutEnabled: false, reason: 'setup_required',
    providers: [
      { id: 'wechat_virtual', enabled: false, reason: 'setup_required', platforms: [] },
      { id: 'wechat_jsapi', enabled: false, reason: 'setup_required', platforms: [] },
    ],
  },
  enforcement: { enabled: false, appliesToExistingUsers: true },
}

const fetchImpl = async (url, options) => {
  calls.push({ url: String(url), body: JSON.parse(options.body), headers: options.headers })
  const request = JSON.parse(options.body)
  if (request.action === 'catalog') return new Response(JSON.stringify(catalog), { status: 200, headers: { 'content-type': 'application/json' } })
  if (request.action === 'status') {
    assert.equal(request.userId, 'ielts:42')
    return new Response(JSON.stringify({
      protocol: 'stemist-membership-v1', userId: 'ielts:42',
      entitlement: { active: false, planId: null, startsAt: null, expiresAt: null, version: null },
      enforcement: { enabled: false, appliesToExistingUsers: true },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (request.action === 'orders') {
    assert.equal(request.userId, 'ielts:42')
    return new Response(JSON.stringify({ protocol: 'stemist-membership-v1', userId: 'ielts:42', orders: [], hasMore: false }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  if (request.action === 'create_order') {
    assert.equal(request.userId, 'ielts:42')
    assert.equal(request.payload.planId, 'all-access-month')
    return new Response(JSON.stringify({ code: 'membership_checkout_unavailable', error: 'Membership checkout is not available yet.' }), {
      status: 503, headers: { 'content-type': 'application/json' },
    })
  }
  throw new Error('unexpected authority request')
}

const controller = createMembershipAccessController({
  env: { STEM_INTERNAL_AUTH_KEY: signingKey },
  fetchImpl,
})
assert.deepEqual(await controller.membershipRequest({ action: 'catalog' }), catalog)
const status = await controller.membershipRequest({ action: 'status', userId: 'ielts:42' })
assert.equal(status.userId, 'ielts:42')
const orders = await controller.membershipRequest({ action: 'orders', userId: 'ielts:42', payload: { limit: '50', offset: '0' } })
assert.deepEqual(orders.orders, [])
await assert.rejects(() => controller.membershipRequest({
  action: 'create_order', userId: 'ielts:42',
  payload: { planId: 'all-access-month', idempotencyKey: 'member-order-0001', wxCode: 'fresh-code', platform: 'android', clientCapability: { requestVirtualPayment: true } },
}), (error) => error.statusCode === 503 && error.code === 'membership_checkout_unavailable')
assert.ok(calls.every((entry) => entry.headers['x-stem-auth-signature']), 'every bridge request must be signed')

const stemSource = fs.readFileSync(path.join(root, 'server', 'stemApi.js'), 'utf8')
const aiSource = fs.readFileSync(path.join(root, 'server', 'aiApi.js'), 'utf8')
const viteSource = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8')
const curriculumSource = fs.readFileSync(path.join(root, 'server', 'curriculumPracticeApi.js'), 'utf8')
assert.match(stemSource, /url\.pathname\.startsWith\('\/api\/membership\/'\)/, 'STEM router must own the public membership protocol')
assert.match(stemSource, /membershipAccess\.membershipRequest\(\{ action: 'catalog' \}\)/, 'catalog must come from the shared identity authority')
assert.match(stemSource, /membershipAccess\.requireFeature\(membershipUser, membershipFeature\)/, 'paid routes must enforce the authority decision server-side')
assert.ok(
  stemSource.indexOf('const membershipFeature = membershipFeatureForRequest') < stemSource.indexOf('curriculumPaperCatalog.handle'),
  'membership enforcement must run before public paper/file handlers so old clients cannot bypass it',
)
assert.doesNotMatch(stemSource, /membership.*grant.*request/i, 'STEM must not expose or synthesize a membership grant path')
assert.match(aiSource, /membershipFeatureForAiRequest\(request\.method, requestUrl\.pathname\)/, 'AI routes must use the same server-side membership authority')
assert.match(aiSource, /membershipIdentityProvider\(request\)\?\.id/, 'AI membership enforcement must accept the reviewed native-session identity fallback')
assert.match(viteSource, /membershipIdentityProvider: curriculumPracticeAccess\.authenticateMembershipRequest/, 'the runtime must wire the native-session identity fallback into AI membership enforcement')
assert.ok(
  aiSource.indexOf('membershipAccess.requireFeature') < aiSource.indexOf("requestUrl.pathname.startsWith('/api/ai/image/')"),
  'AI membership enforcement must run before paid handlers so old clients cannot bypass it',
)
assert.match(viteSource, /pathname\.startsWith\('\/api\/stem\/curriculum-practice'\)[\s\S]{0,500}curriculumMembershipAccess\.requireFeature[\s\S]{0,500}curriculumPracticeApi\.handle/, 'curriculum-practice must enforce membership before dispatch')
assert.equal(
  [...viteSource.matchAll(/server\.middlewares\.use\(curriculumPracticeMiddleware\)[\s\S]{0,120}server\.middlewares\.use\(stemApi\)/g)].length,
  2,
  'development and preview retain their reviewed middleware routing order',
)
assert.match(viteSource, /membershipFeatureForProtectedAsset[\s\S]{0,800}membershipProtectedPublicAsset/, 'protected public question bytes need a membership-aware pre-handler')
assert.match(viteSource, /membershipProtectedLocalPdf[\s\S]{0,800}sendLocalPdf/, 'direct PDF bytes need a membership-aware pre-handler')
assert.match(viteSource, /authenticateMembershipRequest\(request\)/, 'protected bytes must accept the reviewed bearer-or-native-session identity path')
assert.doesNotMatch(viteSource, /requireProtectedMembership[\s\S]{0,500}authenticateRequest\(request\)/, 'protected bytes must not use the bearer-only curriculum identity path')
assert.match(viteSource, /handleMembershipMiddlewareError[\s\S]{0,900}response\.statusCode = statusCode[\s\S]{0,300}Cache-Control/, 'middleware membership failures must remain truthful 401/403/503 JSON, not generic Vite 500 errors')
assert.match(viteSource, /if \(protectedAccess\)[\s\S]{0,220}membershipProtectedCacheControl\(true[\s\S]{0,220}Vary', 'Authorization, Cookie'/, 'protected question bytes must be private/no-store and vary on authority')
assert.match(viteSource, /sendLocalPdf[\s\S]{0,5000}membershipProtectedCacheControl\(protectedAccess, 'private, max-age=3600'\)/, 'protected PDFs must not retain the legacy one-hour private cache')
assert.match(stemSource, /membershipProtectedCacheControl\(request\.membershipProtectedAccess === true,'public, max-age=60, must-revalidate'\)/, 'protected native question images must not retain public cacheability')
assert.match(curriculumSource, /membershipProtectedCacheControl\(request\.membershipProtectedAccess === true, 'private, max-age=3600, immutable'\)/, 'protected curriculum source images must not outlive membership in a private cache')

console.log('STEM membership proxy ownership and safe-off integration checks passed')
