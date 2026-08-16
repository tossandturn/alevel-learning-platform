import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { AI_PDF_INGESTION_SCHEMA_VERSION } from './ai-pdf-ingestion/contract.mjs'
import { AI_PDF_TOPIC_PACK_SCHEMA_VERSION, parseArgs, runTopicPack } from './generate-ai-pdf-topic-pack.mjs'

const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'ai-pdf-topic-pack-'))

try {
  const artifactRoot = path.join(temporaryRoot, 'artifacts')
  const outputRoot = path.join(temporaryRoot, 'topic-packs')
  const sourcePdf = path.join(temporaryRoot, '9709-question.pdf')
  const sourceBytes = Buffer.from('%PDF-topic-source-fixture', 'utf8')
  writeFileSync(sourcePdf, sourceBytes)
  const sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex')

  assert.throws(
    () => parseArgs(['--subject', '9709', '--topic-id', '9709-as-topic-04'], { cwd: temporaryRoot }),
    (error) => error?.code === 'OFFICIAL_TOPIC_INVALID',
    '9709 topic pack must reject old coarse AS topic IDs',
  )
  assert.equal(parseArgs([
    '--artifact-root', artifactRoot,
    '--output-root', outputRoot,
    '--subject', '9709',
    '--topic-id', '9709-s1-topic-05',
    '--dry-run',
  ], { cwd: temporaryRoot }).topicId, '9709-s1-topic-05')

  const verifiedArtifact = {
    schemaVersion: AI_PDF_INGESTION_SCHEMA_VERSION,
    artifactId: 'sha256:' + 'a'.repeat(64),
    paperId: 'cie-9709-9709_m25_qp_52',
    subject: '9709',
    status: 'ai-verified',
    source: {
      questionPdfPath: sourcePdf,
      questionPdfSha256: sourceSha256,
      markSchemePdfSha256: 'b'.repeat(64),
      pageSizes: { 1: { width: 1200, height: 1600 } },
    },
    candidate: {
      questions: [
        {
          questionNumber: '1',
          regions: [{ page: 1, pageImageSha256: 'c'.repeat(64), x0: 0.1, y0: 0.1, x1: 0.8, y1: 0.4 }],
          diagramRegions: [{ page: 1, pageImageSha256: 'c'.repeat(64), x0: 0.2, y0: 0.2, x1: 0.7, y1: 0.3 }],
          parts: [{ label: 'a', marks: 3, math: ['P(X = 2)'] }],
          tags: { primaryTopicId: '9709-s1-topic-04', secondaryTopicIds: ['9709-s1-topic-03'], syllabusPointIds: [] },
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
      ],
    },
  }
  const quarantinedArtifact = {
    ...verifiedArtifact,
    artifactId: 'sha256:' + 'e'.repeat(64),
    status: 'auto-quarantined',
  }

  mkdirSync(artifactRoot, { recursive: true })
  const verifiedPath = path.join(artifactRoot, 'verified.json')
  const quarantinedPath = path.join(artifactRoot, 'quarantined.json')
  writeFileSync(verifiedPath, `${JSON.stringify(verifiedArtifact)}\n`, 'utf8')
  writeFileSync(quarantinedPath, `${JSON.stringify(quarantinedArtifact)}\n`, 'utf8')

  const dryRunResult = await runTopicPack(parseArgs([
    '--artifact-root', artifactRoot,
    '--output-root', outputRoot,
    '--subject', '9709',
    '--dry-run',
  ], { cwd: temporaryRoot }), {
    runCropCommand: async () => { throw new Error('dry-run must not crop') },
    mergePdfs: async () => { throw new Error('dry-run must not merge') },
  })
  assert.equal(dryRunResult.packs.length, 1)
  assert.equal(dryRunResult.packs[0].topicId, '9709-s1-topic-04')
  assert.equal(existsSync(outputRoot), false, 'dry-run must not write topic pack files')
  assert.ok(dryRunResult.skipped.some((item) => item.reason === 'official-topic-missing' && item.questionNumber === '2'))
  assert.ok(dryRunResult.skipped.some((item) => item.reason === 'regions-missing' && item.questionNumber === '3'))

  const cropManifests = []
  const result = await runTopicPack(parseArgs([
    '--artifact-root', artifactRoot,
    '--output-root', outputRoot,
    '--subject', '9709',
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
  assert.equal(cropManifests[0].crops.length, 2, 'question and diagram regions must be preserved for re-rendering')

  const manifest = JSON.parse(readFileSync(result.packs[0].manifestPath, 'utf8'))
  assert.equal(manifest.schemaVersion, AI_PDF_TOPIC_PACK_SCHEMA_VERSION)
  assert.equal(manifest.topic.id, '9709-s1-topic-04')
  assert.equal(manifest.questionCount, 1)
  assert.equal(manifest.questions[0].tags.primaryTopicId, '9709-s1-topic-04')
  assert.deepEqual(manifest.questions[0].diagramRegions, verifiedArtifact.candidate.questions[0].diagramRegions)
  assert.deepEqual(manifest.questions[0].markSchemeEvidence, verifiedArtifact.candidate.questions[0].markSchemeEvidence)
  assert.deepEqual(manifest.questions[0].parts, [{ label: 'a', marks: 3, math: ['P(X = 2)'] }])
  assert.deepEqual(manifest.questions[0].source.pages, [1])
  assert.match(manifest.topicPdfSha256, /^[a-f0-9]{64}$/)

  console.log(JSON.stringify({ status: 'passed', packs: result.packs.length, skipped: result.skipped.length }))
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
