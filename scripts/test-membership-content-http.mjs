import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const generatedPaperCatalog = path.join(root, 'public', 'data', 'papers.json')
let createdPaperCatalog = false
if (!fs.existsSync(generatedPaperCatalog)) {
  fs.writeFileSync(generatedPaperCatalog, '{"schemaVersion":2,"items":[]}\n', 'utf8')
  createdPaperCatalog = true
}
const { closeStemDatabaseForTests, createStemApi } = await import('../server/stemApi.js')

const signingKey = 'membership-content-http-test-key'
function tokenFor(subject) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: subject, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'membership-content-http-'))
const databasePath = path.join(temporaryDirectory, 'stem.sqlite')
let active = true
const authorityFetch = async (_url, options) => {
  const request = JSON.parse(options.body)
  const userId = request.userId
  return new Response(JSON.stringify({
    protocol: 'stemist-membership-v1',
    authority: 'ieltsist-membership',
    userId,
    entitlement: active
      ? { active: true, planId: 'all-access-month', startsAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), version: 1 }
      : { active: false, planId: null, startsAt: null, expiresAt: null, version: null },
    enforcement: { enabled: true, appliesToExistingUsers: true },
    features: { 'stem.all-access': { allowed: active, reason: active ? 'membership_active' : 'membership_required' } },
    checkedAt: new Date().toISOString(),
    maxAgeSeconds: 30,
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}
const api = createStemApi({
  env: {
    NODE_ENV: 'test',
    STEM_DB_PATH: databasePath,
    STEM_INTERNAL_AUTH_KEY: signingKey,
    STEM_MEMBERSHIP_ENFORCEMENT_ENABLED: '1',
    STEM_MEMBERSHIP_ENFORCEMENT_READY: '1',
  },
  fetchImpl: authorityFetch,
})
const server = http.createServer((request, response) => api(request, response, () => {
  response.statusCode = 404
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ code: 'not_found' }))
}))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}`
async function get(pathname, token = '') {
  const response = await fetch(baseUrl + pathname, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const text = await response.text()
  return { response, body: text ? JSON.parse(text) : null }
}

try {
  const catalog = await get('/api/stem/verified-practice/catalog')
  assert.equal(catalog.response.status, 200)
  assert.equal(catalog.body.schemaVersion, 'verified-practice-discovery-v1')
  const unitPath = `/api/stem/verified-practice/units/${encodeURIComponent(catalog.body.units[0].id)}`
  const anonymous = await get(unitPath)
  assert.equal(anonymous.response.status, 401)
  assert.equal(anonymous.body.code, 'identity_required')
  assert.equal(anonymous.response.headers.get('cache-control'), 'no-store')

  const memberToken = tokenFor('ielts:4201')
  const member = await get(unitPath, memberToken)
  assert.equal(member.response.status, 200)
  assert.ok(member.body.unit.parts.length > 0)
  assert.equal(member.response.headers.get('cache-control'), 'no-store')
  assert.match(member.response.headers.get('vary') || '', /Authorization, Cookie/)

  active = false
  const inactive = await get(`/api/stem/study-question-index/${encodeURIComponent(catalog.body.units[0].routeId)}`, tokenFor('ielts:4202'))
  assert.equal(inactive.response.status, 403)
  assert.equal(inactive.body.code, 'membership_required')
  assert.equal(inactive.response.headers.get('cache-control'), 'no-store')

  console.log('Membership content HTTP boundary: public discovery, anonymous 401, member content, and inactive 403 passed.')
} finally {
  await new Promise((resolve) => server.close(resolve))
  closeStemDatabaseForTests()
  fs.rmSync(temporaryDirectory, { recursive: true, force: true })
  if (createdPaperCatalog) fs.unlinkSync(generatedPaperCatalog)
}
