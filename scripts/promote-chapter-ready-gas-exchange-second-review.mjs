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
const TOPIC_ID = '9700-as-topic-09'
const OUTPUT_ROOT = path.resolve('data/ai-pdf-ingestion/chapter-ready-9700-as-gas-exchange-qwen-20261004-v1')
const EVIDENCE_ROOT = path.resolve('.candidate-evidence/9700-as-gas-exchange-promotion-20261004-v1')
const PAGE_CACHE_ROOT = path.join(EVIDENCE_ROOT, 'page-cache')
const LIBRARY_ROOT = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')

const batches = Object.freeze({
  initial: Object.freeze({
    primaryRoot: path.resolve('.candidate-evidence/9700-as-gas-exchange-primary-20261004-v2'),
    initialReviewRoot: path.resolve('.candidate-evidence/9700-as-gas-exchange-qwen-20261004-v1'),
  }),
  replacement: Object.freeze({
    primaryRoot: path.resolve('.candidate-evidence/9700-as-gas-exchange-replacement-primary-20261004-v1'),
    initialReviewRoot: path.resolve('.candidate-evidence/9700-as-gas-exchange-replacement-qwen-20261004-v1'),
    followupReviewRoot: path.resolve('.candidate-evidence/9700-as-gas-exchange-replacement-qwen-20261004-followup1'),
  }),
  reserve: Object.freeze({
    primaryRoot: path.resolve('.candidate-evidence/9700-as-gas-exchange-reserve-primary-20261004-v1'),
    initialReviewRoot: path.resolve('.candidate-evidence/9700-as-gas-exchange-reserve-qwen-20261004-v1'),
  }),
})

const selections = Object.freeze([
  Object.freeze({ sourceQuestionId: 'cie-9700-9700_s25_qp_11:q33', batch: 'initial', reviewPass: 'initial' }),
  Object.freeze({ sourceQuestionId: 'cie-9700-9700_s25_qp_11:q34', batch: 'initial', reviewPass: 'initial' }),
  Object.freeze({ sourceQuestionId: 'cie-9700-9700_s25_qp_12:q36', batch: 'initial', reviewPass: 'initial' }),
  Object.freeze({ sourceQuestionId: 'cie-9700-9700_s25_qp_13:q34', batch: 'replacement', reviewPass: 'followup' }),
  Object.freeze({ sourceQuestionId: 'cie-9700-9700_w24_qp_13:q36', batch: 'replacement', reviewPass: 'initial' }),
  Object.freeze({ sourceQuestionId: 'cie-9700-9700_w24_qp_11:q34', batch: 'reserve', reviewPass: 'initial' }),
])

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function sha256File(file) {
  return sha256(fs.readFileSync(file))
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function artifactFiles(root) {
  return fs.readdirSync(path.join(root, 'artifacts'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
}

function sourceQuestionIdFromArtifact(artifact) {
  return artifact.candidate.questions[0].sourceQuestionId
}

function sourceArtifact(selection) {
  const config = batches[selection.batch]
  const matches = artifactFiles(config.primaryRoot)
    .map((file) => ({ file, artifact: readJson(file) }))
    .filter(({ artifact }) => sourceQuestionIdFromArtifact(artifact) === selection.sourceQuestionId)
  assert.equal(matches.length, 1, `Expected one primary artifact for ${selection.sourceQuestionId}.`)
  return matches[0]
}

function primaryRecord(selection) {
  const config = batches[selection.batch]
  const summary = readJson(path.join(config.primaryRoot, 'summary.json'))
  const matches = summary.results.filter((record) => record.sourceQuestionId === selection.sourceQuestionId)
  assert.equal(matches.length, 1, `Expected one primary evidence record for ${selection.sourceQuestionId}.`)
  return matches[0]
}

function receiptPath(selection) {
  const config = batches[selection.batch]
  const root = selection.reviewPass === 'followup' ? config.followupReviewRoot : config.initialReviewRoot
  assert.ok(root, `Missing ${selection.reviewPass} receipt root for ${selection.sourceQuestionId}.`)
  return path.join(root, `${selection.sourceQuestionId.replaceAll(':', '--')}.json`)
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

function cachePage({ document, pdfSha256, sourcePage }) {
  assert.equal(sha256File(sourcePage.path), sourcePage.sha256, `Source page hash mismatch for ${sourcePage.path}.`)
  const directory = path.join(PAGE_CACHE_ROOT, pdfSha256)
  fs.mkdirSync(directory, { recursive: true })
  const destination = path.join(directory, `${sourcePage.page}-${sourcePage.sha256}.png`)
  if (!fs.existsSync(destination)) fs.copyFileSync(sourcePage.path, destination, fs.constants.COPYFILE_EXCL)
  assert.equal(sha256File(destination), sourcePage.sha256, `Cached ${document} page hash mismatch.`)
  return {
    document,
    pdfSha256,
    page: sourcePage.page,
    pageImageSha256: sourcePage.sha256,
    file: destination,
    bytes: fs.statSync(destination).size,
  }
}

function outputPathFor(artifact, sourceQuestionId) {
  return path.join(OUTPUT_ROOT, artifact.paperId, `${sourceQuestionId.split(':').at(-1)}.json`)
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
    const artifact = structuredClone(originalArtifact)
    const record = primaryRecord(selection)
    const reviewFile = receiptPath(selection)
    const receipt = readJson(reviewFile)
    assert.equal(receipt.status, 'PASS_SECOND_MODEL', `Independent review held ${selection.sourceQuestionId}.`)
    assert.equal(receipt.comparison?.status, 'PASS_SECOND_MODEL')
    assert.equal(receipt.sourceQuestionId, selection.sourceQuestionId)
    assert.equal(receipt.provider?.name, 'qwen')
    assert.equal(receipt.provider?.model, 'qwen3-vl-plus')
    assert.equal(receipt.artifact?.sha256, sha256File(sourceFile), `Receipt artifact hash mismatch for ${selection.sourceQuestionId}.`)
    assert.equal(receipt.artifact?.artifactId, artifact.artifactId)

    const independentReview = independentReviewFromReceipt(artifact, reviewFile, receipt)
    artifact.independentReview = independentReview
    artifact.studentRelease = buildAiStudentStudyRelease({
      ...artifact,
      routeId: artifact.syllabusRouteId,
      independentReview,
    })
    assert.equal(hasValidAiStudentStudyRelease(artifact), true)
    assert.equal(artifact.studentRelease.review.independentPassCount, 2)
    assert.equal(artifact.studentRelease.review.method, 'single-model-plus-independent-source-review')
    assert.equal(artifact.studentRelease.formalProgressEligible, false)

    const destination = outputPathFor(artifact, selection.sourceQuestionId)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    const pageEntries = [
      cachePage({ document: 'qp', pdfSha256: artifact.source.questionPdfSha256, sourcePage: record.sourcePages.qp }),
      cachePage({ document: 'ms', pdfSha256: artifact.source.markSchemePdfSha256, sourcePage: record.sourcePages.ms }),
    ]
    for (const page of pageEntries) cachedPages.set(`${page.pdfSha256}:${page.page}:${page.pageImageSha256}`, page)
    outputs.push({
      sourceQuestionId: selection.sourceQuestionId,
      artifactId: artifact.artifactId,
      file: destination,
      sha256: sha256File(destination),
      reviewReceipt: reviewFile,
      reviewReceiptSha256: sha256File(reviewFile),
      primaryTopicId: artifact.candidate.questions[0].tags.primaryTopicId,
      syllabusPointIds: artifact.candidate.questions[0].tags.syllabusPointIds,
      independentPassCount: artifact.studentRelease.review.independentPassCount,
      formalProgressEligible: artifact.studentRelease.formalProgressEligible,
    })
  }

  const groups = createAiVerifiedQuestionBankLoader({ artifactRoot: OUTPUT_ROOT, libraryRoot: LIBRARY_ROOT })().groups
  assert.equal(groups.length, selections.length)
  assert.equal(new Set(groups.map((group) => group.sourceQuestionId)).size, selections.length)
  assert.ok(groups.every((group) => (
    group.routeId === ROUTE_ID
    && group.knowledgeGroupId === TOPIC_ID
    && group.paperComponent === 1
    && group.studentStudyEligible === true
    && group.formalProgressEligible === false
    && group.parts.every((part) => part.answerKey == null)
  )))

  const summary = {
    schemaVersion: 'chapter-ready-promotion-summary.v1',
    status: 'PASS_CANDIDATE_NOT_DEPLOYED',
    routeId: ROUTE_ID,
    topicId: TOPIC_ID,
    promotedArtifacts: outputs.length,
    runtimeGroups: groups.length,
    studentStudyEligible: true,
    formalProgressEligible: false,
    minimumStartGroups: 6,
    formalReadyGroups: 12,
    outputRoot: OUTPUT_ROOT,
    outputs,
    cachedPages: [...cachedPages.values()].sort((left, right) => left.file.localeCompare(right.file)),
  }
  const summaryPath = path.join(EVIDENCE_ROOT, 'promotion-summary.json')
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ ...summary, summaryPath }))
}

try {
  main()
} catch (error) {
  console.error(JSON.stringify({ status: 'BLOCKED_PROMOTION', error: String(error?.message || error).slice(0, 400) }))
  process.exitCode = 1
}
