import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { Readable } from 'node:stream'

import { createAiVerifiedQuestionBankLoader } from '../server/aiVerifiedQuestionBank.js'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { isHumanReviewedPastPaperItem, isStudentReleasedAiStudyItem, studyQuestionBank } from '../src/data/questionBank.js'
import { routeById } from '../src/data/routeRegistry.js'
import { buildSyllabusPracticeSet, syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { buildAiStudentStudyRelease } from './ai-pdf-ingestion/contract.mjs'

const ROUTE_ID = 'cie-0580-igcse-mathematics'
const COMPONENT = 1
const TOPIC_A = '0580-igcse-topic-01'
const TOPIC_B = '0580-igcse-topic-02'
const SEEDS = Object.freeze([0, 1, 2, 17, 101, 65_535, 0xffff_ffff])
const FUNCTIONS_ARTIFACT_ROOTS = Object.freeze([
  'D:/CodexWork/stem-ocr-work/postprocess-batches/chapter-20260910/target-0606-functions-2025/p1-selection/artifacts',
  'D:/CodexWork/stem-ocr-work/postprocess-batches/chapter-20260910/target-0606-functions-2025/p2-selection/artifacts',
])
const LIBRARY_ROOT = 'D:/CodexWork/cie-fraft-fetcher/output/pdf'

function call(api, body) {
  return new Promise((resolve, reject) => {
    const request = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')])
    Object.assign(request, { method: 'POST', url: '/api/stem/practice-sets', headers: { 'content-type': 'application/json' } })
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
      end(value = '') {
        try { resolve({ status: this.statusCode, body: value ? JSON.parse(String(value)) : null }) }
        catch (error) { reject(error) }
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error('Unhandled POST /api/stem/practice-sets')))).catch(reject)
  })
}

function reviewedQuestions(topicId, count) {
  const topic = syllabusTopicsInventory({ routeId: ROUTE_ID, questionBank: studyQuestionBank, includeStudyOnly: false }).topics.find((row) => row.id === topicId)
  const ids = topic?.questionIdsByComponent?.[COMPONENT]?.verifiedQuestionIds || []
  const questions = ids
    .map((id) => studyQuestionBank.find((question) => question.sourceQuestionId === id))
    .filter((question) => question && isHumanReviewedPastPaperItem(question))
    .slice(0, count)
  assert.equal(questions.length, count, `${topicId} reviewed fixture`)
  return questions
}

function releasedStudyClone(question, suffix, { component = COMPONENT, topicIds = [TOPIC_A] } = {}) {
  const sourceQuestionId = `fixture-${suffix}:q1`
  const artifactId = `sha256:${crypto.createHash('sha256').update(sourceQuestionId).digest('hex')}`
  const source = { questionPdfSha256: question.sourceRef.sha256, markSchemePdfSha256: question.answerRef.sha256 }
  const extractor = { provider: 'fixture-extractor', model: 'fixture', schemaName: 'ai_pdf_question_extraction_v1' }
  const verifier = { provider: 'fixture-verifier', model: 'fixture', schemaName: 'ai_pdf_question_verification_v1' }
  const candidate = { questions: [{ questionNumber: '1' }] }
  const verification = { questions: [{ questionNumber: '1' }] }
  const studentRelease = buildAiStudentStudyRelease({ artifactId, routeId: ROUTE_ID, status: 'ai-verified', source, extractor, verifier, candidate, verification })
  const route = routeById(ROUTE_ID)
  const syllabusPointIds = topicIds.map((topicId) => {
    const pointId = route.syllabus.topics.find((topic) => topic.id === topicId)?.points?.[0]?.id
    assert.ok(pointId, `${topicId} point fixture`)
    return pointId
  })
  const parts = question.parts.map((part, index) => ({
    ...part,
    partId: `${sourceQuestionId}:part-${index + 1}`,
    sourceFocus: null,
    questionDeclaredMarks: Number(part.marks),
    sourceEvidence: [{
      page: Number(part.sourcePage),
      documentSha256: question.sourceRef.sha256,
      coordinateSpace: 'normalized-xyxy',
      region: [0.1, 0.1 + index * 0.1, 0.9, 0.2 + index * 0.1],
      imageSize: [1020, 1320],
    }],
    markSchemeEvidence: [{ page: Number(part.answerSourcePage), pageImageSha256: 'b'.repeat(64) }],
  }))
  const clone = {
    ...question,
    sourceQuestionId,
    questionGroupId: sourceQuestionId,
    questionId: sourceQuestionId,
    answerId: `${sourceQuestionId}:answer`,
    bankId: `${sourceQuestionId}@${ROUTE_ID}`,
    knowledgeGroupId: topicIds[0],
    topicId: topicIds[0],
    topicTags: [...topicIds],
    sourceRef: { ...question.sourceRef, component, question: `Q fixture ${suffix}` },
    answerRef: { ...question.answerRef, component, question: `Q fixture ${suffix}` },
    parts,
    answerBinding: {
      ...question.answerBinding,
      questionId: sourceQuestionId,
      answerId: `${sourceQuestionId}:answer`,
      verificationStatus: 'ai-verified',
      artifactId,
      questionDocumentSha256: question.sourceRef.sha256,
      answerDocumentSha256: question.answerRef.sha256,
    },
    syllabusMapping: {
      mappingStatus: 'ai-verified',
      primaryTopicId: topicIds[0],
      secondaryTopicIds: topicIds.slice(1),
      topicIds: [...topicIds],
      syllabusPointIds,
    },
    sourceContent: {
      schemaVersion: 'ai-verified-coordinate-source-v1',
      complete: true,
      fileComplete: true,
      semanticStatus: 'ai-verified',
      reasons: [],
      sourcePages: [...new Set(parts.map((part) => Number(part.sourcePage)))],
      sourcePageStart: Number(parts[0]?.sourcePage),
      sourcePageEnd: Number(parts.at(-1)?.sourcePage),
      assetUrls: [],
      assetPages: [],
      bindingSignature: `ai:${artifactId}:${ROUTE_ID}:1`,
      audit: { complete: true, fileComplete: true, semanticStatus: 'ai-verified', reasons: [], bindingSignature: `ai:${artifactId}:${ROUTE_ID}:1` },
    },
    studentStudyEligible: true,
    formalProgressEligible: false,
    studentRelease,
  }
  assert.equal(isStudentReleasedAiStudyItem(clone), true, `${suffix} released-study fixture`)
  return clone
}

function build(questionBank, { topicIds = [TOPIC_A], components = [COMPONENT], questionCount = 6, seed = 101, sourceQuestionIds = [] } = {}) {
  return buildSyllabusPracticeSet({ routeId: ROUTE_ID, syllabusTopicIds: topicIds, components, questionCount, seed, sourceQuestionIds, excludeAttempted: false, questionBank })
}

const reviewedA = reviewedQuestions(TOPIC_A, 11)
const releasedA = Array.from({ length: 4 }, (_, index) => releasedStudyClone(reviewedA[index], `released-a-${index + 1}`))
const mixedBank = [...reviewedA, ...releasedA]
const providerOrders = Object.freeze([
  Object.freeze({ name: 'original', questions: mixedBank }),
  Object.freeze({ name: 'reversed', questions: [...mixedBank].reverse() }),
  Object.freeze({
    name: 'shuffled',
    questions: [...mixedBank].sort((left, right) => (
      crypto.createHash('sha256').update(`provider-order:${left.sourceQuestionId}`).digest('hex')
        .localeCompare(crypto.createHash('sha256').update(`provider-order:${right.sourceQuestionId}`).digest('hex'))
    )),
  }),
])

for (const questionCount of [6, 10, 15]) {
  for (const seed of SEEDS) {
    const result = build(mixedBank, { questionCount, seed })
    assert.equal(result.questionCount, questionCount)
    assert.equal(result.partial, false)
    assert.equal(new Set(result.sourceQuestionIds).size, questionCount)
    assert.ok(result.sourceQuestionIds.some((id) => releasedA.some((question) => question.sourceQuestionId === id)), `count ${questionCount}, seed ${seed} must reserve released study`)
    assert.equal(result.practiceMode, 'study-only')
    assert.equal(result.formalProgressEligible, false)
    for (const providerOrder of providerOrders.slice(1)) {
      assert.deepEqual(
        build(providerOrder.questions, { questionCount, seed }).sourceQuestionIds,
        result.sourceQuestionIds,
        `count ${questionCount}, seed ${seed} changed under ${providerOrder.name} provider input`,
      )
    }
  }
}

for (const questionBank of [
  reviewedA,
  [...reviewedA, { ...releasedA[0], studentRelease: { ...releasedA[0].studentRelease, status: 'candidate' } }],
]) {
  const api = createStemApi({ env: { NODE_ENV: 'production', STEM_DB_PATH: ':memory:' }, questionBank })
  try {
    const response = await call(api, { routeId: ROUTE_ID, syllabusTopicIds: [TOPIC_A], components: [COMPONENT], questionCount: 6, excludeAttempted: false, seed: 101 })
    assert.equal(response.status, 409)
    assert.equal(response.body.code, 'insufficient_verified_questions')
  } finally {
    closeStemDatabaseForTests()
  }
}

const explicitStudyOrder = [releasedA[2].sourceQuestionId, ...reviewedA.slice(0, 5).map((question) => question.sourceQuestionId)]
const explicitStudy = build(mixedBank, { sourceQuestionIds: explicitStudyOrder })
assert.deepEqual(explicitStudy.sourceQuestionIds, explicitStudyOrder)
assert.equal(explicitStudy.practiceMode, 'study-only')
const explicitReviewedOrder = reviewedA.slice(0, 6).reverse().map((question) => question.sourceQuestionId)
const explicitReviewed = build(mixedBank, { sourceQuestionIds: explicitReviewedOrder })
assert.deepEqual(explicitReviewed.sourceQuestionIds, explicitReviewedOrder)
assert.equal(explicitReviewed.practiceMode, 'unavailable')

const componentTwoStudies = Array.from({ length: 6 }, (_, index) => releasedStudyClone(reviewedA[index], `released-p2-${index + 1}`, { component: 2 }))
const componentBank = [...reviewedA, ...releasedA, ...componentTwoStudies]
const componentOne = build(componentBank, { components: [1] })
assert.ok(componentOne.questionGroups.every((group) => group.paperComponent === 1))
assert.ok(componentOne.questionGroups.some((group) => group.studyOnly))
const componentTwo = build(componentBank, { components: [2] })
assert.ok(componentTwo.questionGroups.every((group) => group.paperComponent === 2 && group.studyOnly))
assert.equal(new Set(componentTwo.sourceQuestionIds).size, 6)

const reviewedB = reviewedQuestions(TOPIC_B, 5)
const sharedStudy = releasedStudyClone(reviewedA[0], 'released-shared-a-b', { topicIds: [TOPIC_A, TOPIC_B] })
const multiTopic = build([...reviewedA, ...reviewedB, sharedStudy], { topicIds: [TOPIC_A, TOPIC_B], questionCount: 6, seed: 101 })
assert.equal(multiTopic.practiceMode, 'study-only')
assert.equal(multiTopic.sourceQuestionIds.filter((id) => id === sharedStudy.sourceQuestionId).length, 1)
assert.equal(new Set(multiTopic.sourceQuestionIds).size, 6)
assert.equal(multiTopic.formalProgressEligible, false)

let realFunctionsProviderOrder = 'skipped-no-frozen-artifacts'
if (FUNCTIONS_ARTIFACT_ROOTS.every((artifactRoot) => fs.existsSync(artifactRoot))) {
  const groups = FUNCTIONS_ARTIFACT_ROOTS.flatMap((artifactRoot) => (
    createAiVerifiedQuestionBankLoader({ artifactRoot, libraryRoot: LIBRARY_ROOT })().groups
  ))
  assert.equal(groups.length, 5)
  async function functionsDefaultIds(providerGroups, seed) {
    const api = createStemApi({
      env: { NODE_ENV: 'production', STEM_DB_PATH: ':memory:' },
      questionBank: studyQuestionBank,
      topicQuestionBankProvider: () => providerGroups,
      libraryRoot: LIBRARY_ROOT,
    })
    try {
      const response = await call(api, {
        routeId: 'cie-0606-igcse-additional-mathematics',
        syllabusTopicIds: ['math-0606-functions'],
        components: [1, 2],
        questionCount: 6,
        excludeAttempted: false,
        seed,
      })
      assert.equal(response.status, 201)
      assert.equal(response.body.practiceMode, 'study-only')
      assert.equal(response.body.formalProgressEligible, false)
      return response.body.sourceQuestionIds
    } finally {
      closeStemDatabaseForTests()
    }
  }
  for (const seed of SEEDS) {
    assert.deepEqual(
      await functionsDefaultIds([...groups].reverse(), seed),
      await functionsDefaultIds(groups, seed),
      `real Functions seed ${seed} changed under reversed provider input`,
    )
  }
  realFunctionsProviderOrder = 'passed'
}

console.log(JSON.stringify({
  status: 'PASS',
  scope: 'default released-study selection',
  seeds: SEEDS,
  capacities: [6, 10, 15],
  reviewedOnlyRejected: true,
  unreleasedStudyRejected: true,
  explicitSelectionPreserved: true,
  providerOrderStable: providerOrders.map((entry) => entry.name),
  componentScopePreserved: true,
  multiTopicDeduplicated: true,
  realFunctionsProviderOrder,
}))
