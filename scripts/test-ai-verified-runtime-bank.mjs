import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { artifactId } from './ai-pdf-ingestion/contract.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-ai-verified-runtime-bank-'))
const libraryRoot = path.join(root, 'library', '9702')
const artifactRoot = path.join(root, 'artifacts')
const questionFile = '9702_m21_qp_42.pdf'
const markSchemeFile = '9702_m21_ms_42.pdf'
const questionBytes = Buffer.from('%PDF-1.4\nai-verified-question\n', 'utf8')
const markSchemeBytes = Buffer.from('%PDF-1.4\nai-verified-mark-scheme\n', 'utf8')
const questionPdfSha256 = crypto.createHash('sha256').update(questionBytes).digest('hex')
const markSchemePdfSha256 = crypto.createHash('sha256').update(markSchemeBytes).digest('hex')
const paperId = 'cie-9702-9702_m21_qp_42'
const artifactIdentity = artifactId({ paperId, questionPdfSha256, markSchemePdfSha256 })

fs.mkdirSync(libraryRoot, { recursive: true })
fs.writeFileSync(path.join(libraryRoot, questionFile), questionBytes)
fs.writeFileSync(path.join(libraryRoot, markSchemeFile), markSchemeBytes)

const verifiedArtifact = {
  schemaVersion: 'ai-pdf-ingestion.v1',
  artifactId: artifactIdentity,
  paperId,
  subject: '9702',
  status: 'ai-verified',
  storageMode: 'coordinate-only',
  source: {
    questionPdfPath: path.join(libraryRoot, questionFile),
    markSchemePdfPath: path.join(libraryRoot, markSchemeFile),
    questionPdfSha256,
    markSchemePdfSha256,
    pageSizes: { 3: { width: 1200, height: 1600 } },
    markSchemePageSizes: { 5: { width: 1200, height: 1600 } },
  },
  candidate: {
    questions: [{
      questionNumber: '2',
      regions: [{ page: 3, pageImageSha256: 'd'.repeat(64), x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }],
      diagramRegions: [],
      parts: [{ label: 'a', marks: 4, ocrText: 'State the answer.', math: [], diagramAssociations: [] }],
      tags: { primaryTopicId: 'physics-9702-topic-13', secondaryTopicIds: [], syllabusPointIds: [] },
      markSchemeEvidence: [{ page: 5, pageImageSha256: 'e'.repeat(64) }],
    }],
  },
  verification: {
    questions: [{
      questionNumber: '2',
      pages: [3],
      parts: [{ label: 'a', marks: 4 }],
      diagramRegionCount: 0,
      markSchemeEvidence: [{ page: 5, pageImageSha256: 'e'.repeat(64) }],
    }],
  },
}

const p5Artifact = {
  ...verifiedArtifact,
  paperId: 'cie-9702-9702_m21_qp_52',
  source: {
    ...verifiedArtifact.source,
    questionPdfPath: path.join(libraryRoot, '9702_m21_qp_52.pdf'),
    markSchemePdfPath: path.join(libraryRoot, '9702_m21_ms_52.pdf'),
  },
}

const artifactDirectory = path.join(artifactRoot, paperId)
fs.mkdirSync(artifactDirectory, { recursive: true })
fs.writeFileSync(path.join(artifactDirectory, `${artifactIdentity.slice('sha256:'.length)}.json`), JSON.stringify(verifiedArtifact), 'utf8')
fs.writeFileSync(path.join(artifactDirectory, 'p5.json'), JSON.stringify(p5Artifact), 'utf8')

try {
  const load = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot })
  const loaded = load()
  assert.equal(loaded.groups.length, 1, 'only checksum-bound P4 coordinate artifacts may enter the runtime bank')
  assert.equal(loaded.groups[0].sourceQuestionId, `${paperId}:q2`)
  assert.equal(loaded.documents.length, 2, 'QP and paired MS documents must be exposed together')
  assert.ok(loaded.documents.every((document) => document.subject === '9702' && document.component === 4))
  assert.ok(loaded.documents.every((document) => document.year >= 2021 && document.year <= 2025))
  assert.ok(loaded.documents.every((document) => document.sha256 && document.bytes > 0))

  const databasePath = path.join(root, 'stem.sqlite')
  let runtimeGroups = []
  const api = createStemApi({
    // This fixture intentionally exercises the local study-only pool. The
    // production API must keep the opt-in disabled and expose only
    // practice-ready records.
    env: {
      NODE_ENV: 'test',
      STEM_ENABLE_STUDY_ONLY_TOPIC_DRILL: '1',
      STEM_DB_PATH: databasePath,
    },
    topicQuestionBankProvider: () => runtimeGroups,
  })
  const server = http.createServer((request, response) => api(request, response, () => {
    response.statusCode = 404
    response.end()
  }))
  await new Promise((resolve) => server.listen(0, resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    const initialInventoryResponse = await fetch(`${origin}/api/stem/routes/cie-9702-a2-physics/syllabus-topics`)
    assert.equal(initialInventoryResponse.status, 200)
    const initialInventory = await initialInventoryResponse.json()
    const initialTopic = initialInventory.topics.find((topic) => topic.id === 'physics-9702-topic-13')
    assert.ok(initialTopic)
    const initialStudyQuestionCount = Number(initialTopic.studyQuestionCount)
    assert.ok(initialStudyQuestionCount > 0, 'static source-backed A2 study questions must remain visible while runtime AI records are release-gated')
    assert.equal(
      Number(initialTopic.availableQuestionCount),
      Number(initialTopic.verifiedQuestionCount) + Number(initialTopic.studyQuestionCount),
      'A2 count must combine the reviewed and static study-only pools consistently',
    )

    runtimeGroups = load().groups
    const inventoryResponse = await fetch(`${origin}/api/stem/routes/cie-9702-a2-physics/syllabus-topics`)
    assert.equal(inventoryResponse.status, 200)
    const inventory = await inventoryResponse.json()
    const runtimeTopic = inventory.topics.find((topic) => topic.id === 'physics-9702-topic-13')
    assert.ok(
      runtimeTopic?.questionIdsByComponent?.[4]?.pendingReviewQuestionIds?.includes(`${paperId}:q2`),
      'runtime inventory must retain the loaded coordinate record as pending review',
    )
    assert.equal(runtimeTopic.studyQuestionCount, initialStudyQuestionCount, 'student inventory must not add release-gated ai-verified records to the static study-only pool')
    assert.equal(
      Number(runtimeTopic.availableQuestionCount),
      Number(runtimeTopic.verifiedQuestionCount) + initialStudyQuestionCount,
      'student count must include static study questions while excluding release-gated runtime records',
    )
    assert.equal(runtimeTopic.questionIdsByComponent?.[4]?.studyQuestionIds?.includes(`${paperId}:q2`), false, 'student inventory must not list study-only IDs')
    assert.ok(
      Number(runtimeTopic?.indexedQuestionCount) > Number(initialTopic.indexedQuestionCount),
      'inventory must refresh SQLite counts after a new verified coordinate artifact appears',
    )

    const practiceResponse = await fetch(`${origin}/api/stem/practice-sets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routeId: 'cie-9702-a2-physics',
        syllabusTopicIds: ['9702-a2-topic-02'],
        components: [4],
        questionCount: 1,
        sourceQuestionIds: [`${paperId}:q2`],
      }),
    })
    assert.equal(practiceResponse.status, 409, 'student practice must reject a coordinate-only ai-verified record that is not release-ready')
    const practice = await practiceResponse.json()
    assert.equal(practice.code, 'invalid_source_question_selection')

    runtimeGroups = []
    const removedInventoryResponse = await fetch(`${origin}/api/stem/routes/cie-9702-a2-physics/syllabus-topics`)
    assert.equal(removedInventoryResponse.status, 200)
    const removedInventory = await removedInventoryResponse.json()
    const removedTopic = removedInventory.topics.find((topic) => topic.id === 'physics-9702-topic-13')
    assert.equal(
      Number(removedTopic?.indexedQuestionCount),
      Number(initialTopic.indexedQuestionCount),
      'SQLite inventory must evict a coordinate record once its runtime source binding disappears',
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
    closeStemDatabaseForTests()
  }

  fs.writeFileSync(path.join(libraryRoot, markSchemeFile), Buffer.from('%PDF-1.4\ntampered\n', 'utf8'))
  const reloaded = load({ refresh: true })
  assert.equal(reloaded.groups.length, 0, 'a source checksum change must evict the coordinate artifact before students can use it')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(JSON.stringify({ status: 'passed', scope: '9702-p4-2021-2025' }))
