import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import { createAiApi } from '../server/aiApi.js'
import { createTavernConversationStore } from '../server/tavernConversationStore.js'
import { createTavernDivinationStore } from '../server/tavernDivination.js'

const signingKey = 'synthetic-tavern-memory-api-signing-key'
const providerBodies = []
let providerCalls = 0
let failMemoryOnce = true

function identityToken(userId = 9901) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: `ielts:${userId}`, iat: now, exp: now + 3600 })).toString('base64url')
  return `${header}.${payload}.${crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')}`
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
  })
}

function close(server) {
  server.closeAllConnections?.()
  return new Promise((resolve) => server.close(resolve))
}

function appServer(middleware) {
  return http.createServer((request, response) => {
    Promise.resolve(middleware(request, response, () => {
      response.statusCode = 404
      response.end()
    })).catch((error) => {
      response.statusCode = 500
      response.end(JSON.stringify({ error: error.message }))
    })
  })
}

function sseDone(text) {
  const block = String(text).split(/\r?\n\r?\n/).find((entry) => entry.startsWith('event: done'))
  assert.ok(block)
  return JSON.parse(block.split(/\r?\n/).find((line) => line.startsWith('data: ')).slice(6))
}

const scratchRoot = path.resolve('.tmp-test')
fs.mkdirSync(scratchRoot, { recursive: true })
const fixtureRoot = fs.mkdtempSync(path.join(scratchRoot, 'tavern-memory-api-'))
const fixtureRelative = path.relative(fs.realpathSync(scratchRoot), fs.realpathSync(fixtureRoot))
if (!fixtureRelative || fixtureRelative.startsWith('..') || path.isAbsolute(fixtureRelative) || !/^tavern-memory-api-[^/\\]+$/.test(fixtureRelative)) {
  throw new Error('Unsafe Tavern memory API fixture target.')
}
const store = createTavernConversationStore({ root: fixtureRoot, segmentTargetBytes: 512 })
let drawNow = Date.now()
let drawIdCounter = 0
const divinationStore = createTavernDivinationStore({
  now: () => drawNow,
  randomUUID: () => `30000000-0000-4000-8000-${String(++drawIdCounter).padStart(12, '0')}`,
  randomInt: () => 0,
})

const providerServer = http.createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  providerBodies.push(body)
  providerCalls += 1
  const input = JSON.stringify(body.messages || body.input || [])
  if (body.model === 'gpt-5.5') {
    response.writeHead(503, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'synthetic fallback' } }))
    return
  }
  if (input.includes('FAIL_MEMORY_ONCE') && failMemoryOnce) {
    failMemoryOnce = false
    response.writeHead(503, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'synthetic one-time failure' } }))
    return
  }
  const answer = input.includes('old-memory-marker') ? 'old-memory-marker' : 'synthetic memory answer'
  if (body.stream) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`)
    return
  }
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ choices: [{ message: { content: answer } }], usage: { prompt_tokens: 44, completion_tokens: 5 } }))
})
const providerBase = await listen(providerServer)

const authorizeCoachRequest = ({ payload }) => {
  if (payload?.attemptId === 'active-exam-memory') throw Object.assign(new Error('blocked'), { statusCode: 403, code: 'coach_exam_in_progress' })
  return null
}
const api = createAiApi({
  env: {
    AI_PROVIDER: 'openai',
    STEM_INTERNAL_AUTH_KEY: signingKey,
    OPENAI_API_KEY: 'synthetic-openai-key',
    OPENAI_CHAT_BASE_URL: providerBase,
    OPENAI_API_PROTOCOL: 'responses',
    OPENAI_COACH_MODEL: 'gpt-5.5',
    COACH_AI_API_KEY: 'synthetic-qwen-key',
    COACH_AI_BASE_URL: providerBase,
    COACH_AI_MODEL: 'qwen3.7-max',
  },
  libraryRoot: fixtureRoot,
  allowedSubjects: new Set(['9702']),
  authorizeCoachRequest,
  tavernConversationStore: store,
  tavernDivinationStore: divinationStore,
})
const server = appServer(api)
const baseUrl = await listen(server)

async function call(pathname, { method = 'POST', body, owner = 9901, authenticated = true } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${identityToken(owner)}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let payload = null
  try { payload = JSON.parse(text) } catch { payload = null }
  return { response, text, payload }
}

try {
  const guest = await call('/api/ai/tavern/conversations/resume', { body: { persona: 'keeper' }, authenticated: false })
  assert.equal(guest.response.status, 401)
  const exam = await call('/api/ai/tavern/conversations/resume', { body: { persona: 'keeper', attemptId: 'active-exam-memory' } })
  assert.equal(exam.response.status, 403)
  assert.equal(providerCalls, 0)

  const legacyMessages = []
  for (let pair = 0; pair < 25; pair += 1) {
    legacyMessages.push(
      { role: 'user', content: pair === 0 ? 'old-memory-marker' : `old-user-${pair}` },
      { role: 'assistant', content: `old-assistant-${pair}` },
    )
  }
  const opened = await call('/api/ai/tavern/conversations/resume', {
    body: { persona: 'keeper', legacyImport: { importId: 'legacy-memory-api-0001', messages: legacyMessages } },
  })
  assert.equal(opened.response.status, 200, opened.text)
  assert.deepEqual(opened.payload.legacyImport, {
    importId: 'legacy-memory-api-0001',
    confirmed: true,
    importedMessageCount: 50,
  })
  let conversation = opened.payload.conversation
  assert.equal(conversation.turnCount, 50)

  const firstRequest = {
    feature: 'tavern', persona: 'keeper', message: 'What was the old marker?',
    conversationId: conversation.id, clientTurnId: 'memory-api-turn-0001', expectedRevision: conversation.revision,
    privacyEpoch: 'client-cache-epoch-a',
  }
  const callsBeforeHistoryReject = providerCalls
  const statefulHistoryRejected = await call('/api/ai/coach', { body: { ...firstRequest, history: legacyMessages } })
  assert.equal(statefulHistoryRejected.response.status, 400)
  assert.equal(statefulHistoryRejected.payload.code, 'tavern_state_history_forbidden')
  assert.equal(providerCalls, callsBeforeHistoryReject)
  const callsBeforeFirst = providerCalls
  const answered = await call('/api/ai/coach', { body: firstRequest })
  assert.equal(answered.response.status, 200, answered.text)
  assert.equal(answered.payload.answer, 'old-memory-marker')
  assert.equal(answered.payload.memory.contextWindowTokens, 1_000_000, 'fallback Qwen attempt must rebuild the model budget')
  assert.equal(answered.payload.memory.countingMethod, 'utf8-provider-envelope-upper-bound-v2')
  assert.equal(providerCalls, callsBeforeFirst + 2)
  const [responsesBody, qwenBody] = providerBodies.slice(-2)
  assert.equal(responsesBody.max_output_tokens, 2048)
  assert.equal(responsesBody.store, false)
  assert.deepEqual(responsesBody.reasoning, { effort: 'none' })
  assert.equal(Object.hasOwn(responsesBody, 'enable_thinking'), false)
  assert.equal(qwenBody.max_tokens, 2048)
  assert.equal(qwenBody.enable_thinking, false)
  assert.equal(Object.hasOwn(qwenBody, 'store'), false)
  conversation = answered.payload.conversation

  const callsBeforeReplay = providerCalls
  const replay = await call('/api/ai/coach', { body: { ...firstRequest, privacyEpoch: 'client-cache-epoch-b' } })
  assert.equal(replay.response.status, 200)
  assert.equal(replay.payload.answer, answered.payload.answer)
  assert.equal(providerCalls, callsBeforeReplay)
  const mismatch = await call('/api/ai/coach', { body: { ...firstRequest, message: 'changed logical body' } })
  assert.equal(mismatch.response.status, 409)

  const failBody = {
    feature: 'tavern', persona: 'keeper', message: 'FAIL_MEMORY_ONCE',
    conversationId: conversation.id, clientTurnId: 'memory-api-fail-0001', expectedRevision: conversation.revision,
  }
  const failed = await call('/api/ai/coach', { body: failBody })
  assert.equal(failed.response.status, 200)
  assert.equal(failed.payload.answerStatus, 'unavailable')
  assert.equal(failed.payload.turns[1].status, 'unavailable')
  const callsAfterFailure = providerCalls
  const recovered = await call('/api/ai/coach', { body: failBody })
  assert.equal(recovered.response.status, 200)
  assert.equal(recovered.payload.answerStatus, 'complete')
  assert.equal(recovered.payload.turns[1].status, 'complete')
  assert.equal(providerCalls, callsAfterFailure + 2)
  conversation = recovered.payload.conversation

  const streamBody = {
    feature: 'tavern', persona: 'keeper', message: 'continue',
    conversationId: conversation.id, clientTurnId: 'memory-api-turn-0002', expectedRevision: conversation.revision,
  }
  const stream = await call('/api/ai/coach/stream', { body: streamBody })
  assert.equal(stream.response.status, 200)
  const done = sseDone(stream.text)
  assert.equal(done.clientTurnId, streamBody.clientTurnId)
  assert.equal(done.turns.length, 2)
  conversation = done.conversation

  const page = await call(`/api/ai/tavern/conversations/${conversation.id}/messages?persona=keeper&limit=40`, { method: 'GET' })
  assert.equal(page.response.status, 200)
  assert.equal(page.payload.messages.length, 40)
  assert.ok(page.payload.nextBefore)
  const foreign = await call(`/api/ai/tavern/conversations/${conversation.id}/messages?persona=keeper`, { method: 'GET', owner: 9902 })
  assert.equal(foreign.response.status, 404)

  const drawResult = await call('/api/ai/tavern/draw', {
    body: { feature: 'tavern', persona: 'eastern-oracle', drawNonce: 'memory-draw-nonce-0001', spread: 'single' },
  })
  assert.equal(drawResult.response.status, 200)
  const oracleResume = await call('/api/ai/tavern/conversations/resume', { body: { persona: 'eastern-oracle' } })
  const oracleBody = {
    feature: 'tavern', persona: 'eastern-oracle', message: '', drawId: drawResult.payload.draw.id,
    conversationId: oracleResume.payload.conversation.id, clientTurnId: 'oracle-memory-turn-0001', expectedRevision: 0,
  }
  const oracleAnswer = await call('/api/ai/coach', { body: oracleBody })
  assert.equal(oracleAnswer.response.status, 200)
  const callsBeforeExpiredReplay = providerCalls
  drawNow += 31 * 60 * 1000
  const expiredReplay = await call('/api/ai/coach', { body: oracleBody })
  assert.equal(expiredReplay.response.status, 200, expiredReplay.text)
  assert.equal(expiredReplay.payload.answer, oracleAnswer.payload.answer)
  assert.equal(providerCalls, callsBeforeExpiredReplay, 'completed replay must not revalidate an expired draw or call the provider')
  const expiredNewTurn = await call('/api/ai/coach', {
    body: {
      ...oracleBody,
      clientTurnId: 'oracle-memory-turn-0002',
      expectedRevision: oracleAnswer.payload.conversation.revision,
    },
  })
  assert.equal(expiredNewTurn.response.status, 409)
  assert.equal(expiredNewTurn.payload.code, 'coach_tavern_draw_expired')
  assert.equal(providerCalls, callsBeforeExpiredReplay)

  const deleted = await call(`/api/ai/tavern/conversations/${conversation.id}?persona=keeper`, { method: 'DELETE' })
  assert.equal(deleted.response.status, 200)
  assert.equal(deleted.payload.deleted, true)
  const callsBeforeDeletedReplay = providerCalls
  const deletedReplay = await call('/api/ai/coach', { body: firstRequest })
  assert.equal(deletedReplay.response.status, 410)
  assert.equal(providerCalls, callsBeforeDeletedReplay)
} finally {
  await Promise.all([close(server), close(providerServer)])
  store.close()
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
  if (fs.existsSync(scratchRoot) && fs.readdirSync(scratchRoot).length === 0) fs.rmdirSync(scratchRoot)
}

console.log(JSON.stringify({ status: 'passed', syntheticProviderCalls: providerCalls }))
