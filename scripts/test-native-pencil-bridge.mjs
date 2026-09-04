import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { mapNativePencilStroke, stableNativeSurfaceId } from '../src/lib/nativePencilBridge.js'

const surfaceId = stableNativeSurfaceId('handwriting', ':r1:answer:0')
assert.equal(surfaceId, 'handwriting-r1answer0')

const mapped = mapNativePencilStroke({
  surfaceId,
  rect: { x: 10, y: 20, width: 200, height: 100 },
  canvasWidth: 400,
  canvasHeight: 200,
  detail: {
    surfaceId,
    coordinateSpace: 'webViewViewport',
    surfaceFrame: { x: 10, y: 20, width: 200, height: 100 },
    tool: 'pen',
    points: [
      { x: 10, y: 20, pressure: 0 },
      { x: 110, y: 70, pressure: 1.2 },
    ],
  },
})
assert.deepEqual(mapped, {
  tool: 'pen',
  points: [
    { x: 0, y: 0, pressure: 0.5 },
    { x: 200, y: 100, pressure: 1 },
  ],
})

assert.equal(mapNativePencilStroke({
  surfaceId,
  rect: { x: 10, y: 20, width: 200, height: 100 },
  canvasWidth: 400,
  canvasHeight: 200,
  detail: { surfaceId: 'other', surfaceFrame: { x: 10, y: 20, width: 200, height: 100 }, points: [{ x: 10, y: 20 }] },
}), null)

assert.equal(mapNativePencilStroke({
  surfaceId,
  rect: { x: 10, y: 20, width: 200, height: 100 },
  canvasWidth: 400,
  canvasHeight: 200,
  detail: { surfaceId, coordinateSpace: 'unknown', surfaceFrame: { x: 10, y: 20, width: 200, height: 100 }, points: [{ x: 10, y: 20 }] },
}), null)

const handwritingSource = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src/components/HandwritingPad.jsx'), 'utf8')
const pdfSource = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src/components/PdfViewer.jsx'), 'utf8')
assert.match(handwritingSource, /data-ink-surface="handwriting"/)
assert.match(handwritingSource, /NATIVE_PENCIL_EVENT/)
assert.match(handwritingSource, /mapNativePencilStroke/)
assert.match(pdfSource, /data-ink-surface="pdf"/)
assert.match(pdfSource, /NATIVE_PENCIL_EVENT/)
assert.match(pdfSource, /mapNativePencilStroke/)

console.log('Native Pencil bridge coordinate contract passed.')
