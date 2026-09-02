import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'

import { createAiApi, providerConfig } from '../server/aiApi.js'

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('error', onError)
      reject(error)
    }
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      resolve(`http://127.0.0.1:${server.address().port}`)
    })
  })
}

function close(server) {
  return new Promise((resolve) => server.close(resolve))
}

function identityToken(signingKey, userId = 7) {
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
      Promise.resolve(middleware(request, response, next)).catch((error) => {
        response.statusCode = error.statusCode || 500
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ error: error.message, code: error.code }))
      })
    }
    next()
  })
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function coachPayload(message, imageDataUrls = []) {
  return {
    message,
    hintLevel: 3,
    imageDataUrls,
    context: {
      stage: 'AS',
      topic: 'Mechanics',
      question: { prompt: 'Responses gateway fixture.', number: 1 },
    },
  }
}

const signingKey = 'responses-gateway-test-key'
const provider = providerConfig({
  AI_GATEWAY_API_KEY: 'test-responses-gateway-key',
  AI_GATEWAY_BASE_URL: 'http://127.0.0.1:1',
  AI_GATEWAY_MODEL: 'gpt-5.5-test',
  AI_GATEWAY_REASONING_EFFORT: 'high',
})
assert.equal(provider.provider, 'openai-gateway')
assert.equal(provider.coach.protocol, 'responses', 'the GPT gateway must use the Responses API protocol')

const legacyProductionProvider = providerConfig({
  OPENAI_API_KEY: 'redacted-production-shape-key',
  OPENAI_BASE_URL: 'https://ai.ieltsist.com/v1',
  DASHSCOPE_API_KEY: 'redacted-qwen-fallback-key',
})
assert.equal(legacyProductionProvider.provider, 'openai-gateway', 'the shared production gateway must be selected from the legacy OpenAI env shape')
assert.equal(legacyProductionProvider.coach.protocol, 'responses')
assert.equal(legacyProductionProvider.coach.baseUrl, 'https://ai.ieltsist.com/v1')
assert.equal(legacyProductionProvider.coach.fallback.name, 'qwen')

const requests = []
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const imageWithFormattingNoise = 'data:image/PNG;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=\n'
const gatewayServer = http.createServer(async (request, response) => {
  const body = await readBody(request)
  requests.push({ path: request.url, body })
  assert.equal(request.url, '/v1/responses', 'the gateway request must use the Responses endpoint')
  assert.equal(body.model, 'gpt-5.5-test')
  assert.deepEqual(body.reasoning, { effort: 'high' })
  assert.equal(Object.hasOwn(body, 'temperature'), false)
  const serializedBody = JSON.stringify(body)
  if (serializedBody.includes('INCOMPLETE_SYNC_FIXTURE') || serializedBody.includes('INCOMPLETE_STREAM_FIXTURE')) {
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({
      id: 'resp_incomplete_fixture',
      status: 'incomplete',
      output_text: 'partial gateway answer',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'partial gateway answer' }] }],
    }))
    return
  }
  if (body.stream) {
    response.statusCode = 200
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    response.end([
      'event: response.created',
      'data: {"type":"response.created"}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"The photographed method is consistent."}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed"}',
      '',
    ].join('\n'))
    return
  }
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({
    id: 'resp_test_1',
    status: 'completed',
    output_text: 'Use the gradient of the graph to find the acceleration.',
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'Use the gradient of the graph to find the acceleration.' }] }],
  }))
})

const gatewayBase = await listen(gatewayServer)
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-responses-gateway-'))
const api = createAiApi({
  env: {
    AI_GATEWAY_API_KEY: 'test-responses-gateway-key',
    AI_GATEWAY_BASE_URL: gatewayBase,
    AI_GATEWAY_MODEL: 'gpt-5.5-test',
    AI_GATEWAY_REASONING_EFFORT: 'high',
    STEM_INTERNAL_AUTH_KEY: signingKey,
  },
  libraryRoot: path.join(tempRoot, 'library'),
  allowedSubjects: new Set(['0580']),
})
const appServer = requestHandler(api)
const appBase = await listen(appServer)
const token = identityToken(signingKey)

async function post(pathname, body) {
  const response = await fetch(`${appBase}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  return { response, text: await response.text() }
}

try {
  const textResponse = await post('/api/ai/coach', coachPayload('Explain how to calculate the acceleration from this graph.'))
  assert.equal(textResponse.response.status, 200, textResponse.text)
  assert.match(textResponse.text, /gradient of the graph/)

  const incompleteSyncResponse = await post('/api/ai/coach', coachPayload('INCOMPLETE_SYNC_FIXTURE'))
  assert.equal(incompleteSyncResponse.response.status, 200, incompleteSyncResponse.text)
  assert.doesNotMatch(incompleteSyncResponse.text, /partial gateway answer/)
  assert.match(incompleteSyncResponse.text, /"mode":"offline"/)
  assert.match(incompleteSyncResponse.text, /"providerStatus":"error"/)

  const incompleteStreamResponse = await post('/api/ai/coach/stream', coachPayload('INCOMPLETE_STREAM_FIXTURE'))
  assert.equal(incompleteStreamResponse.response.status, 200, incompleteStreamResponse.text)
  assert.doesNotMatch(incompleteStreamResponse.text, /partial gateway answer/)
  assert.doesNotMatch(incompleteStreamResponse.text, /providerStatus":"connected"/)

  const photoResponse = await post('/api/ai/coach/stream', coachPayload('Read this photographed working and identify the next step.', [imageWithFormattingNoise, image]))
  assert.equal(photoResponse.response.status, 200, photoResponse.text)
  assert.match(photoResponse.text, /The photographed method is consistent/)
  assert.equal(requests.length, 4)
  const responseInput = requests[3].body.input
  const inputParts = responseInput.flatMap((item) => Array.isArray(item.content) ? item.content : [])
  assert.equal(inputParts.filter((item) => item.type === 'input_image').length, 2, 'every attached photo must reach the Responses API')
  assert.ok(inputParts.filter((item) => item.type === 'input_image').every((item) => /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(item.image_url)), 'image data URLs must be canonical before they reach the gateway')
} finally {
  await Promise.all([close(appServer), close(gatewayServer)])
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

console.log('AI Responses gateway contract passed.')
