import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { createAiVerifiedQuestionBankLoader, questionGroupsFromAiArtifacts } from '../server/aiVerifiedQuestionBank.js'
import { objectiveAnswerMetadata, scoreObjectiveQuestion } from '../server/objectiveAnswers.js'
import {
  buildAiStudentStudyRelease,
  hasValidAiStudentStudyRelease,
  independentSourceReviewBindingSha256,
  sourceReviewInputSha256,
} from './ai-pdf-ingestion/contract.mjs'
import { routeById } from '../src/data/routeRegistry.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { assertStudyReleaseInventory } from './study-release-policy.mjs'

const routeId = 'cie-9700-as-biology'
const topicId = '9700-as-topic-05'
const artifactRoot = path.resolve(process.env.STEM_CHAPTER_READY_MITOTIC_CELL_CYCLE_ROOT
  || 'data/ai-pdf-ingestion/chapter-ready-9700-as-mitotic-cell-cycle-qwen-20261005-v3')
const libraryRoot = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')
const expectedSourceQuestionIds = Object.freeze([
  'cie-9700-9700_s25_qp_11:q19',
  'cie-9700-9700_s25_qp_11:q20',
  'cie-9700-9700_s25_qp_12:q22',
  'cie-9700-9700_s25_qp_13:q21',
  'cie-9700-9700_s25_qp_14:q21',
  'cie-9700-9700_s25_qp_14:q22',
])

function artifactFiles(root) {
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(entry.parentPath, entry.name)).sort()
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

const artifacts = artifactFiles(artifactRoot).map((file) => JSON.parse(fs.readFileSync(file, 'utf8')))
assert.equal(artifacts.length, 6)
assert.deepEqual(artifacts.map((artifact) => artifact.candidate.questions[0].sourceQuestionId).sort(), [...expectedSourceQuestionIds].sort())
const promotionSummaryPath = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-promotion-20261005-v3/promotion-summary.json')
const auditSidecarPath = path.resolve('.candidate-evidence/9700-as-mitotic-cell-cycle-promotion-20261005-v3/root-audit-sidecar.json')
assert.equal(sha256File(promotionSummaryPath), '75ee7a9aeaa04240b6b96b11f3b38f8aad2c97f4d9b5122a177b6a5ac7e37a6d')
assert.equal(sha256File(auditSidecarPath), 'e2e9bac0e7a2a6b48b587d279419e0d0ad4758c8beefa7b4dd2ca031a3cfe515')
const promotionSummary = JSON.parse(fs.readFileSync(promotionSummaryPath, 'utf8'))
const auditSidecar = JSON.parse(fs.readFileSync(auditSidecarPath, 'utf8'))
assert.equal(promotionSummary.status, 'PASS_CANDIDATE_NOT_DEPLOYED')
assert.equal(promotionSummary.promotedArtifacts, 6)
assert.equal(promotionSummary.byteIdenticalPromotionV2Artifacts, 5)
assert.equal(promotionSummary.newReviewArtifacts, 1)
assert.equal(promotionSummary.providerBudgets.initialStage.callsExecuted, 12)
assert.equal(promotionSummary.providerBudgets.repairStage.callsExecuted, 3)
assert.equal(promotionSummary.providerBudgets.modalityCorrectionStage.callsExecuted, 1)
assert.equal(promotionSummary.providerBudgets.q11Q21CorrectiveStage.qpOnlyQ11Q21CallsExecuted, 1)
assert.equal(promotionSummary.providerBudgets.q11Q21CorrectiveStage.redirectedQ11Q19CallsExecuted, 1)
assert.equal(auditSidecar.rawProviderValuesRewritten, false)
assert.deepEqual(auditSidecar.previousPromotions.map((entry) => entry.sha256), [
  '456415224e8cb5b370b50fdc49652d953b2e20daf918c33904e4a51c94871b39',
  '35643ae3a50383ca294baf5ff701c316dae41bd7c571a5b54d8fc58dcca612ea',
  '88cf7cfd0df7068748b48c2cfe906bf884a916b8f98d32b3041ef861af4416c1',
])
assert.ok(auditSidecar.rejectedReceipts.some((entry) => entry.sourceQuestionId === 'cie-9700-9700_s25_qp_11:q21'
  && entry.disposition === 'REJECTED_MARK_SCHEME_DEFERENCE_IN_RAW_REASONING'))
assert.ok(auditSidecar.rejectedReceipts.some((entry) => entry.sourceQuestionId === 'cie-9700-9700_s25_qp_11:q21'
  && entry.disposition === 'HELD_QP_ONLY_PROOF_DERIVED_B_AFTER_INVENTED_QUALIFIER'))
assert.ok(auditSidecar.rejectedReceipts.some((entry) => entry.sourceQuestionId === 'cie-9700-9700_s25_qp_12:q21'
  && entry.disposition === 'REJECTED_EXPLICIT_INDEPENDENT_REASONING_CONFLICT'))
for (const blockedId of [
  'cie-9700-9700_s25_qp_11:q21',
  'cie-9700-9700_s25_qp_12:q21',
  'cie-9700-9700_s25_qp_12:q23',
]) {
  assert.ok(!expectedSourceQuestionIds.includes(blockedId), `${blockedId} must remain outside promotion v2.`)
}

const expectedVisuals = Object.freeze([
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_11:q19',
    page: 8,
    regions: Object.freeze([
      Object.freeze({ region: Object.freeze({ x0: 0.29, y0: 0.455, x1: 0.71, y1: 0.605 }), pixels: Object.freeze([431, 957, 1057, 1274]), message: 'Q11/19 results-table region must retain the stage labels, 23/45/24 values and full borders.' }),
      Object.freeze({ region: Object.freeze({ x0: 0.11, y0: 0.645, x1: 0.54, y1: 0.825 }), pixels: Object.freeze([163, 1357, 804, 1737]), message: 'Q11/19 option-table region must retain both headers, all A-D rows and full borders.' }),
    ]),
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_11:q20',
    page: 9,
    regions: Object.freeze([
      Object.freeze({ region: Object.freeze({ x0: 0.33, y0: 0.09, x1: 0.68, y1: 0.20 }), pixels: Object.freeze([491, 189, 1012, 421]), message: 'Q11/20 figure region must retain the chromosome, P/Q labels and both leader lines without clipping.' }),
      Object.freeze({ region: Object.freeze({ x0: 0.11, y0: 0.23, x1: 0.49, y1: 0.37 }), pixels: Object.freeze([163, 484, 730, 779]), message: 'Q11/20 option-table region must retain its header, all A-D rows and borders.' }),
    ]),
  }),
])
for (const expected of expectedVisuals) {
  const artifact = artifacts.find((candidate) => candidate.candidate.questions[0].sourceQuestionId === expected.sourceQuestionId)
  const pageImageSha256 = artifact.source.pageImageHashes[String(expected.page)]
  const regions = expected.regions.map((entry) => ({ page: expected.page, pageImageSha256, ...entry.region }))
  assert.deepEqual(artifact.candidate.questions[0].diagramRegions, regions)
  assert.deepEqual(artifact.verification.questions[0].diagramRegions, regions)
  const pageSize = artifact.source.pageSizes[String(expected.page)]
  for (const [index, entry] of expected.regions.entries()) {
    const region = regions[index]
    assert.deepEqual([
      Math.floor(region.x0 * pageSize.width),
      Math.floor(region.y0 * pageSize.height),
      Math.ceil(region.x1 * pageSize.width),
      Math.ceil(region.y1 * pageSize.height),
    ], entry.pixels, entry.message)
  }
}

const expectedSourceHashes = Object.freeze({
  'cie-9700-9700_s25_qp_11:q19': Object.freeze({ qp: 'b871301e28144f416cdfe4cb0ae874cd1bd73414eeae66cef67f25d0418dea51', ms: '9a0f49d4756f11960fa17b1acebd53c630f8285b5cf001afc6d540b6acbba7a3', qpPage: 'e1a5a09d8301789b3fdd3c1074eaa4b337aeef3821c5b9d0e5c0ebeecdb22771', msPage: '36e5fb50b9fd3d45135b370a253f23c82f5b663c6f9ce2506cf04273107b67ef' }),
  'cie-9700-9700_s25_qp_11:q20': Object.freeze({ qp: 'b871301e28144f416cdfe4cb0ae874cd1bd73414eeae66cef67f25d0418dea51', ms: '9a0f49d4756f11960fa17b1acebd53c630f8285b5cf001afc6d540b6acbba7a3', qpPage: 'b2f4809dc1f9d250a9abbf9f6a440825d417f002ab388772b50363fa4f7be921', msPage: '36e5fb50b9fd3d45135b370a253f23c82f5b663c6f9ce2506cf04273107b67ef' }),
  'cie-9700-9700_s25_qp_12:q22': Object.freeze({ qp: 'e6f95f47e51486f404ff5636d5dbfe9bd0e0dc3aebf4a13a0b8f358cfdd20461', ms: 'f1fa6fd2a88987f4fd32eb28ac0387210fed36b0aac18651fbf2ec294867f3fe', qpPage: '83af6f1cbcff0b5268324a08b8772d9c207c7211b559361fef8ac9dec0abd7eb', msPage: '488acb727f1dcc685aef91889b349363f8742e8e16e4fba3dd17d41eb0d4003b' }),
  'cie-9700-9700_s25_qp_13:q21': Object.freeze({ qp: '34c2bd6ddcfd82130950b636ef64126d74ca566a91183e567d632dfeae6a9b01', ms: '9a0944413719077f1324b5249d1be493e2dd3fcf57993af5328112435cc9fcba', qpPage: '1025d8c2b54cdcdf07c20ee936e64d29a076672cba3c5f7b2a8084c641b26365', msPage: '27ec89c673064da996a1247874b082d184ececba45828fe128e905b9ce2f468d' }),
  'cie-9700-9700_s25_qp_14:q21': Object.freeze({ qp: 'd3213a7a142e859a632d48197446557f320f81c50bd5b881e9ead746284ad783', ms: '98c1252136ef593b159a60fa6c5625ba0c8a05a16de535167f2e9c4cc18e0160', qpPage: 'c2b487f6f68602dc9449aeb7103df7b2da05c2937fdf707e26448d660e9812bf', msPage: '3bfe595cf1c63c303b0c73e0acd6ac00b2d830aa4647991797c188ad5254e8e1' }),
  'cie-9700-9700_s25_qp_14:q22': Object.freeze({ qp: 'd3213a7a142e859a632d48197446557f320f81c50bd5b881e9ead746284ad783', ms: '98c1252136ef593b159a60fa6c5625ba0c8a05a16de535167f2e9c4cc18e0160', qpPage: 'c2b487f6f68602dc9449aeb7103df7b2da05c2937fdf707e26448d660e9812bf', msPage: '3bfe595cf1c63c303b0c73e0acd6ac00b2d830aa4647991797c188ad5254e8e1' }),
})
for (const artifact of artifacts) {
  const sourceQuestionId = artifact.candidate.questions[0].sourceQuestionId
  const expected = expectedSourceHashes[sourceQuestionId]
  assert.ok(expected, sourceQuestionId)
  assert.equal(artifact.source.questionPdfSha256, expected.qp)
  assert.equal(artifact.source.markSchemePdfSha256, expected.ms)
  assert.deepEqual(Object.values(artifact.source.pageImageHashes), [expected.qpPage])
  assert.deepEqual(Object.values(artifact.source.markSchemePageHashes), [expected.msPage])
}

const route = routeById(routeId)
const expectedPointCounts = Object.freeze({
  '9700-as-topic-01': 12,
  '9700-as-topic-02': 23,
  '9700-as-topic-03': 8,
  '9700-as-topic-04': 10,
  [topicId]: 8,
  '9700-as-topic-08': 17,
  '9700-as-topic-09': 7,
  '9700-as-topic-10': 6,
  '9700-as-topic-11': 10,
})
for (const [id, count] of Object.entries(expectedPointCounts)) {
  assert.equal(route.syllabus.topics.find((topic) => topic.id === id).points.length, count)
}
const mitoticCellCycle = route.syllabus.topics.find((topic) => topic.id === topicId)
assert.ok(mitoticCellCycle.points.every((point) => point.topicId === topicId && point.stage === 'AS'
  && point.allowedPaperComponents?.includes(1) && point.allowedPaperComponents?.includes(2)))
assert.equal(route.syllabus.topics.filter((topic) => !Object.hasOwn(expectedPointCounts, topic.id))
  .filter((topic) => topic.points?.length).length, 0)

const answers = new Map(artifacts.map((artifact) => {
  const question = artifact.candidate.questions[0]
  return [question.sourceQuestionId, question.parts[0].answerKey]
}))
const singlePassArtifacts = artifacts.map((artifact) => {
  const clone = structuredClone(artifact)
  delete clone.independentReview
  clone.studentRelease = buildAiStudentStudyRelease({ ...clone, routeId: clone.syllabusRouteId })
  assert.equal(clone.studentRelease.review.method, 'single-model-source-review')
  assert.equal(clone.studentRelease.review.independentPassCount, 1)
  return clone
})
const singlePassGroups = questionGroupsFromAiArtifacts(singlePassArtifacts, { libraryRoot })
assert.equal(singlePassGroups.length, 6)
for (const group of singlePassGroups) {
  assert.equal(scoreObjectiveQuestion({ question: group, selectedOption: answers.get(group.sourceQuestionId), mode: 'topic' }).available, false)
}

const groups = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot })().groups
assert.equal(groups.length, 6)
assert.equal(new Set(groups.map((group) => group.sourceQuestionId)).size, 6)
assert.ok(groups.every((group) => group.routeId === routeId && group.knowledgeGroupId === topicId
  && group.paperComponent === 1 && group.studentStudyEligible === true && group.formalProgressEligible === false
  && group.parts.length === 1 && group.parts[0].answerKey === null && group.parts[0].options.length === 0
  && group.parts[0].sourceEvidence.length > 0
  && group.parts[0].sourceEvidence.every((entry) => entry.coordinateSpace === 'normalized-xyxy')))
assert.ok(expectedVisuals.every(({ sourceQuestionId, regions }) => groups.find((group) => group.sourceQuestionId === sourceQuestionId).diagramRegions.length === regions.length))
assert.ok(groups.filter((group) => !expectedVisuals.some((visual) => visual.sourceQuestionId === group.sourceQuestionId))
  .every((group) => group.diagramRegions.length === 0))

for (const group of groups) {
  const expected = answers.get(group.sourceQuestionId)
  assert.match(expected, /^[A-D]$/)
  assert.deepEqual(objectiveAnswerMetadata(group), { answerFormat: 'single-choice', choiceLabels: ['A', 'B', 'C', 'D'] })
  const correct = scoreObjectiveQuestion({ question: group, selectedOption: expected, mode: 'topic' })
  assert.equal(correct.available, true)
  assert.equal(correct.score, 1)
  assert.equal(correct.maxScore, 1)
  assert.equal(correct.correctOption, expected)
  assert.equal(correct.qualityFlag, 'aicheck')
  assert.equal(correct.reviewLabel, 'AI 审核')
  assert.equal(correct.formalProgressEligible, false)
  assert.equal(scoreObjectiveQuestion({ question: group, selectedOption: expected === 'A' ? 'B' : 'A', mode: 'topic' }).score, 0)
  assert.equal(scoreObjectiveQuestion({ question: group, selectedOption: expected, mode: 'full-paper' }).available, false)
  assert.equal(scoreObjectiveQuestion({ question: structuredClone(group), selectedOption: expected, mode: 'topic' }).available, false)
  assert.ok(!JSON.stringify(group).includes(`"correctOption":"${expected}"`))
}

const inventory = syllabusTopicsInventory({ routeId, questionBank: groups })
const chapter = inventory.topics.find((topic) => topic.id === topicId)
assert.equal(chapter.availableQuestionCount, 6)
assert.equal(chapter.studyQuestionCount, 6)
assert.equal(chapter.verifiedQuestionCount, 0)
assert.equal(chapter.chapterStudy.available, 6)
assert.equal(chapter.chapterStudy.startable, true)
assert.equal(chapter.studyReady, true)
assert.equal(chapter.ready, false)
assert.equal(chapter.ctaPolicy, 'start-study')
assert.deepEqual(chapter.availableSetSizes, [6])
const releaseReport = assertStudyReleaseInventory(inventory, routeId, [topicId])
assert.equal(releaseReport.topics, 1)
assert.equal(releaseReport.minimumStudyGroups, 6)
assert.ok(artifacts.every((artifact) => artifact.studentRelease.review.independentPassCount === 2
  && artifact.studentRelease.review.method === 'single-model-plus-independent-source-review'
  && artifact.studentRelease.formalProgressEligible === false
  && artifact.independentReview.provider === 'qwen' && artifact.independentReview.model === 'qwen3-vl-plus'))

function reboundIndependentReview(artifact, mutate) {
  const clone = structuredClone(artifact)
  mutate(clone.independentReview)
  clone.independentReview.bindingSha256 = independentSourceReviewBindingSha256(clone)
  return clone
}
for (const invalid of [
  reboundIndependentReview(artifacts[0], (review) => { review.result.decision = 'block' }),
  reboundIndependentReview(artifacts[0], (review) => { review.result.reasoning = '' }),
]) {
  assert.throws(() => buildAiStudentStudyRelease({ ...invalid, routeId: invalid.syllabusRouteId, independentReview: invalid.independentReview }), /valid independently bound source review/)
}

const sameModelLegacyArtifact = structuredClone(artifacts[0])
delete sameModelLegacyArtifact.sourceReview
delete sameModelLegacyArtifact.independentReview
sameModelLegacyArtifact.extractor = { provider: 'legacy-provider', model: 'same-model', schemaName: 'ai_pdf_question_extraction_v1' }
sameModelLegacyArtifact.verifier = { provider: 'legacy-provider', model: 'same-model', schemaName: 'ai_pdf_question_verification_v1' }
sameModelLegacyArtifact.studentRelease = buildAiStudentStudyRelease({ ...sameModelLegacyArtifact, routeId: sameModelLegacyArtifact.syllabusRouteId })
assert.equal(hasValidAiStudentStudyRelease(sameModelLegacyArtifact), true)
const [sameModelLegacyGroup] = questionGroupsFromAiArtifacts([sameModelLegacyArtifact], { libraryRoot })
assert.equal(scoreObjectiveQuestion({ question: sameModelLegacyGroup, selectedOption: answers.get(sameModelLegacyGroup.sourceQuestionId), mode: 'topic' }).available, false)

const futurePointArtifact = structuredClone(artifacts[0])
const futurePointId = 'biology-9700-2099-5-1-99'
for (const document of [futurePointArtifact.candidate, futurePointArtifact.verification]) {
  const question = document.questions[0]
  question.tags.syllabusPointIds = [futurePointId]
  for (const part of question.parts || []) if (Object.hasOwn(part, 'syllabusPointIds')) part.syllabusPointIds = [futurePointId]
}
futurePointArtifact.sourceReview.inputSha256 = sourceReviewInputSha256(futurePointArtifact)
futurePointArtifact.independentReview.result.syllabusPointIds = [futurePointId]
futurePointArtifact.independentReview.bindingSha256 = independentSourceReviewBindingSha256(futurePointArtifact)
futurePointArtifact.studentRelease = buildAiStudentStudyRelease({ ...futurePointArtifact, routeId: futurePointArtifact.syllabusRouteId, independentReview: futurePointArtifact.independentReview })
assert.equal(hasValidAiStudentStudyRelease(futurePointArtifact), true)
assert.equal(questionGroupsFromAiArtifacts([futurePointArtifact], { libraryRoot }).length, 0)

console.log(JSON.stringify({
  status: 'PASS_CHAPTER_READY_MITOTIC_CELL_CYCLE', routeId, topicId, studyGroups: groups.length,
  minimumReleaseStudyGroups: 6, releaseEligible: true, chapterStudyStartable: chapter.chapterStudy.startable,
  formalReviewedGroups: chapter.verifiedQuestionCount, ctaPolicy: chapter.ctaPolicy, formalProgressEligible: false,
}))
