import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CAMBRIDGE_9702_A2_SYLLABUS } from '../src/data/syllabus/cambridge-9702-a2-2025-2027.js'
import { buildDryRunPlan, parseArgs, questionPaperPageWindows, runCli } from './ingest-ai-pdf-questions.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-page-window-reliability-'))
const questionPdf = path.join(root, '9702_m25_qp_42.pdf')
const markSchemePdf = path.join(root, '9702_m25_ms_42.pdf')
const outputRoot = path.join(root, 'artifacts')
fs.writeFileSync(questionPdf, Buffer.from('%PDF-1.4\nquestion-fixture\n', 'utf8'))
fs.writeFileSync(markSchemePdf, Buffer.from('%PDF-1.4\nmark-scheme-fixture\n', 'utf8'))

const questionPageHashes = { 1: '1'.repeat(64), 2: '2'.repeat(64), 3: '3'.repeat(64) }
const markSchemePageHashes = { 1: '4'.repeat(64), 2: '5'.repeat(64) }

const groupedWindows = questionPaperPageWindows(
  Object.fromEntries(Array.from({ length: 6 }, (_, index) => [index + 1, String(index + 1).repeat(64)])),
  { ownedPageCount: 2, trailingPageCount: 1, questionStartPages: [2, 4, 6] },
)
assert.deepEqual(groupedWindows, [
  {
    ownedQuestionPaperPages: [2, 4],
    visibleQuestionPaperPages: [2, 3, 4, 5],
    textAnchored: true,
  },
  {
    ownedQuestionPaperPages: [6],
    visibleQuestionPaperPages: [6],
    textAnchored: true,
  },
], 'text-anchored windows must group starts and stop before the next owned group')
const topic = CAMBRIDGE_9702_A2_SYLLABUS.topics[0]
const tags = {
  primaryTopicId: topic.id,
  secondaryTopicIds: [],
  syllabusPointIds: [topic.points[0].id],
}

function renderer(pdfPath, directory) {
  const hashes = pdfPath === questionPdf ? questionPageHashes : markSchemePageHashes
  fs.mkdirSync(directory, { recursive: true })
  for (const page of Object.keys(hashes)) fs.writeFileSync(path.join(directory, `page-${page}.jpg`), Buffer.from(`${pdfPath}:${page}`, 'utf8'))
  return Promise.resolve({
    pageImageHashes: hashes,
    pageSizes: Object.fromEntries(Object.keys(hashes).map((page) => [page, { width: 1200, height: 1600 }])),
  })
}

function question(questionNumber, page, plan) {
  return {
    questionNumber,
    questionStartPage: page,
    regions: [{ page, pageImageSha256: questionPageHashes[page], x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.8 }],
    diagramRegions: [],
    parts: [{ label: 'a', marks: 2, ocrText: `Question ${questionNumber}`, math: [], diagramAssociations: [] }],
    tags,
    markSchemeEvidence: [{ page: 1, pageImageSha256: markSchemePageHashes[1] }],
    source: {
      questionPdfSha256: plan.immutableInputs.questionPdf.sha256,
      markSchemePdfSha256: plan.immutableInputs.markSchemePdf.sha256,
    },
  }
}

function verification(questionNumber, page) {
  return {
    questionNumber,
    questionStartPage: page,
    pages: [page],
    regions: [{ page, pageImageSha256: questionPageHashes[page], x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.8 }],
    diagramRegions: [],
    parts: [{ label: 'a', marks: 2 }],
    diagramRegionCount: 0,
    tags,
    markSchemeEvidence: [{ page: 1, pageImageSha256: markSchemePageHashes[1] }],
  }
}

try {
  const options = parseArgs([
    '--paper-id', 'cie-9702-9702_m25_qp_42',
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9702', '--stage', 'A2', '--output-root', outputRoot,
    '--render-dpi', '120', '--max-attempts', '1', '--timeout-ms', '1000',
    '--paper-timeout-ms', '30000', '--coordinate-only', '--page-windowed',
    '--page-window-owned-pages', '1', '--page-window-trailing-pages', '1', '--retry',
  ])
  const plan = buildDryRunPlan(options)
  const requests = []
  const result = await runCli(options, {
    renderPdf: renderer,
    extractPdfText: async (pdfPath) => pdfPath === questionPdf
      ? { 1: 'cover page', 2: '1 (a) first question', 3: '2 (a) second question' }
      : { 1: 'mark scheme', 2: 'mark scheme' },
    callStructured: async (request) => {
      const metadata = JSON.parse(request.input[1].content[0].text)
      const pageWindow = metadata.pageWindow
      const ownedPages = pageWindow.ownedQuestionPaperPages
      const visiblePages = pageWindow.visibleQuestionPaperPages
      const markSchemeImageCount = request.input[1].content.reduce((count, entry, index, content) => {
        const previous = content[index - 1]?.type === 'input_text' ? String(content[index - 1].text || '') : ''
        return count + (entry.type === 'input_image' && /^mark-scheme page /i.test(previous) ? 1 : 0)
      }, 0)
      requests.push({ schemaName: request.schemaName, ownedPages, visiblePages, markSchemeImageCount })
      assert.ok(markSchemeImageCount > 0, 'page-windowed provider requests must include bounded MS page images')
      const selected = ownedPages.includes(2) ? [question('1', 2, plan)] : ownedPages.includes(3) ? [question('2', 3, plan)] : []
      if (request.schemaName === 'ai_pdf_question_extraction_v1') {
        return { source: selected[0]?.source || question('1', 2, plan).source, questions: selected }
      }
      const starts = [
        { questionNumber: '1', questionStartPage: 2 },
        { questionNumber: '2', questionStartPage: 3 },
      ].filter((entry) => visiblePages.includes(entry.questionStartPage))
      return {
        questionStarts: starts,
        questions: selected.map((entry) => verification(entry.questionNumber, entry.questionStartPage)),
      }
    },
  })

  assert.equal(result.status, 'ai-verified', JSON.stringify(result.reasonCodes))
  assert.deepEqual(requests.map((request) => request.ownedPages), [[2], [2], [3], [3]])
  assert.ok(requests.every((request) => request.visiblePages.length >= 1))
  assert.ok(requests.every((request) => request.markSchemeImageCount >= 1))
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(JSON.stringify({ status: 'passed', checks: 5 }))
