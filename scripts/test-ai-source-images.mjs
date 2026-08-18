import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createAiApi } from '../server/aiApi.js'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { unifiedQuestionBank } from '../src/data/questionBank.js'
import { canonicalSourceMarkingProvenance } from '../src/lib/sourceContentContract.js'

const root = path.resolve(import.meta.dirname, '..')
const blankPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+1P6Q6QAAAABJRU5ErkJggg=='

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(`http://127.0.0.1:${server.address().port}`)
    })
  })
}

function close(server) {
  return new Promise((resolve) => server.close(resolve))
}

function requestHandler(...middlewares) {
  return http.createServer((request, response) => {
    let index = 0
    const next = () => {
      const middleware = middlewares[index++]
      if (!middleware) {
        response.statusCode = 404
        response.end()
        return
      }
      middleware(request, response, next)
    }
    next()
  })
}

const testSigningKey = 'source-image-test-internal-key'

function identityToken(userId = 42) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: `ielts:${userId}`,
    username: 'source-image-test',
    iat: now,
    exp: now + 3600,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', testSigningKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function canonicalRequest(questionNumber, partLabel, { mode = 'topic', paperId = '' } = {}) {
  const question = unifiedQuestionBank.find((item) => item.sourceQuestionId === `cie-0580-0580_m25_qp_12:q${questionNumber}`)
  const part = question?.parts.find((item) => item.label === partLabel)
  assert.ok(question && part, `reviewed Q${questionNumber}(${partLabel}) fixture must exist`)
  return {
    attemptId: 'source-image-attempt',
    mode,
    paperId: paperId || question.sourceRef.paperId,
    submitted: true,
    imageDataUrl: blankPng,
    typedResponse: 'student handwriting transcription',
    provenance: {
      routeId: question.routeId,
      ...canonicalSourceMarkingProvenance(question, part),
    },
  }
}

function officialImagesFromCall(call) {
  const content = call.messages?.[1]?.content || []
  const context = JSON.parse(content[0].text)
  return {
    context,
    images: content.filter((item) => item.type === 'image_url').map((item) => item.image_url.url),
    labels: content.filter((item) => item.type === 'text').map((item) => item.text),
  }
}

function sha256ForDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:[^;]+;base64,(.+)$/)
  assert.ok(match, 'provider official image must be a base64 data URL in the capture fixture')
  return crypto.createHash('sha256').update(Buffer.from(match[1], 'base64')).digest('hex')
}

async function post(url, body, token = '') {
  const response = await fetch(`${url}/api/ai/mark-handwriting`, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { response, payload: await response.json() }
}

async function issueCapability(url, request, token, overrides = {}) {
  const response = await fetch(`${url}/api/stem/marking/capabilities`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attemptId: request.attemptId,
      mode: request.mode,
      submitted: request.submitted,
      paperId: request.paperId || '',
      parts: [{ provenance: { ...request.provenance } }],
      ...overrides,
    }),
  })
  return { response, payload: await response.json() }
}

const providerCalls = []
const providerServer = http.createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  providerCalls.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          rawMarks: 1,
          maxMarks: 1,
          confidence: 0.92,
          reviewRequired: false,
          summary: 'Captured official image context.',
          markPoints: [],
        }),
      },
    }],
  }))
})

const providerBase = await listen(providerServer)
const testDbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-source-image-db-'))
const env = {
  VISION_AI_API_KEY: 'test-only-provider-key',
  VISION_AI_BASE_URL: providerBase,
  VISION_AI_MODEL: 'qwen-test-vision',
  STEM_INTERNAL_AUTH_KEY: testSigningKey,
  STEM_MARKING_CAPABILITY_SIGNING_KEY: 'source-image-test-capability-key',
  STEM_DB_PATH: path.join(testDbRoot, 'stem.sqlite'),
}
const allowedSubjects = new Set(['0580'])
const sourceLibraryRoot = path.join(root, 'missing-test-library')
const api = createAiApi({ env, libraryRoot: sourceLibraryRoot, allowedSubjects })
const stemApi = createStemApi({ env })
const appServer = requestHandler(stemApi, api)
const appBase = await listen(appServer)
const emptyAssetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-source-assets-missing-'))
const missingApi = createAiApi({ env, libraryRoot: sourceLibraryRoot, allowedSubjects, sourceAssetRoot: emptyAssetRoot })
const missingServer = requestHandler(stemApi, missingApi)
const missingBase = await listen(missingServer)
const tamperedAssetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-source-assets-tampered-'))
const tamperedPaperRoot = path.join(tamperedAssetRoot, 'cie-0580-0580_m25_qp_12')
const trustedPaperRoot = path.join(root, 'public', 'question-assets', 'cie-0580-0580_m25_qp_12')
fs.mkdirSync(tamperedPaperRoot, { recursive: true })
for (const fileName of ['ms-07.jpg', 'qp-09.jpg', 'ms-08.jpg']) {
  fs.copyFileSync(path.join(trustedPaperRoot, fileName), path.join(tamperedPaperRoot, fileName))
}
const tamperedQpBytes = fs.readFileSync(path.join(trustedPaperRoot, 'qp-04.jpg'))
tamperedQpBytes[tamperedQpBytes.length - 2] ^= 1
fs.writeFileSync(path.join(tamperedPaperRoot, 'qp-04.jpg'), tamperedQpBytes)
const tamperedQ14Bytes = fs.readFileSync(path.join(trustedPaperRoot, 'qp-09.jpg'))
tamperedQ14Bytes[tamperedQ14Bytes.length - 2] ^= 1
fs.writeFileSync(path.join(tamperedPaperRoot, 'qp-09.jpg'), tamperedQ14Bytes)
const tamperedApi = createAiApi({ env, libraryRoot: sourceLibraryRoot, allowedSubjects, sourceAssetRoot: tamperedAssetRoot })
const tamperedServer = requestHandler(stemApi, tamperedApi)
const tamperedBase = await listen(tamperedServer)
const signedIdentity = identityToken()

async function authorizedRequest(url, questionNumber, partLabel, options = {}) {
  const request = canonicalRequest(questionNumber, partLabel, options)
  const capability = await issueCapability(url, request, signedIdentity)
  assert.equal(capability.response.status, 201, `Q${questionNumber}(${partLabel}) capability must be issued for the submitted reviewed attempt`)
  const markingGrant = capability.payload.capabilities?.[0]?.markingGrant
  assert.ok(markingGrant, `Q${questionNumber}(${partLabel}) capability must contain a marking grant`)
  return { request: { ...request, markingGrant }, token: signedIdentity }
}

try {
  const q5Request = await authorizedRequest(appBase, 5, 'a')
  const q5 = await post(appBase, q5Request.request, q5Request.token)
  assert.equal(q5.response.status, 200, 'reviewed visual Q5 must reach the provider with trusted official images')
  assert.equal(q5.payload.mode, 'vision')
  assert.equal(providerCalls.length, 1)
  const q5Images = officialImagesFromCall(providerCalls.at(-1))
  assert.deepEqual(q5Images.context.imageOrder, { questionPaperPages: 1, markSchemePages: 1, studentResponsePages: 1 })
  assert.deepEqual(q5Images.context.officialSourceImages.map((item) => [item.role, item.page]), [
    ['question-paper', 4],
    ['mark-scheme', 7],
  ], 'visual Q5 must include its official QP and exact paired MS image')
  assert.equal(q5Images.images.length, 3, 'provider receives QP, MS and student response images in one canonical payload')
  assert.ok(q5Images.labels.some((label) => /question-paper page 4; SHA-256 [a-f0-9]{64}/.test(label)))
  assert.ok(q5Images.labels.some((label) => /mark-scheme page 7; SHA-256 [a-f0-9]{64}/.test(label)))

  const typedOnly = await post(appBase, {
    ...q5Request.request,
    imageDataUrl: '',
    typedResponse: 'typed response without a photo',
  }, q5Request.token)
  assert.equal(typedOnly.response.status, 200, 'a reviewed typed response must use the same submitted AI marking boundary')
  assert.equal(providerCalls.length, 2)
  const typedImages = officialImagesFromCall(providerCalls.at(-1))
  assert.deepEqual(typedImages.context.imageOrder, { questionPaperPages: 1, markSchemePages: 1, studentResponsePages: 0 })
  assert.equal(typedImages.images.length, 2, 'typed-only marking must send exact QP/MS images without inventing a student image')
  assert.equal(typedImages.context.typedResponse, 'typed response without a photo')

  const q14Request = await authorizedRequest(appBase, 14, 'c')
  const q14 = await post(appBase, q14Request.request, q14Request.token)
  assert.equal(q14.response.status, 200, 'reviewed cross-page Q14 must reach the provider with all required official pages')
  assert.equal(providerCalls.length, 3)
  const q14Images = officialImagesFromCall(providerCalls.at(-1))
  assert.deepEqual(q14Images.context.imageOrder, { questionPaperPages: 1, markSchemePages: 1, studentResponsePages: 1 })
  assert.deepEqual(q14Images.context.officialSourceImages.map((item) => [item.role, item.page]), [
    ['question-paper', 9],
    ['mark-scheme', 8],
  ], 'Q14(c) must include its exact QP page 9 and paired MS page, without borrowing Q14(a-b) page 8')
  assert.equal(q14Images.images.length, 3, 'provider receives the exact Q14(c) QP page, MS and student response')
  assert.ok(q14Images.context.officialSourceImages.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)), 'every official image descriptor must carry its verified file SHA-256')
  assert.equal(sha256ForDataUrl(q14Images.images[0]), q14Request.request.provenance.sourceEvidence.assetSha256, 'provider must receive Q14(c) page-9 bytes matching the reviewed source evidence hash')
  assert.equal(sha256ForDataUrl(q14Images.images[0]), crypto.createHash('sha256').update(fs.readFileSync(path.join(trustedPaperRoot, 'qp-09.jpg'))).digest('hex'), 'provider Q14(c) page-9 bytes must equal the trusted local asset')
  assert.equal(sha256ForDataUrl(q14Images.images[1]), crypto.createHash('sha256').update(fs.readFileSync(path.join(trustedPaperRoot, 'ms-08.jpg'))).digest('hex'), 'provider Q14(c) mark-scheme bytes must equal the trusted local asset')

  const fullPaperRequest = await authorizedRequest(appBase, 5, 'a', {
    mode: 'full-paper',
    paperId: 'cie-0580-0580_m25_qp_12',
  })
  const fullPaper = await post(appBase, fullPaperRequest.request, fullPaperRequest.token)
  assert.equal(fullPaper.response.status, 200, 'a submitted full-paper capability must reach the provider')
  assert.equal(providerCalls.length, 4)

  const callsBeforeForgedPaper = providerCalls.length
  const forgedPaper = {
    ...fullPaperRequest.request,
    paperId: 'cie-0580-0580_m25_qp_22',
  }
  const forgedPaperResponse = await post(appBase, forgedPaper, fullPaperRequest.token)
  assert.equal(forgedPaperResponse.response.status, 422, 'a full-paper marking request with a different paper must be rejected')
  assert.equal(forgedPaperResponse.payload.code, 'marking_capability_mismatch')
  assert.equal(providerCalls.length, callsBeforeForgedPaper, 'a forged full-paper ID must make zero provider calls')

  const callsBeforeForgedBinding = providerCalls.length
  const forgedTopicPaper = { ...q5Request.request, paperId: 'cie-0580-0580_m25_qp_22' }
  const forgedTopicPaperResponse = await post(appBase, forgedTopicPaper, q5Request.token)
  assert.equal(forgedTopicPaperResponse.response.status, 422, 'a topic marking request with a different paper binding must be rejected')
  assert.equal(forgedTopicPaperResponse.payload.code, 'marking_capability_mismatch')
  assert.equal(providerCalls.length, callsBeforeForgedBinding, 'a forged topic paper binding must make zero provider calls')

  const callsBeforeForgedBindingAfterPaper = providerCalls.length
  const forgedBinding = { ...q5Request.request }
  forgedBinding.provenance = { ...forgedBinding.provenance, bindingSignature: 'fnv1a64:0000000000000000' }
  const forgedBindingResponse = await post(appBase, forgedBinding, q5Request.token)
  assert.equal(forgedBindingResponse.response.status, 422, 'a stale source binding must be rejected before vision marking')
  assert.equal(forgedBindingResponse.payload.code, 'marking_capability_mismatch')
  assert.equal(providerCalls.length, callsBeforeForgedBindingAfterPaper, 'a stale source binding must make zero provider calls')

  const callsBeforeStaleManifest = providerCalls.length
  const staleManifest = {
    ...q5Request.request,
    provenance: { ...q5Request.request.provenance, manifestSchemaVersion: 'stem-marking-manifest.v0' },
  }
  const staleManifestResponse = await post(appBase, staleManifest, q5Request.token)
  assert.equal(staleManifestResponse.response.status, 422, 'a stale canonical manifest must be rejected before vision marking')
  assert.equal(staleManifestResponse.payload.code, 'source_provenance_mismatch')
  assert.equal(providerCalls.length, callsBeforeStaleManifest, 'a stale canonical manifest must make zero provider calls')

  const callsBeforeAnonymous = providerCalls.length
  const anonymous = await post(appBase, q5Request.request)
  assert.equal(anonymous.response.status, 401, 'AI marking without an authenticated IELTSist identity must be rejected')
  assert.equal(anonymous.payload.code, 'identity_required')
  assert.equal(providerCalls.length, callsBeforeAnonymous, 'an anonymous marking request must make zero provider calls')

  const callsBeforeUnsubmitted = providerCalls.length
  const unsubmitted = await post(appBase, { ...q5Request.request, submitted: false }, q5Request.token)
  assert.equal(unsubmitted.response.status, 409, 'AI marking before submission must be rejected')
  assert.equal(unsubmitted.payload.code, 'attempt_not_submitted')
  assert.equal(providerCalls.length, callsBeforeUnsubmitted, 'an unsubmitted marking request must make zero provider calls')

  const callsBeforeWrongMode = providerCalls.length
  const wrongMode = await post(appBase, { ...q5Request.request, mode: 'full-paper' }, q5Request.token)
  assert.equal(wrongMode.response.status, 422, 'a topic grant cannot be replayed as full-paper marking')
  assert.equal(wrongMode.payload.code, 'marking_capability_mismatch')
  assert.equal(providerCalls.length, callsBeforeWrongMode, 'a wrong-mode marking request must make zero provider calls')

  const callsBeforeSuffixedId = providerCalls.length
  const suffixedId = {
    ...q5Request.request,
    provenance: { ...q5Request.request.provenance, sourceQuestionId: `${q5Request.request.provenance.sourceQuestionId}@forged-version` },
  }
  const suffixedIdResponse = await post(appBase, suffixedId, q5Request.token)
  assert.equal(suffixedIdResponse.response.status, 422, 'a sourceQuestionId with a forged @ suffix must be rejected')
  assert.equal(suffixedIdResponse.payload.code, 'marking_capability_mismatch')
  assert.equal(providerCalls.length, callsBeforeSuffixedId, 'a suffixed sourceQuestionId must make zero provider calls')

  const callsBeforeForgedCapability = providerCalls.length
  const forgedCapability = { ...q5Request.request }
  forgedCapability.provenance = {
    ...forgedCapability.provenance,
    routeId: 'bpho-competition',
    sourceQuestionId: 'bpho-2025_IPC:q13',
    questionPartId: 'bpho-2025_IPC:q13:part-a',
    bindingSignature: 'fnv1a64:deadbeefdeadbeef',
    reviewVersion: 'fnv1a64:deadbeefdeadbeef',
  }
  const forgedCapabilityResponse = await post(appBase, forgedCapability, q5Request.token)
  assert.equal(forgedCapabilityResponse.response.status, 422, 'client supplied reviewed capability cannot authorize an excluded source question')
  assert.equal(forgedCapabilityResponse.payload.code, 'marking_capability_mismatch')
  assert.equal(providerCalls.length, callsBeforeForgedCapability, 'a forged reviewed capability must make zero provider calls')

  const callsBeforeMissingAsset = providerCalls.length
  const missingRequest = await authorizedRequest(missingBase, 5, 'a')
  const missing = await post(missingBase, missingRequest.request, missingRequest.token)
  assert.equal(missing.response.status, 422, 'a missing official image must fail closed before marking')
  assert.equal(missing.payload.code, 'source_asset_unavailable')
  assert.equal(providerCalls.length, callsBeforeMissingAsset, 'a missing official image must make zero provider calls')

  const tamperedRequest = await authorizedRequest(tamperedBase, 5, 'a')
  const callsBeforeTamperedAsset = providerCalls.length
  const tampered = await post(tamperedBase, tamperedRequest.request, tamperedRequest.token)
  assert.equal(tampered.response.status, 422, 'a one-byte official image mutation must fail closed')
  assert.equal(tampered.payload.code, 'source_asset_checksum_mismatch')
  assert.equal(providerCalls.length, callsBeforeTamperedAsset, 'a tampered official image must make zero provider calls')

  const tamperedQ14Request = await authorizedRequest(tamperedBase, 14, 'c')
  const callsBeforeTamperedQ14 = providerCalls.length
  const tamperedQ14 = await post(tamperedBase, tamperedQ14Request.request, tamperedQ14Request.token)
  assert.equal(tamperedQ14.response.status, 422, 'a one-byte mutation of the Q14(c) page-9 URL must fail closed')
  assert.equal(tamperedQ14.payload.code, 'source_asset_checksum_mismatch')
  assert.equal(providerCalls.length, callsBeforeTamperedQ14, 'a tampered Q14(c) page-9 image must make zero provider calls')
} finally {
  await Promise.all([close(appServer), close(missingServer), close(tamperedServer), close(providerServer)])
  closeStemDatabaseForTests()
  fs.rmSync(emptyAssetRoot, { recursive: true, force: true })
  fs.rmSync(tamperedAssetRoot, { recursive: true, force: true })
  fs.rmSync(testDbRoot, { recursive: true, force: true })
}

console.log('AI source image contract passed for Q5 and cross-page Q14; stale, forged and missing source states made zero provider calls.')
