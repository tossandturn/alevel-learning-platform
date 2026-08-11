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

    const defaultRouteId = await page.getByRole('combobox', { name: 'Current course' }).inputValue()
    if (defaultRouteId !== 'cie-9702-as-physics') throw new Error(`Coach cross-route regression must begin on default AS Physics, received ${defaultRouteId}`)
    await page.getByRole('button', { name: 'Open AI Coach' }).click()
    if (await page.getByRole('button', { name: 'Latest BPhO SPC' }).count()) throw new Error('AS Physics Coach leaked the Competition-only BPhO quick action')
    await page.locator('.ai-coach.open').getByRole('button', { name: 'Close AI Coach' }).click()

    await sendCoachMessage(page, '给我出一份 AS 物理波 10 道真题')
    await page.getByText(/no verified question is available yet|source inventory is still being indexed/i).waitFor()
    if (await page.locator('.practice-view').count()) throw new Error('An unreviewed AS Physics topic must not open a practice workspace')
    if (await page.getByRole('combobox', { name: 'Current course' }).inputValue() !== 'cie-9702-as-physics') {
      throw new Error('An unavailable Coach request must not silently change the current course')
    }

    await sendCoachMessage(page, '给我一套最新的 BPhO SPC 真题，带答案')
    await page.waitForSelector('.paper-workspace')
    await page.getByText('BPhO_SPC_2025_QP.pdf', { exact: false }).waitFor()
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key) || '{}').profile?.activeRouteId === 'bpho-admissions-physics', STORAGE_KEY)
    if (await page.getByRole('button', { name: 'Mark scheme' }).isEnabled()) throw new Error('BPhO mark scheme leaked before submission')
    await page.getByRole('button', { name: 'Back to paper library' }).click()
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Today$/ }).click()
    if (await page.getByRole('combobox', { name: 'Current course' }).inputValue() !== 'bpho-admissions-physics') throw new Error('BPhO paper action did not retain the exact Competition route')
    await page.getByRole('button', { name: 'Open AI Coach' }).click()
    if (await page.getByRole('button', { name: 'Latest BPhO SPC' }).count() !== 1) throw new Error('Competition Coach is missing its scoped BPhO quick action')

    await sendCoachMessage(page, 'IGCSE Mathematics Number 10 questions')
    await page.waitForSelector('.practice-view')
    if ((await page.locator('.index-list button').count()) !== 16) throw new Error('Coach did not assemble the 16 reviewed answer parts from ten Number question groups')
    if ((await page.locator('.question-block').count()) !== 1) throw new Error('Student workspace must show one focused question')
    if (!(await page.getByText('Verified past-paper set', { exact: true }).count())) throw new Error('Verified source summary is missing')
    const sourceAsset = page.locator('.qp-question-asset img').first()
    await sourceAsset.waitFor()
    const sourceMetrics = await sourceAsset.evaluate((image) => ({
      src: image.getAttribute('src') || '',
      decoded: image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
    }))
    if (!sourceMetrics.decoded || !/\/question-assets\//.test(sourceMetrics.src)) {
      throw new Error(`The official source page is not rendered inline and decoded: ${JSON.stringify(sourceMetrics)}`)
    }
    const generated = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).generatedUnits[0], STORAGE_KEY)
    if (generated.parts.length !== 16 || generated.questionGroupCount !== 10) throw new Error('Generated unit did not preserve the selected ten question groups and all sixteen answer parts')
    if (generated.routeId !== 'cie-0580-igcse-mathematics' || generated.stage !== 'IGCSE') throw new Error(`Competition-to-IGCSE Coach action opened the wrong route: ${JSON.stringify({ routeId: generated.routeId, stage: generated.stage })}`)
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

    if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`)
    console.log(JSON.stringify({
      defaultRoute: 'cie-9702-as-physics',
      unavailableAsPhysicsTopic: true,
      bphoRoute: 'bpho-admissions-physics',
      bphoPaper: 'BPhO_SPC_2025_QP.pdf',
      igcseRoute: 'cie-0580-igcse-mathematics',
      verifiedQuestionGroups: 10,
      verifiedAnswerParts: 16,
      sourceChanged: true,
    }, null, 2))
  } finally {
    await browser.close()
  }
}

run().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
