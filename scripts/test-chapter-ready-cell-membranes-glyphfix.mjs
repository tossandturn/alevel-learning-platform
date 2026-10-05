import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { scoreObjectiveQuestion } from '../server/objectiveAnswers.js'
import { hasValidAiStudentStudyRelease, sourceReviewInputSha256 } from './ai-pdf-ingestion/contract.mjs'

const oldRoot = path.resolve(process.env.STEM_CHAPTER_READY_CELL_MEMBRANES_LEGACY_ROOT
  || 'data/ai-pdf-ingestion/chapter-ready-9700-as-cell-membranes-qwen-20261005-v1')
const newRoot = path.resolve(process.env.STEM_CHAPTER_READY_CELL_MEMBRANES_ROOT
  || 'data/ai-pdf-ingestion/chapter-ready-9700-as-cell-membranes-qwen-20261005-v2')
const evidenceRoot = path.resolve(process.env.STEM_CHAPTER_READY_CELL_MEMBRANES_EVIDENCE_ROOT
  || '.candidate-evidence/9700-as-cell-membranes-promotion-20261005-v2')
const summary = JSON.parse(fs.readFileSync(path.join(evidenceRoot, 'promotion-summary.json'), 'utf8'))
const acceptance = JSON.parse(fs.readFileSync(path.join(evidenceRoot, 'root-acceptance.json'), 'utf8'))
const libraryRoot = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')
const correctedId = 'cie-9700-9700_s25_qp_12:q20'
const correctedPageSha = 'aa56d92bafd98b136fde78ed7c5e0fbae4e249e1713570c9df2dd3660672348e'
const supersededPageSha = 'fa5ae4d1559d7d2bb46e7ecfd4c366c2fe6cca1a99d16dded3cd7f1a16b18526'
const sourcePdfSha = 'e6f95f47e51486f404ff5636d5dbfe9bd0e0dc3aebf4a13a0b8f358cfdd20461'

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function artifactFiles(root) {
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /^q\d+\.json$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
}

function bySourceId(root) {
  return new Map(artifactFiles(root).map((file) => {
    const artifact = JSON.parse(fs.readFileSync(file, 'utf8'))
    return [artifact.candidate.questions[0].sourceQuestionId, { file, artifact }]
  }))
}

const oldArtifacts = bySourceId(oldRoot)
const newArtifacts = bySourceId(newRoot)
assert.equal(oldArtifacts.size, 6)
assert.equal(newArtifacts.size, 6)
assert.equal(new Set(newArtifacts.keys()).size, 6, 'promotion-v2 must not duplicate a source question')

for (const [sourceQuestionId, oldRecord] of oldArtifacts) {
  if (sourceQuestionId === correctedId) continue
  const newRecord = newArtifacts.get(sourceQuestionId)
  assert.ok(newRecord, `${sourceQuestionId} must be preserved`)
  assert.equal(sha256File(newRecord.file), sha256File(oldRecord.file), `${sourceQuestionId} must remain byte-identical`)
  assert.deepEqual(fs.readFileSync(newRecord.file), fs.readFileSync(oldRecord.file))
}

const corrected = newArtifacts.get(correctedId).artifact
assert.equal(corrected.source.questionPdfSha256, sourcePdfSha)
assert.equal(corrected.source.pageImageHashes['10'], correctedPageSha)
assert.equal(corrected.source.pageRenderers['10'], 'poppler-png')
assert.deepEqual(corrected.source.pageSizes['10'], { width: 1488, height: 2105 })
assert.equal(corrected.sourceReview.inputSha256, sourceReviewInputSha256(corrected))
assert.equal(corrected.sourceReview.evidence.find((entry) => entry.document === 'qp').pageImageSha256, correctedPageSha)
assert.equal(corrected.sourceReview.evidence.find((entry) => entry.document === 'qp').renderer, 'poppler-png')
assert.equal(corrected.independentReview.provider, 'qwen')
assert.equal(corrected.independentReview.model, 'qwen3-vl-plus')
assert.match(corrected.independentReview.result.conciseProof, /6\s*[×x*]\s*2(?:²|\^2)?|24/u)
assert.equal(corrected.independentReview.result.independentDerivedAnswer, 'D')
assert.equal(corrected.independentReview.result.markSchemeAnswer, 'D')
assert.equal(corrected.independentReview.result.decision, 'accept')
assert.equal(hasValidAiStudentStudyRelease(corrected), true)
assert.equal(corrected.formalProgressEligible, false)

const expectedRegion = {
  page: 10,
  pageImageSha256: correctedPageSha,
  x0: 0.10,
  y0: 0.105,
  x1: 0.90,
  y1: 0.31,
}
assert.deepEqual(corrected.candidate.questions[0].diagramRegions, [expectedRegion])
assert.deepEqual(corrected.verification.questions[0].diagramRegions, [expectedRegion])
assert.equal(JSON.stringify(corrected).includes(supersededPageSha), false)

assert.equal(summary.schemaVersion, 'chapter-ready-promotion-summary.v2')
assert.equal(summary.status, 'PASS_CANDIDATE_NOT_DEPLOYED')
assert.equal(summary.preservedArtifacts, 5)
assert.equal(summary.correctedArtifacts, 1)
assert.equal(summary.runtimeGroups, 6)
assert.ok(summary.cachedPages.some((page) => page.page === 10 && page.pageImageSha256 === correctedPageSha))
assert.ok(summary.cachedPages.every((page) => page.pageImageSha256 !== supersededPageSha))
assert.equal(summary.glyphCorrectionProviderBudget.maximumCalls, 2)
assert.ok([1, 2].includes(summary.glyphCorrectionProviderBudget.totalCalls))

assert.equal(acceptance.status, 'PASS_ROOT_ACCEPTANCE_CANDIDATE_NOT_DEPLOYED')
assert.equal(acceptance.uniqueQuestions, 6)
assert.equal(acceptance.nonEmptyArtifacts, 6)
assert.equal(acceptance.preservedArtifacts.length, 5)
assert.equal(acceptance.correctedQuestion.sourceQuestionId, correctedId)
assert.equal(acceptance.correctedQuestion.pageImageSha256, correctedPageSha)
assert.equal(acceptance.originalPromotionSummary.status, 'PASS_CANDIDATE_NOT_DEPLOYED')
assert.equal(acceptance.fallbackReceipts.length, 5)
for (const fallback of acceptance.fallbackReceipts) {
  assert.equal(sha256File(fallback.path), fallback.sha256)
  assert.equal(fallback.receiptSourceQuestionId, fallback.sourceQuestionId)
}

const privateAnswers = new Map([...newArtifacts].map(([sourceQuestionId, { artifact }]) => [sourceQuestionId, artifact.candidate.questions[0].parts[0].answerKey]))
const groups = createAiVerifiedQuestionBankLoader({ artifactRoot: newRoot, libraryRoot })().groups
assert.equal(groups.length, 6)
assert.equal(new Set(groups.map((group) => group.sourceQuestionId)).size, 6)
for (const group of groups) {
  const result = scoreObjectiveQuestion({ question: group, selectedOption: privateAnswers.get(group.sourceQuestionId), mode: 'topic' })
  assert.equal(result.available, true)
  assert.equal(result.score, 1)
  assert.equal(result.maxScore, 1)
  assert.equal(result.formalProgressEligible, false)
  assert.ok(!JSON.stringify(group).includes(`"correctOption":"${privateAnswers.get(group.sourceQuestionId)}"`))
}

console.log(JSON.stringify({
  status: 'PASS_CHAPTER_READY_CELL_MEMBRANES_GLYPHFIX',
  preservedArtifacts: 5,
  correctedArtifacts: 1,
  runtimeGroups: groups.length,
  correctedPageSha,
  formalProgressEligible: false,
}))
