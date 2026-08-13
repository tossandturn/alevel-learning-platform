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
  const tutorCard = page.getByRole('button', { name: 'Chat with AI Tutor' })
  const coachDrawer = page.locator('.ai-coach.open')
  if (!(await coachDrawer.count())) {
    if (await floatingTrigger.isVisible()) await floatingTrigger.click()
    else await tutorCard.click()
  }
  await page.locator('.ai-coach textarea').fill(text)
  await page.getByRole('button', { name: 'Send to AI Coach' }).click()
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
  let screenshotPayload = null
  await page.route('**/api/ai/coach/stream', async (route) => {
    screenshotPayload = JSON.parse(route.request().postData() || '{}')
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'event: meta',
        'data: {"mode":"ai"}',
        '',
        'event: delta',
        'data: {"text":"**Hint:** $v=f\\\\lambda$"}',
        '',
        'event: done',
        'data: {"answer":"**Hint:** $v=f\\\\lambda$","mode":"ai"}',
        '',
      ].join('\n'),
    })
  })
  try {
    await page.getByRole('button', { name: 'Open AI Coach' }).click()
    await page.locator('.ai-coach__screenshot input').setInputFiles({
      name: 'handwritten-working.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    })
    await page.getByText('Image attached', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Review screenshot' }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('.ai-message--assistant')].some((node) => node.textContent.includes('Hint:')))
    if (!screenshotPayload?.imageDataUrl?.startsWith('data:image/png;base64,')) {
      throw new Error('Coach screenshot request did not include the attached image data')
    }
    const coachText = await page.locator('.ai-message--assistant').last().innerText()
    if (/\*\*|\$|\\lambda/.test(coachText) || !coachText.includes('λ')) {
      throw new Error(`Coach screenshot response exposed raw Markdown or TeX: ${coachText}`)
    }
    await page.locator('.ai-coach.open').getByRole('button', { name: 'Close AI Coach' }).click()
  } finally {
    await page.unroute('**/api/ai/coach/stream')
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
    page.on('pageerror', (error) => errors.push(error.message))
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
      await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => entry.name.endsWith('/data/papers.json')))
      await waitForDashboard(page)
      await assertAccountOverlayOwnsCoachLayer(page)

      const defaultRouteId = await page.getByRole('combobox', { name: 'Current course' }).inputValue()
      if (defaultRouteId !== 'cie-9702-as-physics') throw new Error(`Coach cross-route regression must begin on default AS Physics, received ${defaultRouteId}`)
      await page.getByRole('button', { name: 'Open AI Coach' }).click()
      if (await page.getByRole('button', { name: 'Latest BPhO SPC' }).count()) throw new Error('AS Physics Coach leaked the Competition-only BPhO quick action')
      await page.locator('.ai-coach.open').getByRole('button', { name: 'Close AI Coach' }).click()

      await sendCoachMessage(page, '给我出一份 AS 物理波 10 道真题')
      await page.getByText(/no verified question is available yet|source inventory is still being indexed/i).waitFor()
      if (await page.locator('.practice-view').count()) throw new Error('An unreviewed AS Physics topic must not open a practice workspace')
      if (await page.getByRole('combobox', { name: 'Current course' }).inputValue() !== 'cie-9702-as-physics') {
        throw new Error('An unavailable Coach request must not silently change the current course')
      }

      await sendCoachMessage(page, '给我一套最新的 BPhO SPC 真题，带答案')
      await page.waitForSelector('.paper-workspace')
      await page.getByText('BPhO_SPC_2025_QP.pdf', { exact: false }).waitFor()
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
      if (await page.getByRole('button', { name: 'Latest BPhO SPC' }).count() !== 1) throw new Error('Competition Coach is missing its scoped BPhO quick action')

      await sendCoachMessage(page, 'ESAT Physics 10 questions')
      await page.locator('.ai-coach.open').waitFor({ state: 'detached' })
      if (await page.getByRole('combobox', { name: 'Current course' }).inputValue() !== 'bpho-admissions-physics') {
        throw new Error('An unavailable Admissions Coach request must not discard the current Competition route')
      }
      const afterAdmissions = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').generatedUnits || [], STORAGE_KEY)
      if (afterAdmissions.length) throw new Error('An unavailable Admissions Coach request must not persist an unreviewed practice unit')

      await sendCoachMessage(page, 'IGCSE Mathematics Number 10 questions')
      await page.waitForSelector('.practice-view')
      if ((await page.locator('.index-list button').count()) !== 16) throw new Error('Coach did not assemble the 16 reviewed answer parts from ten Number question groups')
      if ((await page.locator('.question-block').count()) !== 1) throw new Error('Student workspace must show one focused question')
      if (!(await page.getByText('Verified past-paper set', { exact: true }).count())) throw new Error('Verified source summary is missing')
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
      const generated = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).generatedUnits[0], STORAGE_KEY)
      if (generated.parts.length !== 16 || generated.questionGroupCount !== 10) throw new Error('Generated unit did not preserve the selected ten question groups and all sixteen answer parts')
      if (generated.routeId !== 'cie-0580-igcse-mathematics' || generated.stage !== 'IGCSE') throw new Error(`Competition-to-IGCSE Coach action opened the wrong route: ${JSON.stringify({ routeId: generated.routeId, stage: generated.stage })}`)
      if (!generated.agentGenerated || generated.topicId !== 'math-0580-number' || generated.knowledgeGroupId !== 'math-0580-number') {
        throw new Error(`Coach generated unit lost its canonical route/topic persistence context: ${JSON.stringify({ agentGenerated: generated.agentGenerated, topicId: generated.topicId, knowledgeGroupId: generated.knowledgeGroupId })}`)
      }
      if (!generated.parts.every((part) => part.sourceKind === 'past-paper' && part.sourceRef?.sha256 && part.answerRef?.sha256)) {
        throw new Error('Every Coach item must preserve independent QP/MS provenance')
      }
      if (generated.sourceMix.generatedPractice !== 0) throw new Error('Generated practice entered the formal drill')
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

      if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`)
      console.log(JSON.stringify({
        defaultRoute: 'cie-9702-as-physics',
        unavailableAsPhysicsTopic: true,
        bphoRoute: 'bpho-admissions-physics',
        bphoPaper: 'BPhO_SPC_2025_QP.pdf',
        igcseRoute: 'cie-0580-igcse-mathematics',
        verifiedQuestionGroups: 10,
        verifiedAnswerParts: 16,
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
