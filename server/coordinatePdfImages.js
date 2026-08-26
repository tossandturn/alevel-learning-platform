import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { buildRenderArgs, resolvePopplerExecutable } from '../scripts/ai-pdf-ingestion/render.mjs'

const SHA256 = /^[a-f0-9]{64}$/i
const DEFAULT_RENDER_DPI = 180

function sourceFailure(code) {
  return Object.assign(new Error('The paired official source images are unavailable for this response.'), {
    statusCode: 422,
    code,
  })
}

function normalizedSha256(value) {
  const hash = String(value || '').trim().replace(/^sha256:/i, '')
  return SHA256.test(hash) ? hash.toLowerCase() : ''
}

function safePage(value) {
  const page = Number(value)
  return Number.isInteger(page) && page > 0 && page <= 1000 ? page : 0
}

function safeRenderDpi(value) {
  const dpi = value === undefined || value === null || value === '' ? DEFAULT_RENDER_DPI : Number(value)
  return Number.isInteger(dpi) && dpi >= 72 && dpi <= 300 ? dpi : 0
}

function localPdfPath(libraryRoot, subject, fileName) {
  const root = path.resolve(String(libraryRoot || ''))
  const safeSubject = String(subject || '').trim()
  const safeFileName = String(fileName || '').trim()
  if (!root || !/^\d{4}$/.test(safeSubject) || !safeFileName || path.basename(safeFileName) !== safeFileName || !safeFileName.toLowerCase().endsWith('.pdf')) {
    throw sourceFailure('source_asset_unavailable')
  }
  const subjectRoot = path.resolve(root, safeSubject)
  const resolved = path.resolve(subjectRoot, safeFileName)
  const relative = path.relative(subjectRoot, resolved)
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw sourceFailure('source_asset_unavailable')
  }
  return resolved
}

function remainingDeadlineMs(deadlineAt) {
  if (!Number.isFinite(deadlineAt)) return null
  return Math.floor(deadlineAt - Date.now())
}

export function runRenderer(executable, args, { timeoutMs = null } = {}) {
  return new Promise((resolve, reject) => {
    let finished = false
    let timeout = null
    let terminationTimeout = null
    let timedOut = false
    const finish = (error = null) => {
      if (finished) return
      finished = true
      if (timeout) clearTimeout(timeout)
      if (terminationTimeout) clearTimeout(terminationTimeout)
      if (error) reject(error)
      else resolve()
    }
    let child
    try {
      child = spawn(executable, args, { stdio: 'ignore', windowsHide: true })
    } catch {
      finish(sourceFailure('source_page_render_failed'))
      return
    }
    child.once('error', () => finish(sourceFailure(timedOut ? 'source_page_render_timeout' : 'source_page_render_failed')))
    child.once('close', (code) => finish(timedOut || code !== 0 ? sourceFailure(timedOut ? 'source_page_render_timeout' : 'source_page_render_failed') : null))
    const rendererTimeoutMs = Number(timeoutMs)
    if (Number.isFinite(rendererTimeoutMs) && rendererTimeoutMs > 0) {
      timeout = setTimeout(() => {
        if (finished) return
        timedOut = true
        child.kill('SIGKILL')
        // A hard-killed renderer normally closes immediately. Keep the HTTP
        // request bounded even if a platform fails to report that close event.
        terminationTimeout = setTimeout(() => finish(sourceFailure('source_page_render_timeout')), 250)
      }, Math.floor(rendererTimeoutMs))
    }
  })
}

function renderedPagePath(outputDirectory, page) {
  const match = fs.readdirSync(outputDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, page: /^page-(\d+)\.jpg$/i.exec(entry.name) }))
    .find((entry) => entry.page && Number(entry.page[1]) === page)
  return match ? path.join(outputDirectory, match.name) : null
}

/**
 * Render one page of a checksum-bound local PDF without retaining a derived
 * crop on disk. The JPEG settings deliberately match AI-PDF ingestion so the
 * stored page hash can verify the bytes passed to the marking model.
 */
export async function renderVerifiedCoordinatePdfPage({
  libraryRoot,
  subject,
  fileName,
  expectedPdfSha256,
  page,
  expectedPageImageSha256,
  role,
  region = null,
  renderDpi,
  deadlineAt = null,
  env = process.env,
} = {}) {
  const expectedDocumentHash = normalizedSha256(expectedPdfSha256)
  const expectedPageHash = normalizedSha256(expectedPageImageSha256)
  const safePageNumber = safePage(page)
  const dpi = safeRenderDpi(renderDpi)
  if (!expectedDocumentHash || !expectedPageHash || !safePageNumber || !dpi) throw sourceFailure('source_provenance_mismatch')
  const rendererTimeoutMs = remainingDeadlineMs(deadlineAt)
  if (rendererTimeoutMs !== null && rendererTimeoutMs <= 0) throw sourceFailure('source_page_render_timeout')

  const pdfPath = localPdfPath(libraryRoot, subject, fileName)
  const stat = fs.statSync(pdfPath, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.size <= 0) throw sourceFailure('source_asset_unavailable')
  const pdfBytes = fs.readFileSync(pdfPath)
  if (crypto.createHash('sha256').update(pdfBytes).digest('hex') !== expectedDocumentHash) {
    throw sourceFailure('source_pdf_checksum_mismatch')
  }

  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-coordinate-marking-'))
  try {
    const outputPrefix = path.join(outputDirectory, 'page')
    const executable = resolvePopplerExecutable('pdftoppm', { env })
    const args = ['-f', String(safePageNumber), '-l', String(safePageNumber), ...buildRenderArgs({
      pdfPath,
      outputPrefix,
      dpi,
    })]
    await runRenderer(executable, args, { timeoutMs: rendererTimeoutMs })
    const imagePath = renderedPagePath(outputDirectory, safePageNumber)
    if (!imagePath) throw sourceFailure('source_page_render_failed')
    const imageBytes = fs.readFileSync(imagePath)
    if (!imageBytes.length) throw sourceFailure('source_page_render_failed')
    const sha256 = crypto.createHash('sha256').update(imageBytes).digest('hex')
    if (sha256 !== expectedPageHash) throw sourceFailure('source_asset_checksum_mismatch')
    return Object.freeze({
      role: String(role || 'question-paper'),
      page: safePageNumber,
      sha256,
      region: Array.isArray(region) ? [...region] : null,
      dataUrl: `data:image/jpeg;base64,${imageBytes.toString('base64')}`,
    })
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true })
  }
}
