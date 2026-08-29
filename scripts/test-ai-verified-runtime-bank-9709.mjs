import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { isStudentReleasedAiStudyItem } from '../src/data/questionBank.js'
import { artifactId, buildAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-ai-verified-runtime-bank-9709-'))
const libraryRoot = path.join(root, 'library')
const subjectRoot = path.join(libraryRoot, '9709')
const artifactRoot = path.join(root, 'artifacts')
const questionFile = '9709_m25_qp_12.pdf'
const markSchemeFile = '9709_m25_ms_12.pdf'
const questionBytes = Buffer.from('%PDF-1.4\n9709-question\n', 'utf8')
const markSchemeBytes = Buffer.from('%PDF-1.4\n9709-mark-scheme\n', 'utf8')
const questionPdfSha256 = crypto.createHash('sha256').update(questionBytes).digest('hex')
const markSchemePdfSha256 = crypto.createHash('sha256').update(markSchemeBytes).digest('hex')
const paperId = 'cie-9709-9709_m25_qp_12'
const artifactIdentity = artifactId({ paperId, questionPdfSha256, markSchemePdfSha256 })

fs.mkdirSync(subjectRoot, { recursive: true })
fs.writeFileSync(path.join(subjectRoot, questionFile), questionBytes)
fs.writeFileSync(path.join(subjectRoot, markSchemeFile), markSchemeBytes)

const artifact = {
  schemaVersion: 'ai-pdf-ingestion.v1',
  artifactId: artifactIdentity,
  paperId,
  subject: '9709',
  stage: 'AS',
  syllabusRouteId: 'cie-9709-as-p1-p5',
  status: 'ai-verified',
  storageMode: 'coordinate-only',
  extractor: { provider: 'openai', model: 'gpt-5.6', schemaName: 'ai_pdf_question_extraction_v1' },
  verifier: { provider: 'qwen', model: 'qwen3-vl-plus', schemaName: 'ai_pdf_question_verification_v1' },
  source: {
    questionPdfPath: path.join(subjectRoot, questionFile),
    markSchemePdfPath: path.join(subjectRoot, markSchemeFile),
    questionPdfSha256,
    markSchemePdfSha256,
    renderDpi: 120,
    pageSizes: { 3: { width: 1200, height: 1600 } },
    markSchemePageSizes: { 5: { width: 1200, height: 1600 } },
  },
  candidate: {
    questions: [{
      questionNumber: '2',
      questionStartPage: 3,
      regions: [{ page: 3, pageImageSha256: 'd'.repeat(64), x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }],
      diagramRegions: [],
      parts: [{ label: 'a', marks: 4, ocrText: 'Find the roots of the quadratic.', math: [], diagramAssociations: [] }],
      tags: { primaryTopicId: '9709-p1-topic-01', secondaryTopicIds: [], syllabusPointIds: [] },
      markSchemeEvidence: [{ page: 5, pageImageSha256: 'e'.repeat(64) }],
    }],
  },
  verification: {
    questions: [{
      questionNumber: '2',
      questionStartPage: 3,
      pages: [3],
      parts: [{ label: 'a', marks: 4 }],
      diagramRegionCount: 0,
      tags: { primaryTopicId: '9709-p1-topic-01', secondaryTopicIds: [], syllabusPointIds: [] },
      markSchemeEvidence: [{ page: 5, pageImageSha256: 'e'.repeat(64) }],
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

const artifactDirectory = path.join(artifactRoot, paperId)
fs.mkdirSync(artifactDirectory, { recursive: true })
fs.writeFileSync(path.join(artifactDirectory, `${artifactIdentity.slice('sha256:'.length)}.json`), JSON.stringify(artifact), 'utf8')

try {
  const load = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot })
  const loaded = load()
  assert.equal(loaded.groups.length, 1, 'a released 9709 coordinate artifact must enter the runtime bank')
  assert.equal(loaded.groups[0].routeId, 'cie-9709-as-p1-p5')
  assert.equal(loaded.groups[0].subjectCode, '9709')
  assert.equal(loaded.groups[0].paperComponent, 1)
  assert.equal(loaded.groups[0].knowledgeGroupId, '9709-p1-topic-01')
  assert.equal(loaded.groups[0].sourceRef.localUrl, '/local-pdf/9709/9709_m25_qp_12.pdf')
  assert.equal(loaded.groups[0].answerRef.localUrl, '/local-pdf/9709/9709_m25_ms_12.pdf')
  assert.equal(isStudentReleasedAiStudyItem(loaded.groups[0]), true)
  assert.equal(loaded.documents.length, 2)
  assert.ok(loaded.documents.every((document) => document.subject === '9709' && document.component === 1))

  const api = createStemApi({
    env: { NODE_ENV: 'production', STEM_DB_PATH: path.join(root, 'stem.sqlite') },
    topicQuestionBankProvider: () => loaded.groups,
    libraryRoot,
  })
  const server = http.createServer((request, response) => api(request, response, () => {
    response.statusCode = 404
    response.end()
  }))
  await new Promise((resolve) => server.listen(0, resolve))
  try {
    const origin = `http://127.0.0.1:${server.address().port}`
    const inventoryResponse = await fetch(`${origin}/api/stem/routes/cie-9709-as-p1-p5/syllabus-topics`)
    assert.equal(inventoryResponse.status, 200)
    const inventory = await inventoryResponse.json()
    const p1Topic = inventory.topics.find((topic) => topic.id === '9709-p1-topic-01')
    assert.ok(p1Topic)
    const releasedSourceQuestionIds = p1Topic.questionIdsByComponent?.[1]?.studyQuestionIds || []
    assert.deepEqual(releasedSourceQuestionIds, [loaded.groups[0].sourceQuestionId], 'a released P1 artifact must enter its route-specific Topic Drill list')

    const practiceResponse = await fetch(`${origin}/api/stem/practice-sets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        routeId: 'cie-9709-as-p1-p5',
        syllabusTopicIds: ['9709-p1-topic-01'],
        components: [1],
        questionCount: 1,
        sourceQuestionIds: releasedSourceQuestionIds,
        excludeAttempted: false,
      }),
    })
    assert.equal(practiceResponse.status, 201)
    const practice = await practiceResponse.json()
    assert.equal(practice.practiceMode, 'study-only')
    assert.equal(practice.questionGroups[0].studentStudyEligible, true)
    assert.equal(practice.questionGroups[0].formalProgressEligible, false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    closeStemDatabaseForTests()
  }

  fs.writeFileSync(path.join(subjectRoot, markSchemeFile), Buffer.from('%PDF-1.4\ntampered\n', 'utf8'))
  assert.equal(load({ refresh: true }).groups.length, 0, 'a changed 9709 source hash must evict the artifact')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(JSON.stringify({ status: 'passed', scope: '9709-runtime-bank' }))
