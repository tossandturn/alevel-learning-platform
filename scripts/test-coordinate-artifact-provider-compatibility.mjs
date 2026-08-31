import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { artifactId, buildAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-coordinate-provider-'))
const libraryRoot = path.join(root, 'library')
const subjectRoot = path.join(libraryRoot, '9702')
const artifactRoot = path.join(root, 'artifacts')
const questionFile = '9702_m21_qp_42.pdf'
const markSchemeFile = '9702_m21_ms_42.pdf'
const questionPath = path.join(subjectRoot, questionFile)
const markSchemePath = path.join(subjectRoot, markSchemeFile)
const questionBytes = Buffer.from('%PDF-1.4\ncanonical-paddle-question\n', 'utf8')
const markSchemeBytes = Buffer.from('%PDF-1.4\ncanonical-paddle-mark-scheme\n', 'utf8')
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const questionPdfSha256 = sha256(questionBytes)
const markSchemePdfSha256 = sha256(markSchemeBytes)
const paperId = 'cie-9702-9702_m21_qp_42'

function buildArtifact() {
  const identity = artifactId({ paperId, questionPdfSha256, markSchemePdfSha256 })
  const artifact = {
    schemaVersion: 'ai-pdf-ingestion.v1',
    artifactId: identity,
    paperId,
    subject: '9702',
    stage: 'A2',
    syllabusRouteId: 'cie-9702-a2-physics',
    status: 'ai-verified',
    storageMode: 'coordinate-only',
    extractor: {
      provider: 'paddleocr',
      model: 'pp-structure-v3',
      schemaName: 'ai_pdf_question_extraction_v1',
    },
    verifier: {
      provider: 'openai',
      model: 'gpt-5.6',
      schemaName: 'ai_pdf_question_verification_v1',
    },
    source: {
      questionPdfPath: questionPath,
      markSchemePdfPath: markSchemePath,
      questionPdfSha256,
      markSchemePdfSha256,
      renderDpi: 180,
      pageImageHashes: { 2: 'a'.repeat(64) },
      pageSizes: { 2: { width: 1200, height: 1600 } },
      markSchemePageHashes: { 4: 'b'.repeat(64) },
      markSchemePageSizes: { 4: { width: 1200, height: 1600 } },
    },
    candidate: {
      questions: [{
        questionNumber: '1',
        regions: [{ page: 2, pageImageSha256: 'a'.repeat(64), x0: 0.08, y0: 0.12, x1: 0.92, y1: 0.84 }],
        diagramRegions: [],
        parts: [{ label: 'a', marks: 3, ocrText: 'A source-bound question.', math: [], diagramAssociations: [] }],
        tags: { primaryTopicId: 'physics-9702-topic-13', secondaryTopicIds: [], syllabusPointIds: [] },
        markSchemeEvidence: [{ page: 4, pageImageSha256: 'b'.repeat(64) }],
      }],
    },
    verification: {
      questions: [{
        questionNumber: '1',
        pages: [2],
        parts: [{ label: 'a', marks: 3 }],
        tags: { primaryTopicId: 'physics-9702-topic-13', secondaryTopicIds: [], syllabusPointIds: [] },
        markSchemeEvidence: [{ page: 4, pageImageSha256: 'b'.repeat(64) }],
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
  return artifact
}

fs.mkdirSync(subjectRoot, { recursive: true })
fs.mkdirSync(path.join(artifactRoot, paperId), { recursive: true })
fs.writeFileSync(questionPath, questionBytes)
fs.writeFileSync(markSchemePath, markSchemeBytes)

const artifactPath = path.join(artifactRoot, paperId, 'paddle-canonical.json')
const releasedArtifact = buildArtifact()
fs.writeFileSync(artifactPath, JSON.stringify(releasedArtifact), 'utf8')

try {
  const load = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot })
  const released = load()
  assert.equal(released.groups.length, 1, 'a Paddle extraction converted to the canonical coordinate contract must load')
  assert.equal(released.groups[0].studentStudyEligible, true)
  assert.equal(released.groups[0].formalProgressEligible, false)
  assert.equal(released.groups[0].paperComponent, 4)
  assert.equal(released.groups[0].topicId, 'physics-9702-topic-13')
  assert.ok(released.groups[0].parts[0].sourceEvidence.every((item) => item.coordinateSpace === 'normalized-xyxy'))

  const releasedInventory = syllabusTopicsInventory({
    routeId: 'cie-9702-a2-physics',
    questionBank: released.groups,
    includeStudyOnly: false,
  })
  assert.equal(releasedInventory.availableQuestionGroupCount, 1, 'a valid student release must pass production inventory eligibility')
  assert.deepEqual(releasedInventory.assessmentComponents.map((item) => item.component), [4])

  const unreleasedArtifact = buildArtifact()
  delete unreleasedArtifact.studentRelease
  fs.writeFileSync(artifactPath, JSON.stringify(unreleasedArtifact), 'utf8')
  const unreleased = load({ refresh: true })
  assert.equal(unreleased.groups.length, 0, 'an artifact without a student release must stay out of the runtime bank')
  const unreleasedInventory = syllabusTopicsInventory({
    routeId: 'cie-9702-a2-physics',
    questionBank: unreleased.groups,
    includeStudyOnly: false,
  })
  assert.equal(unreleasedInventory.availableQuestionGroupCount, 0, 'missing release evidence must fail closed from production count/list/start')

  const portableArtifact = buildArtifact()
  portableArtifact.source.questionPdfPath = 'D:\\CodexWork\\cie-fraft-fetcher\\output\\pdf\\9702\\9702_m21_qp_42.pdf'
  portableArtifact.source.markSchemePdfPath = 'D:\\CodexWork\\cie-fraft-fetcher\\output\\pdf\\9702\\9702_m21_ms_42.pdf'
  portableArtifact.source.questionPdfRelativePath = '9702/9702_m21_qp_42.pdf'
  portableArtifact.source.markSchemePdfRelativePath = '9702/9702_m21_ms_42.pdf'
  fs.writeFileSync(artifactPath, JSON.stringify(portableArtifact), 'utf8')
  const portable = load({ refresh: true })
  assert.equal(portable.groups.length, 1, 'portable source paths must load when an artifact retains a Windows legacy path')
  assert.equal(portable.groups[0].sourceRef.paper, questionFile)
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(JSON.stringify({ status: 'passed', scope: 'canonical-paddle-coordinate-artifact' }))
