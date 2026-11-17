import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8')
const handwriting = read('src/components/HandwritingPad.jsx')
const coach = read('src/components/AiCoach.jsx')
const pdfViewer = read('src/components/PdfViewer.jsx')
const app = read('src/App.jsx')
const styles = read('src/App.css')

assert.match(handwriting, /data-camera-intent/, 'handwriting Take photo must expose a camera intent marker')
assert.match(handwriting, /data-camera-input/, 'handwriting camera input must expose a camera input marker')
assert.match(handwriting, /capture="environment"/, 'handwriting camera input must request the rear camera')
assert.match(handwriting, /data-ink-surface="handwriting"/, 'handwriting canvas must identify its ink surface')
assert.match(handwriting, /data-ink-surface-id=\{nativeSurfaceId\}/, 'handwriting canvas must expose the normalized stable native bridge surface id')
assert.equal((handwriting.match(/addEventListener\(NATIVE_PENCIL_EVENT/g) || []).length, 1, 'handwriting must register one native Pencil listener')
assert.equal((handwriting.match(/data-ink-surface-id=/g) || []).length, 1, 'handwriting must expose one unambiguous native surface id')
assert.match(handwriting, /pointerrawupdate/, 'handwriting must consume the hardware-rate pointer stream when available')
assert.doesNotMatch(handwriting, /rawPenInputRef/, 'handwriting must not gate pointermove on an intermittent raw pen event')
assert.doesNotMatch(handwriting, /onSelectStart=/, 'React must not receive the unsupported onSelectStart prop')

assert.match(coach, /data-camera-intent/, 'Coach Take photo must expose a camera intent marker')
assert.match(coach, /data-camera-input/, 'Coach camera input must expose a camera input marker')
assert.match(coach, /data-upload-intent/, 'Coach Upload photo must expose an upload intent marker')
assert.match(coach, /data-upload-input/, 'Coach upload input must expose an upload input marker')
assert.match(coach, /capture="environment"/, 'Coach camera input must request the rear camera')

assert.match(pdfViewer, /pdf-canvas-scroll--annotating/, 'annotating PDF containers must expose a selection-safe state')
assert.match(pdfViewer, /data-ink-surface="pdf"/, 'PDF ink canvas must identify its ink surface')
assert.match(pdfViewer, /data-ink-surface-id=\{nativeSurfaceId\}/, 'PDF ink canvas must expose the normalized stable native bridge surface id')
assert.equal((pdfViewer.match(/addEventListener\(NATIVE_PENCIL_EVENT/g) || []).length, 1, 'PDF ink must register one native Pencil listener')
assert.equal((pdfViewer.match(/data-ink-surface-id=/g) || []).length, 1, 'PDF ink must expose one unambiguous native surface id')
assert.match(pdfViewer, /pointerrawupdate/, 'PDF ink must consume the hardware-rate pointer stream when available')
assert.doesNotMatch(pdfViewer, /rawPenInputRef/, 'PDF ink must not gate pointermove on an intermittent raw pen event')
assert.doesNotMatch(pdfViewer, /onSelectStart=/, 'React must not receive the unsupported onSelectStart prop')

assert.match(app, /available >= MIN_QUESTION_GROUPS_PER_TEST/, 'practice builder must preserve the six-question source floor')
assert.match(app, /MIN_VERIFIED_GROUPS_FOR_PRACTICE/, 'practice builder must preserve the formal review floor')
assert.match(app, /disabled=\{!canBuildPractice\}/, 'practice builder must fail closed until both floors pass')
assert.match(styles, /\.handwriting-pad__surface:has\(\.handwriting-pad__canvas\)/, 'handwriting surfaces must suppress selection only while writing')
assert.match(styles, /\.pdf-canvas-scroll--annotating/, 'annotating PDF surfaces must suppress selection and callouts')

console.log('iPad Pencil, camera intent, drawing-container and inventory contract passed.')
