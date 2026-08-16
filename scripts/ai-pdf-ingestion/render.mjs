import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeRegion } from './contract.mjs'

const popplerTools = Object.freeze({
  pdftoppm: { envName: 'PDFTOPPM_BIN', executable: 'pdftoppm' },
  pdftocairo: { envName: 'PDFTOCAIRO_BIN', executable: 'pdftocairo' },
})
const sourceHashPattern = /^(?:sha256:)?([a-fA-F0-9]{64})$/
const safePathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const maxRenderDpi = 300
const cropHelperPath = fileURLToPath(new URL('./crop_pdf.py', import.meta.url))

export function resolvePopplerExecutable(kind, { env = process.env, existsSync = fs.existsSync } = {}) {
  const tool = popplerTools[kind]
  if (!tool) {
    throw new RangeError(`Unsupported Poppler executable kind: ${String(kind)}.`)
  }

  const configured = env?.[tool.envName]
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim()
  }
  if (process.platform !== 'win32') {
    return tool.executable
  }

  const bundled = path.join(
    os.homedir(),
    '.cache',
    'codex-runtimes',
    'codex-primary-runtime',
    'dependencies',
    'native',
    'poppler',
    'Library',
    'bin',
    `${tool.executable}.exe`,
  )
  return existsSync(bundled) ? bundled : `${tool.executable}.exe`
}

export function buildRenderArgs({ pdfPath, outputPrefix, dpi } = {}) {
  assertAbsolutePath(pdfPath, 'pdfPath')
  assertAbsolutePath(outputPrefix, 'outputPrefix')
  if (!Number.isInteger(dpi) || dpi <= 0 || dpi > maxRenderDpi) {
    throw new RangeError(`dpi must be a positive integer no greater than ${maxRenderDpi}.`)
  }
  return ['-jpeg', '-jpegopt', 'quality=82', '-r', String(dpi), '--', pdfPath, outputPrefix]
}

export function imageSha256(filePath) {
  assertNonemptyPath(filePath, 'filePath')
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

export function buildCropManifest({
  paperId,
  questionId,
  sourcePdfPath,
  sourcePdfSha256,
  regions,
  pageSizes,
  outputRoot,
} = {}) {
  assertSafePathSegment(paperId, 'paperId')
  assertSafePathSegment(questionId, 'questionId')
  assertNonemptyPath(outputRoot, 'outputRoot')
  if (!path.isAbsolute(outputRoot)) {
    throw new RangeError('outputRoot must be an absolute path.')
  }
  const sourceHash = normalizeSourceHash(sourcePdfSha256)
  const normalizedSourcePdfPath = sourcePdfPath === undefined
    ? undefined
    : assertAbsolutePath(sourcePdfPath, 'sourcePdfPath')
  if (!Array.isArray(regions) || regions.length === 0) {
    throw new RangeError('regions must be a non-empty array.')
  }

  const questionDirectory = filesystemSafeSegment(questionId)
  const outputDirectory = path.resolve(outputRoot, paperId, 'ai-verified', questionDirectory)
  assertWithinRoot(path.resolve(outputRoot), outputDirectory)
  const crops = deduplicateAndSortRegions(regions).map((region, index) => buildCropEntry({
    region,
    regionIndex: index,
    pageSizes,
    outputDirectory,
  }))

  return {
    paperId,
    questionId,
    sourcePdfPath: normalizedSourcePdfPath,
    sourcePdfSha256: sourceHash,
    questionDirectory,
    outputDirectory,
    questionPdfPath: path.join(outputDirectory, 'question.pdf'),
    crops,
  }
}

export function buildCropCommand(manifest, { pythonPath = 'py' } = {}) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError('manifest must be an object.')
  }
  if (typeof pythonPath !== 'string' || !pythonPath.trim()) {
    throw new TypeError('pythonPath must be a non-empty command string.')
  }
  const sourcePdfPath = assertAbsolutePath(manifest.sourcePdfPath, 'manifest.sourcePdfPath')
  const questionPdfPath = assertAbsolutePath(manifest.questionPdfPath, 'manifest.questionPdfPath')
  if (!Array.isArray(manifest.crops) || manifest.crops.length === 0) {
    throw new RangeError('manifest.crops must be a non-empty array.')
  }

  const args = ['-3.12', cropHelperPath, '--input', sourcePdfPath, '--output', questionPdfPath]
  for (const crop of manifest.crops) {
    const region = crop?.normalizedRegion
    if (!Number.isInteger(crop?.page) || !region) {
      throw new RangeError('Each manifest crop must contain a page and normalized region.')
    }
    const normalized = normalizeRegion(region)
    args.push('--region', [crop.page, normalized.x0, normalized.y0, normalized.x1, normalized.y1].join(','))
  }
  return { command: pythonPath.trim(), args }
}

function buildCropEntry({ region, regionIndex, pageSizes, outputDirectory }) {
  if (!region || typeof region !== 'object' || Array.isArray(region)) {
    throw new RangeError('Each crop region must be an object.')
  }
  if (!Number.isInteger(region.page) || region.page < 1) {
    throw new RangeError('Each crop region page must be a positive integer.')
  }
  const normalizedRegion = normalizeRegion(region)
  const pageSize = resolvePageSize(pageSizes, region.page)
  const pixelBounds = {
    x0: Math.floor(normalizedRegion.x0 * pageSize.width),
    y0: Math.floor(normalizedRegion.y0 * pageSize.height),
    x1: Math.ceil(normalizedRegion.x1 * pageSize.width),
    y1: Math.ceil(normalizedRegion.y1 * pageSize.height),
  }
  const filename = `page-${String(region.page).padStart(3, '0')}-region-${String(regionIndex + 1).padStart(3, '0')}.pdf`
  const outputPath = path.join(outputDirectory, filename)
  assertWithinRoot(outputDirectory, outputPath)
  return {
    page: region.page,
    normalizedRegion,
    pageSize,
    pixelBounds,
    outputPath,
  }
}

function deduplicateAndSortRegions(regions) {
  const normalized = regions.map(region => {
    if (!region || typeof region !== 'object' || Array.isArray(region) || !Number.isInteger(region.page) || region.page < 1) {
      throw new RangeError('Each crop region must include a positive integer page.')
    }
    return { page: region.page, ...normalizeRegion(region) }
  })
  normalized.sort((left, right) => left.page - right.page
    || left.y0 - right.y0
    || left.x0 - right.x0
    || left.y1 - right.y1
    || left.x1 - right.x1)
  return normalized.filter((region, index) => index === 0
    || region.page !== normalized[index - 1].page
    || region.x0 !== normalized[index - 1].x0
    || region.y0 !== normalized[index - 1].y0
    || region.x1 !== normalized[index - 1].x1
    || region.y1 !== normalized[index - 1].y1)
}

function resolvePageSize(pageSizes, page) {
  const candidate = pageSizes instanceof Map ? pageSizes.get(page) : pageSizes?.[page]
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
    || !Number.isInteger(candidate.width) || candidate.width <= 0
    || !Number.isInteger(candidate.height) || candidate.height <= 0) {
    throw new RangeError(`pageSizes must define positive integer width and height for page ${page}.`)
  }
  return { width: candidate.width, height: candidate.height }
}

function normalizeSourceHash(value) {
  const match = typeof value === 'string' ? sourceHashPattern.exec(value) : null
  if (!match) {
    throw new RangeError('sourcePdfSha256 must be a canonical SHA-256 string.')
  }
  return match[1].toLowerCase()
}

function assertSafePathSegment(value, name) {
  if (typeof value !== 'string' || !safePathSegmentPattern.test(value)) {
    throw new RangeError(`${name} must be a single safe path segment.`)
  }
}

function filesystemSafeSegment(value) {
  return value.replace(/:/g, '%3A')
}

function assertNonemptyPath(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty path string.`)
  }
}

function assertAbsolutePath(value, name) {
  assertNonemptyPath(value, name)
  if (!path.isAbsolute(value)) {
    throw new RangeError(`${name} must be an absolute path.`)
  }
  return path.resolve(value)
}

function assertWithinRoot(root, target) {
  const relative = path.relative(root, target)
  if (relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new RangeError('Output path must remain below its output root.')
  }
}
