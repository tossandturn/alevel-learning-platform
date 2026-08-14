import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import { CAMBRIDGE_9702_AS_SYLLABUS } from '../src/data/syllabus/cambridge-9702-as-2025-2027.js'
import { courseRoutes } from '../src/data/routeRegistry.js'
import paperCatalog from '../public/data/papers.json' with { type: 'json' }
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { buildSyllabusPracticeSet, syllabusMappingCandidates, syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'

const routeId = 'cie-9702-as-physics'
const signingKey = 'test-syllabus-key'
const route = courseRoutes.find((item) => item.routeId === routeId)
assert.ok(route, '9702 AS route must exist')
assert.deepEqual(route.paperComponents, [1, 2, 3], 'P3 must remain registered as an AS assessment component')
assert.equal(CAMBRIDGE_9702_AS_SYLLABUS.assessmentComponents.find((item) => item.component === 3)?.stage, 'AS')
assert.equal(CAMBRIDGE_9702_AS_SYLLABUS.assessmentComponents.find((item) => item.component === 3)?.track, 'practical')
assert.equal(CAMBRIDGE_9702_AS_SYLLABUS.topics.length, 11, 'AS theory must expose exactly 11 official topics')
assert.deepEqual(route.syllabus.topics.map((topic) => topic.id), CAMBRIDGE_9702_AS_SYLLABUS.topics.map((topic) => topic.id))
assert.equal(route.syllabus.topics.some((topic) => /practical/i.test(topic.title)), false, 'practical skills must not be a theory Topic Drill chapter')
assert.ok(CAMBRIDGE_9702_AS_SYLLABUS.points.length >= 130, 'official outcome table must include the AS learning outcomes')

function identityToken(userId = 42) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: `ielts:${userId}`,
    username: 'syllabus-test',
    roles: [],
    iat: now,
    exp: now + 300,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

assert.throws(
  () => buildSyllabusPracticeSet({ routeId, syllabusTopicIds: ['physics-9702-topic-02'], components: [1, 3] }),
  (error) => error?.code === 'invalid_paper_component' && error?.statusCode === 400,
  'Topic Drill must reject mixed theory/practical component requests instead of silently dropping P3',
)
assert.throws(
  () => buildSyllabusPracticeSet({ routeId, syllabusTopicIds: ['physics-9702-topic-02'], components: [3] }),
  (error) => error?.code === 'invalid_paper_component' && error?.statusCode === 400,
  'Topic Drill must reject the separate AS practical component',
)

const candidates = syllabusMappingCandidates()
assert.equal(candidates.length, 87, '2023-2025 P1/P2 import should expose 87 question-group candidates')
assert.equal(candidates.filter((candidate) => candidate.reviewStatus === 'reviewed').length, 0, 'machine-indexed candidates must remain pending')
const officialFirstBatch = paperCatalog.items.filter((item) => item.subject === '9702' && item.kind === 'qp' && [1, 2].includes(Number(item.examProfile?.paperNumber ?? item.paperComponent)) && item.markSchemeId && Number(item.year) >= 2023 && Number(item.year) <= 2025)
assert.equal(officialFirstBatch.length, 46, 'the official 2023-2025 first batch must contain 46 paired QP papers')
assert.ok(new Set(candidates.map((candidate) => candidate.questionPaperId)).size < officialFirstBatch.length, 'the index must expose the real gap between official papers and indexed groups')
assert.ok(candidates.every((candidate) => candidate.markSchemeId), 'every candidate must retain its paired mark scheme')

const localInventory = syllabusTopicsInventory({ routeId })
assert.equal(localInventory.topics.length, 11)
assert.equal(localInventory.topics.reduce((sum, topic) => sum + topic.indexedQuestionCount, 0), 85)
assert.equal(localInventory.indexedQuestionGroupCount, 87)
assert.equal(localInventory.unmappedQuestionGroupCount, 2)
assert.equal(localInventory.topics.reduce((sum, topic) => sum + topic.verifiedQuestionCount, 0), 0)
assert.ok(localInventory.topics.every((topic) => topic.ctaPolicy === 'hidden'), 'zero reviewed questions must hide Start')
assert.ok(localInventory.topics.every((topic) => /semantic-reviewed|human source review/i.test(topic.sourceGap)))

const api = createStemApi({
  env: { STEM_IDENTITY_SIGNING_KEY: signingKey, STEM_DB_PATH: ':memory:' },
})
const server = http.createServer((request, response) => api(request, response, () => {
  response.statusCode = 404
  response.end()
}))
await new Promise((resolve) => server.listen(0, resolve))
const origin = `http://127.0.0.1:${server.address().port}`
try {
  const inventoryResponse = await fetch(`${origin}/api/stem/routes/${routeId}/syllabus-topics`)
  assert.equal(inventoryResponse.status, 200)
  const inventory = await inventoryResponse.json()
  assert.equal(inventory.aggregation, 'sqlite-question-groups-and-syllabus-mappings')
  assert.equal(inventory.topics.length, 11)
  assert.equal(inventory.topics.reduce((sum, topic) => sum + topic.indexedQuestionCount, 0), 85)
  assert.equal(inventory.indexedQuestionGroupCount, 87)
  assert.equal(inventory.topics.reduce((sum, topic) => sum + topic.verifiedQuestionCount, 0), 0)
  assert.equal(inventory.officialPaperCount, 46)
  assert.equal(inventory.officialPairedPaperCount, 46)
  assert.ok(inventory.topics.every((topic) => topic.points.length > 0), 'API must return official syllabus points')

  const unauthenticatedSet = await fetch(`${origin}/api/stem/practice-sets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      routeId,
      syllabusTopicIds: ['physics-9702-topic-02'],
      questionCount: 5,
      components: [1, 2],
    }),
  })
  assert.equal(unauthenticatedSet.status, 401, 'practice-set creation must require a STEM identity')

  const invalidPracticalSet = await fetch(`${origin}/api/stem/practice-sets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${identityToken()}`,
    },
    body: JSON.stringify({
      routeId,
      syllabusTopicIds: ['physics-9702-topic-02'],
      questionCount: 5,
      components: [1, 3],
    }),
  })
  assert.equal(invalidPracticalSet.status, 400, 'authenticated Topic Drill requests containing P3 must be rejected explicitly')
} finally {
  await new Promise((resolve) => server.close(resolve))
  closeStemDatabaseForTests()
}

console.log(JSON.stringify({
  status: 'passed',
  topics: CAMBRIDGE_9702_AS_SYLLABUS.topics.length,
  points: CAMBRIDGE_9702_AS_SYLLABUS.points.length,
  indexedQuestionGroups: candidates.length,
  reviewedQuestionGroups: 0,
}))
