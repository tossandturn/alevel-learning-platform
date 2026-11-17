import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'

import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { createNativeQuestionImages } from '../server/nativeQuestionImages.js'
import { artifactId, buildAiStudentStudyRelease, sourceReviewInputSha256 } from './ai-pdf-ingestion/contract.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-ai-reference-runtime-'))
const libraryRoot = path.join(root, 'library', '9701')
const artifactRoot = path.join(root, 'artifacts')
fs.mkdirSync(libraryRoot, { recursive: true })
fs.mkdirSync(artifactRoot, { recursive: true })
const questionFile = '9701_s25_qp_12.pdf', markSchemeFile = '9701_s25_ms_12.pdf'
const questionBytes = Buffer.from('%PDF-1.4\nreference-question\n'), markSchemeBytes = Buffer.from('%PDF-1.4\nreference-ms\n')
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const questionPdfSha256 = hash(questionBytes), markSchemePdfSha256 = hash(markSchemeBytes)
fs.writeFileSync(path.join(libraryRoot, questionFile), questionBytes)
fs.writeFileSync(path.join(libraryRoot, markSchemeFile), markSchemeBytes)

function png(width, height, color) {
  const canvas = createCanvas(width, height), context = canvas.getContext('2d')
  context.fillStyle = color; context.fillRect(0, 0, width, height)
  context.fillStyle = '#fff'; context.fillRect(10, 20, 30, 40)
  return canvas.toBuffer('image/png')
}
const questionPage = png(120, 160, '#164e63'), referencePage = png(120, 160, '#7c2d12')
const questionPageSha256 = hash(questionPage), referencePageSha256 = hash(referencePage), msPageSha256 = 'e'.repeat(64)
const paperId = 'cie-9701-9701_s25_qp_12'
const identity = artifactId({ paperId, questionPdfSha256, markSchemePdfSha256 })
const questionRegion = { page: 2, pageImageSha256: questionPageSha256, x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.45, partLabels: ['answer'] }
const referenceRegion = { page: 16, pageImageSha256: referencePageSha256, x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.9,
  partLabels: ['answer'], rotationDegrees: 90 }
const markEvidence = { page: 2, pageImageSha256: msPageSha256, x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.3,
  partLabels: ['answer'], marks: 1 }
const candidateQuestion = { questionNumber: '2', questionStartPage: 2, partEvidenceSchemaVersion: 'stem-ai-part-evidence-binding.v2',
  referenceMaterialEvidenceSchemaVersion: 'stem-ai-reference-material-evidence.v1', regions: [questionRegion], diagramRegions: [],
  referenceMaterialRegions: [referenceRegion], markSchemeEvidence: [markEvidence],
  parts: [{ label: 'answer', marks: 1, ocrText: 'Use the supplied periodic table.',
    partPageBinding: { schemaVersion: 'reviewed-part-page-binding-v1', questionPage: 2, markSchemePage: 2 },
    needsReferenceMaterial: true }],
  tags: { primaryTopicId: '9701-as-topic-01-atomic-structure', secondaryTopicIds: [], syllabusPointIds: [] } }
const verificationQuestion = { questionNumber: '2', questionStartPage: 2, pages: [2],
  partEvidenceSchemaVersion: candidateQuestion.partEvidenceSchemaVersion,
  referenceMaterialEvidenceSchemaVersion: candidateQuestion.referenceMaterialEvidenceSchemaVersion,
  regions: [structuredClone(questionRegion)], diagramRegions: [], diagramRegionCount: 0,
  referenceMaterialRegions: [structuredClone(referenceRegion)], markSchemeEvidence: [structuredClone(markEvidence)],
  parts: [{ label: 'answer', marks: 1,
    partPageBinding: { schemaVersion: 'reviewed-part-page-binding-v1', questionPage: 2, markSchemePage: 2 },
    needsReferenceMaterial: true }], tags: structuredClone(candidateQuestion.tags) }
const artifact = { schemaVersion: 'ai-pdf-ingestion.v1', artifactId: identity, paperId, subject: '9701', stage: 'AS',
  syllabusRouteId: 'cie-9701-as-chemistry', status: 'ai-verified', storageMode: 'coordinate-only',
  extractor: { provider: 'fixture-a', model: 'fixture-a', schemaName: 'ai_pdf_question_extraction_v1' },
  verifier: { provider: 'fixture-b', model: 'fixture-b', schemaName: 'ai_pdf_question_verification_v1' },
  source: { questionPdfPath: path.join(libraryRoot, questionFile), markSchemePdfPath: path.join(libraryRoot, markSchemeFile),
    questionPdfSha256, markSchemePdfSha256, renderDpi: 180,
    pageImageHashes: { 2: questionPageSha256, 16: referencePageSha256 },
    pageSizes: { 2: { width: 120, height: 160 }, 16: { width: 120, height: 160 } },
    markSchemePageHashes: { 2: msPageSha256 }, markSchemePageSizes: { 2: { width: 120, height: 160 } } },
  candidate: { questions: [candidateQuestion] }, verification: { questions: [verificationQuestion] } }
artifact.sourceReview = { schemaVersion: 'ai-source-semantic-review.v1', provider: 'fixture-reviewer', model: 'fixture-model',
  decision: 'accept', reviewedAt: '2026-11-17T00:00:00Z', inputSha256: sourceReviewInputSha256(artifact),
  confirmations: Object.fromEntries(['sourceBindingConfirmed', 'wholeQuestionConfirmed', 'partStructureConfirmed',
    'marksConfirmed', 'markSchemeEvidenceConfirmed', 'topicMappingConfirmed'].map((key) => [key, true])),
  reviewNote: 'Synthetic complete reference-material source review.', evidence: [
    { document: 'qp', page: 2, pageImageSha256: questionPageSha256 },
    { document: 'qp', page: 16, pageImageSha256: referencePageSha256 },
    { document: 'ms', page: 2, pageImageSha256: msPageSha256 },
  ] }
artifact.studentRelease = buildAiStudentStudyRelease({ ...artifact, routeId: artifact.syllabusRouteId })
assert.ok(artifact.studentRelease, 'synthetic reference artifact must pass the student release contract')
const artifactDirectory = path.join(artifactRoot, paperId)
fs.mkdirSync(artifactDirectory, { recursive: true })
const artifactFile = path.join(artifactDirectory, 'q2.json')
fs.writeFileSync(artifactFile, JSON.stringify(artifact), 'utf8')

const load = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot: path.dirname(libraryRoot) })
const loaded = load()
assert.equal(loaded.groups.length, 1)
const group = loaded.groups[0]
assert.deepEqual(group.sourceContent.sourcePages, [2], 'reference material must not widen the internal question span')
assert.equal(group.sourceRef.pageStart, 2)
assert.equal(group.sourceRef.pageEnd, 2)
assert.deepEqual(group.referenceMaterialRegions.map((entry) => ({ page: entry.page, rotationDegrees: entry.rotationDegrees })),
  [{ page: 16, rotationDegrees: 90 }])
assert.equal(group.parts[0].needsReferenceMaterial, true)
assert.ok(group.parts[0].sourceEvidence.some((entry) => entry.evidenceRole === 'reference-material'
  && entry.page === 16 && entry.rotationDegrees === 90))

let bank = [group]
const service = createNativeQuestionImages({ getQuestionBank: () => bank, libraryRoot: path.dirname(libraryRoot),
  isReleased: () => true, pageReader: async (spec) => ({ bytes: spec.page === 16 ? referencePage : questionPage,
    contentType: 'image/png', sha256: spec.expectedPageImageSha256 }) })
const descriptors = service.descriptors(group.routeId, group.sourceQuestionId, { view: 'region' })
assert.equal(descriptors.length, 2)
const referenceDescriptor = descriptors.find((entry) => entry.page === 16)
assert.ok(referenceDescriptor)
assert.deepEqual(referenceDescriptor.imageSize, [160, 120])
assert.deepEqual(referenceDescriptor.renderedImageSize, [128, 72])
const referenceInput = Object.fromEntries(new URL(referenceDescriptor.url, 'https://example.test').searchParams)
const renderedRegion = await service.image(referenceInput)
assert.deepEqual(renderedRegion.imageSize, [128, 72])
const pageDescriptor = service.descriptors(group.routeId, group.sourceQuestionId).find((entry) => entry.page === 16)
const pageInput = Object.fromEntries(new URL(pageDescriptor.url, 'https://example.test').searchParams)
const renderedPage = await service.image(pageInput)
assert.deepEqual(renderedPage.imageSize, [160, 120])
const projected = service.projectSet({ questionGroups: [{ id: group.sourceQuestionId, routeId: group.routeId,
  sourceContent: { assetUrls: [], pages: [2] } }] }, { view: 'region', questionBank: bank })
assert.deepEqual(projected.questionGroups[0].sourceContent.pages, [2, 16])

for (const mutate of [
  (value) => { value.verification.questions[0].referenceMaterialRegions[0].rotationDegrees = 270 },
  (value) => { value.verification.questions[0].parts[0].needsReferenceMaterial = false },
  (value) => { value.verification.questions[0].referenceMaterialRegions = [] },
]) {
  const invalid = structuredClone(artifact)
  mutate(invalid)
  fs.writeFileSync(artifactFile, JSON.stringify(invalid), 'utf8')
  assert.equal(load({ refresh: true }).groups.length, 0)
}
fs.writeFileSync(artifactFile, JSON.stringify(artifact), 'utf8')
assert.equal(load({ refresh: true }).groups.length, 1)
bank = []
assert.throws(() => service.image(referenceInput), (error) => error?.statusCode === 404, 'reference cache must revoke with its question')

console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'ai-reference-material-runtime',
  questionPages: [2], displayPages: [2, 16], rotationDegrees: 90, negativeCases: 3 }))
