import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildDryRunPlan, parseArgs, runCli } from './ingest-ai-pdf-questions.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-paddle-route-artifacts-'))
const questionPdf = path.join(root, '9709_m24_qp_42.pdf')
const markSchemePdf = path.join(root, '9709_m24_ms_42.pdf')
const outputRoot = path.join(root, 'artifacts')
const questionBytes = Buffer.from('%PDF-question-fixture', 'utf8')
const markSchemeBytes = Buffer.from('%PDF-mark-scheme-fixture', 'utf8')
fs.writeFileSync(questionPdf, questionBytes)
fs.writeFileSync(markSchemePdf, markSchemeBytes)

const pageBytes = Buffer.from('paddle-png-fixture', 'utf8')
const pageHash = crypto.createHash('sha256').update(pageBytes).digest('hex')

try {
  const options = parseArgs([
    '--paper-id', 'cie-9709-9709_m24_qp_42',
    '--question-pdf', questionPdf,
    '--mark-scheme-pdf', markSchemePdf,
    '--subject', '9709', '--stage', 'AS', '--route-id', 'cie-9709-as-p1-p4',
    '--output-root', outputRoot, '--artifact-suffix', 'route-cie-9709-as-p1-p4',
  ], { cwd: root, env: {} })
  const plan = buildDryRunPlan(options)
  assert.match(
    path.basename(plan.outputArtifactPath),
    /^[a-f0-9]{64}--route-cie-9709-as-p1-p4\.json$/,
    'route suffix must be part of the safe artifact filename',
  )

  let request = null
  const result = await runCli({
    ...options,
    ocrMetadata: {
      engine: 'PaddleOCR-VL-1.6',
      provider: 'PaddleOCR official API',
    },
  }, {
    env: { OPENAI_API_KEY: 'test-key' },
    renderPdf: async (_pdfPath, directory) => {
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(path.join(directory, 'page-1.png'), pageBytes)
      return {
        pageImageHashes: { 1: pageHash },
        pageSizes: { 1: { width: 1200, height: 1600 } },
      }
    },
    callStructured: async (value) => {
      request = value
      throw new Error('stop after input inspection')
    },
  })

  assert.equal(result.status, 'auto-quarantined')
  assert.equal(result.artifactSuffix, 'route-cie-9709-as-p1-p4')
  assert.equal(result.source.ocr.engine, 'PaddleOCR-VL-1.6')
  assert.equal(result.source.ocr.provider, 'PaddleOCR official API')
  const image = request.input.flatMap((message) => message.content || []).find((entry) => entry.type === 'input_image')
  assert.match(image.image_url, /^data:image\/png;base64,/, 'PNG pages must retain their MIME type')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(JSON.stringify({ status: 'passed', scope: 'paddle-route-artifact-isolation' }))
