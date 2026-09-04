const path = require('path')
const net = require('net')
const { spawn } = require('child_process')
const { chromium } = require('D:/CodexWork/node_modules/playwright-core')

const REPO_ROOT = path.resolve(__dirname, '..')
const STORAGE_KEY = 'alevel-learning-platform-v2'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port
      probe.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForHttp(url, child) {
  while (child.exitCode == null) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await sleep(100)
  }
  throw new Error(`QA server exited before becoming ready: ${child.exitCode}`)
}

async function stopProcess(child) {
  if (!child || child.exitCode != null) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    await new Promise((resolve) => killer.once('close', resolve))
    return
  }
  child.kill('SIGTERM')
  await new Promise((resolve) => child.once('close', resolve))
}

async function openPaper(page, baseUrl, mode) {
  await page.goto(`${baseUrl}/papers?routeId=cie-0580-igcse-mathematics&stage=IGCSE&course=0580`, { waitUntil: 'domcontentloaded' })
  await page.locator('.paper-library').waitFor()
  await page.locator('.paper-study-mode-note').waitFor()
  await page.locator('.paper-search input').fill('0580/12 2025')
  const row = page.locator('.paper-table tbody tr').filter({ hasText: '0580/12' }).filter({ hasText: 'Mar 2025' }).first()
  await row.getByRole('button', { name: 'Open' }).click()
  await page.locator('.paper-workspace').waitFor()
  await page.waitForSelector('.pdf-canvas-scroll canvas')
  const text = await page.locator('.workspace-title').innerText()
  if (!text.includes(mode === 'exam-simulation' ? 'Exam Simulation' : 'Past-paper practice')) {
    throw new Error(`Expected ${mode} workspace label, received ${text}`)
  }
}

async function assertTwoPaneWorkspace(page, label) {
  await page.locator('.paper-desk').waitFor()
  const paperBox = await page.locator('.pdf-stage').boundingBox()
  const answerBox = await page.locator('.paper-response-panel').boundingBox()
  if (!paperBox || !answerBox) throw new Error(`${label}: paper workspace panels were not measurable`)
  if (Math.abs(paperBox.y - answerBox.y) > 24) {
    throw new Error(`${label}: paper and answer panes must stay side-by-side, received ${JSON.stringify({ paperBox, answerBox })}`)
  }
  if (answerBox.x <= paperBox.x + 200) {
    throw new Error(`${label}: answer pane must sit beside the question pane, received ${JSON.stringify({ paperBox, answerBox })}`)
  }
  if (await page.locator('.paper-pane-switch').isVisible()) {
    throw new Error(`${label}: mobile paper switcher must stay hidden in the split workspace`)
  }
}

async function run() {
  const port = await findFreePort()
  const vite = path.join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: REPO_ROOT,
    env: { ...process.env, BROWSER: 'none' },
    stdio: 'ignore',
    windowsHide: true,
  })
  const baseUrl = `http://127.0.0.1:${port}`
  let browser
  try {
    await waitForHttp(`${baseUrl}/`, child)
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const unauthorizedUrls = []
    context.on('requestfailed', (request) => {
      if (request.url().includes('/api/')) unauthorizedUrls.push(`failed:${request.url()}`)
    })
    context.on('response', (response) => {
      if (response.status() === 401) unauthorizedUrls.push(`401:${response.url()}`)
    })
    await context.route('**/api/**', async (route) => {
      const requestUrl = new URL(route.request().url())
      if (!['/api/stem/identity', '/api/auth/status'].includes(requestUrl.pathname)) {
        await route.continue()
        return
      }
      await route.fulfill({
        status: requestUrl.pathname === '/api/auth/status' ? 200 : 401,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': baseUrl,
          'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify({ authenticated: false, identity: null, token: '', workspace: null }),
      })
    })
    const page = await context.newPage()
    const runtimeErrors = []
    page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`)
    })
    await page.goto(`${baseUrl}/?routeId=cie-0580-igcse-mathematics&stage=IGCSE&course=0580`, { waitUntil: 'domcontentloaded' })
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key) || '{}')
      state.profile = {
        ...(state.profile || {}),
        role: 'student',
        activeRouteId: 'cie-0580-igcse-mathematics',
        learningTrack: 'IGCSE',
        recentRouteIds: ['cie-0580-igcse-mathematics'],
      }
      localStorage.setItem(key, JSON.stringify(state))
    }, STORAGE_KEY)
    await page.reload({ waitUntil: 'domcontentloaded' })

    await openPaper(page, baseUrl, 'past-paper-practice')
    const practiceUrl = page.url()
    if (!practiceUrl.includes('paperMode=past-paper-practice')) throw new Error(`Practice mode missing from URL: ${practiceUrl}`)
    const practiceKey = await page.evaluate((key) => Object.keys(JSON.parse(localStorage.getItem(key) || '{}').paperDrafts || {}).find((item) => !item.includes('exam-simulation')), STORAGE_KEY)
    if (!practiceKey) throw new Error('Practice draft key was not persisted')
    await page.reload({ waitUntil: 'domcontentloaded' })
    try {
      await page.locator('.paper-workspace').waitFor()
    } catch (error) {
      const diagnostics = await page.evaluate((key) => {
        const state = JSON.parse(localStorage.getItem(key) || '{}')
        return {
          url: window.location.href,
          body: document.body.innerText.slice(0, 800),
          paperDraftKeys: Object.keys(state.paperDrafts || {}),
          draft: state.paperDrafts?.[Object.keys(state.paperDrafts || {})[0]] || null,
        }
      }, STORAGE_KEY)
      throw new Error(`${error.message}\nRefresh diagnostics: ${JSON.stringify({ ...diagnostics, runtimeErrors, unauthorizedUrls })}`)
    }
    if (!(await page.locator('.workspace-title').innerText()).includes('Past-paper practice')) throw new Error('Practice mode was not restored after refresh')

    await page.goto(`${baseUrl}/practice?routeId=cie-0580-igcse-mathematics&stage=IGCSE&course=0580&tab=exams`, { waitUntil: 'domcontentloaded' })
    await page.locator('.paper-library').waitFor()
    await page.locator('.paper-study-mode-note').waitFor()
    await page.locator('.paper-search input').fill('0580/12 2025')
    await page.locator('.paper-table tbody tr').filter({ hasText: '0580/12' }).filter({ hasText: 'Mar 2025' }).first().getByRole('button', { name: 'Open' }).click()
    await page.locator('.paper-workspace').waitFor()
    await page.waitForSelector('.pdf-canvas-scroll canvas')
    const simulationUrl = page.url()
    if (!simulationUrl.includes('paperMode=exam-simulation')) throw new Error(`Simulation mode missing from URL: ${simulationUrl}`)
    if (!(await page.locator('.workspace-title').innerText()).includes('Exam Simulation')) throw new Error('Simulation mode label missing')
    const simulationKey = await page.evaluate((key) => Object.keys(JSON.parse(localStorage.getItem(key) || '{}').paperDrafts || {}).find((item) => item.includes('exam-simulation')), STORAGE_KEY)
    if (!simulationKey || simulationKey === practiceKey) throw new Error(`Practice and simulation drafts are not isolated: ${JSON.stringify({ practiceKey, simulationKey })}`)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.paper-workspace').waitFor()
    if (!(await page.locator('.workspace-title').innerText()).includes('Exam Simulation')) throw new Error('Simulation mode was not restored after refresh')

    const tabletContext = await browser.newContext({ viewport: { width: 820, height: 1180 } })
    tabletContext.on('requestfailed', (request) => {
      if (request.url().includes('/api/')) unauthorizedUrls.push(`tablet-failed:${request.url()}`)
    })
    tabletContext.on('response', (response) => {
      if (response.status() === 401) unauthorizedUrls.push(`tablet-401:${response.url()}`)
    })
    await tabletContext.route('**/api/**', async (route) => {
      const requestUrl = new URL(route.request().url())
      if (!['/api/stem/identity', '/api/auth/status'].includes(requestUrl.pathname)) {
        await route.continue()
        return
      }
      await route.fulfill({
        status: requestUrl.pathname === '/api/auth/status' ? 200 : 401,
        contentType: 'application/json',
        headers: {
          'Access-Control-Allow-Origin': baseUrl,
          'Access-Control-Allow-Credentials': 'true',
        },
        body: JSON.stringify({ authenticated: false, identity: null, token: '', workspace: null }),
      })
    })
    const tabletPage = await tabletContext.newPage()
    tabletPage.on('pageerror', (error) => runtimeErrors.push(`tablet-pageerror: ${error.message}`))
    tabletPage.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(`tablet-console: ${message.text()}`)
    })
    await tabletPage.goto(`${baseUrl}/?routeId=cie-0580-igcse-mathematics&stage=IGCSE&course=0580`, { waitUntil: 'domcontentloaded' })
    await tabletPage.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key) || '{}')
      state.profile = {
        ...(state.profile || {}),
        role: 'student',
        activeRouteId: 'cie-0580-igcse-mathematics',
        learningTrack: 'IGCSE',
        recentRouteIds: ['cie-0580-igcse-mathematics'],
      }
      localStorage.setItem(key, JSON.stringify(state))
    }, STORAGE_KEY)
    await tabletPage.reload({ waitUntil: 'domcontentloaded' })
    await openPaper(tabletPage, baseUrl, 'past-paper-practice')
    await assertTwoPaneWorkspace(tabletPage, 'tablet')
    await tabletContext.close()

    const errors = await page.evaluate(() => window.__qaErrors || [])
    if (errors.length) throw new Error(`Browser runtime errors: ${JSON.stringify(errors)}`)
    await context.close()
    console.log(JSON.stringify({ ok: true, practiceUrl, simulationUrl, practiceKey, simulationKey }))
  } finally {
    await browser?.close()
    await stopProcess(child)
  }
}

run().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
