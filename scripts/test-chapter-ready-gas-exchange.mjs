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

const routeId = 'cie-9700-as-biology'
const topicId = '9700-as-topic-09'
const artifactRoot = path.resolve(process.env.STEM_CHAPTER_READY_GAS_EXCHANGE_ROOT
  || 'data/ai-pdf-ingestion/chapter-ready-9700-as-gas-exchange-qwen-20261004-v1')
const libraryRoot = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')
const expectedSourceQuestionIds = Object.freeze([
  'cie-9700-9700_s25_qp_11:q33',
  'cie-9700-9700_s25_qp_11:q34',
  'cie-9700-9700_s25_qp_12:q36',
  'cie-9700-9700_s25_qp_13:q34',
  'cie-9700-9700_w24_qp_11:q34',
  'cie-9700-9700_w24_qp_13:q36',
])
const heldSourceQuestionIds = Object.freeze([
  'cie-9700-9700_s25_qp_11:q35',
  'cie-9700-9700_s25_qp_12:q35',
  'cie-9700-9700_s25_qp_13:q35',
  'cie-9700-9700_s25_qp_14:q36',
])

function artifactFiles(root) {
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
}

const files = artifactFiles(artifactRoot)
const artifacts = files.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')))
assert.equal(artifacts.length, 6)
assert.deepEqual(
  artifacts.map((artifact) => artifact.candidate.questions[0].sourceQuestionId).sort(),
  [...expectedSourceQuestionIds].sort(),
)

const route = routeById(routeId)
const cellStructure = route.syllabus.topics.find((topic) => topic.id === '9700-as-topic-01')
const mammalTransport = route.syllabus.topics.find((topic) => topic.id === '9700-as-topic-08')
const gasExchange = route.syllabus.topics.find((topic) => topic.id === topicId)
const infectiousDiseases = route.syllabus.topics.find((topic) => topic.id === '9700-as-topic-10')
const immunity = route.syllabus.topics.find((topic) => topic.id === '9700-as-topic-11')
assert.equal(cellStructure.points.length, 12, 'chapter 1 official source mapping must remain isolated')
assert.equal(mammalTransport.points.length, 17, 'chapter 8 official source mapping must remain unchanged')
assert.equal(gasExchange.points.length, 7, 'chapter 9 must expose the seven official current outcomes')
assert.equal(infectiousDiseases.points.length, 6, 'chapter 10 official source mapping must remain isolated')
assert.equal(immunity.points.length, 10, 'chapter 11 official source mapping must remain isolated')
assert.ok(gasExchange.points.every((point) => (
  point.topicId === topicId
  && point.stage === 'AS'
  && point.allowedPaperComponents?.includes(1)
  && point.allowedPaperComponents?.includes(2)
)))
assert.equal(
  route.syllabus.topics.filter((topic) => !['9700-as-topic-01', '9700-as-topic-08', topicId, '9700-as-topic-10', '9700-as-topic-11'].includes(topic.id))
    .filter((topic) => topic.points?.length).length,
  0,
  'the five partial official catalogs must not populate the other seven AS Biology chapters',
)

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
  assert.equal(
    scoreObjectiveQuestion({ question: group, selectedOption: answers.get(group.sourceQuestionId), mode: 'topic' }).available,
    false,
    'one source review must never grant private objective scoring',
  )
}

const groups = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot })().groups
assert.equal(groups.length, 6)
assert.equal(new Set(groups.map((group) => group.sourceQuestionId)).size, 6)
assert.ok(heldSourceQuestionIds.every((sourceQuestionId) => !groups.some((group) => group.sourceQuestionId === sourceQuestionId)))
assert.ok(groups.every((group) => (
  group.routeId === routeId
  && group.knowledgeGroupId === topicId
  && group.paperComponent === 1
  && group.studentStudyEligible === true
  && group.formalProgressEligible === false
  && group.parts.length === 1
  && group.parts[0].answerKey === null
  && group.parts[0].options.length === 0
)))

for (const group of groups) {
  const expected = answers.get(group.sourceQuestionId)
  assert.match(expected, /^[A-D]$/)
  assert.deepEqual(objectiveAnswerMetadata(group), {
    answerFormat: 'single-choice',
    choiceLabels: ['A', 'B', 'C', 'D'],
  })
  const correct = scoreObjectiveQuestion({ question: group, selectedOption: expected, mode: 'topic' })
  assert.equal(correct.available, true)
  assert.equal(correct.score, 1)
  assert.equal(correct.maxScore, 1)
  assert.equal(correct.correctOption, expected)
  assert.equal(correct.qualityFlag, 'aicheck')
  assert.equal(correct.reviewLabel, 'AI 审核')
  assert.equal(correct.formalProgressEligible, false)
  assert.equal(scoreObjectiveQuestion({
    question: group,
    selectedOption: expected === 'A' ? 'B' : 'A',
    mode: 'topic',
  }).score, 0)
  assert.equal(scoreObjectiveQuestion({ question: group, selectedOption: expected, mode: 'full-paper' }).available, false)
  assert.equal(scoreObjectiveQuestion({ question: structuredClone(group), selectedOption: expected, mode: 'topic' }).available, false)
  assert.ok(!JSON.stringify(group).includes(`"correctOption":"${expected}"`), 'the private answer must not serialize')
}

const inventory = syllabusTopicsInventory({ routeId, questionBank: groups })
const chapter = inventory.topics.find((topic) => topic.id === topicId)
assert.equal(chapter.availableQuestionCount, 6)
assert.equal(chapter.studyQuestionCount, 6)
assert.equal(chapter.verifiedQuestionCount, 0)
assert.equal(chapter.studyReady, true)
assert.equal(chapter.ready, false)
assert.equal(chapter.ctaPolicy, 'start-study')
assert.deepEqual(chapter.availableSetSizes, [6])

assert.ok(artifacts.every((artifact) => (
  artifact.studentRelease.review.independentPassCount === 2
  && artifact.studentRelease.review.method === 'single-model-plus-independent-source-review'
  && artifact.studentRelease.formalProgressEligible === false
  && artifact.independentReview.provider === 'qwen'
  && artifact.independentReview.model === 'qwen3-vl-plus'
)))

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
  assert.throws(() => buildAiStudentStudyRelease({
    ...invalid,
    routeId: invalid.syllabusRouteId,
    independentReview: invalid.independentReview,
  }), /valid independently bound source review/)
}

const sameModelLegacyArtifact = structuredClone(artifacts[0])
delete sameModelLegacyArtifact.sourceReview
delete sameModelLegacyArtifact.independentReview
sameModelLegacyArtifact.extractor = { provider: 'legacy-provider', model: 'same-model', schemaName: 'ai_pdf_question_extraction_v1' }
sameModelLegacyArtifact.verifier = { provider: 'legacy-provider', model: 'same-model', schemaName: 'ai_pdf_question_verification_v1' }
sameModelLegacyArtifact.studentRelease = buildAiStudentStudyRelease({
  ...sameModelLegacyArtifact,
  routeId: sameModelLegacyArtifact.syllabusRouteId,
})
assert.equal(hasValidAiStudentStudyRelease(sameModelLegacyArtifact), true)
const [sameModelLegacyGroup] = questionGroupsFromAiArtifacts([sameModelLegacyArtifact], { libraryRoot })
assert.equal(scoreObjectiveQuestion({
  question: sameModelLegacyGroup,
  selectedOption: answers.get(sameModelLegacyGroup.sourceQuestionId),
  mode: 'topic',
}).available, false)

const futurePointArtifact = structuredClone(artifacts[0])
const futurePointId = 'biology-9700-2099-9-1-99'
for (const document of [futurePointArtifact.candidate, futurePointArtifact.verification]) {
  const question = document.questions[0]
  question.tags.syllabusPointIds = [futurePointId]
  for (const part of question.parts || []) {
    if (Object.hasOwn(part, 'syllabusPointIds')) part.syllabusPointIds = [futurePointId]
  }
}
futurePointArtifact.sourceReview.inputSha256 = sourceReviewInputSha256(futurePointArtifact)
futurePointArtifact.independentReview.result.syllabusPointIds = [futurePointId]
futurePointArtifact.independentReview.bindingSha256 = independentSourceReviewBindingSha256(futurePointArtifact)
futurePointArtifact.studentRelease = buildAiStudentStudyRelease({
  ...futurePointArtifact,
  routeId: futurePointArtifact.syllabusRouteId,
  independentReview: futurePointArtifact.independentReview,
})
assert.equal(hasValidAiStudentStudyRelease(futurePointArtifact), true)
assert.equal(questionGroupsFromAiArtifacts([futurePointArtifact], { libraryRoot }).length, 0)

console.log(JSON.stringify({
  status: 'PASS_CHAPTER_READY_GAS_EXCHANGE',
  routeId,
  topicId,
  studyGroups: groups.length,
  formalReviewedGroups: chapter.verifiedQuestionCount,
  ctaPolicy: chapter.ctaPolicy,
  formalProgressEligible: false,
}))
