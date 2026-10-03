import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { isHumanReviewedPastPaperItem, studyQuestionBank } from '../src/data/questionBank.js'
import { syllabusPracticeRebindPayload } from '../src/lib/syllabusPracticeRebind.js'

const routeId = 'cie-9702-as-physics'
const topicA = 'physics-9702-topic-01'
const topicB = 'physics-9702-topic-02'
const unrelatedTopic = 'physics-9702-topic-03'
const emptyTopic = 'physics-9702-topic-04'
const secondEmptyTopic = 'physics-9702-topic-05'
const signingKey = 'chapter-study-contract-test-signing-key'

function signedIdentityToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: `ielts:${userId}`,
    username: `chapter-study-${userId}`,
    iat: now,
    exp: now + 300,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function call(api, { method, url, body, token = '' }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body), 'utf8')] : [])
    request.method = method
    request.url = url
    request.headers = {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    }
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
      end(raw = '') {
        const text = String(raw || '')
        resolve({ statusCode: this.statusCode, payload: text ? JSON.parse(text) : null })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

function remapQuestion(question, topicId) {
  return {
    ...question,
    knowledgeGroupId: topicId,
    syllabusMapping: {
      ...(question.syllabusMapping || {}),
      primaryTopicId: topicId,
      secondaryTopicIds: [],
      topicIds: [topicId],
      reviewStatus: 'reviewed',
      reviewedBy: 'chapter-study-contract-regression',
      reviewedAt: '2026-10-04T00:00:00.000Z',
    },
  }
}

function reviewedQuestionsFor(component, count) {
  const questions = studyQuestionBank.filter((question) => (
    question.routeId === routeId
    && Number(question.sourceRef?.component) === component
    && isHumanReviewedPastPaperItem(question)
  ))
  assert.ok(questions.length >= count, `the checked-in reviewed bank must provide ${count} P${component} fixtures`)
  return questions.slice(0, count)
}

const p1 = reviewedQuestionsFor(1, 4)
const p2 = reviewedQuestionsFor(2, 1)
const fixture = [
  remapQuestion(p1[0], topicA),
  remapQuestion(p2[0], topicA),
  remapQuestion(p1[1], topicB),
  remapQuestion(p1[2], topicB),
  remapQuestion(p1[3], unrelatedTopic),
]

function persistedUnitFromSet(set, id) {
  return {
    id,
    type: 'topic',
    sourceAuthority: 'server-syllabus',
    sourceGateVersion: 'server-syllabus-catalog-v2',
    routeId: set.routeId,
    stage: set.stage,
    knowledgeGroupId: set.syllabusTopicIds[0],
    syllabusTopic: set.syllabusTopicIds.join(','),
    paperComponent: set.components,
    studyMode: set.studyMode,
    sourcePreference: set.sourcePreference,
    practiceMode: set.practiceMode,
    parts: set.questionGroups.flatMap((group) => group.parts.map((part) => ({
      id: `${id}:${group.id}:${part.partId}`,
      sourceQuestionId: group.id,
      questionPartId: part.partId,
      markingProvenance: part.markingProvenance,
      sourceBindingProvenance: part.sourceBindingProvenance,
    }))),
  }
}

const api = createStemApi({
  env: {
    NODE_ENV: 'test',
    STEM_DB_PATH: ':memory:',
    STEM_IDENTITY_SIGNING_KEY: signingKey,
    STEM_MARKING_CAPABILITY_SIGNING_KEY: 'chapter-study-marking-capability-test-key',
  },
  questionBank: fixture,
})
const ownerToken = signedIdentityToken(101)

try {
  const inventoryResponse = await call(api, {
    method: 'GET',
    url: `/api/stem/routes/${routeId}/syllabus-topics`,
  })
  assert.equal(inventoryResponse.statusCode, 200)
  assert.deepEqual(inventoryResponse.payload.practicePolicy.chapterStudy, {
    mode: 'chapter-study',
    minSourceGroups: 1,
    maxSourceGroups: 15,
    countPolicy: 'cap-to-available',
    formalProgressEligible: false,
    sourcePreferences: ['official-first', 'original-foundation-only'],
  })

  const inventoryTopicA = inventoryResponse.payload.topics.find((topic) => topic.id === topicA)
  const inventoryTopicB = inventoryResponse.payload.topics.find((topic) => topic.id === topicB)
  const inventoryEmptyTopic = inventoryResponse.payload.topics.find((topic) => topic.id === emptyTopic)
  assert.deepEqual(inventoryTopicA.chapterStudy, {
    mode: 'chapter-study', available: 3, officialAvailable: 2, originalAvailable: 1, startable: true, fallbackKind: null,
  })
  assert.deepEqual(inventoryTopicA.componentCounts['1'].chapterStudy, {
    mode: 'chapter-study', available: 2, officialAvailable: 1, originalAvailable: 1, startable: true, fallbackKind: null,
  })
  assert.deepEqual(inventoryTopicA.componentCounts['2'].chapterStudy, {
    mode: 'chapter-study', available: 2, officialAvailable: 1, originalAvailable: 1, startable: true, fallbackKind: null,
  })
  assert.deepEqual(inventoryTopicB.chapterStudy, {
    mode: 'chapter-study', available: 3, officialAvailable: 2, originalAvailable: 1, startable: true, fallbackKind: null,
  })
  assert.ok(inventoryResponse.payload.chapterStudy.gapTopicIds.includes(emptyTopic), 'original fallback must not hide the official-content gap')
  assert.equal(inventoryResponse.payload.chapterStudy.startableTopicCount, inventoryResponse.payload.chapterStudy.topicCount)
  assert.deepEqual(inventoryEmptyTopic.chapterStudy, {
    mode: 'chapter-study', available: 1, officialAvailable: 0, originalAvailable: 1, startable: true, fallbackKind: 'original-foundation',
  })
  assert.equal(inventoryTopicA.ready, false, 'chapter study must not weaken the twelve-reviewed-group formal readiness gate')
  assert.equal(inventoryTopicA.ctaPolicy, 'hidden', 'legacy Topic Drill presentation remains formally gated')

  const oneQuestion = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId,
      syllabusTopicIds: [topicA],
      components: [1],
      questionCount: 1,
      studyMode: 'chapter-study',
      excludeAttempted: false,
      seed: 1,
    },
  })
  assert.equal(oneQuestion.statusCode, 201, oneQuestion.payload?.error)
  assert.equal(oneQuestion.payload.studyMode, 'chapter-study')
  assert.equal(oneQuestion.payload.practiceMode, 'study-only')
  assert.equal(oneQuestion.payload.formalProgressEligible, false)
  assert.equal(oneQuestion.payload.requestedCount, 1)
  assert.equal(oneQuestion.payload.available, 2)
  assert.equal(oneQuestion.payload.count, 1)
  assert.equal(oneQuestion.payload.limited, false)
  assert.equal(oneQuestion.payload.availableCount, 2)
  assert.equal(oneQuestion.payload.questionCount, 1)
  assert.equal(oneQuestion.payload.partial, false)
  assert.deepEqual(oneQuestion.payload.sourceAvailability, {
    official: 1, originalFoundation: 1, total: 2, selectedPool: 2,
  })
  assert.equal(oneQuestion.payload.ownerId, null)
  assert.deepEqual(oneQuestion.payload.coveredSyllabusTopicIds, [topicA])
  assert.ok(oneQuestion.payload.questionGroups.every((group) => (
    group.paperComponent === 1
    && group.reviewStatus === 'reviewed'
    && group.studyOnly === true
    && group.formalProgressEligible === false
    && group.syllabusMapping.topicIds.includes(topicA)
    && group.sourceContent.complete === true
    && group.sourceContent.fileComplete === true
    && group.questionNumber === group.sourceRef.question
    && /^[a-f0-9]{64}$/i.test(String(group.sourceRef.sha256 || ''))
    && /^[a-f0-9]{64}$/i.test(String(group.answerRef.sha256 || ''))
    && group.parts.every((part) => part.sourceBindingProvenance)
  )))

  const sparseChapter = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId,
      syllabusTopicIds: [topicB],
      components: [1],
      questionCount: 15,
      studyMode: 'chapter-study',
      excludeAttempted: false,
      seed: 2,
    },
  })
  assert.equal(sparseChapter.statusCode, 201, sparseChapter.payload?.error)
  assert.equal(sparseChapter.payload.available, 3)
  assert.equal(sparseChapter.payload.count, 3)
  assert.equal(sparseChapter.payload.limited, true)

  const multiChapter = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId,
      syllabusTopicIds: [topicA, topicB],
      components: [1],
      questionCount: 10,
      studyMode: 'chapter-study',
      excludeAttempted: false,
      seed: 3,
    },
  })
  assert.equal(multiChapter.statusCode, 201, multiChapter.payload?.error)
  assert.equal(multiChapter.payload.available, 5, 'multi-chapter availability must deduplicate official groups and count one original per selected chapter')
  assert.equal(multiChapter.payload.count, 5)
  assert.equal(multiChapter.payload.limited, true)
  assert.deepEqual(multiChapter.payload.sourceMix, { official: 3, originalFoundation: 2 })
  assert.deepEqual(new Set(multiChapter.payload.coveredSyllabusTopicIds), new Set([topicA, topicB]))
  assert.ok(multiChapter.payload.questionGroups.every((group) => (
    (group.sourceKind === 'original-foundation' || group.paperComponent === 1)
    && group.syllabusMapping.topicIds.some((topicId) => [topicA, topicB].includes(topicId))
    && !group.syllabusMapping.topicIds.includes(unrelatedTopic)
  )))

  const componentFiltered = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId,
      syllabusTopicIds: [topicA],
      components: [2],
      questionCount: 10,
      studyMode: 'chapter-study',
      excludeAttempted: false,
      seed: 4,
    },
  })
  assert.equal(componentFiltered.statusCode, 201, componentFiltered.payload?.error)
  assert.equal(componentFiltered.payload.available, 2)
  assert.equal(componentFiltered.payload.count, 2)
  assert.ok(componentFiltered.payload.questionGroups.every((group) => group.sourceKind === 'original-foundation' || group.paperComponent === 2))

  const emptyChapter = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId,
      syllabusTopicIds: [emptyTopic],
      components: [1],
      questionCount: 10,
      studyMode: 'chapter-study',
      excludeAttempted: false,
      seed: 5,
    },
  })
  assert.equal(emptyChapter.statusCode, 201, emptyChapter.payload?.error)
  assert.deepEqual(
    { available: emptyChapter.payload.available, count: emptyChapter.payload.count, limited: emptyChapter.payload.limited },
    { available: 1, count: 1, limited: true },
  )
  assert.deepEqual(emptyChapter.payload.sourceMix, { official: 0, originalFoundation: 1 })
  assert.deepEqual(emptyChapter.payload.sourceAvailability, {
    official: 0, originalFoundation: 1, total: 1, selectedPool: 1,
  })
  const originalGroup = emptyChapter.payload.questionGroups[0]
  assert.equal(originalGroup.sourceKind, 'original-foundation')
  assert.equal(originalGroup.sourceAuthority, 'original-foundation-catalog')
  assert.equal(originalGroup.displaySourceLabel, '原创基础练习')
  assert.equal(originalGroup.reviewStatus, 'original-authored')
  assert.equal(originalGroup.studyOnly, true)
  assert.equal(originalGroup.formalProgressEligible, false)
  assert.equal(originalGroup.sourceRef, undefined)
  assert.equal(originalGroup.answerRef, undefined)
  assert.equal(originalGroup.sourceContent, undefined)
  assert.equal(originalGroup.originalQuestion.topicId, emptyTopic)
  assert.equal(originalGroup.originalQuestion.answerType, 'single-choice')
  assert.ok(originalGroup.originalQuestion.options.length >= 3)
  assert.equal(originalGroup.originalQuestion.correctOptionId, undefined)
  assert.equal(originalGroup.solution, undefined)
  assert.deepEqual(originalGroup.answerContract, {
    schemaVersion: 'stem-original-foundation-answer-contract-v1',
    id: `${originalGroup.id}:answer:v1`,
    responseType: 'single-choice',
    submissionEndpoint: '/api/stem/original-foundation/submit',
    maxScore: 1,
    scoreScope: 'original-learning-only',
    reveal: 'after-submission',
  })
  const originalUnit = persistedUnitFromSet(emptyChapter.payload, 'syllabus-set:original-foundation-one-question')

  const selectedOptionId = originalGroup.originalQuestion.options[0].id
  const originalResult = await call(api, {
    method: 'POST',
    url: '/api/stem/original-foundation/submit',
    body: {
      routeId,
      syllabusTopicId: emptyTopic,
      questionId: originalGroup.id,
      response: { selectedOptionId },
    },
  })
  assert.equal(originalResult.statusCode, 200, originalResult.payload?.error)
  assert.equal(originalResult.payload.schemaVersion, 'stem-original-foundation-result-v1')
  assert.equal(originalResult.payload.sourceKind, 'original-foundation')
  assert.equal(originalResult.payload.displaySourceLabel, '原创基础练习')
  assert.equal(originalResult.payload.submitted, true)
  assert.equal(originalResult.payload.score, originalResult.payload.correct ? 1 : 0)
  assert.equal(originalResult.payload.maxScore, 1)
  assert.equal(originalResult.payload.scoreScope, 'original-learning-only')
  assert.equal(originalResult.payload.formalProgressEligible, false)
  assert.equal(originalResult.payload.countsTowardFormalGrade, false)
  assert.ok(originalResult.payload.correctOptionId)
  assert.ok(originalResult.payload.solution.summary)
  assert.equal(originalResult.payload.solution.markPoints.length, 1)

  const originalAttemptId = 'chapter-study-original-attempt-0001'
  const originalSubmittedAt = new Date().toISOString()
  const persistedOriginalAttempt = await call(api, {
    method: 'POST',
    url: '/api/stem/attempts',
    token: ownerToken,
    body: {
      attemptId: originalAttemptId,
      mode: 'topic',
      routeId,
      stage: 'AS',
      unitId: originalUnit.id,
      studyMode: 'chapter-study',
      sourcePreference: 'official-first',
      submittedAt: originalSubmittedAt,
      markingParts: originalUnit.parts.map((part) => ({
        unitPartId: part.id,
        provenance: { routeId, ...part.sourceBindingProvenance },
      })),
      attempt: {
        id: originalAttemptId,
        unitId: originalUnit.id,
        routeId,
        stage: 'AS',
        studyMode: 'chapter-study',
        sourcePreference: 'official-first',
        attemptStatus: 'study-result',
        answers: { [originalUnit.parts[0].id]: selectedOptionId },
        scoreResult: {
          rawMarks: originalResult.payload.score,
          maxMarks: originalResult.payload.maxScore,
          percentage: originalResult.payload.score * 100,
          partial: false,
          scoreScope: 'original-learning-only',
          formalProgressEligible: false,
          countsTowardFormalGrade: false,
        },
        formalResult: false,
      },
    },
  })
  assert.equal(persistedOriginalAttempt.statusCode, 201, persistedOriginalAttempt.payload?.error)
  assert.equal(persistedOriginalAttempt.payload.attempt.formalResult, false)
  const originalHistory = await call(api, {
    method: 'GET',
    url: '/api/stem/attempts',
    token: ownerToken,
  })
  assert.equal(originalHistory.statusCode, 200)
  const persistedOriginalHistory = originalHistory.payload.attempts.find((attempt) => attempt.attemptId === originalAttemptId)
  assert.equal(persistedOriginalHistory.binding.parts[0].sourceKind, 'original-foundation')
  assert.equal(persistedOriginalHistory.submissionStatus, 'submitted')
  assert.equal(persistedOriginalHistory.binding.mode, 'topic')
  assert.equal(persistedOriginalHistory.binding.routeId, routeId)
  assert.equal(persistedOriginalHistory.binding.stage, 'AS')
  assert.equal(persistedOriginalHistory.binding.studyMode, 'chapter-study')
  assert.equal(persistedOriginalHistory.binding.sourcePreference, 'official-first')
  assert.equal(persistedOriginalHistory.attempt.unitId, originalUnit.id)
  assert.equal(persistedOriginalHistory.attempt.studyMode, 'chapter-study')
  const originalAiCapability = await call(api, {
    method: 'POST',
    url: '/api/stem/marking/capabilities',
    token: ownerToken,
    body: {
      attemptId: originalAttemptId,
      mode: 'topic',
      submitted: true,
      parts: originalUnit.parts.map((part) => ({
        provenance: { routeId, ...part.sourceBindingProvenance },
      })),
    },
  })
  assert.equal(originalAiCapability.statusCode, 409)
  assert.equal(originalAiCapability.payload.code, 'original_foundation_ai_marking_unavailable')

  const mixedCapabilityUnit = persistedUnitFromSet(sparseChapter.payload, 'syllabus-set:mixed-capability-regression')
  const mixedAttemptId = 'chapter-study-mixed-attempt-0001'
  const persistedMixedAttempt = await call(api, {
    method: 'POST',
    url: '/api/stem/attempts',
    token: ownerToken,
    body: {
      attemptId: mixedAttemptId,
      mode: 'topic',
      routeId,
      stage: 'AS',
      unitId: mixedCapabilityUnit.id,
      studyMode: 'chapter-study',
      sourcePreference: 'official-first',
      submittedAt: new Date().toISOString(),
      markingParts: mixedCapabilityUnit.parts.map((part) => ({
        unitPartId: part.id,
        provenance: { routeId, ...(part.markingProvenance || part.sourceBindingProvenance) },
      })),
      attempt: {
        id: mixedAttemptId,
        unitId: mixedCapabilityUnit.id,
        routeId,
        stage: 'AS',
        studyMode: 'chapter-study',
        sourcePreference: 'official-first',
        attemptStatus: 'marking-pending',
      },
    },
  })
  assert.equal(persistedMixedAttempt.statusCode, 201, persistedMixedAttempt.payload?.error)
  const officialMixedPart = mixedCapabilityUnit.parts.find((part) => (
    !String(part.sourceQuestionId).startsWith('original-foundation:')
  ))
  assert.ok(officialMixedPart, 'mixed chapter study must retain an official part for marking-capability isolation')
  const mixedOfficialCapability = await call(api, {
    method: 'POST',
    url: '/api/stem/marking/capabilities',
    token: ownerToken,
    body: {
      attemptId: mixedAttemptId,
      mode: 'topic',
      submitted: true,
      parts: [{ provenance: { routeId, ...officialMixedPart.markingProvenance } }],
    },
  })
  assert.equal(mixedOfficialCapability.statusCode, 201, mixedOfficialCapability.payload?.error)
  assert.ok(mixedOfficialCapability.payload.capabilities?.[0]?.markingGrant)
  const originalMixedPart = mixedCapabilityUnit.parts.find((part) => (
    String(part.sourceQuestionId).startsWith('original-foundation:')
  ))
  assert.ok(originalMixedPart, 'mixed chapter study must retain its original foundation part')
  const focusedMixedOriginalUnit = {
    ...mixedCapabilityUnit,
    id: `${mixedCapabilityUnit.id}:focused:${originalMixedPart.id}`,
    focusedRetestOf: mixedCapabilityUnit.id,
    focusedRetestParentAttemptId: mixedAttemptId,
    parts: [originalMixedPart],
  }
  const reboundFocusedMixedOriginal = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets/rebind',
    token: ownerToken,
    body: { unit: syllabusPracticeRebindPayload(focusedMixedOriginalUnit) },
  })
  assert.equal(reboundFocusedMixedOriginal.statusCode, 200, reboundFocusedMixedOriginal.payload?.error)
  assert.equal(reboundFocusedMixedOriginal.payload.unit.focusedRetestValidated, true)
  assert.equal(reboundFocusedMixedOriginal.payload.unit.parts[0].sourceKind, 'original-foundation')

  const originalOnly = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId,
      syllabusTopicIds: [topicA],
      components: [1],
      questionCount: 10,
      studyMode: 'chapter-study',
      sourcePreference: 'original-foundation-only',
      excludeAttempted: false,
      seed: 6,
    },
  })
  assert.equal(originalOnly.statusCode, 201, originalOnly.payload?.error)
  assert.deepEqual(originalOnly.payload.sourceMix, { official: 0, originalFoundation: 1 })
  assert.deepEqual(originalOnly.payload.sourceAvailability, {
    official: 1, originalFoundation: 1, total: 2, selectedPool: 1,
  })
  assert.equal(originalOnly.payload.questionGroups[0].sourceKind, 'original-foundation')

  const invalidOriginalResponse = await call(api, {
    method: 'POST',
    url: '/api/stem/original-foundation/submit',
    body: {
      routeId,
      syllabusTopicId: emptyTopic,
      questionId: originalGroup.id,
      response: { selectedOptionId: 'Z' },
    },
  })
  assert.equal(invalidOriginalResponse.statusCode, 400)
  assert.equal(invalidOriginalResponse.payload.code, 'original_foundation_response_invalid')

  const twoEmptyChapters = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId,
      syllabusTopicIds: [emptyTopic, secondEmptyTopic],
      components: [1],
      questionCount: 10,
      studyMode: 'chapter-study',
      excludeAttempted: false,
      seed: 7,
    },
  })
  assert.equal(twoEmptyChapters.statusCode, 201, twoEmptyChapters.payload?.error)
  assert.deepEqual(twoEmptyChapters.payload.sourceMix, { official: 0, originalFoundation: 2 })
  assert.equal(twoEmptyChapters.payload.available, 2)
  assert.equal(twoEmptyChapters.payload.count, 2)
  assert.equal(new Set(twoEmptyChapters.payload.questionGroups.map((group) => group.originalQuestion.topicId)).size, 2)

  const tooSmallForSelectedChapters = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId,
      syllabusTopicIds: [emptyTopic, secondEmptyTopic],
      components: [1],
      questionCount: 1,
      studyMode: 'chapter-study',
    },
  })
  assert.equal(tooSmallForSelectedChapters.statusCode, 400)
  assert.equal(tooSmallForSelectedChapters.payload.code, 'invalid_question_count')

  const legacyOneQuestion = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId,
      syllabusTopicIds: [topicA],
      components: [1],
      questionCount: 1,
      excludeAttempted: false,
    },
  })
  assert.equal(legacyOneQuestion.statusCode, 400, 'legacy Topic Drill keeps its six-question minimum')
  assert.equal(legacyOneQuestion.payload.code, 'invalid_question_count')

  const invalidMode = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId,
      syllabusTopicIds: [topicA],
      components: [1],
      questionCount: 1,
      studyMode: 'assessment-bypass',
    },
  })
  assert.equal(invalidMode.statusCode, 400)
  assert.equal(invalidMode.payload.code, 'invalid_study_mode')

  const invalidSourcePreference = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId,
      syllabusTopicIds: [topicA],
      components: [1],
      questionCount: 1,
      studyMode: 'chapter-study',
      sourcePreference: 'unreviewed-anything',
    },
  })
  assert.equal(invalidSourcePreference.statusCode, 400)
  assert.equal(invalidSourcePreference.payload.code, 'invalid_source_preference')

  const sparseUnit = persistedUnitFromSet(oneQuestion.payload, 'syllabus-set:chapter-study-one-question')
  const compactSparseUnit = syllabusPracticeRebindPayload(sparseUnit)
  assert.equal(compactSparseUnit.studyMode, 'chapter-study', 'the sparse-study authority must survive the bounded draft/rebind payload')
  const rebound = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets/rebind',
    body: { unit: compactSparseUnit },
  })
  assert.equal(rebound.statusCode, 200, rebound.payload?.error)
  assert.equal(rebound.payload.unit.studyMode, 'chapter-study')
  assert.equal(rebound.payload.unit.questionGroupCount, 1)
  assert.equal(rebound.payload.unit.practiceMode, 'study-only')
  assert.equal(rebound.payload.unit.formalProgressEligible, false)

  const mixedSparseUnit = persistedUnitFromSet(sparseChapter.payload, 'syllabus-set:chapter-study-official-plus-original')
  const reboundMixedSparse = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets/rebind',
    body: { unit: syllabusPracticeRebindPayload(mixedSparseUnit) },
  })
  assert.equal(reboundMixedSparse.statusCode, 200, reboundMixedSparse.payload?.error)
  assert.deepEqual(reboundMixedSparse.payload.unit.sourceMix, { official: 2, originalFoundation: 1 })

  const forgedOriginalOnlyOfficialUnit = { ...compactSparseUnit, sourcePreference: 'original-foundation-only' }
  const forgedOriginalOnlyOfficialRebind = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets/rebind',
    body: { unit: forgedOriginalOnlyOfficialUnit },
  })
  assert.equal(forgedOriginalOnlyOfficialRebind.statusCode, 409, 'sourcePreference cannot be changed to contradict the persisted official source mix')
  assert.equal(forgedOriginalOnlyOfficialRebind.payload.code, 'stale_syllabus_practice_set')

  const reboundOriginal = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets/rebind',
    body: { unit: syllabusPracticeRebindPayload(originalUnit) },
  })
  assert.equal(reboundOriginal.statusCode, 200, reboundOriginal.payload?.error)
  assert.equal(reboundOriginal.payload.unit.questionGroupCount, 1)
  assert.equal(reboundOriginal.payload.unit.parts[0].sourceKind, 'original-foundation')
  assert.equal(reboundOriginal.payload.unit.parts[0].displaySourceLabel, '原创基础练习')
  assert.equal(reboundOriginal.payload.unit.formalProgressEligible, false)

  const focusedOriginalUnit = {
    ...originalUnit,
    id: `${originalUnit.id}:focused:${originalUnit.parts[0].id}`,
    focusedRetestOf: originalUnit.id,
    focusedRetestParentAttemptId: originalAttemptId,
    parts: [originalUnit.parts[0]],
  }
  const reboundFocusedOriginal = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets/rebind',
    token: ownerToken,
    body: { unit: syllabusPracticeRebindPayload(focusedOriginalUnit) },
  })
  assert.equal(reboundFocusedOriginal.statusCode, 200, reboundFocusedOriginal.payload?.error)
  assert.equal(reboundFocusedOriginal.payload.unit.focusedRetestValidated, true)
  assert.equal(reboundFocusedOriginal.payload.unit.questionGroupCount, 1)

  const legacySparseUnit = { ...compactSparseUnit, studyMode: '' }
  const legacyRebind = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets/rebind',
    body: { unit: legacySparseUnit },
  })
  assert.equal(legacyRebind.statusCode, 409, 'a caller cannot bypass the Topic Drill floor without the explicit chapter-study authority')
  assert.equal(legacyRebind.payload.code, 'stale_syllabus_practice_set')
} finally {
  closeStemDatabaseForTests()
}

console.log(JSON.stringify({ status: 'passed', scope: 'chapter-study-contract' }))
