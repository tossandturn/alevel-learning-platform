import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const TIMEOUT_MS = 10_000
const require = createRequire(import.meta.url)
const { chromium } = require('D:/CodexWork/node_modules/playwright-core')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => (error ? reject(error) : resolve(port)))
    })
  })
}

async function stopProcess(child) {
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

async function startServer() {
  const port = await findFreePort()
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alevel-paper-catalog-browser-'))
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    env: {
      ...process.env,
      BROWSER: 'none',
      NODE_ENV: 'test',
      STEM_DB_PATH: path.join(databaseDir, 'stem.sqlite'),
      STEM_SESSION_SECURE: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const url = `http://127.0.0.1:${port}/`
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += String(chunk)
    if (output.length > 8_000) output = output.slice(-8_000)
  })
  child.stderr.on('data', (chunk) => {
    output += String(chunk)
    if (output.length > 8_000) output = output.slice(-8_000)
  })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && child.exitCode == null) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (response.ok) {
        return {
          url,
          output,
          async cleanup() {
            await stopProcess(child)
            fs.rmSync(databaseDir, { recursive: true, force: true })
          },
        }
      }
    } catch {
      // still starting
    }
    await sleep(100)
  }
  await stopProcess(child)
  fs.rmSync(databaseDir, { recursive: true, force: true })
  throw new Error(`isolated Vite did not become ready at ${url}\n${output}`)
}

async function measureCatalogLoad(page, url) {
  const requests = []
  page.on('request', (request) => {
    const requestUrl = request.url()
    if (requestUrl.includes('/data/papers/')) requests.push(requestUrl)
  })
  const startedAt = performance.now()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.paper-table tbody tr', { timeout: 12_000 })
  const durationMs = Math.round(performance.now() - startedAt)
  const firstRow = await page.locator('.paper-table tbody tr').first().innerText()
  return { durationMs, requests, firstRow }
}

async function run() {
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'data', 'papers', '9709.json')), 'run npm run catalog before the browser measurement')
  const server = await startServer()
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  try {
    const fastContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const fastPage = await fastContext.newPage()
    const fastResult = await measureCatalogLoad(fastPage, `${server.url}papers?routeId=cie-9709-a2-after-p1-p5-p3-p4&stage=A2&course=9709`)
    assert.ok(fastResult.durationMs < 8_000, `paper catalog first render is too slow: ${fastResult.durationMs}ms`)
    assert.ok(fastResult.requests.some((requestUrl) => requestUrl.includes('/data/papers/9709.json')), `expected a 9709 subject catalog request, saw ${fastResult.requests.join(', ') || '(none)'}`)
    assert.ok(!fastResult.requests.some((requestUrl) => requestUrl.endsWith('/data/papers.json')), `the fast paper route must not fetch the full catalog: ${fastResult.requests.join(', ') || '(none)'}`)
    assert.match(fastResult.firstRow, /P\d+|Question paper|Mark scheme/i, 'the first visible paper row should contain real catalog content')
    await fastContext.close()

    const slowContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const slowPage = await slowContext.newPage()
    let paperRequestCount = 0
    await slowPage.route('**/data/papers/9702.json', async (route) => {
      paperRequestCount += 1
      if (paperRequestCount === 1) {
        await sleep(TIMEOUT_MS + 1_000)
        try {
          await route.continue()
        } catch {
          // The client aborts the request after its timeout; the late continue is expected to fail quietly.
        }
        return
      }
      await route.continue()
    })
    await slowPage.goto(`${server.url}papers?routeId=cie-9702-as-physics&stage=AS&course=9702`, { waitUntil: 'domcontentloaded' })
    const timeoutCopy = slowPage.locator('.paper-state.error')
    await timeoutCopy.waitFor({ state: 'visible', timeout: TIMEOUT_MS + 5_000 })
    const timeoutText = (await timeoutCopy.innerText()).replace(/\s+/g, ' ').trim()
    assert.match(timeoutText, /Loading the verified paper catalog took too long\. Retry\./, 'the paper catalog timeout state must be visible')
    await slowPage.getByRole('button', { name: 'Retry' }).click()
    await slowPage.waitForSelector('.paper-table tbody tr', { timeout: 12_000 })
    await slowContext.close()

    const coachContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const coachPage = await coachContext.newPage()
    await coachPage.goto(`${server.url}today?coach=1`, { waitUntil: 'domcontentloaded' })
    await coachPage.locator('.ai-coach.open').waitFor({ state: 'visible', timeout: 8_000 })
    const coachHeading = (await coachPage.locator('.ai-coach.open').locator('.ai-coach__identity strong').innerText()).trim()
    assert.equal(coachHeading, 'AI Coach', 'the dashboard deep link must open the Coach panel')
    await coachContext.close()

    console.log(JSON.stringify({
      fastLoadMs: fastResult.durationMs,
      requests: fastResult.requests,
      timeoutCopy,
      coachDeepLink: true,
    }, null, 2))
  } finally {
    await browser.close().catch(() => {})
    await server.cleanup().catch(() => {})
  }
}

run().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
