const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { chromium } = require('D:/CodexWork/node_modules/playwright-core')

const ROOT = path.resolve(__dirname, '..')
const ARTIFACT_DIR = 'D:/CodexWork/qa-artifacts/alevel-learning-platform'
const QA_SIGNING_KEY = 'qa-student-hierarchy-identity-signing-key'
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, mobile: false, touch: false },
  { name: 'ipad-landscape', width: 1180, height: 820, mobile: true, touch: true },
  { name: 'ipad-portrait', width: 820, height: 1180, mobile: true, touch: true },
  { name: 'mobile', width: 390, height: 844, mobile: true, touch: true },
]

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
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

async function stopProcess(child) {
  if (!child || child.exitCode != null) return
  if (process.platform === 'win32') {
    const taskkill = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    await new Promise((resolve) => {
      taskkill.once('close', resolve)
      taskkill.once('error', resolve)
    })
    return
  }
  child.kill('SIGTERM')
}

async function removeTempDir(directory) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    try {
      fs.rmSync(directory, { recursive: true, force: true })
      return
    } catch {
      await sleep(100)
    }
  }
  console.warn(`[qa:student-hierarchy] temporary database directory could not be removed: ${directory}`)
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 30_000
  while (child.exitCode == null && Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
    } catch {
      // Vite has not finished starting.
    }
    await sleep(100)
  }
  throw new Error(`isolated Vite did not become ready at ${url}`)
}

async function startServer() {
  const port = await findFreePort()
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alevel-learning-platform-student-hierarchy-'))
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    env: {
      ...process.env,
      BROWSER: 'none',
      STEM_DB_PATH: path.join(databaseDir, 'stem.sqlite'),
      STEM_SESSION_SECURE: '0',
      STEM_IDENTITY_SIGNING_KEY: QA_SIGNING_KEY,
    },
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  })
  const url = `http://127.0.0.1:${port}/`
  try {
    await waitForServer(url, child)
  } catch (error) {
    await stopProcess(child)
    await removeTempDir(databaseDir)
    throw error
  }
  return {
    url,
    async cleanup() {
      await stopProcess(child)
      await removeTempDir(databaseDir)
    },
  }
}

function qaAuthStatus() {
  const now = Math.floor(Date.now() / 1000)
  const identity = { id: 'ielts:9703', username: 'qa_student', avatarDataUrl: '', roles: ['student'], workspaceRoles: ['student'] }
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss: 'ieltsist.com', aud: 'stem.ieltsist.com', sub: identity.id, username: identity.username,
    roles: identity.roles, workspaceRoles: identity.workspaceRoles, iat: now, exp: now + 600,
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
    const payload = JSON.parse(route.request().postData() || '{}')
    const incoming = Array.isArray(payload.conversations) ? payload.conversations : payload.conversation ? [payload.conversation] : []
    incoming.filter((conversation) => conversation?.conversationId).forEach((conversation) => conversations.set(conversation.conversationId, conversation))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conversations: incoming }) })
  })
}

async function openCleanRoute(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.locator('.practice-hub').waitFor({ state: 'visible' })
}

async function assertActivePracticeModeVisible(page, viewport) {
  const visibility = await page.locator('.practice-modes button.active').evaluate((button) => {
    const rail = button.closest('.practice-modes')
    const buttonRect = button.getBoundingClientRect()
    const railRect = rail?.getBoundingClientRect()
    return {
      complete: Boolean(railRect && buttonRect.left >= railRect.left && buttonRect.right <= railRect.right),
      buttonLeft: buttonRect.left,
      buttonRight: buttonRect.right,
      railLeft: railRect?.left,
      railRight: railRect?.right,
    }
  })
  assert.equal(visibility.complete, true, `${viewport.name} must show the full active practice mode: ${JSON.stringify(visibility)}`)
}

async function runViewport(page, server, viewport) {
  const a2Url = `${server.url}practice?routeId=cie-9702-a2-physics&stage=A2&course=9702&tab=topics`
  await openCleanRoute(page, a2Url)
  await assertActivePracticeModeVisible(page, viewport)
  await page.locator('.topic-directory').waitFor({ state: 'visible' })
  await page.screenshot({ path: path.join(ARTIFACT_DIR, `qa-student-hierarchy-a2-${viewport.name}.png`), fullPage: false })
  const a2RouteStatus = page.locator('.topic-directory__route-status')
  await a2RouteStatus.waitFor({ state: 'visible' })
  assert.match((await a2RouteStatus.innerText()).replace(/\s+/g, ' '), /15 syllabus topics.*No reviewed questions yet.*21 study-only questions ready to open/i)
  const a2TopicRows = page.locator('.topic-directory__row')
  assert.equal(await a2TopicRows.count(), 15, 'A2 Physics must show every official syllabus topic, including topics still awaiting source-backed practice')
  await a2TopicRows.filter({ hasText: 'Gravitational fields' }).click()
  await page.getByRole('tab', { name: 'Past-paper questions', exact: true }).click()
  const a2QuestionSearch = page.getByPlaceholder(/gravitational potential/i)
  await a2QuestionSearch.fill('gravitational potential')
  assert.ok(await page.locator('.topic-detail__question-item').count() > 0, 'A2 topic search must expose study-only source questions through the canonical syllabus mapping')
  await a2QuestionSearch.fill('')
  const a2Start = page.getByRole('button', { name: /Practice 4/i }).first()
  await a2Start.waitFor({ state: 'visible' })
  const a2PracticeResponse = page.waitForResponse((response) => response.url().includes('/api/stem/practice-sets') && response.request().method() === 'POST')
  await a2Start.click()
  const a2Response = await a2PracticeResponse
  const a2Payload = await a2Response.json()
  assert.equal(a2Response.status(), 201)
  assert.equal(a2Payload.routeId, 'cie-9702-a2-physics')
  assert.deepEqual(a2Payload.syllabusTopicIds, ['9702-a2-topic-02'])
  assert.equal(a2Payload.questionCount, 4)
  assert.ok(a2Payload.questionGroups.every((group) => group.studyOnly === true && group.paperComponent === 4), 'A2 source-backed expansion must stay self-mark only and inside P4')

  const unavailableUrl = `${server.url}practice?routeId=cie-9701-a2-chemistry&stage=A2&course=9701&tab=topics`
  await openCleanRoute(page, unavailableUrl)
  const unavailableState = page.locator('.topic-directory__empty--inventory')
  await unavailableState.waitFor()
  assert.match(await unavailableState.innerText(), /Topic Drill is being prepared for this course/i)
  assert.match(await unavailableState.innerText(), /Use a complete official paper now/i)
  assert.equal(await page.locator('.topic-directory > header').getByText(/^Choose one topic\./).count(), 0, 'an unavailable Topic Drill route must not tell the student to choose a topic')
  assert.equal(await page.getByRole('heading', { name: 'No topic matches this filter' }).count(), 0, 'an unavailable course must not present its no-inventory state as a broken filter')
  assert.equal(await page.getByLabel('Topic focus').count(), 0, 'a course with no Topic Drill inventory must not expose a misleading topic filter')
  await page.getByRole('button', { name: /Browse A2 Chemistry papers/i }).click()
  await page.locator('.paper-library').waitFor({ state: 'visible' })

  const asUrl = `${server.url}practice?routeId=cie-9702-as-physics&stage=AS&course=9702&tab=topics`
  await openCleanRoute(page, asUrl)
  await page.locator('.topic-directory__route-status').waitFor({ state: 'visible' })
  const routeStatus = (await page.locator('.topic-directory__route-status').innerText()).replace(/\s+/g, ' ')
  assert.match(routeStatus, /11 syllabus topics/i, 'AS 9702 must expose its official syllabus topic list')
  const topicRows = page.locator('.topic-directory__row')
  assert.equal(await topicRows.count(), 11, 'AS 9702 must expose all 11 official syllabus topics')
  assert.equal(await page.getByText('Open topic', { exact: true }).count(), 11, 'every topic row must provide an explicit next action')
  await page.screenshot({ path: path.join(ARTIFACT_DIR, `qa-student-hierarchy-as-directory-${viewport.name}.png`), fullPage: false })

  const topicFocus = page.getByLabel('Topic focus')
  await topicFocus.selectOption({ label: 'Kinematics' })
  const selectedTopicValue = await topicFocus.inputValue()
  assert.match(selectedTopicValue, /topic-02$/, 'Topic focus must store the canonical topic ID, not its display label')
  await page.getByRole('button', { name: /^Recommended$/ }).click()
  const recommendedText = (await page.locator('.practice-overview').innerText()).replace(/\s+/g, ' ')
  assert.match(recommendedText, /Kinematics/i, 'Topic 2 selection must refresh the Recommended title and CTA')
  assert.doesNotMatch(recommendedText, /Physical quantities and units|topic-01/i, 'Topic 1 must not leak into a Topic 2 recommendation')
  await page.screenshot({ path: path.join(ARTIFACT_DIR, `qa-student-hierarchy-topic-focus-${viewport.name}.png`), fullPage: false })

  await page.getByRole('button', { name: /^AI Practice$/ }).click()
  await page.locator('.ai-practice-builder').waitFor({ state: 'visible' })
  const aiTopicRows = page.locator('.ai-practice-builder__topics label')
  assert.equal(await aiTopicRows.filter({ hasText: 'Kinematics' }).locator('input').isChecked(), true, 'AI Practice must inherit the selected Topic focus')
  assert.equal(await aiTopicRows.filter({ hasText: 'Physical quantities and units' }).locator('input').isChecked(), false, 'AI Practice must not reset to Topic 1 after a Topic 2 focus')
  const aiComponentOptions = await page.locator('.ai-practice-builder__settings select').nth(1).locator('option').allTextContents()
  assert.deepEqual(aiComponentOptions, ['P1 + P2 mixed', 'P1', 'P2'], '9702 AS AI Practice must keep practical P3 outside the theory builder')
  assert.match((await page.locator('.ai-practice-builder').innerText()).replace(/\s+/g, ' '), /source questions.*ready for formal progress/i, 'AI Practice must distinguish source inventory from formal progress readiness')
  await page.screenshot({ path: path.join(ARTIFACT_DIR, `qa-student-hierarchy-ai-practice-${viewport.name}.png`), fullPage: false })

  const buildPracticeResponse = page.waitForResponse((response) => response.url().includes('/api/stem/practice-sets') && response.request().method() === 'POST')
  await page.getByRole('button', { name: /^Build practice$/ }).click()
  const builtPracticeResponse = await buildPracticeResponse
  assert.equal(builtPracticeResponse.status(), 201, 'AI Practice must create a current source-backed set before entering the workspace')
  await page.locator('.qp-player').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: /^Next question$/ }).click()
  await page.getByLabel('Question progress').getByText(/Question 2 of 10/).waitFor({ state: 'visible' })
  const attemptBeforeReload = new URL(page.url())
  const rebindResponse = page.waitForResponse((response) => response.url().includes('/api/stem/practice-sets/rebind') && response.request().method() === 'POST')
  await page.reload({ waitUntil: 'domcontentloaded' })
  const reboundPracticeResponse = await rebindResponse
  assert.equal(reboundPracticeResponse.status(), 200, 'a saved AI Practice set must pass the current server-side source rebind on refresh')
  await page.locator('.qp-player').waitFor({ state: 'visible' })
  await page.getByLabel('Question progress').getByText(/Question 2 of 10/).waitFor({ state: 'visible' })
  const attemptAfterReload = new URL(page.url())
  assert.equal(attemptAfterReload.pathname, '/attempt', 'refresh must retain the AI Practice workspace instead of returning to Topic Drill')
  for (const key of ['routeId', 'unitId', 'attemptId', 'partId']) {
    assert.equal(attemptAfterReload.searchParams.get(key), attemptBeforeReload.searchParams.get(key), `refresh must retain the current ${key}`)
  }
  await page.screenshot({ path: path.join(ARTIFACT_DIR, `qa-student-hierarchy-ai-practice-restored-${viewport.name}.png`), fullPage: false })

  await page.getByRole('button', { name: 'Back to library' }).click()
  await page.locator('.practice-hub').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: /^Topic Drill$/ }).click()
  await topicFocus.selectOption('')

  const dynamics = topicRows.filter({ hasText: 'Dynamics' }).first()
  await dynamics.click()
  const start = page.locator('.topic-detail__start .primary-action').first()
  await start.waitFor({ state: 'visible' })
  const hit = await start.evaluate((button) => {
    button.scrollIntoView({ block: 'center', inline: 'nearest' })
    const rect = button.getBoundingClientRect()
    const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return target === button || target?.closest('button') === button
  })
  assert.equal(hit, true, 'the session start action must remain clickable at every viewport')
  await page.getByRole('button', { name: /Ask AI Tutor about this topic/i }).waitFor({ state: 'visible' })
  const globalCoachTrigger = page.locator('.ai-coach-trigger')
  assert.equal(await globalCoachTrigger.isVisible(), false, 'the duplicate floating Coach trigger must not cover topic setup controls')
  await page.screenshot({ path: path.join(ARTIFACT_DIR, `qa-student-hierarchy-as-topic-${viewport.name}.png`), fullPage: false })
}

async function run() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  const server = await startServer()
  let browser
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.mobile, hasTouch: viewport.touch, deviceScaleFactor: viewport.touch ? 2 : 1 })
      const page = await context.newPage()
      page.setDefaultTimeout(15_000)
      const errors = []
      const failedResponses = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
      page.on('response', (response) => {
        if (response.status() >= 400) failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`)
      })
      await page.route('**/api/auth/status', (route) => route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaAuthStatus()) })
        : route.continue())
      await mockCoachHistory(page)
      await runViewport(page, server, viewport)
      assert.deepEqual(errors, [], `${viewport.name} produced browser errors: ${failedResponses.join(' | ')}`)
      await context.close()
      console.log(`[qa:student-hierarchy] pass ${viewport.name}`)
    }
  } finally {
    await browser?.close()
    await server.cleanup()
  }
}

run().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
