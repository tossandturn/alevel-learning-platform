import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'

import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { createNativeQuestionImages } from '../server/nativeQuestionImages.js'
import { canonicalHandwritingMarkingContext } from '../server/aiApi.js'
import { assertPromotedAiStudyGroups, verifyAiStudyPromotion } from '../server/aiStudyPromotion.js'
import { artifactId, buildAiStudentStudyRelease, sourceReviewInputSha256 } from './ai-pdf-ingestion/contract.mjs'
import { canonicalAiMarkingProvenance } from '../src/lib/sourceContentContract.js'

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
const routeId = 'cie-9701-as-chemistry'
const referenceMaterialDelivery = Object.freeze({
  schemaVersion: 'stem-ai-reference-material-delivery.v1',
  renderer: 'native-question-images',
  clientCapability: 'region-v2',
  coordinateContract: 'normalized-rotation-v1',
  authorization: 'released-question-bank-only',
  markingContext: 'part-source-evidence-v1',
})
const session = (id, model) => ({
  sessionId: `00000000-0000-4000-8000-${id.padStart(12, '0')}`,
  turnId: `10000000-0000-4000-8000-${id.padStart(12, '0')}`,
  modelProvider: 'fixture',
  model,
  sessionLogSha256: id.repeat(64),
  outputSha256: String(Number(id) + 2).repeat(64),
})
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
  syllabusRouteId: routeId, status: 'ai-verified', storageMode: 'coordinate-only',
  extractor: { provider: 'fixture', model: 'fixture-a', schemaName: 'ai_pdf_question_extraction_v1',
    runtimeAttestation: session('1', 'fixture-a') },
  verifier: { provider: 'fixture', model: 'fixture-b', schemaName: 'ai_pdf_question_verification_v1',
    runtimeAttestation: session('2', 'fixture-b') },
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
  ], runtimeAttestation: { finalSourceReview: {
    sessionId: '50000000-0000-4000-8000-000000000005',
    turnId: '60000000-0000-4000-8000-000000000006',
    modelProvider: 'fixture-reviewer', model: 'fixture-model',
    sessionLogSha256: '5'.repeat(64), fullReviewSha256: '6'.repeat(64),
  } } }
artifact.studentRelease = buildAiStudentStudyRelease({ ...artifact, routeId: artifact.syllabusRouteId })
assert.ok(artifact.studentRelease, 'synthetic reference artifact must pass the student release contract')
const artifactDirectory = path.join(artifactRoot, paperId)
fs.mkdirSync(artifactDirectory, { recursive: true })
const artifactFile = path.join(artifactDirectory, 'q2.json')
fs.writeFileSync(artifactFile, JSON.stringify(artifact), 'utf8')

const artifactRelative = `${paperId}/${path.basename(artifactFile)}`
const writePinnedManifest = (schemaVersion, delivery = undefined) => {
  const manifest = {
    schemaVersion,
    scope: 'chapter-study',
    formalProgressEligible: false,
    routeIds: [routeId],
    expectedRouteGroups: 1,
    ...(delivery ? { referenceMaterialDelivery: delivery } : {}),
    artifacts: [{ path: artifactRelative, sha256: hash(fs.readFileSync(artifactFile)) }],
  }
  const bytes = Buffer.from(JSON.stringify(manifest))
  fs.writeFileSync(path.join(artifactRoot, 'candidate-manifest.json'), bytes)
  return hash(bytes)
}
const promotionPolicy = (manifestSha256) => ({
  mode: 'release-pinned',
  trustedManifestSha256: manifestSha256,
  expectedRealRoot: fs.realpathSync(artifactRoot),
  expectedRouteIds: [routeId],
})
const createPinnedLoader = (manifestSha256) => createAiVerifiedQuestionBankLoader({
  artifactRoot,
  libraryRoot: path.dirname(libraryRoot),
  promotionPolicy: promotionPolicy(manifestSha256),
})
const legacyLoad = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot: path.dirname(libraryRoot) })
assert.throws(() => legacyLoad(), (error) => error?.code === 'AI_STUDY_PROMOTION_INVALID',
  'an unmanifested legacy root must not bypass reference-delivery authorization')
const initialV2Hash = writePinnedManifest('stem-ai-study-release-pack.v2', referenceMaterialDelivery)
const load = createPinnedLoader(initialV2Hash)
const loaded = load()
assert.equal(loaded.groups.length, 1)
const group = loaded.groups[0]
assert.deepEqual(group.sourceContent.sourcePages, [2], 'reference material must not widen the internal question span')
assert.equal(group.sourceRef.pageStart, 2)
assert.equal(group.sourceRef.pageEnd, 2)
const originalBindingSignature = group.sourceContent.bindingSignature
assert.deepEqual(group.referenceMaterialRegions.map((entry) => ({ page: entry.page, rotationDegrees: entry.rotationDegrees })),
  [{ page: 16, rotationDegrees: 90 }])
assert.equal(group.parts[0].needsReferenceMaterial, true)
assert.ok(group.parts[0].sourceEvidence.some((entry) => entry.evidenceRole === 'reference-material'
  && entry.page === 16 && entry.rotationDegrees === 90))
const provenance = canonicalAiMarkingProvenance(group, group.parts[0])
assert.ok(provenance)
const markingProvenance = { ...provenance, routeId: group.routeId }
const markingContext = canonicalHandwritingMarkingContext({ provenance: markingProvenance }, { questionBank: [group] })
assert.equal(markingContext.ok, true,
  `the authoritative marking context must retain the complete reference-bound signature: ${JSON.stringify(markingContext)}`)
for (const mutate of [
  (entry) => { entry.rotationDegrees = 270 },
  (entry) => { entry.pageImageSha256 = '0'.repeat(64) },
  (entry) => { entry.region = [0.21, 0.1, 0.8, 0.9] },
  (entry) => { entry.evidenceRole = 'question-part' },
]) {
  const changedEvidence = structuredClone(group.parts[0].sourceEvidence)
  const changedReference = changedEvidence.find((entry) => entry.evidenceRole === 'reference-material')
  mutate(changedReference)
  const changedGroup = { ...group, parts: [{ ...group.parts[0], sourceEvidence: changedEvidence }] }
  assert.equal(canonicalHandwritingMarkingContext({ provenance: markingProvenance }, { questionBank: [changedGroup] }).ok,
    false, 'each reference evidence field must participate in the marking binding')
}
const sourceEvidenceWithoutReference = group.parts[0].sourceEvidence
  .filter((entry) => entry.evidenceRole !== 'reference-material')
const bankWithoutReference = [{ ...group, referenceMaterialRegions: [], parts: [{ ...group.parts[0],
  needsReferenceMaterial: false, sourceEvidence: sourceEvidenceWithoutReference }] }]
assert.deepEqual(canonicalHandwritingMarkingContext({ provenance: markingProvenance }, { questionBank: bankWithoutReference }),
  { ok: false, code: 'source_provenance_mismatch' },
  'removing a required reference page must invalidate an existing marking capability')

let bank = [group]
let released = true
const questionPageReadRoles = []
const service = createNativeQuestionImages({ getQuestionBank: () => bank, libraryRoot: path.dirname(libraryRoot),
  isReleased: () => released, pageReader: async (spec) => {
    questionPageReadRoles.push(spec.role)
    return { bytes: spec.page === 16 ? referencePage : questionPage,
      contentType: 'image/png', sha256: spec.expectedPageImageSha256 }
  } })
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
const pixelAt = async (bytes, x, y) => {
  const image = await loadImage(bytes), canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
  return [...context.getImageData(x, y, 1, 1).data]
}
assert.deepEqual(await pixelAt(renderedPage.bytes, 110, 20), [255, 255, 255, 255],
  '90 degree page rotation must move the asymmetric marker clockwise')
assert.deepEqual(await pixelAt(renderedPage.bytes, 30, 90), [124, 45, 18, 255])
const legacyProjected = service.projectSet({ questionGroups: [{ id: group.sourceQuestionId, routeId: group.routeId,
  sourceContent: { assetUrls: [], pages: [2] } }] }, { questionBank: bank })
assert.deepEqual(legacyProjected.questionGroups[0].sourceContent.pages, [2, 16],
  'clients without a region capability header still need the reference page')
const legacyReference = legacyProjected.questionGroups[0].nativeSourceImages.find((entry) => entry.page === 16)
assert.ok(legacyReference && !legacyReference.url.includes('view=region'))
assert.ok(!legacyProjected.questionGroups[0].nativeSourceImages.some((entry) => /mark.?scheme|answer/i.test(entry.url)),
  'question image projection must not expose mark-scheme resources')
assert.deepEqual((await service.image(Object.fromEntries(new URL(legacyReference.url, 'https://example.test').searchParams))).imageSize,
  [160, 120], 'legacy page view must apply the reviewed rotation')
assert.deepEqual(service.descriptors('cie-9701-a2-chemistry', group.sourceQuestionId), [],
  'reference descriptors must remain bound to the released route')
const projected = service.projectSet({ questionGroups: [{ id: group.sourceQuestionId, routeId: group.routeId,
  sourceContent: { assetUrls: [], pages: [2] } }] }, { view: 'region', questionBank: bank })
assert.deepEqual(projected.questionGroups[0].sourceContent.pages, [2, 16])
assert.deepEqual(group.sourceContent.sourcePages, [2])
assert.equal(group.sourceRef.pageStart, 2)
assert.equal(group.sourceRef.pageEnd, 2)
assert.equal(group.sourceContent.bindingSignature, originalBindingSignature)

const ordinaryEvidence = group.parts[0].sourceEvidence.find((entry) => entry.evidenceRole === 'question-part')
const referenceEvidence = group.parts[0].sourceEvidence.find((entry) => entry.evidenceRole === 'reference-material')
const rotatedVariant = { ...referenceEvidence, rotationDegrees: 270 }
const variantQuestion = { ...group, sourceQuestionId: `${paperId}:q3`,
  sourceContent: { ...group.sourceContent, bindingSignature: `${group.sourceContent.bindingSignature}:rotation-variant` },
  parts: [{ ...group.parts[0], sourceEvidence: [ordinaryEvidence, referenceEvidence, referenceEvidence, rotatedVariant] }],
  diagramRegions: [] }
let variantReads = 0
const variantService = createNativeQuestionImages({ getQuestionBank: () => [variantQuestion], libraryRoot: path.dirname(libraryRoot),
  isReleased: () => true, pageReader: async (spec) => { variantReads += 1; return { bytes: spec.page === 16 ? referencePage : questionPage,
    contentType: 'image/png', sha256: spec.expectedPageImageSha256 } } })
const variantDescriptors = variantService.descriptors(variantQuestion.routeId, variantQuestion.sourceQuestionId, { view: 'region' })
assert.equal(variantDescriptors.length, 3, 'shared identical reference evidence must deduplicate while distinct rotations remain separate')
const rotatedDescriptors = variantDescriptors.filter((entry) => entry.page === 16)
assert.equal(rotatedDescriptors.length, 2)
assert.notEqual(rotatedDescriptors[0].url, rotatedDescriptors[1].url)
const rotatedResults = []
for (const descriptor of rotatedDescriptors) {
  const input = Object.fromEntries(new URL(descriptor.url, 'https://example.test').searchParams)
  rotatedResults.push(await variantService.image(input))
  await variantService.image(input)
}
assert.equal(variantReads, 2, 'each immutable rotation needs one physical read and its own cache entry')
assert.notEqual(rotatedResults[0].sha256, rotatedResults[1].sha256)
const pageVariants = variantService.descriptors(variantQuestion.routeId, variantQuestion.sourceQuestionId)
  .filter((entry) => entry.page === 16)
assert.equal(pageVariants.length, 2)
const pageVariantResults = []
for (const descriptor of pageVariants) pageVariantResults.push(await variantService.image(
  Object.fromEntries(new URL(descriptor.url, 'https://example.test').searchParams)))
assert.deepEqual(await pixelAt(pageVariantResults[0].bytes, 110, 20), [255, 255, 255, 255])
assert.deepEqual(await pixelAt(pageVariantResults[0].bytes, 30, 90), [124, 45, 18, 255])
assert.deepEqual(await pixelAt(pageVariantResults[1].bytes, 30, 90), [255, 255, 255, 255],
  '270 degree page rotation must move the asymmetric marker counter-clockwise')
assert.deepEqual(await pixelAt(pageVariantResults[1].bytes, 110, 20), [124, 45, 18, 255])

for (const mutate of [
  (value) => { value.verification.questions[0].referenceMaterialRegions[0].rotationDegrees = 270 },
  (value) => { value.verification.questions[0].parts[0].needsReferenceMaterial = false },
  (value) => { value.verification.questions[0].referenceMaterialRegions = [] },
  (value) => {
    value.candidate.questions[0].referenceMaterialRegions = []
    value.verification.questions[0].referenceMaterialRegions = []
  },
]) {
  const invalid = structuredClone(artifact)
  mutate(invalid)
  fs.writeFileSync(artifactFile, JSON.stringify(invalid), 'utf8')
  const invalidHash = writePinnedManifest('stem-ai-study-release-pack.v2', referenceMaterialDelivery)
  assert.throws(() => createPinnedLoader(invalidHash)(), (error) => error?.code === 'AI_STUDY_PROMOTION_INVALID')
}
fs.writeFileSync(artifactFile, JSON.stringify(artifact), 'utf8')
assert.equal(writePinnedManifest('stem-ai-study-release-pack.v2', referenceMaterialDelivery), initialV2Hash)
assert.equal(load({ refresh: true }).groups.length, 1)
await service.image(referenceInput)
released = false
assert.throws(() => service.image(referenceInput), (error) => error?.statusCode === 404,
  'revoking release authorization must invalidate a warmed reference URL')
released = true
assert.throws(() => service.image({ ...referenceInput, routeId: 'cie-9701-a2-chemistry' }),
  (error) => error?.statusCode === 404, 'cross-route reference requests must fail')
assert.throws(() => service.image({ ...referenceInput, sourceQuestionId: `${paperId}:q999` }),
  (error) => error?.statusCode === 404, 'cross-question reference requests must fail')
bank = []
assert.throws(() => service.image(referenceInput), (error) => error?.statusCode === 404, 'reference cache must revoke with its question')
assert.ok(questionPageReadRoles.length > 0 && questionPageReadRoles.every((role) => role === 'question-paper'),
  'reference delivery must never read mark-scheme pages')

const v1Hash = writePinnedManifest('stem-ai-study-release-pack.v1')
assert.throws(() => createPinnedLoader(v1Hash)(), (error) => error?.code === 'AI_STUDY_PROMOTION_INVALID',
  'reference material must remain blocked without an explicit delivery capability')
const invalidDelivery = { ...referenceMaterialDelivery, clientCapability: 'unknown-client' }
const invalidV2Hash = writePinnedManifest('stem-ai-study-release-pack.v2', invalidDelivery)
assert.throws(() => createPinnedLoader(invalidV2Hash)(), (error) => error?.code === 'AI_STUDY_PROMOTION_INVALID',
  'an unknown reference delivery capability must fail closed')
const v2Hash = writePinnedManifest('stem-ai-study-release-pack.v2', referenceMaterialDelivery)
const promoted = createPinnedLoader(v2Hash)()
assert.equal(promoted.groups.length, 1)
assert.deepEqual(promoted.groups[0].referenceMaterialRegions.map((entry) => ({
  page: entry.page, rotationDegrees: entry.rotationDegrees,
})), [{ page: 16, rotationDegrees: 90 }])
assert.ok(promoted.groups[0].parts[0].sourceEvidence.some((entry) => entry.evidenceRole === 'reference-material'
  && entry.page === 16 && entry.rotationDegrees === 90))
const verifiedPromotion = verifyAiStudyPromotion({ artifactRoot, artifactPaths: [artifactFile],
  promotionPolicy: promotionPolicy(v2Hash) })
assert.doesNotThrow(() => assertPromotedAiStudyGroups(verifiedPromotion, [{ artifact }], [promoted.groups[0]]))
const mismatchedArtifact = structuredClone(artifact)
mismatchedArtifact.verification.questions[0].referenceMaterialRegions[0].rotationDegrees = 270
assert.throws(() => assertPromotedAiStudyGroups(verifiedPromotion, [{ artifact: mismatchedArtifact }], [promoted.groups[0]]),
  (error) => error?.code === 'AI_STUDY_PROMOTION_INVALID', 'candidate and verification reference tuples must match')
const mismatchedQuestionRegion = structuredClone(promoted.groups[0])
mismatchedQuestionRegion.referenceMaterialRegions[0].page = 999
assert.throws(() => assertPromotedAiStudyGroups(verifiedPromotion, [{ artifact }], [mismatchedQuestionRegion]),
  (error) => error?.code === 'AI_STUDY_PROMOTION_INVALID', 'artifact and public group reference tuples must match')
const mismatchedPartEvidence = structuredClone(promoted.groups[0])
mismatchedPartEvidence.parts[0].sourceEvidence.find((entry) => entry.evidenceRole === 'reference-material').rotationDegrees = 270
assert.throws(() => assertPromotedAiStudyGroups(verifiedPromotion, [{ artifact }], [mismatchedPartEvidence]),
  (error) => error?.code === 'AI_STUDY_PROMOTION_INVALID', 'part-level reference evidence must match the reviewed tuple')
const missingReferenceArtifact = structuredClone(artifact)
missingReferenceArtifact.candidate.questions[0].referenceMaterialRegions = []
missingReferenceArtifact.verification.questions[0].referenceMaterialRegions = []
const missingReferenceGroup = structuredClone(promoted.groups[0])
missingReferenceGroup.referenceMaterialRegions = []
missingReferenceGroup.parts[0].sourceEvidence = missingReferenceGroup.parts[0].sourceEvidence
  .filter((entry) => entry.evidenceRole !== 'reference-material')
assert.throws(() => assertPromotedAiStudyGroups(verifiedPromotion, [{ artifact: missingReferenceArtifact }], [missingReferenceGroup]),
  (error) => error?.code === 'AI_STUDY_PROMOTION_INVALID',
  'needsReferenceMaterial must never pass with empty artifact, group and part reference tuples')

const artifactWithReferenceCount = (count) => {
  const value = structuredClone(artifact)
  const regions = Array.from({ length: count }, (_, index) => {
    const column = index % 5, row = Math.floor(index / 5)
    const x0 = 0.01 + column * 0.19, y0 = 0.01 + row * 0.22
    return { page: 16, pageImageSha256: referencePageSha256,
      x0, y0, x1: x0 + 0.1, y1: y0 + 0.1, partLabels: ['answer'], rotationDegrees: 90 }
  })
  value.candidate.questions[0].referenceMaterialRegions = structuredClone(regions)
  value.verification.questions[0].referenceMaterialRegions = structuredClone(regions)
  delete value.studentRelease
  value.sourceReview.inputSha256 = sourceReviewInputSha256(value)
  value.studentRelease = buildAiStudentStudyRelease({ ...value, routeId: value.syllabusRouteId })
  assert.ok(value.studentRelease)
  return value
}
fs.writeFileSync(artifactFile, JSON.stringify(artifactWithReferenceCount(19)), 'utf8')
const twentyDescriptorHash = writePinnedManifest('stem-ai-study-release-pack.v2', referenceMaterialDelivery)
assert.equal(createPinnedLoader(twentyDescriptorHash)().groups.length, 1,
  'one question crop plus nineteen reference crops reaches the renderer limit of twenty')
fs.writeFileSync(artifactFile, JSON.stringify(artifactWithReferenceCount(20)), 'utf8')
const twentyOneDescriptorHash = writePinnedManifest('stem-ai-study-release-pack.v2', referenceMaterialDelivery)
assert.throws(() => createPinnedLoader(twentyOneDescriptorHash)(),
  (error) => error?.code === 'AI_STUDY_PROMOTION_INVALID',
  'promotion must reject content that the native renderer would reduce to zero descriptors')
fs.writeFileSync(artifactFile, JSON.stringify(artifact), 'utf8')
writePinnedManifest('stem-ai-study-release-pack.v2', referenceMaterialDelivery)

console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'ai-reference-material-runtime',
  questionPages: [2], displayPages: [2, 16], rotationDegrees: [90, 270],
  sharedReferenceDeduplicated: true, rotationCacheEntries: 2, promotionManifest: 'v2',
  negativeCategories: ['legacy', 'capability', 'tuple-binding', 'renderer-budget', 'rotation', 'revocation', 'marking-provenance'] }))
