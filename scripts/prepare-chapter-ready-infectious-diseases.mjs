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
const OUTPUT_ROOT = path.resolve(reserveBatch
  ? '.candidate-evidence/9700-as-infectious-diseases-reserve-primary-20261004-v1'
  : replacementBatch
    ? '.candidate-evidence/9700-as-infectious-diseases-replacement-primary-20261004-v4'
    : '.candidate-evidence/9700-as-infectious-diseases-primary-20261004-v2')
const ARTIFACT_ROOT = path.join(OUTPUT_ROOT, 'artifacts')
const CROP_ROOT = path.join(OUTPUT_ROOT, 'crops')
const PYTHON = 'C:/Users/10604/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
const EXTRACT_WORDS = path.resolve('scripts/chapter-ready-extract-pdf-words.py')
const CROP_IMAGE = path.resolve('scripts/chapter-ready-crop-image.py')
const SYLLABUS_SOURCE = path.resolve('src/data/syllabus/biology-9700-as-infectious-diseases-source.json')
const ROUTE_ID = 'cie-9700-as-biology'
const TOPIC_ID = '9700-as-topic-10'

const points = Object.freeze({
  infectiousDefinition: 'biology-9700-2025-10-1-01',
  pathogenIdentity: 'biology-9700-2025-10-1-02',
  transmission: 'biology-9700-2025-10-1-03',
  controlFactors: 'biology-9700-2025-10-1-04',
  penicillinAndViruses: 'biology-9700-2025-10-2-01',
  antibioticResistance: 'biology-9700-2025-10-2-02',
})

const primarySelections = Object.freeze([
  {
    jobKey: 'd2a2b02338ea66ce3f9bd332c5e6a51140ab358917531ef8f1b613221870f6db',
    fileStem: '9700_s25_qp_11',
    questionNumber: '38',
    page: 15,
    qpBounds: [0.06, 0.07, 0.94, 0.25],
    visualBounds: [],
    correctOption: 'D',
    syllabusPointIds: [points.antibioticResistance],
    ocrText: 'Which step can reduce the impact of antibiotic resistance? A share prescribed antibiotics; B use antibiotics for viral diseases; C give antibiotics to healthy farm animals; D use vaccination programmes to reduce bacterial disease spread.',
  },
  {
    jobKey: 'aa8c942479248e3e118f2b885751543c58c8eb35ba7ee8d7f7dafb315c98b8af',
    fileStem: '9700_s25_qp_12',
    questionNumber: '37',
    page: 17,
    qpBounds: [0.06, 0.445, 0.94, 0.84],
    visualBounds: [],
    correctOption: 'B',
    syllabusPointIds: [points.pathogenIdentity, points.transmission],
    ocrText: 'HFMD is viral and can spread through faecally contaminated water or droplets. Lyme disease is bacterial and vector-borne. Which comparison with cholera, malaria or TB is correct? A antibiotics kill both vectors; B HFMD can spread similarly to cholera or TB; C HFMD and TB pathogens are both prokaryotic; D chlorinated water reduces both TB and HFMD.',
  },
  {
    jobKey: 'ba7df58e1e3f0ed8bbae4abea224c11c7023cf741d4bc3bd848fb5d84467cda9',
    fileStem: '9700_s25_qp_13',
    questionNumber: '37',
    page: 17,
    qpBounds: [0.06, 0.575, 0.94, 0.87],
    visualBounds: [],
    correctOption: 'B',
    syllabusPointIds: [points.penicillinAndViruses, points.antibioticResistance],
    ocrText: 'Which statement can describe penicillin resistance developing in bacteria? A altered DNA binding allows replication; B reduced penicillin binding to certain proteins allows cell-wall production; C a penicillin-breaking enzyme preserves ribosomes; D altered inhibited enzyme preserves cell membranes.',
  },
  {
    jobKey: 'ba7df58e1e3f0ed8bbae4abea224c11c7023cf741d4bc3bd848fb5d84467cda9',
    fileStem: '9700_s25_qp_13',
    questionNumber: '40',
    page: 18,
    qpBounds: [0.06, 0.515, 0.94, 0.75],
    visualBounds: [],
    correctOption: 'C',
    syllabusPointIds: [points.pathogenIdentity],
    ocrText: 'Which disease is caused by a eukaryotic pathogen? A cholera; B HIV/AIDS; C malaria; D tuberculosis.',
  },
  {
    jobKey: 'a8e05585fe52edffb3bdba0bea52a3cd481c890becd86e820f6bb58a6949f88f',
    fileStem: '9700_s25_qp_14',
    questionNumber: '37',
    page: 16,
    qpBounds: [0.06, 0.29, 0.94, 0.675],
    visualBounds: [],
    correctOption: 'A',
    syllabusPointIds: [points.controlFactors],
    ocrText: 'Which listed cholera control measures in a disaster camp involve an economic factor? 1 chlorinate drinking water; 2 emergency treatment centre; 3 disinfect sewage areas and bedding; 4 regular health-worker visits; 5 keep case and death records. A 1-5; B 1,3,5; C 2,3,4,5; D 2,4.',
  },
  {
    jobKey: 'a8e05585fe52edffb3bdba0bea52a3cd481c890becd86e820f6bb58a6949f88f',
    fileStem: '9700_s25_qp_14',
    questionNumber: '38',
    page: 16,
    qpBounds: [0.06, 0.68, 0.94, 0.945],
    visualBounds: [[0.10, 0.81, 0.78, 0.94]],
    correctOption: 'D',
    syllabusPointIds: [points.penicillinAndViruses],
    ocrText: 'Which antibiotics can treat influenza virus infection? The source table gives penicillin, tetracycline and rifamycin combinations for A-D; D marks all three as unusable.',
  },
])

const replacementSelections = Object.freeze([
  {
    jobKey: 'd2a2b02338ea66ce3f9bd332c5e6a51140ab358917531ef8f1b613221870f6db',
    fileStem: '9700_s25_qp_11',
    questionNumber: '36',
    page: 14,
    qpBounds: [0.06, 0.47, 0.94, 0.615],
    visualBounds: [],
    correctOption: 'A',
    syllabusPointIds: [points.infectiousDefinition, points.pathogenIdentity, points.transmission],
    ocrText: 'Which statements about an infectious disease may be correct? 1 It can be caused by a protoctist. 2 It can be transmitted by an insect vector. 3 It can be transmitted from mother to child. A 1,2,3; B 1,2; C 1,3; D 2,3.',
  },
  {
    jobKey: 'd2a2b02338ea66ce3f9bd332c5e6a51140ab358917531ef8f1b613221870f6db',
    fileStem: '9700_s25_qp_11',
    questionNumber: '37',
    page: 14,
    qpBounds: [0.06, 0.62, 0.94, 0.84],
    visualBounds: [],
    correctOption: 'A',
    syllabusPointIds: [points.controlFactors],
    ocrText: 'Which statements explain why cholera has not been eradicated by vaccination? 1 limited affordable vaccine availability; 2 protection takes weeks; 3 under-reporting; 4 immunity decreases after two years. A 1,2,3,4; B 1,2; C 2,4; D 3,4.',
  },
  {
    jobKey: 'aa8c942479248e3e118f2b885751543c58c8eb35ba7ee8d7f7dafb315c98b8af',
    fileStem: '9700_s25_qp_12',
    questionNumber: '38',
    page: 18,
    qpBounds: [0.06, 0.07, 0.94, 0.225],
    visualBounds: [],
    correctOption: 'B',
    syllabusPointIds: [points.pathogenIdentity, points.penicillinAndViruses, points.antibioticResistance],
    ocrText: 'Which statements explain why antibiotics may not treat cholera successfully? 1 the organism developed resistance; 2 antibiotics cannot harm viruses; 3 antibiotics do not affect eukaryotic pathogens. A 1,2,3; B 1 only; C 2 only; D 3 only.',
  },
])

const reserveSelections = Object.freeze([
  {
    jobKey: 'd06d11192d90e8371b2efc03b353256b8037a550d882fc971c4ad04e97cca098',
    fileStem: '9700_s24_qp_12',
    questionNumber: '35',
    page: 17,
    qpBounds: [0.06, 0.07, 0.94, 0.21],
    visualBounds: [],
    correctOption: 'D',
    syllabusPointIds: [points.pathogenIdentity],
    ocrText: 'Which disease does Mycobacterium bovis cause? A cholera; B HIV/AIDS; C malaria; D tuberculosis.',
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
  const partPageBinding = {
    schemaVersion: 'reviewed-part-page-binding-v1',
    questionPage: selection.page,
    markSchemePage: 3,
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
    reviewNote: `Current Codex directly inspected original ${qp.fileName} page ${selection.page} and ${ms.fileName} page 3. Whole Q${selection.questionNumber}, all A-D options, retained visuals, key ${selection.correctOption}, 1 mark and direct chapter 10 outcomes were confirmed. This is one AI source review only; no human, teacher, second-provider or publication claim.`,
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
  assert.equal(syllabus.points.length, 6)
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
