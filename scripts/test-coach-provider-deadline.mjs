import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { createAiApi } from '../server/aiApi.js'

const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111,
  113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548,
  554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6697, 10080,
])

function listen(server, remainingAttempts = 12) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('error', onError)
      reject(error)
    }
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.off('error', onError)
      if (FETCH_BLOCKED_PORTS.has(port)) {
        server.close(() => {
          if (remainingAttempts <= 1) reject(new Error(`Could not allocate a Fetch-safe loopback port; last port was ${port}`))
          else listen(server, remainingAttempts - 1).then(resolve, reject)
        })
        return
      }
      resolve(`http://127.0.0.1:${port}`)
    })
  })
}

function close(server) {
  return new Promise((resolve) => server.close(resolve))
}

function requestHandler(...middlewares) {
  return http.createServer((request, response) => {
    let index = 0
    const next = () => {
      const middleware = middlewares[index++]
      if (!middleware) {
        response.statusCode = 404
        response.end()
        return
      }
      middleware(request, response, next)
    }
    next()
  })
}

function identityToken(signingKey, userId = 42) {
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

const imageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const signingKey = 'coach-provider-deadline-test-key'
let openAiRequests = 0
let qwenRequests = 0
const telemetry = []

const openAiServer = http.createServer(async (request, response) => {
  openAiRequests += 1
  for await (const _chunk of request) {}
  response.statusCode = 200
  response.setHeader('Content-Type', 'text/event-stream')
  response.write('data: {"choices":[{"delta":{"content":"Partial vision answer"}}]}\n\n')
  setTimeout(() => response.destroy(), 10)
})

const qwenServer = http.createServer(async (request, response) => {
  qwenRequests += 1
  for await (const _chunk of request) {}
  await new Promise((resolve) => setTimeout(resolve, 700))
  if (response.destroyed) return
  response.statusCode = 200
  response.setHeader('Content-Type', 'text/event-stream')
  response.end('data: {"choices":[{"delta":{"content":"Qwen should not complete after the total deadline."}}]}\n\ndata: [DONE]\n\n')
})

const openAiBase = await listen(openAiServer)
const qwenBase = await listen(qwenServer)
const appApi = createAiApi({
  env: {
    AI_PROVIDER: 'openai',
    OPENAI_API_KEY: 'test-openai-key',
    OPENAI_BASE_URL: openAiBase,
    OPENAI_MODEL: 'gpt-5.6-test',
    DASHSCOPE_API_KEY: 'test-qwen-key',
    DASHSCOPE_COMPAT_BASE_URL: qwenBase,
    VISION_AI_MODEL: 'qwen3-vl-plus-test',
    STEM_AI_VISION_PROVIDER_TIMEOUT_MS: '600',
    STEM_AI_VISION_TOTAL_DEADLINE_MS: '400',
    STEM_AI_VISION_REQUEST_DEADLINE_MS: '1000',
    STEM_INTERNAL_AUTH_KEY: signingKey,
  },
  libraryRoot: path.join(os.tmpdir(), 'stem-coach-provider-deadline'),
  allowedSubjects: new Set(['0580']),
  telemetry: (event) => telemetry.push(event),
})
const appServer = requestHandler(appApi)
const appBase = await listen(appServer)

try {
  const startedAt = Date.now()
  const response = await fetch(`${appBase}/api/ai/coach/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${identityToken(signingKey)}`,
    },
    body: JSON.stringify({
      message: 'Analyze this photographed question and explain the next step.',
      hintLevel: 3,
      imageDataUrls: [imageDataUrl],
      context: { stage: 'AS', topic: 'Mechanics', question: { prompt: 'Total deadline fixture.', number: 1 } },
    }),
  })
  const responseText = await response.text()
  const durationMs = Date.now() - startedAt

  assert.equal(response.status, 200)
  assert.equal(openAiRequests, 1, 'the primary vision provider must be attempted once')
  assert.equal(qwenRequests, 1, 'the configured fallback provider must be attempted once')
  assert.ok(durationMs < 540, `fallback must remain within the configured total deadline, took ${durationMs}ms`)
  assert.match(responseText, /event: reset/, 'a failed primary provider must reset its partial output before fallback')
  assert.match(responseText, /"mode":"interrupted"/, 'when the fallback also misses the total deadline the response must remain interrupted')
  assert.match(responseText, /"answer":"Partial vision answer"/, 'partial primary output must remain available for retry')
  assert.match(responseText, /"partial":true/)
  assert.match(responseText, /"retryable":true/)
  assert.doesNotMatch(responseText, /Qwen should not complete/, 'a fallback beyond the total deadline must not be accepted as an AI completion')
  assert.equal(telemetry.length, 2, 'both provider attempts must emit safe telemetry')
  assert.deepEqual(telemetry.map((event) => event.provider), ['openai', 'qwen'])
  assert.deepEqual(telemetry.map((event) => event.finalState), ['error', 'timeout'])
  assert.deepEqual(telemetry.map((event) => event.failureClass), ['transport_error', 'total_deadline'])
  assert.deepEqual(telemetry.map((event) => event.totalDeadlineMs), [400, 400])
  assert.ok(telemetry.every((event) => Number.isFinite(event.durationMs) && event.durationMs >= 0))
} finally {
  await Promise.all([close(appServer), close(openAiServer), close(qwenServer)])
}

console.log('Coach provider timeout and fallback total-deadline regression passed.')
