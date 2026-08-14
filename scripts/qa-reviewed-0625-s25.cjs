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
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/i.test(message.text())) errors.push(message.text())
  })
  page.on('response', (response) => {
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
  await start.click()
  if (await page.locator('.session-setup').count()) await page.getByRole('button', { name: /Start session/i }).click()
  await page.locator('.question-block').waitFor()
  const buttons = page.locator('.qp-index__list button')
  assert.equal(await buttons.count(), 5, `${viewportName}: Space Physics set must expose all five verified questions`)
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
    assert.match(metrics.src, /\/question-assets\/cie-0625-0625_(?:m25_qp_22|s25_qp_21)\//)
    const questionNumber = Number(metrics.sourceLabel.match(/Q(\d+)/i)?.[1])
    const sourceQuestionId = [...questionById.keys()].find((id) => id.endsWith(`:q${questionNumber}`) && metrics.src.includes(id.split(':')[0]))
    assert.ok(sourceQuestionId, `${viewportName}: could not bind ${metrics.sourceLabel} to reviewed source ID`)
    const reviewedQuestion = questionById.get(sourceQuestionId)
    const expectedAsset = reviewedQuestion.parts[0].sourceEvidence[0].assetUrl
    assert.equal(metrics.src, expectedAsset, `${viewportName}: visible QP asset must match reviewed source binding`)
    assert.match(metrics.toolbar.replace(/\s+/g, ' '), /QP p\.\s*\d+/i)
    evidence.push({ sourceQuestionId, asset: metrics.src, decoded: `${metrics.naturalWidth}x${metrics.naturalHeight}`, toolbar: metrics.toolbar.replace(/\s+/g, ' ').trim() })
  }
  assert.equal(assetFailures.length, 0, `${viewportName}: source asset requests failed: ${JSON.stringify(assetFailures)}`)
  assert.equal(errors.length, 0, `${viewportName}: browser console/runtime errors: ${JSON.stringify(errors)}`)
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
    console.log(JSON.stringify({ status: 'passed', routeId: 'cie-0625-igcse-physics', topic: 'Space physics', setSize: 5, viewports: results }, null, 2))
  } finally {
    await browser.close()
    await stopServer(server)
  }
})().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
