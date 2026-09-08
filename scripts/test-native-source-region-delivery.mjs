import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { createNativeQuestionImages } from '../server/nativeQuestionImages.js'
const canvas = createCanvas(800, 1000), ctx = canvas.getContext('2d')
ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 800, 1000)
ctx.fillStyle = '#000'; ctx.font = '24px sans-serif'; ctx.fillText('Q2: F = GMm / r²', 85, 215)
ctx.fillRect(150, 240, 110, 2); ctx.fillRect(150, 220, 2, 70)
const bytes = await canvas.encode('png'), hash = crypto.createHash('sha256').update(bytes).digest('hex')
const evidence = { page: 2, documentSha256: 'a'.repeat(64), pageImageSha256: hash,
  imageSize: [800, 1000], coordinateSpace: 'normalized-xyxy', region: [.1, .18, .8, .32] }
const question = { routeId: 'cie-9702-a2-physics', sourceQuestionId: 'cie-9702-9702_s25_qp_41:q1', subjectCode: '9702', released: true,
  sourceRef: { paper: '9702_s25_qp_41.pdf', sha256: 'a'.repeat(64) },
  sourceContent: { schemaVersion: 'ai-verified-coordinate-source-v1', complete: true, fileComplete: true, bindingSignature: 'test-source' },
  parts: [{ sourceEvidence: [evidence] }], diagramRegions: [{ ...evidence, region: [.18, .2, .4, .3] }] }
let bank = [question]
const service = createNativeQuestionImages({ getQuestionBank: () => bank, isReleased: q => q.released, pageReader: async () => ({ bytes, contentType: 'image/png', sha256: hash }) })
const original = service.descriptors(question.routeId, question.sourceQuestionId)[0]
const descriptor = service.descriptors(question.routeId, question.sourceQuestionId, { view: 'region' })[0]
assert.equal(descriptor.schemaVersion, 'native-source-region-v2', 'native clients should opt into source-bound region delivery')
assert.deepEqual(descriptor.region, evidence.region, 'canonical page coordinates stay unchanged')
assert.deepEqual(descriptor.imageSize, [800, 1000])
assert.deepEqual(descriptor.renderedImageSize, [560, 140])
assert.equal(descriptor.url, original.url + '&view=region')
const params = d => Object.fromEntries(new URL(d.url, 'https://example.test').searchParams)
const crop = await service.image(params(descriptor)), image = await loadImage(crop.bytes)
assert.equal(crop.contentType, 'image/png'); assert.equal(crop.sourcePageSha256, hash)
assert.equal(image.width, 560); assert.equal(image.height, 140)
const rendered = createCanvas(560, 140), output = rendered.getContext('2d'); output.drawImage(image, 0, 0)
assert.deepEqual(Buffer.from(output.getImageData(0, 0, 560, 140).data), Buffer.from(ctx.getImageData(80, 180, 560, 140).data), 'every cropped pixel, including formulas/diagrams, is unchanged')
assert.ok(crop.bytes.length < bytes.length)
assert.deepEqual((await service.image(params(original))).bytes, bytes, 'legacy URLs still return the complete original page')
assert.throws(() => service.image({ ...params(descriptor), view: '../ms' }), e => e.statusCode === 400)
bank = []
assert.throws(() => service.image(params(descriptor)), e => e.statusCode === 404, 'revocation still applies to cached crops')
console.log(JSON.stringify({ status: 'PASS', scope: 'opt-in native crops, exact pixels, bound source/geometry, legacy URLs and revocation', originalBytes: bytes.length, regionBytes: crop.bytes.length }))
