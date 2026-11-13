import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { EXPANDED_CHAPTER_FOUNDATION_SPECS } from '../server/catalogs/chapter-foundation-specs.js'
import {
  originalFoundationCatalogEntries,
  originalFoundationQuestion,
  originalFoundationQuestionGroupsForRoute,
  publicOriginalFoundationQuestion,
  scoreOriginalFoundationResponse,
} from '../server/originalFoundationPractice.js'
import { routeById } from '../src/data/routeRegistry.js'
import { syllabusPracticeComponentsForRoute } from '../src/lib/syllabusPracticeRoutes.js'

const ROUTES = Object.freeze({
  'cie-9701-as-chemistry': { stage: 'AS', components: [1, 2], topics: 22 },
  'cie-9701-a2-chemistry': { stage: 'A2', components: [4], topics: 15 },
  'cie-9708-as-economics': { stage: 'AS', components: [1, 2], topics: 29 },
  'cie-9708-a2-economics': { stage: 'A2', components: [3, 4], topics: 24 },
  'cie-9231-as-p1-p3': { stage: 'AS', components: [1, 3], topics: 13 },
  'cie-9231-as-p1-p4': { stage: 'AS', components: [1, 4], topics: 12 },
  'cie-9231-a2-after-p1-p3-p2-p4': { stage: 'A2', components: [2, 4], topics: 11 },
  'cie-9231-a2-after-p1-p4-p2-p3': { stage: 'A2', components: [2, 3], topics: 12 },
})

const LEGACY = Object.freeze({
  'cie-9701-as-chemistry': { prefix: '9701-as-topic-', count: 15, v1: 'e6e382510f509963833ce11de2194811424e3377bde411d874a4105a903d8c4d', v2: '885d1fd2b3c394c85640e88a3cc96f77bc8cc6af5d2a23422481d9cd3ed46deb' },
  'cie-9701-a2-chemistry': { prefix: '9701-a2-topic-', count: 8, v1: 'c5d637791e66a139dc1fd39957548f65c389632227b9967db90d2f9b3805a0be', v2: 'db311ce55ca8dfd8282387fc7d08c5fd1f1e7535a7306601531bb1895e3a30ea' },
  'cie-9708-as-economics': { prefix: '9708-as-topic-', count: 6, v1: '43c629f87327f8ccde05ddd39e0bfdf84c4db518a6cb334fe7adce073f0a0f61', v2: '37053589e02968a3ae8ee61cb597291b235c658fcc08d3ccfa2111b530110dec' },
  'cie-9708-a2-economics': { prefix: '9708-a2-topic-', count: 5, v1: '3e833086680723ae9aef2e45984c6b94193e34943d0c34ad973add6b9c6bc756', v2: '82794eaaff87a5e7af3a3f30bc3604ebf2d79bb869b78fa0153ab7167db2e22f' },
  'cie-9231-as-p1-p3': { prefix: '9231-as-topic-', count: 3, v1: '5198a2f8fc15eab57d9f68c172b0e3038794fb3d791cfd81645df63e06998639', v2: '2e2af821762154d55c98faef54e40e8a648aeed5dbff30504f35bcd71a2b528a' },
  'cie-9231-as-p1-p4': { prefix: '9231-as-topic-', count: 3, v1: '30d53837e03cf3f3d1d98ca4d071fb0ff1296066af03659666053eb5000609e1', v2: 'd99a4da386de0c6b9ad80b96fa0655666666bd52e2358474d39b005f1236468d' },
  'cie-9231-a2-after-p1-p3-p2-p4': { prefix: '9231-a2-topic-', count: 3, v1: '86372b4e0b2933f7ac3c5f4c1d83377ec03e6f6e4032a564a26a8bb2ee155241', v2: '2b6a2efbf60ddd0baf7270dfbbc5d88aa5609abac5484858feeb98841e4d7723' },
  'cie-9231-a2-after-p1-p4-p2-p3': { prefix: '9231-a2-topic-', count: 3, v1: 'f4cf59669a25068d86caaf816d89f92ad5b2a3938f16dc169b644066012323fe', v2: '53fe83d14e75a99d8acffa77078f2fa1155675eafe6c13eb9e0f8b92e59a841f' },
})

const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const PUBLIC_V2_KEYS = Object.freeze(['answerContract','answerType','catalogVersion','countsTowardFormalGrade','displaySourceLabel','formalProgressEligible','foundationBasis','foundationCatalog','id','itemKind','misconceptionId','options','prompt','responseContract','routeId','schemaVersion','skillFocus','sourceAuthority','sourceKind','stage','subject','subjectCode','topicId','topicName'])

function call(api, { method, url, body }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')])
    request.method = method
    request.url = url
    request.headers = body === undefined ? {} : { 'content-type': 'application/json' }
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

for (const [routeId, expected] of Object.entries(ROUTES)) {
  const route = routeById(routeId)
  assert.ok(route, routeId)
  assert.equal(route.stage, expected.stage)
  assert.equal(route.syllabus.topics.length, expected.topics, `${routeId} must expose official learnable chapters`)
  assert.equal(new Set(route.syllabus.topics.map((topic) => topic.id)).size, expected.topics)
  assert.deepEqual(syllabusPracticeComponentsForRoute(routeId), expected.components)
  assert.ok(route.syllabus.topics.every((topic) => topic.code && topic.name && topic.title))

  const activeEntries = originalFoundationCatalogEntries({ foundationCatalog: 'v2' }).filter((entry) => route.syllabus.topics.some((topic) => topic.id === entry.topicId) && entry.routeId === routeId)
  assert.equal(activeEntries.length, expected.topics * 3)
  for (const topic of route.syllabus.topics) {
    const entries = activeEntries.filter((entry) => entry.topicId === topic.id)
    assert.deepEqual(entries.map((entry) => entry.itemKind).sort(), ['application', 'concept', 'transfer'])
    assert.equal(new Set(entries.map((entry) => entry.prompt)).size, 3)
    assert.equal(new Set(entries.map((entry) => JSON.stringify(entry.options))).size, 3)
    assert.ok(entries.every((entry) => entry.solution.explanation && entry.solution.nextStep))
    const projected = entries.map((entry) => originalFoundationQuestion(routeId, topic.id, { foundationCatalog: 'v2', itemKind: entry.itemKind }))
    assert.ok(projected.every(Boolean))
    assert.deepEqual(Object.keys(publicOriginalFoundationQuestion(routeId, topic.id, { foundationCatalog: 'v2', itemKind: 'concept' })).sort(), PUBLIC_V2_KEYS)
  }
  assert.equal(new Set(activeEntries.filter((entry) => entry.itemKind === 'application').map((entry) => entry.prompt)).size, expected.topics)
}

const EXPLICIT_WORKING_IDS = Object.freeze([
  '9231-p1-topic-02','9231-p1-topic-03','9231-p1-topic-04','9231-p1-topic-05','9231-p1-topic-06',
  '9231-p4-topic-03','9701-a2-topic-23-energetics','9701-a2-topic-24-electrochemistry',
  '9708-as-topic-4-1','9708-as-topic-6-3','9708-a2-topic-9-1',
])
for (const topicId of EXPLICIT_WORKING_IDS) {
  const spec = EXPANDED_CHAPTER_FOUNDATION_SPECS[topicId]
  assert.ok(spec)
  assert.notEqual(spec.application.explanation, `${spec.application.correct} ${spec.truth}`, `${topicId} needs direct worked reasoning rather than a repeated chapter rule`)
}

for (const [routeId, legacy] of Object.entries(LEGACY)) {
  const v1 = Array.from({ length: legacy.count }, (_, index) => originalFoundationQuestion(routeId, `${legacy.prefix}${String(index + 1).padStart(2, '0')}`))
  assert.ok(v1.every(Boolean), `${routeId} legacy v1 questions must remain recoverable`)
  assert.equal(digest(v1), legacy.v1, `${routeId} legacy v1 semantics changed`)
  const v2 = Array.from({ length: legacy.count }, (_, index) => (
    ['concept', 'application', 'transfer'].map((itemKind) => originalFoundationQuestion(routeId, `${legacy.prefix}${String(index + 1).padStart(2, '0')}`, { foundationCatalog: 'v2', itemKind }))
  )).flat()
  assert.ok(v2.every(Boolean), `${routeId} legacy v2 questions must remain recoverable`)
  assert.equal(digest(v2), legacy.v2, `${routeId} legacy v2 semantics changed`)
  const recoveredGroups = originalFoundationQuestionGroupsForRoute(routeId, undefined, { foundationCatalog: 'v2' })
  assert.ok(v2.every((entry) => recoveredGroups.some((group) => group.id === entry.id)), `${routeId} legacy v2 groups must remain available to rebind`)
  const sample = v2[0]
  const scored = scoreOriginalFoundationResponse({
    foundationCatalog: 'v2', routeId, syllabusTopicId: sample.topicId, questionId: sample.id,
    response: { selectedOptionId: sample.correctOptionId },
  })
  assert.equal(scored.correct, true, `${routeId} legacy v2 scoring must remain available by question ID`)
}

const furtherRoute = routeById('cie-9231-as-p1-p3')
const pureTopic = furtherRoute.syllabus.topics.find((topic) => topic.componentScope?.component === 1)
const mechanicsTopic = furtherRoute.syllabus.topics.find((topic) => topic.componentScope?.component === 3)
assert.ok(pureTopic && mechanicsTopic)
assert.equal(originalFoundationQuestionGroupsForRoute(furtherRoute.routeId, [pureTopic.id], { components: [3], foundationCatalog: 'v2' }).length, 0)
assert.equal(originalFoundationQuestionGroupsForRoute(furtherRoute.routeId, [pureTopic.id], { components: [1], foundationCatalog: 'v2' }).length, 3)
assert.equal(originalFoundationQuestionGroupsForRoute(furtherRoute.routeId, [mechanicsTopic.id], { components: [1], foundationCatalog: 'v2' }).length, 0)
assert.equal(originalFoundationQuestionGroupsForRoute(furtherRoute.routeId, [mechanicsTopic.id], { components: [3], foundationCatalog: 'v2' }).length, 3)

const api = createStemApi({ env: { NODE_ENV: 'test', STEM_DB_PATH: ':memory:', STEM_IDENTITY_SIGNING_KEY: 'expanded-chapter-catalog-test-key' } })
try {
  for (const [routeId, expected] of Object.entries(ROUTES)) {
    const response = await call(api, { method: 'GET', url: `/api/stem/routes/${routeId}/syllabus-topics?foundationCatalog=v2` })
    assert.equal(response.statusCode, 200, response.payload?.error)
    assert.equal(response.payload.topics.length, expected.topics)
    assert.equal(response.payload.topics.reduce((sum, topic) => sum + topic.chapterStudy.officialAvailable, 0), 0, `${routeId} must keep unreviewed official questions fail-closed`)
    for (const topic of response.payload.topics) {
      assert.deepEqual(Object.keys(topic.componentCounts).map(Number).sort(), [...expected.components].sort())
      assert.equal(topic.chapterStudy.available, topic.chapterStudy.officialAvailable + topic.chapterStudy.originalAvailable)
      assert.equal(topic.chapterStudy.startable, topic.chapterStudy.available > 0)
    }
  }
  const inventory = await call(api, { method: 'GET', url: `/api/stem/routes/${furtherRoute.routeId}/syllabus-topics?foundationCatalog=v2` })
  assert.equal(inventory.statusCode, 200, inventory.payload?.error)
  for (const topic of inventory.payload.topics) {
    const allowed = Number(routeById(furtherRoute.routeId).syllabus.topics.find((item) => item.id === topic.id)?.componentScope?.component)
    assert.deepEqual(Object.keys(topic.componentCounts).map(Number).sort(), [1, 3])
    for (const component of [1, 3]) {
      const chapter = topic.componentCounts[String(component)].chapterStudy
      assert.equal(chapter.originalAvailable, component === allowed ? 3 : 0)
      assert.equal(chapter.available, chapter.officialAvailable + chapter.originalAvailable)
      assert.equal(chapter.startable, chapter.available > 0)
      assert.equal(chapter.fallbackKind, chapter.officialAvailable === 0 && chapter.originalAvailable > 0 ? 'original-foundation' : null)
    }
  }

  const unavailable = await call(api, {
    method: 'POST', url: '/api/stem/practice-sets',
    body: { routeId: furtherRoute.routeId, syllabusTopicIds: [pureTopic.id], components: [3], questionCount: 3, studyMode: 'chapter-study', sourcePreference: 'original-foundation-only', foundationCatalog: 'v2', excludeAttempted: false },
  })
  assert.equal(unavailable.statusCode, 409)
  assert.equal(unavailable.payload.code, 'chapter_study_unavailable')

  const started = await call(api, {
    method: 'POST', url: '/api/stem/practice-sets',
    body: { routeId: furtherRoute.routeId, syllabusTopicIds: [pureTopic.id], components: [1], questionCount: 3, studyMode: 'chapter-study', sourcePreference: 'original-foundation-only', foundationCatalog: 'v2', excludeAttempted: false },
  })
  assert.equal(started.statusCode, 201, started.payload?.error)
  assert.equal(started.payload.count, 3)
  assert.deepEqual(started.payload.sourceMix, { official: 0, originalFoundation: 3 })
  assert.ok(started.payload.questionGroups.every((group) => group.syllabusMapping.topicIds.includes(pureTopic.id)))

  const concept = originalFoundationQuestion(furtherRoute.routeId, pureTopic.id, { foundationCatalog: 'v2', itemKind: 'concept' })
  const scored = scoreOriginalFoundationResponse({ foundationCatalog: 'v2', routeId: furtherRoute.routeId, syllabusTopicId: pureTopic.id, questionId: concept.id, response: { selectedOptionId: concept.correctOptionId } })
  assert.equal(scored.correct, true)
  assert.equal(scored.score, 1)
  assert.equal(scored.formalProgressEligible, false)
} finally {
  closeStemDatabaseForTests()
}

console.log(JSON.stringify({ status: 'PASS_EXPANDED_STEM_CHAPTER_CATALOGS', routes: Object.keys(ROUTES).length, activeTopics: Object.values(ROUTES).reduce((sum, route) => sum + route.topics, 0) }))
