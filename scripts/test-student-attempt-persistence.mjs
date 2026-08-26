import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'

import { isAiMarkablePastPaperItem, studyQuestionBank } from '../src/data/questionBank.js'
import { canonicalAiMarkingProvenance } from '../src/lib/sourceContentContract.js'
import { closeStemDatabaseForTests, createStemApi } from '../server/stemApi.js'

const identitySigningKey = 'student-attempt-persistence-identity-key'
const capabilitySigningKey = 'student-attempt-persistence-capability-key'

function signedIdentityToken(userId, { includeExpiry = true } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: `ielts:${userId}`,
    username: `student-${userId}`,
    iat: now,
  }
  if (includeExpiry) claims.exp = now + 3600
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = crypto.createHmac('sha256', identitySigningKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function call(api, { method, url, token = '', body }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [Buffer.from(JSON.stringify(body), 'utf8')] : [])
    request.method = method
    request.url = url
    request.headers = token ? { authorization: `Bearer ${token}` } : {}
    const response = {
      statusCode: 0,
      headers: new Map(),
      setHeader(name, value) { this.headers.set(String(name).toLowerCase(), value) },
      end(raw) {
        let payload = {}
        try { payload = JSON.parse(raw || '{}') } catch { payload = { raw: String(raw || '') } }
        resolve({ statusCode: this.statusCode, payload, headers: Object.fromEntries(this.headers) })
      },
    }
    Promise.resolve(api(request, response, () => reject(new Error(`Unhandled ${method} ${url}`)))).catch(reject)
  })
}

function markableParts() {
  const records = []
  for (const question of studyQuestionBank) {
    if (!isAiMarkablePastPaperItem(question)) continue
    for (const part of question.parts || []) {
      const provenance = canonicalAiMarkingProvenance(question, part)
      if (provenance) records.push({ question, part, provenance })
      if (records.length === 2) return records
    }
  }
  return records
}

const [first, second] = markableParts()
assert.ok(first && second, 'the checked-in bank must contain two source-bound AI-markable parts for ownership regression coverage')

const api = createStemApi({
  env: {
    STEM_IDENTITY_SIGNING_KEY: identitySigningKey,
    STEM_MARKING_CAPABILITY_SIGNING_KEY: capabilitySigningKey,
    STEM_DB_PATH: ':memory:',
  },
  questionBank: [first.question, second.question],
})
const ownerToken = signedIdentityToken(1001)
const otherToken = signedIdentityToken(2002)
const attemptId = 'student-persisted-attempt-0001'
const draftAttemptId = 'student-draft-attempt-0001'
const bindingPart = { provenance: { routeId: first.question.routeId, ...first.provenance } }
const capabilityRequest = {
  attemptId,
  mode: 'topic',
  submitted: true,
  paperId: String(first.question.sourceRef?.paperId || ''),
  parts: [bindingPart],
}

try {
  const missingExpiry = await call(api, {
    method: 'GET',
    url: '/api/stem/attempts',
    token: signedIdentityToken(1001, { includeExpiry: false }),
  })
  assert.equal(missingExpiry.statusCode, 401, 'a signed STEM identity token without exp must be rejected')

  const unpersisted = await call(api, {
    method: 'POST',
    url: '/api/stem/marking/capabilities',
    token: ownerToken,
    body: capabilityRequest,
  })
  assert.equal(unpersisted.statusCode, 409, 'a client-generated attemptId must not receive a marking grant before a server-owned submission exists')
  assert.equal(unpersisted.payload.code, 'attempt_not_persisted')

  const draft = await call(api, {
    method: 'POST',
    url: '/api/stem/attempts',
    token: ownerToken,
    body: {
      attemptId: draftAttemptId,
      mode: 'topic',
      routeId: first.question.routeId,
      paperId: String(first.question.sourceRef?.paperId || ''),
      unitId: 'ownership-regression-unit',
      stage: first.question.stage,
      markingParts: [bindingPart],
      attempt: {
        id: draftAttemptId,
        unitId: 'ownership-regression-unit',
        attemptStatus: 'draft',
        answers: { [first.part.id]: 'A draft response.' },
      },
    },
  })
  assert.equal(draft.statusCode, 201, draft.payload.error)
  assert.equal(draft.payload.attempt.submissionStatus, 'draft', 'an attempt without submittedAt must remain a draft')
  assert.equal(draft.payload.attempt.submittedAt, null, 'draft attempts must not receive a synthetic submission timestamp')
  const draftCapability = await call(api, {
    method: 'POST',
    url: '/api/stem/marking/capabilities',
    token: ownerToken,
    body: { ...capabilityRequest, attemptId: draftAttemptId },
  })
  assert.equal(draftCapability.statusCode, 409, 'a draft attempt must not receive an AI marking capability')
  assert.equal(draftCapability.payload.code, 'attempt_not_submitted')

  const submitted = await call(api, {
    method: 'POST',
    url: '/api/stem/attempts',
    token: ownerToken,
    body: {
      attemptId,
      mode: 'topic',
      routeId: first.question.routeId,
      paperId: String(first.question.sourceRef?.paperId || ''),
      unitId: 'ownership-regression-unit',
      stage: first.question.stage,
      submittedAt: '2026-08-26T00:00:00.000Z',
      markingParts: [bindingPart],
      attempt: {
        id: attemptId,
        unitId: 'ownership-regression-unit',
        routeId: first.question.routeId,
        attemptStatus: 'marking-pending',
        answers: { [first.part.id]: 'A source-bound response.' },
        evidence: {
          [first.part.id]: {
            dataUrl: 'data:image/png;base64,not-persisted',
            base64: 'A'.repeat(128),
          },
        },
      },
    },
  })
  assert.equal(submitted.statusCode, 201, submitted.payload.error)
  assert.equal(submitted.payload.attempt.attemptId, attemptId)
  assert.doesNotMatch(JSON.stringify(submitted.payload), /data:image|base64/i, 'student attempt persistence must not retain base64 handwriting blobs')

  const persistedCapability = await call(api, {
    method: 'POST',
    url: '/api/stem/marking/capabilities',
    token: ownerToken,
    body: capabilityRequest,
  })
  assert.equal(persistedCapability.statusCode, 201, persistedCapability.payload.error)
  assert.ok(persistedCapability.payload.capabilities?.[0]?.markingGrant, 'a matching persisted attempt must receive a scoped marking grant')

  const substitutedQuestion = await call(api, {
    method: 'POST',
    url: '/api/stem/marking/capabilities',
    token: ownerToken,
    body: {
      ...capabilityRequest,
      paperId: String(second.question.sourceRef?.paperId || ''),
      parts: [{ provenance: { routeId: second.question.routeId, ...second.provenance } }],
    },
  })
  assert.equal(substitutedQuestion.statusCode, 409, 'a valid source binding from another question must not attach to this attempt')
  assert.equal(substitutedQuestion.payload.code, 'attempt_binding_mismatch')

  const crossUserCapability = await call(api, {
    method: 'POST',
    url: '/api/stem/marking/capabilities',
    token: otherToken,
    body: capabilityRequest,
  })
  assert.equal(crossUserCapability.statusCode, 404, 'another account must not obtain a marking grant for an owned attempt')
  assert.equal(crossUserCapability.payload.code, 'attempt_not_found')

  const crossUserRead = await call(api, { method: 'GET', url: '/api/stem/attempts', token: otherToken })
  assert.equal(crossUserRead.statusCode, 200)
  assert.deepEqual(crossUserRead.payload.attempts, [], 'account attempt history must be isolated')

  const crossUserWrite = await call(api, {
    method: 'POST',
    url: '/api/stem/attempts',
    token: otherToken,
    body: {
      attemptId,
      mode: 'topic',
      routeId: first.question.routeId,
      paperId: String(first.question.sourceRef?.paperId || ''),
      unitId: 'ownership-regression-unit',
      stage: first.question.stage,
      submittedAt: '2026-08-26T00:00:00.000Z',
      markingParts: [bindingPart],
      attempt: {
        id: attemptId,
        unitId: 'ownership-regression-unit',
        routeId: first.question.routeId,
        attemptStatus: 'marking-pending',
        answers: { [first.part.id]: 'A forged cross-account response.' },
      },
    },
  })
  assert.equal(crossUserWrite.statusCode, 404, 'an existing attempt ID must not be recreated in another account namespace')
  assert.equal(crossUserWrite.payload.code, 'attempt_not_found')

  const resultUpdate = await call(api, {
    method: 'POST',
    url: '/api/stem/attempts',
    token: ownerToken,
    body: {
      attemptId,
      mode: 'topic',
      routeId: first.question.routeId,
      paperId: String(first.question.sourceRef?.paperId || ''),
      unitId: 'ownership-regression-unit',
      stage: first.question.stage,
      submittedAt: '2026-08-26T00:00:00.000Z',
      markingParts: [bindingPart],
      attempt: {
        id: attemptId,
        unitId: 'ownership-regression-unit',
        routeId: first.question.routeId,
        attemptStatus: 'provisional-result',
        scoreResult: { rawMarks: 1, maxMarks: 2, percentage: 50, partial: true },
        formalResult: false,
      },
    },
  })
  assert.equal(resultUpdate.statusCode, 200, resultUpdate.payload.error)
  assert.equal(resultUpdate.payload.duplicate, true, 'retrying a persisted attempt must update the same authoritative record')

  const ownerHistory = await call(api, { method: 'GET', url: '/api/stem/attempts', token: ownerToken })
  assert.equal(ownerHistory.statusCode, 200)
  assert.equal(ownerHistory.payload.attempts.length, 2, 'the draft and submitted attempt should remain distinct records')
  const persistedSubmittedAttempts = ownerHistory.payload.attempts.filter((item) => item.attemptId === attemptId)
  assert.equal(persistedSubmittedAttempts.length, 1, 'retries must not create duplicate stored submitted attempts')
  assert.equal(persistedSubmittedAttempts[0].attempt.scoreResult.percentage, 50, 'a compact result must survive a reload request')
  assert.doesNotMatch(JSON.stringify(ownerHistory.payload), /data:image|base64/i, 'reloaded attempts must not expose handwriting blobs')
} finally {
  closeStemDatabaseForTests()
}

console.log('Student attempt persistence, ownership, and marking binding regression passed.')
