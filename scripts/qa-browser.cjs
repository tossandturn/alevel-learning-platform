const fs = require('fs')
const path = require('path')
const { chromium } = require('D:/CodexWork/node_modules/playwright-core')

const APP_URL = 'http://127.0.0.1:5173/'
const STORAGE_KEY = 'alevel-learning-platform-v2'
const ARTIFACT_DIR = 'D:/CodexWork/qa-artifacts/alevel-learning-platform'

async function startSession(page) {
  await page.waitForSelector('.session-setup')
  await page.getByRole('button', { name: /Start session/i }).click({ force: true })
  await page.waitForSelector('.question-block')
}

async function openVerifiedStarter(page) {
  await page.getByRole('button', { name: /^Start$/ }).first().click()
  await startSession(page)
  if ((await page.locator('.index-list button').count()) !== 10) throw new Error('Verified starter did not contain ten questions')
  if ((await page.locator('.question-block').count()) !== 1) throw new Error('Workspace must render one focused question')
}

async function run() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const errors = []
  const shots = []

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(`desktop: ${error.message}`))
    page.on('response', (response) => {
      const expectedGuestIdentity = response.status() === 401 && response.url().includes('/api/stem/identity')
      if (response.status() >= 400 && !expectedGuestIdentity) errors.push(`${response.status()} ${response.url()}`)
    })
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.clear()
      for (const key of Object.keys(localStorage)) if (key.includes('ai-coach')) localStorage.removeItem(key)
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.dashboard-studio .continue-card').waitFor()
    if (await page.locator('.dashboard-studio .study-action-grid').count() !== 1) throw new Error('Study actions are missing')
    if (await page.locator('.dashboard-studio .roadmap-compact').count() !== 1) throw new Error('Skill map is missing')
    if (await page.getByText(/Need \d+ more/i).count()) throw new Error('Inventory shortage must not block or show Need more copy')
    await openVerifiedStarter(page)
    if (await page.locator('.practice-progress-strip').count() !== 1) throw new Error('Live practice progress is missing')

    if (!(await page.getByText('Verified past-paper set', { exact: true }).count())) throw new Error('Verified source summary is missing')
    const evidence = page.locator('.question-source-evidence')
    if ((await evidence.count()) !== 1) throw new Error('Original paper evidence is missing for a source-backed question')
    const generated = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).generatedUnits.find((unit) => unit.parts?.length === 10), STORAGE_KEY)
    if (!generated.parts.every((part) => part.sourceRef?.sha256 && part.answerRef?.sha256 && part.sourceRef.sha256 !== part.answerRef.sha256)) throw new Error('Question and answer provenance are not independently bound')
    const handwrittenIndex = generated.parts.findIndex((part) => part.answerType !== 'multiple-choice')
    if (handwrittenIndex < 0) throw new Error('Mixed verified drills must include a handwriting question when indexed structure questions are available')
    await page.locator('.index-list button').nth(handwrittenIndex).click()
    await page.locator('.handwriting-pad').waitFor()
    const mcqIndex = generated.parts.findIndex((part) => part.answerType === 'multiple-choice' && (part.answerKey || part.answer))
    if (mcqIndex < 0) throw new Error('Verified drill did not include a markable MCQ')
    await page.locator('.index-list button').nth(mcqIndex).click()
    const mcqPart = generated.parts[mcqIndex]
    const correctKey = mcqPart.answerKey || mcqPart.answer
    await page.locator('.mcq-answer label').filter({ has: page.locator(`input[value="${correctKey}"]`) }).click()
    await page.getByRole('button', { name: /^Submit$/ }).click()
    await page.locator('.submit-dialog').getByRole('button', { name: 'Submit anyway' }).click()
    await page.waitForSelector('.result-view')
    if (!(await page.getByRole('heading', { name: new RegExp(`Part ${mcqIndex + 1}: 1/1`) }).count())) throw new Error('Correct indexed MCQ was not awarded its mark')
    if (!(await page.locator('.official-answer').count())) throw new Error('Bound official answer was not revealed after submission')
    if (await page.locator('.result-next-step').count() !== 1) throw new Error('Result next-step panel is missing')
    if (await page.getByRole('link', { name: /Review professional terms/i }).count() !== 1) throw new Error('Professional Terms result link is missing')
    shots.push(path.join(ARTIFACT_DIR, 'verified-result-desktop.png'))
    await page.screenshot({ path: shots.at(-1), fullPage: false })

    await page.getByRole('button', { name: /^Retest$/ }).click()
    await startSession(page)
    await page.getByRole('button', { name: /^Submit$/ }).click()
    await page.locator('.submit-dialog').getByRole('button', { name: 'Submit anyway' }).click()
    await page.getByRole('button', { name: 'Back to library' }).click()
    await page.getByRole('button', { name: /^Mistakes$/ }).click()
    await page.locator('.mistake-row').first().getByRole('button', { name: /^Retest$/ }).click()
    await startSession(page)
    if ((await page.locator('.index-list button').count()) !== 1) throw new Error('Mistake retest must contain only the selected question')

    await page.getByRole('button', { name: 'Back to library' }).click()
    await page.getByRole('button', { name: /^Knowledge$/ }).click()
    for (const topic of ['7 Waves', '9 Electricity']) {
      const row = page.locator('.knowledge-row').filter({ hasText: topic })
      if (!(await row.getByText(/verified/i).count())) throw new Error(`${topic} inventory is not shown`)
      if (await row.getByRole('button', { name: /Build AS drill · 10 questions/i }).isDisabled()) throw new Error(`${topic} ten-question drill is still locked`)
    }

    await page.getByRole('button', { name: /^Today$/ }).click()
    await page.getByRole('combobox', { name: 'Current route' }).selectOption('cie-0625-igcse-physics')
    await page.getByRole('button', { name: /^Practice$/ }).click()
    await page.getByRole('button', { name: /^Notebook$/ }).click()
    await page.getByRole('button', { name: /Teacher Create classes/ }).click()
    if (await page.getByRole('region', { name: 'Teacher Home' }).count() !== 1) throw new Error('Teacher Home is missing')
    await page.getByRole('button', { name: 'Content', exact: true }).click()
    if (await page.getByRole('heading', { name: 'Verified source availability' }).count() !== 1) throw new Error('Teacher Content tab is missing')
    await page.getByRole('button', { name: /School See programme coverage/ }).click()
    await page.getByRole('heading', { name: /Loading aggregate programme data/ }).waitFor()
    if (await page.getByRole('region', { name: 'School reporting controls' }).count() !== 1) throw new Error('School reporting controls are missing')
    await page.getByRole('button', { name: 'Coverage', exact: true }).click()
    if (await page.getByRole('region', { name: 'School reporting controls' }).count() !== 1) throw new Error('School Coverage controls are missing')
    await page.getByRole('button', { name: /^Practice$/ }).click()
    await page.getByRole('button', { name: /^Paper PDFs$/ }).click()
    await page.locator('.paper-filters select').nth(0).selectOption('0625')
    await page.locator('.paper-filters select').nth(3).selectOption('1')
    await page.locator('.paper-table tbody tr').first().getByRole('button', { name: 'Open' }).click()
    await page.waitForSelector('.pdf-canvas-scroll canvas')
    await page.waitForFunction(() => document.querySelectorAll('.pdf-canvas-scroll canvas').length >= 3)
    if (await page.getByRole('button', { name: /next page|previous page/i }).count()) throw new Error('Continuous PDF reader exposed page-by-page controls')
    shots.push(path.join(ARTIFACT_DIR, 'continuous-pdf-desktop.png'))
    await page.screenshot({ path: shots.at(-1), fullPage: false })
    await context.close()

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true })
    const mobilePage = await mobile.newPage()
    mobilePage.on('pageerror', (error) => errors.push(`mobile: ${error.message}`))
    await mobilePage.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await mobilePage.evaluate(() => localStorage.clear())
    await mobilePage.reload({ waitUntil: 'domcontentloaded' })
    await openVerifiedStarter(mobilePage)
    const mobileMetrics = await mobilePage.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      evidenceOpen: document.querySelector('.question-source-evidence')?.open,
      answerTop: document.querySelector('.mcq-answer, .handwriting-pad')?.getBoundingClientRect().top,
      promptBottom: document.querySelector('.question-prompt')?.getBoundingClientRect().bottom,
    }))
    if (mobileMetrics.scrollWidth > mobileMetrics.clientWidth) throw new Error(`Mobile practice geometry failed: ${JSON.stringify(mobileMetrics)}`)
    if (mobileMetrics.evidenceOpen) throw new Error(`Source evidence must be collapsed by default on mobile: ${JSON.stringify(mobileMetrics)}`)
    if (mobileMetrics.answerTop - mobileMetrics.promptBottom > 220) throw new Error(`Answer area is too far from the question on mobile: ${JSON.stringify(mobileMetrics)}`)
    shots.push(path.join(ARTIFACT_DIR, 'verified-practice-mobile.png'))
    await mobilePage.screenshot({ path: shots.at(-1), fullPage: false })
    await mobile.close()

    const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 })
    const tabletPage = await tablet.newPage()
    await tabletPage.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await tabletPage.evaluate(() => localStorage.clear())
    await tabletPage.reload({ waitUntil: 'domcontentloaded' })
    await openVerifiedStarter(tabletPage)
    const tabletGenerated = await tabletPage.evaluate((key) => JSON.parse(localStorage.getItem(key)).generatedUnits.find((unit) => unit.parts?.length === 10), STORAGE_KEY)
    const nonMcqIndex = tabletGenerated.parts.findIndex((part) => part.answerType !== 'multiple-choice')
    if (nonMcqIndex >= 0) {
      await tabletPage.locator('.index-list button').nth(nonMcqIndex).click()
      const pad = tabletPage.locator('.handwriting-pad').first()
      const sizes = await pad.locator('.handwriting-pad__toolbar button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().width))
      if (sizes.some((size) => size < 44)) throw new Error(`iPad handwriting targets are below 44px: ${sizes.join(',')}`)
    }
    shots.push(path.join(ARTIFACT_DIR, 'verified-practice-tablet.png'))
    await tabletPage.screenshot({ path: shots.at(-1), fullPage: false })
    await tablet.close()

    if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
    console.log(JSON.stringify({ verifiedQuestions: 10, correctMcqAwarded: true, focusedRetestQuestions: 1, officialTopic7Unlocked: true, officialTopic9Unlocked: true, mobileMetrics, shots }, null, 2))
  } finally {
    await browser.close()
  }
}

run().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
