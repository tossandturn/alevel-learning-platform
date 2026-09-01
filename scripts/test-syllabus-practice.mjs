import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import { CAMBRIDGE_9702_AS_SYLLABUS } from '../src/data/syllabus/cambridge-9702-as-2025-2027.js'
import { CAMBRIDGE_0625_IGCSE_SYLLABUS } from '../src/data/syllabus/cambridge-0625-igcse-2026-2028.js'
import { courseRoutes } from '../src/data/routeRegistry.js'
import importedQuestionIndex from '../src/data/importedQuestionIndex.json' with { type: 'json' }
import paperCatalog from '../public/data/papers.json' with { type: 'json' }
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { attemptedSourceQuestionIds } from '../src/lib/attemptAudit.js'
import { buildSyllabusPracticeSet, syllabusMappingCandidates, syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'

const routeId = 'cie-9702-as-physics'
const igcsePhysicsRouteId = 'cie-0625-igcse-physics'
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

const igcsePhysicsRoute = courseRoutes.find((item) => item.routeId === igcsePhysicsRouteId)
assert.ok(igcsePhysicsRoute, '0625 IGCSE Physics route must exist')
assert.equal(CAMBRIDGE_0625_IGCSE_SYLLABUS.topics.length, 6, '0625 must expose the six official physics content areas')
assert.deepEqual(CAMBRIDGE_0625_IGCSE_SYLLABUS.topics.map((topic) => topic.name), [
  'Motion, forces and energy',
  'Thermal physics',
  'Waves',
  'Electricity and magnetism',
  'Nuclear physics',
  'Space physics',
])
const igcseInventory = syllabusTopicsInventory({ routeId: igcsePhysicsRouteId })
assert.deepEqual(igcseInventory.assessmentComponents.map((item) => item.component), [2], '0625 Topic Drill must advertise only the currently source-backed theory component')
assert.deepEqual(igcseInventory.topics.map((topic) => topic.verifiedQuestionCount), [20, 14, 12, 19, 10, 5], '0625 inventory must aggregate both reviewed P2 papers by official syllabus topic')
assert.equal(igcseInventory.indexedQuestionGroupCount, 120, '0625 indexed count must include candidates while verified count remains fail-closed at 80')
const igcseSet = buildSyllabusPracticeSet({
  routeId: igcsePhysicsRouteId,
  syllabusTopicIds: ['0625-igcse-topic-06'],
  questionCount: 5,
  components: [2],
  seed: 20260815,
})
assert.equal(igcseSet.questionCount, 5, '0625 Space physics must expose its reviewed five-question set')
assert.ok(igcseSet.questionGroups.every((question) => question.routeId === igcsePhysicsRouteId && question.paperComponent === 2))

const firstPhysicsSet = buildSyllabusPracticeSet({
  routeId,
  syllabusTopicIds: ['physics-9702-topic-05', 'physics-9702-topic-07'],
  questionCount: 5,
  components: [1, 2],
  seed: 20260815,
})
const firstPhysicsIds = firstPhysicsSet.questionGroups.map((question) => question.id)
const repeatedPhysicsSet = buildSyllabusPracticeSet({
  routeId,
  syllabusTopicIds: ['physics-9702-topic-05', 'physics-9702-topic-07'],
  questionCount: 5,
  components: [1, 2],
  attemptedQuestionIds: [firstPhysicsIds[0]],
  seed: 20260815,
})
const repeatedPhysicsIds = repeatedPhysicsSet.questionGroups.map((question) => question.id)
assert.ok(!repeatedPhysicsIds.includes(firstPhysicsIds[0]), 'Topic Drill must prefer unseen reviewed question groups')
assert.deepEqual(
  buildSyllabusPracticeSet({
    routeId,
    syllabusTopicIds: ['physics-9702-topic-05', 'physics-9702-topic-07'],
    questionCount: 5,
    components: [1, 2],
    seed: 20260815,
  }).questionGroups.map((question) => question.id),
  firstPhysicsIds,
  'the saved practice seed must reproduce the same multi-topic set',
)

const p2OnlyPhysicsSet = buildSyllabusPracticeSet({
  routeId,
  syllabusTopicIds: ['physics-9702-topic-04'],
  questionCount: 10,
  components: [2],
  seed: 20260815,
})
assert.equal(p2OnlyPhysicsSet.availableCount, 2, 'the current Forces inventory must disclose its exact reviewed P2-only capacity')
assert.equal(p2OnlyPhysicsSet.questionCount, 2, 'a P2-only request must return a shorter honest set when fewer than ten reviewed groups exist')
assert.ok(p2OnlyPhysicsSet.questionGroups.every((question) => question.paperComponent === 2), 'P2-only Topic Drill must not fall back to P1 MCQs')
assert.ok(p2OnlyPhysicsSet.questionGroups.some((question) => question.id === 'cie-9702-9702_m25_qp_22:q2' && question.parts.length === 5 && question.totalMarks === 10), 'P2 Topic Drill must preserve the complete three-page M25/22 Q2 group')
assert.ok(p2OnlyPhysicsSet.questionGroups.every((question) => question.parts.every((part) => (
  part.markingProvenance?.sourceQuestionId === question.id
  && part.markingProvenance?.questionPartId === part.partId
  && part.markingProvenance?.bindingSignature === question.sourceContent.bindingSignature
  && /^[a-f0-9]{64}$/.test(part.markingProvenance?.sourceDocumentSha256 || '')
  && /^[a-f0-9]{64}$/.test(part.markingProvenance?.answerDocumentSha256 || '')
  && /^[a-f0-9]{64}$/.test(part.markingProvenance?.sourceIndexSha256 || '')
  && /^[a-f0-9]{64}$/.test(part.markingProvenance?.sourceManifestChecksum || '')
))), 'every server-generated Topic part must carry the complete immutable QP/MS and source-catalog provenance')
assert.deepEqual(attemptedSourceQuestionIds([
  {
    routeId,
    answers: { 'generated-unit-part-id': 'student response' },
    sourceBinding: { parts: [
      { sourceQuestionId: 'cie-9702-9702_m25_qp_22:q2' },
      { sourceQuestionId: 'cie-9702-9702_m25_qp_22:q2' },
      { sourceQuestionId: 'cie-9702-9702_m25_qp_12:q9' },
    ] },
  },
  { routeId: 'cie-0625-igcse-physics', sourceBinding: { parts: [{ sourceQuestionId: 'wrong-route:q1' }] } },
], routeId), [
  'cie-9702-9702_m25_qp_22:q2',
  'cie-9702-9702_m25_qp_12:q9',
], 'unseen-question preference must use canonical source question IDs, ignore generated part keys and stay route-scoped')

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
assert.equal(candidates.length, 147, 'the current 2023-2025 P1/P2 index must expose its real candidate count')
assert.equal(candidates.filter((candidate) => candidate.reviewStatus === 'reviewed').length, 112, 'only the manually reviewed P1/P2 source batches may enter the reviewed inventory')
assert.equal(candidates.filter((candidate) => candidate.reviewStatus === 'pending').length, 35, 'machine-indexed P2 groups must remain pending until source-semantic review')
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
  const binding = bindingsByQuestionId.get(expected.questionId)
  const answer = answersById.get(binding?.answerId)
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

const localInventory = syllabusTopicsInventory({ routeId, includeStudyOnly: false })
assert.equal(localInventory.topics.length, 11)
assert.equal(localInventory.topics.reduce((sum, topic) => sum + topic.indexedQuestionCount, 0), 147)
assert.equal(localInventory.indexedQuestionGroupCount, 147)
assert.equal(localInventory.unmappedQuestionGroupCount, 0)
assert.equal(localInventory.topics.reduce((sum, topic) => sum + topic.verifiedQuestionCount, 0), 112)
assert.ok(localInventory.topics.every((topic) => topic.verifiedQuestionCount >= 10), 'every official AS theory topic must retain its reviewed source inventory')
assert.equal(localInventory.ready, false, 'the AS route must remain unavailable while ten official topics lack two six-question tests')
assert.equal(localInventory.topics.filter((topic) => topic.ctaPolicy === 'start').length, 1, 'only the current twelve-group Waves topic may claim formal readiness')
assert.equal(localInventory.topics.filter((topic) => topic.ctaPolicy === 'hidden').length, 10, 'under-floor reviewed topics must not become study-mode fallbacks')

const api = createStemApi({
  env: { STEM_IDENTITY_SIGNING_KEY: signingKey, STEM_DB_PATH: ':memory:' },
})
const ownerToken = identityToken()
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
  assert.deepEqual(inventory.assessmentComponents.map((item) => item.component), [1, 2], '9702 Topic Drill must keep P3 practical work in its separate route')
  assert.equal(inventory.topics.length, 11)
  assert.equal(inventory.topics.reduce((sum, topic) => sum + topic.indexedQuestionCount, 0), 147)
  assert.equal(inventory.indexedQuestionGroupCount, 147)
  assert.equal(inventory.unmappedQuestionGroupCount, 0)
  assert.equal(inventory.topics.reduce((sum, topic) => sum + topic.verifiedQuestionCount, 0), 112)
  assert.ok(inventory.topics.every((topic) => topic.verifiedQuestionCount >= 10), 'API inventory must use the current canonical reviewed bank')
  assert.equal(inventory.ready, false, 'API inventory must retain the two-test readiness gate')
  assert.equal(inventory.topics.filter((topic) => topic.ctaPolicy === 'start').length, 1, 'API formal readiness must expose only the current twelve-group topic')
  assert.equal(inventory.topics.filter((topic) => topic.ctaPolicy === 'hidden').length, 10, 'API must not relabel under-floor reviewed topics as study practice')
  assert.equal(inventory.officialPaperCount, 46)
  assert.equal(inventory.officialPairedPaperCount, 46)
  assert.ok(inventory.topics.every((topic) => topic.points.length > 0), 'API must return official syllabus points')
  assert.ok(inventory.topics.every((topic) => topic.questionIdsByComponent && topic.questionIdsByComponent[1] && topic.questionIdsByComponent[2]), 'API inventory must expose stable question identities for multi-topic count deduplication')

  const unauthenticatedSet = await fetch(`${origin}/api/stem/practice-sets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      routeId,
      syllabusTopicIds: ['physics-9702-topic-07'],
      questionCount: 6,
      components: [1, 2],
    }),
  })
  assert.equal(unauthenticatedSet.status, 201, 'a guest may create a six-question local source-backed practice set without accessing private workspace data')
  const unauthenticatedPayload = await unauthenticatedSet.json()
  assert.equal(unauthenticatedPayload.ownerId, null)
  assert.equal(unauthenticatedPayload.questionCount, 6)
  assert.equal(unauthenticatedPayload.sourceQuestionCount, 6)
  assert.equal(unauthenticatedPayload.answerPartCount, unauthenticatedPayload.questionGroups.reduce((sum, group) => sum + group.parts.length, 0))
  assert.equal(unauthenticatedPayload.paperCount, new Set(unauthenticatedPayload.questionGroups.map((group) => group.sourceRef?.paperId).filter(Boolean)).size)
  assert.equal(unauthenticatedPayload.totalMarks, unauthenticatedPayload.questionGroups.reduce((sum, group) => sum + group.parts.reduce((partSum, part) => partSum + Number(part.marks || 0), 0), 0))

  const verifiedSet = await fetch(`${origin}/api/stem/practice-sets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ownerToken}`,
    },
    body: JSON.stringify({
      routeId,
      syllabusTopicIds: ['physics-9702-topic-07'],
      questionCount: 6,
      components: [1, 2],
      seed: 20260814,
    }),
  })
  assert.equal(verifiedSet.status, 201, 'a reviewed topic must create a real practice set through the API')
  const verifiedSetPayload = await verifiedSet.json()
  assert.equal(verifiedSetPayload.questionCount, 6)
  assert.equal(verifiedSetPayload.sourceQuestionCount, 6)
  assert.equal(verifiedSetPayload.answerPartCount, verifiedSetPayload.questionGroups.reduce((sum, group) => sum + group.parts.length, 0))
  assert.equal(verifiedSetPayload.paperCount, new Set(verifiedSetPayload.questionGroups.map((group) => group.sourceRef?.paperId).filter(Boolean)).size)
  assert.equal(verifiedSetPayload.totalMarks, verifiedSetPayload.questionGroups.reduce((sum, group) => sum + group.parts.reduce((partSum, part) => partSum + Number(part.marks || 0), 0), 0))
  assert.equal(verifiedSetPayload.availableCount, 12)
  assert.ok(verifiedSetPayload.questionGroups.every((question) => [1, 2].includes(question.paperComponent)), 'the positive Topic Drill must remain inside the selected official theory components')

  const persistedUnit = {
    id: 'syllabus-set:http-rebind-fixture',
    type: 'topic',
    title: 'client-forged-title-must-not-survive-rebind',
    prompt: 'client-forged-prompt-must-not-survive-rebind',
    sourceAuthority: 'server-syllabus',
    sourceGateVersion: 'server-syllabus-catalog-v2',
    routeId,
    stage: 'AS',
    syllabusTopic: verifiedSetPayload.syllabusTopicIds.join(','),
    knowledgeGroupId: verifiedSetPayload.syllabusTopicIds[0],
    paperComponent: verifiedSetPayload.components,
    parts: verifiedSetPayload.questionGroups.flatMap((group) => group.parts.map((part, index) => ({
      id: `http-rebind:${group.id}:${part.partId}:${index}`,
      sourceKind: 'past-paper',
      sourceQuestionId: group.id,
      questionPartId: part.partId,
      prompt: 'client-forged-part-prompt-must-not-survive-rebind',
      sourceRef: { localUrl: 'https://example.invalid/forged-source.pdf' },
      sourceBindingProvenance: part.sourceBindingProvenance,
    }))),
    sourceRef: { localUrl: 'https://example.invalid/forged-source.pdf' },
  }
  const rebindResponse = await fetch(`${origin}/api/stem/practice-sets/rebind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit: persistedUnit }),
  })
  assert.equal(rebindResponse.status, 200, 'a current persisted syllabus set must be revalidated over the real HTTP boundary')
  const reboundPayload = await rebindResponse.json()
  assert.equal(reboundPayload.unit.sourceGateStatus, 'current')
  assert.equal(reboundPayload.unit.questionGroupCount, verifiedSetPayload.questionCount)
  assert.notEqual(reboundPayload.unit.title, persistedUnit.title, 'the server must rebuild the student-facing title from canonical route/topic data')
  assert.notEqual(reboundPayload.unit.prompt, persistedUnit.prompt, 'arbitrary client prompt data must not be echoed by rebind')
  assert.notEqual(reboundPayload.unit.sourceRef?.localUrl, persistedUnit.sourceRef.localUrl, 'arbitrary client source references must not be echoed by rebind')
  assert.notEqual(reboundPayload.unit.parts[0].prompt, persistedUnit.parts[0].prompt, 'arbitrary client part prompt data must not be echoed by rebind')
  assert.notEqual(reboundPayload.unit.parts[0].sourceRef?.localUrl, persistedUnit.parts[0].sourceRef.localUrl, 'part source references must come from the canonical bank')

  const focusedPart = persistedUnit.parts[0]
  const parentAttemptId = 'att-syllabus-parent-0001'
  const persistedParentResponse = await fetch(`${origin}/api/stem/attempts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ownerToken}`,
    },
    body: JSON.stringify({
      attemptId: parentAttemptId,
      mode: 'topic',
      routeId,
      stage: 'AS',
      unitId: persistedUnit.id,
      submittedAt: new Date().toISOString(),
      markingParts: persistedUnit.parts.map((part) => ({
        unitPartId: part.id,
        provenance: { routeId, ...part.sourceBindingProvenance },
      })),
      attempt: {
        id: parentAttemptId,
        unitId: persistedUnit.id,
        routeId,
        stage: 'AS',
        attemptStatus: 'result',
      },
    }),
  })
  assert.equal(persistedParentResponse.status, 201, 'a focused retest parent must be a server-owned submitted topic attempt')
  const focusedUnit = {
    ...persistedUnit,
    id: `${persistedUnit.id}:focused:${focusedPart.id}`,
    focusedRetestOf: persistedUnit.id,
    focusedRetestParentAttemptId: parentAttemptId,
    parts: [focusedPart],
  }
  const focusedRebindResponse = await fetch(`${origin}/api/stem/practice-sets/rebind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ownerToken}` },
    body: JSON.stringify({ unit: focusedUnit }),
  })
  assert.equal(focusedRebindResponse.status, 200, 'a focused retest must be revalidated together with its six-question parent')
  const focusedRebindPayload = await focusedRebindResponse.json()
  assert.equal(focusedRebindPayload.unit.focusedRetestOf, persistedUnit.id)
  assert.equal(focusedRebindPayload.unit.focusedRetestValidated, true)
  assert.equal(focusedRebindPayload.unit.questionGroupCount, 1)
  assert.equal(focusedRebindPayload.unit.parts[0].id, focusedPart.id)

  const parentlessFocusedResponse = await fetch(`${origin}/api/stem/practice-sets/rebind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ownerToken}` },
    body: JSON.stringify({ unit: { ...focusedUnit, focusedRetestParentAttemptId: '' } }),
  })
  assert.equal(parentlessFocusedResponse.status, 409, 'a client-declared focused retest without a server-issued parent attempt must fail closed')
  assert.equal((await parentlessFocusedResponse.json()).code, 'focused_retest_parent_unavailable')

  const forgedUnit = structuredClone(persistedUnit)
  forgedUnit.parts[0].sourceBindingProvenance.bindingSignature = 'fnv1a64:0000000000000000'
  const forgedRebindResponse = await fetch(`${origin}/api/stem/practice-sets/rebind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit: forgedUnit }),
  })
  assert.equal(forgedRebindResponse.status, 409, 'a forged persisted binding must fail before it can re-enter the client practice inventory')
  const forgedRebindPayload = await forgedRebindResponse.json()
  assert.equal(forgedRebindPayload.code, 'stale_syllabus_practice_set')

  const invalidPracticalSet = await fetch(`${origin}/api/stem/practice-sets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${identityToken()}`,
    },
    body: JSON.stringify({
      routeId,
      syllabusTopicIds: ['physics-9702-topic-07'],
      questionCount: 6,
      components: [1, 3],
    }),
  })
  assert.equal(invalidPracticalSet.status, 400, 'authenticated Topic Drill requests containing P3 must be rejected explicitly')

  const invalidRebind = await fetch(`${origin}/api/stem/practice-sets/rebind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(invalidRebind.status, 400, 'rebind must reject a missing persisted unit before catalog lookup')

  const oversizedRebind = await fetch(`${origin}/api/stem/practice-sets/rebind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unit: { ...persistedUnit, untrustedPadding: 'x'.repeat(300_000) } }),
  })
  assert.equal(oversizedRebind.status, 413, 'rebind must reject oversized persisted payloads before source work')
} finally {
  await new Promise((resolve) => server.close(resolve))
  closeStemDatabaseForTests()
}

console.log(JSON.stringify({
  status: 'passed',
  topics: CAMBRIDGE_9702_AS_SYLLABUS.topics.length,
  points: CAMBRIDGE_9702_AS_SYLLABUS.points.length,
  indexedQuestionGroups: candidates.length,
  reviewedQuestionGroups: 112,
}))
