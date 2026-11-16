import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { closeStemDatabaseForTests, createCoachAttemptAuthorizer, createCurriculumPracticeAccess } from '../server/stemApi.js'
import { seedSyllabusTables } from '../src/lib/syllabusPractice.js'

const workspace = fs.realpathSync(path.resolve(import.meta.dirname, '..'))
const fixture = fs.mkdtempSync(path.join(workspace, '.coach-seed-fixture-'))
const signingKey = 'local-coach-seed-fixture-only'
const env = { NODE_ENV: 'test', STEM_DB_PATH: path.join(fixture, 'stem.sqlite'), STEM_IDENTITY_SIGNING_KEY: signingKey }
const now = Math.floor(Date.now() / 1000)
const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
const body = Buffer.from(JSON.stringify({ iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: 'ielts:940001',
  username: 'local-seed-fixture', iat: now, exp: now + 3600 })).toString('base64url')
const token = `${head}.${body}.${crypto.createHmac('sha256', signingKey).update(`${head}.${body}`).digest('base64url')}`
const routeId = 'cie-9708-a2-economics', questionId = 'cie-9708-seed-fixture:q1'
try {
  const database = createCurriculumPracticeAccess({ env, questionBank: [] }).databaseProvider()
  seedSyllabusTables(database, [])
  database.prepare(`INSERT INTO route_question_groups
    (route_id,id,stage,subject_code,paper_component,question_paper_id,mark_scheme_id,question_pages_json,
     mark_scheme_pages_json,total_marks,source_content_complete,study_eligible,student_study_released,
     verification_status,source_json,answer_json,parts_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(routeId, questionId, 'A2', '9708', 3, 'fixture_qp', 'fixture_ms', '[1]', '[1]', 1, 1, 1, 1,
      'ai-verified', '{}', '{}', '[]', '2026-11-16T00:00:00Z')
  closeStemDatabaseForTests()

  const authorize = createCoachAttemptAuthorizer({ env, questionBank: [] })
  assert.throws(() => authorize({ request: { headers: { authorization: `Bearer ${token}` } },
    payload: { context: { view: 'full-paper', attemptId: 'coach-seed-nonexistent-0001' } } }),
  (error) => error.code === 'coach_attempt_not_found')
  const reopened = createCurriculumPracticeAccess({ env, questionBank: [] }).databaseProvider()
  const result = reopened.prepare('SELECT COUNT(*) AS count FROM route_question_groups WHERE route_id = ? AND id = ?').get(routeId, questionId)
  assert.equal(result.count, 1, 'first Coach access must not reseed an incomplete static bank or delete existing AI rows')
  console.log(JSON.stringify({ status: 'PASS_LOCAL_ONLY', scope: 'coach-first-access-does-not-reseed-source' }))
} finally {
  closeStemDatabaseForTests()
  const resolved = fs.realpathSync(fixture)
  assert.equal(path.dirname(resolved), workspace)
  assert.ok(path.basename(resolved).startsWith('.coach-seed-fixture-'))
  fs.rmSync(resolved, { recursive: true, force: true })
}
