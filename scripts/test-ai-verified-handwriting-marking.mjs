import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { canonicalHandwritingMarkingContext, canonicalHandwritingMarkingImages, createAiApi } from '../server/aiApi.js'
import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { canonicalAiMarkingProvenance } from '../src/lib/sourceContentContract.js'
import { artifactId, buildAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'
import { buildRenderArgs, resolvePopplerExecutable } from './ai-pdf-ingestion/render.mjs'

const RENDER_DPI = 180
const identitySigningKey = 'ai-verified-marking-identity-key'
const capabilitySigningKey = 'ai-verified-marking-capability-key'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-ai-verified-marking-'))
const libraryRoot = path.join(root, 'library')
const subjectRoot = path.join(libraryRoot, '9702')
const artifactRoot = path.join(root, 'artifacts')
const paperId = 'cie-9702-9702_m21_qp_42'
const questionFile = '9702_m21_qp_42.pdf'
const markSchemeFile = '9702_m21_ms_42.pdf'
let providerAssessment = {
  rawMarks: 2,
  maxMarks: 99,
  confidence: 0.94,
  reviewRequired: false,
  summary: 'Marked from the verified local source pages.',
  markPoints: [{
    id: 'M1',
    awarded: true,
    marks: 2,
    reason: 'The stated principle matches the paired mark scheme.',
    studentEvidence: 'The principle is stated in the typed response.',
  }],
}
let providerDelayMs = 0
let providerRawResponse = ''
const providerTelemetry = []

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function imageDataUrlBytes(value) {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''))
  assert.ok(match, 'the provider fixture must receive an inline JPEG data URL')
  return Buffer.from(match[1], 'base64')
}

function jpegDimensions(bytes) {
  assert.equal(bytes[0], 0xff, 'JPEG must begin with the SOI marker')
  assert.equal(bytes[1], 0xd8, 'JPEG must begin with the SOI marker')
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    const segmentLength = bytes.readUInt16BE(offset)
    assert.ok(segmentLength >= 2 && offset + segmentLength <= bytes.length, 'JPEG segment length must stay within the image')
    if (startOfFrameMarkers.has(marker)) {
      return {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      }
    }
    offset += segmentLength
  }
  assert.fail('JPEG dimensions were not found')
}

function croppedDimensions(pageSize, region) {
  const [x0, y0, x1, y1] = region
  return {
    width: Math.ceil(x1 * pageSize.width) - Math.floor(x0 * pageSize.width),
    height: Math.ceil(y1 * pageSize.height) - Math.floor(y0 * pageSize.height),
  }
}

function writeSinglePagePdf(filePath, text) {
  const escapedText = String(text).replace(/([\\()])/g, '\\$1')
  const stream = `BT\n/F1 20 Tf\n72 720 Td\n(${escapedText}) Tj\nET\n`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream`,
  ]
  let document = '%PDF-1.4\n'
  const offsets = []
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(document, 'utf8'))
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(document, 'utf8')
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  document += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  fs.writeFileSync(filePath, document, 'utf8')
}

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Renderer exited with ${code}`)))
  })
}

async function renderFixturePage(pdfPath) {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-ai-verified-render-'))
  try {
    const outputPrefix = path.join(outputDirectory, 'page')
    const executable = resolvePopplerExecutable('pdftoppm')
    await run(executable, ['-f', '1', '-l', '1', ...buildRenderArgs({ pdfPath, outputPrefix, dpi: RENDER_DPI })])
    const imageFile = fs.readdirSync(outputDirectory).find((name) => /^page-1\.jpg$/i.test(name))
    assert.ok(imageFile, 'the valid PDF fixture must render its first page')
    return fs.readFileSync(path.join(outputDirectory, imageFile))
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true })
  }
}

function identityToken(userId = 42) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: `ielts:${userId}`,
    username: 'ai-verified-marking-test',
    iat: now,
    exp: now + 3600,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', identitySigningKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

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

async function post(url, pathName, body, token) {
  const response = await fetch(`${url}${pathName}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { response, payload: await response.json() }
}

function providerImages(call) {
  const content = call.messages?.[1]?.content || []
  return {
    context: JSON.parse(content[0].text),
    images: content.filter((item) => item.type === 'image_url').map((item) => item.image_url.url),
  }
}

fs.mkdirSync(subjectRoot, { recursive: true })
const questionPdfPath = path.join(subjectRoot, questionFile)
const markSchemePdfPath = path.join(subjectRoot, markSchemeFile)
writeSinglePagePdf(questionPdfPath, 'Question 1: State a physics principle.')
writeSinglePagePdf(markSchemePdfPath, 'Mark scheme: award two marks for the exact principle.')
const questionPdfSha256 = sha256(fs.readFileSync(questionPdfPath))
const markSchemePdfSha256 = sha256(fs.readFileSync(markSchemePdfPath))
const questionPageImage = await renderFixturePage(questionPdfPath)
const markSchemePageImage = await renderFixturePage(markSchemePdfPath)
const questionPageImageSha256 = sha256(questionPageImage)
const markSchemePageImageSha256 = sha256(markSchemePageImage)
const artifactIdentity = artifactId({ paperId, questionPdfSha256, markSchemePdfSha256 })
const questionRegion = [0.08, 0.08, 0.92, 0.92]

const artifact = {
  schemaVersion: 'ai-pdf-ingestion.v1',
  artifactId: artifactIdentity,
  paperId,
  subject: '9702',
  stage: 'A2',
  syllabusRouteId: 'cie-9702-a2-physics',
  status: 'ai-verified',
  storageMode: 'coordinate-only',
  extractor: { provider: 'codex-independent-extraction', model: 'gpt-5.6', schemaName: 'ai_pdf_question_extraction_v1' },
  verifier: { provider: 'codex-independent-verification', model: 'gpt-5.6', schemaName: 'ai_pdf_question_verification_v1' },
  source: {
    questionPdfPath,
    markSchemePdfPath,
    questionPdfSha256,
    markSchemePdfSha256,
    renderDpi: RENDER_DPI,
    pageSizes: { 1: { width: 1530, height: 1980 } },
    pageImageHashes: { 1: questionPageImageSha256 },
    markSchemePageSizes: { 1: { width: 1530, height: 1980 } },
    markSchemePageHashes: { 1: markSchemePageImageSha256 },
  },
  candidate: {
    questions: [{
      questionNumber: '1',
      regions: [{ page: 1, pageImageSha256: questionPageImageSha256, x0: questionRegion[0], y0: questionRegion[1], x1: questionRegion[2], y1: questionRegion[3] }],
      diagramRegions: [{ page: 1, pageImageSha256: questionPageImageSha256, x0: 0.7, y0: 0.7, x1: 0.9, y1: 0.9 }],
      parts: [{ label: 'a', marks: 2, ocrText: 'State a physics principle.', math: [], diagramAssociations: [] }],
      tags: { primaryTopicId: 'physics-9702-topic-13', secondaryTopicIds: [], syllabusPointIds: [] },
      markSchemeEvidence: [{ page: 1, pageImageSha256: markSchemePageImageSha256 }],
    }],
  },
  verification: {
    questions: [{
      questionNumber: '1',
      pages: [1],
      parts: [{ label: 'a', marks: 2 }],
      diagramRegionCount: 1,
      markSchemeEvidence: [{ page: 1, pageImageSha256: markSchemePageImageSha256 }],
    }],
  },
}
artifact.studentRelease = buildAiStudentStudyRelease({
  artifactId: artifact.artifactId,
  routeId: artifact.syllabusRouteId,
  status: artifact.status,
  source: artifact.source,
  extractor: artifact.extractor,
  verifier: artifact.verifier,
  candidate: artifact.candidate,
  verification: artifact.verification,
})
const artifactDirectory = path.join(artifactRoot, paperId)
fs.mkdirSync(artifactDirectory, { recursive: true })
fs.writeFileSync(path.join(artifactDirectory, `${artifactIdentity.slice('sha256:'.length)}.json`), JSON.stringify(artifact), 'utf8')

const load = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot: subjectRoot })
const groups = load().groups
assert.equal(groups.length, 1, 'the verified coordinate artifact must enter the runtime bank')
const question = groups[0]
const part = question.parts[0]
const provenance = canonicalAiMarkingProvenance(question, part)
assert.ok(provenance, 'the dynamic coordinate part must produce a canonical AI marking provenance')
const canonical = canonicalHandwritingMarkingContext({
  provenance: { routeId: question.routeId, ...provenance },
}, { questionBank: groups })
assert.equal(canonical.ok, true, 'the dynamic coordinate part must resolve to a canonical marking context')

const providerCalls = []
const providerServer = http.createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  providerCalls.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  if (providerDelayMs) await new Promise((resolve) => setTimeout(resolve, providerDelayMs))
  if (response.destroyed) return
  response.setHeader('Content-Type', 'application/json')
  if (providerRawResponse) {
    response.end(providerRawResponse)
    return
  }
  response.end(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify(providerAssessment),
      },
    }],
  }))
})
const providerBase = await listen(providerServer)
const env = {
  AI_PROVIDER: 'openai',
  OPENAI_VISION_API_KEY: 'test-only-openai-vision-key',
  OPENAI_VISION_BASE_URL: providerBase,
  OPENAI_VISION_MODEL: 'test-openai-vision',
  STEM_INTERNAL_AUTH_KEY: identitySigningKey,
  STEM_MARKING_CAPABILITY_SIGNING_KEY: capabilitySigningKey,
  STEM_DB_PATH: path.join(root, 'stem.sqlite'),
  STEM_AI_PROVIDER_TIMEOUT_MS: '250',
  STEM_AI_REQUEST_DEADLINE_MS: '450',
  STEM_AI_VISION_PROVIDER_TIMEOUT_MS: '250',
  STEM_AI_VISION_REQUEST_DEADLINE_MS: '450',
}
const aiApi = createAiApi({
  env,
  libraryRoot,
  allowedSubjects: new Set(['9702']),
  questionBankProvider: () => groups,
  telemetry: (event) => providerTelemetry.push(event),
})
const stemApi = createStemApi({ env, topicQuestionBankProvider: () => groups })
const appServer = requestHandler(stemApi, aiApi)
const appBase = await listen(appServer)
const token = identityToken()
const request = {
  attemptId: 'ai-verified-coordinate-attempt',
  mode: 'topic',
  paperId: question.sourceRef.paperId,
  submitted: true,
  imageDataUrl: '',
  typedResponse: 'The principle is stated in my response.',
  provenance: { routeId: question.routeId, ...provenance },
}

try {
  await assert.rejects(
    canonicalHandwritingMarkingImages(canonical, {
      libraryRoot,
      env,
      deadlineAt: Date.now() - 1,
    }),
    (error) => error?.code === 'source_page_render_timeout',
    'an expired end-to-end marking deadline must stop coordinate source rendering before an upstream provider call',
  )

  const persistedAttempt = await post(appBase, '/api/stem/attempts', {
    attemptId: request.attemptId,
    mode: request.mode,
    routeId: question.routeId,
    stage: question.stage,
    paperId: request.paperId,
    submittedAt: new Date().toISOString(),
    markingParts: [{ provenance: request.provenance }],
    attempt: {
      id: request.attemptId,
      unitId: 'ai-verified-coordinate-unit',
      attemptStatus: 'marking-pending',
      answers: { [part.id]: request.typedResponse },
      evidence: { [part.id]: { dataUrl: 'data:image/png;base64,fixture-only' } },
    },
  }, token)
  assert.equal(persistedAttempt.response.status, 201, persistedAttempt.payload.error)
  assert.doesNotMatch(JSON.stringify(persistedAttempt.payload), /data:image/i, 'attempt persistence must strip handwriting data URLs')

  const capability = await post(appBase, '/api/stem/marking/capabilities', {
    attemptId: request.attemptId,
    mode: request.mode,
    paperId: request.paperId,
    submitted: true,
    parts: [{ provenance: request.provenance }],
  }, token)
  assert.equal(capability.response.status, 201, 'a submitted dynamic P4 coordinate question must receive a marking capability')
  const markingGrant = capability.payload.capabilities?.[0]?.markingGrant
  assert.ok(markingGrant, 'the dynamic question capability must include a marking grant')

  const marked = await post(appBase, '/api/ai/mark-handwriting', { ...request, markingGrant }, token)
  assert.equal(marked.response.status, 200, 'a verified coordinate P4 response must reach automatic AI marking')
  assert.equal(marked.payload.mode, 'vision')
  assert.equal(marked.payload.autoFinal, true)
  assert.equal(marked.payload.maxMarks, 2, 'the stored P4 part allocation must bound the model result')
  assert.equal(providerCalls.length, 1, 'the Vision provider must receive the trusted source pages once')
  const images = providerImages(providerCalls[0])
  assert.deepEqual(images.context.officialSourceImages.map((image) => [image.role, image.page]), [
    ['question-paper', 1],
    ['mark-scheme', 1],
  ])
  assert.equal(images.images.length, 2, 'typed marking must send the QP and MS page images without a fabricated student image')
  const questionDescriptor = images.context.officialSourceImages[0]
  const markSchemeDescriptor = images.context.officialSourceImages[1]
  const questionImageBytes = imageDataUrlBytes(images.images[0])
  const markSchemeImageBytes = imageDataUrlBytes(images.images[1])
  assert.deepEqual(questionDescriptor.region, questionRegion, 'same-page question and diagram evidence must retain the whole-question union')
  assert.equal(questionDescriptor.sourcePageSha256, questionPageImageSha256, 'the crop must remain bound to the verified full-page render')
  assert.equal(questionDescriptor.sha256, sha256(questionImageBytes), 'the provider descriptor must hash the exact cropped bytes sent to the model')
  assert.equal(markSchemeDescriptor.sha256, sha256(markSchemeImageBytes), 'the full mark-scheme descriptor must hash the bytes sent to the model')
  assert.deepEqual(
    jpegDimensions(questionImageBytes),
    croppedDimensions(jpegDimensions(questionPageImage), questionRegion),
    'the provider must receive the coordinate crop instead of the full question-paper page',
  )
  assert.notEqual(questionDescriptor.sha256, questionPageImageSha256, 'a non-full-page crop must not masquerade as the verified full-page bytes')

  providerAssessment = {
    rawMarks: 1,
    maxMarks: 99,
    confidence: 0.94,
    reviewRequired: true,
    summary: 'The evidence is readable but still needs a review pass.',
    markPoints: [{
      id: 'M1',
      awarded: true,
      marks: 1,
      reason: 'The principle is present, but the handwriting needs a human check.',
      studentEvidence: 'The principle is stated in the typed response.',
    }],
  }
  const reviewRequiredResult = await post(appBase, '/api/ai/mark-handwriting', { ...request, markingGrant }, token)
  assert.equal(reviewRequiredResult.response.status, 200, 'a schema-valid review-required assessment may be returned as provisional')
  assert.equal(reviewRequiredResult.payload.autoFinal, false, 'reviewRequired must prevent an automatic final result')
  assert.equal(reviewRequiredResult.payload.humanReviewRequired, true)
  assert.equal(reviewRequiredResult.payload.rawMarks, 1)

  providerAssessment = {
    rawMarks: 0,
    maxMarks: 99,
    confidence: 0.94,
    reviewRequired: false,
    summary: 'Malformed mark point types.',
    markPoints: [{
      id: 'M1',
      awarded: 'false',
      marks: 1.5,
      reason: 'Invalid provider types.',
      studentEvidence: 'Invalid provider evidence.',
    }],
  }
  const callsBeforeInvalidMarkPoint = providerCalls.length
  const invalidMarkPoint = await post(appBase, '/api/ai/mark-handwriting', { ...request, markingGrant }, token)
  assert.equal(invalidMarkPoint.response.status, 422, 'invalid mark point types must fail closed')
  assert.equal(invalidMarkPoint.payload.code, 'ai_assessment_schema_invalid')
  assert.equal(providerCalls.length, callsBeforeInvalidMarkPoint + 1)

  providerAssessment = {
    maxMarks: 99,
    confidence: 0.94,
    reviewRequired: false,
    summary: 'Malformed assessment without rawMarks.',
    markPoints: [],
  }
  const callsBeforeMalformedAssessment = providerCalls.length
  const malformedAssessment = await post(appBase, '/api/ai/mark-handwriting', { ...request, markingGrant }, token)
  assert.equal(malformedAssessment.response.status, 422, 'a malformed provider assessment must fail closed')
  assert.equal(malformedAssessment.payload.code, 'ai_assessment_schema_invalid')
  assert.equal(malformedAssessment.payload.providerStatus, 'invalid_schema')
  assert.equal(malformedAssessment.payload.reviewRequired, true)
  assert.equal(providerCalls.length, callsBeforeMalformedAssessment + 1, 'the malformed assessment regression must exercise the provider boundary')
  assert.equal(Object.hasOwn(malformedAssessment.payload, 'rawMarks'), false, 'a malformed assessment must not expose a fabricated score')
  assert.equal(Object.hasOwn(malformedAssessment.payload, 'maxMarks'), false, 'a malformed assessment must not expose a score maximum')
  assert.equal(Object.hasOwn(malformedAssessment.payload, 'markPoints'), false, 'a malformed assessment must not expose fabricated criteria')
  assert.equal(Object.hasOwn(malformedAssessment.payload, 'autoFinal'), false, 'a malformed assessment must not look like a completed marking result')
  assert.equal(providerTelemetry.at(-1)?.schemaStatus, 'invalid', 'provider telemetry must report the final marking schema failure')

  providerAssessment = {
    rawMarks: null,
    maxMarks: 99,
    confidence: 0.94,
    reviewRequired: false,
    summary: 'Malformed null rawMarks.',
    markPoints: [],
  }
  const nullMarks = await post(appBase, '/api/ai/mark-handwriting', { ...request, markingGrant }, token)
  assert.equal(nullMarks.response.status, 422, 'null rawMarks must not be coerced into a zero score')
  assert.equal(nullMarks.payload.code, 'ai_assessment_schema_invalid')
  assert.equal(Object.hasOwn(nullMarks.payload, 'rawMarks'), false)

  providerRawResponse = '{"choices":'
  const callsBeforeInvalidJson = providerCalls.length
  const invalidJson = await post(appBase, '/api/ai/mark-handwriting', { ...request, markingGrant }, token)
  assert.equal(invalidJson.response.status, 422, 'HTTP 200 with malformed provider JSON must be classified as a schema failure')
  assert.equal(invalidJson.payload.code, 'ai_assessment_schema_invalid')
  assert.equal(invalidJson.payload.providerStatus, 'invalid_schema')
  assert.equal(Object.hasOwn(invalidJson.payload, 'rawMarks'), false, 'malformed provider JSON must not expose a fabricated score')
  assert.equal(providerCalls.length, callsBeforeInvalidJson + 1, 'the malformed JSON regression must cross the provider boundary')
  assert.equal(providerTelemetry.at(-1)?.schemaStatus, 'invalid', 'malformed provider JSON must be observable as an invalid schema')
  providerRawResponse = ''

  providerAssessment = {
    rawMarks: 1,
    maxMarks: 99,
    confidence: 0.94,
    reviewRequired: false,
    summary: 'Delayed provider fixture.',
    markPoints: [{
      id: 'M1',
      awarded: true,
      marks: 1,
      reason: 'The delayed fixture contains a valid mark point.',
      studentEvidence: 'The principle is stated in the typed response.',
    }],
  }
  providerDelayMs = 600
  const callsBeforeTimeout = providerCalls.length
  const timeoutStartedAt = Date.now()
  const timeoutResult = await post(appBase, '/api/ai/mark-handwriting', { ...request, markingGrant }, token)
  const timeoutDurationMs = Date.now() - timeoutStartedAt
  assert.equal(timeoutResult.response.status, 200, 'a provider timeout must resolve with a safe terminal response')
  assert.equal(timeoutResult.payload.mode, 'offline', 'a provider timeout must not return an AI score')
  assert.equal(timeoutResult.payload.code, 'vision_review_failed')
  assert.equal(timeoutResult.payload.providerStatus, 'error')
  assert.equal(timeoutResult.payload.retryable, true)
  assert.equal(Object.hasOwn(timeoutResult.payload, 'rawMarks'), false, 'a provider timeout must not expose a fabricated score')
  assert.ok(timeoutDurationMs < 550, `provider timeout exceeded its configured budget: ${timeoutDurationMs}ms`)
  assert.equal(providerCalls.length, callsBeforeTimeout + 1, 'the timeout regression must reach the provider boundary')
  const timeoutTelemetry = providerTelemetry.at(-1)
  assert.equal(timeoutTelemetry.operation, 'handwriting-marking')
  assert.ok(timeoutTelemetry.timeoutMs > 0 && timeoutTelemetry.timeoutMs <= 250, 'the provider timeout must be bounded by the configured provider budget and remaining request deadline')
  assert.equal(timeoutTelemetry.finalState, 'timeout')

  providerDelayMs = 0
  fs.appendFileSync(questionPdfPath, '\n% tampered fixture\n', 'utf8')
  const callsBeforeTamper = providerCalls.length
  const tampered = await post(appBase, '/api/ai/mark-handwriting', { ...request, markingGrant }, token)
  assert.equal(tampered.response.status, 422, 'a changed local source PDF must be rejected before AI marking')
  assert.match(tampered.payload.code, /source_(pdf|asset)_checksum_mismatch/)
  assert.equal(providerCalls.length, callsBeforeTamper, 'a tampered source PDF must make zero provider calls')
} finally {
  await Promise.all([close(appServer), close(providerServer)])
  closeStemDatabaseForTests()
  fs.rmSync(root, { recursive: true, force: true })
}

console.log('AI-verified 9702 P4 coordinate marking passed with source-page rendering and tamper rejection.')
