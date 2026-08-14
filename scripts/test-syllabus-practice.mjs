import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import { CAMBRIDGE_9702_AS_SYLLABUS } from '../src/data/syllabus/cambridge-9702-as-2025-2027.js'
import { courseRoutes } from '../src/data/routeRegistry.js'
import importedQuestionIndex from '../src/data/importedQuestionIndex.json' with { type: 'json' }
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
assert.equal(candidates.filter((candidate) => candidate.reviewStatus === 'reviewed').length, 87, 'the two fully reviewed P1 papers and the explicit M25/22 P2 reconstruction may enter the reviewed inventory')
assert.equal(candidates.filter((candidate) => candidate.reviewStatus === 'pending').length, 0, 'M25/22 must not retain a pending shell after its QP/MS reconstruction')
assert.equal(candidates.filter((candidate) => candidate.reviewStatus === 'rejected').length, 0, 'the reviewed P2 reconstruction must resolve the former false rejection')
const reviewedP2Groups = candidates.filter((candidate) => candidate.questionPaperId === 'cie-9702-9702_m25_qp_22')
assert.equal(reviewedP2Groups.length, 7, 'M25/22 must retain exactly seven question groups')
assert.ok(reviewedP2Groups.every((candidate) => candidate.reviewStatus === 'reviewed' && candidate.sourceContentComplete), 'each reconstructed M25/22 group must have reviewed QP/MS source evidence before release')
assert.deepEqual(
  reviewedP2Groups.map((candidate) => candidate.primaryTopicId),
  [
    'physics-9702-topic-01',
    'physics-9702-topic-04',
    'physics-9702-topic-03',
    'physics-9702-topic-08',
    'physics-9702-topic-07',
    'physics-9702-topic-09',
    'physics-9702-topic-11',
  ],
  'M25/22 groups must map to reviewed official AS syllabus topics',
)
const p2Expected = [
  { questionId: 'cie-9702-9702_m25_qp_22:q1', totalMarks: 7, questionPages: [3], markSchemePages: [7], parts: [['a', 1, 3, 7], ['b-i', 2, 3, 7], ['b-ii', 2, 3, 7], ['b-iii', 2, 3, 7]] },
  { questionId: 'cie-9702-9702_m25_qp_22:q2', totalMarks: 10, questionPages: [4, 5, 6], markSchemePages: [7, 8], parts: [['a', 2, 4, 7], ['b-i', 3, 4, 7], ['b-ii', 1, 5, 8], ['b-iii', 2, 5, 8], ['b-iv', 2, 6, 8]] },
  { questionId: 'cie-9702-9702_m25_qp_22:q3', totalMarks: 10, questionPages: [7, 8, 9], markSchemePages: [9, 10], parts: [['a-i', 2, 7, 9], ['a-ii', 3, 7, 9], ['b-i', 1, 8, 9], ['b-ii', 1, 8, 9], ['b-iii', 3, 9, 10]] },
  { questionId: 'cie-9702-9702_m25_qp_22:q4', totalMarks: 8, questionPages: [10, 11], markSchemePages: [10, 11], parts: [['a', 4, 10, 10], ['b-i', 2, 10, 10], ['b-ii', 1, 11, 10], ['b-iii', 1, 11, 11]] },
  { questionId: 'cie-9702-9702_m25_qp_22:q5', totalMarks: 5, questionPages: [12], markSchemePages: [11], parts: [['a', 3, 12, 11], ['b', 2, 12, 11]] },
  { questionId: 'cie-9702-9702_m25_qp_22:q6', totalMarks: 13, questionPages: [13, 14, 15], markSchemePages: [11, 12], parts: [['a', 2, 13, 11], ['b-i', 2, 13, 11], ['b-ii', 1, 13, 11], ['b-iii', 2, 13, 12], ['c-i', 4, 14, 12], ['c-ii', 2, 15, 12]] },
  { questionId: 'cie-9702-9702_m25_qp_22:q7', totalMarks: 7, questionPages: [16], markSchemePages: [12, 13], parts: [['a', 1, 16, 12], ['b', 3, 16, 12], ['c', 3, 16, 13]] },
]
const answersById = new Map(importedQuestionIndex.answers.map((answer) => [answer.answerId, answer]))
const bindingsByQuestionId = new Map(importedQuestionIndex.bindings.map((binding) => [binding.questionId, binding]))
for (const expected of p2Expected) {
  const question = importedQuestionIndex.questions.find((item) => item.questionId === expected.questionId)
  const answer = answersById.get(question?.answerId)
  const binding = bindingsByQuestionId.get(expected.questionId)
  assert.ok(question && answer && binding, `${expected.questionId}: reconstructed QP/MS entities must exist`)
  assert.equal(question.questionGroupStatus, 'verified', `${expected.questionId}: reconstruction must be a complete question group`)
  assert.equal(question.totalMarks, expected.totalMarks, `${expected.questionId}: part marks must close to the official total`)
  assert.deepEqual(
    [...new Set(question.sourceRef.assetUrls.map((url) => Number(url.match(/qp-(\d+)\./)?.[1])))],
    expected.questionPages,
    `${expected.questionId}: every required QP page must be bound`,
  )
  assert.deepEqual(
    [...new Set(answer.answerRef.assetUrls.map((url) => Number(url.match(/ms-(\d+)\./)?.[1])))],
    expected.markSchemePages,
    `${expected.questionId}: every required MS page must be bound`,
  )
  assert.deepEqual(
    question.parts.map((part) => [part.label, part.marks, part.sourcePage, answer.answerParts.find((candidate) => candidate.partId === part.partId)?.sourcePage]),
    expected.parts,
    `${expected.questionId}: each printed part needs matching QP/MS page and marks`,
  )
  assert.equal(binding.verificationStatus, 'reviewed', `${expected.questionId}: only the explicit P2 review may release the binding`)
  assert.ok(binding.reviewEvidence?.partAllocations?.length === expected.parts.length, `${expected.questionId}: reviewer allocations must cover every part`)
  assert.ok(
    question.parts.every((part) => (
      answer.answerParts.find((candidate) => candidate.partId === part.partId)?.markSchemeEvidence?.length === part.marks
      && binding.reviewEvidence.partAllocations.find((allocation) => allocation.partId === part.partId)?.markSchemeEvidence?.length === part.marks
    )),
    `${expected.questionId}: each official mark point needs matching reviewed MS image evidence`,
  )
}
const officialFirstBatch = paperCatalog.items.filter((item) => item.subject === '9702' && item.kind === 'qp' && [1, 2].includes(Number(item.examProfile?.paperNumber ?? item.paperComponent)) && item.markSchemeId && Number(item.year) >= 2023 && Number(item.year) <= 2025)
assert.equal(officialFirstBatch.length, 46, 'the official 2023-2025 first batch must contain 46 paired QP papers')
assert.ok(new Set(candidates.map((candidate) => candidate.questionPaperId)).size < officialFirstBatch.length, 'the index must expose the real gap between official papers and indexed groups')
assert.ok(candidates.every((candidate) => candidate.markSchemeId), 'every candidate must retain its paired mark scheme')

const localInventory = syllabusTopicsInventory({ routeId })
assert.equal(localInventory.topics.length, 11)
assert.equal(localInventory.topics.reduce((sum, topic) => sum + topic.indexedQuestionCount, 0), 87)
assert.equal(localInventory.indexedQuestionGroupCount, 87)
assert.equal(localInventory.unmappedQuestionGroupCount, 0)
assert.equal(localInventory.topics.reduce((sum, topic) => sum + topic.verifiedQuestionCount, 0), 87)
assert.ok(localInventory.topics.every((topic) => topic.verifiedQuestionCount >= 5), 'every official AS theory topic needs at least five reviewed groups before release')
assert.equal(localInventory.topics.filter((topic) => topic.ctaPolicy === 'start').length, 2, 'only topics at the ten-group ready threshold may present the ready CTA')
assert.ok(localInventory.topics.filter((topic) => topic.ctaPolicy === 'limited-indexing').every((topic) => topic.verifiedQuestionCount >= 5), 'reviewed below-ready source samples must remain explicitly limited')

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
  assert.equal(inventory.topics.reduce((sum, topic) => sum + topic.indexedQuestionCount, 0), 87)
  assert.equal(inventory.indexedQuestionGroupCount, 87)
  assert.equal(inventory.unmappedQuestionGroupCount, 0)
  assert.equal(inventory.topics.reduce((sum, topic) => sum + topic.verifiedQuestionCount, 0), 87)
  assert.ok(inventory.topics.every((topic) => topic.verifiedQuestionCount >= 5), 'API inventory must use the current canonical reviewed bank')
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

  const verifiedSet = await fetch(`${origin}/api/stem/practice-sets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${identityToken()}`,
    },
    body: JSON.stringify({
      routeId,
      syllabusTopicIds: ['physics-9702-topic-02'],
      questionCount: 5,
      components: [1],
      seed: 20260814,
    }),
  })
  assert.equal(verifiedSet.status, 201, 'a reviewed topic must create a real practice set through the API')
  const verifiedSetPayload = await verifiedSet.json()
  assert.equal(verifiedSetPayload.questionCount, 5)
  assert.equal(verifiedSetPayload.availableCount, 5)
  assert.ok(verifiedSetPayload.questionGroups.every((question) => question.paperComponent === 1), 'P1 selection must remain component-isolated')

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
  reviewedQuestionGroups: 87,
}))
