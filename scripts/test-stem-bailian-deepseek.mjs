import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

import * as ai from '../server/aiApi.js'
import { withCoachEffort } from '../server/coachEffort.js'
import { loadStemAcademicProvider } from '../server/stemAcademicProvider.js'
import { createWholePaperAiRunner } from '../server/wholePaperAi.js'

const bailianBaseUrl = 'https://workspace-fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'
const bailianEndpoint = `${bailianBaseUrl}/chat/completions`
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlYV5sAAAAASUVORK5CYII='
const signingKey = 'synthetic-bailian-signing-key'
const now = Math.floor(Date.now() / 1000)
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
const claims = Buffer.from(JSON.stringify({ iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: 'ielts:9983', iat: now, exp: now + 600 })).toString('base64url')
const token = `${header}.${claims}.${crypto.createHmac('sha256', signingKey).update(`${header}.${claims}`).digest('base64url')}`

fs.mkdirSync(path.resolve('.tmp-test'), { recursive: true })
const root = fs.mkdtempSync(path.resolve('.tmp-test/stem-bailian-'))
const settingsPath = path.join(root, 'academic-provider.json')
const keyFile = path.join(root, 'stem-academic-bailian.key')
const settings = {
  schemaVersion: 'stem-academic-provider.v1',
  provider: 'deepseek',
  baseUrl: bailianBaseUrl,
  model: 'deepseek-v4.1-flash',
  apiKeyFile: 'stem-academic-bailian.key',
  reasoningEffort: 'low',
}
const writeSettings = value => fs.writeFileSync(settingsPath, JSON.stringify(value), { mode: 0o600 })

fs.writeFileSync(keyFile, 'synthetic-bailian-key', { mode: 0o600 })
writeSettings(settings)

const configured = loadStemAcademicProvider({ env: {}, settingsPath })
assert.equal(configured.apiKey, 'synthetic-bailian-key')
assert.equal(configured.baseUrl, bailianBaseUrl)
assert.equal(configured.model, 'deepseek-v4.1-flash')
assert.equal(configured.thinkingProtocol, 'enable-thinking')
assert.equal(configured.imageMode, 'data-url')

for (const unsafeBaseUrl of [
  'http://workspace-fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  'https://workspace-fixture.ap-southeast-1.maas.aliyuncs.com.evil.invalid/compatible-mode/v1',
  'https://user@workspace-fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  'https://workspace-fixture.ap-southeast-1.maas.aliyuncs.com:443/compatible-mode/v1',
  'https://workspace-fixture.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
]) {
  writeSettings({ ...settings, baseUrl: unsafeBaseUrl })
  assert.equal(loadStemAcademicProvider({ env: {}, settingsPath }).apiKey, '', `unsafe Bailian endpoint must fail closed: ${unsafeBaseUrl}`)
}
writeSettings({ ...settings, apiKeyFile: '../outside.key' })
assert.equal(loadStemAcademicProvider({ env: {}, settingsPath }).apiKey, '', 'credential traversal must fail closed')

const officialKeyFile = path.join(root, 'deepseek.key')
fs.writeFileSync(officialKeyFile, 'synthetic-official-key', { mode: 0o600 })
writeSettings({ schemaVersion: 'stem-academic-provider.v1', provider: 'deepseek', model: 'deepseek-flash', apiKeyFile: 'deepseek.key', reasoningEffort: 'low' })
const official = loadStemAcademicProvider({ env: {}, settingsPath })
assert.equal(official.baseUrl, 'https://api.deepseek.com/v1')
assert.equal(official.model, 'deepseek-flash')
assert.equal(official.thinkingProtocol, undefined)

writeSettings(settings)
const env = {
  STEM_ACADEMIC_PROVIDER_SETTINGS: settingsPath,
  STEM_INTERNAL_AUTH_KEY: signingKey,
  AI_PROVIDER: 'openai',
  OPENAI_API_KEY: 'synthetic-legacy-key',
  OPENAI_CHAT_BASE_URL: 'https://legacy-fixture.invalid/v1',
  OPENAI_API_PROTOCOL: 'chat-completions',
  OPENAI_COACH_MODEL: 'legacy-text',
  OPENAI_VISION_MODEL: 'legacy-vision',
}
const student = ai.studentProviderConfig(env)
assert.equal(student.coach.model, 'deepseek-v4.1-flash')
assert.equal(student.vision.model, 'deepseek-v4.1-flash')

const requests = []
const telemetry = []
const realFetch = globalThis.fetch
const scored = {
  summary: 'Synthetic marking result.',
  provisionalScore: 1,
  maxScore: 2,
  reviewRequired: false,
  missingPages: [],
  missingQuestions: [],
  questionResults: [{
    questionLabel: 'Q1',
    provisionalScore: 1,
    maxScore: 2,
    confidence: 0.9,
    reviewRequired: false,
    rationale: 'Synthetic rationale.',
    evidence: ['Student answer page 1'],
    criteria: [{ label: 'Method', awarded: 1, maxScore: 1, comment: 'Synthetic method.' }, { label: 'Accuracy', awarded: 0, maxScore: 1, comment: 'Synthetic accuracy.' }],
  }],
}

globalThis.fetch = async (url, options) => {
  const address = String(url)
  if (address === bailianEndpoint || address === 'https://api.deepseek.com/v1/chat/completions') {
    const body = JSON.parse(options.body)
    requests.push({ url: address, body })
    const paper = JSON.stringify(body.messages).includes('stem-paper-marking-visual-request-v1')
    const answer = paper ? JSON.stringify(scored) : 'Synthetic final answer.'
    if (body.stream) {
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'PRIVATE_REASONING' }, finish_reason: null }] })}\n\n`
          + `data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: 'stop' }] })}\n\n`
          + 'data: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } })
  }
  if (address.startsWith('http://127.0.0.1:')) return realFetch(url, options)
  throw new Error(`Unexpected network request in isolated test: ${address}`)
}

const api = ai.createAiApi({ env, libraryRoot: root, allowedSubjects: new Set(), telemetry: event => telemetry.push(event) })
const server = http.createServer((request, response) => api(request, response, () => {
  response.statusCode = 404
  response.end()
}))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const post = async (route, body) => {
  const response = await fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  return { status: response.status, text: await response.text() }
}

try {
  const statusResponse = await fetch(`${base}/api/ai/status`)
  const status = await statusResponse.json()
  assert.equal(statusResponse.status, 200)
  assert.equal(status.coachModel, 'deepseek-v4.1-flash')
  assert.equal(status.visionModel, 'deepseek-v4.1-flash')
  assert.doesNotMatch(JSON.stringify(status), /workspace-fixture|synthetic-bailian-key/)

  const outputLimits = { low: 8192, high: 16384, max: 32768 }
  for (const reasoningEffort of ['low', 'high', 'max']) {
    const response = await post('/api/ai/coach', { feature: 'answers', message: 'Solve 2+2.', reasoningEffort, context: { view: 'practice' } })
    assert.equal(response.status, 200)
    const body = requests.at(-1).body
    assert.equal(body.enable_thinking, true)
    assert.equal(body.reasoning_effort, reasoningEffort)
    assert.equal(Object.hasOwn(body, 'thinking'), false)
    assert.equal(body.max_tokens, outputLimits[reasoningEffort], 'academic output must match the bounded effort allowance')
  }

  const photo = await post('/api/ai/coach', { feature: 'answers', message: 'Analyze this question.', imageDataUrls: [image], reasoningEffort: 'high', context: { view: 'practice' } })
  assert.equal(photo.status, 200)
  assert.ok(requests.at(-1).body.messages.at(-1).content.some(part => part.type === 'image_url'))
  assert.equal(requests.at(-1).body.enable_thinking, true)

  const stream = await post('/api/ai/coach/stream', { feature: 'answers', message: 'Stream 3+3.', reasoningEffort: 'max', context: { view: 'practice' } })
  assert.equal(stream.status, 200)
  assert.match(stream.text, /event: done/)
  assert.doesNotMatch(stream.text, /PRIVATE_REASONING/)
  assert.equal(requests.at(-1).body.stream, true)
  assert.equal(requests.at(-1).body.enable_thinking, true)
  assert.equal(requests.at(-1).body.reasoning_effort, 'max')

  const runner = createWholePaperAiRunner({ env, telemetry: event => telemetry.push(event) })
  const result = await runner({ job: { id: 'synthetic-bailian-paper', reasoningEffort: 'high' }, answerPages: [{ page: 1, dataUrl: image }], questionPaperPages: [{ page: 1, dataUrl: image }], markSchemePages: [{ page: 1, dataUrl: image }] })
  assert.equal(result.provider, 'deepseek')
  assert.equal(result.provisionalScore, 1)
  assert.equal(requests.at(-1).body.enable_thinking, true)
  assert.equal(requests.at(-1).body.reasoning_effort, 'high')
  assert.deepEqual(requests.at(-1).body.response_format, { type: 'json_object' })
  assert.ok(requests.at(-1).body.messages.at(-1).content.filter(part => part.type === 'image_url').length >= 3)

  await ai.callCompatibleAi(official, { messages: [{ role: 'user', content: 'Official rollback fixture.' }], timeoutMs: 1000 })
  assert.deepEqual(requests.at(-1).body.thinking, { type: 'enabled' })
  assert.equal(requests.at(-1).body.enable_thinking, undefined)

  const disabledThinking = withCoachEffort(configured, 'low')
  await ai.callCompatibleAi(disabledThinking, { messages: [{ role: 'user', content: 'Strict extraction fixture.' }], disableThinking: true, timeoutMs: 1000 })
  assert.equal(requests.at(-1).body.enable_thinking, false)
  assert.equal(requests.at(-1).body.reasoning_effort, undefined)
  assert.equal(Object.hasOwn(requests.at(-1).body, 'thinking'), false)

  const telemetryText = JSON.stringify(telemetry)
  assert.doesNotMatch(telemetryText, /synthetic-bailian-key/)
  assert.doesNotMatch(telemetryText, /workspace-fixture/)
  console.log('PASS_STEM_BAILIAN_DEEPSEEK loader/SG-allowlist/rollback/text/effort/photo/SSE/marking/telemetry/fail-closed')
} finally {
  api.close()
  server.closeAllConnections?.()
  await new Promise(resolve => server.close(resolve))
  globalThis.fetch = realFetch
  fs.rmSync(root, { recursive: true, force: true })
}
