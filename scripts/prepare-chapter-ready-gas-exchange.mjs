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
const replacementBatch = process.argv.includes('--replacement-batch')
const reserveBatch = process.argv.includes('--reserve-batch')
assert.equal(replacementBatch && reserveBatch, false, 'Select only one preparation batch.')
const outputArg = process.argv.find((value) => value.startsWith('--output-root='))?.slice('--output-root='.length)
const OUTPUT_ROOT = path.resolve(outputArg || (reserveBatch
  ? '.candidate-evidence/9700-as-gas-exchange-reserve-primary-20261004-v1'
  : replacementBatch
    ? '.candidate-evidence/9700-as-gas-exchange-replacement-primary-20261004-v1'
    : '.candidate-evidence/9700-as-gas-exchange-primary-20261004-v2'))
const ARTIFACT_ROOT = path.join(OUTPUT_ROOT, 'artifacts')
const CROP_ROOT = path.join(OUTPUT_ROOT, 'crops')
const PYTHON = 'C:/Users/10604/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
const EXTRACT_WORDS = path.resolve('scripts/chapter-ready-extract-pdf-words.py')
const CROP_IMAGE = path.resolve('scripts/chapter-ready-crop-image.py')
const ROUTE_ID = 'cie-9700-as-biology'
const TOPIC_ID = '9700-as-topic-09'

const points = Object.freeze({
  structure: 'biology-9700-2025-9-1-01',
  distribution: 'biology-9700-2025-9-1-02',
  imageTissues: 'biology-9700-2025-9-1-03',
  imageStructures: 'biology-9700-2025-9-1-04',
  airwayHealth: 'biology-9700-2025-9-1-05',
  tissueFunctions: 'biology-9700-2025-9-1-06',
  alveolarExchange: 'biology-9700-2025-9-1-07',
})

const primarySelections = Object.freeze([
  {
    jobKey: 'd2a2b02338ea66ce3f9bd332c5e6a51140ab358917531ef8f1b613221870f6db',
    fileStem: '9700_s25_qp_11',
    questionNumber: '33',
    page: 13,
    qpBounds: [0.06, 0.42, 0.94, 0.54],
    visualBounds: [],
    correctOption: 'D',
    syllabusPointIds: [points.alveolarExchange],
    ocrText: 'How many times must an oxygen molecule pass through a cell surface membrane to get from air in an alveolus to haemoglobin in a red blood cell? A 2; B 3; C 4; D 5.',
  },
  {
    jobKey: 'd2a2b02338ea66ce3f9bd332c5e6a51140ab358917531ef8f1b613221870f6db',
    fileStem: '9700_s25_qp_11',
    questionNumber: '34',
    page: 13,
    qpBounds: [0.06, 0.54, 0.94, 0.74],
    visualBounds: [],
    correctOption: 'D',
    syllabusPointIds: [points.tissueFunctions],
    ocrText: 'Asthma narrows the air passages. How does salbutamol widen them? A decreases mucus; B decreases alveolar surface area; C causes elastic recoil; D relaxes smooth muscle in bronchi and bronchioles.',
  },
  {
    jobKey: 'd2a2b02338ea66ce3f9bd332c5e6a51140ab358917531ef8f1b613221870f6db',
    fileStem: '9700_s25_qp_11',
    questionNumber: '35',
    page: 14,
    qpBounds: [0.06, 0.07, 0.94, 0.46],
    visualBounds: [[0.12, 0.12, 0.86, 0.43]],
    correctOption: 'D',
    syllabusPointIds: [points.imageTissues, points.tissueFunctions],
    ocrText: 'A photomicrograph shows a transverse section of trachea. Which labelled tissue contracts and relaxes to adjust airway diameter? Options A-D are labels on the source image.',
  },
  {
    jobKey: 'aa8c942479248e3e118f2b885751543c58c8eb35ba7ee8d7f7dafb315c98b8af',
    fileStem: '9700_s25_qp_12',
    questionNumber: '36',
    page: 17,
    qpBounds: [0.06, 0.285, 0.94, 0.445],
    visualBounds: [],
    correctOption: 'A',
    syllabusPointIds: [points.alveolarExchange],
    ocrText: 'Which factors maintain the diffusion gradient for carbon dioxide at alveoli? 1 blood flow; 2 breathing exchanges air; 3 thin alveolar epithelium. A 1 and 2; B 1 and 3; C 1 only; D 2 and 3.',
  },
  {
    jobKey: 'ba7df58e1e3f0ed8bbae4abea224c11c7023cf741d4bc3bd848fb5d84467cda9',
    fileStem: '9700_s25_qp_13',
    questionNumber: '35',
    page: 17,
    qpBounds: [0.06, 0.07, 0.94, 0.22],
    visualBounds: [],
    correctOption: 'C',
    syllabusPointIds: [points.alveolarExchange],
    ocrText: 'Which feature maintains a steep diffusion gradient? A many alveoli; B elastic fibres; C incoming alveolar air has high oxygen concentration; D flattened capillary endothelium.',
  },
  {
    jobKey: 'a8e05585fe52edffb3bdba0bea52a3cd481c890becd86e820f6bb58a6949f88f',
    fileStem: '9700_s25_qp_14',
    questionNumber: '36',
    page: 16,
    qpBounds: [0.06, 0.07, 0.94, 0.29],
    visualBounds: [[0.10, 0.12, 0.73, 0.26]],
    correctOption: 'C',
    syllabusPointIds: [points.distribution],
    ocrText: 'Which row identifies ciliated epithelium, squamous epithelium and smooth muscle present in both trachea and bronchus? Options A-D are shown in the source table.',
  },
])

const replacementSelections = Object.freeze([
  {
    jobKey: 'aa8c942479248e3e118f2b885751543c58c8eb35ba7ee8d7f7dafb315c98b8af',
    fileStem: '9700_s25_qp_12',
    questionNumber: '35',
    page: 17,
    qpBounds: [0.06, 0.065, 0.94, 0.285],
    visualBounds: [[0.10, 0.115, 0.76, 0.27]],
    correctOption: 'A',
    syllabusPointIds: [points.distribution],
    ocrText: 'Which row shows cartilage, ciliated epithelium and smooth muscle present in both the trachea and bronchus walls? Options A-D are shown in the source table.',
  },
  {
    jobKey: 'ba7df58e1e3f0ed8bbae4abea224c11c7023cf741d4bc3bd848fb5d84467cda9',
    fileStem: '9700_s25_qp_13',
    questionNumber: '34',
    page: 16,
    qpBounds: [0.06, 0.33, 0.94, 0.86],
    visualBounds: [
      [0.18, 0.36, 0.82, 0.60],
      [0.10, 0.64, 0.80, 0.84],
    ],
    correctOption: 'D',
    syllabusPointIds: [points.imageTissues, points.tissueFunctions],
    ocrText: 'A photomicrograph of part of the human gas exchange system labels P and Q. Which row identifies smooth muscle and its function? A P regulates air flow; B Q pumps air; C P pumps air; D Q regulates air flow.',
  },
  {
    jobKey: 'de570bea6c2716baa61ce19ac69c7961b588e209bb1197a0211de06680abc6b5',
    fileStem: '9700_w24_qp_13',
    questionNumber: '36',
    page: 16,
    qpBounds: [0.06, 0.56, 0.94, 0.715],
    visualBounds: [],
    correctOption: 'C',
    syllabusPointIds: [points.airwayHealth],
    ocrText: 'What is the function of goblet cells in the gas exchange system? A increase surface area; B move mucus; C release mucus; D trap dust and pathogens.',
  },
])

const reserveSelections = Object.freeze([
  {
    jobKey: '2cdd5a8441f267d7551377c685553cabf7e1f3560ec74d37246ededffb35cc43',
    fileStem: '9700_w24_qp_11',
    questionNumber: '34',
    page: 16,
    qpBounds: [0.06, 0.07, 0.94, 0.225],
    visualBounds: [],
    correctOption: 'B',
    syllabusPointIds: [points.airwayHealth],
    ocrText: 'What is the function of cilia in the gas exchange system? A increase surface area; B move mucus; C produce mucus; D trap dust and pathogens.',
  },
])

const selections = reserveBatch ? reserveSelections : replacementBatch ? replacementSelections : primarySelections
const batchKind = reserveBatch ? 'reserve-candidates' : replacementBatch ? 'replacement-candidates' : 'initial-candidates'

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function region(page, pageImageSha256, bounds) {
  return {
    page,
    pageImageSha256,
    x0: bounds[0],
    y0: bounds[1],
    x1: bounds[2],
    y1: bounds[3],
  }
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

function writeArtifact(selection, generatedAt) {
  const statePath = path.join(WORK_ROOT, 'state', 'jobs', `${selection.jobKey}.json`)
  const state = readJson(statePath)
  assert.equal(state.status, 'completed')
  const qp = sourceDocument(selection, state, 'qp')
  const ms = sourceDocument(selection, state, 'ms')
  const paperId = state.paperId
  assert.equal(paperId, `cie-9700-${selection.fileStem}`)
  const questionId = `${paperId}:q${selection.questionNumber}`
  const qpPage = qp.document.pages[String(selection.page)].sourcePage
  const msPage = ms.document.pages['3'].sourcePage
  assert.equal(sha256File(qpPage.path), qpPage.sha256)
  assert.equal(sha256File(msPage.path), msPage.sha256)

  const words = JSON.parse(execFileSync(PYTHON, [EXTRACT_WORDS, ms.pdfPath, '3'], { encoding: 'utf8' }))
  const located = locateMcqRow(words, Number(selection.questionNumber), selection.correctOption)
  const msBounds = [0.075, located.center - located.step * 0.45, 0.92, located.center + located.step * 0.45]
  const questionRegion = region(selection.page, qpPage.sha256, selection.qpBounds)
  const diagramRegions = selection.visualBounds.map((bounds) => region(selection.page, qpPage.sha256, bounds))
  const markSchemeEvidence = [{
    ...region(3, msPage.sha256, msBounds),
    rowLabel: selection.questionNumber,
    partLabels: ['whole'],
    text: `Question ${selection.questionNumber}: ${selection.correctOption}; 1 mark.`,
  }]
  const part = {
    label: 'whole',
    partKind: 'whole-question',
    marks: 1,
    ocrText: selection.ocrText,
    syllabusPointIds: selection.syllabusPointIds,
    answerArea: { type: 'multiple-choice', input: 'choice' },
    options: ['A', 'B', 'C', 'D'],
    answerKey: selection.correctOption,
    partPageBinding: {
      schemaVersion: 'reviewed-part-page-binding-v1',
      questionPage: selection.page,
      markSchemePage: 3,
    },
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
    sourceQuestionId: questionId,
    questionStartPage: selection.page,
    status: 'source-reviewed-held',
    wholeQuestionPreserved: true,
    totalMarks: 1,
    regions: [questionRegion],
    diagramRegions,
    parts: [part],
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
    parts: [{ label: 'whole', marks: 1, partPageBinding: part.partPageBinding }],
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
      markSchemePageHashes: { 3: msPage.sha256 },
      pageSizes: { [selection.page]: { width: qpPage.width, height: qpPage.height } },
      markSchemePageSizes: { 3: { width: msPage.width, height: msPage.height } },
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
      source: {
        questionPdfSha256: qp.document.sourceSha256,
        markSchemePdfSha256: ms.document.sourceSha256,
      },
      reviewSummary,
      questions: [candidateQuestion],
    },
    verification: {
      routeId: ROUTE_ID,
      subjectCode: '9700',
      stage: 'AS',
      paper: 'P1',
      component: 1,
      source: {
        questionPdfSha256: qp.document.sourceSha256,
        markSchemePdfSha256: ms.document.sourceSha256,
      },
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
    reviewNote: `Current Codex directly inspected original ${qp.fileName} page ${selection.page} and ${ms.fileName} page 3. Whole Q${selection.questionNumber}, all A-D options, retained visuals, key ${selection.correctOption}, 1 mark and direct chapter 9 outcomes were confirmed. This is one AI source review only; no human, teacher, second-provider or publication claim.`,
    evidence: [
      { document: 'qp', page: selection.page, pageImageSha256: qpPage.sha256 },
      { document: 'ms', page: 3, pageImageSha256: msPage.sha256 },
    ],
  }
  artifact.studentRelease = buildAiStudentStudyRelease({ ...artifact, routeId: ROUTE_ID })
  assert.equal(hasValidAiStudentStudyRelease(artifact), true)

  const outputDirectory = path.join(ARTIFACT_ROOT, paperId)
  fs.mkdirSync(outputDirectory, { recursive: true })
  const outputFile = path.join(outputDirectory, `q${selection.questionNumber}.json`)
  fs.writeFileSync(outputFile, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  const cropBase = `${paperId}-q${selection.questionNumber}`
  const qpCrop = crop(qpPage.path, path.join(CROP_ROOT, `${cropBase}-qp.png`), selection.qpBounds)
  const msCrop = crop(msPage.path, path.join(CROP_ROOT, `${cropBase}-ms.png`), msBounds)
  return {
    sourceQuestionId: questionId,
    artifact: { path: outputFile, sha256: sha256File(outputFile), artifactId: identity },
    answer: selection.correctOption,
    syllabusPointIds: selection.syllabusPointIds,
    geometry: { qp: questionRegion, ms: markSchemeEvidence[0], visuals: diagramRegions },
    sourcePages: {
      qp: { ...qpPage, path: qpPage.path },
      ms: { ...msPage, path: msPage.path },
    },
    crops: { qp: qpCrop, ms: msCrop },
    msRow: located,
  }
}

function main() {
  if (fs.existsSync(OUTPUT_ROOT)) throw new Error(`Refuse to overwrite evidence root: ${OUTPUT_ROOT}`)
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true })
  fs.mkdirSync(CROP_ROOT, { recursive: true })
  const generatedAt = new Date().toISOString()
  const results = selections.map((selection) => writeArtifact(selection, generatedAt))
  const groups = createAiVerifiedQuestionBankLoader({ artifactRoot: ARTIFACT_ROOT, libraryRoot: LIBRARY_ROOT })().groups
  assert.equal(groups.length, selections.length)
  assert.equal(new Set(groups.map((group) => group.sourceQuestionId)).size, selections.length)
  const summary = {
    schemaVersion: 'chapter-ready-primary-preparation.v1',
    status: 'PASS_PRIMARY_REVIEW_PENDING_INDEPENDENT_PROVIDER',
    batchKind,
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
  console.error(JSON.stringify({ status: 'BLOCKED_PRIMARY_PREPARATION', error: String(error?.message || error).slice(0, 400) }))
  process.exitCode = 1
}
