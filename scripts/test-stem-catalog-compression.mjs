import assert from 'node:assert/strict'
import http from 'node:http'
import { gunzipSync } from 'node:zlib'
import { createStemApi, closeStemDatabaseForTests } from '../server/stemApi.js'
import { sendPublicCatalogJson } from '../server/publicCatalogJson.js'

const api = createStemApi({ env: { NODE_ENV: 'production', STEM_DB_PATH: ':memory:' } })
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/test-public-helper/')) {
    if (req.url.endsWith('/vary')) res.setHeader('Vary', 'Origin')
    if (req.url.endsWith('/vary-star')) res.setHeader('Vary', '*')
    if (req.url.endsWith('/set-cookie')) res.setHeader('Set-Cookie', 'test-fixture=1; HttpOnly')
    return sendPublicCatalogJson(req, res, 200, { label: 'source fixture', text: req.url.endsWith('/small') ? 'small' : 'source content '.repeat(300) })
  }
  return api(req, res, () => {
  res.statusCode = 404
  res.end()
  })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const spec = {
  routeId: 'cie-9702-as-physics', syllabusTopicIds: ['physics-9702-topic-07'],
  questionCount: 6, components: [1, 2], excludeAttempted: false, seed: 9,
}
function request(path, { encoding, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const rawBody = body ? Buffer.from(JSON.stringify(body)) : null
    const req = http.request(base + path, {
      method: body ? 'POST' : 'GET', headers: {
        ...(encoding === undefined ? {} : { 'Accept-Encoding': encoding }),
        ...(rawBody ? { 'Content-Type': 'application/json', 'Content-Length': rawBody.length } : {}),
        ...headers,
      },
    }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('error', reject)
      res.on('end', () => {
        const wire = Buffer.concat(chunks)
        const decoded = res.headers['content-encoding'] === 'gzip' ? gunzipSync(wire) : wire
        resolve({ status: res.statusCode, headers: res.headers, wire, body: JSON.parse(decoded) })
      })
    })
    req.on('error', reject)
    req.setTimeout(5000, () => req.destroy(new Error('local JSON response timed out')))
    req.end(rawBody)
  })
}
try {
  const url = '/api/stem/practice-sets'
  const plain = await request(url, { body: spec })
  assert.equal(plain.status, 201)
  assert.equal(plain.headers['content-encoding'], undefined)
  assert.equal(plain.body.questionCount, 6)
  assert.equal(plain.body.ownerId, null)
  const gzip = await request(url, { body: spec, encoding: 'gzip, deflate, br' })
  assert.equal(gzip.status, 201)
  assert.equal(gzip.headers['content-encoding'], 'gzip', 'public practice-set JSON must negotiate gzip')
  assert.equal(Number(gzip.headers['content-length']), gzip.wire.length)
  assert.match(gzip.headers.vary, /(?:^|,\s*)Accept-Encoding(?:,|$)/i)
  assert.equal(gzip.headers['cache-control'], 'no-store')
  // Request timestamps may differ; the actual questions, binding and source
  // evidence must be byte-for-byte equivalent after transport decoding.
  assert.deepEqual(gzip.body.questionGroups, plain.body.questionGroups)
  assert.deepEqual(gzip.body.sourceQuestionIds, plain.body.sourceQuestionIds)
  assert.ok(gzip.wire.length < plain.wire.length * 0.5, 'source JSON should shrink without dropping source fields')
  for (const encoding of ['identity', 'gzip;q=0', 'br, gzip;q=0, *;q=1', 'gzip;q=broken', 'gzip;q=0, gzip;q=1', 'xgzip', 'gzip;q=0.2, identity;q=1']) {
    const result = await request(url, { body: spec, encoding })
    assert.equal(result.headers['content-encoding'], undefined, encoding)
    assert.deepEqual(result.body.questionGroups, plain.body.questionGroups)
  }
  for (const encoding of ['GZip', 'br, gzip;q=0.5', '*;q=0.8', 'gzip;q=1.000, identity;q=0']) {
    assert.equal((await request(url, { body: spec, encoding })).headers['content-encoding'], 'gzip', encoding)
  }
  const topics = await request('/api/stem/routes/cie-9702-as-physics/syllabus-topics', { encoding: 'gzip' })
  assert.equal(topics.status, 200)
  assert.equal(topics.headers['content-encoding'], 'gzip')
  assert.ok(topics.body.topics.length > 0)
  const cookieRequest = await request(url, { body: spec, encoding: 'gzip', headers: { Cookie: 'test-fixture=1' } })
  assert.equal(cookieRequest.status, 201)
  assert.equal(cookieRequest.headers['content-encoding'], undefined, 'cookie-bearing responses stay outside the public compressor')
  const auth = await request('/api/auth/status', { encoding: 'gzip' })
  assert.equal(auth.headers['content-encoding'], undefined, 'account responses are not opted in')
  assert.equal(auth.body.authenticated, false)
  const forbidden = await request(url, { body: spec, encoding: 'gzip', headers: { Authorization: 'Bearer invalid-test-fixture' } })
  assert.equal(forbidden.status, 401)
  assert.equal(forbidden.headers['content-encoding'], undefined)
  const failed = await request(url, { body: { ...spec, questionCount: 5 }, encoding: 'gzip' })
  assert.equal(failed.status, 400)
  assert.equal(failed.headers['content-encoding'], undefined, 'error details are never compressed by the public path')
  assert.equal((await request('/test-public-helper/small', { encoding: 'gzip' })).headers['content-encoding'], undefined)
  assert.equal((await request('/test-public-helper/vary', { encoding: 'gzip' })).headers.vary, 'Origin, Accept-Encoding')
  assert.equal((await request('/test-public-helper/vary-star', { encoding: 'gzip' })).headers.vary, '*')
  assert.equal((await request('/test-public-helper/set-cookie', { encoding: 'gzip' })).headers['content-encoding'], undefined)
  assert.equal((await request('/test-public-helper/private', { encoding: 'gzip', headers: { Authorization: 'Bearer invalid-test-fixture' } })).headers['content-encoding'], undefined)
  console.log(JSON.stringify({ status: 'PASS', scope: 'public catalog HTTP compression and private-response isolation',
    plainBytes: plain.wire.length, gzipBytes: gzip.wire.length,
    reductionPercent: Math.round(100 * (1 - gzip.wire.length / plain.wire.length)) }))
} finally {
  await new Promise(resolve => server.close(resolve))
  closeStemDatabaseForTests()
}
