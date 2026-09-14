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
    && Number(question.sourceRef?.component) === 1
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

const sevenPlusFiveFixture = reviewedFixture({ [topicIds[0]]: 7, [topicIds[1]]: 5 })
const sevenPlusFiveInventory = syllabusTopicsInventory({ routeId, questionBank: sevenPlusFiveFixture, includeStudyOnly: false })
assert.deepEqual(
  topicIds.map((topicId) => sevenPlusFiveInventory.topics.find((topic) => topic.id === topicId)?.verifiedQuestionCount),
  [7, 5],
  'count/list inventory must retain each selected topic count instead of only a combined total',
)
assert.ok(
  topicIds.every((topicId) => sevenPlusFiveInventory.topics.find((topic) => topic.id === topicId)?.ready === false),
  'count/list must not mark either under-twelve topic formally ready',
)
assert.equal(sevenPlusFiveInventory.practicePolicy.allowCrossTopicStudy, true)

const sevenPlusFiveSet = buildSyllabusPracticeSet({
  routeId,
  syllabusTopicIds: topicIds,
  components: [1],
  questionCount: MIN_QUESTION_GROUPS_PER_TEST,
  questionBank: sevenPlusFiveFixture,
  includeStudyOnly: false,
  excludeAttempted: false,
  seed: 101,
})
assert.equal(sevenPlusFiveSet.verifiedAvailableCount, 12, 'the synthetic fixture must reproduce the reported 7 + 5 cross-topic pool')
assert.equal(sevenPlusFiveSet.practicePolicy.allowCrossTopicStudy, true)
assert.equal(sevenPlusFiveSet.practiceMode, 'study-only', 'a deduplicated API-ready cross-topic pool may start only as study')
assert.equal(sevenPlusFiveSet.formalProgressEligible, false)
assert.ok(sevenPlusFiveSet.questionGroups.every((group) => group.studyOnly === true && group.formalProgressEligible === false))
assert.ok(sevenPlusFiveSet.questionGroups.every((group) => group.paperComponent === 1), 'P1 cross-topic study must never backfill from P2')
assert.ok(topicIds.every((topicId) => sevenPlusFiveSet.questionGroups.some((group) => group.syllabusMapping.topicIds.includes(topicId))), 'the default set must cover every selected topic')

const sevenPlusFivePersistedUnit = persistedUnitFromSet(sevenPlusFiveSet, 'syllabus-set:synthetic-seven-plus-five')
const sevenPlusFiveRebound = rebindSyllabusPracticeUnit(sevenPlusFivePersistedUnit, {
  questionBank: sevenPlusFiveFixture,
  includeStudyOnly: false,
})
assert.equal(sevenPlusFiveRebound?.practiceMode, 'study-only', 'an authorized cross-topic study set must restore without becoming formal progress')
assert.equal(sevenPlusFiveRebound?.formalProgressEligible, false)

const singleFiveSet = buildSyllabusPracticeSet({
  routeId,
  syllabusTopicIds: [topicIds[1]],
  components: [1],
  questionCount: MIN_QUESTION_GROUPS_PER_TEST,
  questionBank: sevenPlusFiveFixture,
  includeStudyOnly: false,
  excludeAttempted: false,
  seed: 101,
})
assert.equal(singleFiveSet.practiceMode, 'unavailable', 'a single five-question topic must remain blocked')

const sharedFiveFixture = reviewedFixture({ [topicIds[0]]: 5 }).map((question) => ({
  ...question,
  syllabusMapping: {
    ...question.syllabusMapping,
    secondaryTopicIds: [topicIds[1]],
    topicIds,
  },
}))
const sharedFiveSet = buildSyllabusPracticeSet({
  routeId,
  syllabusTopicIds: topicIds,
  components: [1],
  questionCount: MIN_QUESTION_GROUPS_PER_TEST,
  questionBank: sharedFiveFixture,
  includeStudyOnly: false,
  excludeAttempted: false,
  seed: 101,
})
assert.equal(sharedFiveSet.availableCount, 5, 'cross-topic readiness must deduplicate shared source IDs')
assert.equal(sharedFiveSet.practiceMode, 'unavailable', 'duplicating five sources across two topic memberships must not reach the six-source floor')

const sevenTopicIds = syllabusTopicsInventory({ routeId, questionBank: [], includeStudyOnly: false }).topics.slice(0, 7).map((topic) => topic.id)
const sixSharedAcrossSevenFixture = reviewedFixture({ [sevenTopicIds[0]]: 6 }).map((question) => ({
  ...question,
  syllabusMapping: {
    ...question.syllabusMapping,
    primaryTopicId: sevenTopicIds[0],
    secondaryTopicIds: sevenTopicIds.slice(1),
    topicIds: sevenTopicIds,
  },
}))
const sixAcrossSevenSet = buildSyllabusPracticeSet({
  routeId,
  syllabusTopicIds: sevenTopicIds,
  components: [1],
  questionCount: MIN_QUESTION_GROUPS_PER_TEST,
  questionBank: sixSharedAcrossSevenFixture,
  includeStudyOnly: false,
  excludeAttempted: false,
  seed: 101,
})
assert.equal(sixAcrossSevenSet.practiceMode, 'unavailable', 'a six-question request cannot claim coverage of seven selected topics even through shared mappings')

const formalFixture = reviewedFixture({
  [topicIds[0]]: MIN_VERIFIED_GROUPS_FOR_PRACTICE,
  [topicIds[1]]: MIN_VERIFIED_GROUPS_FOR_PRACTICE,
})
const formalSingleTopicSet = buildSyllabusPracticeSet({
  routeId,
  syllabusTopicIds: [topicIds[0]],
  components: [1],
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
const sevenPlusFiveApi = createStemApi({
  env: { NODE_ENV: 'test', STEM_DB_PATH: ':memory:' },
  questionBank: sevenPlusFiveFixture,
})
try {
  const sevenPlusFiveStart = await call(sevenPlusFiveApi, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId,
      syllabusTopicIds: topicIds,
      components: [1],
      questionCount: MIN_QUESTION_GROUPS_PER_TEST,
      excludeAttempted: false,
      seed: 101,
    },
  })
  assert.equal(sevenPlusFiveStart.statusCode, 201, sevenPlusFiveStart.payload?.error)
  assert.equal(sevenPlusFiveStart.payload.practiceMode, 'study-only')
  assert.equal(sevenPlusFiveStart.payload.formalProgressEligible, false)
  assert.ok(topicIds.every((topicId) => sevenPlusFiveStart.payload.questionGroups.some((group) => group.syllabusMapping.topicIds.includes(topicId))))

  const singleFiveStart = await call(sevenPlusFiveApi, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId,
      syllabusTopicIds: [topicIds[1]],
      components: [1],
      questionCount: MIN_QUESTION_GROUPS_PER_TEST,
      excludeAttempted: false,
      seed: 101,
    },
  })
  assert.equal(singleFiveStart.statusCode, 409, 'single-topic study still requires six distinct sources')
  assert.equal(singleFiveStart.payload.code, 'insufficient_verified_questions')

  const apiInventory = await call(sevenPlusFiveApi, { method: 'GET', url: `/api/stem/routes/${routeId}/syllabus-topics` })
  assert.equal(apiInventory.statusCode, 200)
  assert.equal(apiInventory.payload.practicePolicy.allowCrossTopicStudy, true)
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
      components: [1],
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
