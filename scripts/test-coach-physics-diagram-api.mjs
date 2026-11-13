import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { createAiApi } from '../server/aiApi.js'
import { validateCoachDiagram } from '../server/coachDiagram.js'

const workspace = path.resolve('.tmp-test')
fs.mkdirSync(workspace, { recursive: true })
const testRoot = fs.mkdtempSync(path.join(workspace, 'coach-physics-'))
const key = 'synthetic-local-physics-test-signing-key'
const now = Math.floor(Date.now() / 1000)
const jwtHead = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
const jwtBody = Buffer.from(JSON.stringify({ iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: 'ielts:7001', iat: now, exp: now + 600 })).toString('base64url')
const token = `${jwtHead}.${jwtBody}.${crypto.createHmac('sha256', key).update(`${jwtHead}.${jwtBody}`).digest('base64url')}`
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlpeR0AAAAASUVORK5CYII='
const recipe = {
  version: 'stem-force-v1', title: 'Falling object', body: 'ball', description: '忽略空气阻力。', axes: 'horizontal',
  forces: [{ kind: 'weight', label: 'mg', source: 'Earth gravity; air resistance explicitly neglected' }],
}
const calls = []
let exam = false
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)))
const provider = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); calls.push(body)
  const broken = JSON.stringify(body).includes('BROKEN_RECIPE')
  const answer = '重力竖直向下。\n```stem-diagram\n' + JSON.stringify(broken ? { ...recipe, forces: [{ kind: 'normal' }] } : recipe) + '\n```'
  if (body.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (let i = 0; i < answer.length; i += 7) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer.slice(i, i + 7) } }] })}\n\n`)
    res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }))
  }
})
const providerUrl = await listen(provider)
const options = {
  env: { AI_PROVIDER: 'qwen', STEM_INTERNAL_AUTH_KEY: key, COACH_AI_API_KEY: 'synthetic', COACH_AI_BASE_URL: providerUrl, COACH_AI_MODEL: 'fixture', VISION_AI_API_KEY: 'synthetic', VISION_AI_BASE_URL: providerUrl, VISION_AI_MODEL: 'fixture' },
  libraryRoot: testRoot, coachJobsRoot: testRoot, allowedSubjects: new Set(['9702']),
  authorizeCoachRequest: () => exam ? { coachAccess: { binding: 'authoritative-attempt', assessmentState: 'active-exam', solutionAllowed: false } } : null,
}
let api = createAiApi(options)
const server = http.createServer((req, res) => api(req, res, () => { res.statusCode = 404; res.end() }))
const url = await listen(server)
const payload = { feature: 'answers', message: 'A ball falls near Earth. Ignore air resistance. Explain its forces.', helpIntent: 'worked-solution', diagramFormat: 'stem-diagram-v1', diagramIntent:'draw', context: { view: 'coach-photo', subject: { code: '9702', name: 'Physics' }, stage: 'AS' } }
async function request(route, body, method = 'POST') {
  const response = await fetch(url + route, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const text = await response.text(); let data
  try { data = JSON.parse(text) } catch {}
  return { status: response.status, text, data }
}
function diagram(answer) {
  assert.doesNotMatch(answer, /stem-force-v1|"source"|"slip"/)
  const match = answer.match(/```stem-diagram\s*([\s\S]+?)```/)
  assert.ok(match, 'a complete validated diagram reaches the client')
  const parsed = validateCoachDiagram(JSON.parse(match[1]))
  assert.equal(parsed.elements.filter(e => e.arrow && e.label === 'mg').length, 1)
  return parsed
}
function done(text) {
  const block = text.split(/\r?\n\r?\n/).find(v => v.startsWith('event: done'))
  assert.ok(block); return JSON.parse(block.split(/\r?\n/).find(v => v.startsWith('data: ')).slice(6))
}
try {
  const plain = await request('/api/ai/coach', payload)
  assert.equal(plain.status, 200); diagram(plain.data.answer)
  assert.match(calls.at(-1).messages[0].content, /stem-force-v1/)
  const photo = await request('/api/ai/coach/stream', { ...payload, imageDataUrls: [tinyPng] })
  assert.equal(photo.status, 200); diagram(done(photo.text).answer)
  assert.doesNotMatch(photo.text, /stem-force-v1|"source"/)
  assert.ok(JSON.stringify(calls.at(-1)).includes('image_url'), 'photo input remains attached to the provider request')
  const oldClient = await request('/api/ai/coach', { ...payload, diagramFormat: undefined })
  assert.doesNotMatch(oldClient.data.answer, /stem-diagram|stem-force|"forces"/)
  const broken = await request('/api/ai/coach', { ...payload, message: 'BROKEN_RECIPE explain this.' })
  assert.equal(broken.data.answer, '重力竖直向下。', 'invalid diagram cannot erase otherwise valid explanatory text')
  const hint = await request('/api/ai/coach', { ...payload, feature: 'steps', message: 'Hints only, do not give the complete force diagram.' })
  assert.equal(hint.data.coachSolutionAllowed, false)
  assert.match(calls.at(-1).messages[0].content, /hint.*diagram|diagram.*hint/i)
  const jobId = 'cj-physics12345678901234'
  const first = await request('/api/ai/coach/jobs/' + jobId, payload)
  assert.equal(first.status, 202)
  let job
  for (let i = 0; i < 40; i++) {
    job = await request('/api/ai/coach/jobs/' + jobId, null, 'GET')
    if (job.data.status === 'succeeded' || job.data.status === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.equal(job.data.status, 'succeeded', JSON.stringify(job.data))
  diagram(job.data.result.answer)
  const callCount = calls.length
  const duplicate = await request('/api/ai/coach/jobs/' + jobId, payload)
  assert.equal(duplicate.data.created, false)
  assert.equal(calls.length, callCount)
  await api.close(); api = createAiApi(options)
  const recovered = await request('/api/ai/coach/jobs/' + jobId, null, 'GET')
  assert.deepEqual(diagram(recovered.data.result.answer), diagram(job.data.result.answer))
  exam = true
  const denied = await request('/api/ai/coach/jobs/cj-physicsdenied123456789', payload)
  assert.equal(denied.status, 403)
  assert.equal(calls.length, callCount, 'active assessment does not create a diagram generation job')
  console.log(JSON.stringify({ status: 'PASS', tests: ['json', 'photo-sse', 'old-client', 'invalid-recipe', 'hint-policy', 'durable-job', 'idempotency', 'restart', 'exam-denial'], syntheticProviderCalls: calls.length }))
} finally {
  await api.close(); server.closeAllConnections(); provider.closeAllConnections()
  await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => provider.close(resolve))])
  if (path.dirname(testRoot) !== workspace || !path.basename(testRoot).startsWith('coach-physics-')) throw new Error('Unexpected synthetic test path')
  fs.rmSync(testRoot, { recursive: true })
}
