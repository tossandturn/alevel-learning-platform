import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const signingKey = 'stem-native-auth-test-signing-key'
const calls = []

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
  assert.equal(anonymous.statusCode, 401, `anonymous native STEM auth status must require a STEM session: ${anonymous.body.error || 'unknown error'}`)

  const invalid = await call(api, {
    method: 'POST',
    url: '/api/auth/login',
    body: { username: 'wrong_user', password: 'not-the-password' },
  })
  assert.equal(invalid.statusCode, 401, 'invalid credentials must be rejected by the shared identity service')
  assert.equal(calls.length, 1, 'the native sign-in must call the identity service once')
  assert.equal(calls[0].url, 'http://127.0.0.1:4321/api/stem/internal/authenticate')
  assert.doesNotMatch(JSON.stringify(invalid.body), /not-the-password|provider-access-token/i, 'a failed response must not echo credentials or provider tokens')

  const signedIn = await call(api, {
    method: 'POST',
    url: '/api/auth/login',
    body: { username: 'shared_student', password: 'testing123' },
  })
  assert.equal(signedIn.statusCode, 200, 'a valid same-account sign-in must complete on the STEM origin')
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
  assert.equal(afterLogout.statusCode, 401, 'a cleared STEM session must not remain usable')
  console.log('STEM native account checks passed')
} finally {
  closeStemDatabaseForTests()
}
