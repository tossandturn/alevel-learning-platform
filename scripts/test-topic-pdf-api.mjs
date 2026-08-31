import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const signingKey = 'topic-pdf-api-test-key'
const env = { STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: ':memory:' }
const routeId = 'cie-9702-a2-physics'
const topicId = 'physics-9702-topic-13'

function identityToken(userId = 42) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: `ielts:${userId}`,
    iat: now,
    exp: now + 300,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function call(api, { body, token = '', method = 'POST' }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
    request.method = method
    request.url = '/api/stem/topic-pdfs'
    request.headers = {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    }
    const chunks = []
    const response = {
      statusCode: 0,
      headers: new Map(),
      setHeader(name, value) { this.headers.set(name.toLowerCase(), String(value)) },
      write(chunk) { chunks.push(Buffer.from(chunk)) },
      end(chunk = '') {
        if (chunk !== '') chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        const buffer = Buffer.concat(chunks)
        let json = null
        try { json = JSON.parse(buffer.toString('utf8')) } catch { /* PDF response. */ }
        resolve({ statusCode: this.statusCode, headers: Object.fromEntries(this.headers), buffer, json })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error('Unhandled topic PDF request')))).catch(reject)
  })
}

const calls = []
const renderer = async (input) => {
  calls.push(input)
  return {
    pdf: Buffer.from('%PDF-1.4 topic fixture', 'ascii'),
    manifest: { questionCount: 2, routeId: input.routeId, topic: { id: input.topicId } },
  }
}

try {
  const api = createStemApi({ env, questionBank: [], topicPdfRenderer: renderer })
  const anonymous = await call(api, { body: { routeId, topicId } })
  assert.equal(anonymous.statusCode, 401)
  assert.equal(calls.length, 0, 'unauthenticated requests must not invoke the renderer')

  const extraField = await call(api, { token: identityToken(), body: { routeId, topicId, outputPath: 'attacker-controlled' } })
  assert.equal(extraField.statusCode, 400)
  assert.equal(extraField.json?.code, 'topic_pdf_request_invalid')
  assert.equal(calls.length, 0, 'invalid request fields must not invoke the renderer')

  const success = await call(api, { token: identityToken(), body: { routeId, topicId } })
  assert.equal(success.statusCode, 200, success.buffer.toString('utf8'))
  assert.equal(success.headers['content-type'], 'application/pdf')
  assert.equal(success.buffer.subarray(0, 5).toString('ascii'), '%PDF-')
  assert.deepEqual(calls, [{ routeId, topicId }])

  const failingApi = createStemApi({
    env: { ...env, STEM_DB_PATH: ':memory:' },
    questionBank: [],
    topicPdfRenderer: async () => { throw Object.assign(new Error('binding failed'), { statusCode: 409, code: 'topic_pdf_binding_mismatch' }) },
  })
  const failed = await call(failingApi, { token: identityToken(), body: { routeId, topicId } })
  assert.equal(failed.statusCode, 409)
  assert.equal(failed.json?.code, 'topic_pdf_binding_mismatch')
} finally {
  closeStemDatabaseForTests()
}

console.log('Topic PDF API contract passed.')
