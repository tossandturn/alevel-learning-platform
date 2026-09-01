import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { artifactId, buildAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'
import { routeById } from '../src/data/routeRegistry.js'
import { createTopicPdfRenderer } from '../server/topicPdfRenderer.js'

const route = routeById('cie-9702-a2-physics')
const topic = route.syllabus.topics.find((item) => item.id === 'physics-9702-topic-13')
const secondaryTopic = route.syllabus.topics.find((item) => item.id === 'physics-9702-topic-14')
assert.ok(topic, 'the fixture must use an official A2 Physics syllabus topic')
assert.ok(secondaryTopic, 'the fixture must use an official secondary A2 Physics syllabus topic')

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function fixture({ component = 4, released = true, mismatch = false, legacySource = false, crossTopicBinding = false, verificationExtra = false, duplicateCandidate = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-topic-pdf-fixture-'))
  const artifactRoot = path.join(root, 'artifacts')
  const libraryRoot = path.join(root, 'library')
  const subjectRoot = path.join(libraryRoot, '9702')
  fs.mkdirSync(artifactRoot, { recursive: true })
  fs.mkdirSync(subjectRoot, { recursive: true })

  const questionFile = `9702_m21_qp_${component}2.pdf`
  const markSchemeFile = `9702_m21_ms_${component}2.pdf`
  const questionPdfPath = path.join(subjectRoot, questionFile)
  const markSchemePdfPath = path.join(subjectRoot, markSchemeFile)
  fs.writeFileSync(questionPdfPath, Buffer.from('%PDF-1.4 question fixture'))
  fs.writeFileSync(markSchemePdfPath, Buffer.from('%PDF-1.4 mark scheme fixture'))
  const questionPdfSha256 = sha256(fs.readFileSync(questionPdfPath))
  const markSchemePdfSha256 = sha256(fs.readFileSync(markSchemePdfPath))
  const pageImageHashes = {
    2: '2'.repeat(64),
    3: '3'.repeat(64),
  }
  const markSchemePageHashes = { 1: '1'.repeat(64) }
  const regions = [
    { page: 2, x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.65, pageImageSha256: pageImageHashes[2] },
    { page: 3, x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.8, pageImageSha256: pageImageHashes[3] },
  ]
  const diagramRegions = [
    { page: 2, x0: 0.2, y0: 0.2, x1: 0.5, y1: 0.4, pageImageSha256: pageImageHashes[2] },
  ]
  const candidate = {
    questionNumber: '1',
    questionStartPage: 2,
    regions,
    diagramRegions,
    parts: [{ label: 'a', marks: 3, ocrText: 'Calculate the field strength.' }],
    tags: {
      primaryTopicId: topic.id,
      secondaryTopicIds: crossTopicBinding ? [secondaryTopic.id] : [],
      syllabusPointIds: crossTopicBinding
        ? [topic.points[0].id, secondaryTopic.points[0].id]
        : [topic.points[0].id],
    },
    markSchemeEvidence: [{ page: 1, pageImageSha256: markSchemePageHashes[1] }],
  }
  const verification = clone(candidate)
  verification.pages = [2, 3]
  verification.diagramRegionCount = 1
  if (mismatch) verification.tags.syllabusPointIds = [topic.points[1].id]

  const source = {
    board: legacySource ? 'CIE' : 'Cambridge International',
    paperId: `cie-9702-9702_m21_qp_${component}2`,
    specificationId: legacySource ? route.routeId : 'cambridge-9702-2025-2027',
    stage: 'A2',
    rightsStatus: 'official-personal-study',
    accessPolicyId: 'private-study-library',
    questionPdfSha256,
    markSchemePdfSha256,
    questionPdfRelativePath: `9702/${questionFile}`,
    markSchemePdfRelativePath: `9702/${markSchemeFile}`,
    renderDpi: 180,
    pageImageHashes,
    pageSizes: { 2: { width: 1200, height: 1700 }, 3: { width: 1200, height: 1700 } },
    markSchemePageHashes,
    markSchemePageSizes: { 1: { width: 1200, height: 1700 } },
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
    candidate: { questions: [candidate] },
    verification: { questions: [verification] },
  }
  if (verificationExtra) artifact.verification.questions.push({ ...clone(verification), questionNumber: '2' })
  if (duplicateCandidate) artifact.candidate.questions.push(clone(candidate))
  artifact.studentRelease = released
    ? buildAiStudentStudyRelease({
        artifactId: id,
        routeId: route.routeId,
        status: artifact.status,
        source,
        extractor: artifact.extractor,
        verifier: artifact.verifier,
        candidate: artifact.candidate,
        verification: artifact.verification,
      })
    : null
  const artifactPath = path.join(artifactRoot, 'paper', 'artifact.json')
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
  fs.writeFileSync(artifactPath, JSON.stringify(artifact), 'utf8')
  return { root, artifactRoot, libraryRoot, artifactPath, questionFile, markSchemeFile, artifact }
}

function fakeAdapters() {
  const crops = []
  const merges = []
  return {
    crops,
    merges,
    runCropCommand: async (_command, manifest) => {
      crops.push(manifest)
      fs.mkdirSync(path.dirname(manifest.questionPdfPath), { recursive: true })
      fs.writeFileSync(manifest.questionPdfPath, Buffer.from('%PDF-1.4 cropped question'))
    },
    mergePdfs: async (outputPath, inputPaths) => {
      merges.push({ outputPath, inputPaths })
      fs.writeFileSync(outputPath, Buffer.from('%PDF-1.4 merged topic'))
    },
  }
}

async function expectCode(operation, code) {
  await assert.rejects(operation, (error) => error?.code === code, `expected renderer error ${code}`)
}

const created = []
try {
  const valid = fixture()
  created.push(valid.root)
  const adapters = fakeAdapters()
  const renderer = createTopicPdfRenderer({
    artifactRoot: valid.artifactRoot,
    libraryRoot: valid.libraryRoot,
    artifactPaths: () => [valid.artifactPath],
    runCropCommand: adapters.runCropCommand,
    mergePdfs: adapters.mergePdfs,
  })
  const result = await renderer({ routeId: route.routeId, topicId: topic.id })
  assert.ok(Buffer.isBuffer(result.pdf), 'renderer must return a PDF buffer')
  assert.equal(result.pdf.subarray(0, 5).toString('ascii'), '%PDF-', 'renderer output must be a PDF')
  assert.equal(result.manifest.questionCount, 1, 'a cross-page question must remain one question entry')
  assert.equal(result.manifest.authority, 'ai-provisional', 'AI-derived topic PDFs must expose provisional authority')
  assert.equal(result.manifest.studentStudyEligible, true, 'AI-derived topic PDFs may be used for study only')
  assert.equal(result.manifest.formalProgressEligible, false, 'AI-derived topic PDFs must stay outside formal progress')
  assert.deepEqual(result.manifest.questions[0].pages, [2, 3], 'all source pages must be retained')
  assert.equal(adapters.crops.length, 1, 'one complete source question must use one crop manifest')
  assert.equal(adapters.crops[0].crops.length, 2, 'a diagram inside the question region must not add a duplicate crop')
  assert.equal(adapters.merges.length, 1)
  assert.equal(adapters.merges[0].inputPaths.length, 1)
  assert.match(JSON.stringify(result.manifest), /physics-9702-point-13-1-01/)
  assert.doesNotMatch(JSON.stringify(result.manifest), /D:\\|\/tmp\\|\/var\\/, 'safe manifest must not expose local paths')

  const legacy = fixture({ legacySource: true })
  created.push(legacy.root)
  const legacyAdapters = fakeAdapters()
  const legacyRenderer = createTopicPdfRenderer({
    artifactRoot: legacy.artifactRoot,
    libraryRoot: legacy.libraryRoot,
    artifactPaths: () => [legacy.artifactPath],
    runCropCommand: legacyAdapters.runCropCommand,
    mergePdfs: legacyAdapters.mergePdfs,
  })
  const legacyResult = await legacyRenderer({ routeId: route.routeId, topicId: topic.id })
  assert.equal(legacyResult.manifest.questionCount, 1, 'legacy CIE route provenance must remain renderable')

  const unrelatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-topic-pdf-unrelated-'))
  created.push(unrelatedRoot)
  const unrelatedPath = path.join(unrelatedRoot, 'unrelated.json')
  fs.writeFileSync(unrelatedPath, JSON.stringify({
    source: { questionPdfRelativePath: '9702/9702_m21_qp_22.pdf' },
  }), 'utf8')
  const unrelatedRenderer = createTopicPdfRenderer({
    artifactRoot: unrelatedRoot,
    libraryRoot: legacy.libraryRoot,
    artifactPaths: () => [unrelatedPath],
  })
  await expectCode(() => unrelatedRenderer({ routeId: route.routeId, topicId: topic.id }), 'topic_pdf_empty')

  const expired = fixture({ released: false })
  created.push(expired.root)
  const expiredRenderer = createTopicPdfRenderer({
    artifactRoot: expired.artifactRoot,
    libraryRoot: expired.libraryRoot,
    artifactPaths: () => [expired.artifactPath],
    runCropCommand: adapters.runCropCommand,
    mergePdfs: adapters.mergePdfs,
  })
  await expectCode(() => expiredRenderer({ routeId: route.routeId, topicId: topic.id }), 'topic_pdf_empty')

  const p5 = fixture({ component: 5 })
  created.push(p5.root)
  const p5Renderer = createTopicPdfRenderer({
    artifactRoot: p5.artifactRoot,
    libraryRoot: p5.libraryRoot,
    artifactPaths: () => [p5.artifactPath],
    runCropCommand: adapters.runCropCommand,
    mergePdfs: adapters.mergePdfs,
  })
  await expectCode(() => p5Renderer({ routeId: route.routeId, topicId: topic.id }), 'invalid_paper_component')

  const mismatch = fixture({ mismatch: true })
  created.push(mismatch.root)
  const mismatchRenderer = createTopicPdfRenderer({
    artifactRoot: mismatch.artifactRoot,
    libraryRoot: mismatch.libraryRoot,
    artifactPaths: () => [mismatch.artifactPath],
    runCropCommand: adapters.runCropCommand,
    mergePdfs: adapters.mergePdfs,
  })
  await expectCode(() => mismatchRenderer({ routeId: route.routeId, topicId: topic.id }), 'topic_pdf_empty')

  const incompleteReview = fixture({ verificationExtra: true })
  created.push(incompleteReview.root)
  const incompleteReviewRenderer = createTopicPdfRenderer({
    artifactRoot: incompleteReview.artifactRoot,
    libraryRoot: incompleteReview.libraryRoot,
    artifactPaths: () => [incompleteReview.artifactPath],
    runCropCommand: adapters.runCropCommand,
    mergePdfs: adapters.mergePdfs,
  })
  await expectCode(() => incompleteReviewRenderer({ routeId: route.routeId, topicId: topic.id }), 'topic_pdf_empty')

  const duplicateCandidate = fixture({ duplicateCandidate: true })
  created.push(duplicateCandidate.root)
  const duplicateCandidateRenderer = createTopicPdfRenderer({
    artifactRoot: duplicateCandidate.artifactRoot,
    libraryRoot: duplicateCandidate.libraryRoot,
    artifactPaths: () => [duplicateCandidate.artifactPath],
    runCropCommand: adapters.runCropCommand,
    mergePdfs: adapters.mergePdfs,
  })
  await expectCode(() => duplicateCandidateRenderer({ routeId: route.routeId, topicId: topic.id }), 'topic_pdf_empty')

  const crossTopic = fixture({ crossTopicBinding: true })
  created.push(crossTopic.root)
  const crossTopicAdapters = fakeAdapters()
  const crossTopicRenderer = createTopicPdfRenderer({
    artifactRoot: crossTopic.artifactRoot,
    libraryRoot: crossTopic.libraryRoot,
    artifactPaths: () => [crossTopic.artifactPath],
    runCropCommand: crossTopicAdapters.runCropCommand,
    mergePdfs: crossTopicAdapters.mergePdfs,
  })
  const crossTopicResult = await crossTopicRenderer({ routeId: route.routeId, topicId: topic.id })
  assert.equal(crossTopicResult.manifest.questionCount, 1, 'a question bound to a secondary official topic must remain renderable')
  assert.deepEqual(crossTopicResult.manifest.questions[0].tags.secondaryTopicIds, [secondaryTopic.id])
  assert.deepEqual(
    crossTopicResult.manifest.questions[0].syllabus.points.map((point) => point.id),
    [topic.points[0].id, secondaryTopic.points[0].id],
    'manifest must preserve official point metadata from the primary and secondary topic union',
  )

  const secondaryTopicResult = await crossTopicRenderer({ routeId: route.routeId, topicId: secondaryTopic.id })
  assert.equal(secondaryTopicResult.manifest.topic.id, secondaryTopic.id, 'a secondary official topic must be able to open its own topic PDF')
  assert.equal(secondaryTopicResult.manifest.questionCount, 1, 'topic PDF membership must match Topic Drill secondary-topic membership')
  assert.equal(secondaryTopicResult.manifest.questions[0].tags.primaryTopicId, topic.id, 'rendering from a secondary topic must preserve the source primary topic')

  const cleanupFixture = fixture()
  created.push(cleanupFixture.root)
  let temporaryDirectory = ''
  const cleanupRenderer = createTopicPdfRenderer({
    artifactRoot: cleanupFixture.artifactRoot,
    libraryRoot: cleanupFixture.libraryRoot,
    artifactPaths: () => [cleanupFixture.artifactPath],
    runCropCommand: async (_command, manifest) => {
      temporaryDirectory = path.resolve(manifest.outputDirectory, '..', '..', '..')
      fs.mkdirSync(path.dirname(manifest.questionPdfPath), { recursive: true })
      fs.writeFileSync(manifest.questionPdfPath, Buffer.from('%PDF-1.4 cropped question'))
    },
    mergePdfs: async (outputPath) => fs.writeFileSync(outputPath, Buffer.from('%PDF-1.4 merged topic')),
  })
  await cleanupRenderer({ routeId: route.routeId, topicId: topic.id })
  assert.ok(temporaryDirectory, 'renderer must allocate a temporary directory')
  assert.equal(fs.existsSync(temporaryDirectory), false, 'temporary topic output must be removed after success')

  console.log('Topic PDF renderer contract passed.')
} finally {
  for (const root of created) fs.rmSync(root, { recursive: true, force: true })
}
