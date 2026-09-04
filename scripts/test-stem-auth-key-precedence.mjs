import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'

import { createAiApi } from '../server/aiApi.js'
import { validHmacJwt } from '../server/markingCapability.js'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const internalKey = 'stem-internal-auth-key-precedence-test'
const legacyKey = 'stem-legacy-auth-key-precedence-test'
const authClaims = {
  issuer: 'ieltsist.com',
  audience: 'stem.ieltsist.com',
  maxLifetimeSeconds: 60 * 60,
}

function call(api, { method, url, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
    request.method = method
    request.url = url
    request.headers = headers
    const response = {
      headers: new Map(),
      statusCode: 0,
      setHeader(name, value) { this.headers.set(String(name).toLowerCase(), value) },
      end(raw) {
        let payload = {}
        try { payload = JSON.parse(raw || '{}') } catch { payload = { raw: String(raw || '') } }
        resolve({ statusCode: this.statusCode, payload, headers: Object.fromEntries(this.headers) })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

function signedBridgeFetch(_url, options) {
  const body = String(options.body || '')
  const timestamp = String(options.headers['X-Stem-Auth-Timestamp'] || '')
  const digest = crypto.createHash('sha256').update(body).digest('hex')
  const expectedSignature = crypto.createHmac('sha256', internalKey).update(`${timestamp}.${digest}`).digest('base64url')
  assert.equal(options.headers['X-Stem-Auth-Signature'], expectedSignature, 'the internal bridge must use STEM_INTERNAL_AUTH_KEY when both keys exist')

  const payload = JSON.parse(body)
  if (payload.username === 'stem_bridge_probe') {
    return Promise.resolve(new Response(JSON.stringify({ error: 'Invalid username or password.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }))
  }
  return Promise.resolve(new Response(JSON.stringify({
    identity: {
      id: 'ielts:42',
      username: payload.username,
      avatarDataUrl: '',
      roles: ['student'],
      workspaceRoles: ['student'],
    },
    accessToken: 'upstream-token-must-not-reach-browser',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
}

try {
  const env = {
    STEM_INTERNAL_AUTH_KEY: internalKey,
    STEM_IDENTITY_SIGNING_KEY: legacyKey,
    STEM_AUTH_INTERNAL_ORIGIN: 'http://127.0.0.1:4321',
    STEM_SESSION_SECURE: '0',
    STEM_DB_PATH: ':memory:',
  }
  const stemApi = createStemApi({ env, fetchImpl: signedBridgeFetch })
  const readiness = await call(stemApi, { method: 'GET', url: '/api/auth/config' })
  assert.equal(readiness.statusCode, 200)
  assert.equal(readiness.payload.readiness?.bridge?.status, 'ready')

  const login = await call(stemApi, {
    method: 'POST',
    url: '/api/auth/login',
    body: { username: 'canonical-key-student', password: 'testing123' },
  })
  assert.equal(login.statusCode, 200)
  assert.ok(validHmacJwt(login.payload.accessToken, internalKey, authClaims), 'STEM login must mint its API token with STEM_INTERNAL_AUTH_KEY when both keys exist')
  assert.equal(validHmacJwt(login.payload.accessToken, legacyKey, authClaims), null, 'the legacy key must be fallback-only when the canonical internal key exists')

  const sessionCookie = String(login.headers['set-cookie'] || '').split(';', 1)[0]
  const restored = await call(stemApi, {
    method: 'GET',
    url: '/api/auth/status',
    headers: { cookie: sessionCookie },
  })
  assert.equal(restored.statusCode, 200)
  assert.ok(validHmacJwt(restored.payload.accessToken, internalKey, authClaims), 'restored STEM sessions must mint canonical-key API tokens')

  const aiApi = createAiApi({
    env,
    libraryRoot: process.cwd(),
    allowedSubjects: new Set(['9702']),
  })
  const authorization = { authorization: `Bearer ${login.payload.accessToken}` }
  const coach = await call(aiApi, {
    method: 'POST',
    url: '/api/ai/coach',
    headers: authorization,
    body: {
      message: 'Please explain the complete physics method in detail.',
      hintLevel: 3,
      context: {},
    },
  })
  assert.equal(coach.statusCode, 200, 'AI Coach must accept a canonical STEM API token when both keys exist')
  assert.equal(coach.payload.providerStatus, 'not_configured')

  const handwriting = await call(aiApi, {
    method: 'POST',
    url: '/api/ai/mark-handwriting',
    headers: authorization,
    body: { submitted: true, markingGrant: 'invalid-grant', provenance: {} },
  })
  assert.equal(handwriting.statusCode, 403, 'handwriting marking must authenticate the canonical STEM API token before rejecting an invalid capability')
  assert.equal(handwriting.payload.code, 'marking_capability_invalid')
} finally {
  closeStemDatabaseForTests()
}

console.log('STEM canonical auth key precedence regression passed')
