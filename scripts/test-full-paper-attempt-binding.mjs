import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'

import { isAiMarkablePastPaperItem, studyQuestionBank } from '../src/data/questionBank.js'
import { canonicalAiMarkingProvenance } from '../src/lib/sourceContentContract.js'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const signingKey = 'full-paper-attempt-binding-test-key'
const routeId = 'cie-9702-as-physics'
const question = studyQuestionBank.find((candidate) => (
  candidate.routeId === routeId
  && candidate.stage === 'AS'
  && isAiMarkablePastPaperItem(candidate)
  && candidate.sourceRef?.paperId
  && candidate.parts?.length
))
assert.ok(question, 'the checked-in bank must contain a source-bound full-paper fixture')
const part = question.parts[0]
const provenance = canonicalAiMarkingProvenance(question, part)
assert.ok(provenance, 'the full-paper fixture must have canonical marking provenance')
const paperId = String(question.sourceRef.paperId)
const attemptId = 'full-paper-binding-attempt-0001'

function signedIdentityToken(userId = 1001) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: `ielts:${userId}`,
    username: `full-paper-${userId}`,
    iat: now,
    exp: now + 3600,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function call(api, { method, url, body }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body), 'utf8')] : [])
    request.method = method
    request.url = url
    request.headers = { authorization: `Bearer ${signedIdentityToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) }
    const response = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value },
      end(raw = '') {
        let payload = {}
        try { payload = JSON.parse(String(raw || '{}')) } catch { payload = { raw: String(raw || '') } }
        resolve({ statusCode: this.statusCode, payload, headers: this.headers })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

const api = createStemApi({
  env: { NODE_ENV: 'production', STEM_INTERNAL_AUTH_KEY: signingKey, STEM_DB_PATH: ':memory:' },
  questionBank: [question],
})
const base = {
  attemptId,
  mode: 'full-paper',
  routeId,
  stage: 'AS',
  paperId,
  paperStudyMode: 'past-paper-practice',
  markingParts: [{ unitPartId: 'answer-slot-1', provenance: { routeId, ...provenance } }],
  attempt: {
    id: attemptId,
    mode: 'full-paper',
    routeId,
    stage: 'AS',
    paperId,
    paperStudyMode: 'past-paper-practice',
    attemptStatus: 'draft',
    answers: {},
  },
}

try {
  const draft = await call(api, { method: 'POST', url: '/api/stem/attempts', body: base })
  assert.equal(draft.statusCode, 201, draft.payload.error)
  assert.equal(draft.payload.attempt.submissionStatus, 'draft')
  const draftHistory = await call(api, { method: 'GET', url: '/api/stem/attempts' })
  assert.equal(draftHistory.statusCode, 200)
  assert.equal(draftHistory.payload.attempts[0].binding.paperStudyMode, 'past-paper-practice', 'full-paper binding must persist its study mode')

  const forgedMode = await call(api, {
    method: 'POST',
    url: '/api/stem/attempts',
    body: {
      ...base,
      paperStudyMode: 'exam-simulation',
      attempt: { ...base.attempt, paperStudyMode: 'exam-simulation' },
    },
  })
  assert.equal(forgedMode.statusCode, 409, 'a draft full-paper attempt must not switch study mode under the same attempt ID')
  assert.equal(forgedMode.payload.code, 'attempt_binding_mismatch')

  const submittedBody = {
    ...base,
    submittedAt: '2026-09-01T00:00:00.000Z',
    attempt: { ...base.attempt, attemptStatus: 'marking-pending', submittedAt: '2026-09-01T00:00:00.000Z' },
  }
  const submitted = await call(api, { method: 'POST', url: '/api/stem/attempts', body: submittedBody })
  assert.equal(submitted.statusCode, 200, submitted.payload.error)
  assert.equal(submitted.payload.attempt.submissionStatus, 'submitted')
  const submittedHistory = await call(api, { method: 'GET', url: '/api/stem/attempts' })
  assert.equal(submittedHistory.payload.attempts[0].binding.paperStudyMode, 'past-paper-practice')

  const idempotent = await call(api, { method: 'POST', url: '/api/stem/attempts', body: submittedBody })
  assert.equal(idempotent.statusCode, 200, idempotent.payload.error)
  assert.equal(idempotent.payload.duplicate, true)
  assert.equal(idempotent.payload.attempt.submittedAt, submitted.payload.attempt.submittedAt)

  const postSubmitAnswerChange = await call(api, {
    method: 'POST',
    url: '/api/stem/attempts',
    body: {
      ...submittedBody,
      attempt: {
        ...submittedBody.attempt,
        answers: { [part.id]: 'changed after submission' },
      },
    },
  })
  assert.equal(postSubmitAnswerChange.statusCode, 409, 'a submitted full-paper attempt must reject a changed answer snapshot')
  assert.equal(postSubmitAnswerChange.payload.code, 'attempt_submitted_immutable')
  const afterRejectedAnswerChange = await call(api, { method: 'GET', url: '/api/stem/attempts' })
  assert.deepEqual(
    afterRejectedAnswerChange.payload.attempts[0].attempt.answers,
    submitted.payload.attempt.answers,
    'a rejected post-submit update must leave the original answer snapshot unchanged',
  )

  const postSubmitModeChange = await call(api, {
    method: 'POST',
    url: '/api/stem/attempts',
    body: {
      ...submittedBody,
      paperStudyMode: 'exam-simulation',
      attempt: { ...submittedBody.attempt, paperStudyMode: 'exam-simulation' },
    },
  })
  assert.equal(postSubmitModeChange.statusCode, 409, 'a submitted full-paper attempt must keep its immutable study mode')
  assert.equal(postSubmitModeChange.payload.code, 'attempt_binding_mismatch')
} finally {
  closeStemDatabaseForTests()
}

console.log(JSON.stringify({ status: 'passed', scope: 'full-paper-attempt-binding', paperId }))
