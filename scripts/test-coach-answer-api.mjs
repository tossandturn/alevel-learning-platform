import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'

import { createAiApi } from '../server/aiApi.js'
import { COACH_POLICY_VERSION } from '../server/coachPolicy.js'

const signingKey = 'coach-answer-policy-test-signing-key'
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlpeR0AAAAASUVORK5CYII='
const providerBodies = []

function identityToken(userId = 7001) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: `ielts:${userId}`,
    iat: now,
    exp: now + 3600,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', signingKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve(`http://127.0.0.1:${server.address().port}`)
    })
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

function providerText(body) {
  return JSON.stringify(body?.messages || body?.input || [])
}

function systemPrompt(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : Array.isArray(body?.input) ? body.input : []
  const system = messages.find((message) => message?.role === 'system')
  if (typeof system?.content === 'string') return system.content
  return (system?.content || []).map((item) => item?.text || item?.input_text || '').join('\n')
}

function providerContext(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : Array.isArray(body?.input) ? body.input : []
  for (const message of messages) {
    const items = Array.isArray(message?.content) ? message.content : [{ text: message?.content }]
    for (const item of items) {
      const text = item?.text || item?.input_text
      if (!text) continue
      try {
        const parsed = JSON.parse(text)
        if (parsed?.coachPolicyVersion) return parsed
      } catch {
        // Not the structured Coach context.
      }
    }
  }
  return null
}

function sseDone(text) {
  const block = String(text).split(/\r?\n\r?\n/).find((entry) => entry.startsWith('event: done'))
  assert.ok(block, `missing terminal Coach event: ${text}`)
  const data = block.split(/\r?\n/).find((line) => line.startsWith('data: '))
  return JSON.parse(data.slice(6))
}

const providerServer = http.createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  providerBodies.push(body)
  const text = providerText(body)
  if (text.includes('FAIL_PROVIDER')) {
    response.statusCode = 503
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ error: { code: 'fixture_unavailable', message: 'synthetic provider failure' } }))
    return
  }
  if (body.stream) {
    response.statusCode = 200
    response.setHeader('Content-Type', 'text/event-stream')
    if (text.includes('EMPTY_PROVIDER')) {
      response.end('data: [DONE]\n\n')
      return
    }
    response.end('data: {"choices":[{"delta":{"content":"Provider worked answer"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    return
  }
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ choices: [{ message: { content: text.includes('EMPTY_PROVIDER') ? '   ' : 'Provider worked answer' }, finish_reason: 'stop' }] }))
})

const providerBase = await listen(providerServer)
const api = createAiApi({
  env: {
    AI_PROVIDER: 'qwen',
    STEM_INTERNAL_AUTH_KEY: signingKey,
    COACH_AI_API_KEY: 'synthetic-coach-key',
    COACH_AI_BASE_URL: providerBase,
    COACH_AI_MODEL: 'synthetic-coach-model',
    VISION_AI_API_KEY: 'synthetic-vision-key',
    VISION_AI_BASE_URL: providerBase,
    VISION_AI_MODEL: 'synthetic-vision-model',
  },
  libraryRoot: process.cwd(),
  allowedSubjects: new Set(['9702', '9700']),
})
const server = appServer(api)
const baseUrl = await listen(server)
const token = identityToken()

async function post(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let payload = null
  try { payload = JSON.parse(text) } catch { payload = null }
  return { response, text, payload }
}

const baseContext = {
  view: 'coach-photo',
  subject: { code: '9702', name: 'Physics' },
  stage: 'AS',
  question: { prompt: 'A public standalone learning question.' },
}

try {
  const jsonSolution = await post('/api/ai/coach', {
    helpIntent: 'worked-solution',
    message: 'Please give the complete worked solution and final answer.',
    hintLevel: 1,
    context: baseContext,
  })
  assert.equal(jsonSolution.response.status, 200, jsonSolution.text)
  assert.equal(jsonSolution.payload?.answer, 'Provider worked answer')
  assert.deepEqual(
    {
      coachPolicyVersion: jsonSolution.payload?.coachPolicyVersion,
      coachHelpIntent: jsonSolution.payload?.coachHelpIntent,
      coachHelpDepth: jsonSolution.payload?.coachHelpDepth,
      coachSolutionAllowed: jsonSolution.payload?.coachSolutionAllowed,
      coachAssessmentState: jsonSolution.payload?.coachAssessmentState,
      answerStatus: jsonSolution.payload?.answerStatus,
    },
    {
      coachPolicyVersion: COACH_POLICY_VERSION,
      coachHelpIntent: 'worked-solution',
      coachHelpDepth: 5,
      coachSolutionAllowed: true,
      coachAssessmentState: 'standalone-learning',
      answerStatus: 'complete',
    },
  )
  assert.match(systemPrompt(providerBodies.at(-1)), /complete teaching solution and final result/i)
  assert.equal(providerContext(providerBodies.at(-1))?.coachHelpIntent, 'worked-solution')

  const photoSolution = await post('/api/ai/coach/stream', {
    message: '请完整分析照片里的题并给出最终答案。',
    imageDataUrls: [tinyPng],
    context: { ...baseContext, subject: { code: '9700', name: 'Biology' } },
  })
  assert.equal(photoSolution.response.status, 200, photoSolution.text)
  const photoDone = sseDone(photoSolution.text)
  assert.equal(photoDone.coachHelpIntent, 'worked-solution')
  assert.equal(photoDone.coachSolutionAllowed, true)
  assert.equal(photoDone.answerStatus, 'complete')

  const ordinarySolution = await post('/api/ai/coach', {
    helpIntent: 'worked-solution',
    message: 'Help with this practice question.',
    hintLevel: 1,
    context: { ...baseContext, view: 'chapter-practice', attemptId: 'topic-attempt-api-1' },
  })
  assert.equal(ordinarySolution.payload?.coachAssessmentState, 'ordinary-practice')
  assert.equal(ordinarySolution.payload?.coachHelpIntent, 'worked-solution')
  assert.equal(ordinarySolution.payload?.answerStatus, 'complete')

  const callsBeforeHint = providerBodies.length
  const noAnswer = await post('/api/ai/coach/stream', {
    helpIntent: 'worked-solution',
    message: '不要告诉我答案，只提示下一步。',
    hintLevel: 5,
    context: baseContext,
  })
  const hintDone = sseDone(noAnswer.text)
  assert.equal(hintDone.coachHelpIntent, 'hint')
  assert.equal(hintDone.coachSolutionAllowed, false)
  assert.equal(hintDone.answerStatus, 'complete')
  assert.equal(providerBodies.length, callsBeforeHint + 1, 'a level-5 no-answer request may use the provider for deeper guidance')
  assert.match(systemPrompt(providerBodies.at(-1)), /Do not reveal the final answer or a complete worked solution/)

  const escalation = await post('/api/ai/coach/stream', {
    message: 'I used the hint. Now give the full worked solution and final result.',
    hintLevel: 2,
    history: [{ role: 'assistant', content: 'Try resolving the force first.' }],
    context: baseContext,
  })
  assert.equal(sseDone(escalation.text).coachHelpIntent, 'worked-solution')

  const levelFive = await post('/api/ai/coach', {
    message: 'Continue with this learning question.',
    hintLevel: 5,
    context: baseContext,
  })
  assert.equal(levelFive.payload?.coachHelpIntent, 'worked-solution')
  assert.equal(levelFive.payload?.coachHelpDepth, 5)

  const workCheck = await post('/api/ai/coach', {
    message: 'Check my work and show the first step where I went wrong.',
    context: baseContext,
  })
  assert.equal(workCheck.payload?.coachHelpIntent, 'check-work')
  assert.match(systemPrompt(providerBodies.at(-1)), /first wrong or unsupported step/i)

  const failed = await post('/api/ai/coach', {
    helpIntent: 'worked-solution',
    message: 'FAIL_PROVIDER give the complete answer.',
    context: baseContext,
  })
  assert.equal(failed.response.status, 200, failed.text)
  assert.equal(failed.payload?.mode, 'offline')
  assert.equal(failed.payload?.providerStatus, 'error')
  assert.equal(failed.payload?.answer, '')
  assert.equal(failed.payload?.answerStatus, 'unavailable')
  assert.equal(failed.payload?.retryable, true)
  assert.match(failed.payload?.recoveryHint || '', /not an AI answer/i)

  const emptyJson = await post('/api/ai/coach', {
    helpIntent: 'worked-solution',
    message: 'EMPTY_PROVIDER give the complete answer.',
    context: baseContext,
  })
  assert.equal(emptyJson.payload?.answer, '')
  assert.equal(emptyJson.payload?.answerStatus, 'unavailable')
  assert.equal(emptyJson.payload?.providerStatus, 'error')

  const emptyStream = await post('/api/ai/coach/stream', {
    helpIntent: 'worked-solution',
    message: 'EMPTY_PROVIDER give the complete answer.',
    context: baseContext,
  })
  const emptyDone = sseDone(emptyStream.text)
  assert.equal(emptyDone.answer, '')
  assert.equal(emptyDone.answerStatus, 'unavailable')
  assert.equal(emptyDone.providerStatus, 'error')
  assert.equal(emptyDone.retryable, true)
  assert.match(emptyDone.recoveryHint || '', /not an AI answer/i)
} finally {
  await Promise.all([close(server), close(providerServer)])
}

console.log(JSON.stringify({ status: 'passed', providerCalls: providerBodies.length }))
