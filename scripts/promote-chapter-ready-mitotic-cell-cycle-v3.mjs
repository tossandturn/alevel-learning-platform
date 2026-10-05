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
const TOPIC_ID = '9700-as-topic-05'
const OUTPUT_ROOT = path.resolve('data/ai-pdf-ingestion/chapter-ready-9700-as-mitotic-cell-cycle-qwen-20261005-v3')
const EVIDENCE_ROOT = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-promotion-20261005-v3')
const PAGE_CACHE_ROOT = path.join(EVIDENCE_ROOT, 'page-cache')
const LIBRARY_ROOT = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')

const PRIMARY_V1 = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-primary-20261005-v1')
const PRIMARY_V4 = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-primary-20261005-v4')
const PRIMARY_V5 = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-primary-20261005-v5')
const PRIMARY_V6 = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-primary-20261005-v6')
const PRIMARY_V8 = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-primary-20261005-v8')
const REVIEW_INITIAL = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-qwen-20261005-v1')
const REVIEW_INITIAL_FOLLOWUP = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-qwen-20261005-followup1')
const REVIEW_FINAL_FIX = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-qwen-20261005-finalfix1')
const REVIEW_MODALITY_CORRECTION = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-qwen-20261005-modality-correction-v1')
const REVIEW_Q11_Q19_MODALITY = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-qwen-20261005-q11q19-modality-v1')

const PREVIOUS_PROMOTION_SUMMARY = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-promotion-20261005-v1/promotion-summary.json')
const PREVIOUS_PROMOTION_SUMMARY_SHA256 = '456415224e8cb5b370b50fdc49652d953b2e20daf918c33904e4a51c94871b39'
const PREVIOUS_PROMOTION_V2_SUMMARY = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-promotion-20261005-v2/promotion-summary.json')
const PREVIOUS_PROMOTION_V2_SUMMARY_SHA256 = '35643ae3a50383ca294baf5ff701c316dae41bd7c571a5b54d8fc58dcca612ea'
const PREVIOUS_PROMOTION_V2_SIDECAR = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-promotion-20261005-v2/root-audit-sidecar.json')
const PREVIOUS_PROMOTION_V2_SIDECAR_SHA256 = '88cf7cfd0df7068748b48c2cfe906bf884a916b8f98d32b3041ef861af4416c1'

const selections = Object.freeze([
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_11:q20', primaryRoot: PRIMARY_V5, reviewRoot: REVIEW_FINAL_FIX,
    expectedReceiptSha256: 'a83a9d12bea18c1aac6c6ce62ae35a6535544080e1113c596f3da165f46a4afb',
    expectedOutputSha256: 'ec2349fa2d47eb2730326437af6dbb98375297f8795f2e2516a8355a3fbc87ef',
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_12:q22', primaryRoot: PRIMARY_V1, reviewRoot: REVIEW_INITIAL,
    expectedReceiptSha256: '233383fa244cfe908b144e28093125a2284ef1d7ce5976237e38b76639b16ecd',
    expectedOutputSha256: 'e46ddc76fcf0c34ad0648cba611c927afb828141d1f7289bb0e8130d880a1b4b',
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_14:q21', primaryRoot: PRIMARY_V4, reviewRoot: REVIEW_INITIAL_FOLLOWUP,
    expectedReceiptSha256: 'db9217d2ccd37cdcdd04df5068e28a936fc9ad733836d2890a89c97afb968a88',
    expectedOutputSha256: '6019d51d6cdd063e93b9674099015a407a3092102a239f254193014374372859',
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_14:q22', primaryRoot: PRIMARY_V1, reviewRoot: REVIEW_INITIAL,
    expectedReceiptSha256: '38d24e5786156c34e2d794d56bacf541938c2dd642ffff155959c277d3509064',
    expectedOutputSha256: '0d8d9b6762553f1df007c5c390383e758b5297568bde73514b68e56cac1bc358',
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_13:q21', primaryRoot: PRIMARY_V8, reviewRoot: REVIEW_MODALITY_CORRECTION,
    expectedReceiptSha256: 'e6094d213580e044c2d61d0260bf3c48dee875c512e0c6b24b276a09cddc87f8',
    expectedOutputSha256: 'fe418041535f69188307e56191a30306fc5e298be54334351d5c3d40d7e9c7f3',
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_11:q19', primaryRoot: PRIMARY_V6, reviewRoot: REVIEW_Q11_Q19_MODALITY,
    expectedReceiptSha256: '5457eb2a9c8f959ecfe2fd613bb40e814aa52eb2407297e44b5b67ed082bce88',
  }),
])

const rejectedReceiptSpecs = Object.freeze([
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_11:q21',
    file: path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-qwen-20261005-v1/cie-9700-9700_s25_qp_11--q21.json'),
    sha256: '355b71131ddd947e98b56796ebadae1e6a23f323bd9e62efc529acceb326b4a2',
    disposition: 'REJECTED_MARK_SCHEME_DEFERENCE_IN_RAW_REASONING',
    verify: (receipt) => receipt.status === 'PASS_SECOND_MODEL'
      && /mark scheme indicates A|accept the mark scheme/i.test(String(receipt.providerResult?.reasoning || receipt.result?.reasoning || '')),
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_11:q21',
    file: path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-q11q21-qp-proof-20261005-v1/cie-9700-9700_s25_qp_11--q21.json'),
    sha256: '02f9a6e0278a4450a276bbf80d61eb101fcbf091c1b445e0b04fd1be11ccf96a',
    disposition: 'HELD_QP_ONLY_PROOF_DERIVED_B_AFTER_INVENTED_QUALIFIER',
    verify: (receipt) => receipt.status === 'BLOCKED_QP_ONLY_PROOF'
      && receipt.result?.independentDerivedAnswer === 'B',
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_11:q20',
    file: path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-qwen-20261005-followup1/cie-9700-9700_s25_qp_11--q20.json'),
    sha256: 'df9c52932a7e0350101aa349a5e504a6e6eb6bdd62798e98b3a53d72e0e5cdf4',
    disposition: 'REJECTED_ROOT_GEOMETRY_AUDIT_VISUAL_UNDERCOUNT',
    verify: (receipt) => receipt.status === 'PASS_SECOND_MODEL' && receipt.result?.diagramRegionCount === 1,
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_12:q21',
    file: path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-qwen-20261005-followup1/cie-9700-9700_s25_qp_12--q21.json'),
    sha256: 'a6232e8fedd604255fe7ec826b3d07b372a9bf610761419bb5c194612cc346af',
    disposition: 'REJECTED_EXPLICIT_INDEPENDENT_REASONING_CONFLICT',
    verify: (receipt) => receipt.status === 'PASS_SECOND_MODEL'
      && /C should be correct|mark scheme says D|conflict/i.test(String(receipt.providerResult?.reasoning || receipt.result?.reasoning || '')),
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_12:q23',
    file: path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-qwen-20261005-finalfix1/cie-9700-9700_s25_qp_12--q23.json'),
    sha256: 'ee5577b71a7278f4fd1cfb20e4e3d3b8b8376d9f4e1fe2eb2f008aea216608de',
    disposition: 'HELD_PROVIDER_SCHEMA_FAILURE',
    verify: (receipt) => receipt.status === 'BLOCKED_PROVIDER_FAILURE',
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_12:q23',
    file: path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-qwen-20261005-finalfix1-followup1/cie-9700-9700_s25_qp_12--q23.json'),
    sha256: 'a11d5b435b574f608d830e4803fd4802a16aec48187e2835db466386540495cc',
    disposition: 'HELD_STRUCTURED_BLOCK_AND_MAPPING_DISAGREEMENT',
    verify: (receipt) => receipt.status === 'BLOCKED_REVIEW_DISAGREEMENT' && receipt.result?.decision === 'block',
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_11:q19',
    file: path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-qwen-20261005-repair-stage-v1/cie-9700-9700_s25_qp_11--q19.json'),
    sha256: 'aa1fc20340432a84cc2cc297ae4a08252a44cc40bbebc676c6eb408879e524c6',
    disposition: 'HELD_PROVIDER_SCHEMA_FAILURE',
    verify: (receipt) => receipt.status === 'BLOCKED_PROVIDER_FAILURE',
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_11:q19',
    file: path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-qwen-20261005-repair-stage-followup1/cie-9700-9700_s25_qp_11--q19.json'),
    sha256: '826f543c1f6801b9d675154eec54c0fd7d39868e2db4411bcefa87029d07b9c0',
    disposition: 'HELD_STRUCTURED_ANSWER_AND_DECISION_CONFLICT',
    verify: (receipt) => receipt.status === 'BLOCKED_REVIEW_DISAGREEMENT'
      && receipt.result?.independentDerivedAnswer !== receipt.result?.markSchemeAnswer,
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_13:q21',
    file: path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-qwen-20261005-repair-stage-alternative1/cie-9700-9700_s25_qp_13--q21.json'),
    sha256: '9f6893f14d9ed8cc882278ddb585f7a9637f587980d842b00222a451764bf839',
    disposition: 'HELD_DIRECT_MAPPING_DISAGREEMENT',
    verify: (receipt) => receipt.status === 'BLOCKED_REVIEW_DISAGREEMENT'
      && receipt.comparison?.checks?.syllabusPointsMatch === false,
  }),
])

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex') }
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
function rejectedReceipts() {
  return rejectedReceiptSpecs.map((spec) => {
    assert.equal(sha256File(spec.file), spec.sha256)
    const receipt = readJson(spec.file)
    assert.equal(receipt.sourceQuestionId, spec.sourceQuestionId)
    assert.equal(spec.verify(receipt), true, `${spec.sourceQuestionId}: rejected receipt no longer matches its hold reason`)
    return {
      sourceQuestionId: spec.sourceQuestionId,
      file: spec.file,
      sha256: spec.sha256,
      priorStructuredStatus: receipt.status,
      reviewPass: receipt.reviewPass,
      inputSha256: receipt.inputSha256 || null,
      disposition: spec.disposition,
    }
  })
}

function main() {
  if (fs.existsSync(OUTPUT_ROOT)) throw new Error(`Refuse to overwrite candidate artifact root: ${OUTPUT_ROOT}`)
  if (fs.existsSync(EVIDENCE_ROOT)) throw new Error(`Refuse to overwrite promotion evidence root: ${EVIDENCE_ROOT}`)
  assert.equal(sha256File(PREVIOUS_PROMOTION_SUMMARY), PREVIOUS_PROMOTION_SUMMARY_SHA256)
  assert.equal(sha256File(PREVIOUS_PROMOTION_V2_SUMMARY), PREVIOUS_PROMOTION_V2_SUMMARY_SHA256)
  assert.equal(sha256File(PREVIOUS_PROMOTION_V2_SIDECAR), PREVIOUS_PROMOTION_V2_SIDECAR_SHA256)
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true })
  fs.mkdirSync(PAGE_CACHE_ROOT, { recursive: true })
  const outputs = []
  const cachedPages = new Map()
  for (const selection of selections) {
    const { file: sourceFile, artifact: originalArtifact } = sourceArtifact(selection)
    const record = primaryRecord(selection)
    const artifact = structuredClone(originalArtifact)
    const reviewFile = receiptPath(selection)
    const receipt = readJson(reviewFile)
    assert.equal(sha256File(reviewFile), selection.expectedReceiptSha256)
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
    assert.equal(artifact.studentRelease.formalProgressEligible, false)
    const destination = outputPathFor(artifact, selection.sourceQuestionId)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    const outputSha256 = sha256File(destination)
    if (selection.expectedOutputSha256) assert.equal(outputSha256, selection.expectedOutputSha256)
    const pages = [
      cachePage({ document: 'qp', pdfSha256: artifact.source.questionPdfSha256, sourcePage: record.sourcePages.qp }),
      cachePage({ document: 'ms', pdfSha256: artifact.source.markSchemePdfSha256, sourcePage: record.sourcePages.ms }),
    ]
    for (const page of pages) cachedPages.set(`${page.pdfSha256}:${page.page}:${page.pageImageSha256}`, page)
    outputs.push({
      sourceQuestionId: selection.sourceQuestionId, artifactId: artifact.artifactId,
      file: destination, sha256: outputSha256, reviewReceipt: reviewFile,
      reviewReceiptSha256: selection.expectedReceiptSha256,
      syllabusPointIds: artifact.candidate.questions[0].tags.syllabusPointIds,
      independentPassCount: artifact.studentRelease.review.independentPassCount,
      studentStudyEligible: artifact.studentStudyEligible,
      formalProgressEligible: artifact.studentRelease.formalProgressEligible,
      byteIdenticalToPreviousPromotion: Boolean(selection.expectedOutputSha256),
    })
  }
  const groups = createAiVerifiedQuestionBankLoader({ artifactRoot: OUTPUT_ROOT, libraryRoot: LIBRARY_ROOT })().groups
  assert.equal(groups.length, 6)
  assert.equal(new Set(groups.map((group) => group.sourceQuestionId)).size, 6)
  assert.ok(groups.every((group) => group.routeId === ROUTE_ID && group.knowledgeGroupId === TOPIC_ID
    && group.studentStudyEligible === true && group.formalProgressEligible === false
    && group.parts.every((part) => part.answerKey == null)))
  const rejected = rejectedReceipts()
  const blockedSourceQuestionIds = new Set([
    'cie-9700-9700_s25_qp_11:q21',
    'cie-9700-9700_s25_qp_12:q21',
    'cie-9700-9700_s25_qp_12:q23',
  ])
  assert.ok(groups.every((group) => !blockedSourceQuestionIds.has(group.sourceQuestionId)))
  assert.equal(outputs.filter((output) => output.byteIdenticalToPreviousPromotion).length, 5)
  const providerBudgets = {
    initialStage: { maximumCalls: 12, callsExecuted: 12, exhausted: true },
    repairStage: { maximumCalls: 3, callsExecuted: 3, exhausted: true },
    modalityCorrectionStage: { maximumCalls: 1, callsExecuted: 1, exhausted: true },
    q11Q21CorrectiveStage: {
      maximumCalls: 2,
      qpOnlyQ11Q21CallsExecuted: 1,
      fullSourceQ11Q21CallsExecuted: 0,
      redirectedQ11Q19CallsExecuted: 1,
      exhausted: true,
    },
    combinedCallsExecuted: 18,
    furtherCallsAuthorised: 0,
  }
  const rootAuditSidecar = {
    schemaVersion: 'chapter-ready-root-audit-sidecar.v3',
    status: 'PASS_ROOT_AUDIT_CORRECTIONS_APPLIED',
    routeId: ROUTE_ID,
    topicId: TOPIC_ID,
    providerBudgets,
    previousPromotions: [
      {
        file: PREVIOUS_PROMOTION_SUMMARY,
        sha256: PREVIOUS_PROMOTION_SUMMARY_SHA256,
        bytesUnchanged: true,
        disposition: 'SUPERSEDED_BY_ROOT_SOURCE_AUDIT_PROMOTION_V2',
      },
      {
        file: PREVIOUS_PROMOTION_V2_SUMMARY,
        sha256: PREVIOUS_PROMOTION_V2_SUMMARY_SHA256,
        bytesUnchanged: true,
        disposition: 'SUPERSEDED_BY_Q11_Q21_QP_ONLY_PROOF_FAILURE',
      },
      {
        file: PREVIOUS_PROMOTION_V2_SIDECAR,
        sha256: PREVIOUS_PROMOTION_V2_SIDECAR_SHA256,
        bytesUnchanged: true,
        disposition: 'PRESERVED_AUDIT_HISTORY',
      },
    ],
    rejectedReceipts: rejected,
    acceptedReceiptBackreferences: outputs.map((output) => ({
      sourceQuestionId: output.sourceQuestionId,
      reviewReceipt: output.reviewReceipt,
      reviewReceiptSha256: output.reviewReceiptSha256,
      artifactSha256: output.sha256,
    })),
    rawProviderValuesRewritten: false,
  }
  const sidecarPath = path.join(EVIDENCE_ROOT, 'root-audit-sidecar.json')
  fs.writeFileSync(sidecarPath, `${JSON.stringify(rootAuditSidecar, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  const summary = {
    schemaVersion: 'chapter-ready-promotion-summary.v3',
    status: 'PASS_CANDIDATE_NOT_DEPLOYED',
    routeId: ROUTE_ID,
    topicId: TOPIC_ID,
    promotedArtifacts: outputs.length,
    runtimeGroups: groups.length,
    studentStudyEligible: true,
    releaseEligible: true,
    studyReady: true,
    formalProgressEligible: false,
    minimumStudyGroups: 6,
    formalReadyGroups: 12,
    providerBudgets,
    previousPromotionBytesUnchanged: true,
    byteIdenticalPromotionV2Artifacts: 5,
    threeLegacyArtifactsByteIdentical: true,
    newReviewArtifacts: 1,
    outputRoot: OUTPUT_ROOT,
    outputs,
    rootAuditSidecar: { path: sidecarPath, sha256: sha256File(sidecarPath) },
    cachedPages: [...cachedPages.values()].sort((left, right) => left.file.localeCompare(right.file)),
  }
  const summaryPath = path.join(EVIDENCE_ROOT, 'promotion-summary.json')
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ ...summary, summaryPath, summarySha256: sha256File(summaryPath) }))
}

try { main() } catch (error) {
  console.error(JSON.stringify({ status: 'BLOCKED_PROMOTION_V3', error: String(error?.message || error).slice(0, 400) }))
  process.exitCode = 1
}
