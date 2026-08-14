import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createAiApi } from '../server/aiApi.js'
import { parseCoachMessage } from '../src/lib/coachMessage.js'
import { PracticeInventoryError, buildCoachPractice, coachPracticeOptions } from '../src/lib/verifiedPracticeCatalog.js'

const esatPractice = coachPracticeOptions().find((item) => item.routeId === 'uatuk-esat-admissions')
assert.ok(esatPractice?.topics.some((topic) => topic.id === 'esat-physics'), 'Admissions Coach must resolve its external ESAT topic taxonomy')
assert.throws(
  () => buildCoachPractice({ routeId: 'uatuk-esat-admissions', knowledgeGroupId: 'esat-physics', questionCount: 10 }),
  PracticeInventoryError,
  'an external Admissions topic with no reviewed questions must fail closed instead of throwing an undefined-group error',
)

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
    VISION_AI_API_KEY: 'test-vision-key',
    VISION_AI_BASE_URL: providerBase,
    VISION_AI_MODEL: 'qwen-test-vision',
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

  const screenshot = await post('/api/ai/coach/stream', {
    message: 'Read the attached work and identify the first issue.',
    hintLevel: 3,
    imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    context: {
      stage: 'AS',
      topic: 'Mechanics',
      question: { prompt: 'Inspect the photographed working.', number: 3 },
    },
  })
  assert.equal(screenshot.response.status, 200)
  assert.match(screenshot.text, /"mode":"ai"/)
  assert.equal(providerBodies.length, 2, 'screenshot questions must reach the configured vision provider')
  const screenshotMessage = providerBodies[1].messages.at(-1)
  assert.ok(Array.isArray(screenshotMessage.content), 'vision requests must use multimodal provider content')
  assert.ok(screenshotMessage.content.some((item) => item.type === 'image_url'), 'vision request must include the attached screenshot')

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
  const appSource = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8')
  const appStyles = fs.readFileSync(path.join(root, 'src', 'App.css'), 'utf8')
  const paperLibrarySource = fs.readFileSync(path.join(root, 'src', 'components', 'PaperLibrary.jsx'), 'utf8')
  const paperWorkspaceSource = fs.readFileSync(path.join(root, 'src', 'components', 'PaperWorkspace.jsx'), 'utf8')
  const paperAnswerSheetSource = fs.readFileSync(path.join(root, 'src', 'components', 'PaperAnswerSheet.jsx'), 'utf8')
  const handwritingSource = fs.readFileSync(path.join(root, 'src', 'components', 'HandwritingPad.jsx'), 'utf8')
  assert.match(coachSource, /\/api\/ai\/coach\/stream/)
  assert.match(coachSource, /text\/event-stream/)
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
  assert.match(handwritingSource, /Upload photo/, 'paper responses need a normal photo upload action')
  assert.match(handwritingSource, /Take photo/, 'paper responses need a camera capture action distinct from upload')
  assert.match(handwritingSource, /cameraInputRef/, 'camera capture must use its own input instead of silently forcing capture mode for uploads')
} finally {
  await Promise.all([close(appServer), close(providerServer)])
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

console.log('AI Coach local-first, bounded-context and streaming contract passed.')
