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

function safeRegion(value) {
  if (value === null || value === undefined) return null
  if (!Array.isArray(value) || value.length !== 4) return null
  const [x0, y0, x1, y1] = value.map(Number)
  return [x0, y0, x1, y1].every(Number.isFinite) && x0 >= 0 && y0 >= 0 && x1 <= 1 && y1 <= 1 && x0 < x1 && y0 < y1
    ? [x0, y0, x1, y1]
    : null
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

export function renderedPagePath(outputDirectory, page, prefix = 'page') {
  const safePrefix = String(prefix || '')
  const escapedPrefix = safePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^${escapedPrefix}-(\\d+)\\.jpg$`, 'i')
  const matches = fs.readdirSync(outputDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ entry, match: pattern.exec(entry.name) }))
    .filter(({ match }) => match && Number(match[1]) === Number(page))
    // Prefer the canonical unpadded spelling if a renderer leaves more than
    // one matching file, then choose deterministically by filename.
    .sort((left, right) => left.match[1].length - right.match[1].length || left.entry.name.localeCompare(right.entry.name))
  return matches[0] ? path.join(outputDirectory, matches[0].entry.name) : null
}

function jpegDimensions(bytes) {
  if (bytes?.[0] !== 0xff || bytes?.[1] !== 0xd8) throw sourceFailure('source_page_render_failed')
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) break
    const segmentLength = bytes.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) throw sourceFailure('source_page_render_failed')
    if (startOfFrameMarkers.has(marker)) {
      const height = bytes.readUInt16BE(offset + 3)
      const width = bytes.readUInt16BE(offset + 5)
      if (!width || !height) throw sourceFailure('source_page_render_failed')
      return { width, height }
    }
    offset += segmentLength
  }
  throw sourceFailure('source_page_render_failed')
}

function cropBounds(region, imageSize) {
  const [x0, y0, x1, y1] = region
  const left = Math.floor(x0 * imageSize.width)
  const top = Math.floor(y0 * imageSize.height)
  const right = Math.ceil(x1 * imageSize.width)
  const bottom = Math.ceil(y1 * imageSize.height)
  const width = right - left
  const height = bottom - top
  if (left < 0 || top < 0 || right > imageSize.width || bottom > imageSize.height || width <= 0 || height <= 0) {
    throw sourceFailure('source_provenance_mismatch')
  }
  return { left, top, width, height }
}

function rendererTimeoutMs(deadlineAt) {
  const timeoutMs = remainingDeadlineMs(deadlineAt)
  if (timeoutMs !== null && timeoutMs <= 0) throw sourceFailure('source_page_render_timeout')
  return timeoutMs
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
  const normalizedRegion = safeRegion(region)
  if (!expectedDocumentHash || !expectedPageHash || !safePageNumber || !dpi || (region !== null && region !== undefined && !normalizedRegion)) {
    throw sourceFailure('source_provenance_mismatch')
  }

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
    await runRenderer(executable, args, { timeoutMs: rendererTimeoutMs(deadlineAt) })
    const imagePath = renderedPagePath(outputDirectory, safePageNumber)
    if (!imagePath) throw sourceFailure('source_page_render_failed')
    const imageBytes = fs.readFileSync(imagePath)
    if (!imageBytes.length) throw sourceFailure('source_page_render_failed')
    const sourcePageSha256 = crypto.createHash('sha256').update(imageBytes).digest('hex')
    if (sourcePageSha256 !== expectedPageHash) throw sourceFailure('source_asset_checksum_mismatch')
    const sourcePageImageSize = jpegDimensions(imageBytes)

    let providerImageBytes = imageBytes
    let providerImageSize = sourcePageImageSize
    if (normalizedRegion) {
      const bounds = cropBounds(normalizedRegion, sourcePageImageSize)
      if (bounds.left !== 0 || bounds.top !== 0 || bounds.width !== sourcePageImageSize.width || bounds.height !== sourcePageImageSize.height) {
        const cropPrefix = path.join(outputDirectory, 'crop')
        const cropArgs = [
          '-f', String(safePageNumber),
          '-l', String(safePageNumber),
          '-x', String(bounds.left),
          '-y', String(bounds.top),
          '-W', String(bounds.width),
          '-H', String(bounds.height),
          ...buildRenderArgs({ pdfPath, outputPrefix: cropPrefix, dpi }),
        ]
        await runRenderer(executable, cropArgs, { timeoutMs: rendererTimeoutMs(deadlineAt) })
        const cropPath = renderedPagePath(outputDirectory, safePageNumber, 'crop')
        if (!cropPath) throw sourceFailure('source_page_render_failed')
        providerImageBytes = fs.readFileSync(cropPath)
        if (!providerImageBytes.length) throw sourceFailure('source_page_render_failed')
        providerImageSize = jpegDimensions(providerImageBytes)
        if (providerImageSize.width !== bounds.width || providerImageSize.height !== bounds.height) {
          throw sourceFailure('source_provenance_mismatch')
        }
      }
    }
    const sha256 = crypto.createHash('sha256').update(providerImageBytes).digest('hex')
    return Object.freeze({
      role: String(role || 'question-paper'),
      page: safePageNumber,
      sha256,
      sourcePageSha256,
      region: normalizedRegion ? Object.freeze([...normalizedRegion]) : null,
      imageSize: Object.freeze([providerImageSize.width, providerImageSize.height]),
      sourcePageImageSize: Object.freeze([sourcePageImageSize.width, sourcePageImageSize.height]),
      dataUrl: `data:image/jpeg;base64,${providerImageBytes.toString('base64')}`,
    })
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true })
  }
}
