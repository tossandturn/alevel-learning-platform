import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const signingKey = 'stem-coach-history-test-signing-key'
const remoteCalls = []
const remoteStore = new Map()

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function identityToken({ userId = 'ielts:42', expiresAt = Math.floor(Date.now() / 1000) + 300 } = {}) {
  const header = base64url({ alg: 'HS256', typ: 'JWT' })
  const payload = base64url({
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: userId,
    username: 'student',
    roles: ['student'],
    iat: Math.floor(Date.now() / 1000),
    exp: expiresAt,
  })
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function call(api, { method, url, body, token = identityToken(), headers = {} }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    request.method = method
    request.url = url
    request.headers = {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    }
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

function signedPayload(parsed, options) {
  const body = String(options.body || '')
  return String(options.method || 'GET').toUpperCase() === 'GET'
    ? `${body}\n${parsed.pathname}${parsed.search}`
    : body
}

function expectedInternalSignature(parsed, options) {
  const timestamp = String(options.headers?.['X-Stem-Auth-Timestamp'] || '')
  const digest = crypto.createHash('sha256').update(signedPayload(parsed, options)).digest('hex')
  return crypto.createHmac('sha256', signingKey).update(`${timestamp}.${digest}`).digest('base64url')
}

function remoteConversations() {
  return [...remoteStore.values()].map((conversation) => structuredClone(conversation))
}

const fetchImpl = async (url, options = {}) => {
  const parsed = new URL(url)
  remoteCalls.push({ url: String(url), options })
  assert.equal(parsed.pathname, '/api/internal/stem/coach/conversations')
  assert.equal(
    options.headers?.['X-Stem-Auth-Signature'],
    expectedInternalSignature(parsed, options),
    'the STEM proxy must sign GET path and query exactly as the central service verifies',
  )
  const payload = options.body ? JSON.parse(options.body) : {}
  assert.equal(payload.userId || parsed.searchParams.get('userId'), 'ielts:42')
  if (options.method === 'GET') {
    assert.equal(parsed.searchParams.get('limit'), '80', 'the client-requested history limit must reach the central service')
    await new Promise((resolve) => setTimeout(resolve, 8))
    return new Response(JSON.stringify({ conversations: remoteConversations() }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const conversations = payload.conversations || (payload.conversation ? [payload.conversation] : [])
  conversations.forEach((conversation) => remoteStore.set(conversation.conversationId, structuredClone(conversation)))
  return new Response(JSON.stringify({ conversations }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const api = createStemApi({
  env: {
    STEM_IDENTITY_SIGNING_KEY: signingKey,
    STEM_AUTH_INTERNAL_ORIGIN: 'http://127.0.0.1:4321',
    STEM_DB_PATH: ':memory:',
  },
  fetchImpl,
})

try {
  const anonymous = await call(api, { method: 'GET', url: '/api/stem/coach/conversations', token: '' })
  assert.equal(anonymous.statusCode, 401)

  remoteStore.set('stem-conv-1', {
    conversationId: 'stem-conv-1',
    sourceProduct: 'stem',
    binding: { routeId: 'cie-9702-as-physics', questionId: 'q4' },
    contextText: 'Official OCR: resolve the resultant force and state the unit.',
    messages: [{ role: 'assistant', content: 'A reply from another device.', createdAt: '2026-08-18T00:00:00.000Z' }],
  })
  const saved = await call(api, {
    method: 'PUT',
    url: '/api/stem/coach/conversations',
    body: {
      conversation: {
        conversationId: 'stem-conv-1',
        sourceProduct: 'stem',
        binding: { routeId: 'cie-9702-as-physics', questionId: 'q4' },
        contextText: 'Official OCR: resolve the resultant force and state the unit.\nStudent response: 12 N to the right.\ndata:image/png;base64,private-context-image',
        messages: [{
          role: 'user',
          content: 'Explain the force balance.',
          attachmentCount: 2,
          attachments: [{ type: 'image', mimeType: 'image/png', source: 'student-upload' }],
          createdAt: '2026-08-18T00:00:01.000Z',
        }],
      },
    },
  })
  assert.equal(saved.statusCode, 200)
  assert.deepEqual(saved.body.conversations.map((item) => item.conversationId), ['stem-conv-1'])
  assert.deepEqual(
    saved.body.conversations[0].messages.map((message) => message.content),
    ['A reply from another device.', 'Explain the force balance.'],
    'a stale local save must merge the current central conversation before it is written',
  )
  assert.equal(
    remoteStore.get('stem-conv-1').contextText,
    'Official OCR: resolve the resultant force and state the unit. Student response: 12 N to the right. [image omitted]',
    'retry-safe OCR/question context must survive the STEM proxy write without image bytes',
  )
  assert.doesNotMatch(JSON.stringify(remoteStore.get('stem-conv-1')), /data:image|base64|private-image/)
  assert.deepEqual(remoteCalls.map((item) => item.options.method), ['GET', 'PUT'])
  assert.equal(new URL(remoteCalls[0].url).pathname, '/api/internal/stem/coach/conversations')
  assert.equal(JSON.parse(remoteCalls[1].options.body).userId, 'ielts:42')

  const restored = await call(api, { method: 'GET', url: '/api/stem/coach/conversations?limit=80' })
  assert.equal(restored.statusCode, 200)
  assert.deepEqual(restored.body.conversations.map((item) => item.conversationId), ['stem-conv-1'])
  assert.equal(
    restored.body.conversations[0].contextText,
    'Official OCR: resolve the resultant force and state the unit. Student response: 12 N to the right. [image omitted]',
    'remote hydration must return the persisted contextText used to rebuild Coach retry',
  )
  assert.equal(remoteCalls.length, 3)
  assert.equal(new URL(remoteCalls[2].url).searchParams.get('userId'), 'ielts:42')

  const attemptedAccountOverride = await call(api, {
    method: 'PUT',
    url: '/api/stem/coach/conversations',
    body: {
      userId: 'ielts:99',
      conversation: {
        conversationId: 'stem-conv-account-boundary',
        sourceProduct: 'stem',
        messages: [{ role: 'user', content: 'This must remain in account 42.', createdAt: '2026-08-18T00:00:30.000Z' }],
      },
    },
  })
  assert.equal(attemptedAccountOverride.statusCode, 200, 'a client body must not be able to replace the verified account identity')
  assert.equal(
    JSON.parse(remoteCalls.at(-1).options.body).userId,
    'ielts:42',
    'the central history write must always use the subject from the verified STEM token',
  )

  remoteStore.set('stem-conv-stream-retry', {
    conversationId: 'stem-conv-stream-retry',
    sourceProduct: 'stem',
    messages: [{
      id: 'assistant-stream-1',
      role: 'assistant',
      content: 'Long partial guidance that was visible before the connection dropped.',
      createdAt: '2026-08-18T00:00:40.000Z',
      updatedAt: '2026-08-18T00:00:41.000Z',
      status: 'interrupted',
    }],
  })
  const retriedStream = await call(api, {
    method: 'PUT',
    url: '/api/stem/coach/conversations',
    body: {
      conversation: {
        conversationId: 'stem-conv-stream-retry',
        sourceProduct: 'stem',
        messages: [{
          id: 'assistant-stream-1',
          role: 'assistant',
          content: 'Use F = ma for the resultant force.',
          createdAt: '2026-08-18T00:00:40.000Z',
          updatedAt: '2026-08-18T00:00:42.000Z',
          status: 'completed',
        }],
      },
    },
  })
  assert.equal(retriedStream.statusCode, 200)
  assert.deepEqual(
    remoteStore.get('stem-conv-stream-retry').messages.map(({ id, content, status }) => ({ id, content, status })),
    [{
      id: 'assistant-stream-1',
      content: 'Use F = ma for the resultant force.',
      status: 'completed',
    }],
    'a completed retry must overwrite the same persisted assistant slot instead of creating a duplicate partial reply',
  )

  remoteStore.delete('stem-conv-concurrent')
  const concurrentStart = remoteCalls.length
  const [firstConcurrent, secondConcurrent] = await Promise.all([
    call(api, {
      method: 'PUT',
      url: '/api/stem/coach/conversations',
      body: {
        conversation: {
          conversationId: 'stem-conv-concurrent',
          sourceProduct: 'stem',
          messages: [{ role: 'user', content: 'Message from device A.', createdAt: '2026-08-18T00:01:00.000Z' }],
        },
      },
    }),
    call(api, {
      method: 'PUT',
      url: '/api/stem/coach/conversations',
      body: {
        conversation: {
          conversationId: 'stem-conv-concurrent',
          sourceProduct: 'stem',
          messages: [{ role: 'user', content: 'Message from device B.', createdAt: '2026-08-18T00:01:01.000Z' }],
        },
      },
    }),
  ])
  assert.equal(firstConcurrent.statusCode, 200)
  assert.equal(secondConcurrent.statusCode, 200)
  assert.deepEqual(
    remoteStore.get('stem-conv-concurrent').messages.map((message) => message.content),
    ['Message from device A.', 'Message from device B.'],
    'parallel saves for the same account and conversation must serialize read-merge-write so neither device loses its turn',
  )
  assert.deepEqual(
    remoteCalls.slice(concurrentStart).map((item) => item.options.method),
    ['GET', 'PUT', 'GET', 'PUT'],
    'same-account writes must complete one read-merge-write transaction at a time',
  )

  const expired = await call(api, {
    method: 'GET',
    url: '/api/stem/coach/conversations',
    token: identityToken({ expiresAt: Math.floor(Date.now() / 1000) - 1 }),
  })
  assert.equal(expired.statusCode, 401)
  assert.equal(remoteCalls.length, 11)
  console.log('STEM Coach conversation proxy checks passed')
} finally {
  closeStemDatabaseForTests()
}
