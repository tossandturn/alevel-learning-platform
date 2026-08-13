import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createAiApi } from '../server/aiApi.js'

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
let failNextProviderRequest = false
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
  response.write('data: {"choices":[{"delta":{"content":"stream "}}]}\n\n')
  await new Promise((resolve) => setTimeout(resolve, 5))
  response.write('data: {"choices":[{"delta":{"content":"answer"}}]}\n\n')
  response.end('data: [DONE]\n\n')
})

const providerBase = await listen(providerServer)
const root = path.resolve(import.meta.dirname, '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-ai-coach-test-'))
const api = createAiApi({
  env: {
    COACH_AI_API_KEY: 'test-coach-key',
    COACH_AI_BASE_URL: providerBase,
    COACH_AI_MODEL: 'qwen-test-coach',
  },
  libraryRoot: path.join(tempRoot, 'library'),
  allowedSubjects: new Set(['0580']),
})
const appServer = requestHandler(api)
const appBase = await listen(appServer)

async function post(pathname, body) {
  const response = await fetch(`${appBase}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { response, text: await response.text() }
}

try {
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
  })
  assert.equal(streamed.response.status, 200)
  assert.match(streamed.response.headers.get('content-type') || '', /text\/event-stream/)
  assert.match(streamed.text, /"text":"stream "/)
  assert.match(streamed.text, /"text":"answer"/)
  assert.match(streamed.text, /"answer":"stream answer"/)
  assert.equal(providerBodies.length, 1, 'a detailed request should escalate to the configured provider')
  const providerUserMessage = providerBodies[0].messages.at(-1)
  const providerText = typeof providerUserMessage.content === 'string'
    ? providerUserMessage.content
    : providerUserMessage.content?.find((item) => item.type === 'text')?.text || ''
  assert.ok(providerText.length <= 4_800, `focused Coach context must stay bounded, received ${providerText.length} characters`)

  failNextProviderRequest = true
  const failed = await post('/api/ai/coach/stream', {
    message: 'Give a detailed explanation of this method and check the units.',
    hintLevel: 3,
    context: {
      stage: 'AS',
      topic: 'Mechanics',
      question: { prompt: 'A provider failure fixture.', number: 2 },
    },
  })
  assert.equal(failed.response.status, 200, 'stream errors after headers must resolve to a safe terminal event')
  assert.match(failed.text, /"providerStatus":"error"/)
  assert.match(failed.text, /"retryable":true/)
  assert.match(failed.text, /Qwen upstream returned HTTP 503/)
  assert.doesNotMatch(failed.text, /provider secret balance detail|insufficient_balance/)

  const coachSource = fs.readFileSync(path.join(root, 'src', 'components', 'AiCoach.jsx'), 'utf8')
  const paperLibrarySource = fs.readFileSync(path.join(root, 'src', 'components', 'PaperLibrary.jsx'), 'utf8')
  const paperWorkspaceSource = fs.readFileSync(path.join(root, 'src', 'components', 'PaperWorkspace.jsx'), 'utf8')
  const handwritingSource = fs.readFileSync(path.join(root, 'src', 'components', 'HandwritingPad.jsx'), 'utf8')
  assert.match(coachSource, /\/api\/ai\/coach\/stream/)
  assert.match(coachSource, /text\/event-stream/)
  assert.match(paperLibrarySource, /Past-paper practice/)
  assert.match(paperLibrarySource, /Exam Simulation/)
  assert.match(paperWorkspaceSource, /normalizePaperStudyMode\(paper\.paperStudyMode \|\| paperDraft\?\.paperStudyMode\)/)
  assert.match(handwritingSource, /Upload photo/)
} finally {
  await Promise.all([close(appServer), close(providerServer)])
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

console.log('AI Coach local-first, bounded-context and streaming contract passed.')
