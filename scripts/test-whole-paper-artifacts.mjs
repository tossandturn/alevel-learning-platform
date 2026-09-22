import assert from 'node:assert/strict'
import fs from 'node:fs'

import { createCanvas, loadImage } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, rgb, StandardFonts } from 'pdf-lib'

import {
  WHOLE_PAPER_LIMITS,
  inspectWholePaperAsset,
  orderedImagesToPdf,
  renderPdfToPageImages,
} from '../server/wholePaperArtifacts.js'

for (const file of ['server/wholePaperArtifacts.js', 'server/wholePaperReport.js']) {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  assert.doesNotMatch(source, /import[^\n]*PDFDocument[^\n]*from ['"]@napi-rs\/canvas['"]/u, `${file} must not depend on the canvas PDFDocument export missing on Linux`)
}

function pngFixture(label, width = 480, height = 320, background = '#ffffff') {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = background
  context.fillRect(0, 0, width, height)
  context.fillStyle = background === '#ffffff' ? '#123456' : '#ffffff'
  context.font = 'bold 42px sans-serif'
  context.fillText(label, 36, 100)
  return canvas.toBuffer('image/png')
}

async function pdfFixture(pageCount = 2) {
  const document = await PDFDocument.create()
  document.setTitle('Whole paper fixture')
  const font = await document.embedFont(StandardFonts.Helvetica)
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.addPage([595, 842])
    page.drawText(`PDF page ${index + 1}`, { x: 60, y: 742, size: 32, font, color: rgb(0.07, 0.07, 0.07) })
  }
  return Buffer.from(await document.save())
}

async function extremePdfFixture() {
  const document = await PDFDocument.create()
  document.setTitle('Extreme MediaBox fixture')
  const page = document.addPage([1_000_000, 1_000_000])
  page.drawRectangle({ x: 0, y: 0, width: 1, height: 1 })
  return Buffer.from(await document.save())
}

async function oversizedImageXObjectPdfFixture() {
  const seedCanvas = createCanvas(1, 1)
  const seedContext = seedCanvas.getContext('2d')
  seedContext.fillStyle = '#f00'
  seedContext.fillRect(0, 0, 1, 1)
  const document = await PDFDocument.create()
  const image = await document.embedJpg(seedCanvas.toBuffer('image/jpeg'))
  const page = document.addPage([595, 842])
  page.drawImage(image, { x: 40, y: 200, width: 500, height: 500 })
  await document.flush()
  const imageStream = document.context.lookup(image.ref, PDFRawStream)
  imageStream.dict.set(PDFName.of('Width'), PDFNumber.of(20_000))
  imageStream.dict.set(PDFName.of('Height'), PDFNumber.of(20_000))
  return Buffer.from(await document.save({ useObjectStreams: true }))
}

async function ordinaryScanPdfFixture() {
  const scan = createCanvas(1_200, 1_600)
  const context = scan.getContext('2d')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, scan.width, scan.height)
  context.fillStyle = '#222'
  context.font = '48px sans-serif'
  context.fillText('Ordinary scan', 80, 160)
  const document = await PDFDocument.create()
  const image = await document.embedJpg(scan.toBuffer('image/jpeg', { quality: 0.86 }))
  const page = document.addPage([595, 842])
  page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 })
  return Buffer.from(await document.save({ useObjectStreams: true }))
}

const first = pngFixture('Answer page 1', 480, 320, '#00aa44')
const second = pngFixture('Answer page 2', 320, 480, '#2255cc')

const portraitCanvas = createCanvas(40, 80)
const portraitContext = portraitCanvas.getContext('2d')
portraitContext.fillStyle = '#fff'
portraitContext.fillRect(0, 0, 40, 80)
portraitContext.fillStyle = '#c00'
portraitContext.fillRect(4, 6, 12, 24)
const portraitJpeg = portraitCanvas.toBuffer('image/jpeg')
const orientation6 = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000', 'hex')
const rotatedPhoneJpeg = Buffer.concat([portraitJpeg.subarray(0, 2), orientation6, portraitJpeg.subarray(2)])
const inspectedRotatedPhoneJpeg = await inspectWholePaperAsset({ bytes: rotatedPhoneJpeg, role: 'answer', mediaType: 'image/jpeg' })
assert.equal(inspectedRotatedPhoneJpeg.width, 80, 'EXIF orientation 6 must use the decoder-rotated width')
assert.equal(inspectedRotatedPhoneJpeg.height, 40, 'EXIF orientation 6 must use the decoder-rotated height')
const rotatedPhonePdf = await orderedImagesToPdf([{ bytes: rotatedPhoneJpeg, mediaType: 'image/jpeg' }])
const rotatedPhoneDocument = await getDocument({ data: new Uint8Array(rotatedPhonePdf), disableWorker: true }).promise
const rotatedPhonePage = await rotatedPhoneDocument.getPage(1)
const rotatedPhoneViewport = rotatedPhonePage.getViewport({ scale: 1 })
assert.ok(rotatedPhoneViewport.width > rotatedPhoneViewport.height, 'the source PDF must preserve the decoder-applied landscape orientation')
await rotatedPhoneDocument.destroy()

const inspectedImage = await inspectWholePaperAsset({
  bytes: first,
  role: 'answer',
  mediaType: 'image/png',
})
assert.equal(inspectedImage.pageCount, 1)
assert.equal(inspectedImage.width, 480)
assert.equal(inspectedImage.height, 320)

for (const [mediaType, bytes] of [
  ['image/jpeg', createCanvas(20, 10).toBuffer('image/jpeg')],
  ['image/webp', await createCanvas(20, 10).encode('webp')],
]) {
  const inspected = await inspectWholePaperAsset({ bytes, role: 'answer', mediaType })
  assert.equal(inspected.width, 20, `${mediaType} header dimensions must be checked before decode`)
  assert.equal(inspected.height, 10)
}

const oversizedPngHeader = Buffer.alloc(33)
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(oversizedPngHeader)
oversizedPngHeader.writeUInt32BE(13, 8)
oversizedPngHeader.write('IHDR', 12, 'ascii')
oversizedPngHeader.writeUInt32BE(100_000, 16)
oversizedPngHeader.writeUInt32BE(100_000, 20)
await assert.rejects(
  inspectWholePaperAsset({ bytes: oversizedPngHeader, role: 'answer', mediaType: 'image/png' }),
  (error) => error?.code === 'asset_image_dimensions',
  'compressed image bombs must be rejected from encoded dimensions before native decode',
)

await assert.rejects(
  inspectWholePaperAsset({ bytes: Buffer.from('%PDF-not-an-image'), role: 'answer', mediaType: 'image/png' }),
  (error) => error?.code === 'asset_type_mismatch',
  'declared image content must be decoded and magic-checked',
)

const merged = await orderedImagesToPdf([
  { bytes: first, mediaType: 'image/png' },
  { bytes: second, mediaType: 'image/png' },
])
assert.equal(merged.subarray(0, 5).toString('ascii'), '%PDF-')
const mergedDocument = await getDocument({ data: new Uint8Array(merged), disableWorker: true }).promise
assert.equal(mergedDocument.numPages, 2, 'ordered image uploads must become one two-page source PDF')
await mergedDocument.destroy()
const mergedPages = await renderPdfToPageImages(merged, { maxPages: 2 })
const mergedPreview = await loadImage(mergedPages[0].bytes)
const mergedCanvas = createCanvas(mergedPreview.width, mergedPreview.height)
const mergedContext = mergedCanvas.getContext('2d')
mergedContext.drawImage(mergedPreview, 0, 0)
const mergedPixels = mergedContext.getImageData(0, 0, mergedCanvas.width, mergedCanvas.height).data
let mergedNonWhitePixels = 0
for (let index = 0; index < mergedPixels.length; index += 4) {
  if (mergedPixels[index] < 245 || mergedPixels[index + 1] < 245 || mergedPixels[index + 2] < 245) mergedNonWhitePixels += 1
}
assert.ok(mergedNonWhitePixels > 500, 'the composed source PDF must render the uploaded answer instead of blank pages')
const secondMergedPreview = await loadImage(mergedPages[1].bytes)
const secondMergedCanvas = createCanvas(secondMergedPreview.width, secondMergedPreview.height)
const secondMergedContext = secondMergedCanvas.getContext('2d')
secondMergedContext.drawImage(secondMergedPreview, 0, 0)
const firstCenter = mergedContext.getImageData(Math.floor(mergedCanvas.width / 2), Math.floor(mergedCanvas.height / 2), 1, 1).data
const secondCenter = secondMergedContext.getImageData(Math.floor(secondMergedCanvas.width / 2), Math.floor(secondMergedCanvas.height / 2), 1, 1).data
assert.ok(firstCenter[1] > firstCenter[2] && firstCenter[1] > firstCenter[0], 'page 1 must preserve the first green upload')
assert.ok(secondCenter[2] > secondCenter[1] && secondCenter[2] > secondCenter[0], 'page 2 must preserve the second blue upload')

const sourcePdf = await pdfFixture(2)
const inspectedPdf = await inspectWholePaperAsset({
  bytes: sourcePdf,
  role: 'answer',
  mediaType: 'application/pdf',
})
assert.equal(inspectedPdf.pageCount, 2)

const rendered = await renderPdfToPageImages(sourcePdf, { maxPages: WHOLE_PAPER_LIMITS.maxAnswerPages })
assert.equal(rendered.length, 2, 'PDF answers must be rendered into visual model inputs')
assert.match(rendered[0].dataUrl, /^data:image\/jpeg;base64,/)
assert.ok(rendered.every((page) => page.bytes.length > 500 && page.width > 0 && page.height > 0))

const oversizedImagePdf = await oversizedImageXObjectPdfFixture()
assert.ok(oversizedImagePdf.length < 10_000, 'oversized image fixture must remain tiny and must not allocate its declared decoded pixels')
await assert.rejects(
  inspectWholePaperAsset({ bytes: oversizedImagePdf, role: 'answer', mediaType: 'application/pdf' }),
  (error) => error?.code === 'asset_pdf_image_limit' && error?.statusCode === 413,
  'oversized PDF image XObjects must fail from metadata before image decode',
)
await assert.rejects(
  renderPdfToPageImages(oversizedImagePdf, { maxPages: 1 }),
  (error) => error?.code === 'asset_pdf_image_limit' && error?.statusCode === 413,
  'PDF.js maxImageSize with stopAtErrors must reject instead of silently omitting the image',
)

const ordinaryScanPdf = await ordinaryScanPdfFixture()
const inspectedOrdinaryScan = await inspectWholePaperAsset({ bytes: ordinaryScanPdf, role: 'answer', mediaType: 'application/pdf' })
assert.equal(inspectedOrdinaryScan.pageCount, 1)
const renderedOrdinaryScan = await renderPdfToPageImages(ordinaryScanPdf, { maxPages: 1 })
assert.equal(renderedOrdinaryScan.length, 1, 'ordinary bounded scan PDFs must remain renderable')

const extremeRendered = await renderPdfToPageImages(await extremePdfFixture(), { maxPages: 1 })
assert.equal(extremeRendered.length, 1)
assert.ok(extremeRendered[0].width <= WHOLE_PAPER_LIMITS.maxRenderedPageDimension)
assert.ok(extremeRendered[0].height <= WHOLE_PAPER_LIMITS.maxRenderedPageDimension)
assert.ok(extremeRendered[0].width * extremeRendered[0].height <= WHOLE_PAPER_LIMITS.maxRenderedPagePixels, 'extreme MediaBox pages must stay inside the pixel budget')

const tooManyPages = await pdfFixture(WHOLE_PAPER_LIMITS.maxAnswerPages + 1)
await assert.rejects(
  inspectWholePaperAsset({ bytes: tooManyPages, role: 'answer', mediaType: 'application/pdf' }),
  (error) => error?.code === 'answer_page_limit',
)

console.log('Whole-paper artifact checks passed')
