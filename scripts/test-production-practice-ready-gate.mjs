import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

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
