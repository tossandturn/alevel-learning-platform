import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  AI_INDEPENDENT_SOURCE_REVIEW_SCHEMA_VERSION,
  buildAiStudentStudyRelease,
  hasValidAiStudentStudyRelease,
  independentSourceReviewBindingSha256,
} from './ai-pdf-ingestion/contract.mjs'
import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'

const ROUTE_ID = 'cie-9700-as-biology'
const TOPIC_ID = '9700-as-topic-04'
const CORRECTED_ID = 'cie-9700-9700_s25_qp_12:q20'
const CORRECTED_PAGE_SHA256 = 'aa56d92bafd98b136fde78ed7c5e0fbae4e249e1713570c9df2dd3660672348e'
const SUPERSEDED_PAGE_SHA256 = 'fa5ae4d1559d7d2bb46e7ecfd4c366c2fe6cca1a99d16dded3cd7f1a16b18526'
const SOURCE_PDF_SHA256 = 'e6f95f47e51486f404ff5636d5dbfe9bd0e0dc3aebf4a13a0b8f358cfdd20461'
const LIBRARY_ROOT = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')
const OLD_ARTIFACT_ROOT = path.resolve('data/ai-pdf-ingestion/chapter-ready-9700-as-cell-membranes-qwen-20261005-v1')
const OUTPUT_ROOT = path.resolve('data/ai-pdf-ingestion/chapter-ready-9700-as-cell-membranes-qwen-20261005-v2')
const OLD_PROMOTION_ROOT = path.resolve('.candidate-evidence/9700-as-cell-membranes-promotion-20261005-v1')
const OLD_PROMOTION_SUMMARY = path.join(OLD_PROMOTION_ROOT, 'promotion-summary.json')
const EVIDENCE_ROOT = path.resolve('.candidate-evidence/9700-as-cell-membranes-promotion-20261005-v2')
const PAGE_CACHE_ROOT = path.join(EVIDENCE_ROOT, 'page-cache')
const PRIMARY_ROOT = path.resolve('.candidate-evidence/9700-as-cell-membranes-glyphfix-primary-20261005-v1')
const INITIAL_REVIEW_ROOT = path.resolve('.candidate-evidence/9700-as-cell-membranes-glyphfix-qwen-20261005-v1')
const FOLLOWUP_REVIEW_ROOT = path.resolve('.candidate-evidence/9700-as-cell-membranes-glyphfix-qwen-20261005-followup1')
const PRESERVED_IDS = Object.freeze([
  'cie-9700-9700_s25_qp_11:q17',
  'cie-9700-9700_s25_qp_11:q18',
  'cie-9700-9700_s25_qp_12:q19',
  'cie-9700-9700_s25_qp_14:q17',
  'cie-9700-9700_s25_qp_14:q18',
])
const EXPECTED_IDS = Object.freeze([...PRESERVED_IDS, CORRECTED_ID])

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function sha256File(file) { return sha256(fs.readFileSync(file)) }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function artifactFiles(root) {
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /^q\d+\.json$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name)).sort()
}
function artifactsBySourceId(root) {
  return new Map(artifactFiles(root).map((file) => {
    const artifact = readJson(file)
    return [artifact.candidate.questions[0].sourceQuestionId, { file, artifact }]
  }))
}
function localEvidencePath(originalPath) {
  const normalized = String(originalPath || '').replaceAll('\\', '/')
  const marker = '/.candidate-evidence/'
  const index = normalized.indexOf(marker)
  if (index < 0) throw new Error(`Cannot localise evidence path: ${originalPath}`)
  return path.resolve(normalized.slice(index + 1))
}
function outputPathFor(artifact, sourceQuestionId) {
  return path.join(OUTPUT_ROOT, artifact.paperId, `${sourceQuestionId.split(':').at(-1)}.json`)
}
function copyExclusive(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL)
  assert.equal(sha256File(destination), sha256File(source))
}
function cachePage({ document, pdfSha256, sourcePage }) {
  assert.equal(sha256File(sourcePage.path), sourcePage.sha256)
  const directory = path.join(PAGE_CACHE_ROOT, pdfSha256)
  fs.mkdirSync(directory, { recursive: true })
  const destination = path.join(directory, `${sourcePage.page}-${sourcePage.sha256}.png`)
  if (!fs.existsSync(destination)) fs.copyFileSync(sourcePage.path, destination, fs.constants.COPYFILE_EXCL)
  assert.equal(sha256File(destination), sourcePage.sha256)
  return { document, pdfSha256, page: sourcePage.page, pageImageSha256: sourcePage.sha256, file: destination, bytes: fs.statSync(destination).size }
}
function selectedFreshReceipt() {
  const initialSummary = readJson(path.join(INITIAL_REVIEW_ROOT, 'summary.json'))
  assert.equal(initialSummary.callsExecuted, 1)
  assert.equal(initialSummary.results.length, 1)
  const summaries = [initialSummary]
  let root = INITIAL_REVIEW_ROOT
  if (initialSummary.status !== 'PASS_SECOND_MODEL_ALL_1') {
    const followupSummary = readJson(path.join(FOLLOWUP_REVIEW_ROOT, 'summary.json'))
    assert.equal(followupSummary.status, 'PASS_SECOND_MODEL_ALL_1')
    assert.equal(followupSummary.callsExecuted, 1)
    assert.equal(followupSummary.results.length, 1)
    summaries.push(followupSummary)
    root = FOLLOWUP_REVIEW_ROOT
  } else {
    assert.equal(fs.existsSync(FOLLOWUP_REVIEW_ROOT), false, 'clarification must not run after an initial pass')
  }
  const totalCalls = summaries.reduce((sum, summary) => sum + summary.callsExecuted, 0)
  assert.ok(totalCalls >= 1 && totalCalls <= 2)
  return {
    file: path.join(root, `${CORRECTED_ID.replaceAll(':', '--')}.json`),
    initialCalls: initialSummary.callsExecuted,
    clarificationCalls: summaries.length - 1,
    totalCalls,
  }
}
function independentReviewFromReceipt(artifact, reviewFile, receipt) {
  const review = {
    schemaVersion: AI_INDEPENDENT_SOURCE_REVIEW_SCHEMA_VERSION,
    decision: 'accept',
    provider: receipt.provider.name,
    model: receipt.provider.model,
    reviewedAt: fs.statSync(reviewFile).mtime.toISOString(),
    sourceQuestionId: receipt.sourceQuestionId,
    inputSha256: receipt.inputSha256,
    evidence: {
      questionPdfSha256: receipt.source.questionPdfSha256,
      markSchemePdfSha256: receipt.source.markSchemePdfSha256,
      qpCropSha256: receipt.source.qpCropSha256,
      msCropSha256: receipt.source.msCropSha256,
    },
    result: receipt.result,
  }
  review.bindingSha256 = independentSourceReviewBindingSha256({ ...artifact, independentReview: review })
  return review
}

function main() {
  if (fs.existsSync(OUTPUT_ROOT)) throw new Error(`Refuse to overwrite candidate artifact root: ${OUTPUT_ROOT}`)
  if (fs.existsSync(EVIDENCE_ROOT)) throw new Error(`Refuse to overwrite promotion evidence root: ${EVIDENCE_ROOT}`)
  const oldSummary = readJson(OLD_PROMOTION_SUMMARY)
  assert.equal(oldSummary.status, 'PASS_CANDIDATE_NOT_DEPLOYED')
  assert.equal(oldSummary.promotedArtifacts, 6)
  assert.equal(oldSummary.runtimeGroups, 6)
  const oldArtifacts = artifactsBySourceId(OLD_ARTIFACT_ROOT)
  assert.equal(oldArtifacts.size, 6)

  fs.mkdirSync(OUTPUT_ROOT, { recursive: true })
  fs.mkdirSync(PAGE_CACHE_ROOT, { recursive: true })
  const outputs = []
  const preservedArtifacts = []
  const fallbackReceipts = []
  for (const sourceQuestionId of PRESERVED_IDS) {
    const oldRecord = oldArtifacts.get(sourceQuestionId)
    assert.ok(oldRecord)
    const destination = outputPathFor(oldRecord.artifact, sourceQuestionId)
    copyExclusive(oldRecord.file, destination)
    const fileSha256 = sha256File(destination)
    preservedArtifacts.push({ sourceQuestionId, oldFile: oldRecord.file, newFile: destination, oldSha256: fileSha256, newSha256: fileSha256, byteIdentical: true, bytes: fs.statSync(destination).size })
    const oldOutput = oldSummary.outputs.find((output) => output.sourceQuestionId === sourceQuestionId)
    assert.ok(oldOutput)
    const receiptPath = localEvidencePath(oldOutput.reviewReceipt)
    assert.equal(sha256File(receiptPath), oldOutput.reviewReceiptSha256)
    const receipt = readJson(receiptPath)
    assert.equal(receipt.sourceQuestionId, sourceQuestionId)
    assert.equal(receipt.status, 'PASS_SECOND_MODEL')
    fallbackReceipts.push({ sourceQuestionId, receiptSourceQuestionId: receipt.sourceQuestionId, path: receiptPath, sha256: oldOutput.reviewReceiptSha256, status: receipt.status })
    outputs.push({ ...oldOutput, file: destination, sha256: fileSha256, preservation: 'byte-identical-v1', reviewReceipt: receiptPath })
  }

  const primarySummary = readJson(path.join(PRIMARY_ROOT, 'summary.json'))
  assert.equal(primarySummary.status, 'PASS_PRIMARY_REVIEW_PENDING_INDEPENDENT_PROVIDER')
  assert.equal(primarySummary.batchKind, 'glyph-correction-q20')
  assert.equal(primarySummary.questions, 1)
  assert.equal(primarySummary.runtimeGroups, 1)
  assert.equal(primarySummary.providerCalls, 0)
  const primaryRecord = primarySummary.results[0]
  assert.equal(primaryRecord.sourceQuestionId, CORRECTED_ID)
  assert.equal(primaryRecord.sourcePages.qp.sha256, CORRECTED_PAGE_SHA256)
  assert.equal(primaryRecord.sourcePages.qp.renderer, 'poppler-png')
  assert.equal(primaryRecord.sourcePages.qp.sourcePdfSha256, SOURCE_PDF_SHA256)
  const freshArtifactFile = primaryRecord.artifact.path
  const artifact = readJson(freshArtifactFile)
  assert.equal(sha256File(freshArtifactFile), primaryRecord.artifact.sha256)
  assert.equal(artifact.source.questionPdfSha256, SOURCE_PDF_SHA256)
  assert.equal(artifact.source.pageImageHashes['10'], CORRECTED_PAGE_SHA256)
  assert.equal(JSON.stringify(artifact).includes(SUPERSEDED_PAGE_SHA256), false)

  const receiptSelection = selectedFreshReceipt()
  const receipt = readJson(receiptSelection.file)
  assert.equal(receipt.status, 'PASS_SECOND_MODEL')
  assert.equal(receipt.comparison?.status, 'PASS_SECOND_MODEL')
  assert.equal(receipt.sourceQuestionId, CORRECTED_ID)
  assert.equal(receipt.provider?.name, 'qwen')
  assert.equal(receipt.provider?.model, 'qwen3-vl-plus')
  assert.equal(receipt.artifact?.sha256, sha256File(freshArtifactFile))
  assert.equal(receipt.artifact?.artifactId, artifact.artifactId)
  assert.equal(receipt.source.questionPageImageSha256, CORRECTED_PAGE_SHA256)
  assert.equal(receipt.source.questionPageRenderer, 'poppler-png')
  assert.equal(receipt.result?.decision, 'accept')
  assert.equal(receipt.result?.independentDerivedAnswer, 'D')
  assert.equal(receipt.result?.markSchemeAnswer, 'D')
  assert.ok(receipt.result?.conciseProof)
  artifact.independentReview = independentReviewFromReceipt(artifact, receiptSelection.file, receipt)
  artifact.studentRelease = buildAiStudentStudyRelease({ ...artifact, routeId: artifact.syllabusRouteId, independentReview: artifact.independentReview })
  assert.equal(hasValidAiStudentStudyRelease(artifact), true)
  assert.equal(artifact.studentRelease.review.independentPassCount, 2)
  assert.equal(artifact.studentRelease.review.method, 'single-model-plus-independent-source-review')
  assert.equal(artifact.studentRelease.formalProgressEligible, false)
  const correctedDestination = outputPathFor(artifact, CORRECTED_ID)
  fs.mkdirSync(path.dirname(correctedDestination), { recursive: true })
  fs.writeFileSync(correctedDestination, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  outputs.push({
    sourceQuestionId: CORRECTED_ID,
    artifactId: artifact.artifactId,
    file: correctedDestination,
    sha256: sha256File(correctedDestination),
    preservation: 'fresh-poppler-glyph-correction',
    reviewReceipt: receiptSelection.file,
    reviewReceiptSha256: sha256File(receiptSelection.file),
    primaryTopicId: artifact.candidate.questions[0].tags.primaryTopicId,
    syllabusPointIds: artifact.candidate.questions[0].tags.syllabusPointIds,
    independentPassCount: artifact.studentRelease.review.independentPassCount,
    formalProgressEligible: artifact.studentRelease.formalProgressEligible,
  })

  const cachedPages = new Map()
  for (const oldPage of oldSummary.cachedPages) {
    if (oldPage.pdfSha256 === SOURCE_PDF_SHA256 && oldPage.page === 10) continue
    const sourcePath = localEvidencePath(oldPage.file)
    assert.equal(sha256File(sourcePath), oldPage.pageImageSha256)
    const page = cachePage({
      document: oldPage.document,
      pdfSha256: oldPage.pdfSha256,
      sourcePage: { path: sourcePath, sha256: oldPage.pageImageSha256, page: oldPage.page },
    })
    cachedPages.set(`${page.pdfSha256}:${page.page}:${page.pageImageSha256}`, page)
  }
  for (const page of [
    cachePage({ document: 'qp', pdfSha256: artifact.source.questionPdfSha256, sourcePage: primaryRecord.sourcePages.qp }),
    cachePage({ document: 'ms', pdfSha256: artifact.source.markSchemePdfSha256, sourcePage: primaryRecord.sourcePages.ms }),
  ]) cachedPages.set(`${page.pdfSha256}:${page.page}:${page.pageImageSha256}`, page)
  const pageList = [...cachedPages.values()].sort((left, right) => left.file.localeCompare(right.file))
  assert.equal(pageList.length, 9)
  assert.ok(pageList.some((page) => page.pdfSha256 === SOURCE_PDF_SHA256 && page.page === 10 && page.pageImageSha256 === CORRECTED_PAGE_SHA256))
  assert.ok(pageList.every((page) => page.pageImageSha256 !== SUPERSEDED_PAGE_SHA256))

  const groups = createAiVerifiedQuestionBankLoader({ artifactRoot: OUTPUT_ROOT, libraryRoot: LIBRARY_ROOT })().groups
  assert.equal(groups.length, 6)
  assert.deepEqual(groups.map((group) => group.sourceQuestionId).sort(), [...EXPECTED_IDS].sort())
  assert.equal(new Set(groups.map((group) => group.sourceQuestionId)).size, 6)
  assert.ok(groups.every((group) => group.parts.length > 0 && group.studentStudyEligible === true && group.formalProgressEligible === false))
  const glyphCorrectionProviderBudget = {
    maximumCalls: 2,
    initialCalls: receiptSelection.initialCalls,
    clarificationCalls: receiptSelection.clarificationCalls,
    totalCalls: receiptSelection.totalCalls,
    stoppedAfterPass: true,
  }
  const summary = {
    schemaVersion: 'chapter-ready-promotion-summary.v2',
    status: 'PASS_CANDIDATE_NOT_DEPLOYED',
    routeId: ROUTE_ID,
    topicId: TOPIC_ID,
    promotedArtifacts: outputs.length,
    preservedArtifacts: preservedArtifacts.length,
    correctedArtifacts: 1,
    runtimeGroups: groups.length,
    studentStudyEligible: true,
    releaseEligible: true,
    formalProgressEligible: false,
    minimumChapterStudyGroups: 1,
    legacyTopicDrillMinimumGroups: 6,
    formalReadyGroups: 12,
    glyphCorrectionProviderBudget,
    originalPromotionSummary: { path: OLD_PROMOTION_SUMMARY, sha256: sha256File(OLD_PROMOTION_SUMMARY), status: oldSummary.status },
    outputRoot: OUTPUT_ROOT,
    outputs: outputs.sort((left, right) => left.sourceQuestionId.localeCompare(right.sourceQuestionId)),
    cachedPages: pageList,
  }
  const summaryPath = path.join(EVIDENCE_ROOT, 'promotion-summary.json')
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  const acceptance = {
    schemaVersion: 'chapter-ready-glyphfix-root-acceptance.v1',
    status: 'PASS_ROOT_ACCEPTANCE_CANDIDATE_NOT_DEPLOYED',
    routeId: ROUTE_ID,
    topicId: TOPIC_ID,
    uniqueQuestions: groups.length,
    nonEmptyArtifacts: outputs.length,
    duplicateSourceQuestionIds: [],
    preservedArtifacts,
    correctedQuestion: {
      sourceQuestionId: CORRECTED_ID,
      artifactFile: correctedDestination,
      artifactSha256: sha256File(correctedDestination),
      primaryArtifactFile: freshArtifactFile,
      primaryArtifactSha256: sha256File(freshArtifactFile),
      freshReviewReceipt: receiptSelection.file,
      freshReviewReceiptSha256: sha256File(receiptSelection.file),
      questionPdfSha256: SOURCE_PDF_SHA256,
      page: 10,
      pageImageSha256: CORRECTED_PAGE_SHA256,
      pageDimensions: [1488, 2105],
      renderer: 'poppler-png',
      diagramRegion: [148, 221, 1340, 653],
      answer: 'D',
      syllabusPointIds: ['biology-9700-2025-4-2-03', 'biology-9700-2025-4-2-04'],
    },
    fallbackReceipts,
    originalPromotionSummary: summary.originalPromotionSummary,
    cachedPages: { count: pageList.length, correctedPagePresent: true, supersededPagePresent: false },
    glyphCorrectionProviderBudget,
    studentStudyEligible: true,
    formalProgressEligible: false,
    productionModified: false,
  }
  const acceptancePath = path.join(EVIDENCE_ROOT, 'root-acceptance.json')
  fs.writeFileSync(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ ...summary, summaryPath, acceptancePath }))
}

try { main() } catch (error) {
  console.error(JSON.stringify({ status: 'BLOCKED_GLYPHFIX_PROMOTION', error: String(error?.message || error).slice(0, 400) }))
  process.exitCode = 1
}
