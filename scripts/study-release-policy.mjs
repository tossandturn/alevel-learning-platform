import assert from 'node:assert/strict'
import {
  MIN_QUESTION_GROUPS_PER_TEST,
  MIN_VERIFIED_GROUPS_FOR_PRACTICE,
  topicPracticeEligibility,
} from '../src/lib/practiceConstants.js'

const ROUTE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/
const TOPIC_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/

function canonicalId(value, pattern, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`)
  assert.equal(value, value.trim(), `${label} must use canonical whitespace`)
  assert.match(value, pattern, `${label} is invalid`)
  return value
}

export function parseStudyTopicScopes(entries = [], routeIds = []) {
  assert.ok(Array.isArray(entries), 'topic scope entries must be an array')
  assert.ok(Array.isArray(routeIds) && routeIds.length > 0, 'declared routes are required')
  const declaredRoutes = routeIds.map((routeId) => canonicalId(routeId, ROUTE_ID_PATTERN, 'route ID'))
  assert.equal(new Set(declaredRoutes).size, declaredRoutes.length, 'declared routes must be unique')
  const declared = new Set(declaredRoutes)
  const scopeMap = new Map()
  for (const raw of entries) {
    assert.equal(typeof raw, 'string', 'topic scope must be a string')
    assert.equal(raw, raw.trim(), 'topic scope must use canonical whitespace')
    const separator = raw.lastIndexOf(':')
    assert.ok(separator > 0 && separator < raw.length - 1, 'topic scope must be route:topic')
    const routeId = canonicalId(raw.slice(0, separator), ROUTE_ID_PATTERN, 'topic-scope route')
    const topicId = canonicalId(raw.slice(separator + 1), TOPIC_ID_PATTERN, 'topic-scope topic')
    assert.ok(declared.has(routeId), `topic scope route is not a declared route: ${routeId}`)
    const selected = scopeMap.get(routeId) || []
    assert.equal(selected.includes(topicId), false, `duplicate topic scope: ${routeId}:${topicId}`)
    selected.push(topicId)
    scopeMap.set(routeId, selected)
  }
  return Object.fromEntries(scopeMap)
}

function selectedTopics(inventory, routeId, topicScope) {
  assert.ok(Array.isArray(inventory.topics) && inventory.topics.length, 'empty syllabus is not ready')
  const byId = new Map()
  for (const topic of inventory.topics) {
    const topicId = canonicalId(topic?.id, TOPIC_ID_PATTERN, 'inventory topic ID')
    assert.equal(byId.has(topicId), false, `duplicate inventory topic ID: ${topicId}`)
    byId.set(topicId, topic)
  }
  if (topicScope === undefined) return inventory.topics
  assert.ok(Array.isArray(topicScope) && topicScope.length > 0, 'topic scope must not be empty')
  const canonicalScope = topicScope.map((topicId) => canonicalId(topicId, TOPIC_ID_PATTERN, 'topic scope ID'))
  assert.equal(new Set(canonicalScope).size, canonicalScope.length, 'topic scope IDs must be unique')
  return canonicalScope.map((topicId) => {
    const topic = byId.get(topicId)
    assert.ok(topic, `${routeId}/${topicId} was not found in the canonical syllabus`)
    return topic
  })
}

export function assertStudyReleaseInventory(inventory, routeId, topicScope = undefined) {
  assert.equal(inventory.routeId, routeId, 'route mismatch')
  const topics = selectedTopics(inventory, routeId, topicScope)
  for (const topic of topics) {
    for (const key of ['verifiedQuestionCount', 'studyQuestionCount', 'availableQuestionCount']) {
      assert.ok(Number.isSafeInteger(topic[key]) && topic[key] >= 0, `invalid ${key}`)
    }
    assert.equal(topic.availableQuestionCount, topic.verifiedQuestionCount + topic.studyQuestionCount, 'count mismatch')
    const policy = topicPracticeEligibility(topic)
    assert.equal(topic.ready, policy.ready, 'formal readiness drift')
    assert.equal(topic.studyReady, policy.studyReady, 'study readiness drift')
    assert.equal(topic.apiStartable, policy.ready || policy.studyReady, 'API readiness drift')
    assert.ok(topic.apiStartable, `${routeId}/${topic.id} is not study-startable`)
    assert.ok(topic.availableQuestionCount >= MIN_QUESTION_GROUPS_PER_TEST, 'study floor must not be lowered')
    if (topic.ready) {
      assert.ok(topic.verifiedQuestionCount >= MIN_VERIFIED_GROUPS_FOR_PRACTICE, 'formal floor must not be lowered')
    }
  }
  return {
    routeId,
    topics: topics.length,
    syllabusTopics: inventory.topics.length,
    ...(topicScope === undefined ? {} : { topicScope: topics.map((topic) => topic.id) }),
    formalTopics: topics.filter((topic) => topic.ready).length,
    studyTopics: topics.filter((topic) => topic.studyReady).length,
    minimumStudyGroups: MIN_QUESTION_GROUPS_PER_TEST,
    minimumFormalGroups: MIN_VERIFIED_GROUPS_FOR_PRACTICE,
  }
}

export function assertChapterStudyReleaseInventory(inventory, routeId, topicScope = undefined) {
  assert.equal(inventory.routeId, routeId, 'route mismatch')
  const policy = inventory.practicePolicy?.chapterStudy
  assert.ok(policy && policy.mode === 'chapter-study' && policy.minSourceGroups === 1
    && policy.maxSourceGroups === 15 && policy.countPolicy === 'cap-to-available'
    && policy.formalProgressEligible === false, 'chapter-study policy must remain non-formal and source-bound')
  const selected = selectedTopics(inventory, routeId, topicScope)
  for (const topic of inventory.topics) {
    for (const key of ['verifiedQuestionCount', 'studyQuestionCount', 'releasedStudyQuestionCount', 'availableQuestionCount']) {
      assert.ok(Number.isSafeInteger(topic[key]) && topic[key] >= 0, `invalid ${key}`)
    }
    assert.equal(topic.availableQuestionCount, topic.verifiedQuestionCount + topic.studyQuestionCount, 'official count mismatch')
    assert.equal(topic.studyQuestionCount, topic.releasedStudyQuestionCount, 'unreleased study questions must not count')
    const components = Object.values(topic.questionIdsByComponent || {})
    assert.ok(components.length, 'component source IDs are required')
    const availableIds = [], reviewedIds = []
    for (const component of components) {
      for (const field of ['verifiedQuestionIds', 'releasedStudyQuestionIds', 'apiReadyQuestionIds']) {
        assert.ok(Array.isArray(component[field]) && component[field].every((id) => typeof id === 'string' && id.trim() === id && id), `invalid ${field}`)
        assert.equal(new Set(component[field]).size, component[field].length, `duplicate ${field}`)
      }
      availableIds.push(...component.apiReadyQuestionIds)
      reviewedIds.push(...component.verifiedQuestionIds, ...component.releasedStudyQuestionIds)
    }
    assert.equal(new Set(availableIds).size, availableIds.length, 'duplicate component source IDs')
    assert.equal(new Set(reviewedIds).size, reviewedIds.length, 'duplicate reviewed source IDs')
    assert.deepEqual([...availableIds].sort(), [...reviewedIds].sort(), 'available IDs must be verified or released study sources')
    assert.equal(availableIds.length, topic.availableQuestionCount, 'official count and source list differ')
    assert.equal(topic.chapterStudy?.mode, 'chapter-study')
    assert.equal(topic.chapterStudy.officialAvailable, topic.availableQuestionCount, 'original fallback is not a reviewed past paper')
    assert.ok(Number.isSafeInteger(topic.chapterStudy.originalAvailable) && topic.chapterStudy.originalAvailable >= 0)
    assert.equal(topic.chapterStudy.available, topic.chapterStudy.officialAvailable + topic.chapterStudy.originalAvailable)
    assert.equal(topic.chapterStudy.startable, topic.chapterStudy.available > 0)
  }
  for (const topic of selected) {
    assert.ok(topic.availableQuestionCount >= 1 && topic.chapterStudy.officialAvailable >= 1,
      `${routeId}/${topic.id} has no reviewed source question and is not chapter-startable`)
  }
  const missingOfficialTopicIds = inventory.topics.filter((topic) => topic.availableQuestionCount === 0).map((topic) => topic.id)
  return { routeId, readinessMode: 'chapter-study', topics: selected.length, syllabusTopics: inventory.topics.length,
    ...(topicScope === undefined ? {} : { topicScope: selected.map((topic) => topic.id) }),
    officialCoveredTopicCount: inventory.topics.length - missingOfficialTopicIds.length,
    missingOfficialTopicIds, fullChapterCoverage: missingOfficialTopicIds.length === 0,
    minimumChapterSourceGroups: 1, minimumStudentStudyGroups: MIN_QUESTION_GROUPS_PER_TEST,
    minimumFormalGroups: MIN_VERIFIED_GROUPS_FOR_PRACTICE, formalProgressEligible: false }
}
