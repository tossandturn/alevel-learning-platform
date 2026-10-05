import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { resolvePopplerExecutable } from './ai-pdf-ingestion/render.mjs'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function canonicalSha256(value, label) {
  const normalized = String(value || '').toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) throw new RangeError(`${label} must be a canonical SHA-256.`)
  return normalized
}

function pngDimensions(file) {
  const header = Buffer.alloc(24)
  const descriptor = fs.openSync(file, 'r')
  try {
    assert.equal(fs.readSync(descriptor, header, 0, header.length, 0), header.length)
  } finally {
    fs.closeSync(descriptor)
  }
  if (!header.subarray(0, 8).equals(PNG_SIGNATURE) || header.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Poppler output is not a canonical PNG with an IHDR header.')
  }
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
}

const assert = Object.freeze({
  equal(actual, expected) {
    if (actual !== expected) throw new Error(`Expected ${expected}, received ${actual}.`)
  },
})

export function renderCandidateSourcePage({
  renderer,
  pdfPath,
  expectedPdfSha256,
  page,
  dpi,
  outputRoot,
  expectedImageSha256,
  expectedWidth,
  expectedHeight,
  env = process.env,
} = {}) {
  if (renderer !== 'poppler-png') throw new RangeError('renderer must be poppler-png.')
  if (!path.isAbsolute(String(pdfPath || '')) || !fs.statSync(pdfPath).isFile()) throw new Error('pdfPath must identify an existing absolute file.')
  if (!path.isAbsolute(String(outputRoot || ''))) throw new RangeError('outputRoot must be absolute.')
  if (!Number.isInteger(page) || page < 1) throw new RangeError('page must be a positive integer.')
  if (!Number.isInteger(dpi) || dpi < 72 || dpi > 300) throw new RangeError('dpi must be an integer from 72 to 300.')
  if (!Number.isInteger(expectedWidth) || expectedWidth < 1 || !Number.isInteger(expectedHeight) || expectedHeight < 1) {
    throw new RangeError('expectedWidth and expectedHeight must be positive integers.')
  }
  const pdfSha256 = canonicalSha256(expectedPdfSha256, 'expectedPdfSha256')
  if (sha256File(pdfPath) !== pdfSha256) throw new Error('PDF SHA-256 mismatch; refusing source-page rerender.')
  const imageSha256 = canonicalSha256(expectedImageSha256, 'expectedImageSha256')

  fs.mkdirSync(outputRoot, { recursive: true })
  const outputPrefix = path.join(outputRoot, `page-${String(page).padStart(3, '0')}-poppler-${dpi}dpi`)
  const outputPath = `${outputPrefix}.png`
  if (fs.existsSync(outputPath)) throw new Error(`Refuse to overwrite rendered source page: ${outputPath}`)
  const executable = resolvePopplerExecutable('pdftoppm', { env })
  execFileSync(executable, [
    '-f', String(page), '-l', String(page), '-singlefile', '-r', String(dpi), '-png', '--',
    path.resolve(pdfPath), outputPrefix,
  ], { encoding: 'utf8', timeout: 60_000, windowsHide: true })
  if (!fs.existsSync(outputPath)) throw new Error(`Poppler did not produce the requested PNG: ${outputPath}`)
  const actualSha256 = sha256File(outputPath)
  if (actualSha256 !== imageSha256) throw new Error(`Rendered page SHA-256 mismatch: ${actualSha256}`)
  const dimensions = pngDimensions(outputPath)
  if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
    throw new Error(`Rendered page dimensions mismatch: ${dimensions.width}x${dimensions.height}`)
  }
  return Object.freeze({
    renderer,
    path: outputPath,
    sha256: actualSha256,
    width: dimensions.width,
    height: dimensions.height,
    dpi,
    page,
    sourcePdfSha256: pdfSha256,
  })
}
