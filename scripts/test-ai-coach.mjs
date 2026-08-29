import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createAiApi, providerConfig } from '../server/aiApi.js'
import { parseCoachMessage } from '../src/lib/coachMessage.js'
import { PracticeInventoryError, buildCoachPractice, coachPracticeOptions } from '../src/lib/verifiedPracticeCatalog.js'

const esatPractice = coachPracticeOptions().find((item) => item.routeId === 'uatuk-esat-admissions')
assert.ok(esatPractice?.topics.some((topic) => topic.id === 'esat-physics'), 'Admissions Coach must resolve its external ESAT topic taxonomy')
assert.throws(
  () => buildCoachPractice({ routeId: 'uatuk-esat-admissions', knowledgeGroupId: 'esat-physics', questionCount: 10 }),
  PracticeInventoryError,
  'an external Admissions topic with no reviewed questions must fail closed instead of throwing an undefined-group error',
)

const qwenDefaultProvider = providerConfig({
  OPENAI_API_KEY: 'configured-but-not-the-coach-default',
  DASHSCOPE_API_KEY: 'test-qwen-key',
})
assert.equal(qwenDefaultProvider.provider, 'qwen', 'Coach must prefer Qwen by default even when an OpenAI key is configured for a separate entry')
assert.equal(qwenDefaultProvider.coach.name, 'qwen', 'Coach default routing must select Qwen directly')

const explicitOpenAiProvider = providerConfig({
  AI_PROVIDER: 'openai',
  OPENAI_API_KEY: 'separate-openai-entry-key',
  DASHSCOPE_API_KEY: 'test-qwen-key',
})
assert.equal(explicitOpenAiProvider.provider, 'openai', 'an explicit OpenAI entry may still opt in to OpenAI routing')

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

const providerBodies = []
const providerTelemetry = []
let failNextProviderRequest = false
let corruptNextProviderStream = false
let truncateNextProviderStream = false
let slowNextProviderStream = false
let deadlineNextProviderStream = false
const providerServer = http.createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  providerBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  if (failNextProviderRequest) {
    failNextProviderRequest = false
    response.statusCode = 503
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ error: { code: 'insufficient_balance', message: 'provider secret balance detail' } }))
    return
  }
  response.statusCode = 200
  response.setHeader('Content-Type', 'text/event-stream')
  if (corruptNextProviderStream) {
    corruptNextProviderStream = false
    response.end('data: {not-json}\n\ndata: {"choices":[{"delta":{"content":"must not recover"}}]}\n\ndata: [DONE]\n\n')
    return
  }
  if (truncateNextProviderStream) {
    truncateNextProviderStream = false
    response.end('data: {"choices":[{"delta":{"content":"incomplete without sentinel"}}]}\n\n')
    return
  }
  if (slowNextProviderStream) {
    slowNextProviderStream = false
    response.write('data: {"choices":[{"delta":{"content":"long "}}]}\n\n')
    await new Promise((resolve) => setTimeout(resolve, 130))
    response.write('data: {"choices":[{"delta":{"content":"but "}}]}\n\n')
    await new Promise((resolve) => setTimeout(resolve, 130))
    response.end('data: {"choices":[{"delta":{"content":"healthy"}}]}\n\ndata: [DONE]\n\n')
    return
  }
  if (deadlineNextProviderStream) {
    deadlineNextProviderStream = false
    response.write('data: {"choices":[{"delta":{"content":"deadline "}}]}\n\n')
    for (const chunk of ['must ', 'remain ', 'absolute']) {
      await new Promise((resolve) => setTimeout(resolve, 150))
      if (response.destroyed) return
      response.write(`data: {"choices":[{"delta":{"content":"${chunk}"}}]}\n\n`)
    }
    response.end('data: [DONE]\n\n')
    return
  }
  response.write('data: {"choices":[{"delta":{"content":"stream "}}]}\n\n')
  await new Promise((resolve) => setTimeout(resolve, 5))
  response.write('data: {"choices":[{"delta":{"content":"answer"}}]}\n\n')
  response.end('data: [DONE]\n\n')
})

const providerBase = await listen(providerServer)
const root = path.resolve(import.meta.dirname, '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-ai-coach-test-'))
const identitySigningKey = 'ai-coach-identity-test-key'
const api = createAiApi({
  env: {
    COACH_AI_API_KEY: 'test-coach-key',
    COACH_AI_BASE_URL: providerBase,
    COACH_AI_MODEL: 'qwen-test-coach',
    VISION_AI_API_KEY: 'test-vision-key',
    VISION_AI_BASE_URL: providerBase,
    VISION_AI_MODEL: 'qwen-test-vision',
    STEM_INTERNAL_AUTH_KEY: identitySigningKey,
  },
  libraryRoot: path.join(tempRoot, 'library'),
  allowedSubjects: new Set(['0580']),
  telemetry: (event) => providerTelemetry.push(event),
})
const appServer = requestHandler(api)
const appBase = await listen(appServer)

function identityToken(userId = 42, overrides = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: `ielts:${userId}`,
    iat: now,
    exp: now + 3600,
    ...overrides,
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete claims[key]
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = crypto.createHmac('sha256', identitySigningKey).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

const signedIdentityToken = identityToken()

async function post(pathname, body, token = '') {
  const response = await fetch(`${appBase}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  return { response, text: await response.text() }
}

try {
  const formattedCoachMessage = parseCoachMessage('**Hint (Level 2):**\n$v = f\\lambda$ and $\\frac{1}{2}mv^2$')
  assert.deepEqual(formattedCoachMessage, [
    { type: 'bold', value: 'Hint (Level 2):' },
    { type: 'break' },
    { type: 'math', value: 'v = fλ' },
    { type: 'text', value: ' and ' },
    { type: 'math', value: '1/2 mv²' },
  ], 'Coach markdown and inline math must render as safe structured tokens')
  assert.ok(
    !formattedCoachMessage.some((token) => String(token.value || '').includes('\\lambda') || String(token.value || '').includes('**')),
    'Coach structured tokens must not expose raw Markdown or LaTeX delimiters',
  )
  const legacyFormattedMessage = parseCoachMessage('wave speed \\lambda stays fixed; **Hint:** use $v=f\\lambda$.')
  assert.ok(
    !legacyFormattedMessage.some((token) => /\\(?:lambda|frac|times)\b|\*\*|\$/.test(String(token.value || ''))),
    'legacy Coach messages must sanitize raw LaTeX and Markdown even when delimiters are incomplete',
  )
  const productionStyleMessage = parseCoachMessage('**Chemical equation**:\n$$6CO_2 + 6H_2O \\xrightarrow{\\text{light / chlorophyll}} C_6H_{12}O_6 + 6O_2$$')
  assert.deepEqual(productionStyleMessage, [
    { type: 'bold', value: 'Chemical equation' },
    { type: 'text', value: ':' },
    { type: 'break' },
    { type: 'math', value: '6CO₂ + 6H₂O --light / chlorophyll→ C₆H₁₂O₆ + 6O₂' },
  ], 'Production Qwen block math must render without raw Markdown or LaTeX commands')
  assert.ok(
    !productionStyleMessage.some((token) => /\\xrightarrow|\\text|\$\$|CO_2|H_2O|C_6H_\{12\}/.test(String(token.value || ''))),
    'Production Qwen formula output must not expose raw TeX delimiters or unformatted subscripts',
  )
  const screenshotFormulaMessage = parseCoachMessage(String.raw`目前能看到的第一处需要确认之处是：你似乎在使用 \(G\)、\(M\)、\(r\) 和周期 \(T\) 的关系。

\[
GMm/r^2=mv^2/r,\qquad v=2πr/T,
\]

然后整理成题目要求的 \(T^2\) 与 \(r^3\) 形式，数值因子是 \(4π^2\)。`)
  const screenshotFormulaValues = screenshotFormulaMessage.filter((token) => token.type === 'math').map((token) => token.value)
  assert.ok(screenshotFormulaValues.includes('G') && screenshotFormulaValues.includes('M') && screenshotFormulaValues.includes('r') && screenshotFormulaValues.includes('T'), 'Coach must recognize LaTeX inline math delimiters')
  assert.ok(screenshotFormulaValues.includes('GMm/r²=mv²/r, v=2πr/T,'), 'Coach must recognize multiline LaTeX block math and spacing commands')
  assert.ok(screenshotFormulaValues.includes('T²') && screenshotFormulaValues.includes('r³') && screenshotFormulaValues.includes('4π²'), 'Coach must preserve formula exponents as readable superscripts')
  assert.doesNotMatch(JSON.stringify(screenshotFormulaMessage), /\\[()[\]]|\\qquad/, 'Coach must not expose raw LaTeX delimiters or spacing commands')

  const unauthenticatedDetailed = await post('/api/ai/coach/stream', {
    message: 'Explain the method and check the units in detail.',
    hintLevel: 3,
    context: {
      stage: 'AS',
      topic: 'Mechanics',
      question: { prompt: 'Unauthenticated detailed request.', number: 1 },
    },
  })
  assert.equal(unauthenticatedDetailed.response.status, 401, 'detailed Coach requests without STEM Authorization must be rejected')
  assert.doesNotMatch(unauthenticatedDetailed.text, /stream answer|event: meta/, 'an unauthenticated Coach request must not start a provider stream')
  assert.equal(providerBodies.length, 0, 'an unauthenticated detailed Coach request must make zero provider calls')

  for (const [label, token] of [
    ['missing iat', identityToken(42, { iat: undefined })],
    ['invalid iat', identityToken(42, { iat: 'not-a-number' })],
    ['future iat', identityToken(42, { iat: Math.floor(Date.now() / 1000) + 601 })],
  ]) {
    const invalidIdentity = await post('/api/ai/coach/stream', {
      message: `Reject ${label} before provider invocation.`,
      hintLevel: 3,
      context: {
        stage: 'AS',
        topic: 'Mechanics',
        question: { prompt: `${label} token fixture.`, number: 1 },
      },
    }, token)
    assert.equal(invalidIdentity.response.status, 401, `${label} must be rejected before the Coach provider is called`)
    assert.doesNotMatch(invalidIdentity.text, /event: meta|stream answer/, `${label} must not start a provider stream`)
    assert.equal(providerBodies.length, 0, `${label} must result in zero provider calls`)
  }

  const local = await post('/api/ai/coach/stream', {
    message: 'Give me a hint for the next step.',
    hintLevel: 1,
    context: {
      stage: 'AS',
      topic: 'Mechanics',
      question: { prompt: 'Use F = ma to identify the next relationship.' },
    },
  })
  assert.equal(local.response.status, 200)
  assert.match(local.response.headers.get('content-type') || '', /text\/event-stream/)
  assert.match(local.text, /event: meta/)
  assert.match(local.text, /"mode":"local"/)
  assert.match(local.text, /event: delta/)
  assert.match(local.text, /event: done/)
  assert.equal(providerBodies.length, 0, 'local-first hints must skip the provider entirely')

  const streamed = await post('/api/ai/coach/stream', {
    message: 'Explain the method and check the units in detail.',
    hintLevel: 3,
    history: Array.from({ length: 10 }, (_, index) => ({ role: 'user', content: `old message ${index} ${'x'.repeat(500)}` })),
    context: {
      stage: 'AS',
      topic: 'Mechanics',
      question: { prompt: 'A long focused question prompt.', number: 1 },
    },
  }, signedIdentityToken)
  assert.equal(streamed.response.status, 200)
  assert.match(streamed.response.headers.get('content-type') || '', /text\/event-stream/)
  assert.match(streamed.text, /"text":"stream "/)
  assert.match(streamed.text, /"text":"answer"/)
  assert.match(streamed.text, /"answer":"stream answer"/)
  assert.equal(providerBodies.length, 1, 'a detailed request should escalate to the configured provider')
  assert.equal(providerTelemetry.length, 1, 'a real Coach provider call must emit one safe telemetry event')
  assert.deepEqual(
    { ...providerTelemetry[0], durationMs: undefined },
    {
      requestId: providerTelemetry[0].requestId,
      operation: 'coach-stream',
      provider: 'qwen',
      model: 'qwen-test-coach',
      providerAttempt: 1,
      fallbackPath: 'qwen',
      timeoutMs: 25_000,
      fallback: false,
      statusCode: 200,
      schemaStatus: 'valid',
      finalState: 'connected',
      durationMs: undefined,
    },
    'provider telemetry must contain only the safe operational fields required by the production contract',
  )
  assert.ok(Number.isFinite(providerTelemetry[0].durationMs) && providerTelemetry[0].durationMs >= 0, 'provider telemetry must record a non-negative duration')
  const providerUserMessage = providerBodies[0].messages.at(-1)
  const providerText = typeof providerUserMessage.content === 'string'
    ? providerUserMessage.content
    : providerUserMessage.content?.find((item) => item.type === 'text')?.text || ''
  assert.ok(providerText.length <= 4_800, `focused Coach context must stay bounded, received ${providerText.length} characters`)

  const slowStreamApi = createAiApi({
    env: {
      COACH_AI_API_KEY: 'test-qwen-slow-stream-key',
      COACH_AI_BASE_URL: providerBase,
      COACH_AI_MODEL: 'qwen-test-slow-stream',
      STEM_AI_PROVIDER_TIMEOUT_MS: '250',
      STEM_AI_REQUEST_DEADLINE_MS: '1000',
      STEM_INTERNAL_AUTH_KEY: identitySigningKey,
    },
    libraryRoot: path.join(tempRoot, 'library'),
    allowedSubjects: new Set(['0580']),
  })
  const slowStreamAppServer = requestHandler(slowStreamApi)
  const slowStreamAppBase = await listen(slowStreamAppServer)
  try {
    slowNextProviderStream = true
    const slowStream = await fetch(`${slowStreamAppBase}/api/ai/coach/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signedIdentityToken}` },
      body: JSON.stringify({
        message: 'Explain the method and check the units in detail.',
        hintLevel: 3,
        context: { stage: 'AS', topic: 'Mechanics', question: { prompt: 'Slow but healthy stream fixture.', number: 2 } },
      }),
    })
    const slowStreamText = await slowStream.text()
    assert.equal(slowStream.status, 200)
    assert.match(slowStreamText, /"answer":"long but healthy"/, 'active provider streams must not be aborted while valid deltas continue arriving')
    assert.match(slowStreamText, /"providerStatus":"connected"/, 'a healthy long stream must remain connected')
    assert.equal(slowStream.headers.get('x-accel-buffering'), 'no', 'Coach SSE responses must disable reverse-proxy buffering')
  } finally {
    await close(slowStreamAppServer)
  }

  const deadlineStreamApi = createAiApi({
    env: {
      COACH_AI_API_KEY: 'test-qwen-deadline-stream-key',
      COACH_AI_BASE_URL: providerBase,
      COACH_AI_MODEL: 'qwen-test-deadline-stream',
      STEM_AI_PROVIDER_TIMEOUT_MS: '250',
      STEM_AI_REQUEST_DEADLINE_MS: '400',
      STEM_INTERNAL_AUTH_KEY: identitySigningKey,
    },
    libraryRoot: path.join(tempRoot, 'library'),
    allowedSubjects: new Set(['0580']),
  })
  const deadlineStreamAppServer = requestHandler(deadlineStreamApi)
  const deadlineStreamAppBase = await listen(deadlineStreamAppServer)
  try {
    deadlineNextProviderStream = true
    const deadlineStream = await fetch(`${deadlineStreamAppBase}/api/ai/coach/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signedIdentityToken}` },
      body: JSON.stringify({
        message: 'Explain the method and check the units in detail.',
        hintLevel: 3,
        context: { stage: 'AS', topic: 'Mechanics', question: { prompt: 'Absolute deadline stream fixture.', number: 2 } },
      }),
    })
    const deadlineStreamText = await deadlineStream.text()
    assert.equal(deadlineStream.status, 200)
    assert.match(deadlineStreamText, /"mode":"interrupted"/, 'a stream that outlives its request deadline must preserve partial text as interrupted')
    assert.match(deadlineStreamText, /"retryable":true/, 'a request-deadline interruption must be retryable')
    assert.doesNotMatch(deadlineStreamText, /"providerStatus":"connected"/, 'provider chunks must not extend the absolute Coach request deadline')
  } finally {
    await close(deadlineStreamAppServer)
  }

  const nonStreamProviderServer = http.createServer(async (request, response) => {
    for await (const _chunk of request) {}
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ choices: [{ message: { content: 'non-stream answer' } }] }))
  })
  const nonStreamProviderBase = await listen(nonStreamProviderServer)
  const nonStreamApi = createAiApi({
    env: {
      COACH_AI_API_KEY: 'test-coach-non-stream-key',
      COACH_AI_BASE_URL: nonStreamProviderBase,
      COACH_AI_MODEL: 'qwen-test-non-stream',
      STEM_INTERNAL_AUTH_KEY: identitySigningKey,
    },
    libraryRoot: path.join(tempRoot, 'library'),
    allowedSubjects: new Set(['0580']),
  })
  const nonStreamAppServer = requestHandler(nonStreamApi)
  const nonStreamAppBase = await listen(nonStreamAppServer)
  try {
    const nonStream = await (async () => {
      const response = await fetch(`${nonStreamAppBase}/api/ai/coach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signedIdentityToken}` },
        body: JSON.stringify({
          message: 'Explain the method in one paragraph.',
          hintLevel: 3,
          context: { stage: 'AS', topic: 'Mechanics', question: { prompt: 'Non-stream fixture.', number: 5 } },
        }),
      })
      return { response, text: await response.text() }
    })()
    assert.equal(nonStream.response.status, 200)
    assert.deepEqual(JSON.parse(nonStream.text), {
      mode: 'ai',
      provider: 'qwen',
      providerStatus: 'connected',
      answer: 'non-stream answer',
      model: 'qwen-test-non-stream',
    }, 'the non-stream Coach route must invoke the configured provider and return its answer')
  } finally {
    await Promise.all([close(nonStreamAppServer), close(nonStreamProviderServer)])
  }

  const attachedImages = [
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+1P6Q6QAAAABJRU5ErkJggg==',
  ]
  const providerCountBeforeScreenshot = providerBodies.length
  const screenshot = await post('/api/ai/coach/stream', {
    message: 'Read the attached work and identify the first issue.',
    hintLevel: 3,
    imageDataUrls: attachedImages,
    context: {
      stage: 'AS',
      topic: 'Mechanics',
      question: { prompt: 'Inspect the photographed working.', number: 3 },
    },
  }, signedIdentityToken)
  assert.equal(screenshot.response.status, 200)
  assert.match(screenshot.text, /"mode":"ai"/)
  assert.equal(providerBodies.length, providerCountBeforeScreenshot + 1, 'screenshot questions must reach the configured vision provider')
  const screenshotMessage = providerBodies.at(-1).messages.at(-1)
  assert.ok(Array.isArray(screenshotMessage.content), 'vision requests must use multimodal provider content')
  assert.equal(
    screenshotMessage.content.filter((item) => item.type === 'image_url').length,
    attachedImages.length,
    'vision requests must preserve every attached image in order',
  )

  const slowVisionProviderServer = http.createServer(async (request, response) => {
    for await (const _chunk of request) {}
    await new Promise((resolve) => setTimeout(resolve, 350))
    if (response.destroyed) return
    response.statusCode = 200
    response.setHeader('Content-Type', 'text/event-stream')
    response.end('data: {"choices":[{"delta":{"content":"vision response"}}]}\n\ndata: [DONE]\n\n')
  })
  const slowVisionProviderBase = await listen(slowVisionProviderServer)
  const slowVisionTelemetry = []
  const slowVisionApi = createAiApi({
    env: {
      VISION_AI_API_KEY: 'test-qwen-slow-vision-key',
      VISION_AI_BASE_URL: slowVisionProviderBase,
      VISION_AI_MODEL: 'qwen-test-slow-vision',
      STEM_AI_PROVIDER_TIMEOUT_MS: '250',
      STEM_AI_REQUEST_DEADLINE_MS: '1000',
      STEM_AI_VISION_PROVIDER_TIMEOUT_MS: '600',
      STEM_AI_VISION_REQUEST_DEADLINE_MS: '900',
      STEM_INTERNAL_AUTH_KEY: identitySigningKey,
    },
    libraryRoot: path.join(tempRoot, 'library'),
    allowedSubjects: new Set(['0580']),
    telemetry: (event) => slowVisionTelemetry.push(event),
  })
  const slowVisionAppServer = requestHandler(slowVisionApi)
  const slowVisionAppBase = await listen(slowVisionAppServer)
  try {
    const slowVision = await fetch(`${slowVisionAppBase}/api/ai/coach/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signedIdentityToken}` },
      body: JSON.stringify({
        message: 'Analyze the photographed question and explain the first step.',
        hintLevel: 3,
        imageDataUrls: [attachedImages[0]],
        context: { stage: 'AS', topic: 'Mechanics', question: { prompt: 'Slow initial vision response fixture.', number: 4 } },
      }),
    })
    const slowVisionText = await slowVision.text()
    assert.equal(slowVision.status, 200)
    assert.match(slowVisionText, /"answer":"vision response"/, 'vision Coach must tolerate a slow Qwen VL initial response')
    assert.match(slowVisionText, /"providerStatus":"connected"/)
    assert.equal(slowVisionTelemetry.at(-1)?.timeoutMs, 600, 'vision telemetry must record the independent vision timeout budget')
  } finally {
    await Promise.all([close(slowVisionAppServer), close(slowVisionProviderServer)])
  }

  failNextProviderRequest = true
  const failed = await post('/api/ai/coach/stream', {
    message: 'Give a detailed explanation of this method and check the units.',
    hintLevel: 3,
    context: {
      stage: 'AS',
      topic: 'Mechanics',
      question: { prompt: 'A provider failure fixture.', number: 2 },
    },
  }, signedIdentityToken)
  assert.equal(failed.response.status, 200, 'stream errors after headers must resolve to a safe terminal event')
  assert.match(failed.text, /"providerStatus":"error"/)
  assert.match(failed.text, /"retryable":true/)
  assert.match(failed.text, /Qwen upstream returned HTTP 503/)
  assert.doesNotMatch(failed.text, /provider secret balance detail|insufficient_balance/)

  corruptNextProviderStream = true
  const corruptStream = await post('/api/ai/coach/stream', {
    message: 'Explain this method in detail after validating every provider frame.',
    hintLevel: 3,
    context: {
      stage: 'AS',
      topic: 'Mechanics',
      question: { prompt: 'Corrupt SSE frame fixture.', number: 7 },
    },
  }, signedIdentityToken)
  assert.equal(corruptStream.response.status, 200, 'stream schema failures after headers must resolve to a safe terminal event')
  assert.match(corruptStream.text, /"providerStatus":"error"/, 'a corrupt provider frame must fail closed')
  assert.doesNotMatch(corruptStream.text, /"providerStatus":"connected"|must not recover/, 'later deltas must not turn a corrupt stream into a successful response')
  assert.equal(providerTelemetry.at(-1)?.schemaStatus, 'invalid', 'corrupt SSE telemetry must preserve the schema failure')

  truncateNextProviderStream = true
  const truncatedStream = await post('/api/ai/coach/stream', {
    message: 'Explain this method in detail only after the stream completes.',
    hintLevel: 3,
    context: {
      stage: 'AS',
      topic: 'Mechanics',
      question: { prompt: 'Missing SSE completion sentinel fixture.', number: 8 },
    },
  }, signedIdentityToken)
  assert.match(truncatedStream.text, /"providerStatus":"error"/, 'a stream without the completion sentinel must fail closed')
  assert.doesNotMatch(truncatedStream.text, /"providerStatus":"connected"/, 'clean EOF alone must not certify a complete provider response')
  assert.equal(providerTelemetry.at(-1)?.schemaStatus, 'invalid', 'truncated SSE telemetry must report invalid schema')

  const openAiRoutingPaths = []
  const openAiRoutingServer = http.createServer(async (request, response) => {
    openAiRoutingPaths.push(request.url)
    for await (const _chunk of request) {}
    if (request.url !== '/v1/chat/completions') {
      response.statusCode = 404
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ error: { message: 'The versioned chat endpoint is required.' } }))
      return
    }
    response.statusCode = 200
    response.setHeader('Content-Type', 'text/event-stream')
    response.end('data: {"choices":[{"delta":{"content":"versioned answer"}}]}\n\ndata: [DONE]\n\n')
  })
  const openAiRoutingBase = await listen(openAiRoutingServer)
  const routingAppServers = []
  try {
    for (const configuredBase of [openAiRoutingBase, `${openAiRoutingBase}/v1`, `${openAiRoutingBase}/v1/chat/completions`]) {
      const routingApi = createAiApi({
        env: {
          AI_PROVIDER: 'openai',
          OPENAI_API_KEY: 'test-openai-routing-key',
          OPENAI_BASE_URL: configuredBase,
          OPENAI_MODEL: 'gpt-5.6-test',
          STEM_INTERNAL_AUTH_KEY: identitySigningKey,
        },
        libraryRoot: path.join(tempRoot, 'library'),
        allowedSubjects: new Set(['0580']),
      })
      const routingAppServer = requestHandler(routingApi)
      const routingAppBase = await listen(routingAppServer)
      routingAppServers.push(routingAppServer)
      const routingResponse = await fetch(`${routingAppBase}/api/ai/coach/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signedIdentityToken}` },
        body: JSON.stringify({
          message: 'Explain the method and check the units in detail.',
          hintLevel: 3,
          context: { stage: 'AS', topic: 'Mechanics', question: { prompt: 'Versioned endpoint fixture.', number: 5 } },
        }),
      })
      const routingText = await routingResponse.text()
      assert.equal(routingResponse.status, 200)
      assert.match(routingText, /"providerStatus":"connected"/, `OpenAI base ${configuredBase} must reach the versioned chat endpoint`)
      assert.match(routingText, /versioned answer/)
    }
    assert.deepEqual(
      openAiRoutingPaths,
      ['/v1/chat/completions', '/v1/chat/completions', '/v1/chat/completions'],
      'OpenAI root, /v1 and full /v1/chat/completions bases must normalize to one endpoint',
    )
  } finally {
    await Promise.all([...routingAppServers.map(close), close(openAiRoutingServer)])
  }

  let openAiFallbackRequests = 0
  let qwenFallbackRequests = 0
  const fallbackTelemetry = []
  const openAiFallbackServer = http.createServer((request, response) => {
    openAiFallbackRequests += 1
    response.statusCode = 503
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ error: { code: 'model_not_supported', message: 'provider detail must stay server-side' } }))
  })
  const qwenFallbackServer = http.createServer((request, response) => {
    qwenFallbackRequests += 1
    response.statusCode = 200
    response.setHeader('Content-Type', 'text/event-stream')
    response.end('data: {"choices":[{"delta":{"content":"qwen fallback answer"}}]}\n\ndata: [DONE]\n\n')
  })
  const openAiFallbackBase = await listen(openAiFallbackServer)
  const qwenFallbackBase = await listen(qwenFallbackServer)
  const fallbackApi = createAiApi({
    env: {
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'test-openai-key',
      OPENAI_BASE_URL: openAiFallbackBase,
      OPENAI_MODEL: 'gpt-5.6-test',
      DASHSCOPE_API_KEY: 'test-qwen-key',
      DASHSCOPE_COMPAT_BASE_URL: qwenFallbackBase,
      COACH_AI_MODEL: 'qwen-fallback-coach',
      STEM_INTERNAL_AUTH_KEY: identitySigningKey,
    },
    libraryRoot: path.join(tempRoot, 'library'),
    allowedSubjects: new Set(['0580']),
    telemetry: (event) => fallbackTelemetry.push(event),
  })
  const fallbackAppServer = requestHandler(fallbackApi)
  const fallbackAppBase = await listen(fallbackAppServer)
  try {
    const fallback = await fetch(`${fallbackAppBase}/api/ai/coach/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signedIdentityToken}` },
      body: JSON.stringify({
        message: 'Explain the method and check the units in detail.',
        hintLevel: 3,
        context: { stage: 'AS', topic: 'Mechanics', question: { prompt: 'Fallback fixture.', number: 4 } },
      }),
    })
    const fallbackText = await fallback.text()
    assert.equal(fallback.status, 200)
    assert.match(fallbackText, /qwen fallback answer/)
    assert.match(fallbackText, /"provider":"qwen"/)
    assert.equal(openAiFallbackRequests, 1, 'OpenAI must be attempted first')
    assert.equal(qwenFallbackRequests, 1, 'Qwen must take over when OpenAI is unsupported')
    assert.doesNotMatch(fallbackText, /provider detail must stay server-side/)
    assert.equal(fallbackTelemetry.length, 2, 'each provider attempt in one fallback request must be observable')
    assert.ok(fallbackTelemetry[0].requestId, 'fallback telemetry must include a request correlation ID')
    assert.equal(fallbackTelemetry[0].requestId, fallbackTelemetry[1].requestId, 'primary and fallback attempts must share one request correlation ID')
    assert.deepEqual(fallbackTelemetry.map((event) => event.providerAttempt), [1, 2], 'fallback telemetry must preserve provider attempt order')
    assert.deepEqual(fallbackTelemetry.map((event) => event.fallbackPath), ['openai', 'openai>qwen'], 'fallback telemetry must record the provider path')
  } finally {
    await Promise.all([close(fallbackAppServer), close(openAiFallbackServer), close(qwenFallbackServer)])
  }

  let partialFallbackRequests = 0
  const partialOpenAiServer = http.createServer(async (request, response) => {
    for await (const _chunk of request) {}
    response.statusCode = 200
    response.setHeader('Content-Type', 'text/event-stream')
    response.write('data: {"choices":[{"delta":{"content":"discard this partial answer"}}]}\n\n')
    setTimeout(() => response.destroy(), 5)
  })
  const partialQwenServer = http.createServer(async (request, response) => {
    partialFallbackRequests += 1
    for await (const _chunk of request) {}
    response.statusCode = 200
    response.setHeader('Content-Type', 'text/event-stream')
    response.end('data: {"choices":[{"delta":{"content":"complete qwen recovery"}}]}\n\ndata: [DONE]\n\n')
  })
  const partialOpenAiBase = await listen(partialOpenAiServer)
  const partialQwenBase = await listen(partialQwenServer)
  const partialFallbackApi = createAiApi({
    env: {
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'test-openai-partial-key',
      OPENAI_BASE_URL: partialOpenAiBase,
      OPENAI_MODEL: 'gpt-5.6-test',
      DASHSCOPE_API_KEY: 'test-qwen-partial-key',
      DASHSCOPE_COMPAT_BASE_URL: partialQwenBase,
      COACH_AI_MODEL: 'qwen-partial-recovery',
      STEM_INTERNAL_AUTH_KEY: identitySigningKey,
    },
    libraryRoot: path.join(tempRoot, 'library'),
    allowedSubjects: new Set(['0580']),
  })
  const partialFallbackAppServer = requestHandler(partialFallbackApi)
  const partialFallbackAppBase = await listen(partialFallbackAppServer)
  try {
    const partialFallback = await fetch(`${partialFallbackAppBase}/api/ai/coach/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signedIdentityToken}` },
      body: JSON.stringify({
        message: 'Explain this method fully and check the units.',
        hintLevel: 3,
        context: { stage: 'AS', topic: 'Mechanics', question: { prompt: 'Partial stream fallback fixture.', number: 6 } },
      }),
    })
    const partialFallbackText = await partialFallback.text()
    assert.equal(partialFallback.status, 200)
    assert.equal(partialFallbackRequests, 1, 'Qwen must take over when OpenAI fails after emitting a partial stream')
    assert.match(partialFallbackText, /event: reset/, 'the client must be told to discard incomplete OpenAI output')
    assert.match(partialFallbackText, /complete qwen recovery/)
    assert.match(partialFallbackText, /"provider":"qwen"/)
  } finally {
    await Promise.all([close(partialFallbackAppServer), close(partialOpenAiServer), close(partialQwenServer)])
  }

  const partialOnlyServer = http.createServer(async (request, response) => {
    for await (const _chunk of request) {}
    response.statusCode = 200
    response.setHeader('Content-Type', 'text/event-stream')
    response.write('data: {"choices":[{"delta":{"content":"Keep this partial explanation."}}]}\n\n')
    setTimeout(() => response.destroy(), 5)
  })
  const partialOnlyBase = await listen(partialOnlyServer)
  const partialOnlyApi = createAiApi({
    env: {
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'test-openai-partial-only-key',
      OPENAI_BASE_URL: partialOnlyBase,
      OPENAI_MODEL: 'gpt-5.6-test',
      STEM_INTERNAL_AUTH_KEY: identitySigningKey,
    },
    libraryRoot: path.join(tempRoot, 'library'),
    allowedSubjects: new Set(['0580']),
  })
  const partialOnlyAppServer = requestHandler(partialOnlyApi)
  const partialOnlyAppBase = await listen(partialOnlyAppServer)
  try {
    const partialOnly = await fetch(`${partialOnlyAppBase}/api/ai/coach/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signedIdentityToken}` },
      body: JSON.stringify({
        message: 'Explain this method fully and check the units.',
        hintLevel: 3,
        context: { stage: 'AS', topic: 'Mechanics', question: { prompt: 'Partial-only failure fixture.', number: 7 } },
      }),
    })
    const partialOnlyText = await partialOnly.text()
    assert.equal(partialOnly.status, 200)
    assert.doesNotMatch(partialOnlyText, /event: reset/, 'a final provider failure must retain already-streamed Coach text')
    assert.match(partialOnlyText, /"answer":"Keep this partial explanation\."/)
    assert.match(partialOnlyText, /"mode":"interrupted"/)
    assert.match(partialOnlyText, /"retryable":true/)
  } finally {
    await Promise.all([close(partialOnlyAppServer), close(partialOnlyServer)])
  }

  const coachSource = fs.readFileSync(path.join(root, 'src', 'components', 'AiCoach.jsx'), 'utf8')
  const aiSource = fs.readFileSync(path.join(root, 'server', 'aiApi.js'), 'utf8')
  const appSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8')
  const appStyles = fs.readFileSync(path.join(root, 'src', 'App.css'), 'utf8')
  const paperLibrarySource = fs.readFileSync(path.join(root, 'src', 'components', 'PaperLibrary.jsx'), 'utf8')
  const paperWorkspaceSource = fs.readFileSync(path.join(root, 'src', 'components', 'PaperWorkspace.jsx'), 'utf8')
  const paperAnswerSheetSource = fs.readFileSync(path.join(root, 'src', 'components', 'PaperAnswerSheet.jsx'), 'utf8')
  const handwritingSource = fs.readFileSync(path.join(root, 'src', 'components', 'HandwritingPad.jsx'), 'utf8')
  const practiceWorkspaceSource = fs.readFileSync(path.join(root, 'src', 'components', 'PracticeWorkspace.jsx'), 'utf8')
  assert.match(coachSource, /\/api\/ai\/coach\/stream/)
  assert.match(coachSource, /text\/event-stream/)
  assert.match(coachSource, /Authorization:\s*`Bearer \$\{sharedIdentityToken\}`/, 'Coach provider requests must carry the in-memory STEM identity token in the request header')
  assert.match(coachSource, /payload\.retryable/, 'a retryable streamed terminal result must restore the Coach Retry action')
  assert.match(
    coachSource,
    /const ownerChanged = hydratedStorageOwnerRef\.current !== storageOwnerId[\s\S]{0,2500}if \(ownerChanged\) setOpen\(false\)/,
    'opening a saved Coach conversation must retain the drawer; only an account switch may close it',
  )
  assert.match(aiSource, /providerStatus: 'not_configured'[\s\S]{0,300}retryable: true/, 'an unavailable streamed provider must expose a retry action')
  assert.match(appSource, /disabled=\{Boolean\(accountDialogMode \|\| accountPopoverOpen\)\}/, 'account overlays must disable the floating Coach layer')
  assert.match(coachSource, /if \(disabled\) return null/, 'account overlays must remove the Coach DOM entirely instead of merely moving it behind a modal')
  assert.doesNotMatch(appStyles, /dashboard-studio\s*~\s*\.ai-coach-trigger\s*\{\s*display:\s*none/i, 'dashboard must keep the floating AI Coach entry available')
  assert.match(appStyles, /\.account-menu\s*\{[^}]*z-index:\s*130/s, 'account menu must own the foreground interaction layer above Coach')
  assert.match(paperLibrarySource, /Past-paper practice/)
  assert.match(paperLibrarySource, /Exam Simulation/)
  assert.match(paperWorkspaceSource, /normalizePaperStudyMode\(paper\.paperStudyMode \|\| paperDraft\?\.paperStudyMode\)/)
  assert.match(paperWorkspaceSource, /void markAllResponses\(\{ questionNumbers: submittedQuestionNumbers, inkByPage: flushed\.pdfInkByPage, inkQuestionMap, submittedAttempt: true \}\)/, 'submitted reviewed paper responses must automatically queue AI-assisted marking')
  assert.match(paperAnswerSheetSource, /Marking starts automatically after submission/)
  assert.match(coachSource, /beginCurrentPageCapture/, 'Coach must support a user-initiated capture of the current STEM page')
  assert.match(coachSource, /Capture question area/, 'Coach must expose an explicit current-page capture action')
  assert.match(coachSource, /cropVisiblePageVisuals/, 'Coach must fall back to visible official question or handwriting visuals when browser capture is unavailable')
  assert.match(coachSource, /Provide screenshot/, 'Coach must also let a student provide an existing screenshot')
  assert.match(coachSource, /capture="environment"/, 'Coach must expose a native camera capture input for photographing a question')
  assert.match(coachSource, /Take photo/, 'Coach must expose a clearly labelled take-photo action')
  assert.match(coachSource, /Upload photo/, 'Coach must expose a clearly labelled upload-photo action')
  assert.match(coachSource, /Analyze (?:this )?question/, 'Coach must expose a visible action to analyze an attached question photo')
  assert.match(coachSource, /const \[imageDataUrls, setImageDataUrls\]/, 'Coach must retain multiple pending image attachments')
  assert.match(coachSource, /type="file"[^>]*multiple/, 'Coach image selection must support choosing several photos at once')
  assert.match(coachSource, /imageDataUrls\.map\(/, 'Coach must render every pending attachment for review and removal')
  assert.match(appStyles, /\.ai-coach__attachments/, 'Coach must provide a visible multi-image attachment tray')
  assert.match(practiceWorkspaceSource, /export function PracticeWorkspace\(\{[\s\S]*onGeneratePractice[\s\S]*onAgentAction/, 'Practice workspace must receive the App Coach action callbacks')
  assert.match(practiceWorkspaceSource, /<AiCoach[\s\S]*onGeneratePractice=\{onGeneratePractice\}[\s\S]*onAgentAction=\{onAgentAction\}/, 'Practice workspace must forward Coach action callbacks into its in-practice tutor')
  assert.match(handwritingSource, /Upload photo/, 'paper responses need a normal photo upload action')
  assert.match(handwritingSource, /Take photo/, 'paper responses need a camera capture action distinct from upload')
  assert.match(handwritingSource, /cameraInputRef/, 'camera capture must use its own input instead of silently forcing capture mode for uploads')
} finally {
  await Promise.all([close(appServer), close(providerServer)])
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

console.log('AI Coach local-first, bounded-context and streaming contract passed.')
