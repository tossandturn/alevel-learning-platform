import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { isHumanReviewedPastPaperItem, studyQuestionBank, unifiedQuestionBank } from '../src/data/questionBank.js'
import { buildSyllabusPracticeSet, rebindSyllabusPracticeUnit, syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'
import { buildVerifiedPracticeCatalog, coachPracticeOptions, rebindVerifiedPracticeUnit } from '../src/lib/verifiedPracticeCatalog.js'
import {
  MIN_QUESTION_GROUPS_PER_TEST,
  MIN_TESTS_PER_TOPIC,
  MIN_VERIFIED_GROUPS_FOR_PRACTICE,
  isStartableTopicPracticeUnit,
} from '../src/lib/practiceConstants.js'

function call(api, { method, url, body }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body), 'utf8')] : [])
    request.method = method
    request.url = url
    request.headers = body ? { 'content-type': 'application/json' } : {}
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name.toLowerCase()] = value },
      end(raw = '') {
        const text = String(raw || '')
        resolve({ statusCode: this.statusCode, payload: text ? JSON.parse(text) : null })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

const underFloorQuestionIds = new Set([
  'cie-9702-9702_s25_qp_23:q2',
  'cie-9702-9702_w25_qp_22:q3',
])
const underFloorQuestionBank = unifiedQuestionBank.filter((question) => !underFloorQuestionIds.has(question.sourceQuestionId))
const verifiedApi = createStemApi({
  env: { NODE_ENV: 'production', STEM_DB_PATH: ':memory:' },
  questionBank: underFloorQuestionBank,
})
try {
  const asInventory = syllabusTopicsInventory({ routeId: 'cie-9702-as-physics', questionBank: underFloorQuestionBank })
  assert.equal(MIN_VERIFIED_GROUPS_FOR_PRACTICE, MIN_QUESTION_GROUPS_PER_TEST * MIN_TESTS_PER_TOPIC)
  assert.equal(asInventory.ready, false, 'the route must remain unavailable while any official topic cannot supply two six-question tests')
  const tenGroupTopic = asInventory.topics.find((topic) => topic.id === 'physics-9702-topic-06')
  assert.ok(tenGroupTopic, 'the official 9702 AS topic must remain present')
  assert.equal(tenGroupTopic.verifiedQuestionCount, 10, 'the under-floor fixture must expose exactly ten reviewed groups')
  assert.equal(tenGroupTopic.ready, false, 'ten reviewed groups cannot supply two disjoint six-question tests')
  assert.equal(tenGroupTopic.ctaPolicy, 'hidden', 'an under-floor reviewed topic must not expose a misleading study CTA')
  assert.deepEqual(tenGroupTopic.availableSetSizes, [], 'an under-floor reviewed topic must not advertise a startable set')
  assert.match(tenGroupTopic.sourceGap, /12 reviewed source question groups/i)

  const fiveQuestionAttempt = await call(verifiedApi, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId: 'cie-9702-as-physics',
      syllabusTopicIds: [tenGroupTopic.id],
      components: [1, 2],
      questionCount: 5,
      excludeAttempted: false,
      seed: 9702,
    },
  })
  assert.equal(fiveQuestionAttempt.statusCode, 400, 'a Topic Drill must not start with fewer than six distinct question groups')
  assert.equal(fiveQuestionAttempt.payload.code, 'invalid_question_count')

  const underFloorAttempt = await call(verifiedApi, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId: 'cie-9702-as-physics',
      syllabusTopicIds: [tenGroupTopic.id],
      components: [1, 2],
      questionCount: 6,
      excludeAttempted: false,
      seed: 9702,
    },
  })
  assert.equal(underFloorAttempt.statusCode, 409, 'ten reviewed groups must fail closed at the HTTP start boundary')
  assert.equal(underFloorAttempt.payload.code, 'insufficient_verified_questions')

  const twelveGroupTopic = asInventory.topics.find((topic) => topic.id === 'physics-9702-topic-07')
  assert.ok(twelveGroupTopic, 'the reviewed Waves fixture must remain present')
  assert.equal(twelveGroupTopic.verifiedQuestionCount, 18, 'the positive fixture must include the newly reviewed superposition mappings')
  assert.equal(twelveGroupTopic.ready, true)
  assert.equal(twelveGroupTopic.ctaPolicy, 'start')
  assert.deepEqual(twelveGroupTopic.availableSetSizes, [6, 10, 15])

  const sixQuestionAttempt = await call(verifiedApi, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId: 'cie-9702-as-physics',
      syllabusTopicIds: [twelveGroupTopic.id],
      components: [1, 2],
      questionCount: 6,
      excludeAttempted: false,
      seed: 9702,
    },
  })
  assert.equal(sixQuestionAttempt.statusCode, 201, sixQuestionAttempt.payload?.error)
  assert.equal(sixQuestionAttempt.payload.questionCount, 6)
  assert.equal(new Set(sixQuestionAttempt.payload.sourceQuestionIds).size, 6, 'the launched test must contain six distinct groups')
  assert.ok(sixQuestionAttempt.payload.questionGroups.every((group) => group.reviewStatus === 'reviewed' && group.studyOnly !== true))
} finally {
  closeStemDatabaseForTests()
}

const a2Inventory = syllabusTopicsInventory({ routeId: 'cie-9702-a2-physics', questionBank: studyQuestionBank })
const electricFieldsTopic = a2Inventory.topics.find((topic) => topic.id === 'physics-9702-topic-18')
assert.ok(electricFieldsTopic, 'the A2 Electric Fields topic must remain present in the study-only inventory')
assert.equal(electricFieldsTopic.availableQuestionCount, 1, 'the regression fixture must expose exactly one source-backed question')
assert.equal(electricFieldsTopic.ready, false, 'one question cannot satisfy the formal Topic Drill floor')
assert.equal(electricFieldsTopic.ctaPolicy, 'hidden', 'one question must not expose a practice CTA')
assert.deepEqual(electricFieldsTopic.availableSetSizes, [])
assert.equal(
  electricFieldsTopic.sourceGap,
  'At least 6 complete source questions are required before a Topic Drill can start; 1 complete source question is currently available.',
)

const studyOnlyApi = createStemApi({ env: { NODE_ENV: 'production', STEM_DB_PATH: ':memory:' } })
try {
  const electricFieldsAttempt = await call(studyOnlyApi, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId: 'cie-9702-a2-physics',
      syllabusTopicIds: [electricFieldsTopic.id],
      components: [4],
      questionCount: 6,
      excludeAttempted: false,
      seed: 9702,
    },
  })
  assert.equal(electricFieldsAttempt.statusCode, 409, 'A2 Electric Fields must stay in study-only mode while only one source-backed question is available')
  assert.equal(electricFieldsAttempt.payload.code, 'insufficient_verified_questions')
} finally {
  closeStemDatabaseForTests()
}

const sixGroupFixture = studyQuestionBank
  .filter((question) => (
    question.routeId === 'cie-9702-as-physics'
    && question.knowledgeGroupId === 'physics-9702-topic-07'
    && isHumanReviewedPastPaperItem(question)
  ))
  .slice(0, MIN_VERIFIED_GROUPS_FOR_PRACTICE)
assert.equal(sixGroupFixture.length, MIN_VERIFIED_GROUPS_FOR_PRACTICE, 'the positive fixture must contain two disjoint six-question tests')
const sixGroupSet = buildSyllabusPracticeSet({
  routeId: 'cie-9702-as-physics',
  syllabusTopicIds: ['physics-9702-topic-07'],
  components: [1, 2],
  questionCount: 6,
  sourceQuestionIds: sixGroupFixture.slice(0, 6).map((question) => question.sourceQuestionId),
  questionBank: sixGroupFixture,
  seed: 9702,
})
assert.equal(sixGroupSet.questionGroups.length, 6)
assert.equal(sixGroupSet.practiceMode, 'verified')
const oneGroupPersistedUnit = {
  id: 'syllabus-set:one-group-forged-regression',
  sourceAuthority: 'server-syllabus',
  sourceGateVersion: 'server-syllabus-catalog-v2',
  routeId: sixGroupSet.routeId,
  knowledgeGroupId: sixGroupSet.syllabusTopicIds[0],
  syllabusTopic: sixGroupSet.syllabusTopicIds.join(','),
  paperComponent: sixGroupSet.components,
  practiceMode: sixGroupSet.practiceMode,
  parts: [{
    id: `one-group:${sixGroupSet.questionGroups[0].id}:${sixGroupSet.questionGroups[0].parts[0].partId}`,
    sourceQuestionId: sixGroupSet.questionGroups[0].id,
    questionPartId: sixGroupSet.questionGroups[0].parts[0].partId,
    sourceBindingProvenance: sixGroupSet.questionGroups[0].parts[0].sourceBindingProvenance,
  }],
}
assert.equal(
  rebindSyllabusPracticeUnit(oneGroupPersistedUnit, { questionBank: sixGroupFixture, includeStudyOnly: false }),
  null,
  'a persisted non-retest Topic Drill must contain at least six distinct source groups',
)
assert.equal(isStartableTopicPracticeUnit({ ...oneGroupPersistedUnit, type: 'topic' }), false)
const validParentUnit = {
  id: 'syllabus-set:valid-parent-regression',
  sourceAuthority: 'server-syllabus',
  sourceGateVersion: 'server-syllabus-catalog-v2',
  routeId: sixGroupSet.routeId,
  knowledgeGroupId: sixGroupSet.syllabusTopicIds[0],
  syllabusTopic: sixGroupSet.syllabusTopicIds.join(','),
  paperComponent: sixGroupSet.components,
  practiceMode: sixGroupSet.practiceMode,
  parts: sixGroupSet.questionGroups.flatMap((group) => group.parts.map((part) => ({
    id: `valid-parent:${group.id}:${part.partId}`,
    sourceQuestionId: group.id,
    questionPartId: part.partId,
    sourceBindingProvenance: part.sourceBindingProvenance,
  }))),
}
const focusedRetestId = `${validParentUnit.id}:focused:${validParentUnit.parts[0].id}`
const focusedRetestUnit = {
  ...validParentUnit,
  id: focusedRetestId,
  focusedRetestOf: validParentUnit.id,
  parts: [validParentUnit.parts[0]],
}
assert.equal(isStartableTopicPracticeUnit({ ...validParentUnit, type: 'topic' }), true)
const reboundFocusedRetest = rebindSyllabusPracticeUnit(focusedRetestUnit, {
  questionBank: sixGroupFixture,
  includeStudyOnly: false,
  parentUnit: validParentUnit,
})
assert.ok(
  reboundFocusedRetest,
  'a focused retest may intentionally contain one source group',
)
assert.equal(reboundFocusedRetest.focusedRetestValidated, true)
assert.equal(isStartableTopicPracticeUnit(reboundFocusedRetest, { allowFocusedRetest: true }), true)

const forgedFocusedRetestUnit = {
  ...focusedRetestUnit,
  id: 'syllabus-set:forged-parent:focused:forged-part',
  focusedRetestOf: 'syllabus-set:forged-parent',
}
assert.equal(
  rebindSyllabusPracticeUnit(forgedFocusedRetestUnit, { questionBank: sixGroupFixture, includeStudyOnly: false }),
  null,
  'a one-question focused retest must prove that its ID and source part descend from the named parent unit',
)

const legacyCatalog = buildVerifiedPracticeCatalog()
assert.ok(legacyCatalog.length > 0, 'the reviewed legacy catalog fixture must remain available')
assert.ok(
  legacyCatalog
    .filter((unit) => isStartableTopicPracticeUnit(unit))
    .every((unit) => unit.questionGroupCount >= 6),
  'the reviewed legacy catalog must never publish a startable set below the six-question learning boundary',
)
assert.ok(
  legacyCatalog
    .filter((unit) => unit.questionGroupCount < 6)
    .every((unit) => unit.startable === false && !isStartableTopicPracticeUnit(unit)),
  'below-floor legacy source indexes may remain for coverage, but must be explicitly non-startable',
)
const expectedPublishedLegacyGroups = coachPracticeOptions()
  .flatMap((option) => option.topics)
  .reduce((sum, topic) => sum + topic.inventory, 0)
assert.equal(
  legacyCatalog.reduce((sum, unit) => sum + unit.questionGroupCount, 0),
  expectedPublishedLegacyGroups,
  'eligible legacy topics must retain all reviewed questions while the final set is rebalanced above six groups',
)
const legacyParent = legacyCatalog[0]
const legacyFocusedRetest = {
  ...legacyParent,
  id: `${legacyParent.id}:focused:${legacyParent.parts[0].id}`,
  focusedRetestOf: legacyParent.id,
  parts: [legacyParent.parts[0]],
}
const reboundLegacyFocusedRetest = rebindVerifiedPracticeUnit(legacyFocusedRetest)
assert.ok(reboundLegacyFocusedRetest, 'a canonical legacy focused retest must remain restorable')
assert.equal(reboundLegacyFocusedRetest.focusedRetestValidated, true)
assert.equal(reboundLegacyFocusedRetest.parts[0].id, legacyParent.parts[0].id, 'focused rebind must preserve the parent part identity used by drafts and attempts')
assert.equal(
  rebindVerifiedPracticeUnit({
    ...legacyFocusedRetest,
    id: 'past-paper-set:forged-parent:focused:forged-part',
    focusedRetestOf: 'past-paper-set:forged-parent',
  }),
  null,
  'a forged legacy focused retest parent must not bypass the six-question boundary',
)

console.log('Topic Drill readiness-floor regression passed.')
