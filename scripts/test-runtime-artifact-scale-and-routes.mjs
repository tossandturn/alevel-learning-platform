import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { questionGroupsFromAiArtifacts, createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { routeById } from '../src/data/routeRegistry.js'
import { artifactId, buildAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-runtime-artifact-scale-'))
const libraryRoot = path.join(root, 'library')
const artifactRoot = path.join(root, 'artifacts')
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

function makeArtifact({ index, subjectCode = '9702', routeId = 'cie-9702-a2-physics', stage = 'A2', sharedSource = null } = {}) {
  const route = routeById(routeId)
  assert.ok(route, `route ${routeId} must exist in the registry`)
  const topic = route.syllabus.topics[0]
  const filename = sharedSource?.filename || (() => {
    const year = 2021 + Math.floor(index / 54)
    const offset = index % 54
    const session = ['m', 's', 'w'][Math.floor(offset / 18)]
    const local = offset % 18
    const selectedComponent = [1, 2, 4][Math.floor(local / 6)]
    const variant = local % 6
    return `${subjectCode}_${session}${String(year).slice(-2)}_qp_${selectedComponent}${variant}.pdf`
  })()
  const paperId = `cie-${subjectCode}-${filename.slice(0, -4)}`
  const questionPath = path.join(libraryRoot, subjectCode, filename)
  const markSchemePath = questionPath.replace('_qp_', '_ms_')
  fs.mkdirSync(path.dirname(questionPath), { recursive: true })
  if (!fs.existsSync(questionPath)) fs.writeFileSync(questionPath, Buffer.from(`%PDF-1.4\nquestion-${index}`))
  if (!fs.existsSync(markSchemePath)) fs.writeFileSync(markSchemePath, Buffer.from(`%PDF-1.4\nmark-${index}`))
  const questionHash = sha256(fs.readFileSync(questionPath))
  const markSchemeHash = sha256(fs.readFileSync(markSchemePath))
  const identity = artifactId({ paperId, questionPdfSha256: questionHash, markSchemePdfSha256: markSchemeHash })
  const candidate = {
    questionNumber: '1',
    questionStartPage: 1,
    regions: [{ page: 1, pageImageSha256: 'a'.repeat(64), x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }],
    diagramRegions: [],
    parts: [{ label: 'a', marks: 2, ocrText: `Question ${index}`, math: [], diagramAssociations: [] }],
    tags: { primaryTopicId: topic.id, secondaryTopicIds: [], syllabusPointIds: [topic.points[0]?.id].filter(Boolean) },
    markSchemeEvidence: [{ page: 1, pageImageSha256: 'b'.repeat(64) }],
  }
  const verification = {
    questionStarts: [{ questionNumber: '1', questionStartPage: 1 }],
    questions: [{
      questionNumber: '1', questionStartPage: 1, pages: [1],
      regions: candidate.regions,
      diagramRegions: [],
      parts: [{ label: 'a', marks: 2 }], diagramRegionCount: 0,
      tags: candidate.tags, markSchemeEvidence: candidate.markSchemeEvidence,
    }],
  }
  const artifact = {
    schemaVersion: 'ai-pdf-ingestion.v1', artifactId: identity, paperId,
    subject: subjectCode, stage, syllabusRouteId: routeId, status: 'ai-verified',
    storageMode: 'coordinate-only', artifactSuffix: `route-${routeId}`,
    extractor: { provider: 'paddleocr', model: 'PaddleOCR-VL-1.6', schemaName: 'ai_pdf_question_extraction_v1' },
    verifier: { provider: 'openai', model: 'gpt-5.6', schemaName: 'ai_pdf_question_verification_v1' },
    source: {
      questionPdfPath: questionPath, markSchemePdfPath: markSchemePath,
      questionPdfSha256: questionHash, markSchemePdfSha256: markSchemeHash,
      renderDpi: 180,
      pageSizes: { 1: { width: 1200, height: 1600 } },
      pageImageHashes: { 1: 'a'.repeat(64) },
      markSchemePageSizes: { 1: { width: 1200, height: 1600 } },
      markSchemePageHashes: { 1: 'b'.repeat(64) },
    },
    candidate: { questions: [candidate] }, verification,
  }
  artifact.studentRelease = buildAiStudentStudyRelease({
    artifactId: identity, routeId, status: artifact.status, source: artifact.source,
    extractor: artifact.extractor, verifier: artifact.verifier,
    candidate: artifact.candidate, verification: artifact.verification,
  })
  return artifact
}

try {
  fs.mkdirSync(artifactRoot, { recursive: true })
  for (let index = 0; index < 251; index += 1) {
    const offset = index % 54
    const selectedComponent = [1, 2, 4][Math.floor((offset % 18) / 6)]
    const selectedRoute = selectedComponent === 4 ? 'cie-9702-a2-physics' : 'cie-9702-as-physics'
    const artifact = makeArtifact({
      index,
      component: selectedComponent,
      routeId: selectedRoute,
      stage: selectedComponent === 4 ? 'A2' : 'AS',
    })
    const directory = path.join(artifactRoot, artifact.paperId)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, `${artifact.artifactId.slice('sha256:'.length)}--${artifact.artifactSuffix}.json`), JSON.stringify(artifact))
  }
  const artifactFiles = fs.readdirSync(artifactRoot).flatMap((directory) => fs.readdirSync(path.join(artifactRoot, directory)).map((file) => path.join(artifactRoot, directory, file)))
  assert.equal(artifactFiles.length, 251)
  const directGroups = questionGroupsFromAiArtifacts(artifactFiles.map((file) => JSON.parse(fs.readFileSync(file, 'utf8'))), { libraryRoot })
  assert.equal(directGroups.length, 251, `direct groups=${directGroups.length}`)
  const loaded = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot })()
  assert.equal(loaded.groups.length, 251, 'runtime loader must not truncate the artifact set at 250')

  // Rebuild the exact same 9709 source pair in two registered route contexts.
  const sharedAs = makeArtifact({ index: 1000, subjectCode: '9709', routeId: 'cie-9709-as-p1-p4', stage: 'AS', sharedSource: { filename: '9709_m25_qp_42.pdf' } })
  const sharedA2 = makeArtifact({ index: 1000, subjectCode: '9709', routeId: 'cie-9709-a2-after-p1-p5-p3-p4', stage: 'A2', sharedSource: { filename: '9709_m25_qp_42.pdf' } })
  const routeGroups = questionGroupsFromAiArtifacts([sharedAs, sharedA2], { libraryRoot })
  assert.equal(routeGroups.length, 2, 'the same source question must remain distinct per route context')
  assert.deepEqual(routeGroups.map((group) => group.routeId).sort(), [
    'cie-9709-a2-after-p1-p5-p3-p4', 'cie-9709-as-p1-p4',
  ])
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(JSON.stringify({ status: 'passed', scope: 'runtime-artifact-scale-and-route-dedup' }))
