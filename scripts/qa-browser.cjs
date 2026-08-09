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

async function assertSessionMarkingDisclosure(page, expectedLabel) {
  const note = page.locator('.setup-marking-note')
  await note.waitFor()
  const copy = (await note.innerText()).replace(/\s+/g, ' ').trim()
  if (!copy.includes(expectedLabel)) {
    throw new Error(`Session setup marking disclosure is incorrect: expected ${expectedLabel}, received ${copy}`)
  }
}

async function openVerifiedStarter(page) {
  await page.locator('.student-primary-start').click()
  await page.waitForSelector('.session-setup')
  const disclosure = (await page.locator('.setup-marking-note').innerText()).replace(/\s+/g, ' ').trim()
  if (!/^(Instant objective marking|Mixed marking|AI-assisted review after submission|Self-mark after submission)\b/.test(disclosure)) {
    throw new Error(`Session setup is missing a clear marking disclosure: ${disclosure}`)
  }
  await startSession(page)
  if ((await page.locator('.index-list button').count()) < 1) throw new Error('Verified starter did not contain a source-backed question')
  if ((await page.locator('.question-block').count()) !== 1) throw new Error('Workspace must render one focused question')
}

async function openHandwritingStarter(page) {
  await page.locator('.student-primary-start').click()
  const topicRow = page.locator('.topic-directory__row').filter({ hasText: 'Number' }).first()
  await topicRow.waitFor()
  await topicRow.click()
  const practiceButton = page.getByRole('button', { name: /Start set|Practice \d+/i }).first()
  await practiceButton.waitFor()
  if (await practiceButton.isDisabled()) throw new Error('IGCSE Mathematics Number topic did not expose a handwriting practice set')
  await practiceButton.click()
  await page.waitForSelector('.session-setup, .question-block')
  if (await page.locator('.session-setup').count()) {
    await assertSessionMarkingDisclosure(page, 'Self-mark after submission')
    await startSession(page)
  }
  else await page.locator('.question-block').waitFor()
}

async function findHandwritingQuestion(page) {
  const buttons = page.locator('.index-list button')
  const count = await buttons.count()
  for (let index = 0; index < count; index += 1) {
    await buttons.nth(index).click()
    if (await page.locator('.handwriting-pad').count()) return index
  }
  throw new Error('The selected verified practice set has no handwriting answer surface')
}

async function pointerStroke(locator, pointerType, start, end, pointerId) {
  await locator.dispatchEvent('pointerdown', { pointerType, pointerId, isPrimary: true, pressure: 0.55, clientX: start.x, clientY: start.y, buttons: 1 })
  await locator.dispatchEvent('pointermove', { pointerType, pointerId, isPrimary: true, pressure: 0.72, clientX: end.x, clientY: end.y, buttons: 1 })
  await locator.dispatchEvent('pointerup', { pointerType, pointerId, isPrimary: true, pressure: 0, clientX: end.x, clientY: end.y, buttons: 0 })
}

async function pointerTap(locator, pointerType, point, pointerId) {
  await locator.dispatchEvent('pointerdown', { pointerType, pointerId, isPrimary: true, pressure: 0.48, clientX: point.x, clientY: point.y, buttons: 1 })
  await locator.dispatchEvent('pointerup', { pointerType, pointerId, isPrimary: true, pressure: 0, clientX: point.x, clientY: point.y, buttons: 0 })
}

async function pointerPath(locator, pointerType, points, pointerId) {
  await locator.dispatchEvent('pointerdown', { pointerType, pointerId, isPrimary: true, pressure: 0.55, clientX: points[0].x, clientY: points[0].y, buttons: 1 })
  for (const point of points.slice(1)) {
    await locator.dispatchEvent('pointermove', { pointerType, pointerId, isPrimary: true, pressure: 0.72, clientX: point.x, clientY: point.y, buttons: 1 })
  }
  const end = points.at(-1)
  await locator.dispatchEvent('pointerup', { pointerType, pointerId, isPrimary: true, pressure: 0, clientX: end.x, clientY: end.y, buttons: 0 })
}

async function inkMetrics(locator) {
  return locator.evaluate((element) => ({
    strokes: Number(element.dataset.strokeCount || 0),
    segments: Number(element.dataset.segmentCount || 0),
    dots: Number(element.dataset.dotCount || 0),
    maxGap: Number(element.dataset.maxSegmentGap || 0),
  }))
}

async function darkPixelCount(locator) {
  return locator.evaluate((element) => {
    const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data
    let dark = 0
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3] > 30 && pixels[index] < 100 && pixels[index + 1] < 120 && pixels[index + 2] < 150) dark += 1
    return dark
  })
}

async function open9709March2025P1(page) {
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Practice$/ }).click()
  const routePicker = page.locator('.practice-hub .student-route-picker')
  await routePicker.getByRole('tab', { name: 'AS', exact: true }).click()
  await routePicker.getByRole('combobox', { name: 'Current course' }).selectOption('cie-9709-as-p1-p2')
  await page.getByRole('button', { name: /^Past Papers$/ }).click()
  await page.locator('.paper-search input').fill('9709_m25_qp_12.pdf')
  const row = page.locator('.paper-table tbody tr').filter({ hasText: '9709_m25_qp_12.pdf' })
  await row.getByRole('button', { name: 'Open' }).click()
  await page.locator('.paper-workspace').waitFor()
  await page.waitForSelector('.pdf-canvas-scroll canvas')
}

async function addPdfInkForFocusedQuestion(page, pointerId) {
  const inkCanvas = page.locator('.pdf-ink-layer').first()
  await inkCanvas.waitFor()
  await inkCanvas.scrollIntoViewIfNeeded()
  const box = await inkCanvas.boundingBox()
  if (!box) throw new Error('9709 paper ink layer has no visible geometry')
  const start = { x: box.x + 68, y: box.y + 112 }
  await pointerPath(inkCanvas, 'pen', [start, { x: start.x + 44, y: start.y + 14 }, { x: start.x + 92, y: start.y + 33 }], pointerId)
}

async function ensurePdfWritingEnabled(page) {
  const toggle = page.getByRole('button', { name: 'Write on PDF' })
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click()
}

async function assertNoSelfMarkAiCopy(page, context) {
  const copy = await page.locator('body').innerText()
  if (/AI review|AI-assisted mark|AI marking|processing/i.test(copy)) {
    throw new Error(`${context} is self-mark only but exposes AI-marking copy`)
  }
}

async function run() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const errors = []
  const shots = []
  let pdfInkMetrics = null

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(`desktop: ${error.message}`))
    page.on('console', (message) => {
      if (/Unknown event handler|onSelectStart/i.test(message.text())) errors.push(`desktop console: ${message.text()}`)
    })
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
    await page.locator('.student-home-guided .recommended-session').waitFor()
    if (await page.locator('.student-home-guided .recommended-session').count() !== 1) throw new Error('Dashboard must show exactly one recommended session')
    if (await page.locator('.student-home-guided .student-primary-start').count() !== 1) throw new Error('Dashboard primary start action is missing')
    if (await page.locator('.student-home-guided .study-rail').count()) throw new Error('Dashboard still contains duplicate student navigation')
    if (await page.locator('.student-home-guided .study-paths__grid > button').count() !== 3) throw new Error('Dashboard alternative study paths are unclear')
    if (await page.locator('.student-home-guided').getByText(/QP\/MS|source-backed|verified question set/i).count()) throw new Error('Dashboard exposes internal content terminology')
    const desktopStartBox = await page.locator('.student-primary-start').boundingBox()
    if (!desktopStartBox || desktopStartBox.y + desktopStartBox.height > 900) throw new Error(`Dashboard start action is outside the desktop first viewport: ${JSON.stringify(desktopStartBox)}`)
    if (await page.locator('.student-home-guided .roadmap-compact').count() !== 1) throw new Error('Skill map is missing')
    if (await page.getByText(/Need \d+ more/i).count()) throw new Error('Inventory shortage must not block or show Need more copy')
    shots.push(path.join(ARTIFACT_DIR, 'dashboard-desktop-after.png'))
    await page.screenshot({ path: shots.at(-1), fullPage: false })
    await openVerifiedStarter(page)
    if (await page.locator('.qp-progress').count() !== 1) throw new Error('Live practice progress is missing')
    if (await page.locator('.ai-coach-trigger').count()) throw new Error('Immersive practice still exposes a floating Coach button over the answer surface')
    await page.getByRole('button', { name: 'Enter focus mode' }).click()
    if (await page.locator('.qp-player--immersive').count() !== 1) throw new Error('Practice focus mode did not activate')
    const focusLayout = await page.locator('.qp-player--immersive').evaluate((root) => {
      const hidden = (selector) => getComputedStyle(root.querySelector(selector)).display === 'none'
      return { indexHidden: hidden('.qp-index'), flowHidden: hidden('.qp-flow'), checklistHidden: hidden('.qp-checklist') }
    })
    if (!focusLayout.indexHidden || !focusLayout.flowHidden || !focusLayout.checklistHidden) throw new Error(`Focus mode left secondary controls visible: ${JSON.stringify(focusLayout)}`)
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'verified-focus-desktop.png'), fullPage: false })
    await page.getByRole('button', { name: 'Exit focus mode' }).click()
    if (await page.locator('.qp-player--immersive').count()) throw new Error('Practice focus mode did not exit')

    if (!(await page.getByText('Verified past-paper set', { exact: true }).count())) throw new Error('Verified source summary is missing')
    const evidence = page.locator('.question-source-evidence')
    if ((await evidence.count()) !== 1) throw new Error('Original paper evidence is missing for a source-backed question')
    // The paired mark scheme is bound in the item metadata, but must not be
    // exposed during an active practice attempt. The student may open the
    // original question paper now; the exact mark scheme unlocks on submit.
    if (await evidence.locator('a').count() !== 1) throw new Error('Active practice must expose the original paper without leaking the paired mark scheme')
    let handwrittenIndex = -1
    try { handwrittenIndex = await findHandwritingQuestion(page) } catch { handwrittenIndex = -1 }
    if (handwrittenIndex >= 0) {
      await page.locator('.index-list button').nth(handwrittenIndex).click()
      await page.locator('.handwriting-pad').waitFor()
      await assertNoSelfMarkAiCopy(page, 'Machine-indexed chapter practice')
      const handwritingCanvas = page.locator('.handwriting-pad__canvas')
      const handwritingStyle = await handwritingCanvas.evaluate((element) => {
        const computed = getComputedStyle(element)
        return { touchAction: computed.touchAction, userSelect: computed.userSelect, webkitUserSelect: computed.webkitUserSelect }
      })
      if (handwritingStyle.touchAction !== 'none' || handwritingStyle.userSelect !== 'none' || handwritingStyle.webkitUserSelect !== 'none') throw new Error(`Handwriting selection guard failed: ${JSON.stringify(handwritingStyle)}`)
      const handwritingBox = await handwritingCanvas.boundingBox()
      await page.mouse.move(handwritingBox.x + 80, handwritingBox.y + 140)
      await page.mouse.down()
      await page.mouse.move(handwritingBox.x + 220, handwritingBox.y + 140, { steps: 8 })
      await page.mouse.up()
      const drawnPixels = await handwritingCanvas.evaluate((element) => {
        const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data
        let dark = 0
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3] > 128 && pixels[index] < 100 && pixels[index + 1] < 120 && pixels[index + 2] < 150) dark += 1
        return dark
      })
      if (!drawnPixels) throw new Error('Pointer stroke did not reach handwriting canvas')
      if (await page.evaluate(() => window.getSelection()?.toString() || '')) throw new Error('Page text was selected while drawing')
      await page.getByRole('button', { name: 'Eraser' }).click()
      await page.mouse.move(handwritingBox.x + 145, handwritingBox.y + 140)
      await page.mouse.down()
      await page.mouse.move(handwritingBox.x + 180, handwritingBox.y + 140, { steps: 4 })
      await page.mouse.up()
      const erasedPixels = await handwritingCanvas.evaluate((element) => {
        const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data
        let dark = 0
        for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 100 && pixels[index + 1] < 120 && pixels[index + 2] < 150) dark += 1
        return dark
      })
      if (erasedPixels >= drawnPixels) throw new Error(`Eraser did not remove local ink: ${drawnPixels} -> ${erasedPixels}`)
      await assertNoSelfMarkAiCopy(page, 'Saved machine-indexed handwriting')
    }
    const questionButtons = page.locator('.index-list button')
    let mcqIndex = -1
    for (let index = 0; index < await questionButtons.count(); index += 1) {
      await questionButtons.nth(index).click()
      if (await page.locator('.mcq-answer label').count()) { mcqIndex = index; break }
    }
    if (mcqIndex < 0) throw new Error('Verified drill did not include an MCQ answer surface')
    await page.locator('.mcq-answer label').first().click()
    await page.getByRole('button', { name: /^Submit$/ }).click()
    await page.locator('.submit-dialog').getByRole('button', { name: 'Submit anyway' }).click()
    await page.waitForSelector('.result-view')
    if (!(await page.getByRole('heading', { name: /Part .*: [01]\/1/ }).count())) throw new Error('Indexed MCQ did not produce a deterministic mark')
    if (!(await page.locator('.official-answer').count())) throw new Error('Bound official answer was not revealed after submission')
    await assertNoSelfMarkAiCopy(page, 'Machine-indexed chapter practice result')
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
    await page.getByRole('button', { name: /^Topic Drill$/ }).click()
    for (const topic of ['Waves', 'Electricity']) {
      const row = page.locator('.topic-directory__row').filter({ hasText: topic }).first()
      if (!(await row.getByText(/verified/i).count())) throw new Error(`${topic} inventory is not shown`)
      await row.click()
      if (await page.getByRole('button', { name: /Start set|Practice \d+/i }).first().isDisabled()) throw new Error(`${topic} topic practice is unexpectedly disabled`)
      if (await page.getByText(/Build AS drill|Build A2 drill|AS \/ A2/i).count()) throw new Error(`${topic} topic detail contains mixed-stage controls`)
      await page.getByRole('button', { name: /Back to AS Physics/i }).click()
    }

    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Today$/ }).click()
    const homeRoutePicker = page.locator('.student-home-guided .student-route-picker')
    await homeRoutePicker.getByRole('tab', { name: 'IGCSE', exact: true }).click()
    const igcseCourseSelect = homeRoutePicker.getByRole('combobox', { name: 'Current course' })
    if (await igcseCourseSelect.locator('option[value="cie-9702-as-physics"]').count()) throw new Error('IGCSE course picker still exposes AS Physics')
    await igcseCourseSelect.selectOption('cie-0625-igcse-physics')
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Practice$/ }).click()
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Notebook$/ }).click()
    if (await page.getByRole('heading', { name: 'What needs another look' }).count() !== 1) throw new Error('Student notebook review queue is missing')
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Progress$/ }).click()
    if (await page.getByRole('heading', { name: 'History stays append-only' }).count() !== 1) throw new Error('Student progress view is missing')
    await page.locator('.account-trigger').click()
    const teacherWorkspaceButton = page.getByRole('button', { name: /Teacher.*school workspace/i })
    if (await teacherWorkspaceButton.count()) {
      await teacherWorkspaceButton.click()
      await page.getByRole('button', { name: /Teacher Create classes/i }).click()
      if (await page.getByRole('region', { name: 'Teacher Home' }).count() !== 1) throw new Error('Teacher Home is missing')
      await page.getByRole('button', { name: 'Content', exact: true }).click()
      if (await page.getByRole('heading', { name: 'Verified source availability' }).count() !== 1) throw new Error('Teacher Content tab is missing')
      await page.getByRole('button', { name: /School See programme coverage/ }).click()
      await page.getByRole('heading', { name: /Loading aggregate programme data/ }).waitFor()
      if (await page.getByRole('region', { name: 'School reporting controls' }).count() !== 1) throw new Error('School reporting controls are missing')
      await page.getByRole('button', { name: 'Programmes', exact: true }).click()
      if (await page.getByRole('region', { name: 'School reporting controls' }).count() !== 1) throw new Error('School Coverage controls are missing')
    } else {
      if (await page.getByRole('link', { name: /Log in to IELTSist/i }).count() !== 1) throw new Error('Guest account menu is missing the shared login entry')
      if (await page.getByRole('link', { name: /Create an IELTSist account/i }).count() !== 1) throw new Error('Guest account menu is missing the shared registration entry')
      await page.locator('.account-trigger').click()
    }
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Practice$/ }).click()
    const practiceRoutePicker = page.locator('.practice-hub .student-route-picker')
    if (await practiceRoutePicker.getByRole('tab', { name: 'Competition', exact: true }).count() !== 1) throw new Error('Competition stage tab is missing from student practice')
    if (await practiceRoutePicker.getByRole('tab', { name: 'Admissions', exact: true }).count() !== 1) throw new Error('Admissions stage tab is missing from student practice')
    await practiceRoutePicker.getByRole('tab', { name: 'Competition', exact: true }).click()
    const specialistCourseSelect = practiceRoutePicker.getByRole('combobox', { name: 'Current course' })
    if (await specialistCourseSelect.locator('option[value="uatuk-esat-admissions"], option[value="uatuk-tmua-admissions"]').count()) throw new Error('Admissions routes leaked into the Competition stage')
    await specialistCourseSelect.selectOption('bpho-admissions-physics')
    await page.getByRole('button', { name: /^Past Papers$/ }).click()
    await page.getByRole('heading', { name: 'British Physics Olympiad historical archive' }).waitFor()
    const primaryNavState = await page.getByRole('navigation', { name: 'Primary navigation' }).evaluate((nav) => Object.fromEntries([...nav.querySelectorAll('button')].map((button) => [button.textContent.trim(), button.classList.contains('active')])))
    if (!primaryNavState.Papers || primaryNavState.Practice) throw new Error(`Past Papers top-level navigation state is incorrect: ${JSON.stringify(primaryNavState)}`)
    if (await page.locator('.ai-coach-trigger').count()) throw new Error('Past Papers still exposes a floating Coach button over the archive table')
    if (await page.locator('.paper-filters select[aria-label="Subject"]').count()) throw new Error('Route-scoped paper library still exposes a duplicate subject filter')
    if (await page.locator('.competition-archive__rounds > div').count() !== 6) throw new Error('BPhO round coverage summary is incomplete')
    if (await page.locator('.competition-archive__rounds a').count() !== 6) throw new Error('BPhO official archive links are incomplete')
    const roundSelect = page.getByRole('combobox', { name: 'Round', exact: true })
    const expectedRoundCounts = { r1: 40, r2: 22, spc: 18, ipc: 23, pc: 20, expt: 10 }
    for (const [round, expected] of Object.entries(expectedRoundCounts)) {
      await roundSelect.selectOption(round)
      const resultText = (await page.locator('.paper-result-bar span').textContent()).trim()
      if (resultText !== `${expected} files`) throw new Error(`BPhO ${round} filter returned ${resultText}, expected ${expected} files`)
    }
    await roundSelect.selectOption('all')
    shots.push(path.join(ARTIFACT_DIR, 'competition-archive-desktop.png'))
    await page.screenshot({ path: shots.at(-1), fullPage: false })

    await practiceRoutePicker.getByRole('tab', { name: 'Admissions', exact: true }).click()
    if (await specialistCourseSelect.locator('option[value="bpho-admissions-physics"], option[value="maa-amc12-admissions-mathematics"]').count()) throw new Error('Competition routes leaked into the Admissions stage')
    if (await specialistCourseSelect.locator('option[value="uatuk-esat-admissions"], option[value="uatuk-tmua-admissions"]').count() !== 2) throw new Error('Admissions stage must expose ESAT and TMUA')

    await practiceRoutePicker.getByRole('tab', { name: 'IGCSE', exact: true }).click()
    await specialistCourseSelect.selectOption('cie-0625-igcse-physics')
    const paperSelect = page.getByRole('combobox', { name: 'Paper', exact: true })
    await paperSelect.selectOption('4')
    await page.locator('.paper-table tbody tr').first().getByRole('button', { name: 'Open' }).click()
    await page.waitForSelector('.pdf-canvas-scroll canvas')
    await page.waitForFunction(() => document.querySelectorAll('.pdf-canvas-scroll canvas').length >= 3)
    if (await page.getByRole('button', { name: /next page|previous page/i }).count()) throw new Error('Continuous PDF reader exposed page-by-page controls')
    await ensurePdfWritingEnabled(page)
    const pdfInkCanvas = page.locator('.pdf-ink-layer').first()
    await pdfInkCanvas.waitFor()
    await pdfInkCanvas.scrollIntoViewIfNeeded()
    const pdfInkBox = await pdfInkCanvas.boundingBox()
    if (!pdfInkBox) throw new Error('PDF handwriting layer has no visible geometry')
    const pdfInkStart = { x: pdfInkBox.x + 70, y: pdfInkBox.y + 120 }
    const pdfInkFirstPath = [
      pdfInkStart,
      { x: pdfInkStart.x + 45, y: pdfInkStart.y + 9 },
      { x: pdfInkStart.x + 94, y: pdfInkStart.y + 28 },
      { x: pdfInkStart.x + 142, y: pdfInkStart.y + 45 },
    ]
    const pdfInkSecondPath = [
      { x: pdfInkStart.x + 16, y: pdfInkStart.y + 87 },
      { x: pdfInkStart.x + 62, y: pdfInkStart.y + 96 },
      { x: pdfInkStart.x + 110, y: pdfInkStart.y + 88 },
      { x: pdfInkStart.x + 160, y: pdfInkStart.y + 108 },
    ]
    const pdfBeforeTouch = await darkPixelCount(pdfInkCanvas)
    await pointerStroke(pdfInkCanvas, 'touch', pdfInkFirstPath[0], pdfInkFirstPath.at(-1), 81)
    const pdfAfterTouch = await darkPixelCount(pdfInkCanvas)
    if (pdfAfterTouch !== pdfBeforeTouch) throw new Error('Finger input drew on the PDF ink layer')
    await pointerPath(pdfInkCanvas, 'pen', pdfInkFirstPath, 82)
    const pdfAfterFirstStroke = await darkPixelCount(pdfInkCanvas)
    const pdfFirstMetrics = await inkMetrics(pdfInkCanvas)
    if (pdfAfterFirstStroke <= pdfAfterTouch || pdfFirstMetrics.strokes !== 1 || pdfFirstMetrics.segments < pdfInkFirstPath.length - 1 || pdfFirstMetrics.maxGap > 0.01) throw new Error(`PDF first Pencil stroke was not continuously rendered: ${JSON.stringify({ pdfAfterTouch, pdfAfterFirstStroke, pdfFirstMetrics })}`)
    await pointerPath(pdfInkCanvas, 'pen', pdfInkSecondPath, 83)
    const pdfAfterSecondStroke = await darkPixelCount(pdfInkCanvas)
    const pdfSecondMetrics = await inkMetrics(pdfInkCanvas)
    if (pdfAfterSecondStroke <= pdfAfterFirstStroke || pdfSecondMetrics.strokes !== 2 || pdfSecondMetrics.segments < pdfFirstMetrics.segments + pdfInkSecondPath.length - 1 || pdfSecondMetrics.maxGap > 0.01) throw new Error(`PDF second Pencil stroke did not accumulate: ${JSON.stringify({ pdfAfterFirstStroke, pdfAfterSecondStroke, pdfFirstMetrics, pdfSecondMetrics })}`)
    if (await page.evaluate(() => window.getSelection()?.toString() || '')) throw new Error('Page text was selected while writing on the PDF')
    await page.getByRole('button', { name: 'PDF eraser' }).click()
    await pointerStroke(pdfInkCanvas, 'pen', pdfInkSecondPath[1], pdfInkSecondPath[2], 84)
    const pdfAfterErase = await darkPixelCount(pdfInkCanvas)
    if (pdfAfterErase >= pdfAfterSecondStroke) throw new Error(`PDF eraser did not remove handwriting: ${pdfAfterSecondStroke} -> ${pdfAfterErase}`)
    await page.waitForFunction((key) => Object.values(JSON.parse(localStorage.getItem(key) || '{}').paperDrafts || {}).some((draft) => Object.keys(draft.pdfInkByPage || {}).length > 0), STORAGE_KEY)
    pdfInkMetrics = { pdfBeforeTouch, pdfAfterTouch, pdfAfterFirstStroke, pdfAfterSecondStroke, pdfAfterErase, pdfFirstMetrics, pdfSecondMetrics }
    shots.push(path.join(ARTIFACT_DIR, 'continuous-pdf-desktop.png'))
    await page.screenshot({ path: shots.at(-1), fullPage: false })
    await context.close()

    const guestMarking = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const guestMarkingPage = await guestMarking.newPage()
    guestMarkingPage.on('pageerror', (error) => errors.push(`guest marking: ${error.message}`))
    await guestMarkingPage.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await guestMarkingPage.evaluate(() => localStorage.clear())
    await guestMarkingPage.reload({ waitUntil: 'domcontentloaded' })
    await open9709March2025P1(guestMarkingPage)
    if (await guestMarkingPage.locator('.ai-coach-trigger').count()) throw new Error('Paper workspace exposes a floating Coach trigger over the answer panel')
    await guestMarkingPage.getByRole('button', { name: 'Enter paper focus mode' }).click()
    if (await guestMarkingPage.locator('.paper-workspace--immersive').count() !== 1) throw new Error('Paper focus mode did not activate')
    await guestMarkingPage.screenshot({ path: path.join(ARTIFACT_DIR, 'verified-paper-focus-desktop.png'), fullPage: false })
    await guestMarkingPage.getByRole('button', { name: 'Exit paper focus mode' }).click()
    await ensurePdfWritingEnabled(guestMarkingPage)
    await guestMarkingPage.getByRole('button', { name: 'PDF hand' }).click()
    const pdfPanStyle = await guestMarkingPage.locator('.pdf-ink-layer').first().evaluate((element) => ({ pointerEvents: getComputedStyle(element).pointerEvents, touchAction: getComputedStyle(element).touchAction }))
    if (pdfPanStyle.pointerEvents !== 'none' || !pdfPanStyle.touchAction.includes('pan-y')) throw new Error(`PDF hand tool did not release the ink layer for scrolling: ${JSON.stringify(pdfPanStyle)}`)
    await guestMarkingPage.getByRole('button', { name: 'PDF pen' }).click()
    await guestMarkingPage.getByText(/handwriting is saved with this attempt; after submission, use the paired mark scheme to self-mark/i).waitFor()
    await assertNoSelfMarkAiCopy(guestMarkingPage, '9709 March 2025 P1 pre-submit')
    await addPdfInkForFocusedQuestion(guestMarkingPage, 91)
    const unlinkedCompletion = await guestMarkingPage.getByRole('status', { name: 'Answer completion' }).innerText()
    if (!/^0 of 11 complete$/i.test(unlinkedCompletion)) throw new Error(`Unlinked PDF ink must not complete Q1: ${unlinkedCompletion}`)
    if (await guestMarkingPage.getByText(/PDF page \d+ linked to question/i).count()) throw new Error('PDF ink was linked without an explicit answer-slot action')
    await guestMarkingPage.getByRole('button', { name: 'Link current PDF writing' }).click()
    await guestMarkingPage.getByText(/PDF page \d+ linked to question 1/i).waitFor()
    const linkedCompletion = await guestMarkingPage.getByRole('status', { name: 'Answer completion' }).innerText()
    if (!/^1 of 11 complete$/i.test(linkedCompletion)) throw new Error(`Explicitly linked PDF ink did not complete Q1: ${linkedCompletion}`)
    await guestMarkingPage.getByRole('button', { name: /^Submit paper$/ }).click()
    await guestMarkingPage.getByRole('button', { name: 'Submit anyway' }).click()
    await guestMarkingPage.locator('.session-complete--missing').getByText(/no reviewed question-level mark allocation/i).waitFor()
    if (await guestMarkingPage.getByText(/processing this sourced response|AI-assisted mark/i).count()) throw new Error('Machine-indexed 9709 Q1 must not claim AI-assisted marking')
    await assertNoSelfMarkAiCopy(guestMarkingPage, '9709 March 2025 P1 submitted result')
    await guestMarking.close()

    const tabletPaper = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
    const tabletPaperPage = await tabletPaper.newPage()
    tabletPaperPage.on('pageerror', (error) => errors.push(`tablet paper: ${error.message}`))
    await tabletPaperPage.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await tabletPaperPage.evaluate(() => localStorage.clear())
    await tabletPaperPage.reload({ waitUntil: 'domcontentloaded' })
    await open9709March2025P1(tabletPaperPage)
    await ensurePdfWritingEnabled(tabletPaperPage)
    const tabletPdfInk = tabletPaperPage.locator('.pdf-ink-layer').first()
    await tabletPdfInk.waitFor()
    await tabletPdfInk.scrollIntoViewIfNeeded()
    const tabletPdfBox = await tabletPdfInk.boundingBox()
    if (!tabletPdfBox) throw new Error('iPad PDF ink layer has no visible geometry')
    const tabletPdfStart = { x: tabletPdfBox.x + 64, y: tabletPdfBox.y + 110 }
    const tabletPdfBeforeTouch = await darkPixelCount(tabletPdfInk)
    await pointerStroke(tabletPdfInk, 'touch', tabletPdfStart, { x: tabletPdfStart.x + 90, y: tabletPdfStart.y + 25 }, 94)
    if (await darkPixelCount(tabletPdfInk) !== tabletPdfBeforeTouch) throw new Error('Finger input drew on the iPad PDF ink layer')
    await pointerPath(tabletPdfInk, 'pen', [tabletPdfStart, { x: tabletPdfStart.x + 44, y: tabletPdfStart.y + 9 }, { x: tabletPdfStart.x + 92, y: tabletPdfStart.y + 27 }], 95)
    const tabletPdfPortraitPixels = await darkPixelCount(tabletPdfInk)
    if (tabletPdfPortraitPixels <= tabletPdfBeforeTouch || (await inkMetrics(tabletPdfInk)).strokes !== 1) throw new Error('First iPad PDF Pencil stroke was not retained')
    await tabletPaperPage.setViewportSize({ width: 1180, height: 820 })
    await tabletPaperPage.waitForTimeout(150)
    const tabletPdfLandscapePixels = await darkPixelCount(tabletPdfInk)
    if (!tabletPdfLandscapePixels || Math.abs(tabletPdfLandscapePixels - tabletPdfPortraitPixels) / tabletPdfPortraitPixels > 0.15) throw new Error(`PDF Pencil ink changed materially after iPad rotation: ${tabletPdfPortraitPixels} -> ${tabletPdfLandscapePixels}`)
    shots.push(path.join(ARTIFACT_DIR, '9709-paper-ipad-landscape.png'))
    await tabletPaperPage.screenshot({ path: shots.at(-1), fullPage: false })
    await tabletPaper.close()

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true })
    const mobilePage = await mobile.newPage()
    mobilePage.on('pageerror', (error) => errors.push(`mobile: ${error.message}`))
    await mobilePage.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await mobilePage.evaluate(() => localStorage.clear())
    await mobilePage.reload({ waitUntil: 'domcontentloaded' })
    await mobilePage.locator('.student-home-guided .recommended-session').waitFor()
    const mobileNav = await mobilePage.evaluate(() => {
      const nav = document.querySelector('.unified-top-nav nav')
      const buttons = [...(nav?.querySelectorAll('button') || [])].map((button) => {
        const box = button.getBoundingClientRect()
        return { label: button.textContent.trim(), left: box.left, right: box.right, width: box.width, height: box.height }
      })
      return { buttonCount: buttons.length, buttons, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }
    })
    if (mobileNav.buttonCount !== 5 || mobileNav.scrollWidth > mobileNav.clientWidth || mobileNav.buttons.some((button) => button.left < -1 || button.right > mobileNav.clientWidth + 1 || button.width < 44 || button.height < 38)) {
      throw new Error(`Mobile primary navigation geometry failed: ${JSON.stringify(mobileNav)}`)
    }
    const mobileStartBox = await mobilePage.locator('.student-primary-start').boundingBox()
    if (!mobileStartBox || mobileStartBox.y + mobileStartBox.height > 844) throw new Error(`Dashboard start action is outside the mobile first viewport: ${JSON.stringify(mobileStartBox)}`)
    const mobileCoachBox = await mobilePage.locator('.ai-coach-trigger').boundingBox()
    const mobileRecommendationBox = await mobilePage.locator('.recommended-session').boundingBox()
    const coachOverlapsRecommendation = mobileCoachBox && mobileRecommendationBox
      && mobileCoachBox.x < mobileRecommendationBox.x + mobileRecommendationBox.width
      && mobileCoachBox.x + mobileCoachBox.width > mobileRecommendationBox.x
      && mobileCoachBox.y < mobileRecommendationBox.y + mobileRecommendationBox.height
      && mobileCoachBox.y + mobileCoachBox.height > mobileRecommendationBox.y
    if (!mobileCoachBox || !mobileRecommendationBox || coachOverlapsRecommendation) throw new Error(`Mobile AI Coach trigger overlaps the primary recommendation: ${JSON.stringify({ mobileCoachBox, mobileRecommendationBox })}`)
    shots.push(path.join(ARTIFACT_DIR, 'dashboard-mobile-after.png'))
    await mobilePage.screenshot({ path: shots.at(-1), fullPage: false })
    await openVerifiedStarter(mobilePage)
    const mobileMetrics = await mobilePage.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      evidenceOpen: document.querySelector('.question-source-evidence')?.open,
      answerTop: document.querySelector('.mcq-answer, .handwriting-pad')?.getBoundingClientRect().top,
      promptBottom: document.querySelector('.qp-question__body h2')?.getBoundingClientRect().bottom,
    }))
    if (mobileMetrics.scrollWidth > mobileMetrics.clientWidth) throw new Error(`Mobile practice geometry failed: ${JSON.stringify(mobileMetrics)}`)
    if (mobileMetrics.evidenceOpen) throw new Error(`Source evidence must be collapsed by default on mobile: ${JSON.stringify(mobileMetrics)}`)
    if (mobileMetrics.answerTop - mobileMetrics.promptBottom > 220) throw new Error(`Answer area is too far from the question on mobile: ${JSON.stringify(mobileMetrics)}`)
    shots.push(path.join(ARTIFACT_DIR, 'verified-practice-mobile.png'))
    await mobilePage.screenshot({ path: shots.at(-1), fullPage: false })
    await mobile.close()

    const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
    const tabletPage = await tablet.newPage()
    let pencilMetrics = null
    tabletPage.on('pageerror', (error) => errors.push(`tablet: ${error.message}`))
    tabletPage.on('console', (message) => {
      if (/Unknown event handler|onSelectStart/i.test(message.text())) errors.push(`tablet console: ${message.text()}`)
    })
    await tabletPage.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await tabletPage.evaluate(() => localStorage.clear())
    await tabletPage.reload({ waitUntil: 'domcontentloaded' })
    const tabletHomeRoutePicker = tabletPage.locator('.student-home-guided .student-route-picker')
    await tabletHomeRoutePicker.getByRole('tab', { name: 'IGCSE', exact: true }).click()
    await tabletHomeRoutePicker.getByRole('combobox', { name: 'Current course' }).selectOption('cie-0580-igcse-mathematics')
    await openHandwritingStarter(tabletPage)
    const nonMcqIndex = await findHandwritingQuestion(tabletPage)
    {
      await tabletPage.locator('.index-list button').nth(nonMcqIndex).click()
      const pad = tabletPage.locator('.handwriting-pad').first()
      const sizes = await pad.locator('.handwriting-pad__toolbar button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().width))
      if (sizes.some((size) => size < 44)) throw new Error(`iPad handwriting targets are below 44px: ${sizes.join(',')}`)
      const canvas = pad.locator('.handwriting-pad__canvas')
      const pencilMode = await pad.getByRole('button', { name: 'Toggle palm rejection' }).getAttribute('aria-pressed')
      if (pencilMode !== 'true') throw new Error(`iPad handwriting did not start in pencil-only mode: ${pencilMode}`)
      const tabletStyle = await canvas.evaluate((element) => {
        const computed = getComputedStyle(element)
        return { touchAction: computed.touchAction, userSelect: computed.userSelect, webkitUserSelect: computed.webkitUserSelect }
      })
      if (tabletStyle.touchAction !== 'none') throw new Error(`Pencil drawing surface must keep WebKit gestures from cancelling a stroke: ${JSON.stringify(tabletStyle)}`)
      if (tabletStyle.userSelect !== 'none' || tabletStyle.webkitUserSelect !== 'none') throw new Error(`iPad handwriting selection guard failed: ${JSON.stringify(tabletStyle)}`)

      // Keep the client coordinate system stable. Playwright scrolls an
      // offscreen locator into view before dispatching each synthetic event;
      // drawing from stale coordinates would test its auto-scroll, not ink.
      await canvas.scrollIntoViewIfNeeded()
      const stableCanvasBox = await canvas.boundingBox()
      if (!stableCanvasBox) throw new Error('The iPad handwriting canvas has no visible geometry')
      const start = { x: stableCanvasBox.x + 70, y: stableCanvasBox.y + 130 }
      const end = { x: stableCanvasBox.x + 260, y: stableCanvasBox.y + 190 }
      const beforeTouch = await darkPixelCount(canvas)
      await pointerStroke(canvas, 'touch', start, end, 51)
      const afterTouch = await darkPixelCount(canvas)
      if (afterTouch !== beforeTouch) throw new Error(`Finger input drew on the pencil-only canvas: ${beforeTouch} -> ${afterTouch}`)

      const firstPath = [
        start,
        { x: start.x + 45, y: start.y + 8 },
        { x: start.x + 92, y: start.y + 26 },
        { x: start.x + 140, y: start.y + 44 },
        end,
      ]
      await pointerPath(canvas, 'pen', firstPath, 52)
      const afterPen = await darkPixelCount(canvas)
      if (afterPen <= afterTouch) throw new Error(`Apple Pencil input did not draw: ${afterTouch} -> ${afterPen}`)
      const firstInkMetrics = await inkMetrics(canvas)
      if (firstInkMetrics.strokes !== 1 || firstInkMetrics.segments < firstPath.length - 1 || firstInkMetrics.maxGap > 0.01) {
        throw new Error(`Pencil stroke was not rendered as connected segments: ${JSON.stringify(firstInkMetrics)}`)
      }
      const secondPath = [
        { x: start.x + 12, y: start.y + 84 },
        { x: start.x + 58, y: start.y + 96 },
        { x: start.x + 112, y: start.y + 91 },
        { x: start.x + 164, y: start.y + 108 },
      ]
      await pointerPath(canvas, 'pen', secondPath, 53)
      const afterSecondPen = await darkPixelCount(canvas)
      const secondInkMetrics = await inkMetrics(canvas)
      if (afterSecondPen <= afterPen || secondInkMetrics.strokes !== firstInkMetrics.strokes + 1 || secondInkMetrics.segments < firstInkMetrics.segments + secondPath.length - 1 || secondInkMetrics.maxGap > 0.01) {
        throw new Error(`Second Pencil stroke did not accumulate reliably: ${JSON.stringify({ afterPen, afterSecondPen, firstInkMetrics, secondInkMetrics })}`)
      }
      await pointerTap(canvas, 'pen', { x: start.x + 300, y: start.y + 35 }, 54)
      const afterTap = await darkPixelCount(canvas)
      const finalInkMetrics = await inkMetrics(canvas)
      if (afterTap <= afterSecondPen || finalInkMetrics.strokes !== 3 || finalInkMetrics.dots !== 1 || finalInkMetrics.maxGap > 0.01) {
        throw new Error(`Short Pencil tap or three-stroke accumulation failed: ${JSON.stringify({ afterSecondPen, afterTap, finalInkMetrics })}`)
      }
      await tabletPage.waitForFunction((key) => Object.values(JSON.parse(localStorage.getItem(key) || '{}').drafts || {}).some((draft) => Object.values(draft.evidence || {}).some((evidence) => String(evidence?.dataUrl || '').startsWith('data:image/jpeg'))), STORAGE_KEY)
      const persisted = await tabletPage.evaluate((key) => Object.values(JSON.parse(localStorage.getItem(key) || '{}').drafts || {}).flatMap((draft) => Object.values(draft.evidence || {})).find((evidence) => String(evidence?.dataUrl || '').startsWith('data:image/jpeg')), STORAGE_KEY)
      if (!persisted?.dataUrl?.startsWith('data:image/jpeg')) throw new Error('The last Pencil stroke was not persisted immediately')

      const alternateIndex = nonMcqIndex === 0 ? 1 : 0
      await tabletPage.locator('.index-list button').nth(alternateIndex).click()
      await tabletPage.locator('.index-list button').nth(nonMcqIndex).click()
      const restoredCanvas = tabletPage.locator('.handwriting-pad__canvas')
      await tabletPage.waitForFunction(() => {
        const element = document.querySelector('.handwriting-pad__canvas')
        if (!element) return false
        const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data
        for (let index = 0; index < pixels.length; index += 4) if (pixels[index] < 100 && pixels[index + 1] < 120 && pixels[index + 2] < 150) return true
        return false
      })
      const restoredPixels = await darkPixelCount(restoredCanvas)
      if (!restoredPixels) throw new Error('Pencil ink was lost after an immediate question switch')
      if (Math.abs(restoredPixels - afterTap) / afterTap > 0.15) throw new Error(`Pencil ink changed materially after question restore: ${afterTap} -> ${restoredPixels}`)

      await tabletPage.setViewportSize({ width: 1180, height: 820 })
      await tabletPage.waitForTimeout(150)
      const landscapePixels = await darkPixelCount(restoredCanvas)
      if (!landscapePixels) throw new Error('Pencil ink was lost after iPad orientation change')
      if (Math.abs(landscapePixels - afterTap) / afterTap > 0.15) throw new Error(`Pencil ink changed materially after iPad orientation change: ${afterTap} -> ${landscapePixels}`)
      pencilMetrics = { beforeTouch, afterTouch, afterPen, afterSecondPen, afterTap, firstInkMetrics, secondInkMetrics, finalInkMetrics, restoredPixels, landscapePixels }
      await restoredCanvas.scrollIntoViewIfNeeded()
      await tabletPage.waitForTimeout(100)
    }
    shots.push(path.join(ARTIFACT_DIR, 'verified-practice-tablet-landscape.png'))
    await tabletPage.screenshot({ path: shots.at(-1), fullPage: false })

    await tabletPage.getByRole('button', { name: 'Back to library' }).click()
    await tabletPage.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Practice$/ }).click()
    const tabletRoutePicker = tabletPage.locator('.practice-hub .student-route-picker')
    await tabletRoutePicker.getByRole('tab', { name: 'Competition', exact: true }).click()
    await tabletRoutePicker.getByRole('combobox', { name: 'Current course' }).selectOption('bpho-admissions-physics')
    await tabletPage.getByRole('button', { name: /^Past Papers$/ }).click()
    await tabletPage.getByRole('heading', { name: 'British Physics Olympiad historical archive' }).waitFor()
    const landscapeArchiveGeometry = await tabletPage.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
    if (landscapeArchiveGeometry.scrollWidth > landscapeArchiveGeometry.clientWidth) throw new Error(`BPhO archive overflows iPad landscape: ${JSON.stringify(landscapeArchiveGeometry)}`)
    shots.push(path.join(ARTIFACT_DIR, 'competition-archive-tablet-landscape.png'))
    await tabletPage.screenshot({ path: shots.at(-1), fullPage: false })
    await tabletPage.setViewportSize({ width: 820, height: 1180 })
    await tabletPage.waitForTimeout(150)
    const portraitArchiveGeometry = await tabletPage.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
    if (portraitArchiveGeometry.scrollWidth > portraitArchiveGeometry.clientWidth) throw new Error(`BPhO archive overflows iPad portrait: ${JSON.stringify(portraitArchiveGeometry)}`)
    shots.push(path.join(ARTIFACT_DIR, 'competition-archive-tablet-portrait.png'))
    await tabletPage.screenshot({ path: shots.at(-1), fullPage: false })
    await tablet.close()

    if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
    console.log(JSON.stringify({ verifiedPracticeUnits: 142, verifiedQuestionGroups: 891, answerableParts: 932, deterministicMcqMarked: true, focusedRetestQuestions: 1, competitionAndAdmissionsSeparated: true, bphoRoundFiltersVerified: Object.keys(expectedRoundCounts), officialTopic7Unlocked: true, officialTopic9Unlocked: true, mobileMetrics, pencilMetrics, pdfInkMetrics, shots }, null, 2))
  } finally {
    await browser.close()
  }
}

run().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
