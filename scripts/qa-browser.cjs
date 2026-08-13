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
  const matches = expectedLabel instanceof RegExp ? expectedLabel.test(copy) : copy.includes(expectedLabel)
  if (!matches) {
    throw new Error(`Session setup marking disclosure is incorrect: expected ${expectedLabel}, received ${copy}`)
  }
}

async function openVerifiedStarter(page) {
  const routePicker = page.locator('.student-home-guided .student-route-picker')
  await routePicker.getByRole('tab', { name: 'IGCSE', exact: true }).click()
  await routePicker.getByRole('combobox', { name: 'Current course' }).selectOption('cie-0580-igcse-mathematics')
  await page.getByRole('heading', { name: /IGCSE Mathematics · Number/i }).waitFor()
  await page.locator('.student-primary-start').click()
  await page.waitForSelector('.session-setup, .question-block')
  if (await page.locator('.session-setup').count()) {
    await assertSessionMarkingDisclosure(page, /^AI-assisted review after submission\b/)
    await startSession(page)
  }
  if ((await page.locator('.index-list button').count()) < 1) throw new Error('Verified starter did not contain a source-backed question')
  if ((await page.locator('.question-block').count()) !== 1) throw new Error('Workspace must render one focused question')
}

async function assertVisibleSourceMaterial(page, label) {
  const viewer = page.locator('.qp-question-asset').first()
  await viewer.waitFor({ state: 'visible' })
  const image = viewer.locator('img')
  const metrics = await image.evaluate((element) => ({
    loaded: element.complete && element.naturalWidth > 0 && element.naturalHeight > 0,
    width: element.naturalWidth,
    height: element.naturalHeight,
    src: element.getAttribute('src') || '',
  }))
  if (!metrics.loaded) throw new Error(`${label} source image did not decode in the browser: ${JSON.stringify(metrics)}`)
  if (await page.locator('.question-source-evidence').count()) throw new Error(`${label} still hides primary source material behind the retired details disclosure`)
  const order = await page.locator('.qp-question__body').evaluate((body) => {
    const source = body.querySelector('.qp-question-asset')?.getBoundingClientRect()
    const prompt = body.querySelector('h2')?.getBoundingClientRect()
    return source && prompt ? { sourceBottom: source.bottom, promptTop: prompt.top } : null
  })
  if (!order || order.sourceBottom > order.promptTop) throw new Error(`${label} source material is not rendered before the structured prompt: ${JSON.stringify(order)}`)
  return metrics
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
    await assertSessionMarkingDisclosure(page, /^(Self-mark after submission|Mixed marking)\b/)
    await startSession(page)
  }
  else await page.locator('.question-block').waitFor()
}

async function assertPracticeSelfMarkPendingFlow(page) {
  const homeRoutePicker = page.locator('.student-home-guided .student-route-picker')
  await homeRoutePicker.getByRole('tab', { name: 'IGCSE', exact: true }).click()
  await homeRoutePicker.getByRole('combobox', { name: 'Current course' }).selectOption('cie-0580-igcse-mathematics')
  await page.locator('.student-primary-start').click()
  const topicRow = page.locator('.topic-directory__row').filter({ hasText: 'Algebra and graphs' }).first()
  await topicRow.waitFor()
  await topicRow.click()
  await page.getByRole('button', { name: /^Set 2\b/ }).click()
  await assertSessionMarkingDisclosure(page, /^Self-mark after submission\b/)
  await startSession(page)

  const canvas = page.locator('.handwriting-pad__canvas').first()
  await canvas.waitFor()
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Self-mark-only practice answer canvas has no visible geometry')
  await page.mouse.move(box.x + 70, box.y + 120)
  await page.mouse.down()
  await page.mouse.move(box.x + 220, box.y + 150, { steps: 6 })
  await page.mouse.up()

  await page.getByRole('button', { name: /^Submit$/ }).click()
  await page.waitForFunction(() => document.querySelector('.self-mark-result, .submit-dialog'))
  const submitDialog = page.locator('.submit-dialog')
  if (await submitDialog.count()) await submitDialog.getByRole('button', { name: 'Submit anyway' }).click()
  const pending = page.locator('.self-mark-result')
  await pending.waitFor()
  await pending.getByRole('heading', { name: 'Ready to self-mark' }).waitFor()
  const recordButton = pending.getByRole('button', { name: 'Record self-mark' })
  if (!await recordButton.isDisabled()) throw new Error('Blank self-mark input must keep Record self-mark disabled')
  const shot = path.join(ARTIFACT_DIR, 'practice-self-mark-pending-desktop.png')
  await page.screenshot({ path: shot, fullPage: false })

  const markInput = pending.getByRole('spinbutton', { name: /Self-mark for/i }).first()
  await markInput.fill('1')
  if (await recordButton.isDisabled()) throw new Error('A complete valid self-mark did not enable Record self-mark')
  await markInput.fill('')
  if (!await recordButton.isDisabled()) throw new Error('Clearing a self-mark input must disable Record self-mark')
  await markInput.fill('0')
  await recordButton.click()
  await page.getByRole('heading', { name: /^0\/\d+ marks$/ }).waitFor()
  return shot
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
  const answerSlotControl = page.getByRole('spinbutton', { name: 'Number of answer slots' })
  if (await answerSlotControl.count()) {
    const answerSlots = await answerSlotControl.inputValue()
    if (answerSlots !== '11') throw new Error(`9709 March 2025 P1 must expose all 11 printed questions, received ${answerSlots}`)
  }
  const answerIndexLabels = await page.locator('.paper-answer-sheet__index a').evaluateAll((links) => links.map((link) => link.getAttribute('aria-label')))
  if (answerIndexLabels.length !== 11 || answerIndexLabels.at(-1) !== 'Question 11, Not answered') throw new Error(`9709 March 2025 P1 must expose its official Q1-Q11 answer index, received ${JSON.stringify(answerIndexLabels)}`)
}

async function open0580March2025P1(page) {
  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Practice$/ }).click()
  const routePicker = page.locator('.practice-hub .student-route-picker')
  await routePicker.getByRole('tab', { name: 'IGCSE', exact: true }).click()
  await routePicker.getByRole('combobox', { name: 'Current course' }).selectOption('cie-0580-igcse-mathematics')
  await page.getByRole('button', { name: /^Past Papers$/ }).click()
  await page.locator('.paper-search input').fill('0580_m25_qp_12.pdf')
  const row = page.locator('.paper-table tbody tr').filter({ hasText: '0580_m25_qp_12.pdf' })
  await row.getByRole('button', { name: 'Open' }).click()
  await page.locator('.paper-workspace').waitFor()
  await page.waitForSelector('.pdf-canvas-scroll canvas')
  if (await page.getByRole('spinbutton', { name: 'Number of answer slots' }).count()) throw new Error('Reviewed 0580 March 2025 P1 must lock its official 26 answer slots')
  const answerIndex = page.locator('.paper-answer-sheet__index a')
  const answerIndexLabels = await answerIndex.evaluateAll((links) => links.map((link) => link.getAttribute('aria-label')))
  if (answerIndexLabels.length !== 26 || answerIndexLabels.at(-1) !== 'Question 26, Not answered') throw new Error(`Reviewed 0580 March 2025 P1 must expose its official Q1-Q26 answer index, received ${JSON.stringify(answerIndexLabels)}`)
}

async function assert0580LegacyDraftMigration(page) {
  const paperId = 'cie-0580-0580_m25_qp_12'
  const draftKey = await page.evaluate(async (id) => {
    const response = await fetch('/data/papers.json')
    const catalog = await response.json()
    const paper = catalog.items.find((item) => item.id === id)
    return paper?.pairKey || id
  }, paperId)
  await page.evaluate(({ key, paperKey, id }) => {
    const state = JSON.parse(localStorage.getItem(key) || '{}')
    state.profile = {
      ...(state.profile || {}),
      role: 'student',
      activeRouteId: 'cie-0580-igcse-mathematics',
      learningTrack: 'IGCSE',
      recentRouteIds: ['cie-0580-igcse-mathematics'],
    }
    state.paperDrafts = {
      ...(state.paperDrafts || {}),
      [paperKey]: {
        attemptId: 'legacy-0580-draft-q1-q12',
        paperId: id,
        pairKey: paperKey,
        questionCount: 12,
        elapsedSec: 37,
        answers: { 1: { response: 'legacy response must remain visible' } },
        pdfInkByPage: { 1: { inkDataUrl: 'data:image/png;base64,legacy' } },
        pdfInkQuestionMap: {},
        pdfInkMapVersion: 2,
        submitted: false,
      },
    }
    localStorage.setItem(key, JSON.stringify(state))
  }, { key: STORAGE_KEY, paperKey: draftKey, id: paperId })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await open0580March2025P1(page)
  const answerIndexLabels = await page.locator('.paper-answer-sheet__index a').evaluateAll((links) => links.map((link) => link.getAttribute('aria-label')))
  if (answerIndexLabels.length !== 26 || answerIndexLabels.at(-1) !== 'Question 26, Not answered') {
    throw new Error(`Legacy 0580 draft must migrate to official Q1-Q26 slots, received ${JSON.stringify(answerIndexLabels)}`)
  }
  const responseValues = await page.locator('textarea').evaluateAll((textareas) => textareas.map((textarea) => textarea.value))
  if (!responseValues.includes('legacy response must remain visible')) throw new Error(`Legacy Q1 response was not preserved during 26-slot migration: ${JSON.stringify(responseValues)}`)
  await page.waitForFunction(({ key, paperKey }) => JSON.parse(localStorage.getItem(key) || '{}').paperDrafts?.[paperKey]?.questionCount === 26, { key: STORAGE_KEY, paperKey: draftKey }, { timeout: 3000 })
  const migratedDraft = await page.evaluate(({ key, paperKey }) => JSON.parse(localStorage.getItem(key) || '{}').paperDrafts?.[paperKey], { key: STORAGE_KEY, paperKey: draftKey })
  if (migratedDraft?.questionCount !== 26 || migratedDraft?.answers?.['1']?.response !== 'legacy response must remain visible' || !migratedDraft?.pdfInkByPage?.['1']) {
    throw new Error(`Migrated 0580 draft was not persisted without losing Q1 data: ${JSON.stringify({ questionCount: migratedDraft?.questionCount, q1: migratedDraft?.answers?.['1']?.response, hasPdfInk: Boolean(migratedDraft?.pdfInkByPage?.['1']) })}`)
  }
  const metadata = page.locator('.paper-document-tabs > span')
  const geometry = await page.evaluate(() => {
    const tabs = document.querySelector('.paper-document-tabs')
    const metadata = tabs?.querySelector(':scope > span')
    const tabsBox = tabs?.getBoundingClientRect()
    const metadataBox = metadata?.getBoundingClientRect()
    return {
      documentWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      tabsWidth: tabsBox?.width || 0,
      tabsScrollWidth: tabs?.scrollWidth || 0,
      metadataWidth: metadataBox?.width || 0,
      metadataHeight: metadataBox?.height || 0,
      metadataText: metadata?.textContent?.trim() || '',
    }
  })
  if (!await metadata.isVisible() || !/P1|marks|min/.test(geometry.metadataText)) throw new Error(`0580 iPad metadata is not readable: ${JSON.stringify(geometry)}`)
  if (geometry.documentScrollWidth > geometry.documentWidth + 1 || geometry.tabsScrollWidth > geometry.tabsWidth + 1 || geometry.metadataWidth < 40 || geometry.metadataHeight < 12) {
    throw new Error(`0580 iPad metadata geometry overflowed or was clipped: ${JSON.stringify(geometry)}`)
  }
  const shot = path.join(ARTIFACT_DIR, '0580-legacy-draft-ipad.png')
  await page.screenshot({ path: shot, fullPage: false })
  return shot
}

async function submitOnePdfAnswerForSelfMark(page, pointerId, mobile = false) {
  await ensurePdfWritingEnabled(page)
  const inkCanvas = page.locator('.pdf-ink-layer').first()
  await inkCanvas.waitFor()
  await inkCanvas.scrollIntoViewIfNeeded()
  const box = await inkCanvas.boundingBox()
  if (!box) throw new Error('Self-mark PDF ink canvas is not visible')
  const start = { x: box.x + 64, y: box.y + 106 }
  await pointerPath(inkCanvas, 'pen', [start, { x: start.x + 48, y: start.y + 16 }, { x: start.x + 98, y: start.y + 31 }], pointerId)
  if (mobile) await page.locator('.paper-pane-switch [role="tab"]').filter({ hasText: 'Answer sheet' }).click()
  await page.getByRole('button', { name: 'Link current PDF writing' }).click()
  await page.getByText(/PDF page \d+ linked to question 1/i).waitFor()
  await page.getByRole('button', { name: /^Submit paper$/ }).click()
  await page.getByRole('button', { name: 'Submit anyway' }).click()
  await page.locator('.paper-answer-sheet__self-mark-summary').waitFor()
}

async function assert0580ReviewedMarkingEntryFlow(page, { mobile = false, pointerId, label }) {
  await open0580March2025P1(page)
  await submitOnePdfAnswerForSelfMark(page, pointerId, mobile)
  const summary = page.locator('.paper-answer-sheet__self-mark-summary')
  if (!await summary.isVisible()) throw new Error(`${label} 0580 submission did not show an immediately visible self-mark summary`)
  if (!/Scored responses\s*0\/1[\s\S]*Current total\s*Not scored/i.test(await summary.innerText())) throw new Error(`${label} 0580 self-mark summary has incorrect initial totals`)
  const loginAction = page.getByRole('link', { name: 'Sign in to mark with AI' })
  await loginAction.waitFor()
  const loginHref = await loginAction.getAttribute('href')
  if (!loginHref || !/^https:\/\/ieltsist\.com\//.test(loginHref) || !/auth=login/.test(loginHref) || !/returnTo=/.test(loginHref)) throw new Error(`${label} 0580 guest AI-marking action must route through the shared IELTSist login and return here`)
  if (await page.getByText(/no reviewed question-level mark allocation/i).count()) throw new Error(`${label} 0580 reviewed response incorrectly reports missing marking metadata`)
  await summary.getByRole('button', { name: 'Open mark scheme' }).click()
  const markSchemeTab = page.getByRole('button', { name: 'Mark scheme', exact: true })
  if (!await markSchemeTab.evaluate((button) => button.classList.contains('active'))) throw new Error(`${label} 0580 self-mark action did not open the paired mark scheme`)
  if (!/0580_m25_ms_12\.pdf/.test(await page.locator('.workspace-title').innerText())) throw new Error(`${label} 0580 self-mark action opened the wrong mark scheme`)
  if (mobile) await page.locator('.paper-pane-switch [role="tab"]').filter({ hasText: 'Answer sheet' }).click()
  await page.getByRole('spinbutton', { name: 'Awarded mark for question 1' }).fill('3')
  await page.getByText('Recorded for this attempt: 1/1 marks.').waitFor()
  if (!/Scored responses\s*1\/1[\s\S]*Current total\s*1\/1/i.test(await summary.innerText())) throw new Error(`${label} 0580 summary must total only scored responses against the reviewed mark allocation`)
  const reviewsBeforeSave = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').paperReviews?.length || 0, STORAGE_KEY)
  await summary.getByRole('button', { name: 'Save self-mark' }).click()
  await page.getByText('Saved result: 1/1 marks.').waitFor()
  const reviewsAfterSave = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').paperReviews?.length || 0, STORAGE_KEY)
  if (reviewsAfterSave !== reviewsBeforeSave + 1) throw new Error(`${label} 0580 first self-mark save must add exactly one review`)
  await summary.getByRole('button', { name: 'Save self-mark' }).click()
  await page.waitForTimeout(100)
  const reviewsAfterDuplicateSave = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}').paperReviews?.length || 0, STORAGE_KEY)
  if (reviewsAfterDuplicateSave !== reviewsAfterSave) throw new Error(`${label} 0580 repeated unchanged self-mark save created duplicate history`)
  const geometry = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  if (geometry.scrollWidth > geometry.clientWidth) throw new Error(`${label} 0580 self-mark flow overflows horizontally: ${JSON.stringify(geometry)}`)
  const shot = path.join(ARTIFACT_DIR, `0580-self-mark-${label}.png`)
  await page.screenshot({ path: shot, fullPage: false })
  return shot
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

async function assertReviewedAiCapability(page, context) {
  const capability = page.locator('.qp-marking-capability').first()
  await capability.waitFor()
  const copy = (await capability.innerText()).replace(/\s+/g, ' ').trim()
  if (!/AI-assisted marking/i.test(copy) || /Self-mark only/i.test(copy)) {
    throw new Error(`${context} must show only its reviewed AI-assisted marking capability: ${copy}`)
  }
}

function boxesOverlap(first, second, tolerance = 1) {
  if (!first || !second) return false
  return first.left < second.right - tolerance
    && first.right > second.left + tolerance
    && first.top < second.bottom - tolerance
    && first.bottom > second.top + tolerance
}

async function assertNotebookLayout(page, { label, state }) {
  const notebook = page.locator('.notebook-view')
  await notebook.waitFor()
  await notebook.scrollIntoViewIfNeeded()
  const metrics = await page.evaluate(() => {
    const rect = (element) => {
      if (!element) return null
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
        display: style.display,
        visibility: style.visibility,
        background: style.backgroundColor,
      }
    }
    const root = document.querySelector('.notebook-view')
    const summary = document.querySelector('.notebook-summary')
    const layout = document.querySelector('.notebook-layout')
    const queue = document.querySelector('.notebook-queue')
    const side = document.querySelector('.notebook-side')
    const filters = document.querySelector('.notebook-filters')
    const note = document.querySelector('.notebook-note-tool')
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      root: rect(root),
      header: rect(document.querySelector('.notebook-header')),
      summary: rect(summary),
      summaryItems: [...(summary?.children || [])].map(rect),
      layout: rect(layout),
      layoutDisplay: layout ? getComputedStyle(layout).display : '',
      queue: rect(queue),
      side: rect(side),
      filters: rect(filters),
      filtersDisplay: filters ? getComputedStyle(filters).display : '',
      search: rect(filters?.querySelector('input')),
      priority: rect(filters?.querySelector('select')),
      note: rect(note),
      noteHeader: rect(note?.querySelector('header')),
      noteInput: rect(note?.querySelector('textarea')),
      recent: rect(document.querySelector('.notebook-recent')),
      coach: rect(document.querySelector('.ai-coach-trigger')),
      emptyCount: document.querySelectorAll('.notebook-empty').length,
      itemCount: document.querySelectorAll('.notebook-mistake').length,
    }
  })
  const visible = (box, minimumWidth = 20, minimumHeight = 18) => box
    && box.width >= minimumWidth
    && box.height >= minimumHeight
    && box.display !== 'none'
    && box.visibility !== 'hidden'
  const required = [metrics.root, metrics.summary, metrics.layout, metrics.queue, metrics.side, metrics.filters, metrics.search, metrics.priority, metrics.note, metrics.noteHeader, metrics.noteInput, metrics.recent]
  if (required.some((box) => !visible(box))) throw new Error(`${label} notebook has missing or collapsed controls: ${JSON.stringify(metrics)}`)
  if (metrics.layoutDisplay !== 'grid' || metrics.filtersDisplay !== 'grid' || metrics.summaryItems.length !== 4 || metrics.summaryItems.some((box) => !visible(box, 60, 32))) {
    throw new Error(`${label} notebook layout did not apply its structured CSS: ${JSON.stringify(metrics)}`)
  }
  if (metrics.scrollWidth > metrics.clientWidth + 1 || metrics.summary.background === 'rgba(0, 0, 0, 0)') {
    throw new Error(`${label} notebook has horizontal overflow or unstyled summary: ${JSON.stringify(metrics)}`)
  }
  for (let first = 0; first < metrics.summaryItems.length; first += 1) {
    for (let second = first + 1; second < metrics.summaryItems.length; second += 1) {
      if (boxesOverlap(metrics.summaryItems[first], metrics.summaryItems[second])) throw new Error(`${label} notebook summary counters overlap: ${JSON.stringify(metrics.summaryItems)}`)
    }
  }
  const collisions = [
    ['search and priority', metrics.search, metrics.priority],
    ['queue and side panel', metrics.queue, metrics.side],
    ['private note header and editor', metrics.noteHeader, metrics.noteInput],
    ['private note and recent results', metrics.note, metrics.recent],
  ].filter(([, first, second]) => boxesOverlap(first, second))
  if (collisions.length) throw new Error(`${label} notebook controls overlap: ${JSON.stringify({ collisions: collisions.map(([name]) => name), metrics })}`)
  if (metrics.clientWidth <= 540 && visible(metrics.coach) && [metrics.header, metrics.filters, metrics.search, metrics.priority].some((box) => boxesOverlap(metrics.coach, box))) {
    throw new Error(`${label} mobile AI Coach covers notebook content: ${JSON.stringify(metrics)}`)
  }
  if (state === 'empty' && (metrics.emptyCount !== 1 || metrics.itemCount !== 0)) throw new Error(`${label} expected a clear review queue: ${JSON.stringify(metrics)}`)
  if (state === 'populated' && (metrics.emptyCount !== 0 || metrics.itemCount < 1)) throw new Error(`${label} expected a visible review item: ${JSON.stringify(metrics)}`)
  const shot = path.join(ARTIFACT_DIR, `${label}.png`)
  await page.screenshot({ path: shot, fullPage: false })
  return shot
}

async function assertSelfMarkPendingFlow(browser, errors, shots) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(`self-mark result: ${error.message}`))
  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Practice$/ }).click()
    const routePicker = page.locator('.practice-hub .student-route-picker')
    await routePicker.getByRole('tab', { name: 'AS', exact: true }).click()
    await routePicker.getByRole('combobox', { name: 'Current course' }).selectOption('cie-9709-as-p1-p2')
    await page.getByRole('button', { name: /^Topic Drill$/ }).click()
    await page.locator('.topic-directory__row').filter({ hasText: 'Pure Mathematics' }).first().click()
    await page.getByRole('button', { name: /^Start set 1$/ }).click()
    await assertSessionMarkingDisclosure(page, /^Self-mark after submission\b/)
    await startSession(page)
    await page.getByRole('button', { name: 'Type', exact: true }).click()
    await page.getByRole('textbox', { name: /typed response/i }).fill('Differentiate the expression, then substitute the stated value.')
    await page.getByRole('button', { name: /^Submit$/ }).click()
    const submitDialog = page.locator('.submit-dialog')
    await submitDialog.getByText(/Blank written responses remain pending and never become an automatic zero/i).waitFor()
    if (await submitDialog.getByText(/receive zero marks/i).count()) throw new Error('Self-mark-only submit still claims blank answers receive automatic zero')
    await submitDialog.getByRole('button', { name: 'Submit anyway' }).click()
    await page.getByRole('heading', { name: 'Ready to self-mark' }).waitFor()
    await page.getByText(/No total score, mastery, mistake or learning event is created/i).waitFor()
    const recordButton = page.getByRole('button', { name: 'Record self-mark' })
    if (!(await recordButton.isDisabled())) throw new Error('Blank self-mark fields enabled score recording')
    await page.getByText(/Blank or partial entries remain unscored/i).waitFor()
    const pendingState = await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key) || '{}')
      const pending = (state.attempts || []).find((attempt) => attempt.attemptStatus === 'self-mark-pending')
      return { count: (state.attempts || []).length, pendingId: pending?.id || '', hasScore: Boolean(pending?.scoreResult) }
    }, STORAGE_KEY)
    if (!pendingState.pendingId || pendingState.hasScore) throw new Error(`Self-mark submission was not persisted as an unscored pending attempt: ${JSON.stringify(pendingState)}`)
    const markInputs = page.getByRole('spinbutton', { name: /^Self-mark for / })
    const markCount = await markInputs.count()
    if (!markCount) throw new Error('Self-mark result has no explicit question mark inputs')
    for (let index = 0; index < markCount; index += 1) {
      const maximum = Number(await markInputs.nth(index).getAttribute('max'))
      await markInputs.nth(index).fill(String(Math.min(maximum, index === 0 ? 1 : 0)))
    }
    await page.getByText(/Saving appends a canonical scored result/i).waitFor()
    if (await recordButton.isDisabled()) throw new Error('Complete in-range self-marks did not enable score recording')
    await recordButton.click()
    await page.waitForFunction(() => document.querySelector('.result-hero h1')?.textContent?.includes('marks'))
    const recordedState = await page.evaluate(({ key, pendingId, beforeCount }) => {
      const state = JSON.parse(localStorage.getItem(key) || '{}')
      const original = (state.attempts || []).find((attempt) => attempt.id === pendingId)
      const scored = (state.attempts || []).find((attempt) => attempt.finalizedFromAttemptId === pendingId && attempt.scoreResult)
      const criteria = scored?.scoreResult?.criteria || []
      return { count: (state.attempts || []).length, originalStatus: original?.attemptStatus, originalHasScore: Boolean(original?.scoreResult), scoredId: scored?.id || '', scoredStatus: scored?.attemptStatus, pointEvidenceCounts: criteria.map((criterion) => criterion.evidence?.length || 0), pointEvidenceStatuses: criteria.map((criterion) => criterion.evidenceStatus || ''), beforeCount }
    }, { key: STORAGE_KEY, pendingId: pendingState.pendingId, beforeCount: pendingState.count })
    if (recordedState.count !== recordedState.beforeCount + 1 || recordedState.originalStatus !== 'self-mark-pending' || recordedState.originalHasScore || !recordedState.scoredId || recordedState.scoredStatus !== 'result') {
      throw new Error(`Self-mark recording did not preserve the source attempt and append one scored result: ${JSON.stringify(recordedState)}`)
    }
    if (recordedState.pointEvidenceCounts.some((count) => count !== 0) || recordedState.pointEvidenceStatuses.some((status) => status !== 'not-recorded')) {
      throw new Error(`Self-mark total fabricated point-level evidence: ${JSON.stringify(recordedState)}`)
    }
    await page.locator('.criteria-list').getByText(/Specific awarded and missed mark-scheme points were not recorded for this self-mark/i).first().waitFor()
    if (await page.locator('.mark-points').getByText(/^[✓○]\s/).count()) throw new Error('Self-mark result rendered inferred awarded or missed point markers')
    await page.locator('.official-answer').first().waitFor()
    const shot = path.join(ARTIFACT_DIR, 'self-mark-recorded-desktop.png')
    shots.push(shot)
    await page.screenshot({ path: shot, fullPage: false })
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Notebook$/ }).click()
    const selfMarkNotebookItem = page.locator('.notebook-mistake').filter({ hasText: 'Specific mark-scheme points were not recorded' }).first()
    await selfMarkNotebookItem.waitFor()
    await selfMarkNotebookItem.getByText('Review your response and official mark scheme').click()
    await selfMarkNotebookItem.getByText(/specific awarded and missed mark-scheme points were not recorded/i).waitFor()
    if (await selfMarkNotebookItem.getByText('Mark points to add next time').count()) throw new Error('Notebook inferred missed mark points from a total-only self-mark')
    await selfMarkNotebookItem.getByText('Official mark-scheme points').waitFor()
    const notebookShot = path.join(ARTIFACT_DIR, 'self-mark-notebook-evidence-desktop.png')
    shots.push(notebookShot)
    await page.screenshot({ path: notebookShot, fullPage: false })
    return { pendingAttemptId: pendingState.pendingId, scoredAttemptId: recordedState.scoredId, attemptsBefore: pendingState.count, attemptsAfter: recordedState.count }
  } finally {
    await context.close()
  }
}

async function assertMixedMarkingLifecycle(browser, errors, shots) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(`mixed marking: ${error.message}`))
  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => localStorage.clear())
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Practice$/ }).click()
    const routePicker = page.locator('.practice-hub .student-route-picker')
    await routePicker.getByRole('tab', { name: 'IGCSE', exact: true }).click()
    await routePicker.getByRole('combobox', { name: 'Current course' }).selectOption('cie-0625-igcse-physics')
    await page.getByRole('button', { name: /^Topic Drill$/ }).click()
    await page.locator('.topic-directory__row').filter({ hasText: 'Waves' }).first().click()
    await page.getByRole('button', { name: /^Start set 1$/ }).click()
    await assertSessionMarkingDisclosure(page, /^Mixed marking\b/)
    await startSession(page)
    await page.getByRole('button', { name: /^Submit$/ }).click()
    const submitDialog = page.locator('.submit-dialog')
    await submitDialog.getByText(/written responses remain pending and never become an automatic zero/i).waitFor()
    await submitDialog.getByRole('button', { name: 'Submit anyway' }).click()
    await page.getByRole('heading', { name: 'Ready to self-mark' }).waitFor()
    await page.getByText(/Checked so far/i).waitFor()
    const initialState = await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key) || '{}')
      const pending = (state.attempts || []).find((attempt) => attempt.attemptStatus === 'marking-pending')
      return {
        count: (state.attempts || []).length,
        pendingId: pending?.id || '',
        hasScore: Boolean(pending?.scoreResult),
        provisionalCriteria: pending?.markingLifecycle?.provisionalCriteria?.length || 0,
        pendingParts: pending?.markingLifecycle?.pendingPartIds?.length || 0,
      }
    }, STORAGE_KEY)
    if (!initialState.pendingId || initialState.hasScore || initialState.provisionalCriteria !== 9 || initialState.pendingParts !== 1) {
      throw new Error(`Mixed submission did not persist the expected unresolved lifecycle: ${JSON.stringify(initialState)}`)
    }

    const markInput = page.getByRole('spinbutton', { name: /^Self-mark for / }).first()
    await markInput.fill('1')
    await page.waitForFunction(({ key, attemptId }) => JSON.parse(localStorage.getItem(key) || '{}').selfMarkDrafts?.[attemptId]?.[Object.keys(JSON.parse(localStorage.getItem(key) || '{}').selfMarkDrafts?.[attemptId] || {}).find((partId) => partId !== 'updatedAt')] === 1, { key: STORAGE_KEY, attemptId: initialState.pendingId })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Progress$/ }).click()
    const pendingRow = page.locator('.history-row--pending').first()
    await page.waitForTimeout(500)
    if (!await pendingRow.count()) {
      const diagnostic = await page.evaluate((key) => {
        const state = JSON.parse(localStorage.getItem(key) || '{}')
        return {
          activeRouteId: state.profile?.activeRouteId,
          attempts: (state.attempts || []).map((attempt) => ({ id: attempt.id, status: attempt.attemptStatus, routeId: attempt.routeId, hasScore: Boolean(attempt.scoreResult) })),
          body: document.body.innerText.slice(0, 1200),
        }
      }, STORAGE_KEY)
      throw new Error(`Reloaded mixed pending attempt is missing from Progress: ${JSON.stringify(diagnostic)}`)
    }
    await pendingRow.waitFor()
    await pendingRow.getByRole('button', { name: 'Continue marking' }).click()
    await page.getByRole('heading', { name: 'Ready to self-mark' }).waitFor()
    const restoredInput = page.getByRole('spinbutton', { name: /^Self-mark for / }).first()
    if (await restoredInput.inputValue() !== '1') throw new Error('Mixed self-mark draft did not restore after reload and History resume')
    await page.getByRole('button', { name: 'Record self-mark' }).click()
    await page.waitForFunction(() => document.querySelector('.result-hero h1')?.textContent?.includes('marks'))

    const finalState = await page.evaluate(({ key, pendingId, beforeCount }) => {
      const state = JSON.parse(localStorage.getItem(key) || '{}')
      const original = (state.attempts || []).find((attempt) => attempt.id === pendingId)
      const final = (state.attempts || []).find((attempt) => attempt.finalizedFromAttemptId === pendingId)
      const selfCriterion = final?.scoreResult?.criteria?.find((criterion) => criterion.scoringSource === 'student-self-mark')
      return {
        count: (state.attempts || []).length,
        originalStatus: original?.attemptStatus,
        originalHasScore: Boolean(original?.scoreResult),
        finalStatus: final?.attemptStatus,
        finalCriteria: final?.scoreResult?.criteria?.length || 0,
        maxMarks: final?.scoreResult?.maxMarks,
        selfEvidence: selfCriterion?.evidence,
        selfEvidenceStatus: selfCriterion?.evidenceStatus,
        draftRemoved: !state.selfMarkDrafts?.[pendingId],
        beforeCount,
      }
    }, { key: STORAGE_KEY, pendingId: initialState.pendingId, beforeCount: initialState.count })
    if (finalState.count !== finalState.beforeCount + 1 || finalState.originalStatus !== 'marking-pending' || finalState.originalHasScore || finalState.finalStatus !== 'result' || finalState.finalCriteria !== 10 || finalState.maxMarks !== 13 || !finalState.draftRemoved) {
      throw new Error(`Mixed finalization did not remain append-only and complete: ${JSON.stringify(finalState)}`)
    }
    if (!Array.isArray(finalState.selfEvidence) || finalState.selfEvidence.length || finalState.selfEvidenceStatus !== 'not-recorded') {
      throw new Error(`Mixed self-mark fabricated mark-point evidence: ${JSON.stringify(finalState)}`)
    }
    const shot = path.join(ARTIFACT_DIR, 'mixed-marking-recorded-desktop.png')
    shots.push(shot)
    await page.screenshot({ path: shot, fullPage: false })
    return { pendingAttemptId: initialState.pendingId, provisionalCriteria: initialState.provisionalCriteria, pendingParts: initialState.pendingParts, finalCriteria: finalState.finalCriteria, appendOnly: true, restoredAfterReload: true }
  } finally {
    await context.close()
  }
}

async function assertAccountStateIsolation(browser, errors, shots) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } })
  let account = { id: 'ielts:101', username: 'Account A' }
  const notes = new Map()
  const noteRequests = []
  const jsonHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': 'http://127.0.0.1:5173', 'Access-Control-Allow-Credentials': 'true' }
  await context.addInitScript(({ key }) => {
    if (localStorage.getItem('qa-account-isolation-seeded')) return
    localStorage.setItem('qa-account-isolation-seeded', '1')
    localStorage.setItem(key, JSON.stringify({
      profile: { role: 'student', learningTrack: 'AS', activeRouteId: 'cie-9702-as-physics', recentRouteIds: ['cie-9702-as-physics'] },
      attempts: [{ id: 'legacy-attempt-for-a', unitId: 'legacy-unit', routeId: 'cie-9702-as-physics', stage: 'AS', attemptStatus: 'self-mark-pending', submittedAt: '2026-08-10T00:00:00.000Z' }],
      notebookNotes: { 'cie-9702-as-physics': { body: 'legacy note must clear when server returns null', updatedAt: '2026-08-10T00:00:00.000Z' } },
    }))
  }, { key: STORAGE_KEY })
  await context.route('**/api/stem/identity', async (route) => {
    if (!account) {
      await route.fulfill({ status: 401, headers: jsonHeaders, body: JSON.stringify({ error: 'Sign in required' }) })
      return
    }
    await route.fulfill({ status: 200, headers: jsonHeaders, body: JSON.stringify({ identity: { ...account, roles: [] }, accessToken: `qa-${account.id}-${'x'.repeat(48)}`, expiresAt: new Date(Date.now() + 300_000).toISOString() }) })
  })
  await context.route('**/api/auth/status', async (route) => route.fulfill({ status: 200, headers: jsonHeaders, body: JSON.stringify({ authenticated: true, identity: account, classrooms: [], assignments: [] }) }))
  await context.route('**/api/stem/workspace', async (route) => route.fulfill({ status: 200, headers: jsonHeaders, body: JSON.stringify({ identity: account, classrooms: [], assignments: [] }) }))
  await context.route(/\/api\/stem\/notebook\/notes(?:\/[^?]+)?(?:\?.*)?$/, async (route) => {
    const request = route.request()
    const routeId = decodeURIComponent(new URL(request.url()).searchParams.get('routeId') || request.url().split('/').at(-1))
    const ownerId = account?.id || ''
    const noteKey = `${ownerId}:${routeId}`
    noteRequests.push({ method: request.method(), ownerId, routeId, noteFound: notes.has(noteKey) })
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, headers: jsonHeaders, body: JSON.stringify({ routeId, note: notes.get(noteKey) || null, privacy: 'private-to-student' }) })
      return
    }
    const updatedAt = new Date().toISOString()
    if (request.method() === 'DELETE') notes.set(noteKey, { routeId, body: '', updatedAt, deleted: true, deletedAt: updatedAt })
    else {
      const payload = request.postDataJSON()
      notes.set(noteKey, { routeId, body: String(payload.body || ''), updatedAt, deleted: false, deletedAt: null })
    }
    await route.fulfill({ status: 200, headers: jsonHeaders, body: JSON.stringify({ routeId, note: notes.get(noteKey), privacy: 'private-to-student' }) })
  })

  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(`account isolation: ${error.message}`))
  const waitForAccount = async (name) => page.getByRole('button', { name: `Account: ${name}` }).waitFor()
  const waitForStoredNote = async (ownerId, body) => {
    const noteKey = `${ownerId}:cie-9702-as-physics`
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (notes.get(noteKey)?.body === body) return
      await page.waitForTimeout(100)
    }
    throw new Error(`Private note did not sync to the expected account partition: ${JSON.stringify({ ownerId, body, note: notes.get(noteKey) || null, noteRequests })}`)
  }
  const openNotebook = async () => {
    const notebookButton = page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Notebook$/ })
    const note = page.getByRole('textbox', { name: 'Private route notebook note' })
    try {
      await notebookButton.click({ timeout: 5000 })
    } catch {
      const rendered = await page.locator('body').innerText().catch(() => '')
      throw new Error(`Account isolation could not open Notebook: ${JSON.stringify({ url: page.url(), pageErrors: errors.filter((item) => item.startsWith('account isolation:')), rendered: rendered.slice(0, 500) })}`)
    }
    try {
      await note.waitFor({ timeout: 5000 })
    } catch {
      const diagnostic = await page.evaluate(() => ({
        bodyText: document.body.innerText.slice(0, 500),
        shell: Boolean(document.querySelector('.app-shell')),
        dashboard: Boolean(document.querySelector('.student-home-guided')),
        notebook: Boolean(document.querySelector('.notebook-view')),
        topNav: Boolean(document.querySelector('.unified-top-nav')),
      }))
      throw new Error(`Notebook did not open during account isolation: ${JSON.stringify({ diagnostic, errors })}`)
    }
    return note
  }
  try {
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await waitForAccount('Account A')
    await page.waitForFunction(() => localStorage.getItem('alevel-learning-platform-v2:legacy-owner') === 'ielts:101')
    const claimed = await page.evaluate(() => JSON.parse(localStorage.getItem('alevel-learning-platform-v2:user:ielts%3A101') || '{}'))
    if (!claimed.attempts?.some((attempt) => attempt.id === 'legacy-attempt-for-a')) throw new Error('Legacy learning history was not claimed by the first identified account')
    await page.locator('.student-home-guided').waitFor()
    if (await page.locator('.student-home-guided').getByText(/NaN|0\/0/).count()) throw new Error('Pending self-mark history leaked an invalid score onto Today')
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: 'Progress' }).click()
    await page.getByText('Self-mark pending · preserved in your learning record').waitFor()
    await page.getByText('Not scored', { exact: true }).waitFor()
    const aNote = await openNotebook()
    try {
      await page.waitForFunction(() => document.querySelector('textarea[aria-label="Private route notebook note"]')?.value === '', null, { timeout: 5000 })
    } catch {
      const diagnostic = await page.evaluate(() => ({
        view: document.querySelector('.notebook-view') ? 'notebook' : document.querySelector('.student-home-guided') ? 'dashboard' : 'other',
        noteValue: document.querySelector('textarea[aria-label="Private route notebook note"]')?.value ?? null,
        owner: localStorage.getItem('alevel-learning-platform-v2:legacy-owner'),
        accountState: JSON.parse(localStorage.getItem('alevel-learning-platform-v2:user:ielts%3A101') || '{}').notebookNotes || null,
      }))
      throw new Error(`Account A server-null note did not clear: ${JSON.stringify({ diagnostic, noteRequests })}`)
    }
    await aNote.fill('Account A private method')
    try {
      await waitForStoredNote('ielts:101', 'Account A private method')
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        noteValue: document.querySelector('textarea[aria-label="Private route notebook note"]')?.value ?? null,
        noteStatus: document.querySelector('.notebook-note-tool small')?.textContent || null,
        owner: localStorage.getItem('alevel-learning-platform-v2:legacy-owner'),
        accountState: JSON.parse(localStorage.getItem('alevel-learning-platform-v2:user:ielts%3A101') || '{}').notebookNotes || null,
      }))
      throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`)
    }

    account = { id: 'ielts:202', username: 'Account B' }
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForAccount('Account B')
    const bNote = await openNotebook()
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="Private route notebook note"]')?.value === '')
    if (await bNote.inputValue()) throw new Error('Account B saw Account A private note')
    await bNote.fill('Account B private method')
    await waitForStoredNote('ielts:202', 'Account B private method')

    account = null
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /Sign in to STEM|Sign in$/ }).waitFor()
    const guestNote = await openNotebook()
    if (await guestNote.inputValue()) throw new Error('Guest state inherited an authenticated account private note')

    account = { id: 'ielts:101', username: 'Account A' }
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForAccount('Account A')
    const restoredA = await openNotebook()
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="Private route notebook note"]')?.value === 'Account A private method')
    if (await restoredA.inputValue() !== 'Account A private method') throw new Error('Switching back to A did not restore A private note')

    await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ notebookNotes: { 'cie-9702-as-physics': { body: 'stale legacy pollution', updatedAt: new Date().toISOString() } } })), STORAGE_KEY)
    account = { id: 'ielts:202', username: 'Account B' }
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForAccount('Account B')
    const restoredB = await openNotebook()
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="Private route notebook note"]')?.value === 'Account B private method')
    if (await restoredB.inputValue() !== 'Account B private method') throw new Error('The old global key contaminated Account B after ownership migration')
    const shot = path.join(ARTIFACT_DIR, 'account-note-isolation-ipad-landscape.png')
    shots.push(shot)
    await page.screenshot({ path: shot, fullPage: false })
    return { legacyOwner: 'ielts:101', accountA: 'restored', accountB: 'isolated', guest: 'isolated', nullNoteCleared: true }
  } finally {
    await context.close()
  }
}

async function run() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  const errors = []
  const shots = []
  let pdfInkMetrics = null
  let selfMarkPendingMetrics = null
  let mixedMarkingMetrics = null
  let accountIsolationMetrics = null

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
    const desktopSource = await assertVisibleSourceMaterial(page, 'Desktop verified practice')
    if (!/\/question-assets\//.test(desktopSource.src)) throw new Error(`Desktop practice did not use a trusted local source asset: ${JSON.stringify(desktopSource)}`)
    await page.getByRole('button', { name: 'Expand source image' }).click()
    const sourceDialog = page.getByRole('dialog', { name: 'Expanded official question image' })
    await sourceDialog.waitFor()
    const sourceCanvas = sourceDialog.locator('.qp-source-zoom__canvas')
    const sourceCanvasStyle = await sourceCanvas.evaluate((element) => ({ overflow: getComputedStyle(element).overflow, touchAction: getComputedStyle(element).touchAction }))
    const allowsSourcePanAndZoom = sourceCanvasStyle.touchAction === 'manipulation'
      || (sourceCanvasStyle.touchAction.includes('pan-x') && sourceCanvasStyle.touchAction.includes('pinch-zoom'))
    if (sourceCanvasStyle.overflow !== 'auto' || !allowsSourcePanAndZoom) throw new Error(`Expanded source viewer must support its own pan and zoom surface: ${JSON.stringify(sourceCanvasStyle)}`)
    await sourceDialog.getByRole('button', { name: 'Zoom in source image' }).click()
    const zoomedWidth = await sourceCanvas.locator('img').evaluate((image) => image.style.width)
    if (zoomedWidth !== '125%') throw new Error(`Expanded source viewer did not apply a controlled zoom level: ${zoomedWidth}`)
    await page.keyboard.press('Escape')
    if (await sourceDialog.count()) throw new Error('Expanded source viewer did not close with Escape')
    if (await page.getByRole('button', { name: 'Expand source image' }).evaluate((button) => document.activeElement === button) !== true) throw new Error('Closing source viewer did not return focus to its trigger')
    let handwrittenIndex = -1
    try { handwrittenIndex = await findHandwritingQuestion(page) } catch { handwrittenIndex = -1 }
    if (handwrittenIndex >= 0) {
      await page.locator('.index-list button').nth(handwrittenIndex).click()
      await page.locator('.handwriting-pad').waitFor()
      await assertReviewedAiCapability(page, 'Reviewed 0580 handwriting practice')
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
        for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3] > 128 && pixels[index] < 100 && pixels[index + 1] < 120 && pixels[index + 2] < 150) dark += 1
        return dark
      })
      if (erasedPixels >= drawnPixels) throw new Error(`Eraser did not remove local ink: ${drawnPixels} -> ${erasedPixels}`)
      await assertReviewedAiCapability(page, 'Saved reviewed 0580 handwriting practice')
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
    shots.push(await assertNotebookLayout(page, { label: 'notebook-empty-desktop', state: 'empty' }))
    const notebookRoutePicker = page.locator('.notebook-view .student-route-picker')
    await notebookRoutePicker.getByRole('tab', { name: 'AS', exact: true }).click()
    await notebookRoutePicker.getByRole('combobox', { name: 'Current course' }).selectOption('cie-9702-as-physics')
    await page.waitForFunction(() => document.querySelectorAll('.notebook-mistake').length > 0, null, { timeout: 3000 })
    const privateNote = page.getByRole('textbox', { name: 'Private route notebook note' })
    await privateNote.fill('Keep the system boundary clear before applying conservation.')
    if (await privateNote.inputValue() !== 'Keep the system boundary clear before applying conservation.') throw new Error('Private notebook note did not retain typed text')
    shots.push(await assertNotebookLayout(page, { label: 'notebook-populated-desktop', state: 'populated' }))
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
      if (await page.getByRole('button', { name: /^Sign in/i }).count() !== 1) throw new Error('Guest account menu is missing the STEM login action')
      if (await page.getByRole('button', { name: /Create account/i }).count() !== 1) throw new Error('Guest account menu is missing the STEM registration action')
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
    await page.locator('.paper-table tbody tr').first().getByRole('button', { name: 'Open' }).click()
    await page.locator('.paper-workspace').waitFor()
    await page.locator('.pdf-canvas-scroll canvas').first().waitFor({ timeout: 60000 })
    if (await page.getByText(/Answer slots/i).count() !== 1) throw new Error('Competition historical paper did not open the answer workspace')
    await page.getByRole('button', { name: 'Back to paper library' }).click()
    await page.getByRole('heading', { name: 'British Physics Olympiad historical archive' }).waitFor()
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

    const legacyDraftTabletContext = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
    const legacyDraftTabletPage = await legacyDraftTabletContext.newPage()
    legacyDraftTabletPage.on('pageerror', (error) => errors.push(`0580 legacy draft iPad: ${error.message}`))
    await legacyDraftTabletPage.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await legacyDraftTabletPage.evaluate(() => localStorage.clear())
    await legacyDraftTabletPage.reload({ waitUntil: 'domcontentloaded' })
    shots.push(await assert0580LegacyDraftMigration(legacyDraftTabletPage))
    await legacyDraftTabletContext.close()

    const selfMarkDesktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const selfMarkDesktopPage = await selfMarkDesktopContext.newPage()
    selfMarkDesktopPage.on('pageerror', (error) => errors.push(`0580 self-mark desktop: ${error.message}`))
    await selfMarkDesktopPage.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await selfMarkDesktopPage.evaluate(() => localStorage.clear())
    await selfMarkDesktopPage.reload({ waitUntil: 'domcontentloaded' })
    shots.push(await assert0580ReviewedMarkingEntryFlow(selfMarkDesktopPage, { pointerId: 301, label: 'desktop' }))
    await selfMarkDesktopContext.close()

    const selfMarkTabletContext = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
    const selfMarkTabletPage = await selfMarkTabletContext.newPage()
    selfMarkTabletPage.on('pageerror', (error) => errors.push(`0580 self-mark iPad: ${error.message}`))
    await selfMarkTabletPage.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await selfMarkTabletPage.evaluate(() => localStorage.clear())
    await selfMarkTabletPage.reload({ waitUntil: 'domcontentloaded' })
    shots.push(await assert0580ReviewedMarkingEntryFlow(selfMarkTabletPage, { mobile: true, pointerId: 302, label: 'ipad' }))
    await selfMarkTabletContext.close()

    const practiceSelfMarkContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const practiceSelfMarkPage = await practiceSelfMarkContext.newPage()
    practiceSelfMarkPage.on('pageerror', (error) => errors.push(`practice self-mark desktop: ${error.message}`))
    await practiceSelfMarkPage.goto(APP_URL, { waitUntil: 'domcontentloaded' })
    await practiceSelfMarkPage.evaluate(() => localStorage.clear())
    await practiceSelfMarkPage.reload({ waitUntil: 'domcontentloaded' })
    shots.push(await assertPracticeSelfMarkPendingFlow(practiceSelfMarkPage))
    await practiceSelfMarkContext.close()

    selfMarkPendingMetrics = await assertSelfMarkPendingFlow(browser, errors, shots)
    mixedMarkingMetrics = await assertMixedMarkingLifecycle(browser, errors, shots)
    accountIsolationMetrics = await assertAccountStateIsolation(browser, errors, shots)

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
    await mobilePage.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Notebook$/ }).click()
    shots.push(await assertNotebookLayout(mobilePage, { label: 'notebook-empty-mobile', state: 'empty' }))
    await mobilePage.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Today$/ }).click()
    await mobilePage.locator('.student-home-guided .recommended-session').waitFor()
    await openVerifiedStarter(mobilePage)
    const sourceGraphMetrics = await assertVisibleSourceMaterial(mobilePage, 'Mobile Dynamics practice')
    if (!sourceGraphMetrics.loaded || !/\/question-assets\/cie-9702-9702_m25_qp_12\/qp-03\.jpg$/.test(sourceGraphMetrics.src)) {
      throw new Error(`The source-dependent Dynamics question did not render its trusted official graph: ${JSON.stringify(sourceGraphMetrics)}`)
    }
    const rawVisualPlaceholderCount = await mobilePage.getByText(/\[(?:graph|diagram|figure|image)\s*:/i).count()
    if (rawVisualPlaceholderCount) throw new Error(`Raw source visual placeholders are visible in mobile practice: ${rawVisualPlaceholderCount}`)
    const mobileMetrics = await mobilePage.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      sourceVisible: Boolean(document.querySelector('.qp-question-asset img')),
      answerTop: document.querySelector('.mcq-answer, .handwriting-pad')?.getBoundingClientRect().top,
      promptBottom: document.querySelector('.qp-question__body h2')?.getBoundingClientRect().bottom,
    }))
    if (mobileMetrics.scrollWidth > mobileMetrics.clientWidth) throw new Error(`Mobile practice geometry failed: ${JSON.stringify(mobileMetrics)}`)
    if (!mobileMetrics.sourceVisible) throw new Error(`Complete source material must be visible by default on mobile: ${JSON.stringify(mobileMetrics)}`)
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
    await tabletPage.getByRole('navigation', { name: 'Primary navigation' }).getByRole('button', { name: /^Notebook$/ }).click()
    shots.push(await assertNotebookLayout(tabletPage, { label: 'notebook-empty-ipad', state: 'empty' }))
    await tablet.close()

    if (errors.length) throw new Error(`Browser errors:\n${errors.join('\n')}`)
    console.log(JSON.stringify({ verifiedPracticeUnits: 145, verifiedQuestionGroups: 917, answerableParts: 978, reviewed0580Paper: { questionGroups: 26, answerableParts: 46, totalMarks: 80, sharedLoginEntryVerified: true }, deterministicMcqMarked: true, selfMarkPendingMetrics, mixedMarkingMetrics, accountIsolationMetrics, focusedRetestQuestions: 1, competitionAndAdmissionsSeparated: true, bphoRoundFiltersVerified: Object.keys(expectedRoundCounts), officialTopic7Unlocked: true, officialTopic9Unlocked: true, mobileMetrics, pencilMetrics, pdfInkMetrics, shots }, null, 2))
  } finally {
    await browser.close()
  }
}

run().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
