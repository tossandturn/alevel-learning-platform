import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

import { createAiApi } from '../server/aiApi.js'
import { coachStreamFailureState } from '../src/lib/coachStream.js'

const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111,
  113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 548, 554, 556, 563,
  587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667,
  6668, 6669, 6697, 10080,
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

const networkAbort = Object.assign(new Error('The network stream closed before completion.'), { name: 'AbortError' })
assert.deepEqual(
  coachStreamFailureState({
    error: networkAbort,
    streamedAnswer: 'The diagram shows a resultant force.',
    requestAborted: false,
    requestSuperseded: false,
  }),
  {
    ignored: false,
    retryable: true,
    content: 'The diagram shows a resultant force.',
    mode: 'interrupted',
    status: 'interrupted',
    warning: 'The network stream closed before completion.',
  },
  'a transport AbortError after a photo delta must keep the partial answer and expose Retry',
)

const supersededAbort = coachStreamFailureState({
  error: networkAbort,
  streamedAnswer: 'Discard this stale answer.',
  requestAborted: true,
  requestSuperseded: true,
})
assert.deepEqual(
  supersededAbort,
  { ignored: true, retryable: false },
  'an intentional local abort must not overwrite a newer Coach request',
)

const coachSource = fs.readFileSync(new URL('../src/components/AiCoach.jsx', import.meta.url), 'utf8')
assert.match(
  coachSource,
  /coachStreamFailureState\(\{[\s\S]{0,500}requestAborted:\s*controller\.signal\.aborted[\s\S]{0,300}requestSuperseded:\s*requestAbortRef\.current !== controller/s,
  'the Coach UI must distinguish its own local abort controller from a transport AbortError',
)
assert.match(coachSource, /payload\.providerStatus === 'error' && scheduleAutomaticRetry/, 'a provider error delivered as a valid SSE completion must also reconnect once')

let receivedVisionRequest = null
const providerServer = http.createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  receivedVisionRequest = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  response.statusCode = 200
  response.setHeader('Content-Type', 'text/event-stream')
  response.write('data: {"choices":[{"delta":{"content":"The photographed graph is partially read."}}]}\n\n')
  setTimeout(() => response.destroy(), 5)
})

const providerBase = await listen(providerServer)
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-coach-photo-stream-'))
const signingKey = 'coach-photo-stream-test-key'
const appApi = createAiApi({
  env: {
    VISION_AI_API_KEY: 'test-vision-key',
    VISION_AI_BASE_URL: providerBase,
    VISION_AI_MODEL: 'qwen-photo-stream-test',
    STEM_INTERNAL_AUTH_KEY: signingKey,
  },
  libraryRoot: path.join(tempRoot, 'library'),
  allowedSubjects: new Set(['0580']),
})
const appServer = requestHandler(appApi)
const appBase = await listen(appServer)

try {
  const response = await fetch(`${appBase}/api/ai/coach/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${identityToken(signingKey)}`,
    },
    body: JSON.stringify({
      message: 'Analyze the photographed graph and explain the next step.',
      hintLevel: 3,
      imageDataUrls: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
      context: { stage: 'AS', topic: 'Mechanics', question: { prompt: 'Photo stream recovery fixture.', number: 1 } },
    }),
  })
  const stream = await response.text()

  assert.equal(response.status, 200)
  assert.ok(
    Array.isArray(receivedVisionRequest?.messages?.at(-1)?.content)
      && receivedVisionRequest.messages.at(-1).content.some((part) => part?.type === 'image_url'),
    'the interrupted stream fixture must exercise the real vision payload path',
  )
  assert.match(stream, /event: delta[\s\S]*The photographed graph is partially read\./)
  assert.match(stream, /"mode":"interrupted"/)
  assert.match(stream, /"partial":true/)
  assert.match(stream, /"retryable":true/)
  assert.match(stream, /"answer":"The photographed graph is partially read\."/)
} finally {
  await Promise.all([close(appServer), close(providerServer)])
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

console.log('Coach photo stream recovery regression passed.')
