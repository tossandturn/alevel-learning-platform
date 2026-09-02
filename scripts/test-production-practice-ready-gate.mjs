import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { studyQuestionBank } from '../src/data/questionBank.js'
import { MIN_VERIFIED_GROUPS_FOR_PRACTICE } from '../src/lib/practiceConstants.js'

function call(api, { method, url, body }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body), 'utf8')] : [])
    request.method = method
    request.url = url
    request.headers = {}
    const response = {
      statusCode: 0,
      headers: new Map(),
      setHeader(name, value) { this.headers.set(String(name).toLowerCase(), value) },
      end(raw) {
        resolve({ statusCode: this.statusCode, payload: JSON.parse(raw || '{}') })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

const api = createStemApi({ env: { STEM_DB_PATH: ':memory:' } })
try {
  const inventory = await call(api, { method: 'GET', url: '/api/stem/routes/cie-9702-a2-physics/syllabus-topics' })
  assert.equal(inventory.statusCode, 200)
  const topic = inventory.payload.topics.find((item) => item.id === 'physics-9702-topic-13')
  assert.ok(topic, 'the official A2 Physics topic must be present')
  assert.equal(topic.availableQuestionCount, topic.verifiedQuestionCount, 'production availability must exclude study-only source records')
  assert.equal(topic.studyQuestionCount, 0, 'production Topic Drill must not expose unreviewed study records')

  const studyOnlyQuestion = studyQuestionBank.find((question) => question.sourceQuestionId === 'cie-9702-9702_m24_qp_42:q1')
  assert.ok(studyOnlyQuestion, 'the source-backed A2 study-only fixture must exist')
  const studyOnlyPart = studyOnlyQuestion.parts[0]
  assert.ok(studyOnlyPart, 'the source-backed A2 study-only fixture must contain a part')
  const rejectedStudyOnlyStart = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets',
    body: {
      routeId: 'cie-9702-a2-physics',
      syllabusTopicIds: ['9702-a2-topic-02'],
      components: [4],
      questionCount: 6,
      sourceQuestionIds: [studyOnlyQuestion.sourceQuestionId],
      seed: 9702,
    },
  })
  assert.equal(rejectedStudyOnlyStart.statusCode, 409, 'production Topic Drill must reject study-only source records before it can start')
  const persistedStudyOnlyUnit = {
    id: 'syllabus-set:production-study-only-rebind-regression',
    type: 'topic',
    sourceAuthority: 'server-syllabus',
    sourceGateVersion: 'server-syllabus-catalog-v2',
    routeId: studyOnlyQuestion.routeId,
    knowledgeGroupId: 'physics-9702-topic-13',
    syllabusTopic: 'physics-9702-topic-13',
    paperComponent: [4],
    practiceMode: 'study-only',
    parts: [{
      id: `production-study-only:${studyOnlyQuestion.sourceQuestionId}:${studyOnlyPart.partId}`,
      sourceQuestionId: studyOnlyQuestion.sourceQuestionId,
      questionPartId: studyOnlyPart.partId,
      sourceBindingProvenance: studyOnlyPart.sourceBindingProvenance,
    }],
  }
  const rejectedStudyOnlyRebind = await call(api, {
    method: 'POST',
    url: '/api/stem/practice-sets/rebind',
    body: { unit: persistedStudyOnlyUnit },
  })
  assert.equal(
    rejectedStudyOnlyRebind.statusCode,
    409,
    'production rebind must enforce the same practice-ready gate as count, list, and start',
  )

  if (topic.verifiedQuestionCount >= MIN_VERIFIED_GROUPS_FOR_PRACTICE) {
    const practice = await call(api, {
      method: 'POST',
      url: '/api/stem/practice-sets',
      body: {
        routeId: 'cie-9702-a2-physics',
        syllabusTopicIds: [topic.id],
        components: [4],
        questionCount: 6,
        seed: 9702,
      },
    })
    assert.equal(practice.statusCode, 201, practice.payload.error)
    assert.equal(practice.payload.practiceMode, 'verified')
    assert.equal(practice.payload.questionCount, 6)
    assert.ok(practice.payload.questionGroups.every((group) => group.reviewStatus === 'reviewed' && group.studyOnly !== true))
  }
} finally {
  closeStemDatabaseForTests()
}

console.log('Production practice-ready eligibility regression passed.')
