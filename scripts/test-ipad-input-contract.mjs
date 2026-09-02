import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (relative) => fs.readFileSync(new URL(relative, root), 'utf8')
const handwriting = read('src/components/HandwritingPad.jsx')
const coach = read('src/components/AiCoach.jsx')
const pdfViewer = read('src/components/PdfViewer.jsx')
const styles = read('src/App.css')
const inkStroke = read('src/lib/inkStroke.js')
const { applyNativePencilStroke, nativePencilPoints } = await import(new URL('src/lib/inkStroke.js', root))

assert.match(handwriting, /data-ink-surface="handwriting"/)
assert.match(handwriting, /data-camera-intent/)
assert.match(handwriting, /data-camera-input/)
assert.match(handwriting, /data-ink-surface-id=/)
assert.match(handwriting, /data-ink-interactive=/)
assert.match(handwriting, /data-ink-tool=/)
assert.match(handwriting, /addEventListener\(NATIVE_PENCIL_STROKE_EVENT/)
assert.match(pdfViewer, /data-ink-surface="pdf"/)
assert.match(pdfViewer, /data-ink-surface-id=/)
assert.match(pdfViewer, /data-ink-interactive=/)
assert.match(pdfViewer, /data-ink-tool=/)
assert.match(pdfViewer, /addEventListener\(NATIVE_PENCIL_STROKE_EVENT/)
assert.match(coach, /<input[^>]*multiple[^>]*data-upload-input/, 'Coach upload must retain multi-photo input semantics')
assert.match(coach, /data-camera-intent/)
assert.match(coach, /data-camera-input/)
assert.match(inkStroke, /export function applyNativePencilStroke/)
assert.match(styles, /\.paper-workspace[\s\S]{0,260}user-select: none/)
assert.match(styles, /\.paper-workspace :where\(input, textarea, \[contenteditable="true"\]\)[\s\S]{0,180}user-select: text/)
assert.match(styles, /\.pdf-canvas-scroll[\s\S]{0,320}touch-action: pan-x pan-y pinch-zoom/)

const calls = []
const context = {
  save() {}, restore() {}, beginPath() {},
  moveTo(x, y) { calls.push(['moveTo', x, y]) },
  lineTo(x, y) { calls.push(['lineTo', x, y]) },
  stroke() { calls.push(['stroke']) },
  arc(x, y) { calls.push(['arc', x, y]) },
  fill() { calls.push(['fill']) },
}
const canvas = {
  width: 200,
  height: 100,
  getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 50 }),
  getContext: () => context,
}
const detail = {
  coordinateSpace: 'webViewViewport',
  surfaceFrame: { x: 10, y: 20, width: 100, height: 50 },
  points: [{ x: 20, y: 30, pressure: 0.7 }, { x: 60, y: 45, pressure: 0.8 }],
}
assert.deepEqual(nativePencilPoints(canvas, detail)[0], { x: 20, y: 20, pressure: 0.7 })
assert.equal(applyNativePencilStroke(canvas, detail, () => ({ color: '#172033', composite: 'source-over', width: 2 })).segments, 1)
assert.ok(calls.some((call) => call[0] === 'lineTo'))

console.log('iPad Pencil, camera intent and drawing-container contract passed.')
