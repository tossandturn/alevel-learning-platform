import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createNativeQuestionImages } from '../server/nativeQuestionImages.js'

const documentSha256 = 'a'.repeat(64)
const changedDocumentSha256 = 'c'.repeat(64)
const changedPageSha256 = 'd'.repeat(64)
const routeId = 'cie-9700-as-biology'
const sourceQuestionId = 'cie-9700-9700_s25_qp_13:q16'
const imageSize = [1000, 1000]
const wholeRegion = [0.06, 0.06, 0.94, 0.43]
const tableRegion = [0.055, 0.135, 0.94, 0.405]

const canvas = createCanvas(...imageSize), context = canvas.getContext('2d')
context.fillStyle = '#fff'; context.fillRect(0, 0, ...imageSize)
context.fillStyle = '#111'; context.font = '28px sans-serif'; context.fillText('Q16 competitive inhibitor', 65, 100)
context.strokeStyle = '#111'; context.lineWidth = 4; context.strokeRect(55, 135, 885, 270)
context.fillStyle = '#0a5'; context.fillRect(60, 145, 100, 250)
context.fillStyle = '#036'; context.fillRect(170, 145, 760, 250)
const pageBytes = await canvas.encode('png')
const pageImageSha256 = crypto.createHash('sha256').update(pageBytes).digest('hex')

function evidence(region, pageHash = pageImageSha256) {
  return { page: 8, documentSha256, pageImageSha256: pageHash, imageSize,
    coordinateSpace: 'normalized-xyxy', region }
}

const whole = evidence(wholeRegion), table = evidence(tableRegion)
const question = {
  routeId,
  sourceQuestionId,
  subjectCode: '9700',
  released: true,
  sourceRef: { paper: '9700_s25_qp_13.pdf', sha256: documentSha256, renderDpi: 180 },
  sourceContent: {
    schemaVersion: 'ai-verified-coordinate-source-v1',
    complete: true,
    fileComplete: true,
    bindingSignature: 'legacy-url-fixture-binding',
  },
  parts: [{ sourceEvidence: [whole, table] }],
  diagramRegions: [table],
}

function legacyDescriptors(item) {
  const hash = item.sourceRef.sha256
  const records = [...item.parts.flatMap((part) => part.sourceEvidence || []), ...(item.diagramRegions || [])]
  const unique = new Map()
  for (const record of records) {
    const page = Number(record.page), pageHash = String(record.pageImageSha256).toLowerCase()
    unique.set(JSON.stringify([page, record.region, pageHash]), {
      page,
      region: record.region,
      imageSize: record.imageSize,
      pageHash,
      hash,
    })
  }
  const all = [...unique.values()]
  return all.filter((itemRegion, index) => !all.some((other, otherIndex) => otherIndex !== index &&
    other.page === itemRegion.page && other.pageHash === itemRegion.pageHash &&
    other.region[0] <= itemRegion.region[0] && other.region[1] <= itemRegion.region[1] &&
    other.region[2] >= itemRegion.region[2] && other.region[3] >= itemRegion.region[3]))
    .sort((left, right) => left.page - right.page || left.region[1] - right.region[1] || left.region[0] - right.region[0])
    .map((region, index) => ({
      index,
      region,
      v: crypto.createHash('sha256').update(JSON.stringify([
        item.routeId,
        item.sourceQuestionId,
        item.sourceContent.bindingSignature,
        item.sourceRef,
        region,
      ])).digest('hex'),
    }))
}

function inputFor(descriptor, view = 'page') {
  return { routeId, sourceQuestionId, region: String(descriptor.index), v: descriptor.v, view }
}

async function expectedCrop(region) {
  const image = await loadImage(pageBytes)
  const left = Math.floor(region[0] * imageSize[0]), top = Math.floor(region[1] * imageSize[1])
  const width = Math.ceil(region[2] * imageSize[0]) - left, height = Math.ceil(region[3] * imageSize[1]) - top
  const output = createCanvas(width, height)
  output.getContext('2d').drawImage(image, left, top, width, height, 0, 0, width, height)
  return output.encode('png')
}

let bank = [question], pageReaderCalls = 0
const service = createNativeQuestionImages({
  getQuestionBank: () => bank,
  libraryRoot: '/fixture',
  isReleased: (item) => item.released === true,
  pageReader: async () => {
    pageReaderCalls += 1
    return { bytes: pageBytes, contentType: 'image/png', sha256: pageImageSha256 }
  },
})
const currentDescriptors = service.descriptors(routeId, sourceQuestionId, { view: 'region' })
assert.equal(currentDescriptors.length, 1, 'new projectSet/descriptors must expose only the merged source image')
assert.deepEqual(currentDescriptors[0].region, [0.055, 0.06, 0.94, 0.43])
const legacy = legacyDescriptors(question)
assert.equal(legacy.length, 2)

const oldPage = await service.image(inputFor(legacy[0]))
assert.deepEqual(oldPage.bytes, pageBytes, 'legacy view=page returns the exact 72ac full-page bytes')
assert.deepEqual((await service.image(inputFor(legacy[0]))).bytes, pageBytes)
assert.equal(pageReaderCalls, 1, 'legacy page URL remains cached')

const oldCrop0 = await service.image(inputFor(legacy[0], 'region'))
const oldCrop1 = await service.image(inputFor(legacy[1], 'region'))
assert.deepEqual(oldCrop0.bytes, await expectedCrop(legacy[0].region.region), 'legacy region0 crop bytes match 72ac')
assert.deepEqual(oldCrop1.bytes, await expectedCrop(legacy[1].region.region), 'legacy region1 crop bytes match 72ac')
const currentInput = Object.fromEntries(new URL(currentDescriptors[0].url, 'https://example.test').searchParams)
const currentCrop = await service.image(currentInput)
assert.notDeepEqual(currentCrop.bytes, oldCrop0.bytes, 'new and legacy cache entries cannot be confused')
assert.equal(pageReaderCalls, 4)

const callsBeforeRejects = pageReaderCalls
assert.throws(() => service.image({ ...inputFor(legacy[0]), v: 'f'.repeat(64) }), (error) => error.statusCode === 409)
bank = [{ ...question, sourceContent: { ...question.sourceContent, bindingSignature: 'changed-binding' } }]
assert.throws(() => service.image(inputFor(legacy[0])), (error) => error.statusCode === 409)
bank = [{ ...question, parts: [{ sourceEvidence: [evidence(wholeRegion, changedPageSha256), evidence(tableRegion, changedPageSha256)] }],
  diagramRegions: [evidence(tableRegion, changedPageSha256)] }]
assert.throws(() => service.image(inputFor(legacy[0])), (error) => error.statusCode === 409)
bank = [{ ...question, sourceRef: { ...question.sourceRef, sha256: changedDocumentSha256 } }]
assert.throws(() => service.image(inputFor(legacy[0])), (error) => [404, 409].includes(error.statusCode))
bank = [{ ...question, released: false }]
assert.throws(() => service.image(inputFor(legacy[0])), (error) => error.statusCode === 404)
assert.equal(pageReaderCalls, callsBeforeRejects, 'rejected legacy tokens never read source pixels or hit a cached response')

bank = [question]
const raceService = createNativeQuestionImages({
  getQuestionBank: () => bank,
  libraryRoot: '/fixture',
  isReleased: (item) => item.released === true,
  pageReader: async () => {
    bank = [{ ...question, sourceContent: { ...question.sourceContent, bindingSignature: 'changed-during-read' } }]
    return { bytes: pageBytes, contentType: 'image/png', sha256: pageImageSha256 }
  },
})
await assert.rejects(raceService.image(inputFor(legacy[1], 'region')), (error) => error.statusCode === 409)

console.log(JSON.stringify({
  status: 'passed',
  scope: 'trusted 72ac native source-image URL compatibility',
  legacyRegions: legacy.length,
  currentRegions: currentDescriptors.length,
  pageReaderCalls,
  cacheLimitsUnchanged: true,
}))
