const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { chromium } = require('D:/CodexWork/node_modules/playwright-core')

const ROOT = path.resolve(__dirname, '..')
const ARTIFACT_DIR = 'D:/CodexWork/qa-artifacts/alevel-learning-platform'
const STORAGE_KEY = 'alevel-learning-platform-v2'
const SERVER_START_DEADLINE_MS = Math.max(10_000, Number(process.env.QA_SERVER_START_DEADLINE_MS) || 60_000)
const FLOW_DEADLINE_MS = Math.max(30_000, Number(process.env.QA_MISTAKES_FLOW_DEADLINE_MS) || 90_000)
const CLEANUP_DEADLINE_MS = Math.max(1_000, Number(process.env.QA_CLEANUP_DEADLINE_MS) || 10_000)
let APP_URL = String(process.env.QA_APP_URL || '').trim()

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function withDeadline(label, task, timeoutMs, onTimeout) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(async () => {
      try { await onTimeout?.() } catch { /* Preserve the original timeout failure. */ }
      reject(new Error(`${label} exceeded ${timeoutMs}ms`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([Promise.resolve().then(task), timeout])
  } finally {
    clearTimeout(timer)
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

async function waitForHttp(url, child) {
  const deadline = Date.now() + SERVER_START_DEADLINE_MS
  while (child.exitCode == null && Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await sleep(100)
  }
  throw new Error(`QA app server did not become ready at ${url}`)
}

async function terminateProcess(child) {
  if (!child || child.exitCode != null) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    await new Promise((resolve) => {
      killer.once('close', resolve)
      killer.once('error', resolve)
    })
    return
  }
  child.kill('SIGTERM')
}

async function removeTempDir(directory) {
  const deadline = Date.now() + CLEANUP_DEADLINE_MS
  while (Date.now() < deadline) {
    try {
      fs.rmSync(directory, { recursive: true, force: true })
      return
    } catch {
      await sleep(100)
    }
  }
  console.warn(`[qa:mistakes] temporary database directory could not be removed: ${directory}`)
}

async function startServer() {
  if (APP_URL) {
    console.log(`[qa:server] using explicitly configured QA_APP_URL=${APP_URL}`)
    return { url: APP_URL, cleanup: async () => {} }
  }
  const port = await findFreePort()
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alevel-learning-platform-mistakes-'))
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    env: {
      ...process.env,
      BROWSER: 'none',
      STEM_DB_PATH: path.join(databaseDir, 'stem.sqlite'),
      STEM_SESSION_SECURE: '0',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  })
  APP_URL = `http://127.0.0.1:${port}/`
  try {
    await waitForHttp(APP_URL, child)
  } catch (error) {
    await terminateProcess(child)
    await removeTempDir(databaseDir)
    throw error
  }
  console.log(`[qa:server] isolated Vite dev server ready at ${APP_URL}; existing 5173 is ignored`)
  return {
    url: APP_URL,
    async cleanup() {
      await terminateProcess(child)
      await removeTempDir(databaseDir)
    },
  }
}

function route(pathname) {
  return new URL(pathname, APP_URL).toString()
}

function legacyPaperMistakeState() {
  return {
    profile: {
      role: 'student',
      learningTrack: 'AS',
      activeRouteId: 'cie-9702-as-physics',
      recentRouteIds: ['cie-9702-as-physics'],
    },
    attempts: [],
    drafts: {},
    selfMarkDrafts: {},
    paperDrafts: {},
    generatedUnits: [],
    reviewQueueAudit: [],
    paperSessions: [
      null,
      { attemptId: '', routeId: 'cie-9702-as-physics' },
      {
        attemptId: 'legacy-paper-1',
        routeId: 'cie-9702-as-physics',
        paperId: 'cie-9702-9702_m25_qp_12',
        file: '9702_m25_qp_12.pdf',
        questionCount: '1',
        answeredCount: '1',
        answers: { 1: { choice: 'A' } },
        profile: { mode: 'mcq' },
        completedAt: '2026-08-16T00:00:00.000Z',
      },
    ],
    paperReviews: [
      null,
      { attemptId: '', selfMarks: { 1: 0 } },
      {
        attemptId: 'legacy-paper-1',
        routeId: 'cie-9702-as-physics',
        selfMarks: { 1: 0 },
        maxMarksByQuestion: { 1: 1 },
        completedAt: '2026-08-16T00:01:00.000Z',
      },
    ],
  }
}

async function assertNotBlank(page, label) {
  await page.locator('#root').waitFor({ state: 'attached' })
  await page.waitForFunction(() => (document.querySelector('#root')?.innerText || '').trim().length > 0)
  const text = (await page.locator('#root').innerText()).replace(/\s+/g, ' ').trim()
  if (!text) throw new Error(`${label} rendered a blank root`)
  return text
}

async function runFlow(page) {
  await page.goto(route('/'), { waitUntil: 'domcontentloaded' })
  await page.evaluate(({ key, state }) => {
    localStorage.clear()
    localStorage.setItem(key, JSON.stringify(state))
  }, { key: STORAGE_KEY, state: legacyPaperMistakeState() })

  await page.goto(route('/practice?routeId=cie-9702-as-physics&stage=AS&course=9702&tab=mistakes'), { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Choose your next study session.' }).waitFor()
  await page.getByText('9702_m25_qp_12.pdf', { exact: false }).waitFor()
  await page.getByText('0/1', { exact: true }).waitFor()
  const mistakesText = await assertNotBlank(page, 'Practice Mistakes')
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'qa-mistakes-tab-legacy-zero.png'), fullPage: false })

  await page.goto(route('/notebook?routeId=cie-9702-as-physics&stage=AS&course=9702'), { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Turn mistakes into your next marks.' }).waitFor()
  await page.getByText('9702_m25_qp_12.pdf', { exact: false }).waitFor()
  await page.getByText('0/1 marks', { exact: true }).waitFor()
  const notebookText = await assertNotBlank(page, 'Notebook')
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'qa-notebook-legacy-zero.png'), fullPage: false })

  await page.goto(route('/papers?routeId=cie-9702-as-physics&stage=AS&course=9702'), { waitUntil: 'domcontentloaded' })
  await page.locator('.paper-route-note').waitFor()
  const paperNote = (await page.locator('.paper-route-note').innerText()).replace(/\s+/g, ' ')
  if (!/AS Physics \(9702\)/.test(paperNote) || !/Official syllabus/i.test(paperNote)) {
    throw new Error(`Papers route did not restore the active official syllabus note: ${paperNote}`)
  }
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'qa-papers-9702-syllabus-note.png'), fullPage: false })

  return {
    mistakes: mistakesText.slice(0, 220),
    notebook: notebookText.slice(0, 220),
    paperNote,
  }
}

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  const server = await startServer()
  let browser
  let context
  try {
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(`pageerror:${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console:${message.text()}`)
    })
    page.setDefaultTimeout(15_000)
    const result = await withDeadline('Mistakes and syllabus browser regression', () => runFlow(page), FLOW_DEADLINE_MS, () => context?.close())
    if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`)
    console.log(JSON.stringify(result, null, 2))
  } finally {
    if (context) await withDeadline('browser context cleanup', () => context.close(), CLEANUP_DEADLINE_MS).catch(() => {})
    if (browser) await withDeadline('browser cleanup', () => browser.close(), CLEANUP_DEADLINE_MS).catch(() => {})
    await server.cleanup()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
