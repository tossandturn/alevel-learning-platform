import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  AI_PDF_INGESTION_SCHEMA_VERSION,
  artifactId,
  buildAiStudentStudyRelease,
} from './ai-pdf-ingestion/contract.mjs'
import { AI_PDF_TOPIC_PACK_SCHEMA_VERSION, parseArgs, runTopicPack } from './generate-ai-pdf-topic-pack.mjs'

const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'ai-pdf-topic-pack-'))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

function releasedArtifact({
  questionPdf,
  markSchemePdf,
  routeId = 'cie-9709-as-p1-p5',
  stage = 'AS',
  paperId = 'cie-9709-9709_m25_qp_52',
  generatedAt = '2026-08-31T00:00:00.000Z',
  questions,
} = {}) {
  const questionPdfSha256 = sha256(readFileSync(questionPdf))
  const markSchemePdfSha256 = sha256(readFileSync(markSchemePdf))
  const verificationQuestions = questions.map(question => ({
    questionNumber: question.questionNumber,
    pages: [...new Set((question.regions || []).map(region => region.page))].sort((left, right) => left - right),
    parts: (question.parts || []).map(part => ({ label: part.label, marks: part.marks })),
    tags: question.tags,
    markSchemeEvidence: question.markSchemeEvidence,
  }))
  const artifact = {
    schemaVersion: AI_PDF_INGESTION_SCHEMA_VERSION,
    artifactId: artifactId({ paperId, questionPdfSha256, markSchemePdfSha256 }),
    paperId,
    subject: '9709',
    stage,
    generatedAt,
    syllabusRouteId: routeId,
    status: 'ai-verified',
    storageMode: 'coordinate-only',
    extractor: { provider: 'codex-independent-extraction', model: 'gpt-5.6', schemaName: 'ai_pdf_question_extraction_v1' },
    verifier: { provider: 'codex-independent-verification', model: 'gpt-5.6', schemaName: 'ai_pdf_question_verification_v1' },
    source: {
      questionPdfPath: questionPdf,
      markSchemePdfPath: markSchemePdf,
      questionPdfSha256,
      markSchemePdfSha256,
      pageSizes: { 1: { width: 1200, height: 1600 } },
      markSchemePageSizes: { 1: { width: 1200, height: 1600 } },
    },
    candidate: { questions },
    verification: { questions: verificationQuestions },
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
  return artifact
}

try {
  const artifactRoot = path.join(temporaryRoot, 'artifacts')
  const outputRoot = path.join(temporaryRoot, 'topic-packs')
  const questionPdf = path.join(temporaryRoot, '9709_m25_qp_52.pdf')
  const markSchemePdf = path.join(temporaryRoot, '9709_m25_ms_52.pdf')
  writeFileSync(questionPdf, Buffer.from('%PDF-topic-question-source-fixture', 'utf8'))
  writeFileSync(markSchemePdf, Buffer.from('%PDF-topic-mark-scheme-source-fixture', 'utf8'))

  assert.throws(
    () => parseArgs(['--subject', '9709', '--topic-id', '9709-s1-topic-04'], { cwd: temporaryRoot }),
    error => error?.code === 'ROUTE_ID_REQUIRED',
    'ambiguous subjects must never select a syllabus route implicitly',
  )
  assert.throws(
    () => parseArgs(['--route-id', 'cie-9709-as-p1-p5', '--subject', '9702', '--dry-run'], { cwd: temporaryRoot }),
    error => error?.code === 'ROUTE_SUBJECT_MISMATCH',
  )
  assert.throws(
    () => parseArgs(['--route-id', 'cie-9709-as-p1-p5', '--topic-id', '9709-as-topic-04'], { cwd: temporaryRoot }),
    error => error?.code === 'OFFICIAL_TOPIC_INVALID',
    'old coarse topic IDs must not be accepted as official syllabus topics',
  )
  assert.throws(
    () => parseArgs(['--route-id', 'cie-9709-as-p1-p5'], { cwd: temporaryRoot }),
    error => error?.code === 'TOPIC_ID_REQUIRED',
    'a real render must be scoped to one topic to avoid persistent full-corpus PDF duplication',
  )

  const dryRunOptions = parseArgs([
    '--artifact-root', artifactRoot,
    '--output-root', outputRoot,
    '--route-id', 'cie-9709-as-p1-p5',
    '--dry-run',
  ], { cwd: temporaryRoot })
  assert.equal(dryRunOptions.subject, '9709')
  assert.equal(dryRunOptions.routeId, 'cie-9709-as-p1-p5')

  const questions = [
    {
      questionNumber: '1',
      regions: [{ page: 1, pageImageSha256: 'c'.repeat(64), x0: 0.1, y0: 0.1, x1: 0.8, y1: 0.4 }],
      diagramRegions: [
        { page: 1, pageImageSha256: 'c'.repeat(64), x0: 0.2, y0: 0.2, x1: 0.7, y1: 0.3 },
        { page: 1, pageImageSha256: 'c'.repeat(64), x0: 0.82, y0: 0.15, x1: 0.95, y1: 0.35 },
      ],
      parts: [{ label: 'a', marks: 3, math: ['P(X = 2)'] }],
      tags: {
        primaryTopicId: '9709-s1-topic-04',
        secondaryTopicIds: ['9709-s1-topic-03'],
        syllabusPointIds: ['math-9709-point-5-4-01', 'math-9709-point-5-3-01'],
      },
      markSchemeEvidence: [{ page: 1, pageImageSha256: 'd'.repeat(64) }],
    },
    {
      questionNumber: '2',
      regions: [{ page: 1, pageImageSha256: 'c'.repeat(64), x0: 0.1, y0: 0.5, x1: 0.8, y1: 0.8 }],
      diagramRegions: [],
      parts: [{ label: 'a', marks: 2, math: [] }],
      tags: { primaryTopicId: '9709-as-topic-04', secondaryTopicIds: [], syllabusPointIds: [] },
      markSchemeEvidence: [{ page: 1, pageImageSha256: 'd'.repeat(64) }],
    },
    {
      questionNumber: '3',
      regions: [],
      diagramRegions: [],
      parts: [{ label: 'a', marks: 1, math: [] }],
      tags: { primaryTopicId: '9709-s1-topic-05', secondaryTopicIds: [], syllabusPointIds: [] },
      markSchemeEvidence: [{ page: 1, pageImageSha256: 'd'.repeat(64) }],
    },
  ]
  const verifiedArtifact = releasedArtifact({ questionPdf, markSchemePdf, questions })
  const legacyArtifact = releasedArtifact({
    questionPdf,
    markSchemePdf,
    generatedAt: '2026-08-30T00:00:00.000Z',
    questions: [questions[0]],
  })
  const unreleasedArtifact = { ...verifiedArtifact, artifactId: `sha256:${'e'.repeat(64)}` }
  delete unreleasedArtifact.studentRelease
  const wrongRouteArtifact = releasedArtifact({
    questionPdf,
    markSchemePdf,
    routeId: 'cie-9709-as-p1-p4',
    questions: [{
      ...questions[0],
      tags: { primaryTopicId: '9709-m1-topic-01', secondaryTopicIds: [], syllabusPointIds: ['math-9709-point-4-1-01'] },
    }],
  })

  mkdirSync(artifactRoot, { recursive: true })
  writeFileSync(path.join(artifactRoot, 'verified.json'), `${JSON.stringify(verifiedArtifact)}\n`, 'utf8')
  writeFileSync(path.join(artifactRoot, 'legacy.json'), `${JSON.stringify(legacyArtifact)}\n`, 'utf8')
  writeFileSync(path.join(artifactRoot, 'unreleased.json'), `${JSON.stringify(unreleasedArtifact)}\n`, 'utf8')
  writeFileSync(path.join(artifactRoot, 'wrong-route.json'), `${JSON.stringify(wrongRouteArtifact)}\n`, 'utf8')

  const dryRunResult = await runTopicPack(dryRunOptions, {
    runCropCommand: async () => { throw new Error('dry-run must not crop') },
    mergePdfs: async () => { throw new Error('dry-run must not merge') },
  })
  assert.deepEqual(
    dryRunResult.packs.map((pack) => pack.topicId).sort(),
    ['9709-s1-topic-03', '9709-s1-topic-04'],
    'dry-run must enumerate every official topic membership for a linked question',
  )
  assert.equal(existsSync(outputRoot), false, 'dry-run must not write topic pack files')
  assert.ok(dryRunResult.skipped.some(item => item.reason === 'student-release-invalid'))
  assert.ok(dryRunResult.skipped.some(item => item.reason === 'route-mismatch'))
  assert.ok(dryRunResult.skipped.some(item => item.reason === 'official-topic-missing' && item.questionNumber === '2'))
  assert.ok(dryRunResult.skipped.some(item => item.reason === 'regions-missing' && item.questionNumber === '3'))

  const cropManifests = []
  const result = await runTopicPack(parseArgs([
    '--artifact-root', artifactRoot,
    '--output-root', outputRoot,
    '--route-id', 'cie-9709-as-p1-p5',
    '--topic-id', '9709-s1-topic-04',
  ], { cwd: temporaryRoot }), {
    runCropCommand: async (_command, manifest) => {
      cropManifests.push(manifest)
      mkdirSync(path.dirname(manifest.questionPdfPath), { recursive: true })
      writeFileSync(manifest.questionPdfPath, Buffer.from('%PDF-question-crop', 'utf8'))
    },
    mergePdfs: async (topicPdfPath, inputPaths) => {
      assert.equal(inputPaths.length, 1)
      assert.equal(existsSync(inputPaths[0]), true)
      mkdirSync(path.dirname(topicPdfPath), { recursive: true })
      writeFileSync(topicPdfPath, Buffer.from('%PDF-topic-pack', 'utf8'))
    },
  })

  assert.equal(result.schemaVersion, AI_PDF_TOPIC_PACK_SCHEMA_VERSION)
  assert.equal(result.subject, '9709')
  assert.equal(result.officialSyllabus.routeId, 'cie-9709-as-p1-p5')
  assert.equal(result.packs.length, 1)
  assert.equal(result.packs[0].topicId, '9709-s1-topic-04')
  assert.equal(result.packs[0].topicName, 'Discrete random variables')
  assert.equal(cropManifests.length, 1)
  assert.equal(cropManifests[0].crops.length, 2, 'a nested diagram must not be cropped twice; an external diagram must remain')

  const manifest = JSON.parse(readFileSync(result.packs[0].manifestPath, 'utf8'))
  assert.equal(manifest.schemaVersion, AI_PDF_TOPIC_PACK_SCHEMA_VERSION)
  assert.equal(manifest.routeId, 'cie-9709-as-p1-p5')
  assert.equal(manifest.topic.id, '9709-s1-topic-04')
  assert.equal(manifest.questionCount, 1)
  assert.equal(manifest.questions[0].tags.primaryTopicId, '9709-s1-topic-04')
  assert.deepEqual(manifest.questions[0].diagramRegions, verifiedArtifact.candidate.questions[0].diagramRegions)
  assert.deepEqual(manifest.questions[0].markSchemeEvidence, verifiedArtifact.candidate.questions[0].markSchemeEvidence)
  assert.deepEqual(manifest.questions[0].parts, [{ label: 'a', marks: 3, math: ['P(X = 2)'] }])
  assert.deepEqual(manifest.questions[0].source.pages, [1])
  assert.equal(manifest.questions[0].source.questionPdfSha256, verifiedArtifact.source.questionPdfSha256)
  assert.equal(manifest.questions[0].source.markSchemePdfSha256, verifiedArtifact.source.markSchemePdfSha256)
  assert.match(manifest.topicPdfSha256, /^[a-f0-9]{64}$/)

  const secondaryCropManifests = []
  const secondaryResult = await runTopicPack(parseArgs([
    '--artifact-root', artifactRoot,
    '--output-root', path.join(temporaryRoot, 'secondary-topic-packs'),
    '--route-id', 'cie-9709-as-p1-p5',
    '--topic-id', '9709-s1-topic-03',
  ], { cwd: temporaryRoot }), {
    runCropCommand: async (_command, secondaryManifest) => {
      secondaryCropManifests.push(secondaryManifest)
      mkdirSync(path.dirname(secondaryManifest.questionPdfPath), { recursive: true })
      writeFileSync(secondaryManifest.questionPdfPath, Buffer.from('%PDF-secondary-question-crop', 'utf8'))
    },
    mergePdfs: async (secondaryTopicPdfPath) => {
      mkdirSync(path.dirname(secondaryTopicPdfPath), { recursive: true })
      writeFileSync(secondaryTopicPdfPath, Buffer.from('%PDF-secondary-topic-pack', 'utf8'))
    },
  })
  assert.equal(secondaryResult.packs.length, 1, 'a secondary official topic must receive its linked question pack')
  assert.equal(secondaryResult.packs[0].topicId, '9709-s1-topic-03')
  assert.equal(secondaryCropManifests.length, 1)
  const secondaryManifest = JSON.parse(readFileSync(secondaryResult.packs[0].manifestPath, 'utf8'))
  assert.equal(secondaryManifest.questionCount, 1)
  assert.equal(secondaryManifest.questions[0].topicId, '9709-s1-topic-03')
  assert.equal(secondaryManifest.questions[0].tags.primaryTopicId, '9709-s1-topic-04', 'secondary pack must preserve the source primary topic tag')

  console.log(JSON.stringify({ status: 'passed', packs: result.packs.length, skipped: result.skipped.length }))
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
