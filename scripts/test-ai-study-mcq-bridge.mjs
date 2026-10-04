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
const topicId = '9700-as-topic-08'
const artifactRoot = path.resolve(process.env.STEM_CHAPTER_READY_ARTIFACT_ROOT
  || 'D:/CodexWork/stem-ocr-work/postprocess-batches/chapter-20260930/biology-as-mammal-transport/reviewed-artifacts')
const promotedRoot = path.resolve(process.env.STEM_CHAPTER_READY_PROMOTED_ROOT
  || 'data/ai-pdf-ingestion/chapter-ready-9700-as-mammal-transport-qwen-20261004-v2')
const libraryRoot = path.resolve(process.env.CIE_LIBRARY_ROOT || 'D:/CodexWork/cie-fraft-fetcher/output/pdf')

function artifactFiles(root) {
  return fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
}

assert.ok(fs.statSync(artifactRoot).isDirectory(), 'the isolated reviewed artifact root must exist')
assert.ok(fs.statSync(libraryRoot).isDirectory(), 'the canonical CIE PDF library must exist')

const files = artifactFiles(artifactRoot)
assert.equal(files.length, 6, 'the candidate batch must contain exactly six reviewed questions')
const artifacts = files.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')))
const answerByQuestionId = new Map(artifacts.map((artifact) => {
  const question = artifact.candidate.questions[0]
  return [question.sourceQuestionId, question.parts[0].answerKey]
}))

const route = routeById(routeId)
const topic = route?.syllabus?.topics?.find((entry) => entry.id === topicId)
assert.ok(topic, 'the official AS Biology mammalian transport topic must exist')
assert.equal(topic.points?.length, 17, 'official syllabus pages 27-28 define 17 chapter outcomes')
assert.ok(topic.points.every((point) => (
  point.topicId === topicId
  && point.stage === 'AS'
  && point.allowedPaperComponents?.includes(1)
  && point.allowedPaperComponents?.includes(2)
)), 'every source point must remain scoped to AS theory Papers 1 and 2')

const singlePassGroups = createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot })().groups
assert.equal(singlePassGroups.length, 6, 'all six original source-reviewed MCQs must remain loadable as study content')
for (const group of singlePassGroups) {
  const expected = answerByQuestionId.get(group.sourceQuestionId)
  assert.equal(
    scoreObjectiveQuestion({ question: group, selectedOption: expected, mode: 'topic' }).available,
    false,
    'a one-pass artifact must not receive the private objective answer capability',
  )
}

const groups = createAiVerifiedQuestionBankLoader({ artifactRoot: promotedRoot, libraryRoot })().groups
assert.equal(groups.length, 6, 'all six independently verified MCQs must load from the promoted candidate batch')
assert.equal(new Set(groups.map((group) => group.sourceQuestionId)).size, 6)
assert.ok(groups.every((group) => (
  group.routeId === routeId
  && group.knowledgeGroupId === topicId
  && group.paperComponent === 1
  && group.studentStudyEligible === true
  && group.formalProgressEligible === false
  && group.parts.length === 1
  && group.parts[0].answerKey === null
  && group.parts[0].options.length === 0
)), 'the public group must remain answer-free, source-bound and study-only')

for (const group of groups) {
  const expected = answerByQuestionId.get(group.sourceQuestionId)
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

  const wrongOption = expected === 'A' ? 'B' : 'A'
  assert.equal(scoreObjectiveQuestion({ question: group, selectedOption: wrongOption, mode: 'topic' }).score, 0)
  assert.equal(scoreObjectiveQuestion({ question: group, selectedOption: expected, mode: 'full-paper' }).available, false)
  assert.equal(scoreObjectiveQuestion({ question: structuredClone(group), selectedOption: expected, mode: 'topic' }).available, false)
  assert.ok(!JSON.stringify(group).includes(`"correctOption":"${expected}"`), 'the private key must not serialize')
}

const inventory = syllabusTopicsInventory({ routeId, questionBank: groups })
const chapter = inventory.topics.find((entry) => entry.id === topicId)
assert.ok(chapter)
assert.equal(chapter.availableQuestionCount, 6)
assert.equal(chapter.verifiedQuestionCount, 0)
assert.equal(chapter.studyQuestionCount, 6)
assert.equal(chapter.studyReady, true)
assert.equal(chapter.ready, false)
assert.equal(chapter.ctaPolicy, 'start-study')
assert.deepEqual(chapter.availableSetSizes, [6])

const promotedArtifacts = artifactFiles(promotedRoot).map((file) => JSON.parse(fs.readFileSync(file, 'utf8')))
assert.equal(promotedArtifacts.length, 6)
assert.ok(promotedArtifacts.every((artifact) => (
  artifact.studentRelease.review.independentPassCount === 2
  && artifact.studentRelease.review.method === 'single-model-plus-independent-source-review'
  && artifact.studentRelease.formalProgressEligible === false
)))

function reboundIndependentReview(artifact, mutate) {
  const clone = structuredClone(artifact)
  mutate(clone.independentReview)
  clone.independentReview.bindingSha256 = independentSourceReviewBindingSha256(clone)
  return clone
}

for (const invalid of [
  reboundIndependentReview(promotedArtifacts[0], (review) => { review.result.decision = 'block' }),
  reboundIndependentReview(promotedArtifacts[0], (review) => { review.result.reasoning = '' }),
]) {
  assert.throws(() => buildAiStudentStudyRelease({
    ...invalid,
    routeId: invalid.syllabusRouteId,
    independentReview: invalid.independentReview,
  }), /valid independently bound source review/, 'rebinding a rejected or empty independent result must remain fail-closed')
}

const sameModelLegacyArtifact = structuredClone(promotedArtifacts[0])
delete sameModelLegacyArtifact.sourceReview
delete sameModelLegacyArtifact.independentReview
sameModelLegacyArtifact.extractor = {
  provider: 'legacy-provider',
  model: 'same-model',
  schemaName: 'ai_pdf_question_extraction_v1',
}
sameModelLegacyArtifact.verifier = {
  provider: 'legacy-provider',
  model: 'same-model',
  schemaName: 'ai_pdf_question_verification_v1',
}
sameModelLegacyArtifact.studentRelease = buildAiStudentStudyRelease({
  ...sameModelLegacyArtifact,
  routeId: sameModelLegacyArtifact.syllabusRouteId,
})
assert.equal(hasValidAiStudentStudyRelease(sameModelLegacyArtifact), true, 'legacy two-pass study content remains backwards-compatible')
const [sameModelLegacyGroup] = questionGroupsFromAiArtifacts([sameModelLegacyArtifact], { libraryRoot })
assert.ok(sameModelLegacyGroup, 'legacy two-pass study content must remain loadable')
assert.equal(
  scoreObjectiveQuestion({
    question: sameModelLegacyGroup,
    selectedOption: answerByQuestionId.get(sameModelLegacyGroup.sourceQuestionId),
    mode: 'topic',
  }).available,
  false,
  'same-model legacy two-pass metadata must not grant the private objective key',
)

const futurePointArtifact = structuredClone(promotedArtifacts[0])
const futurePointId = 'biology-9700-2099-8-2-99'
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
assert.equal(hasValidAiStudentStudyRelease(futurePointArtifact), true, 'the synthetic future point fixture must isolate the route whitelist check')
assert.equal(
  questionGroupsFromAiArtifacts([futurePointArtifact], { libraryRoot }).length,
  0,
  'a content-bound but unregistered future syllabus point must remain excluded from runtime',
)

console.log(JSON.stringify({
  status: 'PASS_AI_STUDY_MCQ_BRIDGE',
  routeId,
  topicId,
  studyGroups: groups.length,
  formalReviewedGroups: chapter.verifiedQuestionCount,
  ctaPolicy: chapter.ctaPolicy,
  formalProgressEligible: false,
}))
