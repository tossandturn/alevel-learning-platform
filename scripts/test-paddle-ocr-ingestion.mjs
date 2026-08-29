import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  createPaddleAdapters,
  ingestPaddleJob,
  loadCompletedPaddleJob,
  routePlansForJob,
} from './ingest-paddle-ocr-queue.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-paddle-ingestion-'))
const workRoot = path.join(root, 'work')
const libraryRoot = path.join(root, 'library', '9709')
const outputRoot = path.join(root, 'artifacts')
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const png = Buffer.from('not-a-real-png-fixture', 'utf8')
const canonicalQuestionJpeg = Buffer.from('canonical-question-jpeg-fixture', 'utf8')
const canonicalMarkSchemeJpeg = Buffer.from('canonical-mark-scheme-jpeg-fixture', 'utf8')

function writeBundle(document, page, markdown, blocks = { page: { page }, blocks: [] }) {
  const pageRoot = path.join(workRoot, 'ocr', 'job-key', document, 'pages', String(page).padStart(4, '0'))
  fs.mkdirSync(pageRoot, { recursive: true })
  const sourcePath = path.join(pageRoot, 'source-page.png')
  const rawPath = path.join(pageRoot, 'paddle-result.json')
  const markdownPath = path.join(pageRoot, 'page.md')
  const blocksPath = path.join(pageRoot, 'layout-blocks.json')
  fs.writeFileSync(sourcePath, png)
  fs.writeFileSync(rawPath, JSON.stringify({ page, engine: 'PaddleOCR-VL-1.6' }))
  fs.writeFileSync(markdownPath, markdown, 'utf8')
  fs.writeFileSync(blocksPath, JSON.stringify(blocks), 'utf8')
  return {
    sourcePage: { path: sourcePath, sha256: hash(png), width: 1200, height: 1600, dpi: 180, page },
    rawResultPath: rawPath,
    rawResultSha256: hash(fs.readFileSync(rawPath)),
    markdownPath,
    markdownSha256: hash(Buffer.from(markdown, 'utf8')),
    layoutBlocksPath: blocksPath,
    layoutBlocksSha256: hash(fs.readFileSync(blocksPath)),
    layoutBlockCount: 0,
    assets: [],
    status: 'completed',
  }
}

function buildJob() {
  const questionPath = path.join(libraryRoot, '9709_m24_qp_42.pdf')
  const markSchemePath = path.join(libraryRoot, '9709_m24_ms_42.pdf')
  fs.mkdirSync(libraryRoot, { recursive: true })
  fs.writeFileSync(questionPath, '%PDF-question-fixture')
  fs.writeFileSync(markSchemePath, '%PDF-mark-scheme-fixture')
  const questionHash = hash(fs.readFileSync(questionPath))
  const markSchemeHash = hash(fs.readFileSync(markSchemePath))
  const qpPage = writeBundle('qp', 1, 'Question 1\n(a) Solve the equation.')
  const msPage = writeBundle('ms', 1, '1(a) M1', { page: { page: 1 }, blocks: [] })
  return {
    schemaVersion: 'stem-paddle-ocr-job.v1',
    jobId: 'sha256:' + 'a'.repeat(64),
    jobKey: 'job-key',
    paperId: 'cie-9709-9709_m24_qp_42',
    subject: '9709',
    year: 2024,
    session: 'm',
    component: 4,
    variant: 2,
    routeBindings: [],
    documents: {
      qp: { path: questionPath, sha256: questionHash, pageCount: 1, bytes: fs.statSync(questionPath).size },
      ms: { path: markSchemePath, sha256: markSchemeHash, pageCount: 1, bytes: fs.statSync(markSchemePath).size },
    },
    statePath: 'state/jobs/job-key.json',
    ocrOutputRoot: 'ocr/job-key',
    stagingArtifactPath: 'artifacts/staging/cie-9709-9709_m24_qp_42/job-key/artifact.json',
    quarantinePath: 'artifacts/quarantine/cie-9709-9709_m24_qp_42/job-key/failure.json',
    state: {
      schemaVersion: 'stem-paddle-ocr-job-state.v1',
      jobId: 'sha256:' + 'a'.repeat(64),
      paperId: 'cie-9709-9709_m24_qp_42',
      status: 'completed',
      documents: {
        qp: { status: 'completed', sourceSha256: questionHash, pageCount: 1, completedPages: [1], pages: { 1: qpPage } },
        ms: { status: 'completed', sourceSha256: markSchemeHash, pageCount: 1, completedPages: [1], pages: { 1: msPage } },
      },
    },
  }
}

try {
  const job = buildJob()
  const renderPdfImpl = async (pdfPath, outputDirectory) => {
    const bytes = pdfPath === job.documents.qp.path ? canonicalQuestionJpeg : canonicalMarkSchemeJpeg
    fs.mkdirSync(outputDirectory, { recursive: true })
    fs.writeFileSync(path.join(outputDirectory, 'page-1.jpg'), bytes)
    return {
      pageImageHashes: { 1: hash(bytes) },
      pageSizes: { 1: { width: 1200, height: 1600 } },
    }
  }
  assert.deepEqual(
    routePlansForJob(job).map((route) => route.routeId),
    ['cie-9709-as-p1-p4', 'cie-9709-a2-after-p1-p5-p3-p4'],
    'a shared M1 paper must be reviewed against both official route contexts',
  )

  assert.throws(
    () => routePlansForJob({
      ...job,
      routeBindings: [{
        routeHint: 'cie-9709-as-p1-p5',
        qualificationStage: 'AS',
        paper: 'P4',
        component: 4,
        reviewStatus: 'pending_official_review',
      }],
    }),
    /PADDLE_ROUTE_BINDING_MISMATCH/,
    'a real manifest routeHint must not be ignored when it contradicts the component route',
  )

  assert.deepEqual(
    routePlansForJob({
      ...job,
      routeBindings: [
        {
          routeHint: 'cie-9709-as-p1-p4',
          qualificationStage: 'AS',
          paper: 'P4',
          component: 4,
          reviewStatus: 'pending_official_review',
        },
        {
          routeHint: 'cie-9709-a2-after-p1-p5-p3-p4',
          qualificationStage: 'A2',
          paper: 'P4',
          component: 4,
          reviewStatus: 'pending_official_review',
        },
      ],
    }).map((route) => route.routeId),
    ['cie-9709-as-p1-p4', 'cie-9709-a2-after-p1-p5-p3-p4'],
    'the real manifest routeHint shape must bind every registered route independently',
  )

  const completed = loadCompletedPaddleJob({ workRoot, job })
  const adapters = createPaddleAdapters({
    workRoot,
    job,
    completed,
    renderPdfImpl,
  })
  const renderDirectory = path.join(root, 'render')
  const render = await adapters.renderPdf(job.documents.qp.path, renderDirectory, 180)
  assert.deepEqual(render.pageImageHashes, { 1: hash(canonicalQuestionJpeg) }, 'student runtime provenance must use the canonical production renderer')
  assert.deepEqual(render.pageSizes, { 1: { width: 1200, height: 1600 } })
  assert.equal(render.ocr.engine, 'PaddleOCR-VL-1.6')
  assert.match((await adapters.extractPdfText(job.documents.qp.path, render.pageImageHashes))[1], /Question 1/)
  assert.match((await adapters.extractPdfText(job.documents.qp.path, render.pageImageHashes))[1], /layout-blocks/)
  const markSchemeRender = await adapters.renderPdf(job.documents.ms.path, path.join(root, 'render-ms'), 180)
  const rebound = adapters.transformStructuredResult({
    schemaName: 'ai_pdf_question_extraction_v1',
    value: {
      questions: [{
        questionNumber: '1',
        regions: [{ page: 1, pageImageSha256: hash(png), x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }],
        diagramRegions: [{ page: 1, pageImageSha256: hash(png), x0: 0.2, y0: 0.2, x1: 0.4, y1: 0.4 }],
        markSchemeEvidence: [{ page: 1, pageImageSha256: hash(png) }],
      }],
    },
  })
  assert.equal(rebound.questions[0].regions[0].pageImageSha256, hash(canonicalQuestionJpeg))
  assert.equal(rebound.questions[0].diagramRegions[0].pageImageSha256, hash(canonicalQuestionJpeg))
  assert.equal(rebound.questions[0].markSchemeEvidence[0].pageImageSha256, hash(canonicalMarkSchemeJpeg))
  assert.deepEqual(markSchemeRender.pageImageHashes, { 1: hash(canonicalMarkSchemeJpeg) })
  assert.throws(
    () => adapters.transformStructuredResult({
      schemaName: 'ai_pdf_question_extraction_v1',
      value: {
        questions: [{
          regions: [{ page: 1, pageImageSha256: 'f'.repeat(64), x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }],
          diagramRegions: [],
          markSchemeEvidence: [],
        }],
      },
    }),
    /PADDLE_QP_REVIEW_HASH_MISMATCH/,
    'a draft hash that matches neither the staged nor canonical page must fail closed',
  )
  const mismatchedSizeAdapters = createPaddleAdapters({
    workRoot,
    job,
    completed,
    renderPdfImpl: async () => ({
      pageImageHashes: { 1: hash(canonicalQuestionJpeg) },
      pageSizes: { 1: { width: 1201, height: 1600 } },
    }),
  })
  await assert.rejects(
    () => mismatchedSizeAdapters.renderPdf(job.documents.qp.path, path.join(root, 'render-mismatched-size'), 180),
    /PADDLE_CANONICAL_PAGE_SIZE_MISMATCH/,
    'a canonical render outside the OCR coordinate space must fail closed',
  )

  const calls = []
  const results = await ingestPaddleJob({
    workRoot,
    job,
    outputRoot,
    env: { OPENAI_API_KEY: 'test-key' },
    retry: true,
    renderPdfImpl,
    runCliImpl: async (options, hooks) => {
      calls.push({ options, hooks })
      assert.equal(options.coordinateOnly, true)
      assert.equal(options.pageWindowed, true)
      assert.equal(options.retry, true)
      assert.equal(typeof hooks.transformStructuredResult, 'function')
      await hooks.renderPdf(job.documents.qp.path, path.join(root, `render-${calls.length}`), 180)
      return { status: 'ai-verified', routeId: options.routeId }
    },
  })
  assert.equal(results.length, 2)
  assert.deepEqual(calls.map(({ options }) => options.routeId), [
    'cie-9709-as-p1-p4',
    'cie-9709-a2-after-p1-p5-p3-p4',
  ])
  assert.equal(new Set(calls.map(({ options }) => options.artifactSuffix)).size, 2)
  assert.ok(calls.every(({ options }) => options.ocrMetadata?.engine === 'PaddleOCR-VL-1.6'))

  const corrupted = buildJob()
  const corruptedPage = corrupted.state.documents.qp.pages[1]
  fs.appendFileSync(corruptedPage.layoutBlocksPath, 'tampered', 'utf8')
  assert.throws(
    () => loadCompletedPaddleJob({ workRoot, job: corrupted }),
    /PADDLE_LAYOUT_BLOCKS_HASH_MISMATCH/,
  )
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(JSON.stringify({ status: 'passed', scope: 'paddle-ocr-to-ai-ingestion' }))
