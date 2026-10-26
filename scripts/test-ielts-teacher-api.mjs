import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'

import { createAiApi } from '../server/aiApi.js'
import { createTavernConversationStore } from '../server/tavernConversationStore.js'

const signingKey = 'synthetic-ielts-teacher-signing-key'
const tempBase = fs.realpathSync(os.tmpdir())
const fixtureRoot = fs.mkdtempSync(path.join(tempBase, 'stem-ielts-teacher-'))
const fixtureRelative = path.relative(tempBase, fs.realpathSync(fixtureRoot))
if (!fixtureRelative || fixtureRelative.startsWith('..') || path.isAbsolute(fixtureRelative) || !/^stem-ielts-teacher-[^/\\]+$/.test(fixtureRelative)) {
  throw new Error('Unsafe IELTS teacher fixture target.')
}

function identityToken(userId = 9401) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: `ielts:${userId}`,
    iat: now,
    exp: now + 3_600,
  })).toString('base64url')
  return `${header}.${payload}.${crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')}`
}

function appServer(middleware) {
  return http.createServer((request, response) => {
    Promise.resolve(middleware(request, response, () => {
      response.statusCode = 404
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.end(JSON.stringify({ error: 'not found' }))
    })).catch((error) => {
      response.statusCode = 500
      response.end(JSON.stringify({ error: error.message }))
    })
  })
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

function parseSse(text) {
  return String(text)
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter((block) => block && !block.startsWith(':'))
    .map((block) => {
      const event = block.split(/\r?\n/).find((line) => line.startsWith('event: '))?.slice(7) || ''
      const data = block.split(/\r?\n/).filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n')
      return { event, data: data ? JSON.parse(data) : null }
    })
}

function doneEvent(result) {
  const event = result.events.find((candidate) => candidate.event === 'done')
  assert.ok(event, `missing done event in ${result.text}`)
  return event.data
}

const admissionsStore = createTavernConversationStore({
  root: path.join(fixtureRoot, 'admissions'),
  databaseFilename: 'admissions.sqlite',
  allowedPersonas: ['admissions-advisor'],
  generatedResultReceipts: true,
  rejectDeleteWhilePending: true,
})
const teacherStore = createTavernConversationStore({
  root: path.join(fixtureRoot, 'ielts-teacher'),
  databaseFilename: 'ielts-teacher.sqlite',
  allowedPersonas: ['ielts-teacher'],
  generatedResultReceipts: true,
  rejectDeleteWhilePending: true,
})

const providerInputs = []
const providerFailures = new Map()
async function compatibleStream(provider, options) {
  providerInputs.push({ provider: structuredClone(provider), options: { ...options, onDelta: undefined } })
  const feature = options.metadata?.stemCoachContext?.feature || 'unknown'
  const message = String(options.messages.at(-1)?.content || '')
  if (message.includes('FAIL_ONCE')) {
    const failures = providerFailures.get(message) || 0
    providerFailures.set(message, failures + 1)
    if (failures === 0) throw new Error('synthetic IELTS teacher provider failure')
  }
  if (message.includes('PARTIAL_STREAM')) {
    await options.onDelta?.('Partial IELTS teacher guidance.')
    throw new Error('synthetic partial IELTS teacher stream')
  }
  const answer = feature === 'ielts-teacher'
    ? (message.includes('FAIL_ONCE') ? 'Recovered IELTS teaching guidance.' : 'Synthetic IELTS teaching guidance.')
    : 'Synthetic admissions guidance.'
  await options.onDelta?.(answer)
  return { answer, providerStatus: 'connected' }
}

const authorizationPayloads = []
async function authorizeCoachRequest({ payload }) {
  authorizationPayloads.push(structuredClone(payload))
  return { coachAccess: { assessmentState: 'ordinary-practice', solutionAllowed: true } }
}

let api
let server
let baseUrl

before(async () => {
  api = createAiApi({
    env: {
      STEM_INTERNAL_AUTH_KEY: signingKey,
      STEM_DATABASE_PATH: path.join(fixtureRoot, 'stem.sqlite'),
      STEM_ACADEMIC_PROVIDER: 'deepseek',
      STEM_ACADEMIC_DEEPSEEK_API_KEY: 'synthetic-deepseek-key',
      STEM_AI_TOTAL_DEADLINE_MS: '999999',
    },
    libraryRoot: fixtureRoot,
    allowedSubjects: new Set(['9702']),
    authorizeCoachRequest,
    admissionsConversationStore: admissionsStore,
    admissionsCallCompatibleAiStream: compatibleStream,
    ieltsTeacherConversationStore: teacherStore,
    ieltsTeacherCallCompatibleAiStream: compatibleStream,
  })
  server = appServer((request, response, next) => api(request, response, next))
  baseUrl = await listen(server)
})

after(async () => {
  api?.close?.()
  admissionsStore.close()
  teacherStore.close()
  if (server) await close(server)
  const cleanupRelative = path.relative(tempBase, fs.realpathSync(fixtureRoot))
  if (cleanupRelative && !cleanupRelative.startsWith('..') && !path.isAbsolute(cleanupRelative) && /^stem-ielts-teacher-[^/\\]+$/.test(cleanupRelative)) {
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

async function call(pathname, { method = 'POST', body, owner = 9401, authenticated = true } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...(authenticated ? { Authorization: `Bearer ${identityToken(owner)}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let payload = null
  try { payload = JSON.parse(text) } catch { payload = null }
  const events = response.headers.get('content-type')?.includes('text/event-stream') ? parseSse(text) : []
  return { response, text, payload, events }
}

test('IELTS teacher route is recognized before signed-login rejection', async () => {
  const guest = await call('/api/ai/ielts-teacher/conversations/resume', {
    body: {},
    authenticated: false,
  })
  assert.equal(guest.response.status, 401, guest.text)
  assert.equal(guest.payload.code, 'coach_auth_required')
})

test('IELTS teacher and admissions isolate conversations prompts receipts and deletion', async () => {
  const admissionsOpened = await call('/api/ai/admissions/conversations/resume', { body: {} })
  const teacherOpened = await call('/api/ai/ielts-teacher/conversations/resume', { body: {} })
  assert.equal(admissionsOpened.response.status, 200, admissionsOpened.text)
  assert.equal(teacherOpened.response.status, 200, teacherOpened.text)
  assert.equal(admissionsOpened.payload.conversation.persona, 'admissions-advisor')
  assert.equal(teacherOpened.payload.conversation.persona, 'ielts-teacher')
  assert.notEqual(admissionsOpened.payload.conversation.id, teacherOpened.payload.conversation.id)
  assert.notEqual(admissionsStore.databasePath, teacherStore.databasePath)
  assert.match(admissionsStore.databasePath, /admissions\.sqlite$/)
  assert.match(teacherStore.databasePath, /ielts-teacher\.sqlite$/)

  const teacherReadsAdmissions = await call(`/api/ai/ielts-teacher/conversations/${admissionsOpened.payload.conversation.id}/messages`, { method: 'GET' })
  const admissionsReadsTeacher = await call(`/api/ai/admissions/conversations/${teacherOpened.payload.conversation.id}/messages`, { method: 'GET' })
  assert.equal(teacherReadsAdmissions.response.status, 404)
  assert.equal(admissionsReadsTeacher.response.status, 404)

  const clientTurnId = 'shared-role-turn-0001'
  const message = 'Please help with my next study step.'
  const admissionsTurn = await call('/api/ai/admissions/stream', {
    body: {
      conversationId: admissionsOpened.payload.conversation.id,
      clientTurnId,
      expectedRevision: admissionsOpened.payload.conversation.revision,
      message,
    },
  })
  const teacherTurn = await call('/api/ai/ielts-teacher/stream', {
    body: {
      conversationId: teacherOpened.payload.conversation.id,
      clientTurnId,
      expectedRevision: teacherOpened.payload.conversation.revision,
      message,
    },
  })
  const admissionsDone = doneEvent(admissionsTurn)
  const teacherDone = doneEvent(teacherTurn)
  assert.equal(admissionsDone.answer, 'Synthetic admissions guidance.')
  assert.equal(teacherDone.answer, 'Synthetic IELTS teaching guidance.')
  assert.equal(admissionsDone.conversation.persona, 'admissions-advisor')
  assert.equal(teacherDone.conversation.persona, 'ielts-teacher')
  assert.deepEqual(teacherTurn.events.map((event) => event.event), ['meta', 'delta', 'done'])

  const admissionsProviderInput = providerInputs.find((input) => input.options.metadata?.stemCoachContext?.feature === 'admissions')
  const teacherProviderInput = providerInputs.find((input) => input.options.metadata?.stemCoachContext?.feature === 'ielts-teacher')
  assert.ok(admissionsProviderInput)
  assert.ok(teacherProviderInput)
  assert.equal(admissionsProviderInput.provider.name, teacherProviderInput.provider.name)
  assert.equal(admissionsProviderInput.provider.model, teacherProviderInput.provider.model)
  assert.notEqual(admissionsProviderInput.options.messages[0].content, teacherProviderInput.options.messages[0].content)

  const callsBeforeReplays = providerInputs.length
  const admissionsReplay = doneEvent(await call('/api/ai/admissions/stream', {
    body: {
      conversationId: admissionsOpened.payload.conversation.id,
      clientTurnId,
      expectedRevision: admissionsOpened.payload.conversation.revision,
      message,
    },
  }))
  const teacherReplay = doneEvent(await call('/api/ai/ielts-teacher/stream', {
    body: {
      conversationId: teacherOpened.payload.conversation.id,
      clientTurnId,
      expectedRevision: teacherOpened.payload.conversation.revision,
      message,
    },
  }))
  assert.equal(admissionsReplay.replayed, true)
  assert.equal(teacherReplay.replayed, true)
  assert.equal(providerInputs.length, callsBeforeReplays, 'each role must replay only its own durable receipt')
  const teacherConflict = await call('/api/ai/ielts-teacher/stream', {
    body: {
      conversationId: teacherOpened.payload.conversation.id,
      clientTurnId,
      expectedRevision: teacherOpened.payload.conversation.revision,
      message: 'A changed logical IELTS teacher request.',
    },
  })
  assert.equal(teacherConflict.response.status, 409)
  assert.equal(teacherConflict.payload.code, 'ielts_teacher_turn_idempotency_conflict')
  assert.equal(providerInputs.length, callsBeforeReplays, 'a conflicting teacher receipt must not call the provider')

  const teacherDeleted = await call(`/api/ai/ielts-teacher/conversations/${teacherOpened.payload.conversation.id}`, { method: 'DELETE' })
  assert.equal(teacherDeleted.response.status, 200, teacherDeleted.text)
  const admissionsAfterTeacherDelete = await call(`/api/ai/admissions/conversations/${admissionsOpened.payload.conversation.id}/messages`, { method: 'GET' })
  const teacherAfterDelete = await call(`/api/ai/ielts-teacher/conversations/${teacherOpened.payload.conversation.id}/messages`, { method: 'GET' })
  assert.equal(admissionsAfterTeacherDelete.response.status, 200, admissionsAfterTeacherDelete.text)
  assert.equal(teacherAfterDelete.response.status, 410, teacherAfterDelete.text)
  assert.equal(teacherAfterDelete.payload.code, 'ielts_teacher_conversation_deleted')

  assert.ok(authorizationPayloads.some((payload) => payload.feature === 'admissions' && payload.persona === 'admissions-advisor'))
  assert.ok(authorizationPayloads.some((payload) => payload.feature === 'ielts-teacher' && payload.persona === 'ielts-teacher'))
})

test('IELTS teacher prompt keeps each teaching mode inside its evidence boundary', async () => {
  const {
    buildIeltsTeacherSystemPrompt,
    IELTS_TEACHER_MAX_DEADLINE_MS,
    IELTS_TEACHER_MAX_MESSAGE_CHARS,
    IELTS_TEACHER_PERSONA,
    resolveIeltsTeacherMemoryRoot,
  } = await import('../server/ieltsTeacher.js')
  const prompt = buildIeltsTeacherSystemPrompt()
  assert.equal(IELTS_TEACHER_PERSONA, 'ielts-teacher')
  assert.equal(IELTS_TEACHER_MAX_MESSAGE_CHARS, 12_000)
  assert.equal(IELTS_TEACHER_MAX_DEADLINE_MS, 50_000)
  assert.match(prompt, /Academic IELTS from General Training/i)
  assert.match(prompt, /at most two questions/i)
  assert.match(prompt, /Task Achievement/)
  assert.match(prompt, /Task Response/)
  assert.match(prompt, /Coherence and Cohesion/)
  assert.match(prompt, /Lexical Resource/)
  assert.match(prompt, /Grammatical Range and Accuracy/)
  assert.match(prompt, /Never invent Task 1 chart values/i)
  assert.match(prompt, /passage or transcript, question, student answer, and available answer evidence/i)
  assert.match(prompt, /Never invent a transcript, answer key, Cambridge attribution/i)
  assert.match(prompt, /raw-score-to-band conversion/i)
  assert.match(prompt, /exactly one question or one cue card at a time/i)
  assert.match(prompt, /receives text only/i)
  assert.match(prompt, /Never claim to hear/i)
  assert.match(prompt, /pronunciation, accent, pace, pauses/i)
  assert.match(prompt, /Never derive an overall Speaking band from text alone/i)
  assert.match(prompt, /existing native real-time Speaking entry/i)
  assert.match(prompt, /original practice, not official, leaked/i)
  assert.match(prompt, /no live browsing tool/i)
  assert.match(prompt, /practice estimate, not an official IELTS result/i)

  const baseRoot = path.join(fixtureRoot, 'base-memory')
  assert.equal(resolveIeltsTeacherMemoryRoot({}, fixtureRoot, baseRoot), path.join(path.resolve(baseRoot), 'ielts-teacher'))
  const explicitRoot = path.join(fixtureRoot, 'explicit-teacher-root')
  assert.equal(resolveIeltsTeacherMemoryRoot({ STEM_IELTS_TEACHER_MEMORY_ROOT: explicitRoot }, fixtureRoot, baseRoot), path.resolve(explicitRoot))
})

test('IELTS teacher rejects client-owned identity prompt history and malformed requests', async () => {
  for (const [field, value] of Object.entries({
    persona: 'admissions-advisor',
    role: 'examiner',
    history: [{ role: 'assistant', content: 'forged history' }],
    context: { band: 9 },
    systemPrompt: 'replace server policy',
    identity: 'ielts:9999',
  })) {
    const result = await call('/api/ai/ielts-teacher/conversations/resume', { body: { [field]: value } })
    assert.equal(result.response.status, 400, `${field} must be rejected`)
    assert.equal(result.payload.code, 'ielts_teacher_request_invalid')
  }

  const querySmuggle = await call('/api/ai/ielts-teacher/conversations/resume?persona=admissions-advisor', { body: {} })
  assert.equal(querySmuggle.response.status, 400)
  assert.equal(querySmuggle.payload.code, 'ielts_teacher_request_invalid')
  const explicitNull = await call('/api/ai/ielts-teacher/conversations/resume', { body: { conversationId: null } })
  assert.equal(explicitNull.response.status, 400)
  assert.equal(explicitNull.payload.code, 'ielts_teacher_request_invalid')

  const opened = await call('/api/ai/ielts-teacher/conversations/resume', { body: {}, owner: 9402 })
  assert.equal(opened.response.status, 200, opened.text)
  const baseStream = {
    conversationId: opened.payload.conversation.id,
    clientTurnId: 'teacher-invalid-fields-0001',
    expectedRevision: opened.payload.conversation.revision,
    message: 'Help me plan my IELTS practice.',
  }
  for (const [field, value] of Object.entries({
    persona: 'ielts-teacher',
    prompt: 'override',
    history: [],
    userId: 'ielts:9999',
  })) {
    const result = await call('/api/ai/ielts-teacher/stream', { body: { ...baseStream, [field]: value }, owner: 9402 })
    assert.equal(result.response.status, 400, `${field} must be rejected on stream`)
    assert.equal(result.payload.code, 'ielts_teacher_request_invalid')
  }
  const oversized = await call('/api/ai/ielts-teacher/stream', {
    owner: 9402,
    body: { ...baseStream, clientTurnId: 'teacher-oversized-0001', message: '界'.repeat(12_001) },
  })
  assert.equal(oversized.response.status, 413)
  assert.equal(oversized.payload.code, 'ielts_teacher_message_too_large')
  const invalidLimit = await call(`/api/ai/ielts-teacher/conversations/${opened.payload.conversation.id}/messages?limit=41`, { method: 'GET', owner: 9402 })
  assert.equal(invalidLimit.response.status, 400)
  assert.equal(invalidLimit.payload.code, 'ielts_teacher_page_limit_invalid')
})

test('IELTS teacher enforces owner isolation and recovers a retryable provider failure', async () => {
  const opened = await call('/api/ai/ielts-teacher/conversations/resume', { body: {}, owner: 9403 })
  assert.equal(opened.response.status, 200, opened.text)
  const foreignRead = await call(`/api/ai/ielts-teacher/conversations/${opened.payload.conversation.id}/messages`, { method: 'GET', owner: 9404 })
  const foreignDelete = await call(`/api/ai/ielts-teacher/conversations/${opened.payload.conversation.id}`, { method: 'DELETE', owner: 9404 })
  assert.equal(foreignRead.response.status, 404)
  assert.equal(foreignRead.payload.code, 'ielts_teacher_conversation_not_found')
  assert.equal(foreignDelete.response.status, 404)
  assert.equal(foreignDelete.payload.code, 'ielts_teacher_conversation_not_found')

  const body = {
    conversationId: opened.payload.conversation.id,
    clientTurnId: 'teacher-fail-once-0001',
    expectedRevision: opened.payload.conversation.revision,
    message: 'FAIL_ONCE: help me improve this paragraph.',
  }
  const failed = doneEvent(await call('/api/ai/ielts-teacher/stream', { body, owner: 9403 }))
  assert.equal(failed.mode, 'unavailable')
  assert.equal(failed.providerStatus, 'error')
  assert.equal(failed.code, 'ielts_teacher_provider_unavailable')
  assert.equal(failed.retryable, true)
  assert.equal(failed.partial, false)
  assert.equal(failed.turns.find((turn) => turn.role === 'assistant').status, 'unavailable')

  const callsAfterFailure = providerInputs.length
  const recovered = doneEvent(await call('/api/ai/ielts-teacher/stream', { body, owner: 9403 }))
  assert.equal(recovered.mode, 'ai')
  assert.equal(recovered.answer, 'Recovered IELTS teaching guidance.')
  assert.equal(recovered.turns.find((turn) => turn.role === 'assistant').status, 'complete')
  assert.equal(providerInputs.length, callsAfterFailure + 1)
  const latestProviderInput = providerInputs.at(-1)
  assert.equal(latestProviderInput.options.operation, 'ielts-teacher-stream')
  assert.deepEqual(latestProviderInput.options.metadata, {
    stemCoachContext: { feature: 'ielts-teacher', persona: 'ielts-teacher' },
  })
  assert.ok(latestProviderInput.options.timeoutMs <= 45_000)
  assert.equal(latestProviderInput.options.totalDeadlineMs, 50_000, 'teacher server work must finish before the fixed 55-second client timeout')
  assert.ok(latestProviderInput.options.deadlineAt - Date.now() <= 50_000)
})

test('IELTS teacher persists a partial provider stream as interrupted rather than complete', async () => {
  const opened = await call('/api/ai/ielts-teacher/conversations/resume', { body: {}, owner: 9405 })
  const partial = doneEvent(await call('/api/ai/ielts-teacher/stream', {
    owner: 9405,
    body: {
      conversationId: opened.payload.conversation.id,
      clientTurnId: 'teacher-partial-stream-0001',
      expectedRevision: opened.payload.conversation.revision,
      message: 'PARTIAL_STREAM: explain my reading answer.',
    },
  }))
  assert.equal(partial.mode, 'interrupted')
  assert.equal(partial.code, 'ielts_teacher_generation_incomplete')
  assert.equal(partial.answer, 'Partial IELTS teacher guidance.')
  assert.equal(partial.partial, true)
  assert.equal(partial.turns.find((turn) => turn.role === 'assistant').status, 'partial')
})
