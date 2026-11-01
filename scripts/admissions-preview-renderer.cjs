'use strict'
const { chromium } = require('/runtime/package')

const MAX_INPUT_BYTES = 2 * 1024 * 1024
const chunks = []
let bytes = 0
process.stdin.on('data', chunk => {
  bytes += chunk.length
  if (bytes > MAX_INPUT_BYTES) process.exit(2)
  chunks.push(chunk)
})
process.stdin.on('end', async () => {
  let browser
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const html = String(input.html || '')
    if (!html || /https?:\/\/|<(?:script|iframe|object|embed)\b|\son[a-z]+\s*=/iu.test(html)) throw Error('unsafe input')
    const width = Math.min(720, Math.max(240, Number(input.width) || 390))
    const height = Math.min(1200, Math.max(240, Number(input.height) || 900))
    browser = await chromium.launch({ headless: true, chromiumSandbox: true })
    const context = await browser.newContext({ viewport: { width, height }, javaScriptEnabled: false, serviceWorkers: 'block', bypassCSP: false })
    const page = await context.newPage()
    await page.route('**/*', route => route.abort('blockedbyclient'))
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 4_000 })
    const focus = page.locator('[data-admissions-preview-focus="true"]').first()
    const focused = await focus.count() > 0 && await focus.isVisible().catch(() => false)
    if (focused) await focus.scrollIntoViewIfNeeded({ timeout: 1_000 }).catch(() => {})
    const screenshot = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled', caret: 'hide', timeout: 4_000 })
    process.stdout.write(JSON.stringify({ mimeType: 'image/png', base64: screenshot.toString('base64'), width, height, focus: focused ? 'requirements-section' : 'page-first-screen' }))
    await context.close()
  } catch {
    process.exitCode = 2
  } finally {
    await browser?.close().catch(() => {})
  }
})
