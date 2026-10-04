import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  AI_INDEPENDENT_SOURCE_REVIEW_SCHEMA_VERSION,
  buildAiStudentStudyRelease,
  hasValidAiStudentStudyRelease,
  independentSourceReviewBindingSha256,
  sourceReviewInputSha256,
} from './ai-pdf-ingestion/contract.mjs'
import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'

const BATCH_ROOT = path.resolve('D:/CodexWork/stem-ocr-work/postprocess-batches/chapter-20260930/biology-as-mammal-transport')
const ARTIFACT_ROOT = path.join(BATCH_ROOT, 'reviewed-artifacts')
const INITIAL_REVIEW_ROOT = path.resolve('.candidate-evidence/9700-as-mammal-transport-qwen-20261004')
const FOLLOWUP_REVIEW_ROOT = path.resolve('.candidate-evidence/9700-as-mammal-transport-qwen-20261004-followup1')
const OUTPUT_ROOT = path.resolve('data/ai-pdf-ingestion/chapter-ready-9700-as-mammal-transport-qwen-20261004-v2')
const LIBRARY_ROOT = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')
const FOLLOWUP_IDS = new Set([
  'cie-9700-9700_s25_qp_12:q32',
  'cie-9700-9700_s25_qp_12:q33',
  'cie-9700-9700_s25_qp_14:q33',
])
const DIRECT_POINT_OVERRIDE = Object.freeze({
  'cie-9700-9700_s25_qp_12:q33': Object.freeze([
    'biology-9700-2025-8-1-02',
    'biology-9700-2025-8-3-02',
  ]),
})

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
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
}

function receiptFile(root, sourceQuestionId) {
  return path.join(root, `${sourceQuestionId.replaceAll(':', '--')}.json`)
}

function applyPointOverride(artifact, pointIds) {
  if (!pointIds) return artifact
  const clone = structuredClone(artifact)
  const updateQuestion = (question) => {
    question.tags.syllabusPointIds = [...pointIds]
    for (const part of question.parts || []) {
      if (Object.hasOwn(part, 'syllabusPointIds')) part.syllabusPointIds = [...pointIds]
    }
  }
  clone.candidate.questions.forEach(updateQuestion)
  clone.verification.questions.forEach(updateQuestion)
  clone.sourceReview = {
    ...clone.sourceReview,
    reviewedAt: new Date().toISOString(),
    reviewNote: `${clone.sourceReview.reviewNote} Primary syllabus mapping was narrowed after direct source reinspection to outcomes 8.1.2 and 8.3.2; broader heart-structure outcomes are background rather than directly tested by the printed statements.`,
  }
  clone.sourceReview.inputSha256 = sourceReviewInputSha256(clone)
  return clone
}

function independentReviewFromReceipt(artifact, receiptFilePath, receipt) {
  const reviewedAt = fs.statSync(receiptFilePath).mtime.toISOString()
  const review = {
    schemaVersion: AI_INDEPENDENT_SOURCE_REVIEW_SCHEMA_VERSION,
    decision: 'accept',
    provider: receipt.provider.name,
    model: receipt.provider.model,
    reviewedAt,
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

function outputPathFor(artifact, sourceQuestionId) {
  const safeQuestion = sourceQuestionId.split(':').at(-1)
  return path.join(OUTPUT_ROOT, artifact.paperId, `${safeQuestion}.json`)
}

function main() {
  if (fs.existsSync(OUTPUT_ROOT)) throw new Error(`Refuse to overwrite candidate artifact root: ${OUTPUT_ROOT}`)
  const sourceFiles = artifactFiles(ARTIFACT_ROOT)
  if (sourceFiles.length !== 6) throw new Error('Expected exactly six source-reviewed artifacts.')
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true })
  const outputs = []

  for (const sourceFile of sourceFiles) {
    let artifact = readJson(sourceFile)
    const sourceQuestionId = artifact.candidate.questions[0].sourceQuestionId
    const reviewRoot = FOLLOWUP_IDS.has(sourceQuestionId) ? FOLLOWUP_REVIEW_ROOT : INITIAL_REVIEW_ROOT
    const reviewFile = receiptFile(reviewRoot, sourceQuestionId)
    const receipt = readJson(reviewFile)
    if (receipt.status !== 'PASS_SECOND_MODEL' || receipt.comparison?.status !== 'PASS_SECOND_MODEL') {
      throw new Error(`Independent review has not passed for ${sourceQuestionId}.`)
    }
    artifact = applyPointOverride(artifact, DIRECT_POINT_OVERRIDE[sourceQuestionId])
    const independentReview = independentReviewFromReceipt(artifact, reviewFile, receipt)
    artifact.independentReview = independentReview
    artifact.studentRelease = buildAiStudentStudyRelease({
      ...artifact,
      routeId: artifact.syllabusRouteId,
      independentReview,
    })
    if (!hasValidAiStudentStudyRelease(artifact)
      || artifact.studentRelease.review.independentPassCount !== 2
      || artifact.studentRelease.review.method !== 'single-model-plus-independent-source-review') {
      throw new Error(`Promoted release contract failed for ${sourceQuestionId}.`)
    }
    const destination = outputPathFor(artifact, sourceQuestionId)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    outputs.push({
      sourceQuestionId,
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
  if (groups.length !== 6 || new Set(groups.map((group) => group.sourceQuestionId)).size !== 6) {
    throw new Error('Promoted artifact root did not load exactly six distinct groups.')
  }
  const summary = {
    schemaVersion: 'chapter-ready-promotion-summary.v1',
    status: 'PASS_CANDIDATE_NOT_DEPLOYED',
    routeId: 'cie-9700-as-biology',
    topicId: '9700-as-topic-08',
    sourceArtifacts: sourceFiles.length,
    promotedArtifacts: outputs.length,
    runtimeGroups: groups.length,
    studentStudyEligible: true,
    formalProgressEligible: false,
    minimumStartGroups: 6,
    formalReadyGroups: 12,
    outputRoot: OUTPUT_ROOT,
    outputs,
  }
  const summaryPath = path.join(FOLLOWUP_REVIEW_ROOT, 'promotion-summary-v2.json')
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ ...summary, summaryPath }))
}

try {
  main()
} catch (error) {
  console.error(JSON.stringify({ status: 'BLOCKED_PROMOTION', error: String(error?.message || error).slice(0, 300) }))
  process.exitCode = 1
}
