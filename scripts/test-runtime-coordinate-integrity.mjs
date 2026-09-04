import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { routeById } from '../src/data/routeRegistry.js'
import { artifactId, buildAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'

const routeId = 'cie-9702-a2-physics'
const route = routeById(routeId)
const topic = route.syllabus.topics.find((item) => item.id === 'physics-9702-topic-13')
assert.ok(topic)

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

function fixture({ sourcePageHashes = true, verificationQuestionNumber = '1', candidateQuestionNumber = '1', includeDiagram = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-runtime-coordinate-integrity-'))
  const libraryRoot = path.join(root, 'library')
  const subjectRoot = path.join(libraryRoot, '9702')
  const artifactRoot = path.join(root, 'artifacts')
  const questionFile = '9702_m21_qp_42.pdf'
  const markSchemeFile = '9702_m21_ms_42.pdf'
  const questionPath = path.join(subjectRoot, questionFile)
  const markSchemePath = path.join(subjectRoot, markSchemeFile)
  const questionBytes = Buffer.from('%PDF-1.4\ncoordinate-integrity-question\n', 'utf8')
  const markSchemeBytes = Buffer.from('%PDF-1.4\ncoordinate-integrity-mark-scheme\n', 'utf8')
  const questionPdfSha256 = sha256(questionBytes)
  const markSchemePdfSha256 = sha256(markSchemeBytes)
  const paperId = 'cie-9702-9702_m21_qp_42'
  const questionPageHash = 'a'.repeat(64)
  const markSchemePageHash = 'b'.repeat(64)
  const candidateRegion = { page: 2, pageImageSha256: questionPageHash, x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.8 }
  const diagramRegion = { page: 2, pageImageSha256: questionPageHash, x0: 0.2, y0: 0.2, x1: 0.5, y1: 0.4 }
  const candidate = {
    questionNumber: candidateQuestionNumber,
    questionStartPage: 2,
    regions: [candidateRegion],
    diagramRegions: includeDiagram ? [diagramRegion] : [],
    parts: [{ label: 'a', marks: 4, ocrText: 'Calculate the field strength.', math: [], diagramAssociations: [] }],
    tags: { primaryTopicId: topic.id, secondaryTopicIds: [], syllabusPointIds: [topic.points[0].id] },
    markSchemeEvidence: [{ page: 3, pageImageSha256: markSchemePageHash }],
  }
  const verification = {
    questionNumber: verificationQuestionNumber,
    questionStartPage: 2,
    pages: [2],
    regions: [structuredClone(candidateRegion)],
    diagramRegions: [],
    parts: [{ label: 'a', marks: 4 }],
    diagramRegionCount: includeDiagram ? 1 : 0,
    tags: { primaryTopicId: topic.id, secondaryTopicIds: [], syllabusPointIds: [topic.points[0].id] },
    markSchemeEvidence: [{ page: 3, pageImageSha256: markSchemePageHash }],
  }
  if (includeDiagram) verification.diagramRegions = [structuredClone(diagramRegion)]
  const source = {
    board: 'Cambridge International',
    paperId,
    specificationId: 'cambridge-9702-2025-2027',
    stage: 'A2',
    rightsStatus: 'official-personal-study',
    accessPolicyId: 'private-study-library',
    questionPdfPath: questionPath,
    markSchemePdfPath: markSchemePath,
    questionPdfSha256,
    markSchemePdfSha256,
    renderDpi: 180,
    pageSizes: { 2: { width: 1200, height: 1600 } },
    markSchemePageSizes: { 3: { width: 1200, height: 1600 } },
    ...(sourcePageHashes ? { pageImageHashes: { 2: questionPageHash }, markSchemePageHashes: { 3: markSchemePageHash } } : {}),
  }
  const artifact = {
    schemaVersion: 'ai-pdf-ingestion.v1',
    artifactId: artifactId({ paperId, questionPdfSha256, markSchemePdfSha256 }),
    paperId,
    subject: '9702',
    stage: 'A2',
    syllabusRouteId: routeId,
    status: 'ai-verified',
    storageMode: 'coordinate-only',
    extractor: { provider: 'paddleocr-api', model: 'paddleocr-vl', schemaName: 'ai_pdf_question_extraction_v1' },
    verifier: { provider: 'openai', model: 'gpt-5.6', schemaName: 'ai_pdf_question_verification_v1' },
    source,
    candidate: { questions: [candidate] },
    verification: { questions: [verification] },
  }
  artifact.studentRelease = buildAiStudentStudyRelease({
    artifactId: artifact.artifactId,
    routeId,
    status: artifact.status,
    source,
    extractor: artifact.extractor,
    verifier: artifact.verifier,
    candidate: artifact.candidate,
    verification: artifact.verification,
  })
  fs.mkdirSync(subjectRoot, { recursive: true })
  fs.mkdirSync(path.join(artifactRoot, paperId), { recursive: true })
  fs.writeFileSync(questionPath, questionBytes)
  fs.writeFileSync(markSchemePath, markSchemeBytes)
  return { root, artifactRoot, libraryRoot, artifact }
}

function rebindRelease(artifact) {
  artifact.studentRelease = buildAiStudentStudyRelease({
    artifactId: artifact.artifactId,
    routeId,
    status: artifact.status,
    source: artifact.source,
    extractor: artifact.extractor,
    verifier: artifact.verifier,
    candidate: artifact.candidate,
    verification: artifact.verification,
  })
}

async function loadCase(mutate) {
  const state = fixture(mutate?.options)
  try {
    mutate?.apply?.(state.artifact)
    if (mutate?.rebind !== false) rebindRelease(state.artifact)
    const file = path.join(state.artifactRoot, state.artifact.paperId, 'artifact.json')
    fs.writeFileSync(file, JSON.stringify(state.artifact), 'utf8')
    return createAiVerifiedQuestionBankLoader({ artifactRoot: state.artifactRoot, libraryRoot: state.libraryRoot })()
  } finally {
    fs.rmSync(state.root, { recursive: true, force: true })
  }
}

const valid = await loadCase({})
assert.equal(valid.groups.length, 1, 'a fully bound released coordinate artifact should load')

const unreleased = await loadCase({ rebind: false, apply: (artifact) => { delete artifact.studentRelease } })
assert.equal(unreleased.groups.length, 0, 'an artifact without a student release must stay out of the runtime bank')

const missingPageHashes = await loadCase({ options: { sourcePageHashes: false } })
assert.equal(missingPageHashes.groups.length, 0, 'runtime records require source page hash maps')

const regionHashMismatch = await loadCase({ apply: (artifact) => { artifact.candidate.questions[0].regions[0].pageImageSha256 = 'c'.repeat(64) } })
assert.equal(regionHashMismatch.groups.length, 0, 'a region hash must match the authoritative source page hash')

const markSchemeHashMismatch = await loadCase({ apply: (artifact) => { artifact.candidate.questions[0].markSchemeEvidence[0].pageImageSha256 = 'c'.repeat(64) } })
assert.equal(markSchemeHashMismatch.groups.length, 0, 'mark-scheme evidence must match the authoritative MS page hash')

const verificationRegionMismatch = await loadCase({ apply: (artifact) => {
  artifact.verification.questions[0].regions = [{ page: 2, pageImageSha256: 'a'.repeat(64), x0: 0.15, y0: 0.1, x1: 0.9, y1: 0.8 }]
} })
assert.equal(verificationRegionMismatch.groups.length, 0, 'provided verification coordinates must equal candidate coordinates')

const verificationDiagramMismatch = await loadCase({ options: { includeDiagram: true }, apply: (artifact) => {
  artifact.verification.questions[0].diagramRegions[0].x0 = 0.25
} })
assert.equal(verificationDiagramMismatch.groups.length, 0, 'provided verification diagram coordinates must equal candidate coordinates')

const nonCanonicalNumber = await loadCase({ options: { candidateQuestionNumber: '01', verificationQuestionNumber: '01' } })
assert.equal(nonCanonicalNumber.groups.length, 0, 'question numbers with leading zeroes must fail closed')

const duplicateCanonicalNumbers = await loadCase({ apply: (artifact) => {
  artifact.candidate.questions.push(structuredClone(artifact.candidate.questions[0]))
  artifact.candidate.questions[1].questionNumber = '01'
  artifact.verification.questions.push(structuredClone(artifact.verification.questions[0]))
  artifact.verification.questions[1].questionNumber = '01'
} })
assert.equal(duplicateCanonicalNumbers.groups.length, 0, 'duplicate canonical question numbers must fail closed')

console.log(JSON.stringify({ status: 'passed', scope: 'runtime-coordinate-integrity' }))
