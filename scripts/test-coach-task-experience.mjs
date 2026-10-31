import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { createAiApi } from '../server/aiApi.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-task-api-'))
const signingKey = 'synthetic-coach-task-signing-key'
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlYV5sAAAAASUVORK5CYII='
const token = (owner = 1) => {
  const at = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({ iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: `ielts:${owner}`, iat: at, exp: at + 600 })).toString('base64url')
  return `${header}.${claims}.${crypto.createHmac('sha256', signingKey).update(`${header}.${claims}`).digest('base64url')}`
}
const realFetch = globalThis.fetch
let providerCalls = 0
globalThis.fetch = async (url, options) => {
  const address = String(url)
  if (address === 'https://api.deepseek.com/v1/chat/completions') {
    providerCalls += 1
    const body = JSON.parse(options.body)
    assert.equal(body.thinking.type, 'enabled')
    const answer = body.messages.at(-1).content instanceof Array ? 'Image answer.' : 'Text answer.'
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'PRIVATE_REASONING_MUST_NOT_LEAK' }, finish_reason: null }] })}\n\n`
        + `data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: null }] })}\n\n`
        + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`
        + 'data: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    )
  }
  if (address.startsWith('http://127.0.0.1:')) return realFetch(url, options)
  throw new Error(`Unexpected network request: ${address}`)
}

let exam = false
let unexpected = false
const api = createAiApi({
  env: {
    STEM_INTERNAL_AUTH_KEY: signingKey,
    STEM_ACADEMIC_PROVIDER: 'deepseek',
    STEM_ACADEMIC_DEEPSEEK_API_KEY: 'synthetic-task-provider-key',
    STEM_TAVERN_PROVIDER: 'legacy',
  },
  libraryRoot: root,
  allowedSubjects: new Set(),
  coachJobsRoot: root,
  telemetry: () => {},
  authorizeCoachRequest: async () => {
    if (unexpected) throw Object.assign(new Error('synthetic authorization outage'), { statusCode: 503, code: 'synthetic_auth_outage' })
    return exam ? { coachAccess: { binding: 'authoritative-attempt', assessmentState: 'active-exam', solutionAllowed: false } } : null
  },
})
const server = http.createServer((request, response) => api(request, response, () => {
  response.statusCode = 404
  response.end()
}))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

async function request(route, { method = 'GET', body, owner = 1, authenticated = true } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(authenticated ? { Authorization: `Bearer ${token(owner)}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return { status: response.status, body: await response.json() }
}
const jobPath = id => `/api/ai/coach/jobs/${id}`
async function waitForJob(id, owner = 1) {
  for (let index = 0; index < 20; index += 1) {
    const response = await request(jobPath(id), { owner })
    if (response.body.status !== 'running') return response
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('job did not complete')
}

try {
  assert.equal((await request('/api/ai/coach/jobs', { authenticated: false })).status, 401)
  const firstId = 'cj-taskText123456789012'
  const first = await request(jobPath(firstId), { method: 'POST', body: { feature: 'answers', helpIntent: 'hint', message: 'Explain the next step.', context: { view: 'practice' } } })
  assert.equal(first.status, 202)
  assert.ok(Number.isFinite(first.body.serverNow))
  assert.equal(first.body.task.schemaVersion, 'stem-coach-task-v1')
  assert.equal(first.body.task.reasoning.requestedEffort, null)
  assert.equal(first.body.task.reasoning.effectiveEffort, 'low')
  assert.equal(first.body.task.reasoning.enabled, true)
  assert.equal(first.body.task.input.kind, 'text')
  assert.deepEqual(first.body.task.persistence, { saved: false, retentionMs: 86_400_000 })
  assert.ok(first.body.task.estimate.totalMs.upper <= 30_000, 'ordinary low task presents a bounded initial target, not a promise')
  const firstDone = await waitForJob(firstId)
  assert.equal(firstDone.body.status, 'succeeded')
  assert.equal(firstDone.body.task.stage.code, 'complete')
  assert.equal(firstDone.body.task.reasoning.activityObserved, true)
  assert.ok(firstDone.body.task.milestones.providerRequestedAt)
  assert.ok(firstDone.body.task.milestones.providerRespondedAt)
  assert.ok(firstDone.body.task.milestones.reasoningActivityAt)
  assert.ok(firstDone.body.task.milestones.firstAnswerAt)
  assert.ok(firstDone.body.task.milestones.completedAt)
  assert.equal(firstDone.body.task.estimate.status, 'complete')
  assert.match(firstDone.body.answer, /Text answer/)
  assert.doesNotMatch(JSON.stringify(firstDone.body.task), /PRIVATE_REASONING|Explain the next step|data:image|Bearer/)

  const instantId = 'cj-taskInstant123456789'
  const instant = await request(jobPath(instantId), { method: 'POST', body: { feature: 'answers', helpIntent: 'hint', message: 'Immediate low answer.', saveTask: false, context: { view: 'practice' } } })
  assert.equal(instant.status, 202)
  assert.deepEqual(instant.body.task.persistence, { saved: false, retentionMs: 600_000 })
  await waitForJob(instantId)

  const callsBeforeInvalidPersistence = providerCalls
  const lowSaved = await request(jobPath('cj-taskLowSaved123456789'), { method: 'POST', body: { feature: 'answers', helpIntent: 'hint', message: 'Invalid saved low.', saveTask: true, context: { view: 'practice' } } })
  assert.equal(lowSaved.status, 400)
  assert.equal(lowSaved.body.code, 'coach_task_persistence_effort')
  const invalidSaved = await request(jobPath('cj-taskInvalidSave1234567'), { method: 'POST', body: { feature: 'answers', helpIntent: 'hint', message: 'Invalid flag.', reasoningEffort: 'high', saveTask: 'yes', context: { view: 'practice' } } })
  assert.equal(invalidSaved.status, 400)
  assert.equal(invalidSaved.body.code, 'coach_task_persistence_invalid')
  assert.equal(providerCalls, callsBeforeInvalidPersistence)

  const highInstantId = 'cj-taskHighInstant1234567'
  const highInstant = await request(jobPath(highInstantId), { method: 'POST', body: { feature: 'answers', helpIntent: 'hint', message: 'High without saving.', reasoningEffort: 'high', saveTask: false, context: { view: 'practice' } } })
  assert.equal(highInstant.status, 202)
  assert.deepEqual(highInstant.body.task.persistence, { saved: false, retentionMs: 600_000 })
  await waitForJob(highInstantId)

  const secondId = 'cj-taskImage12345678901'
  const secondBody = { feature: 'answers', helpIntent: 'worked-solution', message: 'Analyze this.', imageDataUrls: [image], reasoningEffort: 'high', saveTask: true, context: { view: 'coach-photo' } }
  const second = await request(jobPath(secondId), { method: 'POST', body: secondBody })
  assert.equal(second.status, 202)
  assert.equal(second.body.task.reasoning.requestedEffort, 'high')
  assert.equal(second.body.task.reasoning.effectiveEffort, 'high')
  assert.deepEqual(second.body.task.input, { kind: 'image', imageCount: 1 })
  assert.deepEqual(second.body.task.persistence, { saved: true, retentionMs: 259_200_000 })
  await waitForJob(secondId)
  const persistenceConflict = await request(jobPath(secondId), { method: 'POST', body: { ...secondBody, saveTask: false } })
  assert.equal(persistenceConflict.status, 409, 'saveTask mode participates in the existing idempotency hash')
  const maxId = 'cj-taskMax1234567890123'
  const maximum = await request(jobPath(maxId), { method: 'POST', body: { feature: 'answers', helpIntent: 'hint', message: 'Use maximum reasoning.', reasoningEffort: 'max', saveTask: true, context: { view: 'practice' } } })
  assert.equal(maximum.status, 202)
  assert.equal(maximum.body.task.reasoning.effectiveEffort, 'max')
  assert.equal(maximum.body.task.persistence.saved, true)
  await waitForJob(maxId)
  assert.equal(providerCalls, 5)

  const list = await request('/api/ai/coach/jobs?limit=1')
  assert.equal(list.status, 200)
  assert.equal(list.body.schemaVersion, 'stem-coach-task-list-v1')
  assert.ok(Number.isFinite(list.body.serverNow))
  assert.equal(list.body.items.length, 1)
  assert.ok(list.body.nextCursor)
  const listed = list.body.items[0]
  assert.deepEqual(Object.keys(listed).sort(), ['createdAt', 'expiresAt', 'id', 'stage', 'status', 'task', 'updatedAt'])
  assert.doesNotMatch(JSON.stringify(list.body), /Text answer|Image answer|PRIVATE_REASONING|data:image|request_hash|scope/)
  const next = await request(`/api/ai/coach/jobs?limit=1&cursor=${encodeURIComponent(list.body.nextCursor)}`)
  assert.equal(next.body.items.length, 1)
  assert.notEqual(next.body.items[0].id, listed.id)
  assert.equal((await request('/api/ai/coach/jobs?limit=21')).status, 400)
  assert.equal((await request('/api/ai/coach/jobs', { owner: 2 })).body.items.length, 0)
  const allSaved = [listed.id, next.body.items[0].id]
  assert.ok(!allSaved.includes(firstId)&&!allSaved.includes(instantId)&&!allSaved.includes(highInstantId), 'legacy and explicit instant jobs stay out of saved history')

  exam = true
  const hiddenDuringExam = await request('/api/ai/coach/jobs')
  assert.equal(hiddenDuringExam.status, 200)
  assert.equal(hiddenDuringExam.body.items.length, 0, 'current exam authority is rechecked per list item')
  exam = false
  unexpected = true
  const failedAuthority = await request('/api/ai/coach/jobs')
  assert.equal(failedAuthority.status, 503, 'unexpected authorization failures must not be silently converted to an empty list')
  assert.equal(failedAuthority.body.code, 'synthetic_auth_outage')

  console.log('PASS Coach task API: default low thinking, real stages, safe list/cursor, owner and current-exam authority')
} finally {
  await api.close()
  server.closeAllConnections?.()
  await new Promise(resolve => server.close(resolve))
  globalThis.fetch = realFetch
  fs.rmSync(root, { recursive: true, force: true })
}
