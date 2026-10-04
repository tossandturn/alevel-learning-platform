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
const replacementStage2 = process.argv.includes('--replacement-stage-2')
assert.equal(replacementBatch && replacementStage2, false, 'Replacement stage flags are mutually exclusive.')
const OUTPUT_ROOT = path.resolve(replacementStage2
  ? '.candidate-evidence/9700-as-biological-molecules-replacement-stage2-primary-20261005-v1'
  : replacementBatch
    ? '.candidate-evidence/9700-as-biological-molecules-replacement-primary-20261005-v1'
    : '.candidate-evidence/9700-as-biological-molecules-primary-20261005-v1')
const ARTIFACT_ROOT = path.join(OUTPUT_ROOT, 'artifacts')
const CROP_ROOT = path.join(OUTPUT_ROOT, 'crops')
const PYTHON = 'C:/Users/10604/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
const EXTRACT_WORDS = path.resolve('scripts/chapter-ready-extract-pdf-words.py')
const CROP_IMAGE = path.resolve('scripts/chapter-ready-crop-image.py')
const SYLLABUS_SOURCE = path.resolve('src/data/syllabus/biology-9700-as-biological-molecules-source.json')
const ROUTE_ID = 'cie-9700-as-biology'
const TOPIC_ID = '9700-as-topic-02'

const points = Object.freeze({
  moleculeTests: 'biology-9700-2025-2-1-01',
  glucoseRings: 'biology-9700-2025-2-2-01',
  monomerTerms: 'biology-9700-2025-2-2-02',
  reducingSugars: 'biology-9700-2025-2-2-04',
  glycosidicHydrolysis: 'biology-9700-2025-2-2-06',
  cellulose: 'biology-9700-2025-2-2-08',
  triglycerideFunctions: 'biology-9700-2025-2-2-10',
  proteinLevels: 'biology-9700-2025-2-3-02',
  proteinInteractions: 'biology-9700-2025-2-3-03',
  globularProteins: 'biology-9700-2025-2-3-04',
  water: 'biology-9700-2025-2-4-01',
})

const primarySelections = Object.freeze([
  {
    jobKey: 'd2a2b02338ea66ce3f9bd332c5e6a51140ab358917531ef8f1b613221870f6db',
    fileStem: '9700_s25_qp_11',
    questionNumber: '7',
    page: 4,
    qpBounds: [0.06, 0.475, 0.94, 0.78],
    visualBounds: [[0.10, 0.58, 0.82, 0.78]],
    correctOption: 'C',
    syllabusPointIds: [points.moleculeTests, points.reducingSugars],
    ocrText: 'Iodine and Benedict tests are performed on starch; Benedict is repeated after amylase incubation. Which result row is correct? C: iodine positive before amylase, Benedict negative before amylase and positive after amylase.',
  },
  {
    jobKey: 'd2a2b02338ea66ce3f9bd332c5e6a51140ab358917531ef8f1b613221870f6db',
    fileStem: '9700_s25_qp_11',
    questionNumber: '8',
    page: 5,
    qpBounds: [0.06, 0.06, 0.94, 0.275],
    visualBounds: [[0.10, 0.095, 0.56, 0.275]],
    correctOption: 'A',
    syllabusPointIds: [points.glucoseRings, points.cellulose],
    ocrText: 'Which row about alpha-glucose and beta-glucose is correct? A: the OH position differs at carbon 1 and cellulose does not contain both molecules; B: carbon 1 and yes; C: carbon 4 and no; D: carbon 4 and yes.',
  },
  {
    jobKey: 'd2a2b02338ea66ce3f9bd332c5e6a51140ab358917531ef8f1b613221870f6db',
    fileStem: '9700_s25_qp_11',
    questionNumber: '10',
    page: 5,
    qpBounds: [0.06, 0.46, 0.94, 0.64],
    visualBounds: [],
    correctOption: 'C',
    syllabusPointIds: [points.triglycerideFunctions],
    ocrText: 'Which additional triglyceride functions are correct? 1 buoyancy in some marine animals; 2 main components of cell membranes; 3 thermal insulation. A 1,2,3; B 1,2; C 1,3; D 2,3.',
  },
  {
    jobKey: 'ba7df58e1e3f0ed8bbae4abea224c11c7023cf741d4bc3bd848fb5d84467cda9',
    fileStem: '9700_s25_qp_13',
    questionNumber: '9',
    page: 5,
    qpBounds: [0.06, 0.685, 0.94, 0.84],
    visualBounds: [],
    correctOption: 'C',
    syllabusPointIds: [points.glycosidicHydrolysis],
    ocrText: 'What happens when sucrose is heated with acid? A condensation using water releases only glucose; B condensation releases fructose, glucose and water; C hydrolysis using water releases fructose and glucose; D hydrolysis releases fructose, glucose and water.',
  },
  {
    jobKey: 'ba7df58e1e3f0ed8bbae4abea224c11c7023cf741d4bc3bd848fb5d84467cda9',
    fileStem: '9700_s25_qp_13',
    questionNumber: '14',
    page: 7,
    qpBounds: [0.06, 0.50, 0.94, 0.66],
    visualBounds: [],
    correctOption: 'B',
    syllabusPointIds: [points.water],
    ocrText: 'Which water property causes relatively small temperature changes in oceans and cell cytoplasm? A high latent heat of vaporisation; B high specific heat capacity; C low specific heat capacity; D low latent heat of vaporisation.',
  },
  {
    jobKey: 'a8e05585fe52edffb3bdba0bea52a3cd481c890becd86e820f6bb58a6949f88f',
    fileStem: '9700_s25_qp_14',
    questionNumber: '11',
    page: 6,
    qpBounds: [0.06, 0.06, 0.94, 0.21],
    visualBounds: [],
    correctOption: 'C',
    syllabusPointIds: [points.globularProteins],
    ocrText: 'Which description of globular proteins is correct? A only found in cell-surface membranes; B only contain amino acids with hydrophilic R groups; C can change shape using energy from ATP; D always have quaternary structure of at least three polypeptides.',
  },
])

const replacementSelections = Object.freeze([
  {
    jobKey: 'd2a2b02338ea66ce3f9bd332c5e6a51140ab358917531ef8f1b613221870f6db',
    fileStem: '9700_s25_qp_11',
    questionNumber: '9',
    page: 5,
    qpBounds: [0.06, 0.27, 0.94, 0.45],
    visualBounds: [],
    correctOption: 'A',
    syllabusPointIds: [points.monomerTerms],
    ocrText: 'Which molecules are monosaccharides? 1 ribose; 2 glucose; 3 deoxyribose; 4 sucrose. A 1,2,3; B 1,2,4; C 1,3,4; D 2,3,4.',
  },
  {
    jobKey: 'aa8c942479248e3e118f2b885751543c58c8eb35ba7ee8d7f7dafb315c98b8af',
    fileStem: '9700_s25_qp_12',
    questionNumber: '10',
    page: 5,
    qpBounds: [0.06, 0.38, 0.94, 0.52],
    visualBounds: [],
    correctOption: 'A',
    syllabusPointIds: [points.water],
    ocrText: 'Which water property enables sweating to lose heat efficiently? A high latent heat of vaporisation; B high specific heat capacity; C each molecule hydrogen-bonds with four water molecules; D very high cohesion and adhesion.',
  },
  {
    jobKey: 'ba7df58e1e3f0ed8bbae4abea224c11c7023cf741d4bc3bd848fb5d84467cda9',
    fileStem: '9700_s25_qp_13',
    questionNumber: '12',
    page: 6,
    qpBounds: [0.06, 0.595, 0.94, 0.88],
    visualBounds: [[0.10, 0.73, 0.53, 0.88]],
    correctOption: 'A',
    syllabusPointIds: [points.proteinLevels, points.proteinInteractions],
    ocrText: 'Which bonds maintain secondary and tertiary protein structure? 1 disulfide; 2 hydrogen; 3 ionic. A secondary 2 only, tertiary 1,2,3; B both 2,3; C both 1,3; D secondary 1,2,3 and tertiary 1 only.',
  },
])

const replacementStage2Selections = Object.freeze([
  {
    jobKey: 'a8e05585fe52edffb3bdba0bea52a3cd481c890becd86e820f6bb58a6949f88f',
    fileStem: '9700_s25_qp_14',
    questionNumber: '13',
    page: 6,
    qpBounds: [0.06, 0.60, 0.94, 0.86],
    visualBounds: [[0.10, 0.68, 0.55, 0.84]],
    correctOption: 'A',
    syllabusPointIds: [points.water],
    ocrText: 'Detergent disrupts hydrogen bonds between water molecules. Which effects are correct? A specific heat capacity decreases and latent heat of vaporisation decreases; B decreases and increases; C increases and decreases; D both increase.',
  },
])

const selections = replacementStage2 ? replacementStage2Selections : replacementBatch ? replacementSelections : primarySelections

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
    reviewNote: `Current Codex directly inspected original ${qp.fileName} page ${selection.page} and ${ms.fileName} page 2. Whole Q${selection.questionNumber}, all A-D options, retained visuals, key ${selection.correctOption}, 1 mark and direct chapter 2 outcomes were confirmed. This is one AI source review only; no human, teacher, second-provider or publication claim.`,
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
  assert.equal(syllabus.points.length, 23)
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
    batchKind: replacementStage2 ? 'replacement-stage-2' : replacementBatch ? 'replacement-candidates' : 'initial-candidates',
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
