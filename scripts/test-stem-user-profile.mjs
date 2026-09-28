import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const signingKey = 'stem-user-profile-test-signing-key'
const protocol = 'stem-user-profile-v1'
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-user-profile-'))
const databasePath = path.join(tempRoot, 'stem.sqlite')

function dataUrl(mime, bytes) {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}

function pngBytes(marker = 1) {
  const bytes = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(marker, 16)
  bytes.writeUInt32BE(1, 20)
  return bytes
}

function jpegBytes() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9])
}

function webpBytes() {
  const bytes = Buffer.alloc(20)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(12, 4)
  bytes.write('WEBP', 8, 'ascii')
  bytes.write('VP8X', 12, 'ascii')
  return bytes
}

const trustedAvatar = dataUrl('image/png', pngBytes(1))
const customAvatar = dataUrl('image/png', pngBytes(2))

function signedToken({ id, username, avatarDataUrl = '', roles = ['student'] }) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: id,
    username,
    avatarDataUrl,
    roles,
    workspaceRoles: roles,
    iat: now,
    exp: now + 300,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function decodeToken(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

function call(api, { method, url, body, rawBody, headers = {} }) {
  return new Promise((resolve, reject) => {
    const encoded = rawBody == null ? (body === undefined ? null : Buffer.from(JSON.stringify(body))) : Buffer.from(rawBody)
    const request = Readable.from(encoded ? [encoded] : [])
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
        resolve({ statusCode: this.statusCode, body: payload, headers: Object.fromEntries(this.headers) })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

const identities = {
  alice: { id: 'ielts:101', username: 'alice_login', avatarDataUrl: trustedAvatar, roles: ['teacher'] },
  bob: { id: 'ielts:202', username: 'bob_login', avatarDataUrl: '', roles: ['teacher'] },
  charlie: { id: 'ielts:303', username: 'charlie_login', avatarDataUrl: trustedAvatar, roles: ['teacher'] },
}

const fetchImpl = async (_url, options) => {
  const payload = JSON.parse(options.body)
  const key = String(payload.username || '').startsWith('bob')
    ? 'bob'
    : String(payload.username || '').startsWith('charlie')
      ? 'charlie'
      : 'alice'
  const identity = identities[key]
  return new Response(JSON.stringify({
    identity: { ...identity, workspaceRoles: identity.roles },
    accessToken: 'upstream-token-must-not-reach-client',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

const env = {
  STEM_INTERNAL_AUTH_KEY: signingKey,
  STEM_AUTH_INTERNAL_ORIGIN: 'http://127.0.0.1:4321',
  STEM_SESSION_SECURE: '0',
  STEM_DB_PATH: databasePath,
}

try {
  const api = createStemApi({ env, fetchImpl })
  const aliceToken = signedToken(identities.alice)
  const bobToken = signedToken(identities.bob)
  const aliceAuth = { authorization: `Bearer ${aliceToken}` }
  const bobAuth = { authorization: `Bearer ${bobToken}` }

  const anonymous = await call(api, { method: 'GET', url: '/api/stem/profile' })
  assert.equal(anonymous.statusCode, 401, 'profile reads require a verified identity')

  const emptyAlice = await call(api, { method: 'GET', url: '/api/stem/profile', headers: aliceAuth })
  assert.equal(emptyAlice.statusCode, 200)
  assert.deepEqual(emptyAlice.body, {
    protocol,
    profile: { ownerId: identities.alice.id, displayName: '', avatarDataUrl: trustedAvatar, updatedAt: null },
  }, 'an unset display name must stay empty while a trusted identity avatar may be inherited')
  assert.equal(JSON.stringify(emptyAlice.body).includes(identities.alice.username), false, 'username must not be exposed as a nickname fallback')

  const saved = await call(api, {
    method: 'PUT',
    url: '/api/stem/profile',
    headers: aliceAuth,
    body: { displayName: '  Cafe\u0301 Student  ', avatarDataUrl: customAvatar },
  })
  assert.equal(saved.statusCode, 200)
  assert.equal(saved.body.protocol, protocol)
  assert.equal(saved.body.profile.ownerId, identities.alice.id)
  assert.equal(saved.body.profile.displayName, 'Café Student', 'display names must be trimmed and NFC-normalized')
  assert.equal(saved.body.profile.avatarDataUrl, customAvatar)
  assert.match(saved.body.profile.updatedAt, /^\d{4}-\d{2}-\d{2}T/)

  const restored = await call(api, { method: 'GET', url: '/api/stem/profile', headers: aliceAuth })
  assert.deepEqual(restored.body, saved.body, 'saved profile must round-trip from SQLite')

  const emptyBob = await call(api, { method: 'GET', url: '/api/stem/profile', headers: bobAuth })
  assert.deepEqual(emptyBob.body.profile, { ownerId: identities.bob.id, displayName: '', avatarDataUrl: '', updatedAt: null }, 'profiles must be isolated by verified owner')

  const bodyOwnerAttempt = await call(api, {
    method: 'PUT',
    url: '/api/stem/profile',
    headers: bobAuth,
    body: { ownerId: identities.alice.id, displayName: 'Impostor', avatarDataUrl: '' },
  })
  assert.equal(bodyOwnerAttempt.statusCode, 400, 'the request body cannot select a profile owner')
  assert.equal((await call(api, { method: 'GET', url: '/api/stem/profile', headers: aliceAuth })).body.profile.displayName, 'Café Student')

  for (const [label, body, expectedStatus = 400] of [
    ['missing avatar whole-value field', { displayName: 'Name' }],
    ['empty nickname', { displayName: '   ', avatarDataUrl: '' }],
    ['non-string nickname', { displayName: 42, avatarDataUrl: '' }],
    ['too many Unicode codepoints', { displayName: '😀'.repeat(33), avatarDataUrl: '' }],
    ['control character', { displayName: 'Bad\nName', avatarDataUrl: '' }],
    ['unpaired surrogate', { displayName: '\ud800', avatarDataUrl: '' }],
    ['external URL', { displayName: 'Name', avatarDataUrl: 'https://example.test/avatar.png' }],
    ['temporary path', { displayName: 'Name', avatarDataUrl: 'wxfile://tmp/avatar.png' }],
    ['SVG data URL', { displayName: 'Name', avatarDataUrl: dataUrl('image/svg+xml', '<svg/>') }],
    ['invalid base64', { displayName: 'Name', avatarDataUrl: 'data:image/png;base64,***' }],
    ['wrong PNG header', { displayName: 'Name', avatarDataUrl: dataUrl('image/png', 'not a png') }],
    ['MIME/header mismatch', { displayName: 'Name', avatarDataUrl: dataUrl('image/jpeg', pngBytes()) }],
    ['binary size over 64 KiB', { displayName: 'Name', avatarDataUrl: dataUrl('image/png', Buffer.concat([pngBytes(), Buffer.alloc(65_536)])) }, 413],
  ]) {
    const result = await call(api, { method: 'PUT', url: '/api/stem/profile', headers: aliceAuth, body })
    assert.equal(result.statusCode, expectedStatus, label)
  }

  for (const [mime, bytes] of [['image/png', pngBytes(3)], ['image/jpeg', jpegBytes()], ['image/webp', webpBytes()]]) {
    const result = await call(api, { method: 'PUT', url: '/api/stem/profile', headers: bobAuth, body: { displayName: 'Bob', avatarDataUrl: dataUrl(mime, bytes) } })
    assert.equal(result.statusCode, 200, `${mime} with its real header must be accepted`)
    assert.equal(result.body.profile.avatarDataUrl.startsWith(`data:${mime};base64,`), true)
  }

  const oversizedBody = await call(api, {
    method: 'PUT',
    url: '/api/stem/profile',
    headers: aliceAuth,
    rawBody: JSON.stringify({ displayName: 'Name', avatarDataUrl: '', padding: 'x'.repeat(100_000) }),
  })
  assert.equal(oversizedBody.statusCode, 413, 'profile request bodies must have a narrow independent size cap')

  const login = await call(api, { method: 'POST', url: '/api/auth/login', body: { username: identities.alice.username, password: 'testing123' } })
  assert.equal(login.statusCode, 200)
  assert.equal(login.body.identity.id, identities.alice.id)
  assert.equal(login.body.identity.username, identities.alice.username)
  assert.deepEqual(login.body.identity.roles, identities.alice.roles)
  assert.equal(login.body.identity.displayName, 'Café Student')
  assert.equal(login.body.identity.avatarDataUrl, customAvatar)
  const loginClaims = decodeToken(login.body.accessToken)
  assert.equal(Object.hasOwn(loginClaims, 'displayName'), false, 'profile display name must not enter the JWT')
  assert.equal(loginClaims.avatarDataUrl, trustedAvatar, 'stored profile avatar must not enlarge or alter the authority token')
  assert.equal(loginClaims.username, identities.alice.username)
  assert.deepEqual(loginClaims.roles, identities.alice.roles)
  assert.doesNotMatch(JSON.stringify(login.body), /upstream-token-must-not-reach-client/)

  const newAccountLogin = await call(api, { method: 'POST', url: '/api/auth/login', body: { username: identities.charlie.username, password: 'testing123' } })
  assert.equal(newAccountLogin.statusCode, 200)
  assert.equal(newAccountLogin.body.identity.displayName, '', 'an unset profile must not copy username into displayName')
  assert.equal(newAccountLogin.body.identity.username, identities.charlie.username)
  assert.equal(newAccountLogin.body.identity.avatarDataUrl, trustedAvatar)

  const cookie = String(login.headers['set-cookie'] || '').split(';', 1)[0]
  const status = await call(api, { method: 'GET', url: '/api/auth/status', headers: { cookie } })
  assert.equal(status.body.identity.displayName, 'Café Student')
  assert.equal(status.body.identity.avatarDataUrl, customAvatar)
  assert.equal(Object.hasOwn(decodeToken(status.body.accessToken), 'displayName'), false)

  const registered = await call(api, { method: 'POST', url: '/api/auth/register', body: { username: identities.alice.username, password: 'testing123' } })
  assert.equal(registered.body.identity.displayName, 'Café Student')
  assert.equal(registered.body.identity.avatarDataUrl, customAvatar)

  const wechat = await call(api, { method: 'POST', url: '/api/auth/wechat', body: { code: 'valid_wechat_code_123' } })
  assert.equal(wechat.statusCode, 200)
  assert.equal(wechat.body.identity.displayName, 'Café Student')
  assert.equal(wechat.body.identity.avatarDataUrl, customAvatar)
  assert.equal(Object.hasOwn(decodeToken(wechat.body.accessToken), 'displayName'), false)

  closeStemDatabaseForTests()
  const sqlite = process.getBuiltinModule?.('node:sqlite')
  assert.ok(sqlite?.DatabaseSync)
  const db = new sqlite.DatabaseSync(databasePath, { readOnly: true })
  const rows = db.prepare('SELECT owner_user_id, display_name FROM stem_user_profiles ORDER BY owner_user_id').all().map((row) => ({ ...row }))
  db.close()
  assert.deepEqual(rows, [
    { owner_user_id: identities.alice.id, display_name: 'Café Student' },
    { owner_user_id: identities.bob.id, display_name: 'Bob' },
  ], 'the independent profile table must persist exact verified owners')

  console.log('STEM user profile checks passed')
} finally {
  closeStemDatabaseForTests()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
