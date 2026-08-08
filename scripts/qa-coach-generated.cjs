const { chromium } = require('D:/CodexWork/node_modules/playwright-core')

const APP_URL = 'http://127.0.0.1:5173/'
const STORAGE_KEY = 'alevel-learning-platform-v2'

async function sendCoachMessage(page, text) {
  const floatingTrigger = page.getByRole('button', { name: 'Open AI Coach' })
  const tutorCard = page.getByRole('button', { name: 'Chat with AI Tutor' })
  const coachDrawer = page.locator('.ai-coach.open')
  if (!(await coachDrawer.count())) {
    if (await floatingTrigger.isVisible()) await floatingTrigger.click()
    else await tutorCard.click()
  }
  await page.locator('.ai-coach textarea').fill(text)
  await page.getByRole('button', { name: 'Send to AI Coach' }).click()
}

async function run() {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    const expectedGuestIdentity = response.status() === 401 && response.url().includes('/api/stem/identity')
    if (response.status() >= 400 && !expectedGuestIdentity) errors.push(`${response.status()} ${response.url()}`)
  })

  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await page.evaluate((key) => {
      localStorage.removeItem(key)
      for (const item of Object.keys(localStorage)) if (item.includes('ai-coach')) localStorage.removeItem(item)
    }, STORAGE_KEY)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => performance.getEntriesByType('resource').some((entry) => entry.name.endsWith('/data/papers.json')))

    await sendCoachMessage(page, '给我一套最新的 BPhO SPC 真题，带答案')
    await page.waitForSelector('.paper-workspace')
    await page.getByText('BPhO_SPC_2025_QP.pdf', { exact: false }).waitFor()
    if (await page.getByRole('button', { name: 'Mark scheme' }).isEnabled()) throw new Error('BPhO mark scheme leaked before submission')
    await page.getByRole('button', { name: 'Back to paper library' }).click()

    await sendCoachMessage(page, '给我出一份 AS 物理波 10 道真题')
    await page.waitForSelector('.practice-view')
    if ((await page.locator('.index-list button').count()) !== 10) throw new Error('Coach did not assemble exactly ten indexed questions')
    if ((await page.locator('.question-block').count()) !== 1) throw new Error('Student workspace must show one focused question')
    if (!(await page.getByText('Verified past-paper set', { exact: true }).count())) throw new Error('Verified source summary is missing')
    if (!(await page.locator('.question-source-pages img').count())) throw new Error('The official source page is not rendered inline')
    const generated = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).generatedUnits[0], STORAGE_KEY)
    if (generated.parts.length !== 10) throw new Error('Generated unit did not persist ten questions')
    if (!generated.parts.every((part) => part.sourceKind === 'past-paper' && part.sourceRef?.sha256 && part.answerRef?.sha256)) {
      throw new Error('Every Coach item must preserve independent QP/MS provenance')
    }
    if (generated.sourceMix.generatedPractice !== 0) throw new Error('Generated practice entered the formal drill')
    const firstSource = await page.locator('.question-source-label strong').textContent()
    await page.getByRole('button', { name: /Next/ }).click()
    const secondSource = await page.locator('.question-source-label strong').textContent()
    if (firstSource === secondSource) throw new Error('Next question did not change the focused source item')

    if (await page.locator('.ai-coach-backdrop').count()) {
      await page.locator('.ai-coach-backdrop').dispatchEvent('pointerdown')
      await page.waitForSelector('.ai-coach-backdrop', { state: 'detached' })
    }
    await page.getByRole('button', { name: 'Back to library' }).click()
    await page.waitForSelector('.ai-coach-backdrop', { state: 'detached' })
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Today$/ }).click()
    await page.getByRole('combobox', { name: 'Current course' }).selectOption('cie-9701-as-chemistry')
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Practice$/ }).click()
    await page.getByRole('button', { name: /^Topic Drill$/ }).click()
    await page.locator('.topic-directory').waitFor()
    await page.getByText(/Every set stays inside this course and remains linked to its original paper and mark scheme/i).waitFor()
    if (!(await page.getByRole('heading', { name: /AS Chemistry/ }).count())) throw new Error('9701 route knowledge map is missing')

    if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`)
    console.log(JSON.stringify({ bphoPaper: 'BPhO_SPC_2025_QP.pdf', verifiedQuestions: 10, sourceChanged: true }, null, 2))
  } finally {
    await browser.close()
  }
}

run().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
