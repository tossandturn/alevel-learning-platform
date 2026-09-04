import assert from 'node:assert/strict'
import { Readable } from 'node:stream'

import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'
import { routeById } from '../src/data/routeRegistry.js'
import { syllabusTopicsInventory } from '../src/lib/syllabusPractice.js'

function call(api, { method, url }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from([])
    request.method = method
    request.url = url
    request.headers = { accept: 'application/json' }
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
      end(value = '') {
        resolve({ statusCode: this.statusCode, payload: value ? JSON.parse(value) : null })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

const routeId = 'cie-9709-as-p1-p4'
const route = routeById(routeId)
assert.ok(route, 'the 9709 P1 + M1 route must exist')
assert.deepEqual(
  route.syllabus.componentScope.map((scope) => scope.component),
  [1, 4],
  'route metadata must retain the selected official component scope',
)
assert.ok(
  route.syllabus.topics.find((topic) => topic.code === '1.1').officialNotes.some((note) => /vertex|sketch/i.test(note)),
  'route topic metadata must retain official notes for its outcomes',
)

const inventory = syllabusTopicsInventory({ routeId, questionBank: [] })
assert.deepEqual(
  inventory.componentScope.map((scope) => scope.component),
  [1, 4],
  'static inventory metadata must retain the selected official component scope',
)
assert.ok(
  inventory.topics.find((topic) => topic.code === '1.1').officialNotes.some((note) => /vertex|sketch/i.test(note)),
  'static inventory must retain topic official notes',
)

const api = createStemApi({ env: { NODE_ENV: 'test', STEM_DB_PATH: ':memory:' } })
try {
  const response = await call(api, { method: 'GET', url: `/api/stem/routes/${routeId}/syllabus-topics` })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(
    response.payload.componentScope.map((scope) => scope.component),
    [1, 4],
    'HTTP inventory must expose the selected official component scope',
  )
  assert.ok(
    response.payload.topics.find((topic) => topic.code === '1.1').officialNotes.some((note) => /vertex|sketch/i.test(note)),
    'HTTP inventory must expose topic official notes',
  )
} finally {
  closeStemDatabaseForTests()
}

console.log(JSON.stringify({ status: 'passed', scope: 'syllabus-metadata-propagation' }))
