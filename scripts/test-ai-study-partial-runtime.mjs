import assert from 'node:assert/strict'
import http from 'node:http'

import { closeStemDatabaseForTests, createCurriculumPracticeAccess, createStemApi } from '../server/stemApi.js'
import { seedSyllabusTables } from '../src/lib/syllabusPractice.js'
import { freeFetchPort } from './lib/fetch-safe-port.mjs'

const env = { NODE_ENV: 'test', STEM_DB_PATH: ':memory:', STEM_IDENTITY_SIGNING_KEY: 'partial-runtime-fixture-only' }
const database = createCurriculumPracticeAccess({ env, questionBank: [] }).databaseProvider()
seedSyllabusTables(database, [])
const route = 'cie-9708-a2-economics', id = 'cie-9708-partial-runtime-fixture:q1'
database.prepare(`INSERT INTO route_question_groups
  (route_id,id,stage,subject_code,paper_component,question_paper_id,mark_scheme_id,question_pages_json,
   mark_scheme_pages_json,total_marks,source_content_complete,study_eligible,student_study_released,
   verification_status,source_json,answer_json,parts_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(route, id, 'A2', '9708', 3, 'fixture_qp', 'fixture_ms', '[1]', '[1]', 1, 1, 1, 1,
    'ai-verified', '{}', '{}', '[]', '2026-11-16T00:00:00Z')
const snapshot = Object.freeze([])
let complete = false
const provider = () => snapshot
provider.isSnapshotComplete = () => complete
const api = createStemApi({ env, questionBank: Object.freeze([]), topicQuestionBankProvider: provider })
const server = http.createServer((request, response) => Promise.resolve(api(request, response, () => {
  response.statusCode = 404; response.end()
})).catch(() => { if (!response.headersSent) response.statusCode = 500; response.end() }))
const port = await freeFetchPort()
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
const url = `http://127.0.0.1:${server.address().port}/api/stem/routes/cie-9702-as-physics/syllabus-topics`
const count = () => database.prepare('SELECT COUNT(*) AS count FROM route_question_groups WHERE route_id = ? AND id = ?').get(route, id).count
try {
  const partial = await fetch(url)
  assert.equal(partial.status, 200)
  assert.equal((await partial.json()).aggregation, 'validated-runtime-snapshot')
  assert.equal(count(), 1, 'a partial HTTP snapshot must preserve prior AI rows')
  complete = true
  const restored = await fetch(url)
  assert.equal(restored.status, 200)
  assert.equal((await restored.json()).aggregation, 'sqlite-question-groups-and-syllabus-mappings')
  assert.equal(count(), 0, 'the same array after complete recovery must be reseeded and remove stale AI rows')
  console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'partial-to-complete-http-snapshot', retained: true, staleRemovedAfterRecovery: true }))
} finally {
  await new Promise((resolve) => server.close(resolve))
  closeStemDatabaseForTests()
}
