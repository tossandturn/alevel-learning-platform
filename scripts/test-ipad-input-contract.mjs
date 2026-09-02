import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const appRoot = new URL('../', import.meta.url)
const handwriting = read(new URL('src/components/HandwritingPad.jsx', appRoot))
const coach = read(new URL('src/components/AiCoach.jsx', appRoot))
const pdfViewer = read(new URL('src/components/PdfViewer.jsx', appRoot))
const inkStroke = read(new URL('src/lib/inkStroke.js', appRoot))
const styles = read(new URL('src/App.css', appRoot))
const { applyNativePencilStroke, nativePencilPoints } = await import(new URL('src/lib/inkStroke.js', appRoot))

assert.match(handwriting, /data-camera-intent/, 'handwriting Take photo must expose a camera intent marker')
assert.match(handwriting, /data-camera-input/, 'handwriting camera input must expose a camera input marker')
assert.match(handwriting, /capture="environment"/, 'handwriting camera input must request the rear camera')
assert.match(handwriting, /className=\{`handwriting-pad__canvas[\s\S]{0,220}?data-ink-surface="handwriting"/, 'handwriting canvas must identify its ink surface')
assert.match(handwriting, /data-ink-surface-id=/, 'handwriting canvas must expose a stable native Pencil surface id')
assert.match(handwriting, /data-ink-interactive=/, 'handwriting canvas must expose whether native Pencil capture is allowed')
assert.match(handwriting, /data-ink-tool=/, 'handwriting canvas must expose its current native Pencil tool')
assert.match(handwriting, /addEventListener\(NATIVE_PENCIL_STROKE_EVENT/, 'handwriting canvas must consume native Pencil strokes')
assert.doesNotMatch(handwriting, /onSelectStart=/, 'React must not receive the unsupported onSelectStart prop')

assert.match(coach, /data-camera-intent/, 'Coach Take photo must expose a camera intent marker')
assert.match(coach, /data-camera-input/, 'Coach camera input must expose a camera input marker')
assert.match(coach, /capture="environment"/, 'Coach camera input must request the rear camera')

assert.match(pdfViewer, /pdf-canvas-scroll--annotating/, 'annotating PDF containers must expose a selection-safe state')
assert.match(pdfViewer, /data-ink-surface="pdf"/, 'PDF ink canvas must identify its ink surface')
assert.match(pdfViewer, /data-ink-surface-id=/, 'PDF ink canvas must expose a stable native Pencil surface id')
assert.match(pdfViewer, /data-ink-interactive=/, 'PDF ink canvas must expose whether native Pencil capture is allowed')
assert.match(pdfViewer, /data-ink-tool=/, 'PDF ink canvas must expose its current native Pencil tool')
assert.match(pdfViewer, /addEventListener\(NATIVE_PENCIL_STROKE_EVENT/, 'PDF ink canvas must consume native Pencil strokes')
assert.doesNotMatch(pdfViewer, /onSelectStart=/, 'React must not receive the unsupported onSelectStart prop')

assert.match(inkStroke, /export function applyNativePencilStroke/, 'ink model must provide a shared native Pencil stroke mapper')

assert.match(styles, /\.handwriting-pad__surface:has\(\.handwriting-pad__canvas\)/, 'handwriting surfaces must suppress selection only while writing')
assert.match(styles, /\.pdf-canvas-scroll--annotating/, 'annotating PDF surfaces must suppress selection and callouts')
assert.match(styles, /\.paper-workspace-header[\s\S]{0,620}user-select: none/, 'paper workspace chrome must suppress accidental long-press selection')
assert.doesNotMatch(styles, /\.paper-workspace,\s*\.paper-workspace :where\(\*\)/, 'paper workspace must not disable selection globally')
assert.match(styles, /\.paper-workspace :where\(input, textarea, \[contenteditable="true"\]\)[\s\S]{0,180}user-select: text/, 'paper answer fields must retain text editing')
assert.match(styles, /\.pdf-canvas-scroll[\s\S]{0,320}touch-action: pan-x pan-y pinch-zoom/, 'PDF scroll surface must explicitly allow finger pan and pinch zoom')

const drawCalls = []
const context = {
  save() {},
  restore() {},
  beginPath() {},
  moveTo(x, y) { drawCalls.push(['moveTo', x, y]) },
  lineTo(x, y) { drawCalls.push(['lineTo', x, y]) },
  stroke() { drawCalls.push(['stroke']) },
  arc(x, y) { drawCalls.push(['arc', x, y]) },
  fill() { drawCalls.push(['fill']) },
}
const fakeCanvas = {
  width: 200,
  height: 100,
  getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 50 }),
  getContext: () => context,
}
const mapped = nativePencilPoints(fakeCanvas, {
  coordinateSpace: 'overlay',
  surfaceFrame: { x: 10, y: 20, width: 100, height: 50 },
  points: [{ x: 20, y: 30, pressure: 0.7 }, { x: 60, y: 45, pressure: 0.8 }],
})
assert.deepEqual(mapped[0], { x: 20, y: 20, pressure: 0.7 }, 'native Pencil overlay coordinates must map to backing pixels')
const applied = applyNativePencilStroke(fakeCanvas, {
  coordinateSpace: 'overlay',
  surfaceFrame: { x: 10, y: 20, width: 100, height: 50 },
  points: [{ x: 20, y: 30, pressure: 0.7 }, { x: 60, y: 45, pressure: 0.8 }],
}, () => ({ color: '#172033', composite: 'source-over', width: 2 }))
assert.equal(applied.segments, 1, 'native Pencil stroke must render connected segments')
assert.ok(drawCalls.some((call) => call[0] === 'lineTo'), 'native Pencil stroke must reach the canvas renderer')

console.log('iPad Pencil, camera intent and drawing-container contract passed.')
