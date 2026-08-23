const fs = require('fs')
const path = require('path')
const net = require('net')
const os = require('os')
const { spawn } = require('child_process')
const { chromium } = require('D:/CodexWork/node_modules/playwright-core')

const REPO_ROOT = path.resolve(__dirname, '..')
let APP_URL = String(process.env.QA_APP_URL || '').trim()
const STORAGE_KEY = 'alevel-learning-platform-v2'
const ARTIFACT_DIR = 'D:/CodexWork/qa-artifacts/alevel-learning-platform'
const SERVER_START_DEADLINE_MS = Math.max(10_000, Number(process.env.QA_SERVER_START_DEADLINE_MS) || 30_000)
const VIEWPORT_DEADLINE_MS = Math.max(60_000, Number(process.env.QA_SOURCE_VIEWPORT_DEADLINE_MS) || 300_000)
const CASE_DEADLINE_MS = Math.max(15_000, Number(process.env.QA_SOURCE_CASE_DEADLINE_MS) || 60_000)
const ASSET_FAILURE_DEADLINE_MS = Math.max(30_000, Number(process.env.QA_ASSET_FAILURE_DEADLINE_MS) || 90_000)
const FULL_PAPER_DEADLINE_MS = Math.max(60_000, Number(process.env.QA_FULL_PAPER_DEADLINE_MS) || 180_000)
const CLEANUP_DEADLINE_MS = Math.max(1_000, Number(process.env.QA_CLEANUP_DEADLINE_MS) || 10_000)

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false, touch: false },
  { name: 'ipad-landscape', width: 1180, height: 820, mobile: true, touch: true },
  { name: 'ipad-portrait', width: 820, height: 1180, mobile: true, touch: true },
  { name: 'mobile', width: 390, height: 844, mobile: true, touch: true },
]

const REVIEWED_SOURCE_CASES = [
  {
    number: 5,
    topic: 'Geometry',
    sourcePages: [4],
    focusBounds: { 4: [80, 98, 930, 660] },
    parts: [{ label: 'a', marks: 2 }, { label: 'b', marks: 1 }],
  },
  {
    number: 10,
    topic: 'Mensuration',
    sourcePages: [6],
    sourceView: 'pdf-regions',
    parts: [{ label: 'a', marks: 1 }, { label: 'b', marks: 1 }],
  },
  {
    number: 14,
    topic: 'Mensuration',
    sourcePages: [8, 9],
    focusBounds: { 8: [80, 198, 930, 930], 9: [88, 92, 930, 1030] },
    parts: [{ label: 'a', marks: 2 }, { label: 'b', marks: 2 }, { label: 'c', marks: 3 }],
  },
  {
    number: 16,
    topic: 'Statistics',
    sourcePages: [11],
    focusBounds: { 11: [84, 96, 930, 670] },
    parts: [{ label: 'a', marks: 1 }, { label: 'b', marks: 1 }],
  },
  {
    number: 18,
    topic: 'Algebra and graphs',
    sourcePages: [13],
    focusBounds: { 13: [80, 92, 940, 1090] },
    parts: [{ label: 'a', marks: 3 }, { label: 'b', marks: 4 }, { label: 'c', marks: 1 }, { label: 'd', marks: 1 }],
  },
]

const REVIEWED_0606_SOURCE_CASES = [
  { number: 7, topic: 'Calculus', pages: [8, 9], parts: ['a', 'b'] },
  { number: 11, topic: 'Vectors', pages: [14, 15], parts: ['a', 'b', 'c'] },
]

function requestedNames(name) {
  return new Set(String(process.env[name] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean))
}

const requestedViewports = requestedNames('QA_SOURCE_VIEWPORTS')
const requestedQuestions = requestedNames('QA_SOURCE_QUESTIONS')
const sourceQaViewports = requestedViewports.size
  ? VIEWPORTS.filter((viewport) => requestedViewports.has(viewport.name))
  : VIEWPORTS
const sourceQaCases = requestedQuestions.size
  ? REVIEWED_SOURCE_CASES.filter((sourceCase) => requestedQuestions.has(String(sourceCase.number)))
  : REVIEWED_SOURCE_CASES
const sourceQaRepeats = Math.max(1, Math.min(20, Number(process.env.QA_SOURCE_REPEATS) || 1))

if (!sourceQaViewports.length) throw new Error('QA_SOURCE_VIEWPORTS did not match a configured viewport.')
if (!sourceQaCases.length) throw new Error('QA_SOURCE_QUESTIONS did not match a reviewed source case.')

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
        // The original deadline is the actionable failure.
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

async function removeQaDatabaseDir(directory) {
  const deadline = Date.now() + CLEANUP_DEADLINE_MS
  let lastError = null
  while (Date.now() < deadline) {
    try {
      fs.rmSync(directory, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      await sleep(100)
    }
  }
  console.warn(`[qa:cleanup] temporary database directory could not be removed before deadline: ${lastError?.message || directory}`)
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
  } else {
    child.kill('SIGTERM')
    await withDeadline('isolated Vite process termination', () => new Promise((resolve) => {
      child.once('close', resolve)
      child.once('exit', resolve)
    }), CLEANUP_DEADLINE_MS).catch(() => {})
  }
}

async function startQaServer() {
  if (APP_URL) {
    console.log(`[qa:server] using explicitly configured QA_APP_URL=${APP_URL}`)
    return { url: APP_URL, cleanup: async () => {} }
  }

  const port = await findFreePort()
  const qaDatabaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alevel-learning-platform-qa-'))
  const qaDatabasePath = path.join(qaDatabaseDir, 'stem.sqlite')
  const viteCli = path.join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      BROWSER: 'none',
      STEM_DB_PATH: qaDatabasePath,
      STEM_SESSION_SECURE: '0',
    },
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
    await removeQaDatabaseDir(qaDatabaseDir)
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
      await removeQaDatabaseDir(qaDatabaseDir)
      console.log('[qa:server] isolated Vite dev server stopped')
    },
  }
}

function overlap(first, second) {
  return first && second
    && first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top
}

function sourcePdfFor0580() {
  return '/local-pdf/0580/0580_m25_qp_12.pdf'
}

function sourcePdfFor0606() {
  return '/local-pdf/0606/0606_m25_qp_12.pdf'
}

async function mockAnonymousIdentityExchange(context) {
  if (process.env.QA_APP_URL) return
  await context.route('**/api/stem/identity', async (route) => {
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      headers: {
        'Access-Control-Allow-Origin': APP_URL.replace(/\/$/, ''),
        'Access-Control-Allow-Credentials': 'true',
      },
      body: JSON.stringify({ authenticated: false }),
    })
  })
}

function screenshotPath(question, viewport, page) {
  return path.join(ARTIFACT_DIR, `source-gate-0580-q${question}-${viewport}-qp-${String(page).padStart(2, '0')}.png`)
}

async function clearBrowserState(page) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })
}

async function startReviewedTopic(page, topic) {
  const picker = page.locator('.student-home-guided .student-route-picker')
  await picker.getByRole('tab', { name: 'IGCSE', exact: true }).click()
  await picker.getByRole('combobox', { name: 'Current course' }).selectOption('cie-0580-igcse-mathematics')
  await page.getByRole('button', { name: 'Choose another topic' }).click()
  await page.waitForFunction((expectedTopic) => [...document.querySelectorAll('.topic-directory__row')]
    .some((row) => row.innerText.split(/\r?\n/).map((line) => line.trim()).includes(expectedTopic)), topic)
  const topicRows = page.locator('.topic-directory__row')
  const rowCount = await topicRows.count()
  let topicRow = null
  for (let index = 0; index < rowCount; index += 1) {
    const candidate = topicRows.nth(index)
    const lines = (await candidate.innerText()).split(/\r?\n/).map((line) => line.trim())
    if (lines.includes(topic)) {
      topicRow = candidate
      break
    }
  }
  if (!topicRow) throw new Error(`Could not find the exact ${topic} syllabus row`)
  await topicRow.click()
  const customSet = page.locator('details.topic-detail__set-controls')
  if (await customSet.count() && !await customSet.evaluate((element) => element.open)) await customSet.locator('summary').click()
  const questionCount = page.getByRole('combobox', { name: 'Question count' })
  if (await questionCount.count()) await questionCount.selectOption('15')
  const start = page.getByRole('button', { name: /Start set|Practice \d+|Start (?:checked|verified) sample/i }).first()
  await start.waitFor()
  if (await start.isDisabled()) throw new Error(`${topic} has no enabled reviewed source set`)
  await start.click()
  await page.waitForSelector('.session-setup, .question-block')
  if (await page.locator('.session-setup').count()) {
    const disclosure = (await page.locator('.setup-marking-note').innerText()).replace(/\s+/g, ' ').trim()
    if (!/^AI-assisted review after submission\b/.test(disclosure)) throw new Error(`${topic} reviewed set disclosure is incorrect: ${disclosure}`)
    await page.getByRole('button', { name: /Start session/i }).click()
  }
  await page.locator('.question-block').waitFor()
}

async function activateQuestionPart(page, number, label, paper = 'M25/12') {
  const buttons = page.locator('.qp-index__list button')
  const count = await buttons.count()
  const identities = []
  let groupButton = null
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index)
    const identity = await button.getAttribute('data-source-question')
    identities.push(identity)
    if (!groupButton && String(identity || '').startsWith(`${paper} · Q${number}(`)) groupButton = button
  }
  if (!groupButton) throw new Error(`Could not activate Q${number}(${label}) from the reviewed source set: ${JSON.stringify(identities)}`)
  await groupButton.click()
  const targetLabel = `${paper} · Q${number}(${label})`
  const partCards = page.locator('.qp-answer-part[data-source-question]')
  const partCount = await partCards.count()
  for (let index = 0; index < partCount; index += 1) {
    const card = partCards.nth(index)
    if (await card.getAttribute('data-source-question') !== targetLabel) continue
    await card.focus()
    await page.waitForFunction((expectedLabel) => {
      const text = document.querySelector('.qp-source-label strong')?.textContent || ''
      return text.includes(expectedLabel)
    }, targetLabel, { timeout: 3_000 })
    return
  }
  throw new Error(`Could not focus Q${number}(${label}) answer part in the reviewed source set: ${JSON.stringify(identities)}`)
}

async function sourceMetrics(figure, sourcePage) {
  const image = figure.locator(`.source-region-renderer__page[data-source-page="${sourcePage}"] img`)
  return image.evaluate((element) => ({
    src: element.getAttribute('src') || '',
    complete: element.complete,
    naturalWidth: element.naturalWidth,
    naturalHeight: element.naturalHeight,
    renderedWidth: Math.round(element.getBoundingClientRect().width),
    renderedHeight: Math.round(element.getBoundingClientRect().height),
    sourceState: element.closest('.qp-question-asset')?.getAttribute('data-source-state') || '',
    sourcePage: Number(element.closest('.source-region-renderer__page')?.getAttribute('data-source-page')),
    exactRegion: element.closest('.source-region-renderer__page')?.getAttribute('data-exact-region') || '',
    renderRegion: element.closest('.source-region-renderer__page')?.getAttribute('data-source-region') || '',
    focusSafety: element.closest('.qp-question-asset')?.getAttribute('data-focus-safety') || '',
    focusRegion: element.closest('.qp-question-asset')?.getAttribute('data-focus-region') || '',
    focusMargin: element.closest('.qp-question-asset')?.getAttribute('data-focus-margin') || '',
    frameWidth: Math.round(element.closest('.source-region-renderer__page')?.getBoundingClientRect().width || 0),
    frameHeight: Math.round(element.closest('.source-region-renderer__page')?.getBoundingClientRect().height || 0),
  }))
}

async function sourceBoundaryMetrics(figure, sourcePage) {
  return figure.locator(`.source-region-renderer__page[data-source-page="${sourcePage}"] img`).evaluate((image) => {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const width = canvas.width
    const height = canvas.height
    const strip = 1
    const edgeInkRatio = (x, y, width, height) => {
      const data = context.getImageData(x, y, width, height).data
      let ink = 0
      for (let offset = 0; offset < data.length; offset += 4) {
        if (data[offset] < 180 || data[offset + 1] < 180 || data[offset + 2] < 180) ink += 1
      }
      return ink / Math.max(1, data.length / 4)
    }
    return {
      top: edgeInkRatio(0, 0, width, strip),
      right: edgeInkRatio(width - strip, 0, strip, height),
      bottom: edgeInkRatio(0, height - strip, width, strip),
      left: edgeInkRatio(0, 0, strip, height),
    }
  })
}

async function assertFocusedSource(page, sourceCase, sourcePage, viewport, evidence) {
  const figure = page.locator('.qp-question-asset')
  await figure.waitFor({ state: 'visible' })
  await figure.scrollIntoViewIfNeeded()
  await page.waitForFunction(() => document.querySelector('.qp-question-asset')?.getAttribute('data-source-state') === 'ready')
  const expectedView = sourceCase.sourceView || 'focused'
  const actualView = await figure.getAttribute('data-source-view')
  if (actualView !== expectedView) {
    throw new Error(`Q${sourceCase.number} must default to its ${expectedView === 'focused' ? 'reviewed focused crop' : 'PDF region view'}: ${JSON.stringify({ actualView, ariaLabel: await figure.getAttribute('aria-label'), sourceLabel: await page.locator('.qp-source-label strong').innerText() })}`)
  }
  const toolbar = (await figure.locator('.qp-question-asset__toolbar').innerText()).replace(/\s+/g, ' ').trim()
  if (!/Complete question.*source page/i.test(toolbar)) throw new Error(`Q${sourceCase.number} did not expose its complete PDF question: ${toolbar}`)
  const metrics = await sourceMetrics(figure, sourcePage)
  if (!metrics.complete || metrics.naturalWidth <= 0 || metrics.naturalHeight <= 0 || !metrics.src.startsWith('blob:') || metrics.sourceState !== 'ready' || metrics.sourcePage !== sourcePage) {
    throw new Error(`Q${sourceCase.number} QP p.${sourcePage} PDF crop did not decode: ${JSON.stringify(metrics)}`)
  }
  await page.waitForFunction((sourcePdf) => performance.getEntriesByType('resource').some((entry) => new URL(entry.name).pathname === sourcePdf), sourcePdfFor0580())
  if (expectedView === 'focused' && (metrics.exactRegion !== 'true' || metrics.renderedWidth < 10 || metrics.renderedHeight < 10)) {
    throw new Error(`Q${sourceCase.number} QP p.${sourcePage} is not rendered as an actual focused crop: ${JSON.stringify(metrics)}`)
  }
  let boundary = null
  if (expectedView === 'focused') {
    const renderRegion = metrics.renderRegion.split(',').map(Number)
    if (metrics.focusSafety !== 'reviewed-display-bounds-v1' || renderRegion.length !== 4 || renderRegion.some((value) => !Number.isFinite(value))) {
      throw new Error(`Q${sourceCase.number} QP p.${sourcePage} did not use the reviewed safe display bounds: ${JSON.stringify(metrics)}`)
    }
    boundary = await sourceBoundaryMetrics(figure, sourcePage)
    if (!boundary || Object.values(boundary).some((ratio) => ratio > 0.02)) {
      throw new Error(`Q${sourceCase.number} QP p.${sourcePage} focused crop touches printed source content at an edge: ${JSON.stringify(boundary)}`)
    }
  } else if (metrics.exactRegion !== 'false') {
    throw new Error(`Q${sourceCase.number} must fail closed to the complete PDF page instead of exposing an unreviewed crop: ${JSON.stringify(metrics)}`)
  }
  if (await page.getByText(/\[(?:graph|diagram|figure|image|table)\s*:/i).count()) throw new Error(`Q${sourceCase.number} exposes a raw visual placeholder instead of the official visual`)

  const screenshot = screenshotPath(sourceCase.number, viewport.name, sourcePage)
  await figure.screenshot({ path: screenshot })
  evidence.pages.push({
    page: sourcePage,
    sourcePdf: sourcePdfFor0580(),
    decoded: `${metrics.naturalWidth}x${metrics.naturalHeight}`,
    focused: expectedView === 'focused',
    safeBounds: metrics.focusRegion || null,
    edgeInk: boundary,
    screenshot,
  })
}

async function verifySourceControls(page, sourceCase) {
  const figure = page.locator('.qp-question-asset')
  if (await figure.getByRole('button', { name: /Focus current question|Show full original page|Expand source image/i }).count()) throw new Error(`Q${sourceCase.number} still exposes obsolete JPG source controls`)
  const originalLink = page.locator('.qp-original-paper-link').first()
  if (await originalLink.getAttribute('href') !== sourcePdfFor0580()) throw new Error(`Q${sourceCase.number} original-paper link is not bound to its source PDF`)
}

async function verifyReviewedQuestion(page, sourceCase, viewport) {
  await clearBrowserState(page)
  await startReviewedTopic(page, sourceCase.topic)
  const evidence = {
    questionId: `cie-0580-0580_m25_qp_12:q${sourceCase.number}`,
    viewport: `${viewport.width}x${viewport.height}`,
    parts: [],
    pages: [],
  }
  let totalMarks = 0

  for (const part of sourceCase.parts) {
    await activateQuestionPart(page, sourceCase.number, part.label)
    const sourceLabel = await page.locator('.qp-source-label strong').innerText()
    if (!new RegExp(`\\bQ${sourceCase.number}\\(${part.label}\\)`, 'i').test(sourceLabel)) {
      throw new Error(`Question label drifted while testing Q${sourceCase.number}(${part.label}): ${sourceLabel}`)
    }
    const meta = (await page.locator('.qp-question__meta').innerText()).replace(/\s+/g, ' ').trim()
    if (!new RegExp(`\\b${part.marks}\\s+marks?\\b`, 'i').test(meta)) {
      throw new Error(`Q${sourceCase.number}(${part.label}) mark allocation is not visible or correct: ${meta}`)
    }
    totalMarks += part.marks
    evidence.parts.push({ label: part.label, marks: part.marks, sourceLabel })
  }
  const expectedMarks = sourceCase.parts.reduce((sum, part) => sum + part.marks, 0)
  if (totalMarks !== expectedMarks) throw new Error(`Q${sourceCase.number} marks did not close: ${totalMarks}/${expectedMarks}`)

  await activateQuestionPart(page, sourceCase.number, sourceCase.parts[0].label)
  const renderedPages = page.locator('.qp-question-asset .source-region-renderer__page')
  await page.waitForFunction(() => document.querySelector('.qp-question-asset')?.getAttribute('data-source-state') === 'ready')
  if (await renderedPages.count() !== sourceCase.sourcePages.length) throw new Error(`Q${sourceCase.number} did not join all source pages into one question`)
  for (const expectedPage of sourceCase.sourcePages) {
    await assertFocusedSource(page, sourceCase, expectedPage, viewport, evidence)
  }
  await verifySourceControls(page, sourceCase)

  const geometry = await page.evaluate(() => {
    const source = document.querySelector('.qp-question-asset')?.getBoundingClientRect()
    const answer = document.querySelector('.qp-question__answer-panel')?.getBoundingClientRect()
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      source,
      answer,
    }
  })
  if (geometry.scrollWidth > geometry.clientWidth + 1) throw new Error(`Q${sourceCase.number} has horizontal layout overflow at ${viewport.width}x${viewport.height}: ${JSON.stringify(geometry)}`)
  if (!viewport.mobile && overlap(geometry.source, geometry.answer)) throw new Error(`Q${sourceCase.number} source and answer surfaces overlap at desktop width: ${JSON.stringify(geometry)}`)
  return evidence
}

async function verifyReviewedSourceMatrix(browser) {
  const results = []
  for (const viewport of sourceQaViewports) {
    let context = null
    const phaseLabel = `source-matrix:${viewport.name}`
    console.log(`[qa:phase] start ${phaseLabel} deadlineMs=${VIEWPORT_DEADLINE_MS}`)
    try {
      await withDeadline(phaseLabel, async () => {
        context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.touch,
          deviceScaleFactor: viewport.touch ? 2 : 1,
        })
        await mockAnonymousIdentityExchange(context)
        const page = await context.newPage()
        page.setDefaultTimeout(20_000)
        const errors = []
        page.on('pageerror', (error) => errors.push(`pageerror:${error.message}`))
        page.on('console', (message) => {
          if (message.type() === 'error' && !/Failed to load resource: the server responded with a status of 401/i.test(message.text())) errors.push(`console:${message.text()}`)
        })
        page.on('response', (response) => {
          const expectedGuestIdentity = response.status() === 401 && /\/api\/auth\/status$/.test(new URL(response.url()).pathname)
          if (response.status() >= 400 && !expectedGuestIdentity) errors.push(`http:${response.status()} ${response.url()}`)
        })
        for (let repeat = 1; repeat <= sourceQaRepeats; repeat += 1) {
          for (const sourceCase of sourceQaCases) {
            const caseLabel = `${viewport.name}:Q${sourceCase.number}:${repeat}/${sourceQaRepeats}`
            const startedAt = Date.now()
            console.log(`[qa:source-gate] start ${caseLabel}`)
            const result = await withDeadline(caseLabel, () => verifyReviewedQuestion(page, sourceCase, viewport), CASE_DEADLINE_MS, () => closeWithDeadline(context, caseLabel))
            results.push(result)
            console.log(`[qa:source-gate] pass ${caseLabel} elapsedMs=${Date.now() - startedAt}`)
          }
        }
        if (errors.length) throw new Error(errors.join(' | '))
      }, VIEWPORT_DEADLINE_MS, () => closeWithDeadline(context, phaseLabel))
      console.log(`[qa:phase] pass ${phaseLabel}`)
    } finally {
      await closeWithDeadline(context, phaseLabel)
    }
  }
  return results
}

async function startReviewed0606Topic(page, topic) {
  const picker = page.locator('.student-route-picker').first()
  try {
    await picker.waitFor({ state: 'visible' })
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '')
    throw new Error(`0606 route picker did not render at ${page.url()}: ${body.replace(/\s+/g, ' ').slice(0, 500)}; ${error.message}`)
  }
  await picker.getByRole('tab', { name: 'IGCSE', exact: true }).click()
  await picker.getByRole('combobox', { name: 'Current course' }).selectOption('cie-0606-igcse-additional-mathematics')
  await page.getByRole('button', { name: 'Choose another topic' }).click()
  const rows = page.locator('.topic-directory__row')
  await rows.first().waitFor({ state: 'visible' })
  const rowCount = await rows.count()
  let topicRow = null
  for (let index = 0; index < rowCount; index += 1) {
    const candidate = rows.nth(index)
    const lines = (await candidate.innerText()).split(/\r?\n/).map((line) => line.trim())
    if (lines.some((line) => line.toLowerCase() === topic.toLowerCase() || line.toLowerCase().includes(topic.toLowerCase()))) {
      topicRow = candidate
      break
    }
  }
  if (!topicRow) throw new Error(`Could not find the exact 0606 ${topic} syllabus row; observed=${JSON.stringify(await rows.allInnerTexts())}`)
  await topicRow.click()
  const start = page.getByRole('button', { name: /Start set|Practice \d+|Start (?:checked|verified) sample/i }).first()
  await start.waitFor()
  if (await start.isDisabled()) throw new Error(`0606 ${topic} has no enabled reviewed source sample`)
  await start.click()
  await page.waitForSelector('.session-setup, .question-block')
  if (await page.locator('.session-setup').count()) await page.getByRole('button', { name: /Start session/i }).click()
  await page.locator('.question-block').waitFor()
}

async function verifyReviewed0606Source(browser) {
  const results = []
  const viewports = VIEWPORTS.filter((viewport) => ['desktop', 'ipad-portrait'].includes(viewport.name))
  const phaseLabel = 'source-matrix-0606'
  console.log(`[qa:phase] start ${phaseLabel} deadlineMs=${VIEWPORT_DEADLINE_MS}`)
  let context = null
  try {
    await withDeadline(phaseLabel, async () => {
      for (const viewport of viewports) {
        context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          isMobile: viewport.mobile,
          hasTouch: viewport.touch,
          deviceScaleFactor: viewport.touch ? 2 : 1,
        })
        await mockAnonymousIdentityExchange(context)
        const page = await context.newPage()
        page.setDefaultTimeout(20_000)
        const pdfResponses = []
        const fallbackAssetResponses = []
        const errors = []
        page.on('response', (response) => {
          const pathname = new URL(response.url()).pathname
          if (pathname === sourcePdfFor0606()) pdfResponses.push({ url: pathname, status: response.status() })
          if (pathname.startsWith('/question-assets/cie-0606-')) fallbackAssetResponses.push({ url: pathname, status: response.status() })
          if (response.status() >= 400 && !/\/api\/auth\/status$/.test(new URL(response.url()).pathname)) {
            let requestContext = ''
            if (response.url().includes('/api/stem/practice-sets/rebind')) {
              const unit = response.request().postDataJSON()?.unit
              requestContext = ` unit=${JSON.stringify({ id: unit?.id, routeId: unit?.routeId, syllabusTopic: unit?.syllabusTopic, sourceGateStatus: unit?.sourceGateStatus, routeBindingReason: unit?.routeBindingReason, stage: unit?.stage, qualification: unit?.qualification, subject: unit?.subject, subjectId: unit?.subjectId, paperComponent: unit?.paperComponent })}`
            }
            errors.push(`http:${response.status()} ${response.url()}${requestContext}`)
          }
        })
        page.on('pageerror', (error) => errors.push(`pageerror:${error.message}`))
        for (const sourceCase of REVIEWED_0606_SOURCE_CASES) {
          await clearBrowserState(page)
          await startReviewed0606Topic(page, sourceCase.topic)
          await activateQuestionPart(page, sourceCase.number, sourceCase.parts[0])
          const evidence = {
            questionId: `cie-0606-0606_m25_qp_12:q${sourceCase.number}`,
            viewport: `${viewport.width}x${viewport.height}`,
            pages: [],
          }
          const figure = page.locator('.qp-question-asset')
          await figure.waitFor({ state: 'visible' })
          await page.waitForFunction(() => document.querySelector('.qp-question-asset')?.getAttribute('data-source-state') === 'ready')
          if (await figure.getAttribute('data-source-view') !== 'pdf-regions') throw new Error(`0606 Q${sourceCase.number} must render from source PDF regions`)
          if (await figure.locator('.source-region-renderer__page').count() !== sourceCase.pages.length) throw new Error(`0606 Q${sourceCase.number} did not join every source page`)
          for (const pageNumber of sourceCase.pages) {
            const image = figure.locator(`.source-region-renderer__page[data-source-page="${pageNumber}"] img`)
            await image.waitFor({ state: 'visible' })
            const metrics = await image.evaluate((element) => ({
              src: element.getAttribute('src') || '',
              complete: element.complete,
              naturalWidth: element.naturalWidth,
              naturalHeight: element.naturalHeight,
              exactRegion: element.closest('.source-region-renderer__page')?.getAttribute('data-exact-region') || '',
            }))
            if (!metrics.complete || metrics.naturalWidth <= 0 || metrics.naturalHeight <= 0 || !metrics.src.startsWith('blob:') || metrics.exactRegion !== 'false') {
              throw new Error(`0606 Q${sourceCase.number} p.${pageNumber} did not decode its complete PDF page fallback: ${JSON.stringify(metrics)}`)
            }
            const toolbar = (await figure.locator('.qp-question-asset__toolbar').innerText()).replace(/\s+/g, ' ').trim()
            if (!/Complete question.*source pages?/i.test(toolbar)) throw new Error(`0606 Q${sourceCase.number} page toolbar mismatch: ${toolbar}`)
            evidence.pages.push({ page: pageNumber, sourcePdf: sourcePdfFor0606(), decoded: `${metrics.naturalWidth}x${metrics.naturalHeight}` })
            const screenshot = path.join(ARTIFACT_DIR, `source-gate-0606-q${sourceCase.number}-${viewport.name}-qp-${String(pageNumber).padStart(2, '0')}.png`)
            await image.screenshot({ path: screenshot })
            evidence.pages.at(-1).screenshot = screenshot
          }
          if (!pdfResponses.some((response) => response.url === sourcePdfFor0606() && [200, 206].includes(response.status))) throw new Error(`0606 Q${sourceCase.number} did not request its checksum-gated source PDF`)
          const geometry = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            source: document.querySelector('.qp-question-asset')?.getBoundingClientRect(),
            answer: document.querySelector('.qp-question__answer-panel')?.getBoundingClientRect(),
          }))
          if (geometry.scrollWidth > geometry.clientWidth + 1) throw new Error(`0606 Q${sourceCase.number} overflows horizontally: ${JSON.stringify(geometry)}`)
          if (!viewport.mobile && overlap(geometry.source, geometry.answer)) throw new Error(`0606 Q${sourceCase.number} source and answer surfaces overlap: ${JSON.stringify(geometry)}`)
          results.push({ ...evidence, pdfResponses: pdfResponses.slice(), errors: errors.slice() })
        }
        if (fallbackAssetResponses.length) throw new Error(`0606 healthy PDF rendering requested legacy JPG fallbacks: ${JSON.stringify(fallbackAssetResponses)}`)
        if (errors.length) throw new Error(errors.join(' | '))
        await closeWithDeadline(context, `0606 ${viewport.name}`)
        context = null
      }
    }, VIEWPORT_DEADLINE_MS, () => closeWithDeadline(context, phaseLabel))
    console.log(`[qa:phase] pass ${phaseLabel}`)
  } finally {
    await closeWithDeadline(context, phaseLabel)
  }
  return results
}

async function verifyRequiredAssetFailure(browser) {
  let context = null
  const phaseLabel = 'required-asset-failure'
  console.log(`[qa:phase] start ${phaseLabel} deadlineMs=${ASSET_FAILURE_DEADLINE_MS}`)
  try {
    const result = await withDeadline(phaseLabel, async () => {
      context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      await mockAnonymousIdentityExchange(context)
      const blockedPdf = sourcePdfFor0580()
      const blockedAsset = '/question-assets/cie-0580-0580_m25_qp_12/qp-04.jpg'
      const markingRequests = []
      await context.route(`**${blockedPdf}`, async (route) => {
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'QA-only unavailable source PDF' })
      })
      await context.route(`**${blockedAsset}`, async (route) => {
        await route.fulfill({ status: 404, contentType: 'text/plain', body: 'QA-only missing official source asset' })
      })
      const page = await context.newPage()
      page.on('request', (request) => {
        if (/\/api\/(?:ai\/mark|stem\/marking)/.test(request.url())) markingRequests.push(request.url())
      })
      await clearBrowserState(page)
      await startReviewedTopic(page, 'Geometry')
      await activateQuestionPart(page, 5, 'a')
      const incomplete = page.locator('.source-region-renderer__status--error')
      await incomplete.waitFor()
      const text = (await incomplete.innerText()).replace(/\s+/g, ' ').trim()
      if (!/could not be rendered|could not be loaded|blocked/i.test(text)) throw new Error(`Required source failure does not explain the blocked state: ${text}`)
      if (await page.locator('.handwriting-pad, .qp-numeric-entry, .qp-mcq-answer').count()) throw new Error('A source-incomplete question still exposes an answer surface')
      const submit = page.getByRole('button', { name: /^Submit$/ })
      if (!await submit.isDisabled()) throw new Error('A source-incomplete practice unit still enables submission')
      if (await page.getByRole('button', { name: /Record self-mark/i }).count()) throw new Error('A source-incomplete question exposes self-mark recording')
      const persisted = await page.evaluate((key) => {
        const state = JSON.parse(localStorage.getItem(key) || '{}')
        return {
          attempts: (state.attempts || []).map((attempt) => ({
            id: attempt.id,
            status: attempt.attemptStatus,
            score: attempt.scoreResult || null,
          })),
          events: state.learningEvents || [],
          progress: state.progress || null,
        }
      }, STORAGE_KEY)
      if (persisted.attempts.some((attempt) => attempt.score) || persisted.events.length) {
        throw new Error(`A source-incomplete question polluted scoring or learning events: ${JSON.stringify(persisted)}`)
      }
      if (markingRequests.length) throw new Error(`A source-incomplete question requested marking: ${JSON.stringify(markingRequests)}`)
      const screenshot = path.join(ARTIFACT_DIR, 'source-gate-required-asset-404.png')
      await page.screenshot({ path: screenshot, fullPage: false })
      return { blockedPdf, blockedAsset, screenshot, attemptCount: persisted.attempts.length, learningEvents: persisted.events.length, markingRequests: markingRequests.length }
    }, ASSET_FAILURE_DEADLINE_MS, () => closeWithDeadline(context, phaseLabel))
    console.log(`[qa:phase] pass ${phaseLabel}`)
    return result
  } finally {
    await closeWithDeadline(context, phaseLabel)
  }
}

async function drawTwoPenStrokes(canvas) {
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Handwriting canvas has no visible geometry')
  const pathA = [
    { x: box.x + 54, y: box.y + 80 },
    { x: box.x + 96, y: box.y + 94 },
    { x: box.x + 138, y: box.y + 112 },
  ]
  const pathB = [
    { x: box.x + 66, y: box.y + 142 },
    { x: box.x + 108, y: box.y + 128 },
    { x: box.x + 154, y: box.y + 145 },
  ]
  async function pathStroke(points, pointerId) {
    await canvas.dispatchEvent('pointerdown', { pointerType: 'pen', pointerId, isPrimary: true, buttons: 1, pressure: 0.5, clientX: points[0].x, clientY: points[0].y })
    for (const point of points.slice(1)) await canvas.dispatchEvent('pointermove', { pointerType: 'pen', pointerId, isPrimary: true, buttons: 1, pressure: 0.7, clientX: point.x, clientY: point.y })
    const end = points.at(-1)
    await canvas.dispatchEvent('pointerup', { pointerType: 'pen', pointerId, isPrimary: true, buttons: 0, pressure: 0, clientX: end.x, clientY: end.y })
  }
  await pathStroke(pathA, 701)
  await pathStroke(pathB, 702)
  const metrics = await canvas.evaluate((element) => ({
    strokes: Number(element.dataset.strokeCount || 0),
    segments: Number(element.dataset.segmentCount || 0),
    dots: Number(element.dataset.dotCount || 0),
    maxGap: Number(element.dataset.maxSegmentGap || 0),
  }))
  if (metrics.strokes < 2 || metrics.segments < 4 || metrics.dots !== 0 || metrics.maxGap > 0.01) {
    throw new Error(`Pencil strokes were not continuously accumulated: ${JSON.stringify(metrics)}`)
  }
  return metrics
}

async function verifyFullPaperInk(browser) {
  let context = null
  const phaseLabel = 'full-paper-ink'
  console.log(`[qa:phase] start ${phaseLabel} deadlineMs=${FULL_PAPER_DEADLINE_MS}`)
  try {
    const result = await withDeadline(phaseLabel, async () => {
      context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
      await mockAnonymousIdentityExchange(context)
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
      await page.evaluate(() => localStorage.clear())
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Practice$/ }).click()
      const picker = page.locator('.practice-hub .student-route-picker')
      await picker.getByRole('tab', { name: 'AS', exact: true }).click()
      await picker.getByRole('combobox', { name: 'Current course' }).selectOption('cie-9709-as-p1-p2')
      await page.getByRole('button', { name: /^Past Papers$/ }).click()
      await page.locator('.paper-search input').fill('9709/12 2025')
      await page.locator('.paper-table tbody tr').filter({ hasText: '9709/12' }).filter({ hasText: 'Mar 2025' }).first().getByRole('button', { name: 'Open' }).click()
      await page.locator('.paper-workspace').waitFor()
      const labels = await page.locator('.paper-answer-sheet__index a').evaluateAll((links) => links.map((link) => link.getAttribute('aria-label')))
      if (labels.length !== 11 || labels.at(-1) !== 'Question 11, Not answered') throw new Error(`9709 P1 answer slots are incorrect: ${JSON.stringify(labels)}`)
      const writeToggle = page.getByRole('button', { name: 'Annotate PDF' })
      if (await writeToggle.getAttribute('aria-pressed') !== 'true') await writeToggle.click()
      const canvas = page.locator('.pdf-ink-layer').first()
      await canvas.waitFor()
      const metrics = await drawTwoPenStrokes(canvas)
      const pan = await page.getByRole('button', { name: 'PDF hand' })
      await pan.click()
      const panStyle = await canvas.evaluate((element) => ({ pointerEvents: getComputedStyle(element).pointerEvents, touchAction: getComputedStyle(element).touchAction }))
      if (panStyle.pointerEvents !== 'none' || !panStyle.touchAction.includes('pan-y')) throw new Error(`PDF hand mode does not release finger scrolling: ${JSON.stringify(panStyle)}`)
      if (errors.length) throw new Error(errors.join(' | '))
      const screenshot = path.join(ARTIFACT_DIR, 'source-gate-9709-ipad-landscape.png')
      await page.screenshot({ path: screenshot, fullPage: false })
      return { screenshot, metrics, panStyle }
    }, FULL_PAPER_DEADLINE_MS, () => closeWithDeadline(context, phaseLabel))
    console.log(`[qa:phase] pass ${phaseLabel}`)
    return result
  } finally {
    await closeWithDeadline(context, phaseLabel)
  }
}

async function run() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  const qaServer = await startQaServer()
  let browser = null
  try {
    console.log('[qa:phase] start browser-launch deadlineMs=30000')
    browser = await withDeadline('browser launch', () => chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true }), 30_000)
    console.log('[qa:phase] pass browser-launch')
    const reviewedSources = await verifyReviewedSourceMatrix(browser)
    const reviewed0606Sources = await verifyReviewed0606Source(browser)
    const requiredAssetFailure = await verifyRequiredAssetFailure(browser)
    const paper = await verifyFullPaperInk(browser)
    console.log(JSON.stringify({ reviewedSources, reviewed0606Sources, requiredAssetFailure, fullPaper: paper }, null, 2))
  } finally {
    await closeWithDeadline(browser, 'browser')
    await qaServer.cleanup()
  }
}

run().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
