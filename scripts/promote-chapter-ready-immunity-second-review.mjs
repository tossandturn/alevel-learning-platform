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
const TOPIC_ID = '9700-as-topic-11'
const geometryFixV2 = process.argv.includes('--q40-geometry-fix-v2')
const BASELINE_OUTPUT_ROOT = path.resolve('data/ai-pdf-ingestion/chapter-ready-9700-as-immunity-qwen-20261004-v1')
const OUTPUT_ROOT = path.resolve(geometryFixV2
  ? 'data/ai-pdf-ingestion/chapter-ready-9700-as-immunity-qwen-20261005-v2'
  : 'data/ai-pdf-ingestion/chapter-ready-9700-as-immunity-qwen-20261004-v1')
const EVIDENCE_ROOT = path.resolve(geometryFixV2
  ? '.candidate-evidence/9700-as-immunity-promotion-20261005-v2'
  : '.candidate-evidence/9700-as-immunity-promotion-20261004-v1')
const PAGE_CACHE_ROOT = path.join(EVIDENCE_ROOT, 'page-cache')
const LIBRARY_ROOT = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')
const INITIAL_PRIMARY = path.resolve('.candidate-evidence/9700-as-immunity-primary-20261004-v2')
const INITIAL_REVIEW = path.resolve('.candidate-evidence/9700-as-immunity-qwen-20261004-v1')
const INITIAL_FOLLOWUP = path.resolve('.candidate-evidence/9700-as-immunity-qwen-20261004-followup1')
const REPLACEMENT_PRIMARY = path.resolve('.candidate-evidence/9700-as-immunity-replacement-primary-20261004-v1')
const REPLACEMENT_REVIEW = path.resolve('.candidate-evidence/9700-as-immunity-replacement-qwen-20261004-v1')
const GEOMETRY_PRIMARY = path.resolve('.candidate-evidence/9700-as-immunity-q40-geometry-primary-20261005-v1')
const GEOMETRY_REVIEW = path.resolve('.candidate-evidence/9700-as-immunity-q40-geometry-qwen-20261005-v1')
const GEOMETRY_SOURCE_QUESTION_ID = 'cie-9700-9700_s25_qp_12:q40'

const selections = Object.freeze([
  Object.freeze({ sourceQuestionId: 'cie-9700-9700_s25_qp_11:q40', primaryRoot: INITIAL_PRIMARY, reviewRoot: INITIAL_REVIEW }),
  Object.freeze({ sourceQuestionId: 'cie-9700-9700_s25_qp_13:q36', primaryRoot: INITIAL_PRIMARY, reviewRoot: INITIAL_REVIEW }),
  Object.freeze({ sourceQuestionId: 'cie-9700-9700_s25_qp_14:q40', primaryRoot: INITIAL_PRIMARY, reviewRoot: INITIAL_REVIEW }),
  Object.freeze({
    sourceQuestionId: GEOMETRY_SOURCE_QUESTION_ID,
    primaryRoot: geometryFixV2 ? GEOMETRY_PRIMARY : INITIAL_PRIMARY,
    reviewRoot: geometryFixV2 ? GEOMETRY_REVIEW : INITIAL_FOLLOWUP,
  }),
  Object.freeze({ sourceQuestionId: 'cie-9700-9700_s25_qp_13:q39', primaryRoot: INITIAL_PRIMARY, reviewRoot: INITIAL_FOLLOWUP }),
  Object.freeze({ sourceQuestionId: 'cie-9700-9700_s25_qp_13:q38', primaryRoot: REPLACEMENT_PRIMARY, reviewRoot: REPLACEMENT_REVIEW }),
])

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}
function sha256File(file) { return sha256(fs.readFileSync(file)) }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }
function artifactFiles(root) {
  return fs.readdirSync(path.join(root, 'artifacts'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(entry.parentPath, entry.name)).sort()
}
function sourceArtifact(selection) {
  const matches = artifactFiles(selection.primaryRoot).map((file) => ({ file, artifact: readJson(file) }))
    .filter(({ artifact }) => artifact.candidate.questions[0].sourceQuestionId === selection.sourceQuestionId)
  assert.equal(matches.length, 1)
  return matches[0]
}
function primaryRecord(selection) {
  const matches = readJson(path.join(selection.primaryRoot, 'summary.json')).results
    .filter((record) => record.sourceQuestionId === selection.sourceQuestionId)
  assert.equal(matches.length, 1)
  return matches[0]
}
function receiptPath(selection) {
  return path.join(selection.reviewRoot, `${selection.sourceQuestionId.replaceAll(':', '--')}.json`)
}
function independentReviewFromReceipt(artifact, reviewFile, receipt) {
  const review = {
    schemaVersion: AI_INDEPENDENT_SOURCE_REVIEW_SCHEMA_VERSION,
    decision: 'accept', provider: receipt.provider.name, model: receipt.provider.model,
    reviewedAt: fs.statSync(reviewFile).mtime.toISOString(),
    sourceQuestionId: receipt.sourceQuestionId, inputSha256: receipt.inputSha256,
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
function cachePage({ document, pdfSha256, sourcePage }) {
  assert.equal(sha256File(sourcePage.path), sourcePage.sha256)
  const directory = path.join(PAGE_CACHE_ROOT, pdfSha256)
  fs.mkdirSync(directory, { recursive: true })
  const destination = path.join(directory, `${sourcePage.page}-${sourcePage.sha256}.png`)
  if (!fs.existsSync(destination)) fs.copyFileSync(sourcePage.path, destination, fs.constants.COPYFILE_EXCL)
  assert.equal(sha256File(destination), sourcePage.sha256)
  return { document, pdfSha256, page: sourcePage.page, pageImageSha256: sourcePage.sha256, file: destination, bytes: fs.statSync(destination).size }
}
function outputPathFor(artifact, sourceQuestionId) {
  return path.join(OUTPUT_ROOT, artifact.paperId, `${sourceQuestionId.split(':').at(-1)}.json`)
}
function baselinePathFor(artifact, sourceQuestionId) {
  return path.join(BASELINE_OUTPUT_ROOT, artifact.paperId, `${sourceQuestionId.split(':').at(-1)}.json`)
}

function main() {
  if (fs.existsSync(OUTPUT_ROOT)) throw new Error(`Refuse to overwrite candidate artifact root: ${OUTPUT_ROOT}`)
  if (fs.existsSync(EVIDENCE_ROOT)) throw new Error(`Refuse to overwrite promotion evidence root: ${EVIDENCE_ROOT}`)
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true })
  fs.mkdirSync(PAGE_CACHE_ROOT, { recursive: true })
  const outputs = []
  const cachedPages = new Map()
  for (const selection of selections) {
    const { file: sourceFile, artifact: originalArtifact } = sourceArtifact(selection)
    const record = primaryRecord(selection)
    if (geometryFixV2 && selection.sourceQuestionId !== GEOMETRY_SOURCE_QUESTION_ID) {
      const artifact = readJson(baselinePathFor(originalArtifact, selection.sourceQuestionId))
      const source = baselinePathFor(artifact, selection.sourceQuestionId)
      const destination = outputPathFor(artifact, selection.sourceQuestionId)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL)
      assert.equal(sha256File(destination), sha256File(source), `${selection.sourceQuestionId} must remain byte-identical to v1.`)
      const pages = [
        cachePage({ document: 'qp', pdfSha256: artifact.source.questionPdfSha256, sourcePage: record.sourcePages.qp }),
        cachePage({ document: 'ms', pdfSha256: artifact.source.markSchemePdfSha256, sourcePage: record.sourcePages.ms }),
      ]
      for (const page of pages) cachedPages.set(`${page.pdfSha256}:${page.page}:${page.pageImageSha256}`, page)
      outputs.push({
        sourceQuestionId: selection.sourceQuestionId, artifactId: artifact.artifactId,
        file: destination, sha256: sha256File(destination), preservedFrom: source,
        primaryTopicId: artifact.candidate.questions[0].tags.primaryTopicId,
        syllabusPointIds: artifact.candidate.questions[0].tags.syllabusPointIds,
        independentPassCount: artifact.studentRelease.review.independentPassCount,
        formalProgressEligible: artifact.studentRelease.formalProgressEligible,
      })
      continue
    }
    const artifact = structuredClone(originalArtifact)
    const reviewFile = receiptPath(selection)
    const receipt = readJson(reviewFile)
    assert.equal(receipt.status, 'PASS_SECOND_MODEL')
    assert.equal(receipt.comparison?.status, 'PASS_SECOND_MODEL')
    assert.equal(receipt.sourceQuestionId, selection.sourceQuestionId)
    assert.equal(receipt.provider?.name, 'qwen')
    assert.equal(receipt.provider?.model, 'qwen3-vl-plus')
    assert.equal(receipt.artifact?.sha256, sha256File(sourceFile))
    assert.equal(receipt.artifact?.artifactId, artifact.artifactId)
    assert.equal(receipt.result?.decision, 'accept')
    const independentReview = independentReviewFromReceipt(artifact, reviewFile, receipt)
    artifact.independentReview = independentReview
    artifact.studentRelease = buildAiStudentStudyRelease({ ...artifact, routeId: artifact.syllabusRouteId, independentReview })
    assert.equal(hasValidAiStudentStudyRelease(artifact), true)
    assert.equal(artifact.studentRelease.review.independentPassCount, 2)
    assert.equal(artifact.studentRelease.review.method, 'single-model-plus-independent-source-review')
    assert.equal(artifact.studentRelease.formalProgressEligible, false)
    const destination = outputPathFor(artifact, selection.sourceQuestionId)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    const pages = [
      cachePage({ document: 'qp', pdfSha256: artifact.source.questionPdfSha256, sourcePage: record.sourcePages.qp }),
      cachePage({ document: 'ms', pdfSha256: artifact.source.markSchemePdfSha256, sourcePage: record.sourcePages.ms }),
    ]
    for (const page of pages) cachedPages.set(`${page.pdfSha256}:${page.page}:${page.pageImageSha256}`, page)
    outputs.push({
      sourceQuestionId: selection.sourceQuestionId, artifactId: artifact.artifactId,
      file: destination, sha256: sha256File(destination), reviewReceipt: reviewFile,
      reviewReceiptSha256: sha256File(reviewFile), primaryTopicId: artifact.candidate.questions[0].tags.primaryTopicId,
      syllabusPointIds: artifact.candidate.questions[0].tags.syllabusPointIds,
      independentPassCount: artifact.studentRelease.review.independentPassCount,
      formalProgressEligible: artifact.studentRelease.formalProgressEligible,
    })
  }
  const groups = createAiVerifiedQuestionBankLoader({ artifactRoot: OUTPUT_ROOT, libraryRoot: LIBRARY_ROOT })().groups
  assert.equal(groups.length, 6)
  assert.equal(new Set(groups.map((group) => group.sourceQuestionId)).size, 6)
  assert.ok(groups.every((group) => group.routeId === ROUTE_ID && group.knowledgeGroupId === TOPIC_ID
    && group.paperComponent === 1 && group.studentStudyEligible === true && group.formalProgressEligible === false
    && group.parts.every((part) => part.answerKey == null)))
  const summary = {
    schemaVersion: geometryFixV2 ? 'chapter-ready-promotion-summary.v2' : 'chapter-ready-promotion-summary.v1', status: 'PASS_CANDIDATE_NOT_DEPLOYED',
    routeId: ROUTE_ID, topicId: TOPIC_ID, promotedArtifacts: outputs.length, runtimeGroups: groups.length,
    studentStudyEligible: true, formalProgressEligible: false, minimumStartGroups: 6, formalReadyGroups: 12,
    geometryFix: geometryFixV2 ? {
      sourceQuestionId: GEOMETRY_SOURCE_QUESTION_ID,
      independentlyReverified: true,
      preservedArtifactCount: outputs.filter((output) => output.preservedFrom).length,
    } : null,
    outputRoot: OUTPUT_ROOT, outputs,
    cachedPages: [...cachedPages.values()].sort((left, right) => left.file.localeCompare(right.file)),
  }
  const summaryPath = path.join(EVIDENCE_ROOT, 'promotion-summary.json')
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ ...summary, summaryPath }))
}

try { main() } catch (error) {
  console.error(JSON.stringify({ status: 'BLOCKED_PROMOTION', error: String(error?.message || error).slice(0, 400) }))
  process.exitCode = 1
}
