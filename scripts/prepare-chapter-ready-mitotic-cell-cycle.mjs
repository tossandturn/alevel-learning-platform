import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  artifactId,
  buildAiStudentStudyRelease,
  hasValidAiStudentStudyRelease,
  sourceReviewInputSha256,
} from './ai-pdf-ingestion/contract.mjs'
import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { locateMcqRow } from './chapter-ready-ms-row-geometry.mjs'

const WORK_ROOT = path.resolve('D:/CodexWork/stem-ocr-work')
const LIBRARY_ROOT = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')
const OUTPUT_ROOT = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-primary-20261005-v9')
const ARTIFACT_ROOT = path.join(OUTPUT_ROOT, 'artifacts')
const CROP_ROOT = path.join(OUTPUT_ROOT, 'crops')
const PYTHON = 'C:/Users/10604/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
const EXTRACT_WORDS = path.resolve('scripts/chapter-ready-extract-pdf-words.py')
const CROP_IMAGE = path.resolve('scripts/chapter-ready-crop-image.py')
const SYLLABUS_SOURCE = path.resolve('src/data/syllabus/biology-9700-as-mitotic-cell-cycle-source.json')
const ROUTE_ID = 'cie-9700-as-biology'
const TOPIC_ID = '9700-as-topic-05'

const points = Object.freeze({
  chromosomeStructure: 'biology-9700-2025-5-1-01',
  importanceOfMitosis: 'biology-9700-2025-5-1-02',
  cellCycle: 'biology-9700-2025-5-1-03',
  telomeres: 'biology-9700-2025-5-1-04',
  stemCells: 'biology-9700-2025-5-1-05',
  chromosomeBehaviour: 'biology-9700-2025-5-2-01',
  interpretStages: 'biology-9700-2025-5-2-02',
})

const primarySelections = Object.freeze([
  {
    jobKey: 'd2a2b02338ea66ce3f9bd332c5e6a51140ab358917531ef8f1b613221870f6db',
    fileStem: '9700_s25_qp_11',
    questionNumber: '20',
    page: 9,
    qpBounds: [0.06, 0.06, 0.94, 0.385],
    visualBounds: [[0.33, 0.09, 0.68, 0.20], [0.11, 0.23, 0.49, 0.37]],
    correctOption: 'B',
    syllabusPointIds: [points.chromosomeStructure],
    ocrText: 'The diagram shows a chromosome. What are structures P and Q? A P centriole, Q chromatid; B P centromere, Q telomere; C P centromere, Q centriole; D P centriole, Q telomere.',
  },
  {
    jobKey: 'd2a2b02338ea66ce3f9bd332c5e6a51140ab358917531ef8f1b613221870f6db',
    fileStem: '9700_s25_qp_11',
    questionNumber: '19',
    page: 8,
    qpBounds: [0.06, 0.38, 0.94, 0.91],
    visualBounds: [[0.29, 0.455, 0.71, 0.605], [0.11, 0.645, 0.54, 0.825]],
    correctOption: 'A',
    syllabusPointIds: [points.chromosomeBehaviour],
    ocrText: 'A sample of 500 cells dividing by mitosis was examined to identify the stage of mitosis for each cell. The results were: late prophase 23%, end of metaphase 45%, and between the start of anaphase and the end of telophase 24%. Which row is correct for the number of cells with chromosomes at the equator and the number with separated chromatids? A 225 and 120; B 225 and 345; C 380 and 120; D 380 and 345.',
  },
  {
    jobKey: 'ba7df58e1e3f0ed8bbae4abea224c11c7023cf741d4bc3bd848fb5d84467cda9',
    fileStem: '9700_s25_qp_13',
    questionNumber: '21',
    page: 10,
    qpBounds: [0.06, 0.46, 0.94, 0.68],
    visualBounds: [],
    correctOption: 'A',
    syllabusPointIds: [points.chromosomeBehaviour],
    ocrText: 'A cell is in mitosis. Each of the chromosomes in the cell consists of two chromatids. The chromosomes are not lined up at the equator. Which stage of mitosis is described? A prophase; B metaphase; C anaphase; D telophase.',
  },
  {
    jobKey: 'aa8c942479248e3e118f2b885751543c58c8eb35ba7ee8d7f7dafb315c98b8af',
    fileStem: '9700_s25_qp_12',
    questionNumber: '22',
    page: 11,
    qpBounds: [0.06, 0.585, 0.94, 0.655],
    visualBounds: [],
    correctOption: 'D',
    syllabusPointIds: [points.cellCycle],
    ocrText: 'During which phase of the cell cycle does DNA replication take place? A G1; B G2; C M; D S.',
  },
  {
    jobKey: 'a8e05585fe52edffb3bdba0bea52a3cd481c890becd86e820f6bb58a6949f88f',
    fileStem: '9700_s25_qp_14',
    questionNumber: '21',
    page: 11,
    qpBounds: [0.06, 0.58, 0.94, 0.765],
    visualBounds: [],
    correctOption: 'C',
    syllabusPointIds: [points.importanceOfMitosis],
    ocrText: 'The epithelium that lines the stomach is damaged by acid and is renewed every two days. Why is mitosis required to repair the damage? A Mitosis repairs damaged cells; B Mitosis produces new genetically similar cells; C Mitosis provides genetically identical replacement cells; D Mitosis doubles the original cell number.',
  },
  {
    jobKey: 'a8e05585fe52edffb3bdba0bea52a3cd481c890becd86e820f6bb58a6949f88f',
    fileStem: '9700_s25_qp_14',
    questionNumber: '22',
    page: 11,
    qpBounds: [0.06, 0.765, 0.94, 0.925],
    visualBounds: [],
    correctOption: 'D',
    syllabusPointIds: [points.telomeres],
    ocrText: 'What is the role of telomeres? A allowing the chromatids to reach the poles during mitosis; B holding sister chromatids together; C making sure that the sister chromatids are of identical length; D preventing loss of genes during DNA replication.',
  },
])
const selections = primarySelections

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function region(page, pageImageSha256, bounds) {
  return { page, pageImageSha256, x0: bounds[0], y0: bounds[1], x1: bounds[2], y1: bounds[3] }
}

function crop(source, target, bounds) {
  execFileSync(PYTHON, [CROP_IMAGE, source, target, ...bounds.map(String)], { encoding: 'utf8' })
  return { path: target, sha256: sha256File(target), bytes: fs.statSync(target).size }
}

function sourceDocument(selection, state, kind) {
  const suffix = kind === 'qp' ? 'qp' : 'ms'
  const fileName = selection.fileStem.replace('_qp_', `_${suffix}_`) + '.pdf'
  const pdfPath = path.join(LIBRARY_ROOT, '9700', fileName)
  const document = state.documents[kind]
  assert.equal(document.status, 'completed')
  assert.equal(sha256File(pdfPath), document.sourceSha256)
  return { fileName, pdfPath, document }
}

function writeArtifact(selection, generatedAt, allowedPointIds) {
  assert.ok(selection.syllabusPointIds.every((pointId) => allowedPointIds.has(pointId)))
  const state = readJson(path.join(WORK_ROOT, 'state', 'jobs', `${selection.jobKey}.json`))
  assert.equal(state.status, 'completed')
  const qp = sourceDocument(selection, state, 'qp')
  const ms = sourceDocument(selection, state, 'ms')
  const paperId = state.paperId
  assert.equal(paperId, `cie-9700-${selection.fileStem}`)
  const sourceQuestionId = `${paperId}:q${selection.questionNumber}`
  const qpPage = qp.document.pages[String(selection.page)].sourcePage
  const msPage = ms.document.pages['2'].sourcePage
  assert.equal(sha256File(qpPage.path), qpPage.sha256)
  assert.equal(sha256File(msPage.path), msPage.sha256)

  const words = JSON.parse(execFileSync(PYTHON, [EXTRACT_WORDS, ms.pdfPath, '2'], { encoding: 'utf8' }))
  const located = locateMcqRow(words, Number(selection.questionNumber), selection.correctOption)
  const msBounds = [0.075, located.center - located.step * 0.45, 0.92, located.center + located.step * 0.45]
  const questionRegion = region(selection.page, qpPage.sha256, selection.qpBounds)
  const diagramRegions = selection.visualBounds.map((bounds) => region(selection.page, qpPage.sha256, bounds))
  const markSchemeEvidence = [{
    ...region(2, msPage.sha256, msBounds),
    rowLabel: selection.questionNumber,
    partLabels: ['whole'],
    text: `Question ${selection.questionNumber}: ${selection.correctOption}; 1 mark.`,
  }]
  const partPageBinding = {
    schemaVersion: 'reviewed-part-page-binding-v1',
    questionPage: selection.page,
    markSchemePage: 2,
  }
  const tags = {
    primaryTopicId: TOPIC_ID,
    secondaryTopicIds: [],
    syllabusPointIds: selection.syllabusPointIds,
    skillTagIds: [],
    questionFormatIds: [],
  }
  const reviewSummary = {
    status: 'source-reviewed-local-prepared',
    studentStudyEligible: true,
    studentRelease: true,
    scope: 'One current Codex source review; exact QP/MS, whole question, options, answer and geometry inspected. Independent provider verification pending.',
  }
  const candidateQuestion = {
    questionNumber: selection.questionNumber,
    sourceQuestionId,
    questionStartPage: selection.page,
    status: 'source-reviewed-held',
    wholeQuestionPreserved: true,
    totalMarks: 1,
    regions: [questionRegion],
    diagramRegions,
    parts: [{
      label: 'whole',
      partKind: 'whole-question',
      marks: 1,
      ocrText: selection.ocrText,
      syllabusPointIds: selection.syllabusPointIds,
      answerArea: { type: 'multiple-choice', input: 'choice' },
      options: ['A', 'B', 'C', 'D'],
      answerKey: selection.correctOption,
      partPageBinding,
    }],
    tags,
    markSchemeEvidence,
    issues: [],
    solutionRestrictions: ['Preserve original options and visuals. Do not reveal the private answer before submission.'],
  }
  const verificationQuestion = {
    questionNumber: selection.questionNumber,
    questionStartPage: selection.page,
    pages: [selection.page],
    regions: [questionRegion],
    diagramRegions,
    diagramRegionCount: diagramRegions.length,
    parts: [{ label: 'whole', marks: 1, partPageBinding }],
    tags,
    markSchemeEvidence,
  }
  const identity = artifactId({
    paperId,
    questionPdfSha256: qp.document.sourceSha256,
    markSchemePdfSha256: ms.document.sourceSha256,
  })
  const artifact = {
    schemaVersion: 'ai-pdf-ingestion.v1',
    artifactId: identity,
    paperId,
    subject: '9700',
    stage: 'AS',
    syllabusRouteId: ROUTE_ID,
    status: 'ai-verified',
    storageMode: 'coordinate-only',
    source: {
      board: 'Cambridge International',
      paperId,
      specificationId: 'cambridge-9700-2025-2027',
      stage: 'AS',
      rightsStatus: 'personal-study-restricted',
      accessPolicyId: 'personal-study-restricted-v1',
      renderDpi: qpPage.dpi,
      pageImageHashes: { [selection.page]: qpPage.sha256 },
      markSchemePageHashes: { 2: msPage.sha256 },
      pageSizes: { [selection.page]: { width: qpPage.width, height: qpPage.height } },
      markSchemePageSizes: { 2: { width: msPage.width, height: msPage.height } },
      ocr: { engine: 'PaddleOCR-VL-1.6', jobKey: selection.jobKey },
      questionPdfPath: qp.pdfPath,
      questionPdfRelativePath: `9700/${qp.fileName}`,
      questionPdfSha256: qp.document.sourceSha256,
      markSchemePdfPath: ms.pdfPath,
      markSchemePdfRelativePath: `9700/${ms.fileName}`,
      markSchemePdfSha256: ms.document.sourceSha256,
    },
    candidate: {
      routeId: ROUTE_ID,
      subjectCode: '9700',
      stage: 'AS',
      paper: 'P1',
      component: 1,
      source: { questionPdfSha256: qp.document.sourceSha256, markSchemePdfSha256: ms.document.sourceSha256 },
      reviewSummary,
      questions: [candidateQuestion],
    },
    verification: {
      routeId: ROUTE_ID,
      subjectCode: '9700',
      stage: 'AS',
      paper: 'P1',
      component: 1,
      source: { questionPdfSha256: qp.document.sourceSha256, markSchemePdfSha256: ms.document.sourceSha256 },
      reviewSummary,
      questionStarts: [{ questionNumber: selection.questionNumber, questionStartPage: selection.page }],
      questions: [verificationQuestion],
    },
    studentStudyEligible: true,
    formalProgressEligible: false,
    generatedAt,
  }
  artifact.sourceReview = {
    schemaVersion: 'ai-source-semantic-review.v1',
    provider: 'openai',
    model: 'codex-current-session',
    modelVersionVerified: false,
    decision: 'accept',
    reviewedAt: generatedAt,
    inputSha256: sourceReviewInputSha256(artifact),
    confirmations: {
      sourceBindingConfirmed: true,
      wholeQuestionConfirmed: true,
      partStructureConfirmed: true,
      marksConfirmed: true,
      markSchemeEvidenceConfirmed: true,
      topicMappingConfirmed: true,
    },
    reviewNote: `Current Codex directly inspected original ${qp.fileName} page ${selection.page} and ${ms.fileName} page 2. Whole Q${selection.questionNumber}, all A-D options, retained visuals, key ${selection.correctOption}, 1 mark and direct Chapter 5 outcomes were confirmed. This is one AI source review only; no human, teacher, second-provider or publication claim.`,
    evidence: [
      { document: 'qp', page: selection.page, pageImageSha256: qpPage.sha256 },
      { document: 'ms', page: 2, pageImageSha256: msPage.sha256 },
    ],
  }
  artifact.studentRelease = buildAiStudentStudyRelease({ ...artifact, routeId: ROUTE_ID })
  assert.equal(hasValidAiStudentStudyRelease(artifact), true)

  const outputDirectory = path.join(ARTIFACT_ROOT, paperId)
  fs.mkdirSync(outputDirectory, { recursive: true })
  const outputFile = path.join(outputDirectory, `q${selection.questionNumber}.json`)
  fs.writeFileSync(outputFile, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  const cropBase = `${paperId}-q${selection.questionNumber}`
  return {
    sourceQuestionId,
    artifact: { path: outputFile, sha256: sha256File(outputFile), artifactId: identity },
    answer: selection.correctOption,
    syllabusPointIds: selection.syllabusPointIds,
    geometry: { qp: questionRegion, ms: markSchemeEvidence[0], visuals: diagramRegions },
    sourcePages: { qp: { ...qpPage, path: qpPage.path }, ms: { ...msPage, path: msPage.path } },
    crops: {
      qp: crop(qpPage.path, path.join(CROP_ROOT, `${cropBase}-qp.png`), selection.qpBounds),
      ms: crop(msPage.path, path.join(CROP_ROOT, `${cropBase}-ms.png`), msBounds),
    },
    msRow: located,
  }
}

function main() {
  if (fs.existsSync(OUTPUT_ROOT)) throw new Error(`Refuse to overwrite evidence root: ${OUTPUT_ROOT}`)
  const syllabus = readJson(SYLLABUS_SOURCE)
  assert.equal(syllabus.routeId, ROUTE_ID)
  assert.equal(syllabus.topicId, TOPIC_ID)
  assert.equal(syllabus.points.length, 8)
  const allowedPointIds = new Set(syllabus.points.map((point) => point.id))
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true })
  fs.mkdirSync(CROP_ROOT, { recursive: true })
  const generatedAt = new Date().toISOString()
  const results = selections.map((selection) => writeArtifact(selection, generatedAt, allowedPointIds))
  const groups = createAiVerifiedQuestionBankLoader({ artifactRoot: ARTIFACT_ROOT, libraryRoot: LIBRARY_ROOT })().groups
  assert.equal(groups.length, selections.length)
  assert.equal(new Set(groups.map((group) => group.sourceQuestionId)).size, selections.length)
  const summary = {
    schemaVersion: 'chapter-ready-primary-preparation.v1',
    status: 'PASS_PRIMARY_REVIEW_PENDING_INDEPENDENT_PROVIDER',
    batchKind: 'initial-candidates',
    routeId: ROUTE_ID,
    topicId: TOPIC_ID,
    questions: results.length,
    runtimeGroups: groups.length,
    studentStudyEligible: true,
    formalProgressEligible: false,
    providerCalls: 0,
    results,
  }
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ ...summary, outputRoot: OUTPUT_ROOT }))
}

try {
  main()
} catch (error) {
  console.error(JSON.stringify({ status: 'BLOCKED_PRIMARY_PREPARATION', error: String(error?.message || error).slice(0, 400) })); process.exitCode = 1
}
