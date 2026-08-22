const fs = require('fs')
const path = require('path')
const net = require('net')
const { spawn } = require('child_process')
const { chromium } = require('D:/CodexWork/node_modules/playwright-core')

const REPO_ROOT = path.resolve(__dirname, '..')
let APP_URL = String(process.env.QA_APP_URL || '').trim()
const STORAGE_KEY = 'alevel-learning-platform-v2'
const ARTIFACT_DIR = 'D:/CodexWork/qa-artifacts/alevel-learning-platform'
const SERVER_START_DEADLINE_MS = Math.max(10_000, Number(process.env.QA_SERVER_START_DEADLINE_MS) || 30_000)
const FLOW_DEADLINE_MS = Math.max(60_000, Number(process.env.QA_COACH_FLOW_DEADLINE_MS) || 180_000)
const CLEANUP_DEADLINE_MS = Math.max(1_000, Number(process.env.QA_CLEANUP_DEADLINE_MS) || 10_000)

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function withDeadline(label, task, timeoutMs, onTimeout) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(async () => {
      try {
        await onTimeout?.()
      } catch {
        // The deadline remains the actionable failure.
      }
      reject(new Error(`${label} exceeded its ${timeoutMs}ms deadline.`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([Promise.resolve().then(task), timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function closeWithDeadline(resource, label) {
  if (!resource) return
  try {
    await withDeadline(`${label} cleanup`, () => resource.close(), CLEANUP_DEADLINE_MS)
  } catch (error) {
    console.warn(`[qa:cleanup] ${label}: ${error.message}`)
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForHttp(url, child) {
  while (child.exitCode == null) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
    } catch {
      // Vite is still starting or the port is not ready yet.
    }
    await sleep(100)
  }
  throw new Error(`QA app server exited before becoming ready (code ${child.exitCode}).`)
}

async function terminateProcess(child) {
  if (!child || child.exitCode != null) return
  if (process.platform === 'win32') {
    const taskkill = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    await withDeadline('isolated Vite process termination', () => new Promise((resolve) => {
      taskkill.once('close', resolve)
      taskkill.once('error', resolve)
    }), CLEANUP_DEADLINE_MS)
    return
  }
  child.kill('SIGTERM')
  await withDeadline('isolated Vite process termination', () => new Promise((resolve) => {
    child.once('close', resolve)
    child.once('exit', resolve)
  }), CLEANUP_DEADLINE_MS).catch(() => {})
}

async function startQaServer() {
  if (APP_URL) {
    console.log(`[qa:server] using explicitly configured QA_APP_URL=${APP_URL}`)
    return { url: APP_URL, cleanup: async () => {} }
  }

  const port = await findFreePort()
  const viteCli = path.join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: REPO_ROOT,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const serverUrl = `http://127.0.0.1:${port}/`
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += String(chunk)
    if (output.length > 8_000) output = output.slice(-8_000)
  })
  child.stderr.on('data', (chunk) => {
    output += String(chunk)
    if (output.length > 8_000) output = output.slice(-8_000)
  })
  try {
    await withDeadline(`isolated Vite server start at ${serverUrl}`, () => waitForHttp(serverUrl, child), SERVER_START_DEADLINE_MS, () => terminateProcess(child))
  } catch (error) {
    await terminateProcess(child).catch(() => {})
    throw new Error(`${error.message}\n${output}`)
  }
  APP_URL = serverUrl
  console.log(`[qa:server] isolated Vite dev server ready at ${APP_URL}; existing 5173 is intentionally ignored`)
  let cleaned = false
  return {
    url: APP_URL,
    cleanup: async () => {
      if (cleaned) return
      cleaned = true
      await terminateProcess(child)
      console.log('[qa:server] isolated Vite dev server stopped')
    },
  }
}

async function sendCoachMessage(page, text) {
  const floatingTrigger = page.getByRole('button', { name: 'Open AI Coach' })
  const tutorEntry = page.getByRole('button', { name: /^(Chat with AI Tutor|Open AI Tutor)$/ }).first()
  const coachDrawer = page.locator('.ai-coach.open')
  if (!(await coachDrawer.isVisible())) {
    if (await floatingTrigger.isVisible()) await floatingTrigger.click()
    else await tutorEntry.click()
  }
  await coachDrawer.waitFor({ state: 'visible' })
  if (await coachDrawer.count() !== 1) throw new Error(`Expected one interactive AI Coach drawer, received ${await coachDrawer.count()}`)
  await coachDrawer.getByRole('textbox').fill(text)
  await coachDrawer.getByRole('button', { name: 'Send to AI Coach' }).click()
}

async function waitForDashboard(page) {
  await page.locator('.app-shell--dashboard').waitFor()
  await page.getByRole('combobox', { name: 'Current course' }).waitFor()
}

async function assertAccountOverlayOwnsCoachLayer(page) {
  const coachLayers = page.locator('.ai-coach, .ai-coach-trigger, .ai-coach-backdrop')
  await page.getByRole('button', { name: 'Sign in to STEM' }).click()
  await page.locator('.account-popover').waitFor()
  await page.waitForFunction(() => !document.querySelector('.ai-coach, .ai-coach-trigger, .ai-coach-backdrop'))
  if (await coachLayers.count()) throw new Error('Account popover left an AI Coach layer above the sign-in controls')

  await page.locator('.account-popover__primary').click()
  await page.getByRole('dialog', { name: 'Sign in to STEM' }).waitFor()
  await page.getByText(/Sign-in stays on this STEM page/i).waitFor()
  await page.waitForFunction(() => !document.querySelector('.ai-coach, .ai-coach-trigger, .ai-coach-backdrop'))
  if (await coachLayers.count()) throw new Error('Native STEM sign-in dialog left an AI Coach layer mounted behind the modal')

  await page.getByRole('button', { name: 'Close account dialog' }).click()
  await page.getByRole('button', { name: 'Open AI Coach' }).waitFor()
}

async function assertCoachScreenshotFlow(page) {
  const screenshotPayloads = []
  const formulaAnswer = String.raw`**Hint:** \(v=f\lambda\)
\[GMm/r^2=mv^2/r,\qquad v=2\pi r/T\]`
  await page.route('**/api/ai/coach/stream', async (route) => {
    screenshotPayloads.push(JSON.parse(route.request().postData() || '{}'))
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'event: meta',
        'data: {"mode":"ai"}',
        '',
        'event: delta',
        `data: ${JSON.stringify({ text: formulaAnswer })}`,
        '',
        'event: done',
        `data: ${JSON.stringify({ answer: formulaAnswer, mode: 'ai' })}`,
        '',
      ].join('\n'),
    })
  })
  try {
    const viewport = page.viewportSize()
    const triggerBox = await page.getByRole('button', { name: 'Open AI Coach' }).boundingBox()
    if (viewport?.width >= 1041 && (!triggerBox || triggerBox.x < viewport.width - 260 || triggerBox.y < viewport.height - 150)) {
      throw new Error(`Desktop Coach trigger must remain a right-bottom floating control: ${JSON.stringify({ viewport, triggerBox })}`)
    }
    await page.getByRole('button', { name: 'Open AI Coach' }).click()
    const tools = page.locator('.ai-coach__tools')
    if (await tools.count() && !await tools.evaluate((element) => element.open)) await tools.locator('summary').click()
    await page.getByRole('button', { name: 'Capture question area' }).waitFor()
    await page.locator('button.ai-coach__screenshot', { hasText: 'Provide screenshot' }).waitFor()
    await page.evaluate(() => {
      const source = document.createElement('canvas')
      source.width = 640
      source.height = 360
      const context = source.getContext('2d')
      context.fillStyle = '#f6f9ff'
      context.fillRect(0, 0, source.width, source.height)
      context.fillStyle = '#182437'
      context.font = '28px sans-serif'
      context.fillText('STEM current page capture', 34, 80)
      const stream = source.captureStream(1)
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
        configurable: true,
        value: async () => stream,
      })
    })
    await page.getByRole('button', { name: 'Capture question area' }).click()
    await page.getByRole('dialog', { name: 'Capture a question area' }).waitFor()
    await page.mouse.move(72, 170)
    await page.mouse.down()
    await page.mouse.move(332, 382, { steps: 8 })
    await page.mouse.up()
    await page.getByRole('button', { name: 'Attach screenshot' }).click()
    await page.locator('.ai-coach__attachments').waitFor()
    await page.getByText('1/4 photos ready', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Review photo', exact: true }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('.ai-message--assistant')].some((node) => node.textContent.includes('Hint:')))
    if (!screenshotPayloads[0]?.imageDataUrls?.[0]?.startsWith('data:image/jpeg;base64,')) {
      throw new Error('Coach current-page capture request did not include the captured JPEG in imageDataUrls')
    }
    const coachText = await page.locator('.ai-message--assistant').last().innerText()
    if (/\*\*|\$|\\|qquad/.test(coachText) || !coachText.includes('λ') || !coachText.includes('r²') || !coachText.includes('π')) {
      throw new Error(`Coach screenshot response exposed raw Markdown or TeX or lost readable formula characters: ${coachText}`)
    }
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'qa-coach-formula-preview.png'), fullPage: false })

    await page.locator('.ai-coach.open').getByRole('button', { name: 'Close AI Coach' }).click()
    await page.evaluate(() => {
      const fallback = document.createElement('canvas')
      fallback.id = 'coach-capture-fallback-fixture'
      fallback.width = 420
      fallback.height = 220
      Object.assign(fallback.style, {
        position: 'fixed',
        zIndex: '2',
        left: '56px',
        top: '158px',
        width: '420px',
        height: '220px',
      })
      const context = fallback.getContext('2d')
      context.fillStyle = '#eff7ff'
      context.fillRect(0, 0, fallback.width, fallback.height)
      context.fillStyle = '#17324d'
      context.font = '24px sans-serif'
      context.fillText('Visible page fallback', 24, 72)
      document.body.append(fallback)
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
        configurable: true,
        value: async () => {
          throw new DOMException('Cancelled', 'NotAllowedError')
        },
      })
    })
    await page.getByRole('button', { name: 'Open AI Coach' }).click()
    await page.getByRole('button', { name: 'Capture question area' }).click()
    await page.getByRole('dialog', { name: 'Capture a question area' }).waitFor()
    await page.getByText('Drag over a visible question, graph, or handwritten area to attach it.').waitFor()
    await page.mouse.move(80, 180)
    await page.mouse.down()
    await page.mouse.move(400, 350, { steps: 8 })
    await page.mouse.up()
    await page.getByRole('button', { name: 'Attach screenshot' }).click()
    await page.locator('.ai-coach__attachments').waitFor()
    await page.getByText('1/4 photos ready', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Review photo', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.ai-message--assistant').length >= 2)
    if (!screenshotPayloads[1]?.imageDataUrls?.[0]?.startsWith('data:image/jpeg;base64,')) {
      throw new Error('Coach visible-page fallback did not attach a JPEG in imageDataUrls')
    }
    await page.locator('#coach-capture-fallback-fixture').evaluate((node) => node.remove())
    await page.locator('.ai-coach.open').getByRole('button', { name: 'Close AI Coach' }).click()
  } finally {
    await page.unroute('**/api/ai/coach/stream')
  }
}

async function assertCoachInterruptedStreamRecovery(page) {
  let requestCount = 0
  await page.route('**/api/ai/coach/stream', async (route) => {
    requestCount += 1
    const body = requestCount === 1
      ? [
          'event: meta',
          'data: {"mode":"ai"}',
          '',
          'event: delta',
          'data: {"text":"Partial guidance kept after the stream ended."}',
          '',
        ].join('\n')
      : [
          'event: meta',
          'data: {"mode":"ai"}',
          '',
          'event: delta',
          'data: {"text":"Recovered guidance after retry."}',
          '',
          'event: done',
          'data: {"answer":"Recovered guidance after retry.","mode":"ai"}',
          '',
        ].join('\n')
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body })
  })
  try {
    await page.getByRole('button', { name: 'Open AI Coach' }).click()
    const coachDrawer = page.locator('.ai-coach.open')
    const userMessagesBefore = await coachDrawer.locator('.ai-message--user').count()
    await coachDrawer.getByRole('textbox').fill('Explain the next method step in detail.')
    await coachDrawer.getByRole('button', { name: 'Send to AI Coach' }).click()
    await coachDrawer.getByText('Partial guidance kept after the stream ended.').waitFor()
    const retry = coachDrawer.getByRole('button', { name: 'Retry' })
    await retry.waitFor()
    if (await coachDrawer.locator('.ai-message--user').count() !== userMessagesBefore + 1) {
      throw new Error('An interrupted Coach stream must add exactly one student message before retry.')
    }
    await page.evaluate(() => {
      const entry = Object.keys(localStorage)
        .filter((key) => key.includes('alevel-ai-coach-v4'))
        .map((key) => ({ key, stored: JSON.parse(localStorage.getItem(key) || '{}') }))
        .map((item) => ({ ...item, messages: Array.isArray(item.stored) ? item.stored : item.stored.messages || [] }))
        .find((item) => item.messages.some((message) => message.role === 'assistant' && message.content === 'Partial guidance kept after the stream ended.'))
      if (!entry) throw new Error('Coach history was not persisted before the refresh fixture.')
      const assistant = [...entry.messages].reverse().find((message) => message.role === 'assistant' && message.content === 'Partial guidance kept after the stream ended.')
      if (!assistant) throw new Error('Coach history did not preserve the interrupted assistant slot before the refresh fixture.')
      assistant.content = 'Preparing Coach response...'
      assistant.status = 'streaming'
      assistant.updatedAt = new Date().toISOString()
      localStorage.setItem(entry.key, JSON.stringify(Array.isArray(entry.stored) ? entry.messages : { ...entry.stored, messages: entry.messages }))
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Open AI Coach' }).click()
    const restoredDrawer = page.locator('.ai-coach.open')
    await restoredDrawer.getByText('Preparing Coach response...').waitFor()
    const restoredRetry = restoredDrawer.getByRole('button', { name: 'Retry' })
    await restoredRetry.waitFor()
    if (await restoredDrawer.locator('.ai-message--user').count() !== userMessagesBefore + 1) {
      throw new Error('Refreshing an interrupted Coach stream must restore exactly one original student message.')
    }
    await restoredRetry.click()
    await restoredDrawer.getByText('Recovered guidance after retry.').waitFor()
    if (await restoredDrawer.locator('.ai-message--user').count() !== userMessagesBefore + 1) {
      throw new Error('Retrying a restored partial Coach stream must reuse the original student message rather than duplicate it.')
    }
    if (requestCount !== 2) throw new Error(`Coach interrupted-stream recovery expected two requests, received ${requestCount}`)
    await restoredDrawer.getByRole('button', { name: 'Close AI Coach' }).click()
  } finally {
    await page.unroute('**/api/ai/coach/stream')
  }
}

async function assertRemoteCoachHistoryRecovery(page, recoveryStatus) {
  const remoteContextText = 'Official OCR context from the previous device: use the force diagram before resolving components.'
  const assistantId = `remote-assistant-${recoveryStatus}`
  const partialReply = recoveryStatus === 'streaming'
    ? 'Preparing Coach response...'
    : recoveryStatus === 'retrying'
      ? 'Retrying Coach response...'
      : 'The stream stopped after identifying the force diagram.'
  const remoteConversation = (conversationId) => ({
    conversationId,
    sourceProduct: 'stem',
    contextText: remoteContextText,
    messages: [
      {
        id: 'remote-user-1',
        role: 'user',
        content: 'Check the method from my photographed working.',
        attachments: [{ type: 'image', mimeType: 'image/jpeg', source: 'student-upload' }],
        createdAt: '2026-08-19T01:10:00.000Z',
        updatedAt: '2026-08-19T01:10:00.000Z',
      },
      {
        id: assistantId,
        role: 'assistant',
        content: partialReply,
        status: recoveryStatus,
        hintLevel: 3,
        createdAt: '2026-08-19T01:10:01.000Z',
        updatedAt: '2026-08-19T01:10:02.000Z',
      },
    ],
  })
  const authenticatedStatus = {
    authenticated: true,
    identity: { id: 'ielts:qa-coach', username: 'qa_coach_student', avatarDataUrl: '', roles: ['student'] },
    accessToken: 'qa-authenticated-stem-coach-token-that-is-long-enough-for-client-validation',
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    classrooms: [],
    assignments: [],
  }
  const streamPayloads = []
  let requestedHistory = 0
  await page.route('**/api/auth/status', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authenticatedStatus) })
  })
  await page.route('**/api/stem/workspace', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ classrooms: [], assignments: [] }),
  }))
  await page.route('**/api/stem/notebook/notes**', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ body: '', updatedAt: null }),
  }))
  await page.route('**/api/stem/coach/conversations**', async (route) => {
    if (route.request().method() === 'GET') {
      requestedHistory += 1
      const conversationIds = await page.evaluate(() => Object.keys(localStorage)
        .filter((key) => key.includes('alevel-ai-coach-v4:'))
        .map((key) => decodeURIComponent(key.split(':').at(-1) || ''))
        .filter(Boolean))
      const ids = conversationIds.length
        ? conversationIds
        : [
            'coach:stem:v1:cie-9702-as-physics:as:9702:general:overview',
            'coach:stem:v1:cie-9702-as-physics:as:physics:general:overview',
          ]
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversations: ids.map(remoteConversation) }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversations: [] }) })
  })
  await page.route('**/api/ai/coach/stream', async (route) => {
    streamPayloads.push(JSON.parse(route.request().postData() || '{}'))
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'event: meta',
        'data: {"mode":"ai"}',
        '',
        'event: done',
        'data: {"answer":"Remote history retry completed.","mode":"ai"}',
        '',
      ].join('\n'),
    })
  })
  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await page.evaluate((key) => {
      localStorage.clear()
      localStorage.removeItem(key)
    }, STORAGE_KEY)
    await page.reload({ waitUntil: 'domcontentloaded' })
    const historyResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'GET'
        && url.pathname === '/api/stem/coach/conversations'
        && url.searchParams.get('limit') === '80'
    })
    await page.getByRole('button', { name: 'Open AI Coach' }).click()
    const drawer = page.locator('.ai-coach.open')
    await drawer.waitFor({ state: 'visible' })
    await historyResponse
    if (!requestedHistory) throw new Error('Remote Coach history fixture did not receive a GET request after authentication.')
    await drawer.getByText(partialReply).waitFor()
    await drawer.getByText('Original photos are not kept in account history. Retry can continue with the saved question and text context.').waitFor()
    const beforeUserCount = await drawer.locator('.ai-message--user').count()
    const beforeAssistantCount = await drawer.locator('.ai-message--assistant').count()
    await drawer.getByRole('button', { name: 'Retry' }).click()
    await drawer.getByText('Remote history retry completed.').waitFor()
    if (await drawer.locator('.ai-message--user').count() !== beforeUserCount) {
      throw new Error('Retrying remote Coach history must not append a duplicate user message.')
    }
    if (await drawer.locator('.ai-message--assistant').count() !== beforeAssistantCount) {
      throw new Error('Retrying remote Coach history must replace the same assistant slot.')
    }
    if (streamPayloads.length !== 1) throw new Error(`Remote Coach retry expected one stream request, received ${streamPayloads.length}`)
    if (streamPayloads[0]?.context?.sourceQuestionExtract !== remoteContextText) {
      throw new Error(`Remote Coach retry lost the persisted OCR context: ${JSON.stringify(streamPayloads[0]?.context || {})}`)
    }
    if ((streamPayloads[0]?.imageDataUrls || []).length !== 0) {
      throw new Error('Remote Coach retry must not resurrect image bytes from account history.')
    }
    await page.waitForFunction(({ id }) => Object.keys(localStorage)
      .filter((key) => key.includes('alevel-ai-coach-v4:'))
      .flatMap((key) => {
        const stored = JSON.parse(localStorage.getItem(key) || '{}')
        return Array.isArray(stored) ? stored : stored.messages || []
      })
      .filter((message) => message.id === id)
      .some((message) => message.status === 'completed' && message.content === 'Remote history retry completed.'), { id: assistantId })
    const persistedAssistantSlots = await page.evaluate((id) => Object.keys(localStorage)
      .filter((key) => key.includes('alevel-ai-coach-v4:'))
      .flatMap((key) => {
        const stored = JSON.parse(localStorage.getItem(key) || '{}')
        return Array.isArray(stored) ? stored : stored.messages || []
      })
      .filter((message) => message.id === id)
      .map(({ content, status }) => ({ content, status })), assistantId)
    if (persistedAssistantSlots.length !== 1 || persistedAssistantSlots[0].status !== 'completed') {
      throw new Error(`Remote ${recoveryStatus} retry did not replace the same assistant slot: ${JSON.stringify(persistedAssistantSlots)}`)
    }
    await drawer.getByRole('button', { name: 'Close AI Coach' }).click()
  } finally {
    await page.unroute('**/api/ai/coach/stream')
    await page.unroute('**/api/stem/coach/conversations**')
    await page.unroute('**/api/stem/notebook/notes**')
    await page.unroute('**/api/stem/workspace')
    await page.unroute('**/api/auth/status')
  }
}

async function run() {
  fs.accessSync(path.join(REPO_ROOT, 'src', 'App.jsx'))
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  const qaServer = await startQaServer()
  let browser = null
  let context = null
  let page = null
  try {
    console.log('[qa:phase] start browser-launch deadlineMs=30000')
    browser = await withDeadline('browser launch', () => chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true }), 30_000)
    console.log('[qa:phase] pass browser-launch')
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    page = await context.newPage()
    page.setDefaultTimeout(20_000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.stack || error.message))
    page.on('response', (response) => {
      const expectedGuestIdentity = response.status() === 401 && new URL(response.url()).pathname === '/api/auth/status'
      if (response.status() >= 400 && !expectedGuestIdentity) errors.push(`${response.status()} ${response.url()}`)
    })

    try {
      await withDeadline('Coach cross-route flow', async () => {
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
      await page.evaluate((key) => {
        localStorage.removeItem(key)
        for (const item of Object.keys(localStorage)) if (item.includes('ai-coach')) localStorage.removeItem(item)
      }, STORAGE_KEY)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitForDashboard(page)
      await assertAccountOverlayOwnsCoachLayer(page)

      const defaultRouteId = await page.getByRole('combobox', { name: 'Current course' }).inputValue()
      if (defaultRouteId !== 'cie-9702-as-physics') throw new Error(`Coach cross-route regression must begin on default AS Physics, received ${defaultRouteId}`)
      await page.getByRole('button', { name: 'Open AI Coach' }).click()
      if (await page.getByRole('button', { name: 'Latest BPhO SPC' }).count()) throw new Error('AS Physics Coach leaked the Competition-only BPhO quick action')
      await page.locator('.ai-coach.open').getByRole('button', { name: 'Close AI Coach' }).click()

      await sendCoachMessage(page, '给我出一份 AS 物理波 10 道真题')
      await page.locator('.practice-view').waitFor()
      const coachPracticeRouteId = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').profile?.activeRouteId, STORAGE_KEY)
      if (coachPracticeRouteId !== 'cie-9702-as-physics') {
        throw new Error('Coach-generated Waves practice must retain the selected AS Physics course')
      }
      const generatedPhysicsSet = await page.evaluate((key) => {
        const state = JSON.parse(localStorage.getItem(key) || '{}')
        return state.generatedUnits?.find((unit) => unit.routeId === 'cie-9702-as-physics' && unit.knowledgeGroupId === 'physics-9702-topic-07') || null
      }, STORAGE_KEY)
      if (generatedPhysicsSet?.questionGroupCount !== 10) throw new Error(`Coach Waves practice must contain 10 canonical question groups: ${JSON.stringify(generatedPhysicsSet)}`)

      await sendCoachMessage(page, '给我一套最新的 BPhO SPC 真题，带答案')
      await page.waitForSelector('.paper-workspace')
      const bphoWorkspaceTitle = await page.locator('.workspace-title strong').innerText()
      if (!/^BPHO\b/i.test(bphoWorkspaceTitle)) throw new Error(`Coach opened the wrong competition paper: ${bphoWorkspaceTitle}`)
      await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) || '{}').profile?.activeRouteId === 'bpho-admissions-physics', STORAGE_KEY)
      if (await page.getByRole('button', { name: 'Mark scheme' }).isEnabled()) throw new Error('BPhO mark scheme leaked before submission')
      await page.getByRole('button', { name: 'Enter paper focus mode' }).click()
      await page.locator('.paper-workspace--immersive').waitFor()
      if (!await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').profile?.immersiveLearning === true, STORAGE_KEY)) {
        throw new Error('Paper immersive mode did not persist to the student profile')
      }
      await page.getByRole('button', { name: 'Exit paper focus mode' }).click()
      await page.locator('.paper-workspace--immersive').waitFor({ state: 'detached' })
      await page.getByRole('button', { name: 'Back to paper library' }).click()
      await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Today$/ }).click()
      await waitForDashboard(page)
      if (await page.getByRole('combobox', { name: 'Current course' }).inputValue() !== 'bpho-admissions-physics') throw new Error('BPhO paper action did not retain the exact Competition route')
      await page.getByRole('button', { name: 'Open AI Coach' }).click()
      const coachTools = page.locator('.ai-coach__tools')
      if (await coachTools.count() && !await coachTools.evaluate((element) => element.open)) await coachTools.locator('summary').click()
      if (await page.getByRole('button', { name: 'Latest BPhO SPC' }).count() !== 1) throw new Error('Competition Coach is missing its scoped BPhO quick action')

      await sendCoachMessage(page, 'ESAT Physics 10 questions')
      await page.locator('.ai-message--assistant').last().waitFor()
      const admissionsCoachMessage = await page.locator('.ai-message--assistant').last().innerText()
      if (!/no verified question|source inventory|human source review|sign in to stem|ai practice is locked to the currently selected course|choose a topic from this route/i.test(admissionsCoachMessage)) {
        throw new Error(`Unavailable Admissions Coach request returned an unexpected message: ${admissionsCoachMessage}`)
      }
      if (await page.getByRole('combobox', { name: 'Current course' }).inputValue() !== 'bpho-admissions-physics') {
        throw new Error('An unavailable Admissions Coach request must not discard the current Competition route')
      }
      const afterAdmissions = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').generatedUnits || [], STORAGE_KEY)
      if (afterAdmissions.length !== 1 || afterAdmissions[0].id !== generatedPhysicsSet.id) {
        throw new Error(`An unavailable Admissions Coach request must not persist another practice unit: ${JSON.stringify(afterAdmissions.map((unit) => unit.id))}`)
      }

      await sendCoachMessage(page, 'IGCSE Mathematics Number 10 questions')
      await page.waitForSelector('.practice-view')
      const generated = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).generatedUnits[0], STORAGE_KEY)
      if (generated.questionGroupCount !== 10) throw new Error(`Coach did not assemble ten source-backed Number question groups: ${JSON.stringify(generated)}`)
      if ((await page.locator('.index-list button').count()) !== generated.questionGroupCount) throw new Error('Coach workspace did not expose one navigation item per selected source question')
      const activeAnswerPartCount = await page.locator('.qp-answer-part').count()
      if (activeAnswerPartCount < 1 || activeAnswerPartCount > generated.parts.length) throw new Error(`Coach workspace rendered an invalid answer-part count for the focused source question: ${activeAnswerPartCount}`)
      if ((await page.locator('.question-block').count()) !== 1) throw new Error('Student workspace must show one focused question')
      if (!(await page.getByText('Study mode', { exact: true }).count())) throw new Error('Self-mark study status is missing')
      await page.getByRole('button', { name: 'Enter focus mode' }).click()
      await page.locator('.qp-player--immersive').waitFor()
      if (!await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').profile?.immersiveLearning === true, STORAGE_KEY)) {
        throw new Error('Topic immersive mode did not persist to the student profile')
      }
      await page.getByRole('button', { name: 'Exit focus mode' }).click()
      await page.locator('.qp-player--immersive').waitFor({ state: 'detached' })
      const sourceAsset = page.locator('.qp-question-asset img').first()
      await sourceAsset.waitFor()
      const sourceMetrics = await sourceAsset.evaluate((image) => ({
        src: image.getAttribute('src') || '',
        decoded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
      }))
      if (!sourceMetrics.decoded || !/\/question-assets\//.test(sourceMetrics.src)) {
        throw new Error(`The official source page is not rendered inline and decoded: ${JSON.stringify(sourceMetrics)}`)
      }
      if (!generated.parts.length || generated.questionGroupCount !== 10) throw new Error('Generated unit did not preserve the selected ten question groups and their answer parts')
      if (generated.routeId !== 'cie-0580-igcse-mathematics' || generated.stage !== 'IGCSE') throw new Error(`Competition-to-IGCSE Coach action opened the wrong route: ${JSON.stringify({ routeId: generated.routeId, stage: generated.stage })}`)
      if (!generated.agentGenerated || generated.topicId !== '0580-igcse-topic-01' || generated.knowledgeGroupId !== '0580-igcse-topic-01') {
        throw new Error(`Coach generated unit lost its canonical route/topic persistence context: ${JSON.stringify({ agentGenerated: generated.agentGenerated, topicId: generated.topicId, knowledgeGroupId: generated.knowledgeGroupId })}`)
      }
      if (generated.practiceMode !== 'study-only' || !generated.parts.every((part) => part.studyOnly === true && part.aiAssistedMarkingAvailable === false)) {
        throw new Error('IGCSE Number source-backed questions escaped the self-mark-only review boundary')
      }
      if (!generated.parts.every((part) => part.sourceKind === 'past-paper' && part.sourceRef?.sha256 && part.answerRef?.sha256)) {
        throw new Error('Every Coach item must preserve independent QP/MS provenance')
      }
      const firstSource = await page.locator('.question-source-label strong').textContent()
      await page.getByRole('button', { name: /Next/ }).click()
      const secondSource = await page.locator('.question-source-label strong').textContent()
      if (firstSource === secondSource) throw new Error('Next question did not change the focused source item')
      const screenshot = path.join(ARTIFACT_DIR, 'qa-coach-competition-to-igcse-number.png')
      await page.screenshot({ path: screenshot, fullPage: false })

      if (await page.locator('.ai-coach-backdrop').count()) {
        await page.locator('.ai-coach-backdrop').dispatchEvent('pointerdown')
        await page.waitForSelector('.ai-coach-backdrop', { state: 'detached' })
      }
      await page.getByRole('button', { name: 'Back to library' }).click()
      await page.waitForSelector('.ai-coach-backdrop', { state: 'detached' })
      await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Today$/ }).click()
      await waitForDashboard(page)
      await assertCoachScreenshotFlow(page)
      await assertCoachInterruptedStreamRecovery(page)
      for (const recoveryStatus of ['interrupted', 'retrying', 'streaming']) {
        await assertRemoteCoachHistoryRecovery(page, recoveryStatus)
      }

      if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`)
      console.log(JSON.stringify({
        defaultRoute: 'cie-9702-as-physics',
        unavailableAsPhysicsTopic: true,
        bphoRoute: 'bpho-admissions-physics',
        bphoPaper: 'BPhO_SPC_2025_QP.pdf',
        igcseRoute: 'cie-0580-igcse-mathematics',
        sourceBackedQuestionGroups: generated.questionGroupCount,
        sourceBackedAnswerParts: generated.parts.length,
        practiceMode: generated.practiceMode,
        sourceChanged: true,
        immersivePaperAndTopic: true,
        nativeStemSignInOverlay: true,
        coachScreenshotVisionRequest: true,
        screenshot,
      }, null, 2))
      }, FLOW_DEADLINE_MS, () => closeWithDeadline(context, 'Coach cross-route flow'))
    } catch (error) {
      const snapshot = await page.evaluate((key) => {
        const state = JSON.parse(localStorage.getItem(key) || '{}')
        return {
          url: location.href,
          routeId: state.profile?.activeRouteId || null,
          view: document.querySelector('main')?.className || null,
          coach: document.querySelector('.ai-coach.open')?.innerText?.slice(-1_000) || null,
          alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.innerText).slice(-5),
          practiceVisible: Boolean(document.querySelector('.practice-view')),
          generatedUnits: (state.generatedUnits || []).map((unit) => ({
            id: unit.id,
            routeId: unit.routeId,
            stage: unit.stage,
            topic: unit.knowledgeGroupId,
            parts: unit.parts?.length || 0,
          })).slice(0, 3),
        }
      }, STORAGE_KEY).catch(() => null)
      const snapshotPath = path.join('D:/CodexWork/qa-artifacts/alevel-learning-platform', 'qa-coach-failure.png')
      await page.screenshot({ path: snapshotPath, fullPage: false }).catch(() => {})
      console.error(JSON.stringify({ failureSnapshot: snapshotPath, state: snapshot }, null, 2))
      throw error
    }
  } finally {
    await closeWithDeadline(context, 'browser context')
    await closeWithDeadline(browser, 'browser')
    await qaServer.cleanup()
  }
}

run().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
