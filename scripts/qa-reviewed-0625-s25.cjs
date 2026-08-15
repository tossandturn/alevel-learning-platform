const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { chromium } = require('D:/CodexWork/node_modules/playwright-core')

const root = path.resolve(__dirname, '..')
const artifactDir = 'D:/CodexWork/qa-artifacts/alevel-learning-platform'
const reviewedSets = [
  JSON.parse(fs.readFileSync(path.join(root, 'src/data/reviewedQuestionSets/cie-0625-0625_m25_qp_22.json'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(root, 'src/data/reviewedQuestionSets/cie-0625-0625_s25_qp_21.json'), 'utf8')),
]
const questionById = new Map(reviewedSets.flatMap((set) => set.questions.map((question) => [question.questionId, question])))

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address && typeof address === 'object' ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function startServer() {
  const port = await findFreePort()
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alevel-0625-browser-'))
  const databasePath = path.join(databaseDir, 'stem.sqlite')
  const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    env: { ...process.env, BROWSER: 'none', STEM_DB_PATH: databasePath, STEM_SESSION_SECURE: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  vite.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-8000) })
  vite.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-8000) })
  const url = `http://127.0.0.1:${port}/`
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && vite.exitCode == null) {
    try {
      const response = await fetch(url)
      if (response.ok) return { vite, url, databaseDir }
    } catch {
      // Vite is still starting.
    }
    await sleep(100)
  }
  try { vite.kill() } catch {}
  throw new Error(`0625 browser server did not start. ${output}`)
}

async function stopServer(server) {
  if (!server) return
  if (server.vite.exitCode == null && process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(server.vite.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    await new Promise((resolve) => { killer.once('close', resolve); killer.once('error', resolve) })
  }
  try { fs.rmSync(server.databaseDir, { recursive: true, force: true }) } catch {}
}

async function openSpaceTopic(page, viewportName) {
  const errors = []
  const assetFailures = []
  const rebindResponses = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i.test(message.text())) errors.push(message.text())
  })
  page.on('response', (response) => {
    if (response.url().includes('/api/stem/practice-sets/rebind')) rebindResponses.push(response.status())
    if (response.url().includes('/question-assets/')) {
      if (response.status() !== 200) assetFailures.push({ url: response.url(), status: response.status() })
    }
  })
  await page.goto(page.url(), { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Practice$/ }).click()
  const picker = page.locator('.practice-hub .student-route-picker')
  await picker.getByRole('tab', { name: 'IGCSE', exact: true }).click()
  await picker.getByRole('combobox', { name: 'Current course' }).selectOption('cie-0625-igcse-physics')
  await page.getByRole('button', { name: /^Topic Drill$/ }).click()
  const topicRow = page.locator('.topic-directory__row').filter({ hasText: 'Space physics' }).first()
  await topicRow.waitFor()
  await topicRow.click()
  const start = page.getByRole('button', { name: /^(?:Start set 1|Start (?:checked|verified) sample|Practice \d+)/i }).first()
  if (!await start.count()) {
    const topicRows = await page.locator('.topic-directory__row').allTextContents()
    const buttons = await page.getByRole('button').allTextContents()
    throw new Error(`${viewportName}: Space Physics detail did not expose a practice CTA. rows=${JSON.stringify(topicRows)} buttons=${JSON.stringify(buttons)}`)
  }
  await start.waitFor()
  assert.equal(await start.isDisabled(), false, `${viewportName}: Space Physics set 1 must be enabled`)
  const practiceSetResponse = page.waitForResponse((response) => (
    response.url().includes('/api/stem/practice-sets')
    && response.request().method() === 'POST'
  ))
  await start.click()
  const response = await practiceSetResponse
  const payload = await response.json()
  assert.equal(response.status(), 201, `${viewportName}: Space Physics practice-set request must succeed: ${JSON.stringify(payload)}`)
  assert.equal(payload.routeId, 'cie-0625-igcse-physics', `${viewportName}: practice set must retain the selected course`)
  assert.deepEqual(payload.syllabusTopicIds, ['0625-igcse-topic-06'], `${viewportName}: practice set must retain Space Physics taxonomy`)
  assert.equal(payload.questionCount, 8, `${viewportName}: short practice set must expose the full current Space Physics inventory`)
  assert.equal(payload.questionGroups.filter((group) => group.studyOnly !== true).length, 5, `${viewportName}: the five reviewed questions must remain first-class inventory`)
  assert.equal(payload.questionGroups.filter((group) => group.studyOnly === true).length, 3, `${viewportName}: three complete legacy-tagged questions must be added as self-mark study items`)
  if (await page.locator('.session-setup').count()) await page.getByRole('button', { name: /Start session/i }).click()
  await page.locator('.question-block').waitFor()
  const buttons = page.locator('.qp-index__list button')
  const expectedParts = payload.questionGroups.flatMap((group) => group.parts.map((part) => ({ group, part })))
  const expectedPartCount = expectedParts.length
  assert.equal(await buttons.count(), expectedPartCount, `${viewportName}: Space Physics set must expose every source-backed answer part`)
  const evidence = []
  for (let index = 0; index < await buttons.count(); index += 1) {
    await buttons.nth(index).click()
    const figure = page.locator('.qp-question-asset').first()
    await figure.waitFor({ state: 'visible' })
    const metrics = await figure.locator('img').evaluate((image) => ({
      src: image.getAttribute('src') || '',
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      complete: image.complete,
      toolbar: image.closest('.qp-question-asset')?.querySelector('.qp-question-asset__toolbar')?.textContent || '',
      sourceLabel: document.querySelector('.qp-source-label strong')?.textContent || '',
    }))
    assert.equal(metrics.complete, true, `${viewportName}: source image must finish loading`)
    assert.ok(metrics.naturalWidth > 0 && metrics.naturalHeight > 0, `${viewportName}: source image must decode`)
    assert.match(metrics.src, /\/question-assets\/cie-0625-0625_[^/]+\//)
    const { group: sourceGroup, part: sourcePart } = expectedParts[index]
    const requiredAssets = new Set([
      ...(sourceGroup.sourceContent?.assetUrls || []),
      ...(sourcePart.sourceEvidence || []).map((item) => item.assetUrl),
    ].filter(Boolean))
    assert.ok(requiredAssets.has(metrics.src), `${viewportName}: visible asset for ${sourcePart.partId} must match its canonical source binding`)
    const sourceQuestionId = sourceGroup.id
    if (sourceGroup.studyOnly !== true) assert.ok(questionById.has(sourceQuestionId), `${viewportName}: reviewed source item is missing from the reviewed fixture`)
    assert.match(metrics.toolbar.replace(/\s+/g, ' '), /QP p\.\s*\d+/i)
    evidence.push({ sourceQuestionId, studyOnly: sourceGroup.studyOnly === true, asset: metrics.src, decoded: `${metrics.naturalWidth}x${metrics.naturalHeight}`, toolbar: metrics.toolbar.replace(/\s+/g, ' ').trim() })
  }
  assert.equal(assetFailures.length, 0, `${viewportName}: source asset requests failed: ${JSON.stringify(assetFailures)}`)
  assert.equal(errors.length, 0, `${viewportName}: browser console/runtime errors: ${JSON.stringify(errors)}`)
  const activeSourceIdentity = await page.locator('.qp-source-label strong').textContent()
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.question-block').waitFor({ state: 'visible' })
  assert.equal(await page.locator('.qp-index__list button').count(), expectedPartCount, `${viewportName}: refresh must restore the same source-backed set`)
  assert.equal(await page.locator('.qp-source-label strong').textContent(), activeSourceIdentity, `${viewportName}: refresh must restore the active canonical question identity`)
  assert.ok(rebindResponses.includes(200), `${viewportName}: refresh must rebind the persisted unit through the canonical server endpoint: ${JSON.stringify(rebindResponses)}`)
  assert.equal(errors.length, 0, `${viewportName}: refresh produced browser console/runtime errors: ${JSON.stringify(errors)}`)
  await page.screenshot({ path: path.join(artifactDir, `qa-0625-space-${viewportName}.png`), fullPage: false })
  return evidence
}

(async () => {
  fs.mkdirSync(artifactDir, { recursive: true })
  const server = await startServer()
  const browser = await chromium.launch({ headless: true })
  const results = {}
  try {
    for (const viewport of [{ name: 'desktop', width: 1440, height: 900, isMobile: false }, { name: 'ipad-landscape', width: 1180, height: 820, isMobile: true }]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, isMobile: viewport.isMobile, hasTouch: viewport.isMobile })
      const page = await context.newPage()
      await page.goto(server.url)
      results[viewport.name] = await openSpaceTopic(page, viewport.name)
      await context.close()
    }
    console.log(JSON.stringify({ status: 'passed', routeId: 'cie-0625-igcse-physics', topic: 'Space physics', setSize: 8, reviewed: 5, studyOnly: 3, viewports: results }, null, 2))
  } finally {
    await browser.close()
    await stopServer(server)
  }
})().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
