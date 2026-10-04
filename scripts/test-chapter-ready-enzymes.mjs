import assert from 'node:assert/strict'
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
const topicId = '9700-as-topic-03'
const artifactRoot = path.resolve(process.env.STEM_CHAPTER_READY_ENZYMES_ROOT
  || 'data/ai-pdf-ingestion/chapter-ready-9700-as-enzymes-qwen-20261005-v1')
const libraryRoot = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')
const expectedSourceQuestionIds = Object.freeze([
  'cie-9700-9700_s25_qp_11:q15',
  'cie-9700-9700_s25_qp_11:q16',
  'cie-9700-9700_s25_qp_12:q13',
  'cie-9700-9700_s25_qp_13:q16',
  'cie-9700-9700_s25_qp_14:q15',
  'cie-9700-9700_s25_qp_14:q16',
])

function artifactFiles(root) {
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(entry.parentPath, entry.name)).sort()
}

const artifacts = artifactFiles(artifactRoot).map((file) => JSON.parse(fs.readFileSync(file, 'utf8')))
assert.equal(artifacts.length, 6)
assert.deepEqual(artifacts.map((artifact) => artifact.candidate.questions[0].sourceQuestionId).sort(), [...expectedSourceQuestionIds].sort())

const expectedVisuals = Object.freeze([
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_11:q16',
    page: 7,
    region: Object.freeze({ x0: 0.2, y0: 0.315, x1: 0.8, y1: 0.515 }),
    pixels: Object.freeze([297, 663, 1191, 1085]),
    message: 'Q11/16 region must retain both axes, labels and all enzyme-kinetics curves.',
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_13:q16',
    page: 8,
    region: Object.freeze({ x0: 0.055, y0: 0.135, x1: 0.94, y1: 0.405 }),
    pixels: Object.freeze([81, 284, 1399, 853]),
    message: 'Q13/16 region must retain the complete inhibitor table, reasons and borders.',
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_14:q15',
    page: 8,
    region: Object.freeze({ x0: 0.29, y0: 0.105, x1: 0.68, y1: 0.32 }),
    pixels: Object.freeze([431, 221, 1012, 674]),
    message: 'Q14/15 region must retain the complete temperature-rate table and borders.',
  }),
  Object.freeze({
    sourceQuestionId: 'cie-9700-9700_s25_qp_14:q16',
    page: 9,
    region: Object.freeze({ x0: 0.02, y0: 0.22, x1: 0.95, y1: 0.49 }),
    pixels: Object.freeze([29, 463, 1414, 1032]),
    message: 'Q14/16 region must retain both axes, labels and all inhibitor curves.',
  }),
])
for (const expected of expectedVisuals) {
  const artifact = artifacts.find((candidate) => candidate.candidate.questions[0].sourceQuestionId === expected.sourceQuestionId)
  const pageImageSha256 = artifact.source.pageImageHashes[String(expected.page)]
  const region = { page: expected.page, pageImageSha256, ...expected.region }
  assert.deepEqual(artifact.candidate.questions[0].diagramRegions, [region])
  assert.deepEqual(artifact.verification.questions[0].diagramRegions, [region])
  const pageSize = artifact.source.pageSizes[String(expected.page)]
  assert.deepEqual([
    Math.floor(region.x0 * pageSize.width),
    Math.floor(region.y0 * pageSize.height),
    Math.ceil(region.x1 * pageSize.width),
    Math.ceil(region.y1 * pageSize.height),
  ], expected.pixels, expected.message)
}

const route = routeById(routeId)
const expectedPointCounts = Object.freeze({
  '9700-as-topic-01': 12,
  '9700-as-topic-02': 23,
  [topicId]: 8,
  '9700-as-topic-08': 17,
  '9700-as-topic-09': 7,
  '9700-as-topic-10': 6,
  '9700-as-topic-11': 10,
})
for (const [id, count] of Object.entries(expectedPointCounts)) {
  assert.equal(route.syllabus.topics.find((topic) => topic.id === id).points.length, count)
}
const enzymes = route.syllabus.topics.find((topic) => topic.id === topicId)
assert.ok(enzymes.points.every((point) => point.topicId === topicId && point.stage === 'AS'
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
assert.ok(expectedVisuals.every(({ sourceQuestionId }) => groups.find((group) => group.sourceQuestionId === sourceQuestionId).diagramRegions.length === 1))
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
const futurePointId = 'biology-9700-2099-3-1-99'
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
  status: 'PASS_CHAPTER_READY_ENZYMES', routeId, topicId, studyGroups: groups.length,
  minimumReleaseStudyGroups: 6, releaseEligible: true, chapterStudyStartable: chapter.chapterStudy.startable,
  formalReviewedGroups: chapter.verifiedQuestionCount, ctaPolicy: chapter.ctaPolicy, formalProgressEligible: false,
}))
