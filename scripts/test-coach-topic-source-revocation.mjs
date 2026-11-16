import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { createAiApi } from '../server/aiApi.js'
import { closeStemDatabaseForTests, createCoachAttemptAuthorizer, createStemApi } from '../server/stemApi.js'
import { studyQuestionBank } from '../src/data/questionBank.js'
import { canonicalSourcePracticeProvenance } from '../src/lib/sourceContentContract.js'
import { freeFetchPort } from './lib/fetch-safe-port.mjs'

const question = studyQuestionBank.find((item) => item.routeId === 'cie-9702-as-physics'
  && item.sourceRef?.paper === '9702_m25_qp_22.pdf' && item.sourceQuestionId?.endsWith(':q1'))
const part = question?.parts?.[0], provenance = part && canonicalSourcePracticeProvenance(question, part)
assert.ok(question && part && provenance)
const key = 'local-topic-coach-fixture-only'
const env = { NODE_ENV: 'test', STEM_DB_PATH: ':memory:', STEM_IDENTITY_SIGNING_KEY: key,
  STEM_ACADEMIC_PROVIDER: 'legacy', STEM_TAVERN_PROVIDER: 'legacy',
  TAVERN_IMAGE_PROVIDER_SETTINGS: path.join(os.tmpdir(), `absent-topic-image-provider-${crypto.randomUUID()}.json`),
  COACH_AI_API_KEY: 'synthetic-topic-coach-provider', COACH_AI_MODEL: 'synthetic-topic-coach' }
const now = Math.floor(Date.now() / 1000)
const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
const body = Buffer.from(JSON.stringify({ iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: 'ielts:940001',
  username: 'local-topic-coach', iat: now, exp: now + 3600 })).toString('base64url')
const token = `${head}.${body}.${crypto.createHmac('sha256', key).update(`${head}.${body}`).digest('base64url')}`
const listen = async (server) => {
  const port = await freeFetchPort()
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${port}`)) })
}
const close = (server) => new Promise((resolve) => server.close(resolve))
let providerCalls = 0, bankState = 'valid'
const upstream = http.createServer((_request, response) => {
  providerCalls += 1
  response.setHeader('content-type', 'text/event-stream')
  response.end('data: {"choices":[{"delta":{"content":"Local fixture answer."}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
})
env.COACH_AI_BASE_URL = await listen(upstream)
const sourceProvider = ({ routeId } = {}) => {
  if (routeId) assert.equal(routeId, question.routeId)
  if (bankState === 'unavailable') throw Object.assign(new Error('candidate unavailable'), { statusCode: 503, code: 'AI_STUDY_PROMOTION_INVALID' })
  return bankState === 'removed' ? [] : [question]
}
const stem = createStemApi({ env, questionBank: [], topicQuestionBankProvider: sourceProvider })
const authorizer = createCoachAttemptAuthorizer({ env, questionBank: [], questionBankProvider: sourceProvider })
const ai = createAiApi({ env, libraryRoot: process.cwd(), allowedSubjects: new Set(['9702']), authorizeCoachRequest: authorizer })
const app = http.createServer((request, response) => Promise.resolve(stem(request, response,
  () => ai(request, response, () => { response.statusCode = 404; response.end() })))
  .catch(() => { if (!response.headersSent) response.statusCode = 500; response.end() }))
const origin = await listen(app)
const attemptId = 'topic-coach-revocation-fixture-0001'
const post = async (url, payload) => {
  const response = await fetch(`${origin}${url}`, { method: 'POST', headers: { authorization: `Bearer ${token}`,
    'content-type': 'application/json' }, body: JSON.stringify(payload) })
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* SSE response. */ }
  return { status: response.status, contentType: response.headers.get('content-type') || '', json }
}
try {
  const saved = await post('/api/stem/attempts', { attemptId, mode: 'topic', routeId: question.routeId, stage: question.stage,
    paperId: question.sourceRef.paperId, markingParts: [{ provenance: { routeId: question.routeId, ...provenance } }],
    attempt: { id: attemptId, mode: 'topic', routeId: question.routeId, stage: question.stage, answers: {} } })
  assert.equal(saved.status, 201)
  const request = { message: 'Explain this question.', context: { view: 'chapter-practice', attemptId, routeId: question.routeId,
    stage: question.stage, paper: { id: question.sourceRef.paperId }, question: { id: question.sourceQuestionId },
    part: { id: part.partId, questionPartId: part.partId } } }
  assert.equal((await post('/api/ai/coach/stream', request)).status, 200)
  assert.equal(providerCalls, 1)
  bankState = 'unavailable'
  const unavailable = await post('/api/ai/coach/stream', request)
  assert.equal(unavailable.status, 503)
  assert.equal(unavailable.json?.code, 'AI_STUDY_PROMOTION_INVALID')
  assert.doesNotMatch(unavailable.contentType, /text\/event-stream/i)
  assert.equal(providerCalls, 1)
  bankState = 'removed'
  const removed = await post('/api/ai/coach/stream', request)
  assert.equal(removed.status, 409)
  assert.equal(removed.json?.code, 'coach_attempt_binding_mismatch')
  assert.equal(providerCalls, 1)
  bankState = 'valid'
  assert.equal((await post('/api/ai/coach/stream', request)).status, 200)
  assert.equal(providerCalls, 2)
  console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'topic-coach-revocation', rejectedProviderCalls: 0 }))
} finally {
  await Promise.all([close(app), close(upstream)])
  closeStemDatabaseForTests()
}
