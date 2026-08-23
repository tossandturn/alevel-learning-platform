import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { createAiApi } from '../server/aiApi.js'
import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { canonicalAiMarkingProvenance } from '../src/lib/sourceContentContract.js'
import { artifactId } from './ai-pdf-ingestion/contract.mjs'
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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
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

const artifact = {
  schemaVersion: 'ai-pdf-ingestion.v1',
  artifactId: artifactIdentity,
  paperId,
  subject: '9702',
  status: 'ai-verified',
  storageMode: 'coordinate-only',
  source: {
    questionPdfPath,
    markSchemePdfPath,
    questionPdfSha256,
    markSchemePdfSha256,
    renderDpi: RENDER_DPI,
    pageSizes: { 1: { width: 1530, height: 1980 } },
    markSchemePageSizes: { 1: { width: 1530, height: 1980 } },
  },
  candidate: {
    questions: [{
      questionNumber: '1',
      regions: [{ page: 1, pageImageSha256: questionPageImageSha256, x0: 0.08, y0: 0.08, x1: 0.92, y1: 0.92 }],
      diagramRegions: [],
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
      diagramRegionCount: 0,
      markSchemeEvidence: [{ page: 1, pageImageSha256: markSchemePageImageSha256 }],
    }],
  },
}
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
          rawMarks: 2,
          maxMarks: 99,
          confidence: 0.94,
          reviewRequired: false,
          summary: 'Marked from the verified local source pages.',
          markPoints: [],
        }),
      },
    }],
  }))
})
const providerBase = await listen(providerServer)
const env = {
  VISION_AI_API_KEY: 'test-only-vision-key',
  VISION_AI_BASE_URL: providerBase,
  VISION_AI_MODEL: 'test-vision',
  STEM_INTERNAL_AUTH_KEY: identitySigningKey,
  STEM_MARKING_CAPABILITY_SIGNING_KEY: capabilitySigningKey,
  STEM_DB_PATH: path.join(root, 'stem.sqlite'),
}
const aiApi = createAiApi({
  env,
  libraryRoot,
  allowedSubjects: new Set(['9702']),
  questionBankProvider: () => groups,
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
  assert.deepEqual(images.context.officialSourceImages.map((image) => image.sha256), [questionPageImageSha256, markSchemePageImageSha256])
  assert.equal(images.images.length, 2, 'typed marking must send the QP and MS page images without a fabricated student image')

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
