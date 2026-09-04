import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { routeById } from '../src/data/routeRegistry.js'
import { artifactId, buildAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'
import { createTopicPdfRenderer } from '../server/topicPdfRenderer.js'

const route = routeById('cie-9702-a2-physics')
const topic = route.syllabus.topics.find((item) => item.id === 'physics-9702-topic-13')
assert.ok(topic)

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function buildArtifact(root, questionNumber) {
  const libraryRoot = path.join(root, 'library', '9702')
  const artifactRoot = path.join(root, 'artifacts')
  fs.mkdirSync(libraryRoot, { recursive: true })
  fs.mkdirSync(artifactRoot, { recursive: true })
  const questionFile = '9702_m21_qp_42.pdf'
  const markSchemeFile = '9702_m21_ms_42.pdf'
  const questionPath = path.join(libraryRoot, questionFile)
  const markSchemePath = path.join(libraryRoot, markSchemeFile)
  if (!fs.existsSync(questionPath)) fs.writeFileSync(questionPath, Buffer.from('%PDF-1.4 question fixture'))
  if (!fs.existsSync(markSchemePath)) fs.writeFileSync(markSchemePath, Buffer.from('%PDF-1.4 mark scheme fixture'))
  const questionPdfSha256 = sha256(fs.readFileSync(questionPath))
  const markSchemePdfSha256 = sha256(fs.readFileSync(markSchemePath))
  const pageImageSha256 = '2'.repeat(64)
  const markSchemePageImageSha256 = '1'.repeat(64)
  const region = { page: 2, x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.8, pageImageSha256 }
  const candidateQuestion = {
    questionNumber: String(questionNumber),
    questionStartPage: 2,
    regions: [region],
    diagramRegions: [],
    parts: [{ label: 'a', marks: 1, ocrText: 'Calculate the value.', math: [], diagramAssociations: [] }],
    tags: { primaryTopicId: topic.id, secondaryTopicIds: [], syllabusPointIds: [topic.points[0].id] },
    markSchemeEvidence: [{ page: 1, pageImageSha256: markSchemePageImageSha256 }],
  }
  const verificationQuestion = {
    questionNumber: String(questionNumber),
    questionStartPage: 2,
    pages: [2],
    regions: [region],
    diagramRegions: [],
    parts: [{ label: 'a', marks: 1 }],
    diagramRegionCount: 0,
    tags: { primaryTopicId: topic.id, secondaryTopicIds: [], syllabusPointIds: [topic.points[0].id] },
    markSchemeEvidence: [{ page: 1, pageImageSha256: markSchemePageImageSha256 }],
  }
  const source = {
    board: 'Cambridge International',
    paperId: 'cie-9702-9702_m21_qp_42',
    specificationId: 'cambridge-9702-2025-2027',
    stage: 'A2',
    rightsStatus: 'official-personal-study',
    accessPolicyId: 'private-study-library',
    questionPdfSha256,
    markSchemePdfSha256,
    questionPdfRelativePath: `9702/${questionFile}`,
    markSchemePdfRelativePath: `9702/${markSchemeFile}`,
    renderDpi: 180,
    pageImageHashes: { 2: pageImageSha256 },
    pageSizes: { 2: { width: 1200, height: 1600 } },
    markSchemePageHashes: { 1: markSchemePageImageSha256 },
    markSchemePageSizes: { 1: { width: 1200, height: 1600 } },
  }
  const id = artifactId({ paperId: source.paperId, questionPdfSha256, markSchemePdfSha256 })
  const artifact = {
    schemaVersion: 'ai-pdf-ingestion.v1',
    artifactId: id,
    paperId: source.paperId,
    subject: '9702',
    stage: 'A2',
    syllabusRouteId: route.routeId,
    status: 'ai-verified',
    storageMode: 'coordinate-only',
    source,
    extractor: { provider: 'paddleocr-api', model: 'paddleocr-vl', schemaName: 'ai_pdf_question_extraction_v1' },
    verifier: { provider: 'gpt', model: 'gpt-5.6', schemaName: 'ai_pdf_question_verification_v1' },
    candidate: { questions: [candidateQuestion] },
    verification: { questions: [verificationQuestion] },
  }
  artifact.studentRelease = buildAiStudentStudyRelease({
    artifactId: id,
    routeId: route.routeId,
    status: artifact.status,
    source,
    extractor: artifact.extractor,
    verifier: artifact.verifier,
    candidate: artifact.candidate,
    verification: artifact.verification,
  })
  const artifactPath = path.join(artifactRoot, `paper-${questionNumber}.json`)
  fs.writeFileSync(artifactPath, JSON.stringify(artifact), 'utf8')
  return { artifactRoot, libraryRoot, artifactPath }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-topic-pdf-deadline-'))
const fixtures = [1, 2, 3, 4].map((number) => buildArtifact(root, number))
const timeoutValues = []
let cropCount = 0
try {
  const renderer = createTopicPdfRenderer({
    artifactRoot: fixtures[0].artifactRoot,
    libraryRoot: fixtures[0].libraryRoot,
    artifactPaths: () => fixtures.map((fixture) => fixture.artifactPath),
    timeoutMs: 250,
    runCropCommand: async (_command, manifest, options) => {
      timeoutValues.push(options.timeoutMs)
      cropCount += 1
      fs.mkdirSync(path.dirname(manifest.questionPdfPath), { recursive: true })
      fs.writeFileSync(manifest.questionPdfPath, Buffer.from('%PDF-1.4 cropped question'))
      await new Promise((resolve) => setTimeout(resolve, 90))
    },
    mergePdfs: async (outputPath, _inputPaths, options) => {
      timeoutValues.push(options.timeoutMs)
      fs.writeFileSync(outputPath, Buffer.from('%PDF-1.4 merged topic'))
      await new Promise((resolve) => setTimeout(resolve, 90))
    },
  })
  const startedAt = Date.now()
  await assert.rejects(
    () => renderer({ routeId: route.routeId, topicId: topic.id }),
    (error) => error?.code === 'topic_pdf_timeout',
    'a multi-question topic PDF must stop at its request deadline instead of summing per-crop timeouts',
  )
  const elapsedMs = Date.now() - startedAt
  assert.ok(cropCount >= 2, 'the deadline fixture must reach multiple crop operations')
  assert.ok(elapsedMs < 380, `request-level deadline must bound total work (elapsed ${elapsedMs}ms)`)
  assert.ok(timeoutValues.some((value) => Number(value) < 250), 'remaining deadline budget must be passed to a later operation')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(JSON.stringify({ status: 'passed', scope: 'topic-pdf-request-deadline' }))
