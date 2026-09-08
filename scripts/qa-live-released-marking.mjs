// Explicit, one-answer live-provider canary. Uses random test-only signing
// keys and an in-memory attempt fixture; never opens a database or saves keys.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { mergeRuntimeEnv } from '../src/lib/runtimeEnv.js'
import { questionGroupsFromAiArtifacts } from '../server/aiVerifiedQuestionBank.js'
import { createAiApi, providerConfig } from '../server/aiApi.js'
import { canonicalAiMarkingProvenance } from '../src/lib/sourceContentContract.js'
import { issueMarkingCapabilities, signHmacJwt } from '../server/markingCapability.js'

assert.ok(process.argv.includes('--execute-live'), 'Live canary requires explicit --execute-live')
const arg = name => process.argv[process.argv.indexOf(name) + 1]
const answer = process.argv.includes('--answer') ? arg('--answer') : 'D'
const expectedScore = process.argv.includes('--expected-score') ? Number(arg('--expected-score')) : 1
assert.ok(/^[ABCD]$/.test(answer) && [0, 1].includes(expectedScore), 'Bounded synthetic choice and expected score required')
for (const key of ['--receipt', '--receipt-sha', '--cache-root', '--config-root', '--library-root']) assert.ok(process.argv.includes(key), key + ' is required')
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const receiptBytes = await fs.readFile(arg('--receipt')); assert.equal(digest(receiptBytes), arg('--receipt-sha'))
const receipt = JSON.parse(receiptBytes), artifacts = []
for (const item of receipt.files) { const bytes = await fs.readFile(item.source); assert.equal(digest(bytes), item.sha256); artifacts.push(JSON.parse(bytes)) }
const libraryRoot = path.resolve(arg('--library-root')), groups = questionGroupsFromAiArtifacts(artifacts, { libraryRoot })
const question = groups.find(q => q.sourceQuestionId === 'cie-0625-0625_w25_qp_21:q39')
assert.ok(question); const part = question.parts[0], canonical = canonicalAiMarkingProvenance(question, part)
assert.ok(canonical)
const identityKey = crypto.randomBytes(32).toString('hex'), signingKey = crypto.randomBytes(32).toString('hex'), userId = 'ielts:987654321', attemptId = 'local-live-source-canary'
const env = { ...mergeRuntimeEnv({ cwd: path.resolve(arg('--config-root')), env: process.env }),
  STEM_INTERNAL_AUTH_KEY: identityKey, STEM_MARKING_CAPABILITY_SIGNING_KEY: signingKey,
  STEM_SOURCE_PAGE_CACHE_ROOT: path.resolve(arg('--cache-root')) }
const config = providerConfig(env)
assert.ok(config.vision.apiKey, 'Vision provider is not configured in the selected runtime context')
assert.equal(config.vision.imageMode, 'data-url', 'Local canary must not publish source images to a URL')
const token = signHmacJwt({ sub: userId }, identityKey, { issuer: 'ieltsist.com', audience: 'stem.ieltsist.com' })
const provenance = { ...canonical, routeId: question.routeId }
const payload = { attemptId, mode: 'topic', paperId: question.sourceRef.paperId, submitted: true, provenance, typedResponse: '' }
const persistedAttempt = { userId, submissionStatus: 'submitted', submittedAt: new Date().toISOString(),
  binding: { attemptId, mode: 'topic', routeId: question.routeId, stage: question.stage, paperId: question.sourceRef.paperId,
    parts: [{ routeId: question.routeId, stage: question.stage, paperId: question.sourceRef.paperId, sourceQuestionId: question.sourceQuestionId, questionPartId: part.partId, provenance: canonical }] } }
const issued = issueMarkingCapabilities({ userId, payload: { ...payload, parts: [{ provenance }] }, questionBank: groups, signingKey, persistedAttempt })
assert.equal(issued.ok, true)
payload.markingGrant = issued.capabilities[0].markingGrant
const canvas = createCanvas(640, 240), ctx = canvas.getContext('2d')
ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 240); ctx.fillStyle = '#111'; ctx.font = '48px sans-serif'; ctx.fillText('Q39: ' + answer, 50, 130)
payload.imageDataUrl = 'data:image/jpeg;base64,' + (await canvas.encode('jpeg', 90)).toString('base64')
const telemetry = []
const schemaShapes = [], originalFetch = globalThis.fetch
if (process.argv.includes('--inspect-schema')) globalThis.fetch = async (...args) => {
  const response = await originalFetch(...args)
  if (!String(args[0]).startsWith('http://127.0.0.1:')) {
    try {
      const body = await response.clone().json(), text = body.choices?.[0]?.message?.content || '', value = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
      schemaShapes.push({ rawMarks: value.rawMarks, maxMarks: value.maxMarks, confidence: value.confidence, reviewRequired: value.reviewRequired,
        points: Array.isArray(value.markPoints) ? value.markPoints.map(p => ({ idPresent: typeof p.id === 'string' && !!p.id.trim(), awarded: p.awarded, marks: p.marks,
          reasonPresent: typeof p.reason === 'string' && !!p.reason.trim(), studentEvidencePresent: typeof p.studentEvidence === 'string' && !!p.studentEvidence.trim() })) : null })
    } catch { schemaShapes.push({ parseFailed: true }) }
  }
  return response
}
const handler = createAiApi({ env, libraryRoot, allowedSubjects: new Set(['0625']), questionBankProvider: () => groups,
  telemetry: event => telemetry.push({ provider: event.provider, model: event.model, statusCode: event.statusCode, schemaStatus: event.schemaStatus, durationMs: event.durationMs, finalState: event.finalState, fallback: event.fallback }) })
const server = http.createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end() }))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const post = value => fetch('http://127.0.0.1:' + server.address().port + '/api/ai/mark-handwriting', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(value), signal: AbortSignal.timeout(75000) })
try {
  const denied = await post({ ...payload, provenance: { ...provenance, sourceDocumentSha256: 'f'.repeat(64) } })
  assert.ok(denied.status >= 400); assert.equal(telemetry.length, 0, 'binding mismatch must stop before the provider')
  const start = performance.now(), response = await post(payload), result = await response.json(), elapsedMs = Math.round(performance.now() - start)
  const ok = response.status === 200 && result.mode === 'vision' && result.providerStatus === 'connected' && result.maxScore === 1 && result.score === expectedScore
  console.log(JSON.stringify({ status: ok ? 'PASS' : 'FAIL', scope: 'isolated HTTP handler, synthetic identity and answer, real released QP/MS and live provider',
    databaseAccess: false, productionDeployed: false, httpStatus: response.status, mode: result.mode, provider: result.provider, model: result.model,
    providerStatus: result.providerStatus, code: result.code, score: result.score, maxScore: result.maxScore, reviewRequired: result.reviewRequired,
    elapsedMs, sourceQuestionId: question.sourceQuestionId, syntheticAnswer: answer, expectedScore, negativeProviderCalls: 0, telemetry, schemaShapes }))
  if (!ok) process.exitCode = 1
} finally { globalThis.fetch = originalFetch; await new Promise(resolve => server.close(resolve)) }
