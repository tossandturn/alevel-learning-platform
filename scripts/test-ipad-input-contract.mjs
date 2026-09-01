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
assert.match(handwriting, /data-ink-surface-id=\{instanceId\}/, 'handwriting canvas must expose a stable native bridge surface id')
assert.match(handwriting, /stemist-native-pencil-stroke/, 'handwriting must accept native PencilKit strokes')
assert.match(handwriting, /pointerrawupdate/, 'handwriting must consume the hardware-rate pointer stream when available')
assert.doesNotMatch(handwriting, /pointerType\s*===\s*['"]pen['"]\s*&&\s*rawPenInputRef\.current\)\s*return/, 'handwriting must not drop pointermove after an intermittent raw pen event')
assert.doesNotMatch(handwriting, /onSelectStart=/, 'React must not receive the unsupported onSelectStart prop')

assert.match(coach, /data-camera-intent/, 'Coach Take photo must expose a camera intent marker')
assert.match(coach, /data-camera-input/, 'Coach camera input must expose a camera input marker')
assert.match(coach, /capture="environment"/, 'Coach camera input must request the rear camera')

assert.match(pdfViewer, /pdf-canvas-scroll--annotating/, 'annotating PDF containers must expose a selection-safe state')
assert.match(pdfViewer, /data-ink-surface="pdf"/, 'PDF ink canvas must identify its ink surface')
assert.match(pdfViewer, /data-ink-surface-id=\{`pdf:/, 'PDF ink canvas must expose a stable native bridge surface id')
assert.match(pdfViewer, /stemist-native-pencil-stroke/, 'PDF ink must accept native PencilKit strokes')
assert.match(pdfViewer, /pointerrawupdate/, 'PDF ink must consume the hardware-rate pointer stream when available')
assert.doesNotMatch(pdfViewer, /pointerType\s*===\s*['"]pen['"]\s*&&\s*rawPenInputRef\.current\)\s*return/, 'PDF ink must not drop pointermove after an intermittent raw pen event')
assert.doesNotMatch(pdfViewer, /onSelectStart=/, 'React must not receive the unsupported onSelectStart prop')

assert.match(app, /selectableQuestionCounts/, 'practice builder must derive question options from real inventory')
assert.match(app, /No complete set available/, 'practice builder must show a truthful empty inventory state')
assert.match(app, /source questions\{count <= selectedInventory\.verifiedQuestionCount/, 'practice builder must distinguish reviewed and study-only options')
assert.match(styles, /\.handwriting-pad__surface:has\(\.handwriting-pad__canvas\)/, 'handwriting surfaces must suppress selection only while writing')
assert.match(styles, /\.pdf-canvas-scroll--annotating/, 'annotating PDF surfaces must suppress selection and callouts')

console.log('iPad Pencil, camera intent, drawing-container and inventory contract passed.')
