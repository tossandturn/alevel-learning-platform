import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { isHumanReviewedPastPaperItem, studyQuestionBank } from '../src/data/questionBank.js'
import { MIN_QUESTION_GROUPS_PER_TEST, MIN_VERIFIED_GROUPS_FOR_PRACTICE, isStartableTopicPracticeUnit } from '../src/lib/practiceConstants.js'
import { buildSyllabusPracticeSet, rebindSyllabusPracticeUnit, syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'

const routeId = 'cie-9702-as-physics'
const stage = 'AS'
const signingKey = 'topic-drill-per-topic-authority-test-key'
const topicIds = ['physics-9702-topic-01', 'physics-9702-topic-02']

function signedIdentityToken(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: `ielts:${userId}`,
    username: `topic-drill-${userId}`,
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

function reviewedFixture(countByTopic) {
  const reviewed = studyQuestionBank.filter((question) => (
    question.routeId === routeId
    && [1, 2].includes(Number(question.sourceRef?.component))
    && isHumanReviewedPastPaperItem(question)
  ))
  const required = Object.values(countByTopic).reduce((sum, count) => sum + count, 0)
  assert.ok(reviewed.length >= required, 'the checked-in reviewed bank must provide enough source groups for the synthetic authority fixture')
  let offset = 0
  return Object.entries(countByTopic).flatMap(([topicId, count]) => reviewed.slice(offset, offset += count).map((question) => ({
    ...question,
    knowledgeGroupId: topicId,
    syllabusMapping: {
      ...(question.syllabusMapping || {}),
      primaryTopicId: topicId,
      secondaryTopicIds: [],
      topicIds: [topicId],
      reviewStatus: 'reviewed',
      reviewedBy: 'synthetic-authority-regression',
      reviewedAt: '2026-09-01T00:00:00.000Z',
    },
  })))
}

function persistedUnitFromSet(set, id = 'syllabus-set:synthetic-parent') {
  return {
    id,
    type: 'topic',
    sourceAuthority: 'server-syllabus',
    sourceGateVersion: 'server-syllabus-catalog-v2',
    routeId: set.routeId,
    stage,
    knowledgeGroupId: set.syllabusTopicIds[0],
    syllabusTopic: set.syllabusTopicIds.join(','),
    paperComponent: set.components,
    practiceMode: set.practiceMode,
    parts: set.questionGroups.flatMap((group) => group.parts.map((part) => ({
      id: `${id}:${group.id}:${part.partId}`,
      sourceQuestionId: group.id,
      questionPartId: part.partId,
      sourceBindingProvenance: part.sourceBindingProvenance,
    }))),
  }
}

const fivePlusFiveFixture = reviewedFixture({ [topicIds[0]]: 5, [topicIds[1]]: 5 })
const fivePlusFiveInventory = syllabusTopicsInventory({ routeId, questionBank: fivePlusFiveFixture, includeStudyOnly: false })
assert.deepEqual(
  topicIds.map((topicId) => fivePlusFiveInventory.topics.find((topic) => topic.id === topicId)?.verifiedQuestionCount),
  [5, 5],
  'count/list inventory must retain each selected topic count instead of only a combined total',
)
assert.ok(
  topicIds.every((topicId) => fivePlusFiveInventory.topics.find((topic) => topic.id === topicId)?.ready === false),
  'count/list must not mark either five-group topic formally ready',
)

const fivePlusFiveSet = buildSyllabusPracticeSet({
  routeId,
  syllabusTopicIds: topicIds,
  components: [1, 2],
  questionCount: MIN_QUESTION_GROUPS_PER_TEST,
  questionBank: fivePlusFiveFixture,
  includeStudyOnly: false,
  excludeAttempted: false,
  seed: 101,
})
assert.equal(fivePlusFiveSet.verifiedAvailableCount, 10, 'the synthetic fixture must reproduce the aggregate-count bypass')
assert.equal(fivePlusFiveSet.practiceMode, 'unavailable', 'two selected five-group topics must not become a verified Topic Drill by aggregation or be relabelled as study-only')
assert.equal(fivePlusFiveSet.formalProgressEligible, false)
assert.ok(fivePlusFiveSet.questionGroups.every((group) => group.formalProgressEligible === true), 'individual reviewed source bindings stay intact even though the aggregate set is not startable')

const fivePlusFivePersistedUnit = persistedUnitFromSet(fivePlusFiveSet, 'syllabus-set:synthetic-five-plus-five')
const fivePlusFiveRebound = rebindSyllabusPracticeUnit(fivePlusFivePersistedUnit, {
  questionBank: fivePlusFiveFixture,
  includeStudyOnly: false,
})
assert.equal(fivePlusFiveRebound, null, 'a reviewed-only set below either selected topic floor must not be restored as a study-only bypass')

const formalFixture = reviewedFixture({
  [topicIds[0]]: MIN_VERIFIED_GROUPS_FOR_PRACTICE,
  [topicIds[1]]: MIN_VERIFIED_GROUPS_FOR_PRACTICE,
})
const formalSingleTopicSet = buildSyllabusPracticeSet({
  routeId,
  syllabusTopicIds: [topicIds[0]],
  components: [1, 2],
  questionCount: MIN_QUESTION_GROUPS_PER_TEST,
  questionBank: formalFixture,
  includeStudyOnly: false,
  excludeAttempted: false,
  seed: 102,
})
assert.equal(formalSingleTopicSet.practiceMode, 'verified', 'one topic at the shared reviewed floor must remain formally eligible')
assert.equal(formalSingleTopicSet.formalProgressEligible, true)
assert.ok(formalSingleTopicSet.questionGroups.every((group) => group.studyOnly === false && group.formalProgressEligible === true))

let providerCalls = 0
const fivePlusFiveApi = createStemApi({
  env: { NODE_ENV: 'test', STEM_DB_PATH: ':memory:' },
  questionBank: fivePlusFiveFixture,
})
try {
  const fivePlusFiveStart = await call(fivePlusFiveApi, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId,
      syllabusTopicIds: topicIds,
      components: [1, 2],
      questionCount: MIN_QUESTION_GROUPS_PER_TEST,
      excludeAttempted: false,
      seed: 101,
    },
  })
  assert.equal(fivePlusFiveStart.statusCode, 409, 'the start boundary must reject reviewed-only pools that fall below either selected topic floor')
  assert.equal(fivePlusFiveStart.payload.code, 'insufficient_verified_questions')

  const apiInventory = await call(fivePlusFiveApi, { method: 'GET', url: `/api/stem/routes/${routeId}/syllabus-topics` })
  assert.equal(apiInventory.statusCode, 200)
  assert.ok(
    topicIds.every((topicId) => apiInventory.payload.topics.find((topic) => topic.id === topicId)?.ready === false),
    `the HTTP count/list route must use the same per-topic formal predicate as start: ${JSON.stringify(topicIds.map((topicId) => apiInventory.payload.topics.find((topic) => topic.id === topicId)))}`,
  )
} finally {
  closeStemDatabaseForTests()
}

const api = createStemApi({
  env: { NODE_ENV: 'test', STEM_DB_PATH: ':memory:', STEM_IDENTITY_SIGNING_KEY: signingKey },
  questionBank: formalFixture,
  topicQuestionBankProvider: () => {
    providerCalls += 1
    return formalFixture
  },
})
const ownerToken = signedIdentityToken(101)
const otherToken = signedIdentityToken(202)
try {
  const apiInventory = await call(api, { method: 'GET', url: `/api/stem/routes/${routeId}/syllabus-topics` })
  assert.equal(apiInventory.statusCode, 200)
  assert.ok(
    topicIds.every((topicId) => apiInventory.payload.topics.find((topic) => topic.id === topicId)?.ready === true),
    'the formal fixture must prove each selected topic independently reaches the shared floor',
  )

  const formalStart = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId,
      syllabusTopicIds: topicIds,
      components: [1, 2],
      questionCount: MIN_QUESTION_GROUPS_PER_TEST,
      excludeAttempted: false,
      seed: 102,
    },
  })
  assert.equal(formalStart.statusCode, 201, formalStart.payload?.error)
  assert.equal(formalStart.payload.practiceMode, 'verified')
  assert.equal(formalStart.payload.formalProgressEligible, true)

  const parentUnit = persistedUnitFromSet(formalStart.payload, 'syllabus-set:authoritative-parent')
  const forgedFocusedUnit = {
    ...parentUnit,
    id: `${parentUnit.id}:focused:${parentUnit.parts[0].id}`,
    focusedRetestOf: parentUnit.id,
    focusedRetestParentAttemptId: 'att-not-issued-parent',
    focusedRetestValidated: true,
    parts: [parentUnit.parts[0]],
  }
  providerCalls = 0
  const forgedFocused = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets/rebind',
    token: ownerToken,
    body: { unit: forgedFocusedUnit, parentUnit },
  })
  assert.equal(forgedFocused.statusCode, 409, 'an unissued parent attempt must not authorize a focused retest')
  assert.equal(forgedFocused.payload.code, 'focused_retest_parent_unavailable')
  assert.equal(providerCalls, 0, 'a forged client parent must be rejected before the runtime source provider is invoked')
  assert.equal(forgedFocused.payload.unit, undefined)
  assert.equal(isStartableTopicPracticeUnit(forgedFocusedUnit), false, 'a client-declared focused retest cannot pass the normal start gate')

  const parentAttemptId = 'att-authoritative-parent-0001'
  const persistedParent = await call(api, {
    method: 'POST',
    url: '/api/stem/attempts',
    token: ownerToken,
    body: {
      attemptId: parentAttemptId,
      mode: 'topic',
      routeId,
      stage,
      unitId: parentUnit.id,
      submittedAt: '2026-09-01T00:00:00.000Z',
      markingParts: parentUnit.parts.map((part) => ({
        unitPartId: part.id,
        provenance: { routeId, ...part.sourceBindingProvenance },
      })),
      attempt: {
        id: parentAttemptId,
        unitId: parentUnit.id,
        routeId,
        stage,
        attemptStatus: 'result',
      },
    },
  })
  assert.equal(persistedParent.statusCode, 201, persistedParent.payload?.error)

  const trustedFocusedUnit = {
    ...parentUnit,
    id: `${parentUnit.id}:focused:${parentUnit.parts[0].id}`,
    focusedRetestOf: parentUnit.id,
    focusedRetestParentAttemptId: parentAttemptId,
    parts: [parentUnit.parts[0]],
  }
  const validFocused = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets/rebind',
    token: ownerToken,
    body: { unit: trustedFocusedUnit },
  })
  assert.equal(validFocused.statusCode, 200, validFocused.payload?.error)
  assert.equal(validFocused.payload.unit.focusedRetestValidated, true)
  assert.equal(validFocused.payload.unit.focusedRetestOf, parentUnit.id)
  assert.ok(isStartableTopicPracticeUnit(validFocused.payload.unit, { allowFocusedRetest: true }))

  providerCalls = 0
  const crossAccountFocused = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets/rebind',
    token: otherToken,
    body: { unit: trustedFocusedUnit, parentUnit },
  })
  assert.equal(crossAccountFocused.statusCode, 409, 'a parent attempt must stay bound to its owning student')
  assert.equal(crossAccountFocused.payload.code, 'focused_retest_parent_unavailable')
  assert.equal(providerCalls, 0, 'a cross-account parent lookup must stop before the runtime source provider')
} finally {
  closeStemDatabaseForTests()
}

console.log('Per-topic Topic Drill and focused-parent authority regression passed.')
