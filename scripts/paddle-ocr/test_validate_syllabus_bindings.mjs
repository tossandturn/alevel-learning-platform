import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  validateReviewFromWorkRoot,
  validateSyllabusBindings,
} from './validate-syllabus-bindings.mjs'

const SCRIPT_PATH = fileURLToPath(new URL('./validate-syllabus-bindings.mjs', import.meta.url))
const REVIEW_ID = `sha256:${'a'.repeat(64)}`
const JOB_KEY = 'a'.repeat(64)
const QP_SHA256 = 'b'.repeat(64)
const MS_SHA256 = 'c'.repeat(64)
const QP_PAGE_SHA256 = 'd'.repeat(64)
const MS_PAGE_SHA256 = 'e'.repeat(64)
const ROUTE_ID = 'cie-9702-a2-physics'

function clone(value) {
  return structuredClone(value)
}

function reviewedPair({
  routeId = ROUTE_ID,
  topicId = 'physics-9702-topic-12',
  pointIds = ['physics-9702-point-12-1-01'],
} = {}) {
  const tags = {
    primaryTopicId: topicId,
    secondaryTopicIds: [],
    syllabusPointIds: pointIds,
  }
  const parts = [
    { label: '(a)', marks: 2, ocrText: 'private candidate text' },
    { label: '(b)', marks: 3, ocrText: 'another private candidate text' },
  ]
  return {
    extraction: {
      routeId,
      source: {
        questionPdfSha256: QP_SHA256,
        markSchemePdfSha256: MS_SHA256,
      },
      questions: [{
        questionNumber: '1',
        questionStartPage: 4,
        regions: [{ page: 4, pageImageSha256: QP_PAGE_SHA256, x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }],
        diagramRegions: [],
        parts,
        tags,
        markSchemeEvidence: [{ page: 1, pageImageSha256: MS_PAGE_SHA256 }],
      }],
    },
    verification: {
      routeId,
      questionStarts: [{ questionNumber: '1', questionStartPage: 4 }],
      questions: [{
        questionNumber: '1',
        questionStartPage: 4,
        pages: [4],
        parts: parts.map(({ label, marks }) => ({ label, marks })),
        diagramRegionCount: 0,
        tags: clone(tags),
        markSchemeEvidence: [{ page: 1, pageImageSha256: MS_PAGE_SHA256 }],
      }],
    },
  }
}

function validationInput(overrides = {}) {
  const pair = reviewedPair(overrides)
  return {
    ...pair,
    routeId: overrides.routeId || ROUTE_ID,
    subjectCode: overrides.subjectCode || '9702',
    component: overrides.component || 4,
    source: {
      questionPdfSha256: QP_SHA256,
      markSchemePdfSha256: MS_SHA256,
      questionPageHashes: { 4: QP_PAGE_SHA256 },
      markSchemePageHashes: { 1: MS_PAGE_SHA256 },
    },
  }
}

function expectBlocked(input, errorCode) {
  assert.throws(
    () => validateSyllabusBindings(input),
    (error) => error?.code === errorCode,
    `expected ${errorCode}`,
  )
}

{
  const result = validateSyllabusBindings(validationInput())
  assert.deepEqual(result, {
    status: 'PASS',
    errorCode: null,
    counts: { questions: 1, parts: 2, marks: 5, topics: 1, points: 1 },
  })
}

{
  const validRouteComponents = [
    ['cie-9702-as-physics', '9702', 1, 'physics-9702-topic-01', 'physics-9702-point-1-1-01'],
    ['cie-9702-as-physics', '9702', 2, 'physics-9702-topic-01', 'physics-9702-point-1-1-01'],
    ['cie-9702-a2-physics', '9702', 4, 'physics-9702-topic-12', 'physics-9702-point-12-1-01'],
    ['cie-9709-as-p1-p2', '9709', 1, '9709-p1-topic-01', 'math-9709-point-1-1-01'],
    ['cie-9709-as-p1-p2', '9709', 2, '9709-p2-topic-01', 'math-9709-point-2-1-01'],
    ['cie-9709-as-p1-p4', '9709', 1, '9709-p1-topic-01', 'math-9709-point-1-1-01'],
    ['cie-9709-as-p1-p4', '9709', 4, '9709-m1-topic-01', 'math-9709-point-4-1-01'],
    ['cie-9709-as-p1-p5', '9709', 1, '9709-p1-topic-01', 'math-9709-point-1-1-01'],
    ['cie-9709-as-p1-p5', '9709', 5, '9709-s1-topic-01', 'math-9709-point-5-1-01'],
    ['cie-9709-a2-after-p1-p5-p3-p4', '9709', 3, '9709-p3-topic-01', 'math-9709-point-3-1-01'],
    ['cie-9709-a2-after-p1-p5-p3-p4', '9709', 4, '9709-m1-topic-01', 'math-9709-point-4-1-01'],
    ['cie-9709-a2-after-p1-p5-p3-p6', '9709', 3, '9709-p3-topic-01', 'math-9709-point-3-1-01'],
    ['cie-9709-a2-after-p1-p5-p3-p6', '9709', 6, '9709-s2-topic-01', 'math-9709-point-6-1-01'],
    ['cie-9709-a2-after-p1-p4-p3-p5', '9709', 3, '9709-p3-topic-01', 'math-9709-point-3-1-01'],
    ['cie-9709-a2-after-p1-p4-p3-p5', '9709', 5, '9709-s1-topic-01', 'math-9709-point-5-1-01'],
    ['cie-0580-igcse-mathematics', '0580', 1, '0580-igcse-topic-01', 'math-0580-point-C1-1'],
    ['cie-0580-igcse-mathematics', '0580', 2, '0580-igcse-topic-01', 'math-0580-point-C1-1'],
    ['cie-0580-igcse-mathematics', '0580', 3, '0580-igcse-topic-01', 'math-0580-point-C1-1'],
    ['cie-0580-igcse-mathematics', '0580', 4, '0580-igcse-topic-01', 'math-0580-point-C1-1'],
    ['cie-0625-igcse-physics', '0625', 2, '0625-igcse-topic-01', 'physics-0625-point-1-1-01'],
  ]
  for (const [routeId, subjectCode, component, topicId, pointId] of validRouteComponents) {
    const result = validateSyllabusBindings(validationInput({
      routeId,
      subjectCode,
      component,
      topicId,
      pointIds: [pointId],
    }))
    assert.equal(result.status, 'PASS', `${routeId} P${component} should be eligible`)
  }
}

{
  const input = validationInput({ topicId: 'physics-9702-topic-generic' })
  expectBlocked(input, 'SYLLABUS_TOPIC_ID_UNKNOWN')
}

{
  const input = validationInput({ pointIds: ['physics-9702-point-12-fuzzy-01'] })
  expectBlocked(input, 'SYLLABUS_POINT_ID_UNKNOWN')
}

{
  const input = validationInput()
  input.verification.questions[0].parts[1].marks = 4
  expectBlocked(input, 'REVIEW_PARTS_MARKS_MISMATCH')
}

{
  const input = validationInput()
  input.verification.routeId = 'cie-9702-as-physics'
  expectBlocked(input, 'REVIEW_ROUTE_MISMATCH')
}

{
  const input = validationInput()
  input.verification.questions[0].tags.syllabusPointIds = ['physics-9702-point-12-1-02']
  expectBlocked(input, 'REVIEW_SYLLABUS_POINTS_MISMATCH')
}

{
  const input = validationInput()
  input.verification.questionStarts[0].questionStartPage = 5
  expectBlocked(input, 'REVIEW_QUESTION_STARTS_MISMATCH')
}

{
  const input = validationInput({ component: 5 })
  expectBlocked(input, 'COMPONENT_ROUTE_NOT_ELIGIBLE')
}

{
  const input = validationInput({
    routeId: 'cie-9709-as-p1-p2',
    subjectCode: '9709',
    component: 4,
    topicId: '9709-m1-topic-01',
    pointIds: ['math-9709-point-4-1-01'],
  })
  expectBlocked(input, 'COMPONENT_ROUTE_NOT_ELIGIBLE')
}

{
  const input = validationInput({
    routeId: 'cie-9709-a2-after-p1-p5-p3-p6',
    subjectCode: '9709',
    component: 6,
    topicId: '9709-p3-topic-01',
    pointIds: ['math-9709-point-3-1-01'],
  })
  expectBlocked(input, 'SYLLABUS_TOPIC_NOT_IN_COMPONENT')
}

{
  const input = validationInput({
    routeId: 'cie-0625-igcse-physics',
    subjectCode: '0625',
    component: 3,
    topicId: '0625-igcse-topic-01',
    pointIds: ['physics-0625-point-1-1-01'],
  })
  expectBlocked(input, 'COMPONENT_ROUTE_NOT_ELIGIBLE')
}

{
  const input = validationInput()
  input.extraction.questions.push(clone(input.extraction.questions[0]))
  input.verification.questions.push(clone(input.verification.questions[0]))
  input.verification.questionStarts.push(clone(input.verification.questionStarts[0]))
  expectBlocked(input, 'REVIEW_QUESTION_DUPLICATE')
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-syllabus-binding-test-'))
try {
  writeReviewFixture(temporaryRoot)

  const direct = validateReviewFromWorkRoot({
    workRoot: temporaryRoot,
    reviewId: REVIEW_ID,
    routeId: ROUTE_ID,
  })
  assert.equal(direct.status, 'PASS')
  assert.equal(direct.counts.marks, 5)

  const pass = runCli(temporaryRoot)
  assert.equal(pass.status, 0, pass.stderr)
  assert.deepEqual(JSON.parse(pass.stdout), {
    status: 'PASS',
    errorCode: null,
    counts: { questions: 1, parts: 2, marks: 5, topics: 1, points: 1 },
  })
  assert.doesNotMatch(pass.stdout + pass.stderr, /private candidate text|[bcde]{64}|stem-syllabus-binding-test/i)

  const verificationPath = path.join(temporaryRoot, 'review-drafts', JOB_KEY, ROUTE_ID, 'verification.json')
  const verification = JSON.parse(fs.readFileSync(verificationPath, 'utf8'))
  verification.questions[0].parts[0].marks = 9
  fs.writeFileSync(verificationPath, `${JSON.stringify(verification)}\n`, 'utf8')

  const blocked = runCli(temporaryRoot)
  assert.equal(blocked.status, 2, blocked.stderr)
  assert.deepEqual(JSON.parse(blocked.stdout), {
    status: 'BLOCKED',
    errorCode: 'REVIEW_PARTS_MARKS_MISMATCH',
    counts: { questions: 0, parts: 0, marks: 0, topics: 0, points: 0 },
  })
  assert.doesNotMatch(blocked.stdout + blocked.stderr, /private candidate text|[bcde]{64}|stem-syllabus-binding-test/i)
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

console.log('validate-syllabus-bindings tests passed')

function runCli(workRoot) {
  return spawnSync(process.execPath, [
    SCRIPT_PATH,
    '--work-root', workRoot,
    '--review-id', REVIEW_ID,
    '--route', ROUTE_ID,
  ], { encoding: 'utf8' })
}

function writeReviewFixture(workRoot) {
  const pair = reviewedPair()
  const paperId = 'cie-9702-test-paper'
  const statePath = `state/jobs/${JOB_KEY}.json`
  const artifactPath = `artifacts/staging/${paperId}/${JOB_KEY}/artifact.json`
  const routeBinding = {
    routeCandidateId: ROUTE_ID,
    routeResolutionStatus: 'candidate_requires_adapter_validation',
    qualificationStage: 'A2',
    paper: 'P4',
    component: 4,
    reviewStatus: 'pending_official_review',
  }
  const job = {
    schemaVersion: 'stem-paddle-ocr-job.v1',
    jobId: REVIEW_ID,
    jobKey: JOB_KEY,
    paperId,
    subject: '9702',
    component: 4,
    routeBindings: [routeBinding],
    documents: {
      qp: { sha256: QP_SHA256, pageCount: 4 },
      ms: { sha256: MS_SHA256, pageCount: 1 },
    },
    statePath,
    stagingArtifactPath: artifactPath,
  }
  const state = {
    schemaVersion: 'stem-paddle-ocr-job-state.v1',
    jobId: REVIEW_ID,
    paperId,
    status: 'completed',
    documents: {
      qp: {
        status: 'completed',
        sourceSha256: QP_SHA256,
        pageCount: 4,
        pages: { 4: { sourcePage: { page: 4, sha256: QP_PAGE_SHA256 } } },
      },
      ms: {
        status: 'completed',
        sourceSha256: MS_SHA256,
        pageCount: 1,
        pages: { 1: { sourcePage: { page: 1, sha256: MS_PAGE_SHA256 } } },
      },
    },
  }
  const artifact = {
    schemaVersion: 'stem-paddle-ocr-staging-artifact.v1',
    artifactId: REVIEW_ID,
    paperId,
    subject: '9702',
    component: 4,
    status: 'ocr-complete-pending-review',
    reviewStatus: 'pending_ai_structure_review',
    syllabusBinding: { status: 'pending_official_review', routeBindings: [routeBinding], topicIds: [] },
    sourcePair: {
      bindingMethod: 'exact_filename_substitution_and_sha256',
      questionPaper: { sha256: QP_SHA256, pageCount: 4 },
      markScheme: { sha256: MS_SHA256, pageCount: 1 },
    },
    questionGroups: [],
    studentStudyEligible: false,
    formalProgressEligible: false,
  }
  const queueRow = {
    schemaVersion: 'stem-paddle-ocr-structure-review.v1',
    reviewId: REVIEW_ID,
    paperId,
    artifactPath,
    status: 'pending_provider_review',
    requiredChecks: [
      'whole_question_boundaries',
      'question_part_structure',
      'qp_ms_question_binding',
      'diagram_region_integrity',
      'official_syllabus_topic_binding',
    ],
    studentStudyEligible: false,
  }

  writeJson(path.join(workRoot, 'manifest', 'manifest.json'), {
    schemaVersion: 'stem-paddle-ocr-manifest.v1',
    jobs: [job],
  })
  writeText(path.join(workRoot, 'queue', 'structure-review.jsonl'), `${JSON.stringify(queueRow)}\n`)
  writeJson(path.join(workRoot, statePath), state)
  writeJson(path.join(workRoot, artifactPath), artifact)
  writeJson(path.join(workRoot, 'review-drafts', JOB_KEY, ROUTE_ID, 'extraction.json'), pair.extraction)
  writeJson(path.join(workRoot, 'review-drafts', JOB_KEY, ROUTE_ID, 'verification.json'), pair.verification)
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, value, 'utf8')
}
