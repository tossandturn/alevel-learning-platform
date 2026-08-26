import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const signingKey = 'stem-native-auth-test-signing-key'
const calls = []
let expiredDbDirectory = ''

function call(api, { method, url, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
    request.method = method
    request.url = url
    request.headers = headers
    const response = {
      headers: new Map(),
      statusCode: 0,
      setHeader(name, value) { this.headers.set(name.toLowerCase(), value) },
      end(raw) {
        resolve({
          statusCode: this.statusCode,
          body: JSON.parse(raw || '{}'),
          headers: Object.fromEntries(this.headers),
        })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

const fetchImpl = async (url, options) => {
  calls.push({ url: String(url), options })
  const payload = JSON.parse(options.body)
  if (payload.username === 'stem_bridge_probe') {
    return new Response(JSON.stringify({ error: 'Invalid username or password.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (payload.username === 'wrong_user') {
    return new Response(JSON.stringify({ error: 'Invalid username or password.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }
  return new Response(JSON.stringify({
    identity: {
      id: 'ielts:42',
      username: payload.username,
      avatarDataUrl: '',
      roles: ['student'],
      workspaceRoles: ['student'],
    },
    accessToken: 'test-provider-access-token-that-must-not-reach-the-browser',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

try {
  let invalidOriginCalls = 0
  const invalidOriginApi = createStemApi({
    env: {
      STEM_IDENTITY_SIGNING_KEY: signingKey,
      STEM_AUTH_INTERNAL_ORIGIN: 'https://ieltsist.com',
      STEM_DB_PATH: ':memory:',
    },
    fetchImpl: async () => {
      invalidOriginCalls += 1
      throw new Error('The identity service must not be called when native auth is unconfigured.')
    },
  })
  const invalidOriginLogin = await call(invalidOriginApi, {
    method: 'POST',
    url: '/api/auth/login',
    body: { username: 'student', password: 'testing123' },
  })
  assert.equal(invalidOriginLogin.statusCode, 503)
  assert.equal(invalidOriginLogin.body.code, 'native_auth_not_configured')
  assert.equal(invalidOriginCalls, 0, 'non-local native auth configuration must fail before the identity service call')
  closeStemDatabaseForTests()

  const defaultOriginCalls = []
  const defaultOriginApi = createStemApi({
    env: {
      STEM_IDENTITY_SIGNING_KEY: signingKey,
      STEM_DB_PATH: ':memory:',
    },
    fetchImpl: async (url, options) => {
      defaultOriginCalls.push({ url: String(url), options })
      return new Response(JSON.stringify({ error: 'Invalid username or password.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  const defaultOriginLogin = await call(defaultOriginApi, {
    method: 'POST',
    url: '/api/auth/login',
    body: { username: 'wrong_user', password: 'testing123' },
  })
  assert.equal(defaultOriginLogin.statusCode, 401)
  assert.equal(defaultOriginCalls.length, 1, 'missing STEM_AUTH_INTERNAL_ORIGIN must use the safe localhost default instead of blocking login')
  assert.equal(defaultOriginCalls[0].url, 'http://127.0.0.1:4321/api/stem/internal/authenticate')
  closeStemDatabaseForTests()

  const api = createStemApi({
    env: {
      STEM_IDENTITY_SIGNING_KEY: signingKey,
      STEM_AUTH_INTERNAL_ORIGIN: 'http://127.0.0.1:4321',
      STEM_ORIGIN: 'https://stem.example.test',
      STEM_SESSION_SECURE: '0',
      STEM_DB_PATH: ':memory:',
    },
    fetchImpl,
  })

  const anonymous = await call(api, { method: 'GET', url: '/api/auth/status' })
  assert.equal(anonymous.statusCode, 200, 'anonymous native STEM auth status must return a normal guest response')
  assert.deepEqual(anonymous.body, { authenticated: false })

  const config = await call(api, { method: 'GET', url: '/api/auth/config' })
  assert.equal(config.statusCode, 200)
  assert.deepEqual(config.body.readiness, {
    sessionSigningConfigured: true,
    internalAuthOriginConfigured: true,
    nativeLoginConfigured: true,
    nativeLoginReady: true,
    bridge: { status: 'ready' },
  }, 'auth readiness must prove the signed local bridge can reject a deliberately invalid account before enabling credential entry')
  assert.equal(calls.length, 1, 'readiness must make a signed, password-free bridge probe')
  assert.doesNotMatch(String(calls[0].options.body), /testing123|not-the-password/, 'bridge readiness must not replay a student credential')
  assert.doesNotMatch(JSON.stringify(config.body), /testing123|provider-access-token|signing-key/i, 'auth readiness must not expose secrets')

  const rejectedBridgeApi = createStemApi({
    env: {
      STEM_IDENTITY_SIGNING_KEY: signingKey,
      STEM_AUTH_INTERNAL_ORIGIN: 'http://127.0.0.1:4321',
      STEM_DB_PATH: ':memory:',
    },
    fetchImpl: async () => new Response(JSON.stringify({ error: 'STEM account authentication is not authorised.' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    }),
  })
  const rejectedBridgeConfig = await call(rejectedBridgeApi, { method: 'GET', url: '/api/auth/config' })
  assert.equal(rejectedBridgeConfig.statusCode, 200)
  assert.deepEqual(rejectedBridgeConfig.body.readiness, {
    sessionSigningConfigured: true,
    internalAuthOriginConfigured: true,
    nativeLoginConfigured: true,
    nativeLoginReady: false,
    bridge: { status: 'signature_mismatch' },
  }, 'a rejected signed probe must block credential entry instead of claiming the bridge is healthy')
  closeStemDatabaseForTests()

  const invalid = await call(api, {
    method: 'POST',
    url: '/api/auth/login',
    body: { username: 'wrong_user', password: 'not-the-password' },
  })
  assert.equal(invalid.statusCode, 401, 'invalid credentials must be rejected by the shared identity service')
  assert.equal(calls.length, 2, 'the native sign-in must call the identity service after the readiness probe')
  assert.equal(calls[1].url, 'http://127.0.0.1:4321/api/stem/internal/authenticate')
  assert.doesNotMatch(JSON.stringify(invalid.body), /not-the-password|provider-access-token/i, 'a failed response must not echo credentials or provider tokens')

  const signedIn = await call(api, {
    method: 'POST',
    url: '/api/auth/login',
    body: { username: 'shared_student', password: 'testing123' },
  })
  assert.equal(signedIn.statusCode, 200, 'a valid same-account sign-in must complete on the STEM origin')
  assert.equal(calls.length, 3)
  assert.equal(signedIn.body.identity.id, 'ielts:42')
  assert.equal(signedIn.body.identity.username, 'shared_student')
  assert.match(signedIn.body.accessToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'STEM must issue its short-lived in-memory identity token')
  assert.doesNotMatch(JSON.stringify(signedIn.body), /testing123|provider-access-token/i, 'the browser must not receive the password or an upstream provider token')
  const sessionCookie = String(signedIn.headers['set-cookie'] || '')
  assert.match(sessionCookie, /^stem_session=/, 'STEM must persist its own HttpOnly browser session')
  assert.match(sessionCookie, /HttpOnly/i)
  assert.doesNotMatch(sessionCookie, /ieltsist_session/i, 'STEM must not write an IELTSist cookie')

  const restored = await call(api, {
    method: 'GET',
    url: '/api/auth/status',
    headers: { cookie: sessionCookie.split(';', 1)[0] },
  })
  assert.equal(restored.statusCode, 200, 'a STEM browser session must restore after refresh without a cross-site identity fetch')
  assert.equal(restored.body.identity.id, 'ielts:42')
  assert.match(restored.body.accessToken, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)

  const signedOut = await call(api, {
    method: 'POST',
    url: '/api/auth/logout',
    headers: { cookie: sessionCookie.split(';', 1)[0] },
  })
  assert.equal(signedOut.statusCode, 200)
  assert.match(String(signedOut.headers['set-cookie'] || ''), /^stem_session=;/, 'STEM logout must clear only the STEM session')

  const afterLogout = await call(api, {
    method: 'GET',
    url: '/api/auth/status',
    headers: { cookie: sessionCookie.split(';', 1)[0] },
  })
  assert.equal(afterLogout.statusCode, 200, 'a cleared STEM session must return a guest response')
  assert.deepEqual(afterLogout.body, { authenticated: false })

  closeStemDatabaseForTests()
  expiredDbDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-native-auth-expiry-'))
  const expiredDbPath = path.join(expiredDbDirectory, 'stem.sqlite')
  const expiredApiEnv = {
    STEM_IDENTITY_SIGNING_KEY: signingKey,
    STEM_AUTH_INTERNAL_ORIGIN: 'http://127.0.0.1:4321',
    STEM_ORIGIN: 'https://stem.example.test',
    STEM_SESSION_SECURE: '0',
    STEM_DB_PATH: expiredDbPath,
  }
  const expiredApi = createStemApi({ env: expiredApiEnv, fetchImpl })
  const expiryLogin = await call(expiredApi, {
    method: 'POST',
    url: '/api/auth/login',
    body: { username: 'expiry_student', password: 'testing123' },
  })
  assert.equal(expiryLogin.statusCode, 200)
  const expiryCookie = String(expiryLogin.headers['set-cookie'] || '').split(';', 1)[0]
  const expiryToken = decodeURIComponent(expiryCookie.slice('stem_session='.length))
  closeStemDatabaseForTests()
  const sqlite = process.getBuiltinModule?.('node:sqlite')
  assert.ok(sqlite?.DatabaseSync, 'session expiry regression requires the supported SQLite runtime')
  const expiryDatabase = new sqlite.DatabaseSync(expiredDbPath)
  const expiryHash = crypto.createHash('sha256').update(expiryToken).digest('hex')
  expiryDatabase.prepare('UPDATE stem_sessions SET expires_at = ? WHERE token_hash = ?').run('2000-01-01T00:00:00.000Z', expiryHash)
  expiryDatabase.close()
  const expiredStatus = await call(createStemApi({ env: expiredApiEnv, fetchImpl }), {
    method: 'GET',
    url: '/api/auth/status',
    headers: { cookie: expiryCookie },
  })
  assert.equal(expiredStatus.statusCode, 200, 'an expired STEM session must resolve as a guest status')
  assert.deepEqual(expiredStatus.body, { authenticated: false })
  closeStemDatabaseForTests()

  console.log('STEM native account checks passed')
} finally {
  closeStemDatabaseForTests()
  if (expiredDbDirectory) fs.rmSync(expiredDbDirectory, { recursive: true, force: true })
}
