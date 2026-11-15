import assert from 'node:assert/strict'
import crypto from 'node:crypto'

import { createNativeQuestionImages } from '../server/nativeQuestionImages.js'

const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=', 'base64')
const pageHash = crypto.createHash('sha256').update(bytes).digest('hex')
const documentHash = 'a'.repeat(64)
const question = {
  routeId: 'cie-9702-a2-physics',
  sourceQuestionId: 'cie-9702-9702_s25_qp_41:q1',
  subjectCode: '9702',
  released: true,
  sourceRef: { paper: '9702_s25_qp_41.pdf', sha256: documentHash },
  sourceContent: { schemaVersion: 'ai-verified-coordinate-source-v1', complete: true, fileComplete: true, bindingSignature: 'cache-budget-fixture' },
  parts: [{ sourceEvidence: [{ page: 1, documentSha256: documentHash, pageImageSha256: pageHash,
    coordinateSpace: 'normalized-xyxy', region: [0, 0, 1, 1], imageSize: [1, 1] }] }],
  diagramRegions: [],
}

async function exercise(cacheByteLimit) {
  let reads = 0
  const service = createNativeQuestionImages({
    getQuestionBank: () => [question],
    libraryRoot: 'D:/CodexWork/cie-fraft-fetcher/output/pdf',
    env: {},
    cacheByteLimit,
    isReleased: (value) => value.released === true,
    pageReader: async () => { reads += 1; return { bytes, contentType: 'image/png', sha256: pageHash } },
  })
  const [descriptor] = service.descriptors(question.routeId, question.sourceQuestionId)
  const input = Object.fromEntries(new URL(descriptor.url, 'https://local.invalid').searchParams)
  const first = await service.image(input)
  const second = await service.image(input)
  assert.deepEqual(first.bytes, bytes)
  assert.deepEqual(second.bytes, bytes)
  return reads
}

assert.equal(await exercise(bytes.length + 1), 1, 'a bounded image should be cached')
assert.equal(await exercise(bytes.length - 1), 2, 'an image larger than the cache budget must never enter the cache')
console.log(JSON.stringify({ status: 'PASS', boundedReads: 1, oversizedReads: 2 }))
