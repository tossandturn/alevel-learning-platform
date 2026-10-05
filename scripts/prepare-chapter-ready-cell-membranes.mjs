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
import { renderCandidateSourcePage } from './chapter-ready-source-page-renderer.mjs'

const WORK_ROOT = path.resolve('D:/CodexWork/stem-ocr-work')
const LIBRARY_ROOT = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')
const GLYPH_FIX_MODE = process.argv.includes('--glyphfix-q20')
const OUTPUT_ROOT = path.resolve(GLYPH_FIX_MODE
  ? '.candidate-evidence/9700-as-cell-membranes-glyphfix-primary-20261005-v1'
  : '.candidate-evidence/9700-as-cell-membranes-primary-20261005-v2')
const ARTIFACT_ROOT = path.join(OUTPUT_ROOT, 'artifacts')
const CROP_ROOT = path.join(OUTPUT_ROOT, 'crops')
const RENDERED_SOURCE_ROOT = path.join(OUTPUT_ROOT, 'source-pages')
const PYTHON = 'C:/Users/10604/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
const EXTRACT_WORDS = path.resolve('scripts/chapter-ready-extract-pdf-words.py')
const CROP_IMAGE = path.resolve('scripts/chapter-ready-crop-image.py')
const SYLLABUS_SOURCE = path.resolve('src/data/syllabus/biology-9700-as-cell-membranes-source.json')
const ROUTE_ID = 'cie-9700-as-biology'
const TOPIC_ID = '9700-as-topic-04'

const points = Object.freeze({
  fluidMosaic: 'biology-9700-2025-4-1-01',
  componentRoles: 'biology-9700-2025-4-1-03',
  surfaceAreaVolume: 'biology-9700-2025-4-2-03',
  diffusionSurfaceArea: 'biology-9700-2025-4-2-04',
  plantWaterPotentialInvestigation: 'biology-9700-2025-4-2-05',
  waterPotentialEffects: 'biology-9700-2025-4-2-06',
})

const primarySelections = Object.freeze([
  {
    jobKey: 'd2a2b02338ea66ce3f9bd332c5e6a51140ab358917531ef8f1b613221870f6db',
    fileStem: '9700_s25_qp_11',
    questionNumber: '17',
    page: 7,
    qpBounds: [0.06, 0.65, 0.94, 0.88],
    visualBounds: [],
    correctOption: 'D',
    syllabusPointIds: [points.fluidMosaic],
    ocrText: 'The cell surface membrane structure is described as a fluid mosaic. What correctly describes the mosaic part? A patterns from moving phospholipids; B random cholesterol distribution; C regular phospholipid-head and protein pattern; D scattering of different proteins within the phospholipid bilayer.',
  },
  {
    jobKey: 'd2a2b02338ea66ce3f9bd332c5e6a51140ab358917531ef8f1b613221870f6db',
    fileStem: '9700_s25_qp_11',
    questionNumber: '18',
    page: 8,
    qpBounds: [0.06, 0.06, 0.94, 0.37],
    visualBounds: [],
    correctOption: 'B',
    syllabusPointIds: [points.waterPotentialEffects],
    ocrText: 'Plant tissue cells placed in solution S lost water and the cytoplasm pulled away from the cell wall. Which conclusions are correct? 1 solution S initially had a more negative water potential than the cytoplasm; 2 without a supporting cell wall many cells would likely have burst; 3 the space between cell wall and cytoplasm was filled with air. A 1 and 3; B 1 only; C 2 and 3; D 2 only.',
  },
  {
    jobKey: 'aa8c942479248e3e118f2b885751543c58c8eb35ba7ee8d7f7dafb315c98b8af',
    fileStem: '9700_s25_qp_12',
    questionNumber: '17',
    page: 8,
    qpBounds: [0.06, 0.06, 0.94, 0.30],
    visualBounds: [],
    correctOption: 'A',
    syllabusPointIds: [points.componentRoles],
    ocrText: 'How do bacteria and yeast maintain membrane fluidity when temperature decreases? 1 increase unsaturated fatty acids in phospholipids; 2 increase saturated fatty acids; 3 increase cholesterol. A 1 and 3; B 1 only; C 2 and 3; D 2 only.',
  },
  {
    jobKey: 'aa8c942479248e3e118f2b885751543c58c8eb35ba7ee8d7f7dafb315c98b8af',
    fileStem: '9700_s25_qp_12',
    questionNumber: '18',
    page: 8,
    qpBounds: [0.06, 0.30, 0.94, 0.94],
    visualBounds: [[0.10, 0.44, 0.91, 0.57], [0.095, 0.585, 0.905, 0.755], [0.10, 0.785, 0.44, 0.93]],
    correctOption: 'D',
    syllabusPointIds: [points.plantWaterPotentialInvestigation, points.waterPotentialEffects],
    ocrText: 'Onion epidermal tissues X, Y and Z were immersed in salt solutions. A concentration scale P-Q-R and three photomicrographs show the tissues. Which row gives the estimated concentrations for samples Y and Z? A P,Q; B P,R; C Q,R; D R,P.',
  },
  {
    jobKey: 'aa8c942479248e3e118f2b885751543c58c8eb35ba7ee8d7f7dafb315c98b8af',
    fileStem: '9700_s25_qp_12',
    questionNumber: '19',
    page: 9,
    qpBounds: [0.06, 0.06, 0.94, 0.59],
    visualBounds: [[0.18, 0.10, 0.80, 0.40]],
    correctOption: 'A',
    syllabusPointIds: [points.plantWaterPotentialInvestigation, points.waterPotentialEffects],
    ocrText: 'An osmosis graph for potato tissue plots percentage change in mass against sodium chloride concentration. What concentration has equivalent water potential to the tissue and what is the net water movement? A 0.37 mol dm-3 and no net movement; B 17 mol dm-3 and water out; C 0 mol dm-3 and no net movement; D 0.9 mol dm-3 and water in.',
  },
  {
    jobKey: 'aa8c942479248e3e118f2b885751543c58c8eb35ba7ee8d7f7dafb315c98b8af',
    fileStem: '9700_s25_qp_12',
    questionNumber: '20',
    page: 10,
    qpBounds: [0.06, 0.06, 0.94, 0.46],
    visualBounds: [[0.10, 0.105, 0.90, 0.31]],
    correctOption: 'D',
    syllabusPointIds: [points.surfaceAreaVolume, points.diffusionSurfaceArea],
    ocrText: 'Pink indicator agar cubes measuring 2 cm, 4 cm and 5 cm per side were covered with hydrochloric acid. Which surface-area-to-volume ratio belongs to the cube that became colourless fastest? A 0.33:1; B 0.83:1; C 1.2:1; D 3.0:1.',
  },
])
const selections = GLYPH_FIX_MODE
  ? Object.freeze([Object.freeze({
      ...primarySelections.find((selection) => selection.questionNumber === '20'),
      sourcePageRenderer: Object.freeze({
        renderer: 'poppler-png',
        dpi: 180,
        expectedPdfSha256: 'e6f95f47e51486f404ff5636d5dbfe9bd0e0dc3aebf4a13a0b8f358cfdd20461',
        expectedImageSha256: 'aa56d92bafd98b136fde78ed7c5e0fbae4e249e1713570c9df2dd3660672348e',
        expectedWidth: 1488,
        expectedHeight: 2105,
      }),
    })])
  : primarySelections

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
  const originalQpPage = qp.document.pages[String(selection.page)].sourcePage
  const msPage = ms.document.pages['2'].sourcePage
  const qpPage = selection.sourcePageRenderer
    ? renderCandidateSourcePage({
        ...selection.sourcePageRenderer,
        pdfPath: qp.pdfPath,
        page: selection.page,
        outputRoot: RENDERED_SOURCE_ROOT,
      })
    : originalQpPage
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
    status: GLYPH_FIX_MODE ? 'source-reviewed-local-prepared-glyph-corrected' : 'source-reviewed-local-prepared',
    studentStudyEligible: true,
    studentRelease: true,
    scope: GLYPH_FIX_MODE
      ? 'Fresh current Codex source review; the unchanged official PDF page was rerendered through Poppler at 180 dpi, and exact QP/MS, whole question, multiplication signs, options, answer and geometry were inspected. Independent provider verification pending.'
      : 'One current Codex source review; exact QP/MS, whole question, options, answer and geometry inspected. Independent provider verification pending.',
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
      pageRenderers: { [selection.page]: qpPage.renderer || 'paddle-source-page' },
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
    reviewNote: GLYPH_FIX_MODE
      ? `Current Codex directly inspected the unchanged original ${qp.fileName} page ${selection.page}, freshly rerendered through Poppler at 180 dpi, and ${ms.fileName} page 2. Whole Q${selection.questionNumber}, all three cubes, all dimension labels and multiplication signs, all A-D options, independently derived key ${selection.correctOption}, 1 mark and direct outcomes 4.2.3 and 4.2.4 were confirmed. This is one fresh AI source review only; no human, teacher, second-provider or publication claim.`
      : `Current Codex directly inspected original ${qp.fileName} page ${selection.page} and ${ms.fileName} page 2. Whole Q${selection.questionNumber}, all A-D options, retained visuals, key ${selection.correctOption}, 1 mark and direct chapter 4 outcomes were confirmed. This is one AI source review only; no human, teacher, second-provider or publication claim.`,
    evidence: [
      { document: 'qp', page: selection.page, pageImageSha256: qpPage.sha256, renderer: qpPage.renderer || 'paddle-source-page' },
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
  assert.equal(syllabus.points.length, 10)
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
    batchKind: GLYPH_FIX_MODE ? 'glyph-correction-q20' : 'initial-candidates',
    routeId: ROUTE_ID,
    topicId: TOPIC_ID,
    questions: results.length,
    runtimeGroups: groups.length,
    studentStudyEligible: true,
    formalProgressEligible: false,
    providerCalls: 0,
    ...(GLYPH_FIX_MODE ? {
      sourcePageRenderer: {
        renderer: 'poppler-png',
        page: 10,
        dpi: 180,
        imageSha256: results[0].sourcePages.qp.sha256,
        dimensions: [results[0].sourcePages.qp.width, results[0].sourcePages.qp.height],
      },
    } : {}),
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
