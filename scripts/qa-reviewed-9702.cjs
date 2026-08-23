const crypto = require('crypto')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { chromium } = require('D:/CodexWork/node_modules/playwright-core')

const ROOT = path.resolve(__dirname, '..')
const ARTIFACT_DIR = 'D:/CodexWork/qa-artifacts/alevel-learning-platform'
const QA_SIGNING_KEY = 'qa-reviewed-9702-identity-signing-key'
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
  { name: 'ipad-portrait', width: 820, height: 1180, isMobile: true, hasTouch: true },
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
]
const CASES = [
  { topic: 'Dynamics', question: 'Q3', paper: 'M25/12', page: 3, visual: 'graph', componentMode: 'p1' },
  // Q7's shared stem starts above its diagram. Keep an explicit upper bound
  // so a visually clean crop cannot silently drop the question number/stem.
  { topic: 'Dynamics', question: 'Q7', paper: 'M25/12', page: 4, visual: 'diagram', focusTopAtMost: 570, componentMode: 'p1' },
  { topic: 'Physical quantities and units', question: 'Q2', paper: 'S25/11', page: 3, visual: 'table', componentMode: 'p1' },
  { topic: 'Work, energy and power', question: 'Q18', paper: 'S25/11', page: 9, visual: 'diagram', componentMode: 'p1' },
  { topic: 'Forces, density and pressure', question: 'Q2', paper: 'M25/22', pages: [4, 5, 6], visual: 'multi-page diagram and graph', componentMode: 'p2', requestedCount: 5, expectedAvailableCount: 10, expectedGroupCount: 5, expectedComponent: 2, expectedParts: 5, expectedMarks: 10 },
]
const CASE_TIMEOUT = 45_000
const SERVER_TIMEOUT = 30_000
const CLEANUP_TIMEOUT = 10_000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withDeadline(label, task, timeoutMs, onTimeout) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(async () => {
      try { await onTimeout?.() } catch { /* Keep the original deadline as the failure. */ }
      reject(new Error(`${label} exceeded ${timeoutMs}ms`))
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
    await withDeadline(`${label} cleanup`, () => resource.close(), CLEANUP_TIMEOUT)
  } catch (error) {
    console.warn(`[qa:9702:cleanup] ${label}: ${error.message}`)
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForServer(url, child) {
  while (child.exitCode == null) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
    } catch { /* Vite is still starting. */ }
    await sleep(100)
  }
  throw new Error(`isolated Vite exited before readiness (${child.exitCode})`)
}

async function stopProcess(child) {
  if (!child || child.exitCode != null) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    await withDeadline('isolated Vite termination', () => new Promise((resolve) => {
      killer.once('close', resolve)
      killer.once('error', resolve)
    }), CLEANUP_TIMEOUT)
    return
  }
  child.kill('SIGTERM')
  await withDeadline('isolated Vite termination', () => new Promise((resolve) => {
    child.once('close', resolve)
    child.once('exit', resolve)
  }), CLEANUP_TIMEOUT).catch(() => {})
}

async function removeTempDir(directory) {
  const deadline = Date.now() + CLEANUP_TIMEOUT
  let lastError
  while (Date.now() < deadline) {
    try {
      fs.rmSync(directory, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
      await sleep(100)
    }
  }
  console.warn(`[qa:9702:cleanup] temporary database directory could not be removed: ${lastError?.message || directory}`)
}

async function startServer() {
  const port = await findFreePort()
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alevel-learning-platform-9702-qa-'))
  const databasePath = path.join(databaseDir, 'stem.sqlite')
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, BROWSER: 'none', STEM_DB_PATH: databasePath, STEM_SESSION_SECURE: '0', STEM_IDENTITY_SIGNING_KEY: QA_SIGNING_KEY },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const url = `http://127.0.0.1:${port}/`
  let output = ''
  child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-8_000) })
  child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-8_000) })
  try {
    await withDeadline(`isolated Vite start ${url}`, () => waitForServer(url, child), SERVER_TIMEOUT, () => stopProcess(child))
  } catch (error) {
    await stopProcess(child)
    await removeTempDir(databaseDir)
    throw new Error(`${error.message}\n${output}`)
  }
  console.log(`[qa:9702] isolated server ready at ${url}`)
  return {
    url,
    cleanup: async () => {
      await stopProcess(child)
      await removeTempDir(databaseDir)
      console.log('[qa:9702] isolated server stopped')
    },
  }
}

async function resetPage(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.account-trigger[aria-label="Account: qa_9702_student"]').waitFor({ state: 'attached' })
  await page.locator('.student-home-guided .student-route-picker').waitFor({ state: 'visible' })
}

function qaAuthStatus() {
  const now = Math.floor(Date.now() / 1000)
  const identity = { id: 'ielts:9702', username: 'qa_9702_student', avatarDataUrl: '', roles: ['student'], workspaceRoles: ['student'] }
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com',
    aud: 'stem.ieltsist.com',
    sub: identity.id,
    username: identity.username,
    avatarDataUrl: '',
    roles: identity.roles,
    workspaceRoles: identity.workspaceRoles,
    iat: now,
    exp: now + 600,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', QA_SIGNING_KEY).update(`${header}.${payload}`).digest('base64url')
  return { authenticated: true, identity, accessToken: `${header}.${payload}.${signature}`, expiresAt: new Date((now + 600) * 1000).toISOString(), classrooms: [], assignments: [] }
}

async function mockCoachHistory(page) {
  const conversations = new Map()
  await page.route('**/api/stem/coach/conversations**', async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversations: [...conversations.values()] }) })
    }
    if (!['PUT', 'POST'].includes(method)) return route.continue()
    let payload = {}
    try {
      payload = JSON.parse(route.request().postData() || '{}')
    } catch {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Invalid Coach history fixture payload.' }) })
    }
    const incoming = Array.isArray(payload.conversations) ? payload.conversations : payload.conversation ? [payload.conversation] : []
    incoming.filter((conversation) => conversation?.conversationId).forEach((conversation) => conversations.set(conversation.conversationId, conversation))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversations: incoming }) })
  })
}

async function openTopic(page, testCase) {
  const hasReadyInventory = (text) => /source-backed question|official question|verified question|checked question/i.test(text)
  const topic = testCase.topic
  const picker = page.locator('.student-home-guided .student-route-picker')
  await picker.getByRole('tab', { name: 'AS', exact: true }).click()
  const course = picker.getByRole('combobox', { name: 'Current course' })
  await course.selectOption('cie-9702-as-physics')
  if (await course.inputValue() !== 'cie-9702-as-physics') throw new Error('9702 browser flow selected the wrong route')
  await page.getByRole('button', { name: 'Choose another topic' }).click()
  await page.waitForFunction((topicName) => [...document.querySelectorAll('.topic-directory__row')]
    .some((element) => {
      const title = element.querySelector('.topic-directory__copy strong')?.textContent?.trim().replace(/^\d+\s+/, '')
      return title === topicName && /source-backed question|official question|verified question|checked question/i.test(element.textContent)
    }), topic, { timeout: 12_000 })
  const candidates = page.locator('.topic-directory__row').filter({ hasText: topic })
  let row = null
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index)
    if (await candidate.isVisible() && hasReadyInventory(await candidate.textContent())) {
      row = candidate
      break
    }
  }
  if (!row) throw new Error(`No visible ${topic} topic row with a verified inventory was found: ${JSON.stringify(await candidates.allInnerTexts())}`)
  const rowText = (await row.textContent()).replace(/\s+/g, ' ').trim()
  if (!hasReadyInventory(rowText)) throw new Error(`9702 topic row did not expose a real inventory: ${rowText}`)
  await row.click()
  await page.locator('.topic-detail').waitFor({ state: 'visible' })
  const sourceRows = page.locator('.topic-detail__question-row p')
  const previews = await sourceRows.allTextContents()
  if (previews.length && previews.some((text) => !/^Official source image · QP p\./.test(text.trim()))) {
    throw new Error(`Topic detail exposed OCR instead of source metadata: ${JSON.stringify(previews)}`)
  }
  if (testCase.componentMode || testCase.requestedCount) {
    const customSet = page.locator('details.topic-detail__set-controls')
    if (await customSet.count() && !await customSet.evaluate((element) => element.open)) await customSet.locator('summary').click()
  }
  if (testCase.componentMode) {
    const componentSelect = page.getByRole('combobox', { name: 'Paper components' })
    await componentSelect.selectOption(testCase.componentMode)
    if (await componentSelect.inputValue() !== testCase.componentMode) throw new Error(`${topic} did not retain the selected ${testCase.componentMode.toUpperCase()} mode`)
  }
  if (testCase.requestedCount) {
    const countSelect = page.getByRole('combobox', { name: 'Question count' })
    await countSelect.selectOption(String(testCase.requestedCount))
    if (Number(await countSelect.inputValue()) !== testCase.requestedCount) throw new Error(`${topic} did not retain the requested ${testCase.requestedCount}-question set size`)
  }
  if (testCase.expectedGroupCount) {
    const summary = (await page.locator('.topic-detail__start').innerText()).replace(/\s+/g, ' ')
    const expectedAvailableCount = testCase.expectedAvailableCount || testCase.expectedGroupCount
    if (!summary.includes(`${expectedAvailableCount} official P2 questions`)) throw new Error(`${topic} component-aware summary is stale: ${summary}`)
  }
  const start = page.locator('.topic-detail__start .primary-action').first()
  await start.waitFor({ state: 'visible' })
  if (await start.isDisabled()) throw new Error(`9702 ${topic} practice CTA is disabled despite reviewed inventory`)
  const startHitTarget = await start.evaluate((button) => {
    button.scrollIntoView({ block: 'center', inline: 'nearest' })
    const rect = button.getBoundingClientRect()
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    const serializeRect = (element) => element ? (() => {
      const bounds = element.getBoundingClientRect()
      return { top: Math.round(bounds.top), bottom: Math.round(bounds.bottom), left: Math.round(bounds.left), right: Math.round(bounds.right) }
    })() : null
    return {
      reachable: target === button || target?.closest('button') === button,
      target: target ? `${target.tagName.toLowerCase()}.${target.className || ''}` : 'none',
      buttonRect: serializeRect(button),
      railRect: serializeRect(button.closest('.topic-detail__rail')),
      mainRect: serializeRect(document.querySelector('.topic-detail__layout > main')),
      targetRect: serializeRect(target),
    }
  })
  if (!startHitTarget.reachable) throw new Error(`9702 ${topic} start CTA is visually obstructed: ${JSON.stringify(startHitTarget)}`)
  const practiceResponsePromise = testCase.expectedComponent
    ? page.waitForResponse((response) => response.url().includes('/api/stem/practice-sets') && response.request().method() === 'POST')
    : null
  await start.click()
  if (practiceResponsePromise) {
    const practiceResponse = await practiceResponsePromise
    const requestBody = practiceResponse.request().postDataJSON()
    const responseBody = await practiceResponse.json()
    if (requestBody.questionCount !== testCase.requestedCount || requestBody.components?.length !== 1 || requestBody.components[0] !== testCase.expectedComponent) {
      throw new Error(`${topic} discarded the requested practice filters: ${JSON.stringify(requestBody)}`)
    }
    if (responseBody.questionCount !== testCase.expectedGroupCount || responseBody.questionGroups?.some((group) => group.paperComponent !== testCase.expectedComponent)) {
      throw new Error(`${topic} API returned a mixed or incorrectly sized set: ${JSON.stringify({ questionCount: responseBody.questionCount, components: responseBody.questionGroups?.map((group) => group.paperComponent) })}`)
    }
  }
  try {
    await page.waitForFunction(() => document.querySelector('.session-setup, .question-block'))
  } catch (error) {
    throw new Error(`${error.message}; startError=${JSON.stringify(await page.locator('.topic-detail__error').allTextContents())}; account=${JSON.stringify(await page.locator('.account-trigger').allTextContents())}; url=${page.url()}`)
  }
  if (await page.locator('.session-setup').isVisible().catch(() => false)) await page.getByRole('button', { name: /Start session/i }).click()
  await page.locator('.question-block').waitFor({ state: 'visible' })
  if (testCase.expectedGroupCount) {
    const workspaceSummary = (await page.locator('.qp-header__title span').innerText()).replace(/\s+/g, ' ')
    const workspaceQuestionCount = Number(workspaceSummary.match(/^(\d+) official questions\b/)?.[1])
    if (workspaceQuestionCount !== testCase.expectedGroupCount) throw new Error(`${topic} workspace started the wrong set: ${workspaceSummary}`)
  }
}

async function activateQuestion(page, question, paper) {
  const buttons = page.locator('.qp-index__list button')
  const identities = []
  for (let index = 0; index < await buttons.count(); index += 1) {
    const button = buttons.nth(index)
    const identity = await button.getAttribute('data-source-question')
    identities.push(identity)
    if (!identity?.includes(`${paper} · ${question}(`)) continue
    await button.click()
    await page.locator('.qp-source-label strong').filter({ hasText: `${paper} · ${question}(` }).waitFor({ state: 'visible' })
    return page.locator('.qp-source-label strong').innerText()
  }
  throw new Error(`Could not activate ${question}; navigation=${JSON.stringify(identities)}`)
}

async function sourceEdgeInk(figure) {
  return figure.locator('img').evaluate((image) => {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(image, 0, 0)
    const width = canvas.width
    const height = canvas.height
    const strip = 1
    const ink = (x, y, width, height) => {
      const data = context.getImageData(x, y, width, height).data
      let count = 0
      for (let index = 0; index < data.length; index += 4) {
        if (data[index] < 180 || data[index + 1] < 180 || data[index + 2] < 180) count += 1
      }
      return count / Math.max(1, data.length / 4)
    }
    return {
      top: ink(0, 0, width, strip),
      right: ink(width - strip, 0, strip, height),
      bottom: ink(0, height - strip, width, strip),
      left: ink(0, 0, strip, height),
    }
  })
}

function paperAssetFolder(testCase) {
  const [season, number] = String(testCase.paper).split('/')
  return `cie-9702-9702_${String(season || '').toLowerCase()}_qp_${number}`
}

function paperPdfUrl(testCase) {
  const [season, number] = String(testCase.paper).split('/')
  return `/local-pdf/9702/9702_${String(season || '').toLowerCase()}_qp_${number}.pdf`
}

async function verifyQuestion(page, testCase, viewport, responses) {
  const label = await activateQuestion(page, testCase.question, testCase.paper)
  const expectedLabel = new RegExp(`${testCase.paper.replace('/', '\\/')}.*${testCase.question}\\(`, 'i')
  if (!expectedLabel.test(label)) throw new Error(`Question identity drifted: ${label}`)
  const figure = page.locator('.qp-question-asset')
  await figure.waitFor({ state: 'visible' })
  await figure.scrollIntoViewIfNeeded()
  if (await figure.getAttribute('data-source-view') !== 'focused') throw new Error(`${testCase.question} did not default to the reviewed crop`)
  await page.waitForFunction(() => document.querySelector('.qp-question-asset')?.getAttribute('data-source-state') === 'ready')
  const image = figure.locator(`.source-region-renderer__page[data-source-page="${testCase.page}"] img`)
  await image.waitFor({ state: 'visible' })
  await image.evaluate((element) => { if (!element.complete || element.naturalWidth <= 0) throw new Error('source image is not decoded') })
  const metrics = await image.evaluate((element) => ({
    src: element.getAttribute('src'),
    width: element.naturalWidth,
    height: element.naturalHeight,
    renderedWidth: Math.round(element.getBoundingClientRect().width),
    renderedHeight: Math.round(element.getBoundingClientRect().height),
    sourceView: element.closest('.qp-question-asset')?.getAttribute('data-source-view'),
    safety: element.closest('.qp-question-asset')?.getAttribute('data-focus-safety'),
    region: element.closest('.qp-question-asset')?.getAttribute('data-focus-region'),
    margin: element.closest('.qp-question-asset')?.getAttribute('data-focus-margin'),
    state: element.closest('.qp-question-asset')?.getAttribute('data-source-state'),
    sourcePage: element.closest('.source-region-renderer__page')?.getAttribute('data-source-page'),
    exactRegion: element.closest('.source-region-renderer__page')?.getAttribute('data-exact-region'),
  }))
  const expectedPdf = paperPdfUrl(testCase)
  if (!metrics.src?.startsWith('blob:') || metrics.width <= 0 || metrics.height <= 0 || metrics.state !== 'ready' || Number(metrics.sourcePage) !== testCase.page || metrics.exactRegion !== 'true') {
    throw new Error(`${testCase.question} PDF crop mismatch: ${JSON.stringify({ metrics, expectedPdf })}`)
  }
  if (!responses.some((response) => response.url === expectedPdf && [200, 206].includes(response.status))) throw new Error(`${testCase.question} did not load ${expectedPdf}`)
  if (metrics.safety !== 'reviewed-display-bounds-v1' || !metrics.region || !metrics.margin) throw new Error(`${testCase.question} missing reviewed crop bounds: ${JSON.stringify(metrics)}`)
  const focusRegion = String(metrics.region).split(',').map(Number)
  if (Number.isFinite(testCase.focusTopAtMost) && (!Number.isFinite(focusRegion[1]) || focusRegion[1] > testCase.focusTopAtMost)) {
    throw new Error(`${testCase.question} focused crop starts below the reviewed question stem: ${JSON.stringify({ focusRegion, focusTopAtMost: testCase.focusTopAtMost })}`)
  }
  const screenshot = path.join(ARTIFACT_DIR, `qa-9702-${testCase.question.toLowerCase()}-${viewport.name}-focused.png`)
  await figure.screenshot({ path: screenshot })
  const edgeInk = await sourceEdgeInk(figure)
  if (!edgeInk || Object.values(edgeInk).some((ratio) => ratio > 0.02)) throw new Error(`${testCase.question} crop touches printed content at an edge: ${JSON.stringify({ edgeInk, metrics })}`)
  if (await page.getByText(/\[(?:graph|diagram|figure|image|table|chart)\s*:/i).count()) throw new Error(`${testCase.question} exposed a raw visual placeholder`)
  if (page.url().includes('cie-9702-a2') || page.url().includes('component=3')) throw new Error('9702 AS practice leaked into A2 or practical mode')
  const originalLink = figure.locator('xpath=following::a[contains(@class,"qp-original-paper-link")][1]')
  if (await originalLink.getAttribute('href') !== expectedPdf) throw new Error(`${testCase.question} original-paper link is not source-bound`)

  const geometry = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    source: document.querySelector('.qp-question__source-panel')?.getBoundingClientRect(),
    answer: document.querySelector('.qp-question__answer-panel')?.getBoundingClientRect(),
  }))
  if (geometry.scrollWidth > geometry.clientWidth + 1) throw new Error(`${testCase.question} has horizontal overflow: ${JSON.stringify(geometry)}`)
  if (viewport.width >= 1180 && (!geometry.source || !geometry.answer || geometry.source.width < 10 || geometry.answer.width < 10)) throw new Error(`${testCase.question} desktop source/answer work areas are not simultaneously usable`)
  return { id: `${paperAssetFolder(testCase)}:${testCase.question.toLowerCase()}`, topic: testCase.topic, visual: testCase.visual, viewport: `${viewport.width}x${viewport.height}`, sourcePdf: expectedPdf, decoded: `${metrics.width}x${metrics.height}`, edgeInk, screenshots: [screenshot], responses: responses.filter((item) => item.url === expectedPdf).map((item) => item.status) }
}

async function verifyFullPageQuestion(page, testCase, viewport, responses) {
  const label = await activateQuestion(page, testCase.question, testCase.paper)
  const expectedLabel = new RegExp(`${testCase.paper.replace('/', '\\/')}.*${testCase.question}\\(`, 'i')
  if (!expectedLabel.test(label)) throw new Error(`Question identity drifted: ${label}`)
  const groupParts = []
  const partCards = page.locator('.qp-answer-part[data-source-question]')
  for (let index = 0; index < await partCards.count(); index += 1) {
    const card = partCards.nth(index)
    const sourceLabel = await card.getAttribute('data-source-question') || ''
    if (!sourceLabel.startsWith(`${testCase.paper} · ${testCase.question}(`)) continue
    const markText = await card.locator('.qp-attempt-label small').innerText()
    groupParts.push({ sourceLabel, marks: Number(markText.match(/\d+/)?.[0] || 0) })
  }
  if (groupParts.length !== testCase.expectedParts) throw new Error(`${testCase.paper} ${testCase.question} exposed ${groupParts.length} parts instead of ${testCase.expectedParts}: ${JSON.stringify(groupParts)}`)
  const groupMarks = groupParts.reduce((sum, part) => sum + part.marks, 0)
  if (groupMarks !== testCase.expectedMarks) throw new Error(`${testCase.paper} ${testCase.question} exposed ${groupMarks} marks instead of ${testCase.expectedMarks}`)

  const figure = page.locator('.qp-question-asset')
  await figure.waitFor({ state: 'visible' })
  await figure.scrollIntoViewIfNeeded()
  await page.waitForFunction(() => document.querySelector('.qp-question-asset')?.getAttribute('data-source-state') === 'ready')
  if (await figure.getAttribute('data-source-view') !== 'pdf-regions') throw new Error(`${testCase.question} must use PDF regions when no reviewed display crop exists`)
  const renderedPages = figure.locator('.source-region-renderer__page')
  if (await renderedPages.count() !== testCase.pages.length) throw new Error(`${testCase.question} did not join every source page`)
  const screenshots = []
  const assets = []
  for (let index = 0; index < testCase.pages.length; index += 1) {
    const sourcePage = testCase.pages[index]
    const image = figure.locator(`.source-region-renderer__page[data-source-page="${sourcePage}"] img`)
    const metrics = await image.evaluate((element) => ({ src: element.getAttribute('src'), width: element.naturalWidth, height: element.naturalHeight, exactRegion: element.closest('.source-region-renderer__page')?.getAttribute('data-exact-region') }))
    if (!metrics.src?.startsWith('blob:') || metrics.width <= 0 || metrics.height <= 0 || metrics.exactRegion !== 'false') throw new Error(`${testCase.question} complete-page fallback mismatch: ${JSON.stringify({ sourcePage, metrics })}`)
    const screenshot = path.join(ARTIFACT_DIR, `qa-9702-${paperAssetFolder(testCase)}-${testCase.question.toLowerCase()}-${viewport.name}-qp-${String(testCase.pages[index]).padStart(2, '0')}.png`)
    await image.screenshot({ path: screenshot })
    screenshots.push(screenshot)
    assets.push({ page: sourcePage, decoded: `${metrics.width}x${metrics.height}` })
  }
  const expectedPdf = paperPdfUrl(testCase)
  if (!responses.some((response) => response.url === expectedPdf && [200, 206].includes(response.status))) throw new Error(`${testCase.question} did not load ${expectedPdf}`)
  if (await page.getByText(/\[(?:graph|diagram|figure|image|table|chart)\s*:/i).count()) throw new Error(`${testCase.question} exposed a raw visual placeholder`)
  if (page.url().includes('cie-9702-a2') || page.url().includes('component=3')) throw new Error('9702 P2 practice leaked into A2 or practical mode')

  const geometry = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    source: document.querySelector('.qp-question__source-panel')?.getBoundingClientRect(),
    answer: document.querySelector('.qp-question__answer-panel')?.getBoundingClientRect(),
  }))
  if (geometry.scrollWidth > geometry.clientWidth + 1) throw new Error(`${testCase.question} has horizontal overflow: ${JSON.stringify(geometry)}`)
  if (viewport.width >= 1180 && (!geometry.source || !geometry.answer || geometry.source.width < 10 || geometry.answer.width < 10)) throw new Error(`${testCase.question} desktop source/answer work areas are not simultaneously usable`)
  return { id: `${paperAssetFolder(testCase)}:${testCase.question.toLowerCase()}`, topic: testCase.topic, visual: testCase.visual, component: 2, viewport: `${viewport.width}x${viewport.height}`, parts: groupParts.length, marks: groupMarks, sourcePdf: expectedPdf, assets, screenshots }
}

async function run() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  const server = await startServer()
  let browser
  const results = []
  try {
    browser = await withDeadline('Chrome launch', () => chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true }), 30_000)
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.isMobile, hasTouch: viewport.hasTouch, deviceScaleFactor: viewport.hasTouch ? 2 : 1 })
      const page = await context.newPage()
      page.setDefaultTimeout(15_000)
      await page.route('**/api/auth/status', async (route) => {
        if (route.request().method() !== 'GET') return route.continue()
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaAuthStatus()) })
      })
      await mockCoachHistory(page)
      const responses = []
      const errors = []
      page.on('response', (response) => {
        const url = response.url()
        const status = response.status()
        if (url.includes('/local-pdf/9702/') && /\.pdf$/.test(new URL(url).pathname)) responses.push({ url: new URL(url).pathname, status })
        if (status >= 400 && !(status === 401 && url.endsWith('/api/auth/status'))) errors.push(`http:${status} ${url}`)
      })
      page.on('pageerror', (error) => errors.push(`pageerror:${error.message}`))
      page.on('console', (message) => {
        if (message.type() === 'error' && !/responded with a status of 401/i.test(message.text())) errors.push(`console:${message.text()}`)
      })
      for (const testCase of CASES) {
        const caseLabel = `${viewport.name}:${testCase.paper}:${testCase.question}`
        console.log(`[qa:9702] start ${caseLabel}`)
        const result = await withDeadline(caseLabel, async () => {
          await resetPage(page, server.url)
          await openTopic(page, testCase)
          return testCase.pages
            ? verifyFullPageQuestion(page, testCase, viewport, responses)
            : verifyQuestion(page, testCase, viewport, responses)
        }, CASE_TIMEOUT)
        results.push(result)
        console.log(`[qa:9702] pass ${caseLabel}`)
      }
      if (errors.length) throw new Error(`${viewport.name} browser errors: ${errors.join(' | ')}`)
      await closeWithDeadline(context, `context ${viewport.name}`)
    }
    console.log(JSON.stringify({ ok: true, cases: results }, null, 2))
  } finally {
    await closeWithDeadline(browser, 'browser')
    await server.cleanup()
  }
}

run().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
