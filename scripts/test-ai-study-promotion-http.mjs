import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { createAiApi } from '../server/aiApi.js'
import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { MARKING_CAPABILITY_AUDIENCE, MARKING_CAPABILITY_ISSUER, MARKING_CAPABILITY_SCOPE, signHmacJwt } from '../server/markingCapability.js'
import { createPdfDownloadPolicy, sendPdfAccessError } from '../server/pdfDownloadPolicy.js'
import { closeStemDatabaseForTests, createCoachAttemptAuthorizer, createStemApi } from '../server/stemApi.js'
import { createTopicPdfRenderer } from '../server/topicPdfRenderer.js'
import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { canonicalSourcePracticeProvenance } from '../src/lib/sourceContentContract.js'
import { sendLocalPdf } from '../vite.config.js'
import { freeFetchPort } from './lib/fetch-safe-port.mjs'

const worktreeRoot = fs.realpathSync(path.resolve(import.meta.dirname, '..'))
const root = fs.mkdtempSync(path.join(worktreeRoot, '.promotion-http-fixture-'))
const artifactRoot = path.join(root, 'artifacts')
fs.mkdirSync(artifactRoot)
const signingKey = 'local-only-promotion-http-fixture'
const env = { NODE_ENV: 'test', STEM_DB_PATH: ':memory:', STEM_INTERNAL_AUTH_KEY: signingKey,
  COACH_AI_API_KEY: 'local-only-provider-fixture', COACH_AI_MODEL: 'fixture-coach',
  STEM_ACADEMIC_PROVIDER: 'legacy', STEM_TAVERN_PROVIDER: 'legacy', TAVERN_IMAGE_PROVIDER_SETTINGS: path.join(root, 'absent-image-provider.json'),
  CIE_LIBRARY_ROOT: 'D:/CodexWork/cie-fraft-fetcher/output/pdf',
  STEM_PDF_DOWNLOAD_QUOTA_ENABLED: '1', STEM_PDF_DOWNLOAD_QUOTA_READY: '1' }
const paperId = 'cie-9702-9702_m25_qp_22'
const routeId = 'cie-9702-as-physics'
const attemptId = 'promotion-http-paper-attempt-0001'
const paperQuestions = unifiedQuestionBank.filter((question) => question.sourceRef?.paperId === paperId)
const markingParts = paperQuestions.flatMap((question) => (question.parts || []).flatMap((part) => {
  const provenance = canonicalSourcePracticeProvenance(question, part)
  return provenance ? [{ provenance: { routeId: question.routeId, ...provenance } }] : []
}))
const question = paperQuestions.find((item) => item.sourceQuestionId === `${paperId}:q1`)
const part = question?.parts?.[0]
assert.ok(question && part && markingParts.length > 0, 'the reviewed paper fixture must exist')

function identityToken() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: 'ielts:940001',
    username: 'local-promotion-fixture', iat: now, exp: now + 3600 })).toString('base64url')
  return `${header}.${payload}.${crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')}`
}
async function listen(server) {
  const port = await freeFetchPort()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${port}`))
  })
}
function close(server) { return new Promise((resolve) => server.close(resolve)) }

let providerCalls = 0
const provider = http.createServer((_request, response) => {
  providerCalls += 1
  response.statusCode = 200
  response.setHeader('content-type', 'application/json')
  response.end('{}')
})
const providerBase = await listen(provider)
env.COACH_AI_BASE_URL = providerBase
const loader = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot: root })
let activeLoader = loader
const groups = () => activeLoader().groups
let rendererCalls = 0
const topicPdfRenderer = async ({ routeId: requestedRoute, topicId }) => {
  rendererCalls += 1
  return { pdf: Buffer.from('%PDF-fixture'), manifest: { routeId: requestedRoute, topic: { id: topicId },
    authority: 'ai-provisional', studentStudyEligible: true, formalProgressEligible: false } }
}
const stemApi = createStemApi({ env, libraryRoot: root, topicQuestionBankProvider: groups, topicPdfRenderer })
const authorizer = createCoachAttemptAuthorizer({ env, questionBankProvider: groups })
const aiApi = createAiApi({ env, libraryRoot: root, allowedSubjects: new Set(['9702']),
  questionBankProvider: groups, authorizeCoachRequest: authorizer })
const pdfAuthorizationCalls = []
const quotaDatabase = new DatabaseSync(':memory:')
const quotaNow = Date.parse('2026-11-16T12:00:00+08:00')
const quotaPolicy = createPdfDownloadPolicy({ env, clock: () => quotaNow, databaseProvider: () => quotaDatabase,
  authenticateRequest: (request) => {
    if (request.headers['x-test-deny'] || request.headers.authorization !== `Bearer ${token}`) {
      throw Object.assign(new Error('Authentication required'), { statusCode: 401 })
    }
    return { id: 'ielts:940001' }
  },
  fetchImpl: async () => new Response(JSON.stringify({ protocol: 'stemist-membership-v1', authority: 'ieltsist-membership',
    userId: 'ielts:940001', checkedAt: new Date(quotaNow).toISOString(), maxAgeSeconds: 30, entitlement: { active: false } })),
})
async function authorizeFile({ request, sha256, consume }) {
  pdfAuthorizationCalls.push({ method: request.method, consume, sha256 })
  return quotaPolicy.authorize({ request, sha256, consume })
}
const server = http.createServer((request, response) => {
  if (String(request.url || '').startsWith('/local-pdf/')) {
    Promise.resolve(sendLocalPdf(request, response, () => { response.statusCode = 404; response.end() }, env,
      () => activeLoader().documents, { authorizeFile }))
      .catch((error) => { if (!sendPdfAccessError(response, error)) { if (!response.headersSent) response.statusCode = 500; response.end() } })
    return
  }
  Promise.resolve(stemApi(request, response, () => aiApi(request, response, () => { response.statusCode = 404; response.end() })))
    .catch(() => { if (!response.headersSent) response.statusCode = 500; response.end() })
})
const origin = await listen(server)
const token = identityToken()
async function request(url, { method = 'GET', body, headers = {}, binary = false } = {}) {
  const response = await fetch(`${origin}${url}`, { method, headers: { authorization: `Bearer ${token}`,
    ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const bytes = Buffer.from(await response.arrayBuffer())
  let payload = null
  if (!binary) { try { payload = JSON.parse(bytes.toString('utf8')) } catch { /* Response may be an error page. */ } }
  return { status: response.status, contentType: response.headers.get('content-type') || '', headers: response.headers, bytes, payload }
}
function expectPromotionFailure(result, label, code = 'AI_STUDY_PROMOTION_REQUIRED') {
  assert.equal(result.status, 503, `${label} must report a fail-closed HTTP 503`)
  assert.equal(result.payload?.code, code, `${label} must preserve the promotion error code`)
  assert.doesNotMatch(result.contentType, /text\/event-stream/i, `${label} must reject before SSE headers`)
}

try {
  const inventoryUrl = `/api/stem/routes/${routeId}/syllabus-topics`
  assert.equal((await request(inventoryUrl)).status, 200, 'the legacy root must load before a candidate marker exists')
  let discoveredPaths = 0
  const directRenderer = createTopicPdfRenderer({ artifactRoot, libraryRoot: root, artifactPaths: () => { discoveredPaths += 1; return [] } })
  const topicRequest = { routeId, topicId: 'physics-9702-topic-01' }
  await assert.rejects(directRenderer(topicRequest), { code: 'topic_pdf_empty' }, 'legacy direct renderer still reaches discovery')
  assert.equal(discoveredPaths, 1)
  const saved = await request('/api/stem/attempts', { method: 'POST', body: {
    attemptId, mode: 'full-paper', routeId, stage: 'AS', paperId, markingParts,
    attempt: { id: attemptId, mode: 'full-paper', routeId, stage: 'AS', paperId,
      paperStudyMode: 'past-paper-practice', questionCount: 7, answeredCount: 0, answers: {} },
  } })
  assert.equal(saved.status, 201, 'the authorized legacy paper draft must persist before the simulated gate failure')
  const originalHistory = await request('/api/stem/attempts')
  assert.equal(originalHistory.status, 200)
  assert.equal(originalHistory.payload.attempts.length, 1)
  assert.equal(originalHistory.payload.attempts[0].attemptId, attemptId)
  const markerPath = path.join(artifactRoot, 'active-safe-manifest.json')
  fs.writeFileSync(markerPath, JSON.stringify({ productionEligible: false }))

  expectPromotionFailure(await request(inventoryUrl), 'inventory')
  expectPromotionFailure(await request('/api/stem/practice-sets', { method: 'POST', body: {
    routeId, syllabusTopicIds: ['physics-9702-topic-01'], components: [1], questionCount: 1,
    studyMode: 'chapter-study', foundationCatalog: 'v2', excludeAttempted: false,
  } }), 'practice start')
  const provenance = markingParts[0].provenance
  const markingGrant = signHmacJwt({ sub: 'ielts:940001', scope: MARKING_CAPABILITY_SCOPE, attemptId,
    mode: 'full-paper', paperId, ...provenance }, signingKey,
  { issuer: MARKING_CAPABILITY_ISSUER, audience: MARKING_CAPABILITY_AUDIENCE })
  expectPromotionFailure(await request('/api/ai/mark-handwriting', { method: 'POST', body: {
    submitted: true, mode: 'full-paper', paperId, attemptId, provenance, markingGrant,
  } }), 'marking')
  expectPromotionFailure(await request('/api/ai/coach/stream', { method: 'POST', body: {
    message: 'Explain this question.', context: { view: 'full-paper', attemptId, routeId, stage: 'AS',
      paperStudyMode: 'past-paper-practice', paper: { id: paperId },
      question: { id: question.sourceQuestionId, number: 1 },
      part: { id: part.partId, questionPartId: part.partId, label: part.label }, responseStatus: 'unanswered' },
  } }), 'Coach stream')
  expectPromotionFailure(await request(`/api/stem/practice-source-image?routeId=${encodeURIComponent(routeId)}&sourceQuestionId=${encodeURIComponent(question.sourceQuestionId)}&region=0&v=${'a'.repeat(64)}`), 'question image')
  expectPromotionFailure(await request('/api/stem/topic-pdfs', { method: 'POST', body: {
    routeId, topicId: 'physics-9702-topic-01',
  } }), 'topic PDF')
  const historyDuringFailure = await request('/api/stem/attempts')
  assert.equal(historyDuringFailure.status, 200, 'stored attempts remain readable while the bank is unavailable')
  assert.deepEqual(historyDuringFailure.payload.attempts, originalHistory.payload.attempts)
  await assert.rejects(directRenderer(topicRequest), { code: 'AI_STUDY_PROMOTION_REQUIRED' },
    'the direct renderer must reject the candidate before reading artifacts')
  assert.equal(discoveredPaths, 1)
  expectPromotionFailure(await request('/local-pdf/9702/9702_m99_qp_99.pdf'), 'runtime-only PDF')

  const staticUrl = '/local-pdf/9702/9702_m25_qp_42.pdf'
  const staticFile = path.join(env.CIE_LIBRARY_ROOT, '9702', '9702_m25_qp_42.pdf')
  assert.ok(fs.statSync(staticFile).isFile(), 'the original public exam PDF fixture is present')
  const original = await request(staticUrl, { binary: true })
  assert.equal(original.status, 200, 'a separately governed static PDF remains downloadable')
  assert.match(original.contentType, /^application\/pdf/)
  assert.equal(original.bytes.length, fs.statSync(staticFile).size)
  assert.equal(original.headers.get('x-pdf-quota-reused'), 'false')
  assert.equal(original.headers.get('x-pdf-quota-used'), '1')
  const head = await request(staticUrl, { method: 'HEAD', binary: true })
  assert.equal(head.status, 200, 'static HEAD remains available without consuming quota')
  assert.equal(head.bytes.length, 0)
  assert.equal(Number(head.headers.get('content-length')), original.bytes.length)
  const range = await request(staticUrl, { headers: { range: 'bytes=0-31' }, binary: true })
  assert.equal(range.status, 206, 'static byte ranges remain available')
  assert.deepEqual(range.bytes, original.bytes.subarray(0, 32))
  assert.equal(range.headers.get('content-range'), `bytes 0-31/${original.bytes.length}`)
  assert.equal(range.headers.get('x-pdf-quota-reused'), 'true')
  assert.deepEqual(pdfAuthorizationCalls.map(({ method, consume }) => ({ method, consume })), [
    { method: 'GET', consume: true }, { method: 'HEAD', consume: false }, { method: 'GET', consume: true },
  ])
  assert.equal(new Set(pdfAuthorizationCalls.map(({ sha256 }) => sha256)).size, 1)
  const denied = await request(staticUrl, { headers: { 'x-test-deny': '1' } })
  assert.equal(denied.status, 401, 'static PDF authorization denial is preserved')
  assert.equal(denied.payload?.code, 'pdf_auth_required')
  const secondPdf = await request('/local-pdf/9702/9702_m25_ms_42.pdf', { binary: true })
  assert.equal(secondPdf.status, 200)
  assert.equal(secondPdf.headers.get('x-pdf-quota-used'), '2')
  const overQuota = await request('/local-pdf/9702/9702_m25_qp_22.pdf')
  assert.equal(overQuota.status, 429, 'a different static PDF must still respect the actual daily limit')
  assert.equal(overQuota.payload?.code, 'pdf_daily_limit_reached')
  assert.equal(providerCalls, 0, 'promotion rejection must make zero provider calls')
  assert.equal(rendererCalls, 0, 'promotion rejection must not render a candidate topic PDF')

  activeLoader = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot: root,
    promotionPolicy: { mode: 'signed-candidate', trustedPublicKeys: {} } })
  expectPromotionFailure(await request(inventoryUrl), 'invalid signed candidate inventory', 'AI_STUDY_PROMOTION_INVALID')

  fs.unlinkSync(markerPath)
  activeLoader = loader
  assert.equal((await request(inventoryUrl)).status, 200, 'legacy inventory must recover after the candidate marker is removed')
  const recoveredHistory = await request('/api/stem/attempts')
  assert.equal(recoveredHistory.status, 200)
  assert.deepEqual(recoveredHistory.payload.attempts, originalHistory.payload.attempts)
  const rebound = await authorizer({ request: { headers: { authorization: `Bearer ${token}` } }, payload: {
    context: { view: 'full-paper', attemptId, routeId, stage: 'AS', paperStudyMode: 'past-paper-practice',
      paper: { id: paperId }, question: { id: question.sourceQuestionId, number: 1 },
      part: { id: part.partId, questionPartId: part.partId, label: part.label }, responseStatus: 'unanswered' },
  } })
  assert.equal(rebound?.coachAccess?.binding, 'authoritative-attempt', 'the retained draft must rebind after recovery')
  console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', http503Paths: 8, providerCalls, rendererCalls,
    legacyInventory: 'PASS', staticPdf: 'GET/HEAD/Range/auth/quota PASS', directRenderer: 'PASS',
    persistedDraft: 'readable during failure and rebound after recovery' }))
} finally {
  await Promise.all([close(server), close(provider)])
  quotaDatabase.close()
  closeStemDatabaseForTests()
  const resolved = fs.realpathSync(root)
  assert.equal(path.dirname(resolved), worktreeRoot)
  assert.ok(path.basename(resolved).startsWith('.promotion-http-fixture-'))
  fs.rmSync(resolved, { recursive: true, force: true })
}
