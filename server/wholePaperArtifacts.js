import crypto from 'node:crypto'
import path from 'node:path'

import { createCanvas, loadImage } from '@napi-rs/canvas'
import { PDFDocument } from 'pdf-lib'

export const WHOLE_PAPER_LIMITS = Object.freeze({
  maxAnswerPages: 20,
  maxAnswerImages: 20,
  maxReferencePages: 40,
  maxPdfBytes: 10 * 1024 * 1024,
  maxImageBytes: 4 * 1024 * 1024,
  maxJobBytes: 40 * 1024 * 1024,
  maxImagePixels: 12_000_000,
  maxAnswerTotalPixels: 60_000_000,
  maxPdfEmbeddedPagePixels: 2_500_000,
  maxPdfEmbeddedPageDimension: 2_000,
  maxRenderedPagePixels: 2_500_000,
  maxRenderedPageDimension: 1_600,
})

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const PDF_TYPE = 'application/pdf'
const PDF_STANDARD_FONT_DATA_URL = `${path.resolve(import.meta.dirname, '../node_modules/pdfjs-dist/standard_fonts')}${path.sep}`

function artifactError(code, message, statusCode = 422) {
  return Object.assign(new Error(message), { code, statusCode })
}

function exactMediaType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase()
}

function imageMagic(bytes, mediaType) {
  if (mediaType === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  if (mediaType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mediaType === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  return false
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || !imageMagic(bytes, 'image/png') || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function jpegDimensions(bytes) {
  if (!imageMagic(bytes, 'image/jpeg')) return null
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) break
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 1 >= bytes.length) break
    const segmentLength = bytes.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null
    if (startOfFrame.has(marker) && segmentLength >= 7) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
    }
    offset += segmentLength
  }
  return null
}

function webpDimensions(bytes) {
  if (!imageMagic(bytes, 'image/webp')) return null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const type = bytes.subarray(offset, offset + 4).toString('ascii')
    const chunkSize = bytes.readUInt32LE(offset + 4)
    const payload = offset + 8
    if (payload + chunkSize > bytes.length) return null
    if (type === 'VP8X' && chunkSize >= 10) {
      return {
        width: 1 + bytes.readUIntLE(payload + 4, 3),
        height: 1 + bytes.readUIntLE(payload + 7, 3),
      }
    }
    if (type === 'VP8L' && chunkSize >= 5 && bytes[payload] === 0x2f) {
      const first = bytes[payload + 1]
      const second = bytes[payload + 2]
      const third = bytes[payload + 3]
      const fourth = bytes[payload + 4]
      return {
        width: 1 + first + ((second & 0x3f) << 8),
        height: 1 + (second >> 6) + (third << 2) + ((fourth & 0x0f) << 10),
      }
    }
    if (type === 'VP8 ' && chunkSize >= 10
      && bytes[payload + 3] === 0x9d && bytes[payload + 4] === 0x01 && bytes[payload + 5] === 0x2a) {
      return {
        width: bytes.readUInt16LE(payload + 6) & 0x3fff,
        height: bytes.readUInt16LE(payload + 8) & 0x3fff,
      }
    }
    offset = payload + chunkSize + (chunkSize % 2)
  }
  return null
}

function encodedImageDimensions(bytes, mediaType) {
  if (mediaType === 'image/png') return pngDimensions(bytes)
  if (mediaType === 'image/jpeg') return jpegDimensions(bytes)
  if (mediaType === 'image/webp') return webpDimensions(bytes)
  return null
}

function validImageDimensions(value) {
  const width = Number(value?.width)
  const height = Number(value?.height)
  return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
    && width <= 100_000 && height <= 100_000
    && width * height <= WHOLE_PAPER_LIMITS.maxImagePixels
}

function pdfMagic(bytes) {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-'
}

async function pdfPageCount(bytes) {
  let loadingTask
  let document
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableWorker: true,
      isEvalSupported: false,
      useSystemFonts: true,
    })
    document = await loadingTask.promise
    return Number(document.numPages)
  } catch {
    throw artifactError('asset_pdf_invalid', 'The uploaded PDF could not be opened.', 400)
  } finally {
    try { if (document?.destroy) await document.destroy() }
    catch { /* The validation result is already determined. */ }
    try { if (!document && loadingTask?.destroy) await loadingTask.destroy() }
    catch { /* Ignore PDF.js cleanup failures. */ }
  }
}

export function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

export async function inspectWholePaperAsset({ bytes, role, mediaType } = {}) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || [])
  const type = exactMediaType(mediaType)
  const safeRole = String(role || '')
  if (!body.length) throw artifactError('asset_empty', 'The uploaded file is empty.', 400)
  if (type === PDF_TYPE) {
    if (body.length > WHOLE_PAPER_LIMITS.maxPdfBytes) throw artifactError('asset_size_limit', 'Each PDF must be 10 MiB or smaller.', 413)
    if (!pdfMagic(body)) throw artifactError('asset_type_mismatch', 'The uploaded bytes do not match the declared PDF type.', 400)
    const pageCount = await pdfPageCount(body)
    const maximum = safeRole === 'answer' ? WHOLE_PAPER_LIMITS.maxAnswerPages : WHOLE_PAPER_LIMITS.maxReferencePages
    if (!Number.isInteger(pageCount) || pageCount < 1) throw artifactError('asset_pdf_invalid', 'The uploaded PDF has no readable pages.', 400)
    if (pageCount > maximum) {
      throw artifactError(safeRole === 'answer' ? 'answer_page_limit' : 'reference_page_limit', `The uploaded PDF exceeds the ${maximum}-page limit.`, 413)
    }
    return Object.freeze({ mediaType: type, size: body.length, pageCount, sha256: sha256(body) })
  }
  if (!IMAGE_TYPES.has(type)) throw artifactError('asset_type_unsupported', 'Only PDF, PNG, JPEG and WebP files are accepted.', 415)
  if (safeRole !== 'answer') throw artifactError('reference_type_unsupported', 'Question-paper and mark-scheme references must be PDF files.', 415)
  if (body.length > WHOLE_PAPER_LIMITS.maxImageBytes) throw artifactError('asset_size_limit', 'Each image must be 4 MiB or smaller.', 413)
  if (!imageMagic(body, type)) throw artifactError('asset_type_mismatch', 'The uploaded bytes do not match the declared image type.', 400)
  const encodedDimensions = encodedImageDimensions(body, type)
  if (!validImageDimensions(encodedDimensions)) {
    throw artifactError('asset_image_dimensions', 'The uploaded image header has unsupported dimensions.', 413)
  }
  let image
  try {
    image = await loadImage(body)
  } catch {
    throw artifactError('asset_image_invalid', 'The uploaded image could not be decoded.', 400)
  }
  const width = Number(image.width)
  const height = Number(image.height)
  const decodedDimensionsMatch = width === encodedDimensions.width && height === encodedDimensions.height
  const decodedDimensionsMatchExifRotation = type === 'image/jpeg'
    && width === encodedDimensions.height && height === encodedDimensions.width
  if (!validImageDimensions({ width, height }) || (!decodedDimensionsMatch && !decodedDimensionsMatchExifRotation)) {
    throw artifactError('asset_image_dimensions', 'The uploaded image dimensions are unsupported.', 413)
  }
  return Object.freeze({ mediaType: type, size: body.length, pageCount: 1, width, height, sha256: sha256(body) })
}

export async function orderedImagesToPdf(images = [], { signal } = {}) {
  if (!Array.isArray(images) || !images.length || images.length > WHOLE_PAPER_LIMITS.maxAnswerImages) {
    throw artifactError('answer_image_count', `Upload between 1 and ${WHOLE_PAPER_LIMITS.maxAnswerImages} answer images.`, 400)
  }
  const document = await PDFDocument.create()
  document.setTitle('Student answer')
  document.setCreator('STEM AI Coach')
  document.setProducer('STEM AI Coach')
  for (const entry of images) {
    if (signal?.aborted) throw artifactError('marking_cancelled', 'Answer PDF composition was cancelled.', 499)
    const bytes = Buffer.isBuffer(entry?.bytes) ? entry.bytes : Buffer.from(entry?.bytes || [])
    await inspectWholePaperAsset({ bytes, role: 'answer', mediaType: entry?.mediaType })
    const image = await loadImage(bytes)
    if (signal?.aborted) throw artifactError('marking_cancelled', 'Answer PDF composition was cancelled.', 499)
    const normalizationScale = Math.min(
      1,
      WHOLE_PAPER_LIMITS.maxPdfEmbeddedPageDimension / Math.max(image.width, image.height),
      Math.sqrt(WHOLE_PAPER_LIMITS.maxPdfEmbeddedPagePixels / (image.width * image.height)),
    )
    const normalizedWidth = Math.max(1, Math.floor(image.width * normalizationScale))
    const normalizedHeight = Math.max(1, Math.floor(image.height * normalizationScale))
    const normalized = createCanvas(normalizedWidth, normalizedHeight)
    const normalizedContext = normalized.getContext('2d')
    normalizedContext.fillStyle = '#ffffff'
    normalizedContext.fillRect(0, 0, normalizedWidth, normalizedHeight)
    normalizedContext.drawImage(image, 0, 0, normalizedWidth, normalizedHeight)
    if (signal?.aborted) throw artifactError('marking_cancelled', 'Answer PDF composition was cancelled.', 499)
    const landscape = normalizedWidth > normalizedHeight
    const pageWidth = landscape ? 842 : 595
    const pageHeight = landscape ? 595 : 842
    const margin = 24
    const scale = Math.min((pageWidth - margin * 2) / normalizedWidth, (pageHeight - margin * 2) / normalizedHeight)
    const drawWidth = normalizedWidth * scale
    const drawHeight = normalizedHeight * scale
    const normalizedJpeg = normalized.toBuffer('image/jpeg', { quality: 0.9, chromaSubsampling: true })
    const embedded = await document.embedJpg(normalizedJpeg)
    const page = document.addPage([pageWidth, pageHeight])
    page.drawImage(embedded, {
      x: (pageWidth - drawWidth) / 2,
      y: (pageHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    })
  }
  const pdf = Buffer.from(await document.save({ useObjectStreams: true, addDefaultPage: false }))
  if (!pdfMagic(pdf)) throw artifactError('source_pdf_invalid', 'The answer PDF could not be generated.', 500)
  if (pdf.length > WHOLE_PAPER_LIMITS.maxJobBytes) throw artifactError('source_pdf_size_limit', 'The generated answer PDF is too large.', 413)
  return pdf
}

function boundedViewport(page) {
  const natural = page.getViewport({ scale: 1.5 })
  if (!Number.isFinite(natural.width) || !Number.isFinite(natural.height) || natural.width <= 0 || natural.height <= 0) {
    throw artifactError('asset_pdf_dimensions', 'The PDF page dimensions are unsupported.', 413)
  }
  const dimensionScale = Math.min(1, WHOLE_PAPER_LIMITS.maxRenderedPageDimension / Math.max(natural.width, natural.height))
  const pixelScale = Math.min(1, Math.sqrt(WHOLE_PAPER_LIMITS.maxRenderedPagePixels / Math.max(1, natural.width * natural.height)))
  let scale = 1.5 * Math.min(dimensionScale, pixelScale)
  if (!Number.isFinite(scale) || scale <= 0) throw artifactError('asset_pdf_dimensions', 'The PDF page dimensions are unsupported.', 413)
  let viewport = page.getViewport({ scale })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const width = Math.max(1, Math.ceil(viewport.width))
    const height = Math.max(1, Math.ceil(viewport.height))
    const adjustment = Math.min(
      1,
      WHOLE_PAPER_LIMITS.maxRenderedPageDimension / width,
      WHOLE_PAPER_LIMITS.maxRenderedPageDimension / height,
      Math.sqrt(WHOLE_PAPER_LIMITS.maxRenderedPagePixels / (width * height)),
    )
    if (adjustment >= 1) return viewport
    scale *= adjustment * 0.999
    viewport = page.getViewport({ scale })
  }
  return viewport
}

export async function renderPdfToPageImages(bytes, { maxPages = WHOLE_PAPER_LIMITS.maxReferencePages, signal } = {}) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || [])
  if (!pdfMagic(body)) throw artifactError('asset_pdf_invalid', 'The PDF could not be rendered.', 400)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(body),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: PDF_STANDARD_FONT_DATA_URL,
  })
  let document
  try {
    document = await loadingTask.promise
    if (document.numPages > maxPages) throw artifactError('render_page_limit', `The PDF exceeds the ${maxPages}-page rendering limit.`, 413)
    const pages = []
    for (let index = 1; index <= document.numPages; index += 1) {
      if (signal?.aborted) throw artifactError('marking_cancelled', 'The PDF rendering was cancelled.', 499)
      const page = await document.getPage(index)
      const viewport = boundedViewport(page)
      const width = Math.max(1, Math.ceil(viewport.width))
      const height = Math.max(1, Math.ceil(viewport.height))
      if (width > WHOLE_PAPER_LIMITS.maxRenderedPageDimension
        || height > WHOLE_PAPER_LIMITS.maxRenderedPageDimension
        || width * height > WHOLE_PAPER_LIMITS.maxRenderedPagePixels) {
        throw artifactError('asset_pdf_dimensions', 'The rendered PDF page exceeds the safe pixel budget.', 413)
      }
      const canvas = createCanvas(width, height)
      const context = canvas.getContext('2d')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      const renderTask = page.render({ canvasContext: context, viewport, background: '#ffffff' })
      const cancelRender = () => renderTask.cancel?.()
      if (signal?.aborted) cancelRender()
      else signal?.addEventListener?.('abort', cancelRender, { once: true })
      try {
        await renderTask.promise
      } catch (error) {
        if (signal?.aborted) throw artifactError('marking_cancelled', 'The PDF rendering was cancelled.', 499)
        throw error
      } finally {
        signal?.removeEventListener?.('abort', cancelRender)
      }
      const rendered = await canvas.encode('jpeg', 86)
      pages.push(Object.freeze({
        page: index,
        width,
        height,
        mediaType: 'image/jpeg',
        bytes: rendered,
        sha256: sha256(rendered),
        dataUrl: `data:image/jpeg;base64,${rendered.toString('base64')}`,
      }))
      page.cleanup?.()
    }
    return Object.freeze(pages)
  } catch (error) {
    if (error?.code) throw error
    throw artifactError('asset_pdf_invalid', 'The PDF could not be rendered.', 400)
  } finally {
    try { if (document?.destroy) await document.destroy() }
    catch { /* Ignore cleanup failures. */ }
    try { if (!document && loadingTask?.destroy) await loadingTask.destroy() }
    catch { /* Ignore cleanup failures. */ }
  }
}

export function safeArtifactFileName(value, fallback = 'document') {
  const base = path.basename(String(value || '')).replace(/\p{Cc}/gu, '').trim().slice(0, 120)
  return base || fallback
}
