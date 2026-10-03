import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { isHumanReviewedPastPaperItem, studyQuestionBank } from '../src/data/questionBank.js'
import { syllabusPracticeRebindPayload } from '../src/lib/syllabusPracticeRebind.js'

const routeId = 'cie-9702-as-physics'
const officialTopicId = 'physics-9702-topic-01'
const emptyTopicId = 'physics-9702-topic-04'
const signingKey = 'chapter-study-v2-contract-signing-key'

function token(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: `ielts:${userId}`, username: `v2-${userId}`, iat: now, exp: now + 300,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function call(api, { method, url, body, authorization = '' }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body), 'utf8')] : [])
    request.method = method
    request.url = url
    request.headers = {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
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

function reviewedFixture() {
  const question = studyQuestionBank.find((candidate) => (
    candidate.routeId === routeId
    && Number(candidate.sourceRef?.component) === 1
    && isHumanReviewedPastPaperItem(candidate)
  ))
  assert.ok(question)
  return [{
    ...question,
    knowledgeGroupId: officialTopicId,
    syllabusMapping: {
      ...(question.syllabusMapping || {}),
      primaryTopicId: officialTopicId,
      secondaryTopicIds: [],
      topicIds: [officialTopicId],
      reviewStatus: 'reviewed',
      reviewedBy: 'chapter-study-v2-contract',
      reviewedAt: '2026-10-04T00:00:00.000Z',
    },
  }]
}

function unitFromSet(set, id) {
  return {
    id,
    type: 'topic',
    sourceAuthority: 'server-syllabus',
    sourceGateVersion: 'server-syllabus-catalog-v2',
    routeId: set.routeId,
    stage: set.stage,
    knowledgeGroupId: set.selectedSyllabusTopicIds[0],
    syllabusTopic: set.selectedSyllabusTopicIds.join(','),
    paperComponent: set.components,
    studyMode: set.studyMode,
    sourcePreference: set.sourcePreference,
    foundationCatalog: set.foundationCatalog,
    practiceMode: set.practiceMode,
    parts: set.questionGroups.flatMap((group) => group.parts.map((part) => ({
      id: `${id}:${group.id}:${part.partId}`,
      sourceQuestionId: group.id,
      questionPartId: part.partId,
      sourceKind: part.sourceKind,
      originalQuestionId: part.originalQuestionId,
      originalCatalogVersion: part.originalCatalogVersion,
      foundationCatalog: part.foundationCatalog,
      itemKind: part.itemKind,
      skillFocus: part.skillFocus,
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
    STEM_MARKING_CAPABILITY_SIGNING_KEY: 'chapter-study-v2-marking-key',
  },
  questionBank: reviewedFixture(),
})
const ownerToken = token(3101)

try {
  const legacyInventory = await call(api, { method: 'GET', url: `/api/stem/routes/${routeId}/syllabus-topics` })
  assert.equal(legacyInventory.statusCode, 200)
  assert.equal(legacyInventory.payload.chapterStudy.catalogVersion, 'v1')
  assert.equal(legacyInventory.payload.chapterStudy.foundationCatalog, undefined)
  assert.equal(legacyInventory.payload.topics.find((topic) => topic.id === emptyTopicId).chapterStudy.originalAvailable, 1)

  const v2Inventory = await call(api, { method: 'GET', url: `/api/stem/routes/${routeId}/syllabus-topics?foundationCatalog=v2` })
  assert.equal(v2Inventory.statusCode, 200, v2Inventory.payload?.error)
  assert.equal(v2Inventory.payload.chapterStudy.catalogVersion, 'v2')
  assert.equal(v2Inventory.payload.chapterStudy.foundationCatalog, 'v2')
  assert.equal(v2Inventory.payload.topics.find((topic) => topic.id === emptyTopicId).chapterStudy.originalAvailable, 3)
  assert.equal(v2Inventory.payload.topics.find((topic) => topic.id === officialTopicId).chapterStudy.available, 4)

  const invalidInventory = await call(api, { method: 'GET', url: `/api/stem/routes/${routeId}/syllabus-topics?foundationCatalog=preview` })
  assert.equal(invalidInventory.statusCode, 400)
  assert.equal(invalidInventory.payload.code, 'invalid_foundation_catalog')

  const legacySet = await call(api, {
    method: 'POST', url: '/api/stem/practice-sets',
    body: { routeId, syllabusTopicIds: [emptyTopicId], components: [1], questionCount: 1, studyMode: 'chapter-study' },
  })
  assert.equal(legacySet.statusCode, 201)
  assert.equal(legacySet.payload.foundationCatalog, undefined)
  assert.equal(legacySet.payload.questionGroups[0].id, `original-foundation:${routeId}:${emptyTopicId}:v1`)

  const v2Set = await call(api, {
    method: 'POST', url: '/api/stem/practice-sets',
    body: {
      routeId, syllabusTopicIds: [emptyTopicId], components: [1], questionCount: 3,
      studyMode: 'chapter-study', foundationCatalog: 'v2', excludeAttempted: false,
    },
  })
  assert.equal(v2Set.statusCode, 201, v2Set.payload?.error)
  assert.equal(v2Set.payload.foundationCatalog, 'v2')
  assert.equal(v2Set.payload.available, 3)
  assert.equal(v2Set.payload.count, 3)
  assert.equal(v2Set.payload.limited, false)
  assert.deepEqual(v2Set.payload.sourceMix, { official: 0, originalFoundation: 3 })
  assert.deepEqual(v2Set.payload.questionGroups.map((group) => group.itemKind), ['concept', 'application', 'transfer'])
  assert.deepEqual(v2Set.payload.questionGroups.map((group) => group.skillFocus), ['retrieve', 'apply', 'transfer'])
  assert.ok(v2Set.payload.questionGroups.every((group) => (
    group.foundationCatalog === 'v2'
    && group.originalQuestion.schemaVersion === 'stem-original-foundation-question-v2'
    && group.answerContract.schemaVersion === 'stem-original-foundation-answer-contract-v2'
    && group.parts[0].sourceBindingProvenance.schemaVersion === 'stem-original-foundation-binding-v2'
    && group.formalProgressEligible === false
  )))

  const unseenFirst = await call(api, {
    method: 'POST', url: '/api/stem/practice-sets',
    body: {
      routeId, syllabusTopicIds: [emptyTopicId], components: [1], questionCount: 1,
      studyMode: 'chapter-study', foundationCatalog: 'v2', excludeAttempted: true,
      attemptedQuestionIds: [v2Set.payload.questionGroups.find((group) => group.itemKind === 'concept').id],
    },
  })
  assert.equal(unseenFirst.statusCode, 201)
  assert.equal(unseenFirst.payload.available, 3)
  assert.equal(unseenFirst.payload.count, 1)
  assert.equal(unseenFirst.payload.questionGroups[0].itemKind, 'application', 'v2 selection must prefer an unseen kind before repeating concept')

  const mixedSet = await call(api, {
    method: 'POST', url: '/api/stem/practice-sets',
    body: {
      routeId, syllabusTopicIds: [officialTopicId], components: [1], questionCount: 4,
      studyMode: 'chapter-study', foundationCatalog: 'v2', excludeAttempted: false,
    },
  })
  assert.equal(mixedSet.statusCode, 201)
  assert.equal(mixedSet.payload.available, 4)
  assert.deepEqual(mixedSet.payload.sourceMix, { official: 1, originalFoundation: 3 })

  const applicationGroup = v2Set.payload.questionGroups.find((group) => group.itemKind === 'application')
  const selectedOptionId = applicationGroup.originalQuestion.options[0].id
  const scored = await call(api, {
    method: 'POST', url: '/api/stem/original-foundation/submit',
    body: {
      foundationCatalog: 'v2', routeId, syllabusTopicId: emptyTopicId, questionId: applicationGroup.id,
      response: { selectedOptionId },
    },
  })
  assert.equal(scored.statusCode, 200)
  assert.equal(scored.payload.schemaVersion, 'stem-original-foundation-result-v2')
  assert.equal(scored.payload.foundationCatalog, 'v2')
  assert.equal(scored.payload.itemKind, 'application')
  assert.equal(scored.payload.skillFocus, 'apply')
  assert.equal(scored.payload.formalProgressEligible, false)
  assert.equal(scored.payload.countsTowardFormalGrade, false)
  assert.ok(scored.payload.solution.explanation)
  assert.ok(scored.payload.feedback.nextStep)

  const v2Unit = unitFromSet(v2Set.payload, 'syllabus-set:v2-originals')
  const rebound = await call(api, {
    method: 'POST', url: '/api/stem/practice-sets/rebind',
    body: { unit: syllabusPracticeRebindPayload(v2Unit) },
  })
  assert.equal(rebound.statusCode, 200, rebound.payload?.error)
  assert.equal(rebound.payload.unit.foundationCatalog, 'v2')
  assert.equal(rebound.payload.unit.questionGroupCount, 3)
  assert.deepEqual(new Set(rebound.payload.unit.parts.map((part) => part.itemKind)), new Set(['concept', 'application', 'transfer']))

  const attemptId = 'chapter-study-v2-attempt-0001'
  const persisted = await call(api, {
    method: 'POST', url: '/api/stem/attempts', authorization: ownerToken,
    body: {
      attemptId, mode: 'topic', routeId, stage: 'AS', unitId: v2Unit.id,
      studyMode: 'chapter-study', sourcePreference: 'official-first', foundationCatalog: 'v2',
      submittedAt: new Date().toISOString(),
      markingParts: v2Unit.parts.map((part) => ({ unitPartId: part.id, provenance: { routeId, ...part.sourceBindingProvenance } })),
      attempt: {
        id: attemptId, unitId: v2Unit.id, routeId, stage: 'AS', studyMode: 'chapter-study',
        sourcePreference: 'official-first', foundationCatalog: 'v2', attemptStatus: 'study-result', formalResult: false,
      },
    },
  })
  assert.equal(persisted.statusCode, 201, persisted.payload?.error)
  const history = await call(api, { method: 'GET', url: '/api/stem/attempts', authorization: ownerToken })
  const record = history.payload.attempts.find((attempt) => attempt.attemptId === attemptId)
  assert.equal(record.binding.foundationCatalog, 'v2')
  assert.equal(record.attempt.foundationCatalog, 'v2')
  assert.ok(record.binding.parts.every((part) => part.provenance.schemaVersion === 'stem-original-foundation-binding-v2'))

  const mismatchedAttempt = await call(api, {
    method: 'POST', url: '/api/stem/attempts', authorization: ownerToken,
    body: {
      attemptId: 'chapter-study-v2-mismatch-0001', mode: 'topic', routeId, stage: 'AS', unitId: v2Unit.id,
      studyMode: 'chapter-study', sourcePreference: 'official-first', foundationCatalog: 'v2', markingParts: [],
      attempt: { id: 'chapter-study-v2-mismatch-0001', unitId: v2Unit.id, foundationCatalog: 'v1' },
    },
  })
  assert.equal(mismatchedAttempt.statusCode, 409)
  assert.equal(mismatchedAttempt.payload.code, 'attempt_binding_mismatch')
} finally {
  closeStemDatabaseForTests()
}

console.log(JSON.stringify({ status: 'passed', scope: 'chapter-study-v2-contract' }))
