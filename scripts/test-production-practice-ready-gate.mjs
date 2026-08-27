import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { studyQuestionBank } from '../src/data/questionBank.js'
import { buildSyllabusPracticeSet } from '../src/lib/syllabusPractice.js'

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

  const studyOnlySet = buildSyllabusPracticeSet({
    routeId: 'cie-9702-a2-physics',
    syllabusTopicIds: ['9702-a2-topic-02'],
    components: [4],
    sourceQuestionIds: ['cie-9702-9702_m24_qp_42:q1'],
    questionBank: studyQuestionBank,
    includeStudyOnly: true,
    seed: 9702,
  })
  assert.equal(studyOnlySet.practiceMode, 'study-only', 'the regression fixture must remain outside the production eligibility gate')
  const persistedStudyOnlyUnit = {
    id: 'syllabus-set:production-study-only-rebind-regression',
    type: 'topic',
    sourceAuthority: 'server-syllabus',
    sourceGateVersion: 'server-syllabus-catalog-v2',
    routeId: studyOnlySet.routeId,
    knowledgeGroupId: studyOnlySet.syllabusTopicIds[0],
    syllabusTopic: studyOnlySet.syllabusTopicIds.join(','),
    paperComponent: studyOnlySet.components,
    practiceMode: 'study-only',
    parts: studyOnlySet.questionGroups.flatMap((group) => group.parts.map((part, index) => ({
      id: `production-study-only:${group.id}:${part.partId}:${index}`,
      sourceQuestionId: group.id,
      questionPartId: part.partId,
      sourceBindingProvenance: part.sourceBindingProvenance,
    }))),
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

  if (topic.verifiedQuestionCount > 0) {
    const practice = await call(api, {
      method: 'POST',
      url: '/api/stem/practice-sets',
      body: {
        routeId: 'cie-9702-a2-physics',
        syllabusTopicIds: [topic.id],
        components: [4],
        questionCount: 1,
        seed: 9702,
      },
    })
    assert.equal(practice.statusCode, 201, practice.payload.error)
    assert.equal(practice.payload.practiceMode, 'verified')
    assert.ok(practice.payload.questionGroups.every((group) => group.reviewStatus === 'reviewed' && group.studyOnly !== true))
  }
} finally {
  closeStemDatabaseForTests()
}

console.log('Production practice-ready eligibility regression passed.')
