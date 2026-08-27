import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const routeIds = [
  'cie-0580-igcse-mathematics',
  'cie-9709-as-p1-p2',
  'cie-9709-as-p1-p4',
  'cie-9709-as-p1-p5',
  'cie-9709-a2-after-p1-p5-p3-p4',
  'cie-9709-a2-after-p1-p5-p3-p6',
  'cie-9709-a2-after-p1-p4-p3-p5',
]

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
      end(value = '') {
        const text = String(value || '')
        resolve({ statusCode: this.statusCode, payload: text ? JSON.parse(text) : null })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

function idsForTopicComponent(topic, component) {
  const ids = topic.questionIdsByComponent?.[component] || {}
  return [...new Set([...(ids.verifiedQuestionIds || []), ...(ids.studyQuestionIds || [])])]
}

async function verifyStudyCountListStart() {
  const api = createStemApi({
    env: {
      NODE_ENV: 'test',
      STEM_DB_PATH: ':memory:',
      STEM_ENABLE_STUDY_ONLY_TOPIC_DRILL: '1',
    },
  })
  try {
    for (const routeId of routeIds) {
      const response = await call(api, { method: 'GET', url: `/api/stem/routes/${encodeURIComponent(routeId)}/syllabus-topics` })
      assert.equal(response.statusCode, 200)
      const inventory = response.payload
      const allAvailableIds = new Set()
      let startCandidate = null
      for (const topic of inventory.topics) {
        for (const component of inventory.assessmentComponents.map((item) => item.component)) {
          const ids = idsForTopicComponent(topic, component)
          ids.forEach((id) => allAvailableIds.add(id))
          assert.equal(
            ids.length,
            Number(topic.componentCounts?.[component]?.availableQuestionCount || 0),
            `${routeId}/${topic.id}/P${component} count must equal its startable source ID list`,
          )
          if (!startCandidate && ids.length >= 6) startCandidate = { topic, component, ids: ids.slice(0, 6) }
        }
      }
      assert.equal(inventory.availableQuestionGroupCount, allAvailableIds.size, `${routeId} top-level count must be distinct across multi-topic membership`)
      assert.ok(startCandidate, `${routeId} needs at least one evidence-backed six-question study set for this regression`)

      const practice = await call(api, {
        method: 'POST',
        url: '/api/stem/practice-sets',
        body: {
          routeId,
          syllabusTopicIds: [startCandidate.topic.id],
          components: [startCandidate.component],
          questionCount: 6,
          sourceQuestionIds: startCandidate.ids,
          excludeAttempted: false,
          seed: 9709,
        },
      })
      assert.equal(practice.statusCode, 201, `${routeId} count/list evidence must start successfully`)
      assert.equal(practice.payload.questionCount, 6)
      assert.deepEqual(practice.payload.sourceQuestionIds, startCandidate.ids)
    }
  } finally {
    closeStemDatabaseForTests()
  }
}

async function verifyProductionGate() {
  const api = createStemApi({ env: { NODE_ENV: 'production', STEM_DB_PATH: ':memory:' } })
  try {
    for (const routeId of routeIds) {
      const response = await call(api, { method: 'GET', url: `/api/stem/routes/${encodeURIComponent(routeId)}/syllabus-topics` })
      assert.equal(response.statusCode, 200)
      assert.equal(response.payload.studyQuestionGroupCount, 0)
      assert.equal(response.payload.availableQuestionGroupCount, response.payload.verifiedQuestionGroupCount)
      assert.ok(response.payload.topics.every((topic) => topic.studyQuestionCount === 0))
    }
  } finally {
    closeStemDatabaseForTests()
  }
}

await verifyStudyCountListStart()
await verifyProductionGate()

console.log(JSON.stringify({ status: 'passed', scope: 'topic-drill-count-list-start', routes: routeIds.length }))
